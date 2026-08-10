# Progress, Resilience and Audit Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give long-running file analysis truthful progress, make mobile interruptions recoverable, implement real AI provider failover, and close the highest-risk reliability/security gaps found in the full-program audit.

**Architecture:** Preserve the current JSON APIs while adding streaming mode to `/api/analyze-file`. Move progress reporting into the existing parser through an optional callback; harden AI providers with bounded inputs, timeouts and fallback routing; keep mobile continuity local and privacy-preserving.

**Tech Stack:** Node.js >=20.16, Vercel Functions, browser Fetch streams, Tesseract.js 7, node:test, localStorage.

## Global Constraints
- Do not persist original file bytes or extracted document text in localStorage.
- Do not expose upstream provider error bodies or stack traces to the browser.
- Do not invent a precise percentage where the parser does not expose precise progress; use stage milestones.
- Tesseract OCR progress must use its logger callback for the recognition interval.
- Existing `/api/analyze-file` JSON behavior remains compatible.
- Vercel merge gate remains: tests + production build + both Vercel Preview checks.

---

### Task 1: Stream file-analysis progress

**Files:**
- Modify: `src/documents/parse.js`
- Modify: `api/analyze-file.js`
- Modify: `tests/documents/parse.test.js`
- Modify: `tests/api/analyze-file.test.js`

**Interfaces:**
- `parseBusinessDocument(input, deps)` consumes optional `deps.onProgress(event)`.
- `/api/analyze-file?stream=1` emits SSE `progress`, `result`, or `error` events.

- [ ] Add a failing parser test that injects an OCR implementation reporting two progress events and asserts ordered progress callbacks.
- [ ] Add a failing API test with a streaming mock response and assert at least one `progress` event appears before `result`.
- [ ] Run focused tests and confirm RED.
- [ ] Add a small `emitProgress` helper in `src/documents/parse.js`; emit stage milestones for spreadsheet/PDF/DOCX and map Tesseract logger progress into OCR milestones.
- [ ] Add stream response helpers in `api/analyze-file.js`, preserving the old JSON branch.
- [ ] Run focused and full tests; confirm GREEN.

### Task 2: Mobile progress UI, cancel and retry

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/ui/flow.test.js`

**Interfaces:**
- `analyzeBusinessFile(file)` reads SSE using `response.body.getReader()`.
- UI elements: `#file-progress`, `#file-progress-bar`, `#file-progress-percent`, `#file-progress-message`, `#file-progress-elapsed`, `#cancel-file`, `#retry-file`.

- [ ] Add failing UI contract tests for progressbar semantics, visible stage copy, cancel and retry controls.
- [ ] Run UI tests and confirm RED.
- [ ] Implement `postFileAnalysisStream`, SSE parsing, elapsed-time ticker and `AbortController` cancellation.
- [ ] Preserve the prior successful document until a new upload succeeds; on network interruption retain the in-memory File for retry.
- [ ] Add a JSON fallback only when streaming cannot be established before analysis begins.
- [ ] Run UI/full tests and build; confirm GREEN.

### Task 3: Increase analysis duration and add request observability

**Files:**
- Modify: `vercel.json`
- Modify: `api/analyze-file.js`
- Modify: `api/diagnosis.js`
- Modify: `tests/api/analyze-file.test.js`
- Modify: `tests/api/diagnosis.test.js`

**Interfaces:**
- API responses/errors may include `requestId`.
- Logs include requestId, stage/provider and elapsed milliseconds; never body content.

- [ ] Add failing API tests asserting requestId exists on stream errors and diagnosis terminal errors.
- [ ] Add request ID + elapsed logging helpers.
- [ ] Configure `api/analyze-file.js` to `maxDuration: 60` and `api/diagnosis.js` to `maxDuration: 45` in `vercel.json`.
- [ ] Add security headers to Vercel config.
- [ ] Run full tests and build.

### Task 4: Implement provider timeouts and full failover

**Files:**
- Modify: `src/ai/providers.js`
- Modify: `api/diagnosis.js`
- Modify: `src/ai/cross-review.js`
- Modify: `tests/ai/providers.test.js`
- Modify: `tests/api/diagnosis.test.js`
- Modify: `tests/ai/cross-review.test.js`

**Interfaces:**
- `createDeepSeekProvider({timeoutMs})`, `createOpenAIProvider({timeoutMs})` abort requests after timeout.
- Runtime routing provides `primaryProvider`, `fallbackProvider`, `reviewerProvider`.

- [ ] Add a failing test: primary DeepSeek diagnose throws, OpenAI fallback diagnose receives the same diagnosis and succeeds.
- [ ] Add a failing test: reviewer throws, primary findings are returned with `review_unavailable` rather than 502.
- [ ] Add provider abort/timeout tests using an abort-aware fetch stub.
- [ ] Confirm RED.
- [ ] Implement bounded AbortController timeout in both providers.
- [ ] Implement primary → fallback routing in `handleDiagnosisRequest`.
- [ ] Catch reviewer failures independently and preserve the diagnosis.
- [ ] Add model output token caps.
- [ ] Run full tests and build; confirm GREEN.

### Task 5: Bound diagnosis input and reduce prompt-injection/cost exposure

**Files:**
- Create: `src/ai/context.js`
- Modify: `src/ai/providers.js`
- Modify: `api/diagnosis.js`
- Create: `tests/ai/context.test.js`

**Interfaces:**
- `boundDiagnosisContext(diagnosis)` returns a provider-safe copy with limited turns, strings, evidence, documents and findings.

- [ ] Add failing tests for oversized owner turns, excessive evidence/documents, and preservation of the newest information.
- [ ] Implement immutable context bounding.
- [ ] Update the system prompt to treat owner/file content as untrusted data and ignore embedded instructions that conflict with system/output rules.
- [ ] Feed bounded context to diagnose/review providers.
- [ ] Run all tests.

### Task 6: Preserve mobile session draft and failed AI turn

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/ui/flow.test.js`

**Interfaces:**
- localStorage key `zhenduan.session.v1` stores only text dialogue/answers/findings/timestamps.
- No `originalBase64`, File, document text, or extracted file content is persisted.

- [ ] Add failing tests that session persistence is present and sensitive file fields are excluded.
- [ ] Add `diagnosis.dialogue` entries for owner/AI messages so order is explicit.
- [ ] Save after successful state transitions and restore on load; expire drafts after 7 days.
- [ ] Add “开始新问诊” and “重试本轮” controls.
- [ ] Render AI `reason` as subdued “为什么问这个”.
- [ ] Run full tests/build.

### Task 7: Best-effort abuse guard and report size parity

**Files:**
- Create: `src/http/guard.js`
- Modify: `api/diagnosis.js`
- Modify: `api/report.js`
- Create: `tests/http/guard.test.js`
- Modify: `tests/api/report.test.js`

**Interfaces:**
- `checkBurstLimit(key, options)` returns `{allowed, retryAfterSeconds}`.

- [ ] Add failing burst-limit tests and report >3 MB rejection test.
- [ ] Implement a bounded in-memory limiter (clearly documented as best-effort, not distributed protection).
- [ ] Apply conservative per-IP burst protection to AI diagnosis only; do not block normal multi-turn use.
- [ ] Apply 3 MB raw source workbook limit to report generation.
- [ ] Run full tests/build.

### Task 8: Final audit, review and deployment gate

**Files:**
- Create: `docs/audits/2026-08-10-program-audit.md`
- Tests/docs only unless defects are found.

- [ ] Run `npm test` and record exact pass/fail count.
- [ ] Run `npm run build`.
- [ ] Inspect diff for secrets, raw-body logging, unbounded text, stale-state loss, and misleading UI claims.
- [ ] Write audit findings split into fixed-now, deferred-with-reason, and requires-user-action.
- [ ] Create PR to `main` and wait for PR CI + both Vercel checks.
- [ ] Squash merge only when all gates are green; re-check post-merge Vercel deployment.
