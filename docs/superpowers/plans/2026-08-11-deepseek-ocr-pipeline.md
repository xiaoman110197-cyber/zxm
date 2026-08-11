# DeepSeek OCR Pipeline Implementation Plan

> **Status (2026-08-11):** Tasks 1–6 and Task 7 code/CI verification are complete on `feature/deepseek-ocr-pipeline`. Preview `QIANFAN_API_KEY` and `DEEPSEEK_API_KEY` are now confirmed configured in Vercel; a fresh Preview deployment is required before same-image verification. Do not merge until the same reference screenshot is successfully tested in Preview.

## Target architecture

```text
Report image
  -> Qianfan deepseek-ocr cloud image/table recognition
  -> DeepSeek V4 OCR-text structuring
  -> deterministic fact reconciliation and rule checks
  -> boss confirmation
  -> DeepSeek V4 business diagnosis
  -> separate DeepSeek V4 review pass
```

Local Tesseract OCR remains fallback-only. OpenAI is not part of the runtime path.

## Truth contract

- AI may read, structure, explain, and propose candidates.
- Only deterministic program logic may emit a proven `correctedValue`.
- Unproven replacements remain anomalies or confirmation items.
- Structured facts must be anchored to OCR source text.
- Degraded recognition is explicitly incomplete and a zero proven-problem count must never be presented as a clean report.
- If cloud and local OCR are both unavailable, the report cannot enter diagnosis.

## Runtime environment contract

```text
QIANFAN_API_KEY       required for cloud report OCR
QIANFAN_OCR_MODEL     optional, default deepseek-ocr
DEEPSEEK_API_KEY      required for structuring/diagnosis/review
DEEPSEEK_MODEL        optional, default deepseek-v4-flash
```

Secrets must stay server-side and must never appear in commits, browser code, screenshots, or logs.

## Completed implementation tasks

### Task 1 — Qianfan DeepSeek-OCR adapter

- [x] Base64 image request contract
- [x] model and endpoint contract
- [x] bounded image type handling
- [x] safe HTTP/timeout/DNS/TLS/connection error classification
- [x] no API key/provider response leakage

### Task 2 — DeepSeek report-text structuring

- [x] JSON-only facts/candidates/confirmations contract
- [x] fact `sourceText` must exist in OCR text
- [x] fact value must be anchored in its own `sourceText`
- [x] model-provided `correctedValue` is stripped
- [x] degraded local OCR cannot be promoted to high-confidence fact

### Task 3 — Evidence reconciliation and recognition modes

- [x] `cloud_ocr_deepseek`
- [x] `local_ocr_degraded`
- [x] `ocr_unavailable`
- [x] `completeReview` semantics
- [x] conflict/confirmation downgrade semantics

### Task 4 — Image API orchestration

- [x] image route uses Qianfan OCR -> DeepSeek structure -> program rules
- [x] cloud OCR failure falls back to local OCR
- [x] structuring failure preserves actual OCR mode but marks review incomplete
- [x] progress stages expose `cloud-ocr`, `structuring`, `report-check`, `complete`
- [x] raw OCR/business data is not written to observability logs

### Task 5 — Boss-facing UI

- [x] complete/degraded/unavailable states shown explicitly
- [x] degraded zero-result copy says it cannot prove the report is clean
- [x] `ocr_unavailable` blocks confirmation/diagnosis continuation
- [x] correct values render only for program-proven calculation errors

### Task 6 — DeepSeek-only runtime

- [x] OpenAI diagnosis fallback removed
- [x] OpenAI report vision runtime removed
- [x] same DeepSeek provider can run an independent second review pass
- [x] runtime static guard rejects OpenAI dependency strings
- [x] obsolete OpenAI vision files/tests removed
- [x] README environment contract updated

### Task 7 — Reference acceptance and verification

- [x] Reference case asserts all nine fixed outcomes:
  1. 华南 `9800 / 6100 / 85% -> 37.76%`
  2. 华北 cost `-1200` -> anomaly, no replacement
  3. 跨境电商 revenue `8900`, net profit `12000` -> anomaly
  4. 市场营销 attendance `105%` -> logic error
  5. 客服 headcount `-15` -> logic error
  6. 供应链 turnover `-5` -> logic error
  7. SKU-8802 future production date -> anomaly
  8. SKU-8803 expiry before production -> logic error
  9. total margin `182.5 = 85 + 97.5` -> aggregation-method logic error, no invented exact total
- [x] Negative truth assertion: any issue that is not a program calculation error has no `correctedValue`
- [x] Full GitHub Actions test suite passes
- [x] Production bundle build passes
- [x] Configure/confirm Preview `QIANFAN_API_KEY`, `DEEPSEEK_API_KEY`
- [ ] Upload the same reference screenshot in Preview
- [ ] Verify `cloud-ocr -> structuring -> report-check -> complete`
- [ ] Verify mode `cloud_ocr_deepseek`
- [ ] Compare the returned issues against the nine expected outcomes

## Merge gate

Do not merge the PR until the real Preview upload passes. A successful build or mocked API test is not evidence that Qianfan and DeepSeek credentials/network/model access are working in the deployed environment.
