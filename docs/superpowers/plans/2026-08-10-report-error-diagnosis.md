# 报表图片错误清单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让老板上传报表截图后，首屏直接得到可追溯的“具体错误/异常清单”；能证明的计算错误给出订正值，无法证明的只要求核对，OCR 乱码不再作为主结果。

**Architecture:** 图片仍先经过现有 OCR，但新增一条独立的视觉理解链路，把原图解析成结构化 `facts`。程序规则只在结构化事实之上做确定性复算；视觉模型只负责读表结构和提出候选异常。最后由聚合器合并“程序证明的问题 / 视觉候选 / OCR-视觉冲突”，前端只渲染老板能读懂的错误清单。若没有可用视觉模型，降级到 OCR + 程序规则，不让整个上传流程失败。

**Tech Stack:** Node.js 20、Vercel Serverless、原生 `fetch`、OpenAI Responses API 图像输入、现有 Tesseract OCR、原生浏览器 JS/CSS、Node `--test`。

## Global Constraints

- 原始上传图片不被修改。
- `calculation_error` 只有程序能够唯一复算时才允许出现 `correctedValue`。
- `logic_error` 可以证明当前数据不成立，但不得伪造正确值。
- `needs_confirmation` 只针对会影响结论的关键字段，不展示 OCR token 噪声。
- 视觉模型与 OCR 对关键数字冲突时，不自动订正，进入人工确认。
- AI 提出的“计算错误”若程序不能复算证明，必须降级为“需要核对”。
- 页面首屏不以 OCR 置信度为核心信息。
- DeepSeek V4 官方 API 当前为文本模型；视觉分析只使用支持图像输入的 provider。OpenAI Responses API 支持 `input_image`，因此本轮以 `OPENAI_API_KEY` 作为视觉 provider；没有该 key 时走可解释降级路径。
- 不扩展自动修改 Excel、行业专属财务模型、多页 PDF 审计或完整经营改善方案。

---

## File map

- Create `src/report/vision.js` — 原图视觉解析，只负责输出结构化事实和候选异常。
- Create `src/report/facts.js` — 统一事实结构、视觉/OCR 对齐、关键字段冲突识别。
- Create `src/report/rules.js` — 对结构化 facts 做确定性计算和逻辑检查。
- Create `src/report/issues.js` — 合并程序错误、AI 候选和确认项，去重并排序。
- Modify `api/analyze-file.js` — 图片分析时编排 OCR + vision + facts + rules + issues，并输出 `reportReview`。
- Modify `public/app.js` — 图片上传后直接渲染错误清单；仅关键字段冲突时渲染确认项。
- Modify `public/index.html` — 将“资料检查”区域调整为错误清单容器。
- Modify `public/styles.css` — 手机首屏错误清单布局。
- Keep `public/file-review.js` — 仅作为折叠的 OCR 技术详情，不再决定主结果。
- Add tests under `tests/report/`, `tests/api/`, `tests/ui/`.

---

### Task 1: 原图视觉解析成结构化事实

**Files:**
- Create: `src/report/vision.js`
- Create: `tests/report/vision.test.js`

**Interfaces:**
- Consumes: `{ name:string, buffer:Buffer, mimeType:string, ocrText:string }`
- Produces: `analyzeReportImage(input, deps) -> Promise<{ available:boolean, provider:string|null, model:string|null, facts:Array<ReportFact>, candidates:Array<VisionCandidate>, warning:string|null }>`
- `ReportFact = { id:string, scope:string, metric:string, value:number|string|null, unit:string, sourceText:string, confidence:number, source:'vision' }`
- `VisionCandidate = { title:string, scope:string, kind:'calculation_error'|'logic_error'|'anomaly', explanation:string, relatedFactIds:string[] }`

- [ ] **Step 1: Write failing provider-contract tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReportImage } from '../../src/report/vision.js';

test('sends the original image to a vision-capable Responses API and returns bounded facts', async () => {
  let requestBody;
  const fetchImpl = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok:true,
      json:async () => ({ output_text:JSON.stringify({
        facts:[
          { id:'f1', scope:'华南大区', metric:'营收', value:9800, unit:'万元', sourceText:'营收 9,800', confidence:0.98 },
          { id:'f2', scope:'华南大区', metric:'营业成本', value:6100, unit:'万元', sourceText:'成本 6,100', confidence:0.97 },
          { id:'f3', scope:'华南大区', metric:'毛利率', value:85, unit:'%', sourceText:'毛利率 85.00%', confidence:0.99 }
        ],
        candidates:[]
      }) })
    };
  };

  const result = await analyzeReportImage({
    name:'report.png',
    buffer:Buffer.from('fake-image'),
    mimeType:'image/png',
    ocrText:'营收 9800 成本 6100 毛利率 85%'
  }, { apiKey:'test-key', model:'gpt-5-mini', fetchImpl });

  assert.equal(result.available, true);
  assert.equal(result.facts[0].scope, '华南大区');
  assert.equal(requestBody.input[0].content.some((item) => item.type === 'input_image'), true);
  assert.match(requestBody.input[0].content.find((item) => item.type === 'input_image').image_url, /^data:image\/png;base64,/);
});

test('returns an explicit non-fatal fallback when no vision key exists', async () => {
  const result = await analyzeReportImage({ name:'report.png', buffer:Buffer.from('x'), mimeType:'image/png', ocrText:'' }, { apiKey:'' });
  assert.deepEqual(result, { available:false, provider:null, model:null, facts:[], candidates:[], warning:'视觉分析暂不可用，已使用文字识别继续检查' });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/report/vision.test.js`
Expected: FAIL because `src/report/vision.js` does not exist.

- [ ] **Step 3: Implement minimal vision provider**

`src/report/vision.js` must:

```js
const MAX_FACTS = 160;
const MAX_CANDIDATES = 40;

export async function analyzeReportImage(input, {
  apiKey = process.env.OPENAI_API_KEY || '',
  model = process.env.OPENAI_VISION_MODEL || 'gpt-5-mini',
  fetchImpl = fetch,
  timeoutMs = 15000
} = {}) {
  if (!apiKey) return {
    available:false, provider:null, model:null, facts:[], candidates:[],
    warning:'视觉分析暂不可用，已使用文字识别继续检查'
  };

  const imageUrl = `data:${input.mimeType};base64,${input.buffer.toString('base64')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{ Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' },
      signal:controller.signal,
      body:JSON.stringify({
        model,
        instructions:[
          '你是报表结构读取器，不直接下最终结论。',
          '读取图片中的行列关系，输出 JSON。',
          'facts 每项必须包含 id, scope, metric, value, unit, sourceText, confidence。',
          '不要根据常识修改原值；不确定就降低 confidence。',
          'candidates 只能提出候选异常，不能伪造 correctedValue。'
        ].join('\n'),
        input:[{ role:'user', content:[
          { type:'input_text', text:`OCR 辅助文本，仅供交叉参考：\n${String(input.ocrText || '').slice(0, 12000)}` },
          { type:'input_image', image_url:imageUrl, detail:'high' }
        ] }],
        max_output_tokens:5000,
        text:{ format:{ type:'json_object' } }
      })
    });
    if (!response.ok) throw new Error(`vision request failed (${response.status})`);
    const payload = await response.json();
    const parsed = JSON.parse(payload.output_text || '{}');
    return normalizeVisionResult(parsed, model);
  } catch {
    return { available:false, provider:null, model:null, facts:[], candidates:[], warning:'视觉分析暂时失败，已使用文字识别继续检查' };
  } finally {
    clearTimeout(timer);
  }
}
```

Also implement `normalizeVisionResult` so malformed entries are dropped, confidence is clamped to `0..1`, arrays are capped, and arbitrary model fields are discarded.

- [ ] **Step 4: Run tests GREEN**

Run: `node --test tests/report/vision.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report/vision.js tests/report/vision.test.js
git commit -m "feat: parse report images with vision model"
```

---

### Task 2: 统一视觉与 OCR 事实，只确认真正关键的冲突

**Files:**
- Create: `src/report/facts.js`
- Create: `tests/report/facts.test.js`

**Interfaces:**
- Produces: `buildReportFacts({ visionFacts, ocrDocument }) -> { facts:Array<ReportFact>, confirmations:Array<FactConfirmation> }`
- `FactConfirmation = { id:string, scope:string, metric:string, currentValue:number|string|null, reason:string, sourceText:string }`

- [ ] **Step 1: Write failing reconciliation tests**

```js
test('keeps reliable vision facts without exposing unrelated OCR garbage', () => {
  const result = buildReportFacts({
    visionFacts:[{ id:'f1', scope:'华南大区', metric:'营收', value:9800, unit:'万元', sourceText:'营收 9,800', confidence:0.98, source:'vision' }],
    ocrDocument:{ text:'9:21 al 全 可) [—', uncertainSegments:[{ text:'al', confidence:0.29, context:'9:21 al 全 可)' }] }
  });
  assert.equal(result.facts.length, 1);
  assert.equal(result.confirmations.length, 0);
});

test('flags only a conflicting key value, not every low-confidence OCR token', () => {
  const result = buildReportFacts({
    visionFacts:[{ id:'f1', scope:'华南大区', metric:'营业成本', value:6100, unit:'万元', sourceText:'成本 6,100', confidence:0.91, source:'vision' }],
    ocrDocument:{ text:'华南大区 营业成本 8100 万元', uncertainSegments:[] }
  });
  assert.equal(result.confirmations.length, 1);
  assert.equal(result.confirmations[0].metric, '营业成本');
});
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/report/facts.test.js`
Expected: FAIL because `buildReportFacts` does not exist.

- [ ] **Step 3: Implement fact reconciliation**

Implementation requirements:

```js
const KEY_METRICS = new Set([
  '营业额','营收','营业收入','销售额','营业成本','成本','毛利','毛利率','净利润',
  '出勤率','离职率','人数','期末人数','生产日期','失效日期','库存','销量'
]);

export function buildReportFacts({ visionFacts = [], ocrDocument = {} } = {}) {
  const facts = dedupeFacts(visionFacts);
  const confirmations = [];
  for (const fact of facts) {
    if (!KEY_METRICS.has(fact.metric)) continue;
    const ocrValue = findOcrValueForFact(fact, ocrDocument.text || '');
    if (ocrValue === null) continue;
    if (!equivalentValue(fact.value, ocrValue)) {
      confirmations.push({
        id:`confirm:${fact.id}`,
        scope:fact.scope,
        metric:fact.metric,
        currentValue:fact.value,
        reason:'原图视觉读取与文字识别结果不一致，请核对这个关键数据。',
        sourceText:fact.sourceText
      });
    }
  }
  return { facts, confirmations };
}
```

`findOcrValueForFact` must require the same scope/metric neighborhood before comparing. It must never create a confirmation from punctuation, isolated letters, `al`, `[—`, `可)` or unrelated low-confidence segments.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/report/facts.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report/facts.js tests/report/facts.test.js
git commit -m "feat: reconcile report facts without OCR noise"
```

---

### Task 3: 确定性报表规则覆盖用户截图中的典型错误

**Files:**
- Create: `src/report/rules.js`
- Create: `tests/report/rules.test.js`

**Interfaces:**
- Produces: `inspectReportFacts(facts, { now = new Date() } = {}) -> Array<ReportIssue>`
- `ReportIssue = { id:string, kind:'calculation_error'|'logic_error'|'anomaly', title:string, scope:string, originalValue?:number|string, correctedValue?:number|string, unit?:string, explanation:string, evidence:string[], relatedFactIds:string[], severity:'high'|'medium'|'low' }`

- [ ] **Step 1: Write failing rule tests for the exact target behavior**

```js
test('recomputes gross margin and gives the provable corrected value', () => {
  const issues = inspectReportFacts([
    fact('r','华南大区','营收',9800,'万元'),
    fact('c','华南大区','营业成本',6100,'万元'),
    fact('m','华南大区','毛利率',85,'%')
  ]);
  const issue = issues.find((x) => x.title === '毛利率计算错误');
  assert.equal(issue.kind, 'calculation_error');
  assert.equal(issue.correctedValue, 37.76);
});

test('negative cost is an anomaly to verify, not a fabricated corrected value', () => {
  const [issue] = inspectReportFacts([fact('c','华北大区','营业成本',-1200,'万元')]);
  assert.equal(issue.kind, 'anomaly');
  assert.equal(issue.correctedValue, undefined);
});

test('net profit above revenue is flagged for review without inventing the right profit', () => {
  const issues = inspectReportFacts([
    fact('r','跨境电商部','营收',8900,'万元'),
    fact('p','跨境电商部','净利润',12000,'万元')
  ]);
  const issue = issues.find((x) => x.title === '净利润高于营业收入');
  assert.equal(issue.kind, 'anomaly');
  assert.equal(issue.correctedValue, undefined);
});

test('flags impossible ratio and count values', () => {
  const issues = inspectReportFacts([
    fact('a','市场营销部','出勤率',105,'%'),
    fact('h','客户服务部','期末人数',-15,'人'),
    fact('l','供应链管理部','离职率',-5,'%')
  ]);
  assert.ok(issues.some((x) => x.title === '出勤率超过 100%'));
  assert.ok(issues.some((x) => x.title === '人数出现负数'));
  assert.ok(issues.some((x) => x.title === '离职率出现负数'));
});

test('flags expiration date earlier than production date', () => {
  const issues = inspectReportFacts([
    fact('p','SKU-8803','生产日期','2025-10-10','日期'),
    fact('e','SKU-8803','失效日期','2024-10-10','日期')
  ], { now:new Date('2026-08-10T00:00:00Z') });
  assert.ok(issues.some((x) => x.title === '失效日期早于生产日期'));
});
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/report/rules.test.js`
Expected: FAIL because the rule engine does not exist.

- [ ] **Step 3: Implement deterministic rules**

Implement scoped metric matching so comparisons only occur inside the same `scope`. Required rules for v1:

```js
// margin
expectedMargin = round((revenue - cost) / revenue * 100, 2)
// only if revenue !== 0 and all 3 facts are reliable

// impossible counts
if (metric in ['人数','期末人数','库存','销量'] && value < 0) => logic_error

// ratios
if (metric === '出勤率' && value > 100) => logic_error
if (metric === '离职率' && value < 0) => logic_error

// finance anomaly, not deterministic correction
if (netProfit > revenue) => anomaly
if (cost < 0) => anomaly

// dates
if (expiry < production) => logic_error
```

For any issue that depends on a fact with `confidence < 0.75`, do not emit a final issue here; expose it through the confirmation path in Task 4.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/report/rules.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report/rules.js tests/report/rules.test.js
git commit -m "feat: add deterministic report error rules"
```

---

### Task 4: 合并程序结果、视觉候选和关键确认项

**Files:**
- Create: `src/report/issues.js`
- Create: `tests/report/issues.test.js`

**Interfaces:**
- Produces: `buildReportReview({ facts, deterministicIssues, visionCandidates, confirmations }) -> { issues:Array<ReportIssue>, confirmations:Array<FactConfirmation>, summary:{ issueCount:number, provableCount:number, confirmationCount:number } }`

- [ ] **Step 1: Write failing aggregation tests**

```js
test('downgrades an unproved AI calculation claim to confirmation', () => {
  const review = buildReportReview({
    facts:[], deterministicIssues:[], confirmations:[],
    visionCandidates:[{ title:'总计毛利率错误', scope:'财务汇总行', kind:'calculation_error', explanation:'看起来是直接相加', relatedFactIds:[] }]
  });
  assert.equal(review.issues.length, 0);
  assert.equal(review.confirmations[0].reason.includes('程序无法唯一复算'), true);
});

test('puts proven calculation errors before anomalies and confirmations', () => {
  const review = buildReportReview({
    facts:[], confirmations:[{ id:'q1', scope:'A', metric:'成本', currentValue:1, reason:'冲突', sourceText:'' }],
    deterministicIssues:[
      { id:'a', kind:'anomaly', title:'异常', scope:'A', explanation:'x', evidence:['x'], relatedFactIds:[], severity:'medium' },
      { id:'c', kind:'calculation_error', title:'毛利率计算错误', scope:'A', correctedValue:37.76, explanation:'x', evidence:['x'], relatedFactIds:[], severity:'high' }
    ],
    visionCandidates:[]
  });
  assert.equal(review.issues[0].kind, 'calculation_error');
  assert.equal(review.summary.provableCount, 1);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/report/issues.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement aggregator**

Rules:

```js
priority = calculation_error > logic_error > anomaly;
```

- Deduplicate by normalized `scope + title + relatedFactIds`.
- If a vision candidate says `calculation_error` but no deterministic issue matches it, convert to `FactConfirmation` with reason `视觉分析发现疑点，但程序无法唯一复算出正确值，请核对原表。`.
- If a related fact is in `confirmations`, suppress dependent deterministic issue until that confirmation is resolved.
- Cap visible issues to 30 and confirmations to 12.
- Never carry raw OCR tokens into `issues`.

- [ ] **Step 4: Run GREEN**

Run: `node --test tests/report/issues.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report/issues.js tests/report/issues.test.js
git commit -m "feat: aggregate report issues into owner-readable review"
```

---

### Task 5: 把图片分析 API 改成 OCR + Vision + 规则检查的编排器

**Files:**
- Modify: `api/analyze-file.js`
- Test: `tests/api/analyze-file-report-review.test.js`
- Keep existing: `tests/api/analyze-file-corrections.test.js`

**Interfaces:**
- API adds `reportReview` only for image uploads:

```json
{
  "reportReview": {
    "mode": "vision+ocr|ocr_fallback",
    "issues": [],
    "confirmations": [],
    "summary": {
      "issueCount": 10,
      "provableCount": 4,
      "confirmationCount": 2
    },
    "warning": null
  }
}
```

- [ ] **Step 1: Write failing API test**

```js
test('image analysis returns an owner-facing reportReview instead of raw OCR issues as the main result', async () => {
  const req = makeImageRequest();
  const res = makeResponse();
  await handleAnalyzeFileRequest(req, res, {
    disableBurstGuard:true,
    parseBusinessDocument:async () => ({ workbook:null, document:{ type:'image', text:'...', confidence:0.77, uncertainSegments:[{ text:'al', confidence:0.29, context:'9:21 al 全 可)' }] } }),
    analyzeReportImage:async () => ({
      available:true, provider:'openai', model:'test', warning:null,
      facts:[
        { id:'r', scope:'华南大区', metric:'营收', value:9800, unit:'万元', sourceText:'营收 9800', confidence:0.99, source:'vision' },
        { id:'c', scope:'华南大区', metric:'营业成本', value:6100, unit:'万元', sourceText:'成本 6100', confidence:0.99, source:'vision' },
        { id:'m', scope:'华南大区', metric:'毛利率', value:85, unit:'%', sourceText:'85%', confidence:0.99, source:'vision' }
      ], candidates:[]
    })
  });
  assert.equal(res.body.reportReview.issues[0].title, '毛利率计算错误');
  assert.equal(JSON.stringify(res.body.reportReview).includes('al'), false);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/api/analyze-file-report-review.test.js`
Expected: FAIL because `reportReview` is absent.

- [ ] **Step 3: Make `buildPayload` accept a report review and add image orchestration**

In `handleAnalyzeFileRequest`, after `parseBusinessDocument`:

```js
let reportReview = null;
if (parsed.document?.type === 'image') {
  observeProgress({ phase:'vision', percent:76, message:'正在理解报表结构' });
  const vision = await visionAnalyzer({
    name:file.name,
    buffer,
    mimeType:imageMimeType(extension),
    ocrText:parsed.document.text || ''
  }, deps.vision || {});

  const reconciled = buildReportFacts({ visionFacts:vision.facts, ocrDocument:parsed.document });
  const deterministicIssues = inspectReportFacts(reconciled.facts);
  reportReview = buildReportReview({
    facts:reconciled.facts,
    deterministicIssues,
    visionCandidates:vision.candidates,
    confirmations:reconciled.confirmations
  });
  reportReview.mode = vision.available ? 'vision+ocr' : 'ocr_fallback';
  reportReview.warning = vision.warning;
}
```

For `ocr_fallback`, derive conservative facts only from existing OCR text for explicitly labeled metrics; never claim table-row structure that OCR did not prove.

- [ ] **Step 4: Preserve backward compatibility**

`buildPayload` must still return existing `document`, `audit`, `corrections`, and `summary` fields so current diagnosis/report tests do not break. Add `reportReview` without deleting the existing contract in this release.

- [ ] **Step 5: Run focused and full API tests**

Run:

```bash
node --test tests/api/analyze-file-report-review.test.js tests/api/analyze-file-corrections.test.js tests/api/file.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/analyze-file.js tests/api/analyze-file-report-review.test.js
git commit -m "feat: orchestrate vision and deterministic report checks"
```

---

### Task 6: 手机首屏直接展示“错误清单”，OCR 技术信息降到详情

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `tests/ui/report-error-list.test.js`
- Modify: `tests/ui/merchant-review-ui.test.js`

**Interfaces:**
- Frontend consumes `result.reportReview`.
- Main visible blocks: `report-review-summary`, `report-issues-list`, `report-confirmations`, `report-technical-details`.

- [ ] **Step 1: Write failing UI contract test**

```js
test('mobile image result leads with concrete report errors, not OCR tokens or confidence cards', async () => {
  assert.match(html, /id="report-issues-list"/);
  assert.match(html, /id="report-confirmations"/);
  assert.match(html, /id="report-technical-details"/);
  assert.match(js, /renderReportReview/);
  assert.match(js, /正确结果/);
  assert.match(js, /需要核对/);
  assert.doesNotMatch(html, /图片整体识别质量/);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/ui/report-error-list.test.js`
Expected: FAIL.

- [ ] **Step 3: Replace image-first OCR review with report error rendering**

`renderReportReview(result)` must produce this information hierarchy:

```text
报表检查完成
发现 10 处数据问题，其中 4 处可以确定订正

1. 毛利率计算错误｜华南大区
原数据：85.00%
正确结果：37.76%
原因：营收 9,800 万，成本 6,100 万，重新计算毛利率为 37.76%。
建议：核对并修改报表公式。

2. 营业成本出现负数｜华北大区
原数据：-1,200 万
需要核对：可能是冲销/调整，也可能是填报或公式错误。

有 2 个关键数据需要核对
[具体字段卡片]

▸ 查看识别详情
```

- For `calculation_error`, show `原数据 / 正确结果 / 原因`.
- For `logic_error`, show `原数据 / 问题 / 原因` without a fabricated correction.
- For `anomaly`, label `异常，需要核对` rather than `错误` when there may be a legitimate accounting explanation.
- Never render `document.uncertainSegments` in the main list.
- OCR confidence appears only inside `<details id="report-technical-details">`.

- [ ] **Step 4: Change confirmation behavior**

If `reportReview.confirmations.length === 0`, image data can be committed to diagnosis immediately after the report error list is shown.

If confirmations exist, only those fields block dependent conclusions; provide per-field actions:

```text
当前识别：6,100 万
[确认这个数字] [修改]
```

Do not force the owner to review every OCR fragment before continuing.

- [ ] **Step 5: Run UI tests**

Run:

```bash
node --test tests/ui/report-error-list.test.js tests/ui/merchant-review-ui.test.js tests/ui/ocr-confirmation.test.js
```

Expected: PASS after updating the old OCR test so it asserts that technical OCR details are collapsed instead of being the primary gate.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/app.js public/styles.css tests/ui/report-error-list.test.js tests/ui/merchant-review-ui.test.js tests/ui/ocr-confirmation.test.js
git commit -m "feat: show report errors before OCR details"
```

---

### Task 7: 让后续经营诊断使用已经核验的报表问题，而不是 OCR 噪声

**Files:**
- Modify: `public/app.js`
- Modify: `src/ai/context.js`
- Modify: `src/ai/providers.js`
- Test: `tests/ai/context.test.js`
- Test: `tests/ai/providers.test.js`

**Interfaces:**
- Add evidence prefix `report_issue:` for accepted report review entries.
- Add `report_confirmation:` only for user-confirmed/edited key values.

- [ ] **Step 1: Write failing evidence tests**

```js
test('bounded diagnosis context preserves report issues but not raw OCR uncertainty', () => {
  const bounded = boundDiagnosisContext({
    id:'d1', answers:{}, findings:[], documents:[], dialogue:[],
    evidence:[
      'report_issue:{"title":"毛利率计算错误","scope":"华南大区","correctedValue":37.76}',
      'ocr_token:al'
    ]
  });
  assert.ok(bounded.evidence.some((x) => String(x).startsWith('report_issue:')));
  assert.equal(bounded.evidence.some((x) => String(x).startsWith('ocr_token:')), false);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/ai/context.test.js tests/ai/providers.test.js`
Expected: FAIL on the new evidence filtering/prompt behavior.

- [ ] **Step 3: Record report evidence at commit time**

When an image review is committed, add only bounded issue evidence:

```js
for (const issue of result.reportReview?.issues || []) {
  state.diagnosis.evidence.push(`report_issue:${JSON.stringify({
    kind:issue.kind,
    title:issue.title,
    scope:issue.scope,
    originalValue:issue.originalValue,
    correctedValue:issue.correctedValue,
    explanation:issue.explanation,
    evidence:issue.evidence
  })}`);
}
```

Do not add raw `uncertainSegments` as diagnosis evidence.

- [ ] **Step 4: Update diagnosis prompt**

Add these rules:

```text
report_issue 中 calculation_error/logic_error 是程序根据已识别数据复算或规则验证得到的结构化证据，可以作为直接证据引用。
report_issue 中 anomaly 只能作为待核对异常，不能写成已确认经营事实。
report_confirmation 以老板最终确认值为准。
不要把 OCR 乱码或识别置信度本身当作经营问题。
```

- [ ] **Step 5: Run GREEN**

Run: `node --test tests/ai/context.test.js tests/ai/providers.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/app.js src/ai/context.js src/ai/providers.js tests/ai/context.test.js tests/ai/providers.test.js
git commit -m "feat: feed verified report issues into diagnosis"
```

---

### Task 8: 全量回归、手机契约、生产构建

**Files:**
- Modify only if tests expose a defect.
- Test: all existing tests.

- [ ] **Step 1: Run the complete suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 2: Build the production bundle**

Run: project production build command used by `.github/workflows/test.yml`.
Expected: exit code 0 and `dist` contains updated UI assets.

- [ ] **Step 3: Verify the exact target fixture**

Add one integration fixture representing the visible example and assert at least these outcomes:

```text
华南大区：9800 / 6100 / 毛利率85% -> calculation_error, correctedValue 37.76
华北大区：营业成本 -1200 -> anomaly, no correctedValue
跨境电商部：营收8900 / 净利润12000 -> anomaly, no correctedValue
市场营销部：出勤率105% -> logic_error
客户服务部：期末人数-15 -> logic_error
供应链管理部：离职率-5% -> logic_error
SKU-8803：生产2025-10-10 / 失效2024-10-10 -> logic_error
```

Assert that `al`, `[—`, and `可)` do not appear in `reportReview.issues`.

- [ ] **Step 4: Check GitHub Actions on the feature branch**

Expected: `Run tests` PASS and `Build production bundle` PASS.

- [ ] **Step 5: Open PR with explicit deployment caveat**

PR body must state:

```text
视觉理解依赖 OPENAI_API_KEY；DeepSeek V4 API 为文本模型。
如果生产环境没有 OPENAI_API_KEY，系统会降级到 OCR + 程序规则，页面仍返回错误清单，但复杂表格结构识别能力会降低。
```

- [ ] **Step 6: Merge only after CI passes**

Use squash merge after verifying head SHA has not moved.

---

## Self-review

- Spec coverage: 原图视觉理解、OCR 辅助、结构化事实、确定性复算、逻辑异常、AI 候选降级、关键字段确认、错误清单 UI、后续诊断证据全部有对应任务。
- No placeholders: 无 TBD/TODO；每个任务均给出接口、失败测试、最小实现要求、验证命令和提交点。
- Type consistency: `ReportFact`, `VisionCandidate`, `FactConfirmation`, `ReportIssue`, `reportReview` 在任务间保持同名接口。
- Scope: 不修改原始 Excel，不扩行业模型、不做多页 PDF 审计，符合本轮边界。
