# Multiformat Business Document Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the optional Excel upload into a business-material upload flow supporting five mainstream categories: Excel, CSV, PDF, Word DOCX, and images (JPG/JPEG/PNG), while fixing Excel blank-cell false positives.

**Architecture:** Keep `/api/analyze-file` as the single upload API and route by validated extension/signature into focused parsers. Parsers return a normalized document object with source/type/content/structured data/confidence; only structured tabular data goes through deterministic audit rules. Uncertain extraction must be labeled rather than invented.

**Tech Stack:** Node.js >=20, Vercel Functions, SheetJS xlsx, node:test; focused parsers for CSV/PDF/DOCX/images.

## Global Constraints
- Supported categories: Excel (.xlsx/.xls), CSV (.csv), PDF (.pdf), Word (.docx), image (.jpg/.jpeg/.png).
- Upload success alone is not support: content must be parsed into a normalized document or return an explicit unsupported/unreadable state.
- Never invent unreadable numbers or text; preserve extraction confidence/source metadata.
- Normal optional blank cells are not data errors. Missing-value errors require a recognized critical field and a materially populated row.
- Mobile UI must expose all five categories and summarize errors instead of dumping hundreds of repeated codes.

---

### Task 1: Fix spreadsheet audit semantics
**Files:** Modify `src/audit/rules.js`; Test `tests/audit/*`.
**Produces:** Missing-value checks limited to recognized critical fields on populated business rows.
- [ ] Add failing tests showing optional blank cells do not create `missing_value`, while missing critical fields do.
- [ ] Run `npm test` and confirm the new tests fail for the current all-cell rule.
- [ ] Implement critical-field inference conservatively; preserve duplicate and cross-sheet checks.
- [ ] Run `npm test` and confirm pass.

### Task 2: Add normalized multi-format parsing boundary
**Files:** Create `src/documents/*`; Modify `api/analyze-file.js`, `package.json`; Test `tests/api/analyze-file.test.js` and parser tests.
**Produces:** `parseBusinessDocument({name, buffer}) -> {document, audit, summary}`.
- [ ] Add failing API tests for CSV, PDF, DOCX, JPG/PNG and corrupt/mismatched files.
- [ ] Add signature/extension validation and per-format parsers.
- [ ] Normalize source metadata, extracted text/tables, confidence and parse warnings.
- [ ] Apply deterministic audit only to reliable structured tables; do not manufacture findings from unstructured text.
- [ ] Run full tests.

### Task 3: Upgrade mobile upload UI
**Files:** Modify `public/index.html`, `public/app.js`, `public/styles.css`; Test `tests/ui/*`.
**Produces:** One `上传经营资料` control accepting the five categories, with camera/photo-friendly image selection on mobile and compact status summaries.
- [ ] Add failing UI contract tests for accepted extensions/copy and compact error rendering.
- [ ] Change the input accept list and user-facing copy.
- [ ] Render parsed type, useful-content counts, warnings, data-quality issue count and business-anomaly count without repeating identical codes.
- [ ] Ensure Excel report download remains enabled only when an original Excel workbook exists and findings are present.
- [ ] Run full tests and build.

### Task 4: End-to-end verification and deployment gate
**Files:** Tests/docs only unless a defect is found.
**Produces:** Verified five-format behavior with no regression to diagnosis.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Verify fixtures for xlsx/xls/csv/pdf/docx/jpg/png and corrupt files.
- [ ] Confirm diagnosis tests still pass and parsed document metadata remains consumable by diagnosis.
- [ ] Review diff for secrets, oversized payload risks, misleading confidence claims and mobile regressions.
