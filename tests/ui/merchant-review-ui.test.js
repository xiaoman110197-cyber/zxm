import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');

test('upload review uses plain-language sections instead of one long warning block', () => {
  assert.match(html, /id="file-review-summary"/);
  assert.match(html, /id="file-review-corrections"/);
  assert.match(html, /id="file-review-important"/);
  assert.match(html, /id="file-review-other"/);
  assert.match(html, /id="file-review-fulltext"/);
  assert.match(html, /发现计算错误/);
  assert.match(html, /需要你确认/);
  assert.match(html, /确认并用于诊断/);
  assert.match(html, /其他疑似识别问题/);
  assert.match(html, /查看完整识别文字/);

  assert.match(js, /buildFileReviewModel/);
  assert.match(js, /renderCorrectionCard/);
  assert.match(js, /calculation_error/);
  assert.match(js, /correctionDecisions/);
  assert.match(js, /plainAuditIssues/);
  assert.doesNotMatch(js, /function renderFileReview[\s\S]*?\$\('file-errors'\)\.textContent = summarizeFileIssues\(result\)/);

  assert.match(css, /review-summary/);
  assert.match(css, /review-issue-card/);
  assert.match(css, /review-correction-card/);
});

test('secondary OCR issues and full OCR text are collapsed by default', () => {
  assert.match(html, /<details[^>]*id="file-review-other"[^>]*>/);
  assert.match(html, /<details[^>]*id="file-review-fulltext"[^>]*>/);
  assert.doesNotMatch(html, /<details[^>]*id="file-review-other"[^>]*open/);
  assert.doesNotMatch(html, /<details[^>]*id="file-review-fulltext"[^>]*open/);
});

test('mobile review layout avoids horizontal overflow and keeps correction actions readable', () => {
  assert.match(css, /overflow-wrap:anywhere/);
  assert.match(css, /review-correction-actions/);
  assert.match(css, /@media \(max-width:420px\)/);
});
