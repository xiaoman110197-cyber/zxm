# Stable File Analysis Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile file-analysis SSE dependency with a simpler ordinary POST/JSON request while preserving the existing Qianfan OCR → DeepSeek structuring → deterministic review pipeline and its safety guarantees.

**Architecture:** Keep the existing server-side report-analysis orchestration and non-streaming JSON response path. Change the browser to submit `/api/analyze-file` without `?stream=1`, wait for a single JSON response, and classify browser transport failures separately from HTTP/API failures. Keep SSE server helpers temporarily for compatibility, but remove the frontend dependency on them. Do not add task queues, persistence, databases, WebSockets, new AI providers, or changes to the nine reference-report rules.

**Tech Stack:** Node.js >=20.16.0, browser JavaScript, Vercel Serverless Functions, existing Node test runner (`node --test`), existing Qianfan/DeepSeek adapters, existing Tesseract fallback.

## Global Constraints

- Keep `QIANFAN_API_KEY` and `DEEPSEEK_API_KEY` server-side; never expose API keys, Authorization headers, or raw provider error bodies.
- Preserve `cloud_ocr_deepseek`, `local_ocr_degraded`, and `ocr_unavailable` semantics.
- Preserve deterministic-program authority over any proven `correctedValue`.
- Preserve all nine reference-report expected outcomes and the rule that non-program/non-calculation issues cannot invent a `correctedValue`.
- OpenAI must not re-enter the runtime path.
- The first phase only guarantees analysis while the current page remains open; it does not promise background/lock-screen continuation.
- Do not add a database, queue, task persistence, WebSocket, or new AI provider.
- Do not claim SSE is the proven root cause; the change is a complexity-reduction and diagnostic-isolation step.
- Real Preview verification with the same reference screenshot remains a merge gate.

---

## File Structure

**Modified files**

- `public/app.js` — browser request transport, phase copy, cancellation/retry behavior, and transport-vs-HTTP error classification.
- `tests/ui/flow.test.js` — static contract tests proving the browser no longer depends on SSE and still preserves cancellation/retry behavior.
- `tests/api/deepseek-ocr-pipeline.test.js` — explicit non-streaming API integration regression for the full report pipeline and degraded failure codes.
- `README.md` — short runtime note that file analysis now uses ordinary request/response transport and requires the page to remain open during analysis.

**Intentionally unchanged in this phase**

- `src/report/qianfan-ocr.js`
- `src/report/structure.js`
- `src/report/facts.js`
- `src/report/issues.js`
- deterministic report rules and reference-case expectations
- runtime provider selection

---

### Task 1: Lock the Browser Transport Contract with Failing Tests

**Files:**
- Modify: `tests/ui/flow.test.js`
- Reads: `public/app.js`

**Interfaces:**
- Consumes: current browser source text from `public/app.js`.
- Produces: regression assertions requiring ordinary `/api/analyze-file` POST, no `?stream=1` dependency, no `response.body.getReader()` dependency for file analysis, explicit keep-page-open copy, and a stable browser transport failure code/message.

- [ ] **Step 1: Add failing static contract tests**

Append tests equivalent to the following to `tests/ui/flow.test.js`:

```js
test('file analysis uses ordinary JSON POST instead of SSE streaming', () => {
  assert.match(js, /fetch\(['"]\/api\/analyze-file['"]/);
  assert.doesNotMatch(js, /\/api\/analyze-file\?stream=1/);

  const start = js.indexOf('async function analyzeBusinessFile');
  const end = js.indexOf('\nfunction ', start + 10);
  const functionText = js.slice(start, end > start ? end : undefined);
  assert.doesNotMatch(functionText, /getReader\(/);
});

test('file analysis copy tells mobile users to keep the page open', () => {
  assert.match(js, /正在分析报表，请保持页面打开/);
});

test('browser-level file transport failures have a stable safe classification', () => {
  assert.match(js, /FILE_TRANSPORT_FAILED/);
  assert.match(js, /分析请求没有正常连接到服务器/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test tests/ui/flow.test.js
```

Expected: FAIL because the current frontend still contains `/api/analyze-file?stream=1`, still reads the SSE stream, and does not yet contain the new transport classification/copy.

- [ ] **Step 3: Commit the RED test only if the team workflow keeps test-first commits**

If committing RED tests is part of the existing branch workflow:

```bash
git add tests/ui/flow.test.js
git commit -m "test: require stable file analysis transport"
```

Otherwise leave the failing test staged/uncommitted and continue directly to Task 2.

---

### Task 2: Replace Frontend SSE with Ordinary POST/JSON

**Files:**
- Modify: `public/app.js` around `postFileAnalysisStream`, `analyzeBusinessFile`, and file-analysis error handling.
- Test: `tests/ui/flow.test.js`

**Interfaces:**
- Consumes: `{ file:{ name, contentBase64 } }`, optional `AbortSignal`.
- Produces: `postFileAnalysis(file, contentBase64, { signal }) -> Promise<analysisResult>`.
- Error contract: thrown errors may carry `status`, `requestId`, and `code`; browser transport failures use `code='FILE_TRANSPORT_FAILED'` and must not contain provider secrets.

- [ ] **Step 1: Replace the stream transport helper with a JSON helper**

In `public/app.js`, replace the file-analysis network helper with this behavior:

```js
async function postFileAnalysis(file, contentBase64, { signal } = {}) {
  let response;
  try {
    response = await fetch('/api/analyze-file', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ file:{ name:file.name, contentBase64 } }),
      signal
    });
  } catch (cause) {
    if (signal?.aborted || cause?.name === 'AbortError') throw cause;
    const error = new Error('分析请求没有正常连接到服务器。请保持页面打开并重试。');
    error.code = 'FILE_TRANSPORT_FAILED';
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `文件分析请求失败 (${response.status})`);
    error.requestId = data.requestId || '';
    error.status = response.status;
    throw error;
  }
  return data;
}
```

Do not catch and rewrite `AbortError`; cancellation must remain distinguishable from transport failure.

- [ ] **Step 2: Remove the frontend call to `postFileAnalysisStream`**

Inside `analyzeBusinessFile`, after Base64 conversion:

```js
setFileProgress(8, '正在上传资料');
setFileProgress(15, '正在分析报表，请保持页面打开');
const result = await postFileAnalysis(transportFile, contentBase64, { signal:controller.signal });
```

Do not fabricate server percentages while waiting. It is acceptable for the displayed percentage to remain at a coarse local stage until the final result arrives.

- [ ] **Step 3: Simplify browser-side background retry semantics**

Keep user-initiated retry and `AbortController`, but remove any logic whose only purpose is reconstructing a broken SSE stream. The first-phase contract is:

```text
page stays open -> request may finish
page/OS interrupts request -> show retry path
```

Do not introduce hidden automatic multiple retries. At most keep the existing one-shot user-facing retry button.

- [ ] **Step 4: Classify errors in `analyzeBusinessFile`**

Use logic equivalent to:

```js
if (cancelled) {
  baseMessage = '已取消分析。';
} else if (error.code === 'FILE_TRANSPORT_FAILED') {
  baseMessage = `${error.message}（错误类型：FILE_TRANSPORT_FAILED）`;
} else if (error.status === 429) {
  baseMessage = errorWithRequestId('文件分析请求较频繁，请稍后再试。', error.requestId);
} else {
  baseMessage = errorWithRequestId(`文件分析失败：${error.message}`, error.requestId);
}
```

Requirements:
- browser transport failures must not pretend to be Qianfan/DeepSeek failures;
- HTTP errors should preserve `requestId` when supplied;
- cancellation should never show `FILE_TRANSPORT_FAILED`.

- [ ] **Step 5: Run focused UI tests and verify GREEN**

Run:

```bash
node --test tests/ui/flow.test.js tests/ui/report-recognition-state.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/app.js tests/ui/flow.test.js
git commit -m "fix: use stable file analysis request transport"
```

---

### Task 3: Lock the Non-Streaming API Pipeline with Integration Tests

**Files:**
- Modify: `tests/api/deepseek-ocr-pipeline.test.js`
- Reads: `api/analyze-file.js`

**Interfaces:**
- Consumes: ordinary request object with no `query.stream` flag.
- Produces: HTTP 200 JSON payload with `reportReview`, `reportFacts`, safe `failureCode`, and `requestId` where applicable.

- [ ] **Step 1: Add an explicit normal-POST cloud-success test**

Add a test using the existing `reqFor()`, parser stubs, cloud OCR stub, and structure stub, with no `query:{ stream:'1' }` field. Assert:

```js
assert.equal(res.statusCode, 200);
assert.equal(res.body.reportReview.summary.recognitionMode, 'cloud_ocr_deepseek');
assert.equal(res.body.reportReview.summary.completeReview, true);
assert.equal(typeof res.body.requestId, 'string');
assert.ok(res.body.reportReview.issues.some((item) => item.title === '毛利率计算错误'));
```

- [ ] **Step 2: Add an explicit normal-POST degraded test preserving provider failure code**

Stub Qianfan OCR with:

```js
{
  available:false,
  provider:null,
  model:null,
  text:'',
  failureCode:'OCR_HTTP_429',
  warning:'云端识别失败'
}
```

Use local OCR text and a structure stub, then assert:

```js
assert.equal(res.statusCode, 200);
assert.equal(res.body.reportReview.summary.recognitionMode, 'local_ocr_degraded');
assert.equal(res.body.reportReview.summary.completeReview, false);
assert.equal(res.body.reportReview.summary.failureCode, 'OCR_HTTP_429');
assert.match(res.body.reportReview.summary.reviewWarning, /OCR_HTTP_429/);
```

- [ ] **Step 3: Add an explicit normal-POST structuring-failure test**

Make `reportStructurer` throw and assert:

```js
assert.equal(res.statusCode, 200);
assert.equal(res.body.reportReview.summary.failureCode, 'REPORT_STRUCTURE_FAILED');
assert.equal(res.body.reportReview.summary.completeReview, false);
```

- [ ] **Step 4: Run the focused API tests**

Run:

```bash
node --test tests/api/deepseek-ocr-pipeline.test.js tests/api/analyze-file-report-review.test.js tests/report/qianfan-ocr.test.js
```

Expected: PASS. If these tests fail after the frontend transport change, stop and investigate the server non-streaming path rather than adding compatibility hacks.

- [ ] **Step 5: Commit**

```bash
git add tests/api/deepseek-ocr-pipeline.test.js
git commit -m "test: verify non-streaming report analysis pipeline"
```

---

### Task 4: Remove Dead Frontend SSE Parsing Only After the New Path Is Green

**Files:**
- Modify: `public/app.js`
- Test: `tests/ui/flow.test.js`

**Interfaces:**
- Consumes: no new runtime interface.
- Produces: browser bundle with no file-analysis dependency on `parseSseBlock`, `handleAnalysisStreamEvent`, `readAnalysisStream`, or `postFileAnalysisStream`.

- [ ] **Step 1: Verify no remaining frontend references**

Search locally:

```bash
grep -nE "parseSseBlock|handleAnalysisStreamEvent|readAnalysisStream|postFileAnalysisStream|analyze-file\\?stream=1" public/app.js
```

Expected before cleanup: definitions may remain, but there should be no call from `analyzeBusinessFile` to `postFileAnalysisStream`.

- [ ] **Step 2: Delete the now-unused frontend SSE helpers**

Remove only these dead browser helpers if they have no remaining callers:

```text
parseSseBlock
handleAnalysisStreamEvent
readAnalysisStream
postFileAnalysisStream
```

Do not remove server-side stream support in this task; the spec intentionally keeps it temporarily to limit scope.

- [ ] **Step 3: Strengthen the static regression test**

Add/assert:

```js
test('browser bundle no longer contains file-analysis SSE parser helpers', () => {
  assert.doesNotMatch(js, /function parseSseBlock/);
  assert.doesNotMatch(js, /function readAnalysisStream/);
  assert.doesNotMatch(js, /postFileAnalysisStream/);
});
```

- [ ] **Step 4: Run UI tests**

Run:

```bash
node --test tests/ui/flow.test.js tests/ui/report-recognition-state.test.js tests/ui/merchant-review-ui.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/app.js tests/ui/flow.test.js
git commit -m "refactor: remove unused browser SSE parser"
```

---

### Task 5: Document the First-Phase Runtime Contract

**Files:**
- Modify: `README.md`
- Test: existing runtime/static tests only

**Interfaces:**
- Consumes: implemented browser transport behavior.
- Produces: operator/user documentation that matches the actual first-phase guarantee.

- [ ] **Step 1: Add a concise runtime note to README**

Add wording equivalent to:

```md
## 移动端资料分析

当前资料分析采用普通请求/响应模式，优先保证页面保持打开时的稳定性。分析期间请保持当前页面打开；切到后台、锁屏或关闭页面后，移动浏览器可能中断请求，此版本不会承诺后台继续执行。失败后可直接重新分析。

报表识别业务链路仍为：千帆 DeepSeek-OCR → DeepSeek 结构化 → 程序复算 → 老板确认。传输层失败与 OCR/模型失败分开显示，不能把浏览器 `Load failed` 误判成千帆计费或模型故障。
```

- [ ] **Step 2: Run the deepseek-only static guard**

Run:

```bash
node --test tests/api/deepseek-only-runtime.test.js
```

Expected: PASS; the README change must not reintroduce forbidden OpenAI runtime strings.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe stable mobile analysis contract"
```

---

### Task 6: Full Verification and Preview Merge Gate

**Files:**
- No production file changes expected unless verification exposes a root cause.
- Verify: entire repository and Vercel Preview.

**Interfaces:**
- Consumes: completed Tasks 1–5.
- Produces: evidence that the codebase is green and one real mobile Preview test result; does not produce a merge unless the real acceptance gate passes.

- [ ] **Step 1: Run the complete test suite**

Run:

```bash
npm test
```

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run the production build**

Run:

```bash
npm run build
```

Expected: exit code 0 and `dist/` generated from `public/`.

- [ ] **Step 3: Verify the reference-case deterministic contract**

Run:

```bash
node --test tests/report/reference-case.test.js
```

Expected: PASS for all nine expected outcomes, including `37.76%` as the program-proven correction and no fabricated corrected values for the other non-provable cases.

- [ ] **Step 4: Verify the deployed branch commit and Vercel Preview are green**

Check GitHub/Vercel status for the current `feature/deepseek-ocr-pipeline` head. Do not test an older Preview deployment.

Expected: build/deployment status `success` / `Ready`.

- [ ] **Step 5: Real same-image mobile Preview acceptance**

On `zhenduan-v03-preview`, with the page kept open in the foreground:

1. Upload the same `IMG_0511.png` reference screenshot.
2. Confirm the UI uses coarse stages such as `正在上传资料` / `正在分析报表，请保持页面打开`, not SSE-derived precision updates.
3. If the browser cannot obtain any HTTP response, confirm the UI shows `FILE_TRANSPORT_FAILED` rather than an OCR/provider error.
4. If the server returns a degraded OCR result, record `reportReview.summary.failureCode` (for example `OCR_HTTP_401`, `OCR_HTTP_429`, `OCR_TIMEOUT`) and do not infer billing from the code unless the provider semantics support it.
5. If cloud OCR succeeds, require `recognitionMode='cloud_ocr_deepseek'` and `completeReview=true`.
6. Compare the visible result against all nine reference outcomes.

- [ ] **Step 6: Apply the merge decision rule**

```text
CI/build green + real Preview same-image acceptance green -> PR #17 may proceed toward merge review.
CI/build green but real Preview fails -> do not merge; capture the new exact failure evidence and return to root-cause investigation.
```

- [ ] **Step 7: Final verification commit only if documentation/checklist state changes**

If the implementation plan or PR acceptance checklist is updated with factual verification results, commit only those factual updates. Do not write “working” or “fixed” unless the real Preview evidence supports it.
