# Resilient Progress + Program Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long file analysis visibly progressive and recoverable on mobile while closing the most important correctness, AI failover, privacy, cost, and resource-control gaps found in the full-program audit.

**Architecture:** Keep existing APIs compatible, add a streaming NDJSON upload-analysis endpoint for progress, and share validation/audit logic through focused helpers. Harden AI routing with ordered primary/fallback providers, explicit timeouts/output caps, and reviewer fail-open behavior. Add lightweight reusable request guards and mobile race/retry handling without introducing external state or infrastructure.

**Tech Stack:** Node.js >=20.16, Vercel Functions, browser Fetch/ReadableStream, Tesseract.js 7, SheetJS, node:test.

## Global Constraints

- Five supported categories remain Excel (.xlsx/.xls), CSV (.csv), PDF (.pdf), Word (.docx), and image (.jpg/.jpeg/.png).
- File-analysis percentages represent real stages; only OCR maps genuine internal progress into its stage range.
- A network retry may restart analysis because no durable server-side job store is introduced.
- Reviewer failure must never destroy a valid primary diagnosis.
- If both diagnosis providers fail, return service unavailable; never fabricate a result.
- OpenAI Responses requests must set `store:false`.
- Uploaded document/OCR/cell content is untrusted evidence, never instructions.
- Raw file maximum remains 3 MB for analyze/report transport.
- Best-effort in-memory rate limiting is not described as global protection.
- Existing diagnosis/report behavior and tests must remain compatible.

---

### Task 1: Extract file-analysis core and add progress events

**Files:**
- Create: `src/documents/analyze.js`
- Create: `api/analyze-file-stream.js`
- Modify: `api/analyze-file.js`
- Modify: `src/documents/parse.js`
- Modify: `vercel.json`
- Test: `tests/api/analyze-file-stream.test.js`
- Test: `tests/documents/parse.test.js`

**Interfaces:**
- Produces `analyzeUploadedBusinessFile(file, deps?) -> Promise<{document,audit,summary}>`.
- `parseBusinessDocument({name,buffer}, {onProgress?, ...deps})` calls `onProgress({stage, percent, message})` at real parser boundaries.
- `/api/analyze-file-stream` emits NDJSON `progress`, `result`, and `error` records.

- [ ] **Step 1: Write failing parser progress tests**

Add tests asserting image OCR progress is mapped into the `40..82` range and that structured/PDF/DOCX parsers emit deterministic stage-boundary events. Use an injected `imageOcr(buffer,{onProgress})` test double that invokes `onProgress(0.5)` and assert the parser emits an OCR event around 61%.

- [ ] **Step 2: Run tests and confirm RED**

Run `npm test -- tests/documents/parse.test.js` and confirm failure because `onProgress` is not implemented.

- [ ] **Step 3: Add shared file-analysis core tests**

Create API tests asserting the shared core returns the same normalized result currently returned by `/api/analyze-file` and keeps 3 MB validation before parsing.

- [ ] **Step 4: Implement parser progress hooks and shared core**

`src/documents/analyze.js` owns extension support, strict file decoding/size checks, deterministic audit normalization, compact audit summary, and final summary construction. Both APIs call it.

- [ ] **Step 5: Add streaming API tests**

Use a writable mock response that records `write()` chunks. Assert the stream sends `validating`, parser progress, `auditing`, `preparing`, then `result` in order and terminates with `end()`.

- [ ] **Step 6: Implement NDJSON endpoint**

Set `Content-Type: application/x-ndjson; charset=utf-8`, `Cache-Control: no-store`, and write one JSON object plus newline per event. Send user-safe error records; log internal details server-side.

- [ ] **Step 7: Configure explicit file-analysis duration**

Add Vercel function config for `api/analyze-file.js` and `api/analyze-file-stream.js` with `maxDuration: 60`.

- [ ] **Step 8: Run focused and full tests**

Run `npm test` and `npm run build`.

---

### Task 2: Mobile progress bar, automatic retry, and race-safe uploads

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `tests/ui/flow.test.js`

**Interfaces:**
- Consumes NDJSON from `/api/analyze-file-stream`.
- Produces `setFileProgress(percent,message,state?)`, one active upload controller/request id, and manual retry action.

- [ ] **Step 1: Add failing UI contract tests**

Assert markup contains a progress region with `role="progressbar"`, current percentage text, stage text, and a hidden retry button. Assert JS references `/api/analyze-file-stream`, `AbortController`, automatic retry copy, and stale request-id protection.

- [ ] **Step 2: Confirm RED**

Run `npm test -- tests/ui/flow.test.js` and confirm the new contracts fail.

- [ ] **Step 3: Implement progress rendering**

Show 5% while FileReader runs, 15% after streaming request starts, consume each NDJSON progress event, and set 100% only on a `result` event. Progress bar width and `aria-valuenow` follow the bounded percentage.

- [ ] **Step 4: Implement one automatic network retry**

For fetch/stream failures that are not an intentional AbortError, rerun the original local `File` once and display `连接中断，正在自动重试（1/1）…`. After the second failure, keep the file selected and expose `重新分析`.

- [ ] **Step 5: Prevent races and stale evidence**

Abort the prior request when another file is selected; ignore events/results whose request id is no longer current. Before applying a new file result or resetting upload state, remove prior `file_analysis:` evidence entries. Disable diagnosis send while the selected file is actively analyzing.

- [ ] **Step 6: Improve failure copy**

Map raw `TypeError: Load failed`/`Failed to fetch` to `连接中断，未收到服务器结果` and preserve deterministic server messages for corrupt/oversized files.

- [ ] **Step 7: Run UI and full tests**

Run `npm test` and `npm run build`.

---

### Task 3: AI disaster recovery, reviewer fail-open, and provider budgets

**Files:**
- Modify: `src/ai/providers.js`
- Modify: `api/diagnosis.js`
- Test: `tests/ai/providers.test.js`
- Test: `tests/api/provider-routing.test.js`
- Test: `tests/api/diagnosis.test.js`

**Interfaces:**
- Provider factories accept `timeoutMs`, `maxOutputTokens`, and injected `fetchImpl`.
- Diagnosis routing uses ordered `{primaryProvider, fallbackProvider, reviewerProvider}`.

- [ ] **Step 1: Add failing provider request-budget tests**

Assert DeepSeek sends `max_tokens`; OpenAI sends `max_output_tokens` and `store:false`; both pass an AbortSignal to fetch and abort when an injected timer/short timeout expires.

- [ ] **Step 2: Confirm RED**

Run `npm test -- tests/ai/providers.test.js`.

- [ ] **Step 3: Implement provider timeout/output caps**

Use a small `fetchWithTimeout` helper based on `AbortController` and `setTimeout`, clearing the timer in `finally`. Defaults: diagnosis 25 seconds; review 10 seconds; DeepSeek diagnosis max 1800 tokens; review max 1000; OpenAI diagnosis max output 1800; review max output 1000.

- [ ] **Step 4: Add failing routing tests**

Add: primary throws -> fallback diagnoses with identical input; primary invalid result -> fallback diagnoses; fallback result returns 200; both throw -> 503/502 service-unavailable result; reviewer throws -> valid primary finding returns 200 with `review_unavailable` markers.

- [ ] **Step 5: Confirm RED**

Run `npm test -- tests/api/provider-routing.test.js tests/api/diagnosis.test.js`.

- [ ] **Step 6: Implement ordered fallback**

If DeepSeek key exists, DeepSeek is primary and OpenAI fallback/reviewer. If only OpenAI exists, it is primary. On primary diagnosis error, log provider name and try fallback. Do not call the failed provider as reviewer in that request.

- [ ] **Step 7: Make reviewer fail open**

Wrap cross-review in its own `try/catch`; on failure, return the validated primary findings with non-deterministic reviewed candidates marked `review_unavailable` rather than returning 502.

- [ ] **Step 8: Run full tests**

Run `npm test` and `npm run build`.

---

### Task 4: Prompt-injection, payload, report, and burst protections

**Files:**
- Create: `src/http/guards.js`
- Modify: `src/ai/providers.js`
- Modify: `api/diagnosis.js`
- Modify: `api/analyze-file.js`
- Modify: `api/analyze-file-stream.js`
- Modify: `api/report.js`
- Test: `tests/http/guards.test.js`
- Test: `tests/api/diagnosis.test.js`
- Test: `tests/api/report.test.js`

**Interfaces:**
- `strictBase64ToBuffer(value,{maxBytes,label})` validates canonical Base64 and decoded bytes.
- `serializedSize(value)` returns UTF-8 JSON byte count.
- `createBurstLimiter({limit,windowMs,now?})` returns `{check(key) -> {allowed,retryAfterSeconds}}`.

- [ ] **Step 1: Add guard RED tests**

Test malformed Base64 rejection, 3 MB decoded cap, 64 KB diagnosis JSON cap, and limiter rejection after configured burst count.

- [ ] **Step 2: Implement reusable guards**

Canonical Base64 validation removes allowed padding only, rejects non-Base64 characters, decodes, and re-encodes for equivalence. Limiter stores timestamps per key and prunes expired entries; cap map size to avoid unbounded memory.

- [ ] **Step 3: Add prompt hardening RED tests**

Assert both provider prompts include explicit statements that document/OCR/spreadsheet contents are untrusted evidence, instructions embedded in documents must be ignored, and low-confidence OCR cannot independently justify confirmed findings.

- [ ] **Step 4: Implement prompt hardening**

Update diagnosis system prompt and recommend 3–6 high-value follow-up turns with cautious hypotheses rather than endless questioning.

- [ ] **Step 5: Apply diagnosis payload limits**

Reject serialized diagnosis payloads above 64 KiB and pathological counts (answers > 40, documents > 5, evidence > 100, findings > 20) before provider calls.

- [ ] **Step 6: Apply report guards**

Use the same 3 MB raw workbook limit; reject more than 50 findings, more than 1000 audit errors/anomalies, or oversized serialized analysis metadata. Keep report filename sanitization.

- [ ] **Step 7: Apply best-effort burst limiter**

Use client IP headers (`x-forwarded-for`/`x-real-ip` fallback) and a conservative warm-instance limit for expensive routes. Return 429 with `Retry-After`. Keep comments/documentation explicit that this is not global distributed protection.

- [ ] **Step 8: Run full tests and build**

Run `npm test` and `npm run build`.

---

### Task 5: Mobile trust and diagnosis busy-state improvements

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `tests/ui/flow.test.js`

**Interfaces:**
- Produces clear file data-use copy and a single diagnosis busy guard.

- [ ] **Step 1: Add failing UX tests**

Assert the upload card warns users not to upload unnecessary ID/bank-card sensitive information and explains files are processed for diagnosis. Assert `sendDiagnosis` refuses concurrent calls and the send button text becomes `正在分析…` while pending.

- [ ] **Step 2: Confirm RED**

Run `npm test -- tests/ui/flow.test.js`.

- [ ] **Step 3: Implement privacy/trust copy**

Keep wording short, non-alarmist, and directly under supported formats.

- [ ] **Step 4: Implement diagnosis busy guard**

Use `diagnosisBusy` boolean; reject keyboard/click duplicates; restore original button label in `finally`. If file analysis is active, show `经营资料仍在分析，请稍候完成后再开始诊断。` rather than sending incomplete context.

- [ ] **Step 5: Run full tests/build**

Run `npm test` and `npm run build`.

---

### Task 6: Full audit verification and release gate

**Files:**
- Create: `docs/audits/2026-08-10-program-audit.md`
- Modify only if verification finds a defect.

**Interfaces:** None.

- [ ] **Step 1: Run full automated suite**

Run `npm test`; require zero failures.

- [ ] **Step 2: Run production build**

Run `npm run build`; require success.

- [ ] **Step 3: Review secrets and data flow**

Confirm no API key is present in repository/browser code; provider keys remain server environment only. Confirm OpenAI requests set `store:false` and document content is treated as untrusted data.

- [ ] **Step 4: Review cost/abuse surfaces**

Confirm diagnosis payload/output caps, file/report caps, timeouts, one retry maximum, and best-effort burst limits are in place. Document the remaining need for durable/global project-level rate limiting.

- [ ] **Step 5: Review correctness gaps**

Document deferred limitations: no durable background jobs, no scan-PDF OCR, no multi-file reconciliation, deterministic business-anomaly engine remains conservative, formatted Excel header detection remains limited, no accounts/history/membership yet.

- [ ] **Step 6: Open PR and require PR CI + Vercel Preview**

Create a PR to `main`, verify PR-triggered tests/build and both Vercel checks. Review complete diff before squash merge.

- [ ] **Step 7: Squash merge only after green**

Lock merge to reviewed head SHA, then verify deployment checks on the merged `main` commit before declaring completion.
