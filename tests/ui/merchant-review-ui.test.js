import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');

test('upload review uses plain-language report sections instead of one long OCR warning block', () => {
  assert.match(html, /id="file-review-summary"/);
  assert.match(html, /id="file-review-corrections"/);
  assert.match(html, /id="file-review-important"/);
  assert.match(html, /id="file-review-other"/);
  assert.match(html, /id="file-review-fulltext"/);
  assert.match(html, /具体问题/);
  assert.match(html, /关键数据需要核对/);
  assert.match(html, /确认并用于诊断/);
  assert.match(html, /其他资料问题/);
  assert.match(html, /识别技术详情/);

  assert.match(js, /renderReportReview/);
  assert.match(js, /renderReportIssueCard/);
  assert.match(js, /calculation_error/);
  assert.match(js, /reportReviewEvidence/);
  assert.match(js, /renderLegacyFileReview/);
  assert.doesNotMatch(js, /function renderReportReview[\s\S]*?reviewModel\.importantIssues/);

  assert.match(css, /review-summary/);
  assert.match(css, /report-issue-card/);
  assert.match(css, /review-correction-card/);
});

test('technical OCR text is collapsed by default and not used as the main report result', () => {
  assert.match(html, /<details[^>]*id="file-review-fulltext"[^>]*>/);
  assert.doesNotMatch(html, /<details[^>]*id="file-review-fulltext"[^>]*open/);
  assert.match(js, /识别技术详情|file-review-fulltext/);
  assert.match(js, /原始 OCR 全文未作为诊断事实传入/);
});

test('mobile review layout avoids horizontal overflow and keeps issue values readable', () => {
  assert.match(css, /overflow-wrap:anywhere/);
  assert.match(css, /report-values/);
  assert.match(css, /review-correction-actions/);
  assert.match(css, /@media \(max-width:420px\)/);
});
