# Owner-Readable Data Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn uploaded business-data review into a plain-language mobile flow that surfaces only important OCR uncertainties and gives deterministic corrections when the source data mathematically proves a value is wrong.

**Architecture:** Keep OCR extraction and diagnosis gating unchanged, but add a focused review-model layer that converts raw OCR/audit output into three plain-language buckets: usable, calculation errors, and needs confirmation. Deterministic correction rules live outside the UI; the UI only renders proven corrections and never guesses unclear OCR values.

**Tech Stack:** Node.js ES modules, browser JavaScript, Tesseract.js OCR output, existing workbook audit rules, Node test runner, Vercel static/serverless app.

## Global Constraints

- Ordinary merchants must understand the review screen without OCR/AI terminology.
- Pure punctuation, isolated symbols, and one-character OCR noise must not dominate the main screen.
- Yellow/orange means “needs confirmation”; red is reserved for true failures that block progress.
- A “correct value” may be shown only when deterministic arithmetic proves it from reliable inputs.
- If any required input is low-confidence OCR, do not auto-correct; move the item to “needs confirmation”.
- Never overwrite the uploaded source file silently.
- Image content still must not enter `diagnosis.documents` before merchant confirmation.
- Main mobile view shows at most five important confirmation items; secondary OCR issues and full OCR text are collapsed by default.

---

### Task 1: Build a plain-language review model for OCR uncertainty

**Files:**
- Create: `public/file-review.js`
- Test: `tests/ui/file-review-model.test.js`

**Interfaces:**
- Consumes: `document.uncertainSegments`, `document.text`, `summary.confidence`.
- Produces: `buildFileReviewModel(result)` returning `{ confidence, importantIssues, otherIssues, fullText, hasText }`.

- [ ] **Step 1: Write failing tests**

Test that punctuation and isolated one-character OCR noise are excluded from `importantIssues`, while numeric/percentage/经营关键词 context is ranked first and only five important issues are returned.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/ui/file-review-model.test.js`
Expected: FAIL because `public/file-review.js` does not exist.

- [ ] **Step 3: Implement the minimal review-model functions**

Implement deterministic helpers for noise filtering and relevance scoring. Do not call AI and do not invent corrected OCR values.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/ui/file-review-model.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: rank OCR review issues for merchants`.

### Task 2: Add deterministic calculation corrections

**Files:**
- Create: `src/audit/corrections.js`
- Modify: `api/analyze-file.js`
- Test: `tests/audit/corrections.test.js`
- Test: `tests/api/analyze-file.test.js`

**Interfaces:**
- Consumes structured `workbook`, existing `audit` result, and unstructured image document text/uncertain segments.
- Produces `corrections` entries shaped as `{ kind:'calculation_error'|'inconsistency'|'needs_confirmation', label, originalValue, correctedValue?, explanation, evidence }`.

- [ ] **Step 1: Write failing deterministic correction tests**

Cover at minimum:
1. Existing cross-sheet total mismatch becomes a `calculation_error` with original and recomputed totals.
2. `营业额=100000, 成本=40000, 毛利=60000, 毛利率=68%` becomes a proven correction to `60%` when all source values are reliable.
3. If one required OCR value is present in `uncertainSegments`, the same formula must return `needs_confirmation` and no corrected value.
4. A mere mismatch such as daily orders × unit price × days versus monthly revenue is classified as `inconsistency`, not a forced correction.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/audit/corrections.test.js`
Expected: FAIL because the correction module does not exist.

- [ ] **Step 3: Implement minimal deterministic rules**

Implement only safe arithmetic rules:
- cross-sheet totals already proven by structured data;
- gross profit = revenue - cost;
- gross margin = gross profit / revenue when revenue is non-zero;
- inconsistencies are warnings when assumptions are not guaranteed.

- [ ] **Step 4: Expose corrections from analyze-file API**

Add a `corrections` array to successful analysis results without changing existing fields.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test tests/audit/corrections.test.js tests/api/analyze-file.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: detect provable business calculation errors`.

### Task 3: Replace the cluttered OCR block with a merchant-readable review screen

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `tests/ui/ocr-confirmation.test.js`
- Test: `tests/ui/flow.test.js`

**Interfaces:**
- Consumes `buildFileReviewModel(result)` and `result.corrections`.
- Produces a mobile review screen with summary counts, proven calculation corrections, important confirmation cards, collapsed secondary issues, collapsed full OCR text, and explicit confirmation action.

- [ ] **Step 1: Write failing UI structure tests**

Assert the page contains:
- plain-language summary area;
- calculation-error section;
- needs-confirmation section;
- collapsed “其他疑似识别问题” section;
- collapsed “查看完整识别文字” section;
- action label “确认并用于诊断”.

Also assert OCR warnings are no longer dumped into the red `file-errors` area.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `node --test tests/ui/ocr-confirmation.test.js tests/ui/flow.test.js`
Expected: FAIL on the new review-screen assertions.

- [ ] **Step 3: Implement the plain-language rendering**

Render three user-facing states:
- “可以直接使用”;
- “发现计算错误” with original value, correct value, explanation, and explicit adopt/keep choice where applicable;
- “需要你确认” for uncertain OCR or unresolved inconsistencies.

Do not display raw OCR technical labels on the main view.

- [ ] **Step 4: Make secondary details collapsible and mobile-safe**

Use native `<details>` elements for secondary OCR issues and full text. Ensure cards wrap on narrow screens with no horizontal overflow.

- [ ] **Step 5: Run UI tests and verify GREEN**

Run: `node --test tests/ui/ocr-confirmation.test.js tests/ui/flow.test.js tests/ui/file-review-model.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: make upload review clear for merchants`.

### Task 4: Preserve correction decisions in diagnosis evidence without mutating source files

**Files:**
- Modify: `public/app.js`
- Modify: `src/ai/context.js`
- Test: `tests/ai/context.test.js`
- Test: `tests/ui/flow.test.js`

**Interfaces:**
- Consumes merchant correction choices from the review UI.
- Produces diagnosis evidence that records original value, proven corrected value, and merchant choice; source file remains untouched.

- [ ] **Step 1: Write failing evidence tests**

Verify diagnosis context can distinguish:
- original source value;
- system recomputation;
- merchant accepted correction;
- merchant retained original value.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/ai/context.test.js tests/ui/flow.test.js`
Expected: FAIL on correction-decision evidence assertions.

- [ ] **Step 3: Implement minimal evidence recording**

Store correction decisions as explicit evidence objects/strings used by the diagnosis context. Do not rewrite workbook/image source content.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/ai/context.test.js tests/ui/flow.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: preserve merchant correction decisions`.

### Task 5: Full regression and production build

**Files:**
- No new production files expected.

**Interfaces:**
- Verifies all previous interfaces together.

- [ ] **Step 1: Run complete test suite**

Run: `npm test`
Expected: all tests pass with zero failures.

- [ ] **Step 2: Build production bundle**

Run the repository production build command used by CI.
Expected: exit code 0.

- [ ] **Step 3: Review diff for scope creep**

Confirm there is no AI guessing of OCR values, no source-file mutation, and no unrelated diagnosis architecture changes.

- [ ] **Step 4: Open PR for review**

PR summary must state exactly which calculations are deterministic and which cases remain “needs confirmation”.
