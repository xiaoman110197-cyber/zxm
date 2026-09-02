# AI Customer Consultation Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add “体验 04 · AI 客户咨询助手” to `/experience`, where DeepSeek turns customer messages into a structured consultation analysis and a complete reply draft, while the operator retains the only authority to approve or send any reply.

**Architecture:** Keep consultation analysis separate from spreadsheet/business-QA code. A focused consultation domain module validates input, independently detects missing business facts and high-risk professional questions, and sanitizes model output. The existing DeepSeek provider gains one consultation method; a dedicated API coordinates provider + deterministic guards; a standard connector contract preserves future channel integrations; and a separate browser module owns the Experience 04 UI.

**Tech Stack:** Node.js 20+, native `node:test`, existing Vercel serverless API pattern, browser ES modules, existing `createDeepSeekProvider`, existing `/experience` static UI.

**Spec:** `docs/superpowers/specs/2026-09-02-ai-customer-consultation-assistant-design.md`

## Global Constraints

- AI generates a complete reply answer but never sends autonomously.
- Only an explicit operator approval may permit `sendMessage()`; analysis and regeneration must never trigger sending.
- V1 has no real outbound-send API. Web Adapter records approval but never sends externally.
- Source channel may be `web`, `wecom`, `feishu`, `dingtalk`, `workbuddy`, or `douyin`. An unconnected source may still be selected for manually pasted chat, but it must remain clearly “待接接口” and cannot send.
- AI must not invent price, business hours, availability, inventory, package terms, refund policies, treatment effects, or other business facts not supplied by the merchant.
- Missing price/availability/business-fact detection cannot rely only on the model. The server independently compares the customer question with provided `businessContext` and adds deterministic gaps.
- Medical, aesthetic-medical, dental, TCM, legal, and insurance professional judgments require human/professional handoff.
- Customer messages, business context, channel names, and previous drafts are untrusted data and cannot override system instructions or expose secrets.
- DeepSeek output is validated and sanitized server-side before it reaches the browser.
- V1 does not add a CRM/database.
- Raw consultation text must not be written to ordinary runtime logs.
- PR #25 remains Draft and must not be merged without explicit user approval.

## File Structure

**Create**
- `src/experience/consultation.js` — bounded input normalization, deterministic business-fact gap detection, output schema sanitization, high-risk guard.
- `src/experience/connectors.js` — channel capability registry and Web Adapter standard interface.
- `api/experience-consultation.js` — dedicated POST API.
- `public/experience/consultation.js` — Experience 04 browser logic and operator decision state.
- `tests/experience/consultation.test.js` — domain/risk/no-fabrication tests.
- `tests/experience/connectors.test.js` — connector approval tests.
- `tests/api/experience-consultation.test.js` — API contract/failure/guard tests.

**Modify**
- `src/ai/providers.js` — consultation system prompt + `analyzeExperienceConsultation(input)`.
- `tests/ai/providers-structure.test.js` — provider contract tests.
- `public/experience/index.html` — Experience 04 markup and script include.
- `public/experience/styles.css` — minimal consultation styles.
- `tests/ui/experience.test.js` — UI and no-real-send regression tests.

---

### Task 1: Consultation Domain Contract, Missing-Fact Detection, and Risk Guard

**Files:**
- Create: `src/experience/consultation.js`
- Test: `tests/experience/consultation.test.js`

**Interfaces:**
- `normalizeConsultationInput(body) -> { industry, channel, conversationText, businessContext, regenerateFrom }`
- `detectRequiredBusinessFacts({ conversationText, businessContext }) -> string[]`
- `requiresProfessionalHandoff({ industry, conversationText, raw }) -> boolean`
- `sanitizeConsultationAnalysis(raw, input) -> ConsultationAnalysis`
- Enum exports: `INTENTS`, `STAGES`, `RISK_LEVELS`, `PRIORITIES`, `DUE_HINTS`, `CHANNELS`.

**Exact input limits:**
- `conversationText`: 1–12,000 characters.
- `businessContext`: 0–4,000 characters.
- `regenerateFrom`: 0–2,000 characters.
- Oversized values are rejected with a clear error; do not silently truncate customer context.

- [ ] **Step 1: Write failing domain tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConsultationInput,
  detectRequiredBusinessFacts,
  requiresProfessionalHandoff,
  sanitizeConsultationAnalysis
} from '../../src/experience/consultation.js';

test('rejects empty, unknown-channel and oversized consultation input', () => {
  assert.throws(() => normalizeConsultationInput({ industry:'massage', channel:'web', conversationText:'   ' }), /客户消息/);
  assert.throws(() => normalizeConsultationInput({ industry:'massage', channel:'unknown', conversationText:'你好' }), /渠道/);
  assert.throws(() => normalizeConsultationInput({ industry:'massage', channel:'web', conversationText:'x'.repeat(12001) }), /过长/);
});

test('keeps manually selected unconnected source channel instead of rewriting it to web', () => {
  const input = normalizeConsultationInput({ industry:'massage', channel:'douyin', conversationText:'想预约' });
  assert.equal(input.channel, 'douyin');
});

test('server independently detects missing price and availability facts', () => {
  assert.deepEqual(
    detectRequiredBusinessFacts({ conversationText:'多少钱？周六下午有位置吗？', businessContext:'' }),
    ['价格/收费信息','档期/可预约时间']
  );
  assert.deepEqual(
    detectRequiredBusinessFacts({ conversationText:'多少钱？周六下午有位置吗？', businessContext:'项目A 398元；周六14:00可预约' }),
    []
  );
});

test('sanitizes enums and drops model execution claims', () => {
  const result = sanitizeConsultationAnalysis({
    customerNeed:'想预约', knownFacts:['周六有空'], missingCustomerInfo:[], missingBusinessFacts:[],
    lead:{ intent:'booking', stage:'booking_intent' }, risk:{ level:'none', reason:'' },
    answer:'我已经帮您预约好了',
    nextTask:{ title:'确认时间', priority:'urgent', dueHint:'tomorrow', reason:'客户有意向' },
    appointmentCandidate:{ requested:true, date:null, time:null }, sent:true, bookingConfirmed:true
  }, { industry:'massage', channel:'web', conversationText:'周六有空吗', businessContext:'', regenerateFrom:'' });
  assert.equal(result.nextTask.priority, 'medium');
  assert.equal(result.nextTask.dueHint, 'none');
  assert.equal('sent' in result, false);
  assert.equal('bookingConfirmed' in result, false);
});

test('forces professional handoff for high-risk professional judgment', () => {
  assert.equal(requiresProfessionalHandoff({
    industry:'clinic', conversationText:'我这种情况适不适合做这个治疗？会不会有副作用？', raw:{ risk:{ level:'none' } }
  }), true);
});

test('removes unsupported price or availability claims even when model says no facts are missing', () => {
  const result = sanitizeConsultationAnalysis({
    customerNeed:'问价格和预约', knownFacts:[], missingCustomerInfo:[], missingBusinessFacts:[],
    lead:{ intent:'booking', stage:'booking_intent' }, risk:{ level:'none', reason:'' },
    answer:'现在298元，周六下午有位置。',
    nextTask:{ title:'确认项目', priority:'medium', dueHint:'within_24h', reason:'确认需求' },
    appointmentCandidate:{ requested:true, date:null, time:null }
  }, { industry:'massage', channel:'web', conversationText:'多少钱？周六下午有位置吗？', businessContext:'', regenerateFrom:'' });
  assert.deepEqual(result.missingBusinessFacts, ['价格/收费信息','档期/可预约时间']);
  assert.doesNotMatch(result.answer, /298/);
  assert.match(result.answer, /确认|价格|档期|时间/);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/experience/consultation.test.js
```

Expected: FAIL because `src/experience/consultation.js` does not exist.

- [ ] **Step 3: Implement bounded input and enums**

```js
export const CHANNELS = new Set(['web','wecom','feishu','dingtalk','workbuddy','douyin']);
export const INTENTS = new Set(['price','booking','service_fit','followup','aftersales','complaint','other']);
export const STAGES = new Set(['new_inquiry','qualified','booking_intent','followup','aftersales']);
export const RISK_LEVELS = new Set(['none','human_review','required_professional_handoff']);
export const PRIORITIES = new Set(['low','medium','high']);
export const DUE_HINTS = new Set(['today','within_24h','before_appointment','none']);
```

`normalizeConsultationInput()` trims but does not silently truncate. Unknown industry may normalize to `other`; unknown channel is rejected.

- [ ] **Step 4: Implement deterministic business-fact gaps**

Use conservative patterns:

```js
const PRICE_QUESTION = /(多少钱|价格|收费|费用|价位|优惠)/i;
const PRICE_EVIDENCE = /(¥|￥|元|价格|收费|费用|价位|优惠)\s*[:：]?\s*\d|\d+(?:\.\d+)?\s*(?:元|块)/i;
const AVAILABILITY_QUESTION = /(有位置|有空|档期|能约|预约.*时间|周[一二三四五六日天]|几点)/i;
const AVAILABILITY_EVIDENCE = /(可预约|有空|有档期|满约|已满|\d{1,2}[:：]\d{2}|周[一二三四五六日天])/i;
```

If the customer asks for a category and evidence is absent from `businessContext`, append the canonical missing fact. Merge these server-derived gaps with the model’s sanitized `missingBusinessFacts` and deduplicate.

- [ ] **Step 5: Implement professional handoff guard and safe answer replacement**

```js
const HIGH_RISK_INDUSTRIES = new Set(['clinic','medical_aesthetic','dental','tcm','legal','insurance']);
const PROFESSIONAL_JUDGMENT_PATTERN = /(适不适合|能不能做|诊断|治疗方案|用药|副作用|疗效|治好|胜诉|法律责任|违法吗|怎么判|能不能赔|理赔结论|核保|承保)/i;
```

For forced handoff, return:

```js
risk:{ level:'required_professional_handoff', reason:'客户问题涉及需要专业人员判断的内容。' }
answer:'这个问题涉及专业判断，我可以先帮您整理需求和必要信息，并安排专业人员确认后再回复您。'
```

If deterministic business gaps include price or availability, do not attempt token-level redaction. Replace any model answer that asserts unsupported money/availability with one complete safe reply that says those facts must first be confirmed.

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/experience/consultation.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/experience/consultation.js tests/experience/consultation.test.js
git commit -m "feat: add consultation analysis guard"
```

---

### Task 2: DeepSeek Consultation Provider Mode

**Files:**
- Modify: `src/ai/providers.js`
- Modify: `tests/ai/providers-structure.test.js`

**Interface:**
- `createDeepSeekProvider(...).analyzeExperienceConsultation(input) -> Promise<object>`.

- [ ] **Step 1: Add failing provider test**

Use the existing mocked `fetchImpl` style and assert the consultation system prompt contains all of these rules:

```js
assert.match(systemPrompt, /完整.*回复|完整回复/);
assert.match(systemPrompt, /不能自行发送|没有发送权/);
assert.match(systemPrompt, /不得编造.*价格|价格.*不得编造/);
assert.match(systemPrompt, /档期|可预约/);
assert.match(systemPrompt, /专业人员|人工接手/);
assert.match(systemPrompt, /不可信业务输入/);
assert.match(systemPrompt, /customerNeed/);
assert.match(systemPrompt, /appointmentCandidate/);
assert.doesNotMatch(systemPrompt, /"sent"|bookingConfirmed/);
assert.equal(requestBody.thinking?.type, 'disabled');
assert.equal(requestBody.response_format.type, 'json_object');
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/ai/providers-structure.test.js
```

Expected: FAIL because the consultation provider method is absent.

- [ ] **Step 3: Add `EXPERIENCE_CONSULTATION_SYSTEM_PROMPT`**

The prompt must require JSON with only:

```json
{
  "customerNeed":"",
  "knownFacts":[],
  "missingCustomerInfo":[],
  "missingBusinessFacts":[],
  "lead":{"intent":"other","stage":"new_inquiry"},
  "risk":{"level":"none","reason":""},
  "answer":"",
  "nextTask":{"title":"","priority":"medium","dueHint":"none","reason":""},
  "appointmentCandidate":{"requested":false,"date":null,"time":null}
}
```

It must explicitly forbid claiming that a message was sent, a booking/payment was completed, or a price/availability fact exists unless provided in `businessContext`.

- [ ] **Step 4: Add the provider method**

```js
analyzeExperienceConsultation(input) {
  return request([
    { role:'system', content:EXPERIENCE_CONSULTATION_SYSTEM_PROMPT },
    { role:'user', content:JSON.stringify(input) }
  ], { thinking:{ type:'disabled' } });
}
```

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test tests/ai/providers-structure.test.js
git add src/ai/providers.js tests/ai/providers-structure.test.js
git commit -m "feat: add DeepSeek consultation mode"
```

---

### Task 3: Standard Connector Contract and Web Adapter

**Files:**
- Create: `src/experience/connectors.js`
- Test: `tests/experience/connectors.test.js`

**Interfaces:**
- `CHANNEL_CAPABILITIES`
- `createWebAdapter() -> { connect, getStatus, receiveMessage, getConversation, normalizeConversation, sendMessage, createTask }`

- [ ] **Step 1: Add failing connector tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebAdapter, CHANNEL_CAPABILITIES } from '../../src/experience/connectors.js';

test('web adapter exposes the standard interface', () => {
  const adapter = createWebAdapter();
  for (const name of ['connect','getStatus','receiveMessage','getConversation','normalizeConversation','sendMessage','createTask']) {
    assert.equal(typeof adapter[name], 'function');
  }
});

test('send requires explicit operator approval', async () => {
  const adapter = createWebAdapter();
  await assert.rejects(() => adapter.sendMessage({ conversationId:'c1', approvedReply:'你好', approval:null }), /人工确认|approval/);
});

test('web approval never claims external sending', async () => {
  const result = await createWebAdapter().sendMessage({
    conversationId:'c1', approvedReply:'你好', approval:{ approved:true, actor:'operator' }
  });
  assert.equal(result.status, 'not_connected');
  assert.equal(result.sentExternally, false);
});

test('channel registry preserves unconnected sources', () => {
  assert.equal(CHANNEL_CAPABILITIES.web.enabled, true);
  assert.equal(CHANNEL_CAPABILITIES.douyin.enabled, false);
  assert.equal(CHANNEL_CAPABILITIES.wecom.canSendExternally, false);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/experience/connectors.test.js
```

- [ ] **Step 3: Implement capability registry**

```js
export const CHANNEL_CAPABILITIES = Object.freeze({
  web:{ label:'Web', enabled:true, canSendExternally:false },
  wecom:{ label:'企业微信', enabled:false, canSendExternally:false },
  feishu:{ label:'飞书', enabled:false, canSendExternally:false },
  dingtalk:{ label:'钉钉', enabled:false, canSendExternally:false },
  workbuddy:{ label:'WorkBuddy', enabled:false, canSendExternally:false },
  douyin:{ label:'抖音', enabled:false, canSendExternally:false }
});
```

Only Web has an adapter implementation in V1. The other entries are capability metadata, not fake connectors.

- [ ] **Step 4: Implement Web Adapter**

`sendMessage()` must throw without `approval.approved === true`. With approval it returns:

```js
{ status:'not_connected', approved:true, sentExternally:false }
```

`createTask()` in V1 may normalize and return a task object in-memory; it must not claim database persistence.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test tests/experience/connectors.test.js
git add src/experience/connectors.js tests/experience/connectors.test.js
git commit -m "feat: add consultation connector contract"
```

---

### Task 4: Dedicated Consultation API

**Files:**
- Create: `api/experience-consultation.js`
- Test: `tests/api/experience-consultation.test.js`

**Interface:**
- `handleExperienceConsultationRequest(req, res, deps={})`
- Default export delegates to that handler.

Successful response:

```js
{
  requestId,
  modelUsed:true,
  provider:'DeepSeek',
  model:'deepseek-v4-flash',
  analysis:{ /* sanitized only */ },
  connector:{ channel:'douyin', enabled:false, canSendExternally:false }
}
```

The channel above is an example showing that a manually selected unconnected source stays `douyin`; it must not be rewritten to `web`.

- [ ] **Step 1: Add failing API tests**

Test these cases with dependency injection:

```js
provider:{ name:'deepseek', model:'test-model', analyzeExperienceConsultation: async () => raw }
```

Cases:
1. normal consultation returns a complete sanitized `answer`;
2. manually selected `douyin` remains the response source but has `enabled:false` and `canSendExternally:false`;
3. malicious model price “298元” is removed when customer asks price and `businessContext` has no price fact;
4. malicious model availability claim is removed when no availability fact is supplied;
5. `clinic` suitability question forces `required_professional_handoff` even if model returns `risk:none`;
6. model execution fields such as `sent` or `bookingConfirmed` never survive sanitization;
7. DeepSeek failure returns 503 and no fake reply;
8. non-POST, empty text, unknown channel, and over-limit input return bounded safe errors.

- [ ] **Step 2: Run RED**

```bash
node --test tests/api/experience-consultation.test.js
```

- [ ] **Step 3: Implement runtime provider + handler**

```js
function runtimeProvider(deps) {
  if (deps.provider?.analyzeExperienceConsultation) return deps.provider;
  const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey) return null;
  return createDeepSeekProvider({ apiKey, timeoutMs:12000, maxOutputTokens:1600 });
}
```

Handler sequence:
1. generate/request `requestId`;
2. method check;
3. `normalizeConsultationInput(req.body)`;
4. get provider;
5. call `analyzeExperienceConsultation(input)`;
6. call `sanitizeConsultationAnalysis(raw, input)`;
7. look up `CHANNEL_CAPABILITIES[input.channel]`;
8. return safe response.

Do not log `conversationText`, `businessContext`, `regenerateFrom`, or model answer text.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/api/experience-consultation.test.js
```

- [ ] **Step 5: Run the focused consultation backend suite**

```bash
node --test tests/experience/consultation.test.js tests/experience/connectors.test.js tests/ai/providers-structure.test.js tests/api/experience-consultation.test.js
```

Expected: zero failures.

- [ ] **Step 6: Commit**

```bash
git add api/experience-consultation.js tests/api/experience-consultation.test.js
git commit -m "feat: add consultation experience API"
```

---

### Task 5: Experience 04 Browser UI and Operator Decision Flow

**Files:**
- Create: `public/experience/consultation.js`
- Modify: `public/experience/index.html`
- Modify: `public/experience/styles.css`
- Modify: `tests/ui/experience.test.js`

**Interfaces:**
- Browser calls only `POST /api/experience-consultation` for analysis/regeneration.
- Source channel selector can identify `web/wecom/feishu/dingtalk/workbuddy/douyin`; disabled channels remain visibly “待接接口”.
- No real-send endpoint exists in browser code.
- Operator actions: edit, regenerate, hold, approve.

- [ ] **Step 1: Add failing UI tests**

At the top of `tests/ui/experience.test.js` load:

```js
const consultation = await readFile(new URL('../../public/experience/consultation.js', import.meta.url), 'utf8');
```

Add assertions:

```js
assert.match(html, /体验 04/);
assert.match(html, /AI 客户咨询助手/);
assert.match(html, /id="consultationIndustry"/);
assert.match(html, /id="consultationChannel"/);
assert.match(html, /id="consultationConversation"/);
assert.match(html, /id="consultationBusinessContext"/);
assert.match(html, /id="consultationAnalyze"/);
assert.match(html, /id="consultationReply"/);
assert.match(html + consultation, /企业微信.*待接|待接接口/);
assert.match(html + consultation, /抖音.*待接|待接接口/);
assert.match(consultation, /\/api\/experience-consultation/);
assert.match(consultation, /重新生成/);
assert.match(consultation, /暂不回复/);
assert.match(consultation, /已批准.*没有对客户发送|未连接外部渠道/);
assert.doesNotMatch(consultation, /\/api\/[^'"\s]*send/i);
assert.match(html + consultation, /操作人员.*最终|最终发送决定权/);
assert.doesNotThrow(() => new Function(consultation));
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/ui/experience.test.js
```

- [ ] **Step 3: Add Experience 04 markup**

Add after the existing boss section:

```html
<section class="section" id="consultation">
  <div class="wrap">
    <span class="eyebrow">体验 04</span>
    <h2>AI 客户咨询助手</h2>
    <p class="lead">AI 先把回复写完整，操作人员决定改不改、发不发。体验版不会向外部渠道发送消息。</p>
    <!-- existing panel/two-col classes are reused for inputs and results -->
  </div>
</section>
```

Required controls/regions:
- `consultationIndustry`
- `consultationChannel`
- `consultationConversation`
- `consultationBusinessContext`
- `consultationAnalyze`
- `consultationNeed`
- `consultationKnown`
- `consultationMissingCustomer`
- `consultationMissingBusiness`
- `consultationStage`
- `consultationRisk`
- `consultationReply` editable textarea
- `consultationTask`
- `consultationEdit`
- `consultationRegenerate`
- `consultationHold`
- `consultationApprove`
- `consultationDecision`
- `consultationTrace`

Load `/experience/consultation.js` as its own module. Do not reconnect the legacy boss diagnosis page.

- [ ] **Step 4: Implement focused browser state**

```js
const consultationState = {
  lastRequest:null,
  analysis:null,
  editedReply:'',
  decision:'pending',
  connector:null
};
```

Analysis/regeneration request body:

```js
{
  industry:document.getElementById('consultationIndustry').value,
  channel:document.getElementById('consultationChannel').value,
  conversationText:document.getElementById('consultationConversation').value,
  businessContext:document.getElementById('consultationBusinessContext').value,
  regenerateFrom:isRegenerate ? consultationState.editedReply : ''
}
```

Do not hardcode `channel:'web'`.

Render sanitized response fields and provider/model/request ID. If selected source is unconnected, show “来源已标记为抖音/企微等；接口待接，本次只分析、不外发”.

- [ ] **Step 5: Implement operator actions without a send API**

```text
编辑答案      -> focus editable textarea only
重新生成      -> calls consultation analysis API with regenerateFrom; never sends
暂不回复      -> decision='held'
确认采用      -> decision='approved'; display “已批准；当前体验版没有对客户发送消息”
```

The approve button must not call `fetch()`.

For `required_professional_handoff`, keep an obvious warning visible even if the operator edits the reply.

- [ ] **Step 6: Add minimal CSS**

Reuse existing styles; add only:

```css
.consultation-list{margin:.5rem 0 0;padding-left:1.1rem}
.consultation-reply{min-height:9rem;width:100%}
.consultation-actions{display:flex;flex-wrap:wrap;gap:.65rem}
.consultation-risk[hidden]{display:none}
```

No fixed desktop width.

- [ ] **Step 7: Run GREEN and commit**

```bash
node --test tests/ui/experience.test.js
git add public/experience/index.html public/experience/consultation.js public/experience/styles.css tests/ui/experience.test.js
git commit -m "feat: add AI consultation experience UI"
```

---

### Task 6: Full Regression, Production Build, and Draft PR Verification

**Files:**
- Modify only if verification exposes a real regression.
- Update PR #25 description after successful verification; never merge in this task.

- [ ] **Step 1: Run the full repository suite**

```bash
npm test
```

Expected: zero failures.

- [ ] **Step 2: Run production build**

```bash
npm run build
```

Expected: exit code 0 and the static-copy build includes `dist/experience/consultation.js`.

- [ ] **Step 3: Verify no accidental outbound API or raw-chat logging**

```bash
grep -R "experience-consultation.*send\|/api/[^[:space:]'\"]*send\|console\.log.*conversationText\|console\.log.*businessContext\|console\.log.*regenerateFrom" -n api src public/experience || true
```

Expected: no real outbound endpoint/browser send call and no raw consultation payload logging. The server-side Web Adapter method name `sendMessage` is allowed only inside the tested connector contract.

- [ ] **Step 4: Verify the standalone page remains standalone**

```bash
grep -R "老板经营问诊器\|真实经营问诊器\|完整经营问诊" -n public/experience || true
```

Expected: no matches.

- [ ] **Step 5: Verify Draft PR state and fresh GitHub Actions**

PR #25 must remain open, Draft, unmerged, on head `codex/add-experience-v6`. Confirm the final-head GitHub Actions job has both `Run tests` and `Build production bundle` success.

- [ ] **Step 6: Check Vercel separately from code correctness**

If Vercel still reports Hobby `build-rate-limit`, record it as a hosting quota block and do not claim the Preview contains Experience 04. If quota has recovered, wait for a fresh Preview, open `/experience/`, and verify Experience 04 loads before saying it is deployed.

- [ ] **Step 7: Update PR description only**

Document Experience 04 behavior, no-real-send boundary, connector statuses, deterministic no-fabrication guard, high-risk handoff, full test result, build result, and Vercel status. Keep PR Draft and do not merge.
