# PR17 Trust and Deployment Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seal PR17's server trust boundary, make cloud OCR truly run before local OCR, and expose a secret-safe deployment diagnostic for the Qianfan 401.

**Architecture:** Analysis and diagnosis outputs cross the browser through versioned HMAC tokens; only verified server payloads can become program evidence or downloadable findings. Image validation is separated from local recognition so the API can call Qianfan first, and a small runtime-config module supplies both secret-safe health state and signing-key derivation.

**Tech Stack:** Node.js 20+ ESM, Vercel Functions, Web Crypto-compatible `node:crypto`, SheetJS, Node test runner, GitHub Actions.

## Global Constraints

- AI may organize, explain, and suggest anomaly candidates, but must not invent data.
- Only deterministic server rules may create a provable `correctedValue`.
- Every AI finding must pass independent review or be marked `review_unavailable`.
- No endpoint may expose API keys, key fragments, authorization headers, or raw provider errors.
- `analysisToken` and `diagnosisToken` expire after 6 hours and are strictly size-bounded.
- Do not commit or push without explicit user authorization.

---

### Task 1: Runtime trust configuration and versioned tokens

**Files:**
- Create: `src/config/runtime.js`
- Create: `src/security/trust-token.js`
- Create: `tests/config/runtime.test.js`
- Create: `tests/security/trust-token.test.js`

**Interfaces:**
- Produces: `runtimeConfig(env)`, `resolveTrustSecret(env)`, `signTrustToken(type, data, options)`, and `verifyTrustToken(token, expectedType, options)`.
- Token data is JSON-safe, at most 48 KiB after serialization, signed with HMAC-SHA256, and checked with `timingSafeEqual`.

- [ ] **Step 1: Write failing runtime-config tests**

Test that missing, unexpected-format, and `bce-v3/` Qianfan keys are classified without returning the key; test explicit and DeepSeek-derived signing modes.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/config/runtime.test.js`

Expected: FAIL because `src/config/runtime.js` does not exist.

- [ ] **Step 3: Implement the minimal runtime-config module**

Return only booleans, model names, environment/project identifiers, short Git SHA, signing mode, `ok`, and stable error codes. Derive a signing secret with HMAC-SHA256 over a fixed `zhenduan-trust-token-v1` purpose label when only `DEEPSEEK_API_KEY` exists.

- [ ] **Step 4: Write and run failing token tests**

Cover valid tokens, tampering, expiry, wrong type, wrong key, oversized payloads, and absence of the source secret.

- [ ] **Step 5: Implement token signing and verification, then verify GREEN**

Run: `node --test tests/config/runtime.test.js tests/security/trust-token.test.js`

Expected: PASS.

### Task 2: Sign bounded analysis evidence

**Files:**
- Modify: `api/analyze-file.js`
- Modify: `tests/api/analyze-file.test.js`
- Modify: `tests/api/analyze-file-corrections.test.js`
- Modify: `tests/api/analyze-file-report-review.test.js`

**Interfaces:**
- Consumes: `signTrustToken('analysis', data, options)`.
- Produces: `analysisToken`; assigns file-digest-namespaced `correction_<digest>_1...n`; signs summary, audit evidence, corrections, report facts/issues/confirmations, and no raw OCR text.

- [ ] **Step 1: Write a failing analysis-token response test**

Assert that an analyzed workbook returns a verifiable `analysisToken`, correction IDs are stable, and the decoded signed data excludes `contentBase64` and full `document.text`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/api/analyze-file.test.js tests/api/analyze-file-corrections.test.js`

- [ ] **Step 3: Add bounded evidence serialization and signing**

Build a compact payload from the already normalized server result. Reject signing configuration failure with 503 in production/runtime use while permitting an injected test secret.

- [ ] **Step 4: Verify focused and existing API tests GREEN**

Run: `node --test tests/api/analyze-file.test.js tests/api/analyze-file-corrections.test.js tests/api/analyze-file-report-review.test.js`

### Task 3: Verify diagnosis context and force AI review

**Files:**
- Create: `src/ai/trusted-context.js`
- Modify: `src/ai/context.js`
- Modify: `api/diagnosis.js`
- Modify: `tests/ai/context.test.js`
- Modify: `tests/api/diagnosis.test.js`
- Modify: `tests/api/provider-routing.test.js`

**Interfaces:**
- Consumes: verified analysis/diagnosis tokens and `{ correctionId, decision }` selections.
- Produces: a bounded diagnosis object whose reserved evidence was reconstructed server-side; signs final findings as `diagnosisToken`.

- [ ] **Step 1: Add the reproduced forgery as a failing regression test**

Submit forged `report_issue`, `program:`, `correction_decision`, prior `deterministic:true`, and a primary model result containing `deterministic:true`. Assert none is trusted, reviewer is called once, and no result is `program_fact`.

- [ ] **Step 2: Add failing valid-token and correction-selection tests**

Verify accepted and kept-original choices are rebuilt from signed correction values; invalid IDs and tampered tokens are rejected.

- [ ] **Step 3: Verify RED**

Run: `node --test tests/api/diagnosis.test.js tests/ai/context.test.js`

- [ ] **Step 4: Implement trusted context assembly**

Filter reserved client prefixes, ignore client trust flags, recover prior findings only from `diagnosisToken`, and rebuild canonical evidence strings from the analysis payload.

- [ ] **Step 5: Sanitize every AI finding before validation/review**

Delete `deterministic`, `crossModelStatus`, and `review`; when review is unavailable, use `review_unavailable`; sign the cleaned final findings.

- [ ] **Step 6: Verify GREEN and provider routing**

Run: `node --test tests/api/diagnosis.test.js tests/ai/context.test.js tests/api/provider-routing.test.js tests/ai/cross-review.test.js`

### Task 4: Recompute report audit and trust only signed findings

**Files:**
- Modify: `api/report.js`
- Modify: `tests/api/report.test.js`

**Interfaces:**
- Consumes: original workbook and `diagnosisToken`.
- Produces: report from a freshly parsed/audited workbook plus verified findings; ignores client `audit` and `findings`.

- [ ] **Step 1: Write failing forged-report tests**

Assert client-supplied audit/findings never appear; a valid token does appear; an invalid/missing token is rejected; burst limiting returns 429.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/api/report.test.js`

- [ ] **Step 3: Implement recomputation, verification, and request guard**

Use `parseWorkbook`, `auditWorkbook`, existing normalization semantics, `verifyTrustToken('diagnosis')`, and `requestClientKey(req, 'report')`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/api/report.test.js tests/reports/workbook-report.test.js`

### Task 5: Strengthen OCR fact anchoring

**Files:**
- Modify: `src/report/structure.js`
- Modify: `src/ai/providers.js`
- Modify: `tests/report/structure.test.js`
- Modify: `tests/ai/providers-structure.test.js`

**Interfaces:**
- Produces unique server fact IDs and retains only facts whose source citation contains scope, metric/alias, value, and unit/equivalent; strictly valid calendar dates are the only unitless equivalent for approved date metrics.

- [ ] **Step 1: Add failing anchoring and duplicate-ID tests**

Test isolated values, missing scope/metric/unit, table citations containing headers+row, common metric aliases, and duplicate model IDs with candidate remapping.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/report/structure.test.js tests/ai/providers-structure.test.js`

- [ ] **Step 3: Implement strict normalization and prompt wording**

Generate IDs as `report_fact_1...n`; map raw IDs to generated IDs; drop ambiguous facts; require composite table citations in the system prompt.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/report/structure.test.js tests/ai/providers-structure.test.js tests/report/rules.test.js`

### Task 6: Make Qianfan OCR execute before local OCR

**Files:**
- Modify: `src/documents/parse.js`
- Modify: `api/analyze-file.js`
- Modify: `tests/documents/parse.test.js`
- Modify: `tests/api/deepseek-ocr-pipeline.test.js`
- Modify: `tests/api/analyze-file-report-review.test.js`

**Interfaces:**
- Produces: `parseImageDocument(...)`; `parseBusinessDocument(..., { deferImageOcr:true })` validates and returns a deferred image document.

- [ ] **Step 1: Add failing call-order tests**

Assert local OCR is never invoked after cloud success, is invoked exactly once after cloud failure, and the returned document text/mode reflects the chosen path.

- [ ] **Step 2: Add a failing zero-facts integrity test**

Assert cloud text plus zero valid structured facts produces `completeReview:false` and `REPORT_STRUCTURE_EMPTY`.

- [ ] **Step 3: Verify RED**

Run: `node --test tests/documents/parse.test.js tests/api/deepseek-ocr-pipeline.test.js tests/api/analyze-file-report-review.test.js`

- [ ] **Step 4: Extract image parsing and change API orchestration**

Validate first, defer Tesseract, call Qianfan, and only on cloud failure call the extracted local image parser. Replace `document.text` with the actually selected OCR output.

- [ ] **Step 5: Implement empty-result state and verify GREEN**

Run the three focused test files again; expected PASS.

### Task 7: Add secret-safe health endpoint

**Files:**
- Create: `api/health.js`
- Create: `tests/api/health.test.js`
- Modify: `vercel.json`
- Modify: `tests/api/vercel-config.test.js`

**Interfaces:**
- Consumes: `runtimeConfig(env)`.
- Produces: GET `/api/health`, `Cache-Control: no-store`, stable health codes, no secret-derived material.

- [ ] **Step 1: Write failing health tests**

Cover method handling, missing key, unexpected Qianfan format, configured state, signing mode, environment/SHA, cache header, and response secret scan.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/api/health.test.js tests/api/vercel-config.test.js`

- [ ] **Step 3: Implement endpoint and Vercel duration entry**

Return only the fields approved by the design.

- [ ] **Step 4: Verify GREEN**

Run the focused tests again; expected PASS.

### Task 8: Update browser transport

**Files:**
- Modify: `public/app.js`
- Modify: `public/session.js`
- Modify: `tests/ui/ocr-confirmation.test.js`
- Modify: `tests/ui/report-review-ui.test.js`
- Modify: `tests/ui/flow.test.js`
- Modify: `tests/ui/session.test.js`

**Interfaces:**
- Carries `analysisTokens`, `{ correctionId, decision }`, and `diagnosisToken`; never constructs reserved program evidence strings in the browser.

- [ ] **Step 1: Rewrite UI contract tests to fail against the old transport**

Assert that `report_issue:` and value-bearing `correction_decision:` construction are absent, tokens are sent, and sensitive tokens are not persisted in localStorage.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/ui/*.test.js`

- [ ] **Step 3: Implement browser state and request changes**

Store tokens only in page memory, reset them when files/session reset, send selection-only decisions, save the latest diagnosis token, and send only the original file plus diagnosis token to `/api/report`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/ui/*.test.js`

### Task 9: Resource limits and reproducible build

**Files:**
- Modify: `src/audit/workbook.js`
- Modify: `tests/audit/workbook.test.js`
- Create: `.gitignore`
- Create: `scripts/verify-server-imports.js`
- Modify: `package.json`
- Create: `package-lock.json`
- Create: `.github/workflows/ci.yml`
- Modify: `tests/deploy/vercel-config.test.js`

**Interfaces:**
- Workbook parser rejects over 30 sheets, 50,000 rows/sheet, 200 columns/sheet, or 250,000 material cells total.
- Build imports every Vercel API module after copying `public` to `dist`.

- [ ] **Step 1: Add failing workbook and deployment tests**

Test every exact limit and verify CI uses Node 20, `npm ci`, `npm test`, and `npm run build`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/audit/workbook.test.js tests/deploy/vercel-config.test.js`

- [ ] **Step 3: Implement limits, ignore rules, import check, CI, and lockfile**

Generate the lockfile using a modern npm compatible with Node 20+ and do not modify dependency versions except lock resolution.

- [ ] **Step 4: Verify GREEN**

Run the focused tests, then `npm ci` in a temporary directory or clean dependency environment and `npm run build`.

### Task 10: Full verification and deployment handoff

**Files:**
- Modify only if a regression reveals an in-scope defect.

**Interfaces:**
- Produces a tested local patch and a precise list of the remaining Vercel/Baidu actions requiring the user's credentials.

- [ ] **Step 1: Run the complete automated suite**

Run: `node --test`

Expected: all tests pass with no skipped security regression.

- [ ] **Step 2: Run build and dependency audit**

Run: `npm run build` and `npm audit --omit=dev` using the modern runtime.

- [ ] **Step 3: Inspect the final diff and secret scan**

Run targeted `git diff --check`, `git diff --stat`, and searches for key-like values, leaked Authorization headers, and remaining client construction of reserved evidence.

- [ ] **Step 4: Report the external deployment gate**

Give the user the Preview health URL/checklist: confirm project, environment, branch, SHA, `QIANFAN_API_KEY` existence/format, redeploy, then retry the real report image. Do not ask them to buy OCR quota.
