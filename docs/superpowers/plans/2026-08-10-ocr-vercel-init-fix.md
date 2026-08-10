# OCR Vercel initialization fix

## Symptom

Real iPhone image uploads repeatedly reach 52% in about five seconds, remain there, and then fail around 182 seconds with `分析连接提前结束`.

## Root-cause evidence

- `api/analyze-file.js` is configured with Vercel `maxDuration: 180`, explaining the final disconnect around 182 seconds.
- OCR progress maps the end of language loading and the beginning of Tesseract worker initialization to 52%, so the stall is in that boundary rather than file upload transport.
- The former dual-language `chi_sim + eng` real OCR test completed but emitted a malformed traineddata language warning (`玂玂`) during initialization.
- A single `chi_sim` worker still recognizes the real Chinese + numeric fixture and removes that warning.

## Fix

1. Load only bundled `chi_sim` for the current Chinese business-screenshot path instead of initializing `chi_sim + eng` together.
2. Remove the unused separate English traineddata package.
3. Bound worker initialization to 20 seconds.
4. If initialization times out, return a specific safe retry message and request ID instead of waiting for Vercel's 180-second hard end.
5. If a worker resolves after the timeout, terminate it so it cannot leak.

## Verification

- Red tests first proved both missing behaviors: no initialization timeout and no specific API timeout message.
- Final branch: 115/115 tests pass and production bundle builds.
- Real Tesseract Chinese + numeric OCR fixture passes on the final branch.
- Both Vercel project preview checks pass on the final branch.

## Acceptance

The fix is not considered fully verified until the same real iPhone image that previously stalled at 52% succeeds on the production deployment. If Vercel still cannot initialize the worker, the user should now receive an explicit initialization-timeout error in roughly 20 seconds instead of waiting around 182 seconds.
