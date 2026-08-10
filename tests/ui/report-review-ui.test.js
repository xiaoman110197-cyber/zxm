import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');

test('report image review leads with concrete report problems rather than OCR confidence', () => {
  assert.match(html, /报表检查完成/);
  assert.match(html, /具体问题/);
  assert.match(html, /关键数据需要核对/);
  assert.match(js, /result\.reportReview/);
  assert.match(js, /renderReportIssueCard/);
  assert.match(js, /计算错误/);
  assert.match(js, /数据逻辑错误/);
  assert.match(js, /异常，需核对/);
  assert.match(js, /关键数据需核对/);

  const reportReviewStart = js.indexOf('function renderReportReview');
  assert.ok(reportReviewStart >= 0, 'report review renderer should exist');
  const reportReviewEnd = js.indexOf('\nfunction ', reportReviewStart + 10);
  const renderer = js.slice(reportReviewStart, reportReviewEnd > reportReviewStart ? reportReviewEnd : undefined);
  assert.doesNotMatch(renderer, /图片整体识别质量/);
  assert.doesNotMatch(renderer, /reviewModel\.importantIssues/);
  assert.doesNotMatch(renderer, /uncertainSegments/);
});

test('correct result is rendered only when a program-proven calculation has correctedValue', () => {
  assert.match(js, /issue\.kind\s*===\s*['"]calculation_error['"]/);
  assert.match(js, /correctedValue/);
  assert.match(js, /正确结果/);
  assert.match(js, /issue\.source\s*===\s*['"]program['"]/);
});

test('OCR text is kept only as optional technical detail for report images', () => {
  assert.match(html, /识别技术详情/);
  assert.match(html, /id="file-review-fulltext"/);
  assert.match(js, /file-review-fulltext/);
});

test('confirmed report review is preserved as diagnosis evidence without turning anomalies into corrections', () => {
  assert.match(js, /report_issue:/);
  assert.match(js, /report_review_confirmation:/);
  assert.match(css, /report-issue-card/);
  assert.match(css, /report-review-lead/);
});
