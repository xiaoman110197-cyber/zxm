import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');

test('image report review must be confirmed before trusted facts enter diagnosis', () => {
  assert.match(html, /id="file-review"/);
  assert.match(html, /id="file-review-text"/);
  assert.match(html, /id="file-errors"/);
  assert.match(html, /id="confirm-file"/);
  assert.match(html, /id="replace-file"/);
  assert.match(html, /确认并用于诊断/);
  assert.match(html, /重新上传/);

  assert.match(js, /pendingFileReview/);
  assert.match(js, /renderFileReview/);
  assert.match(js, /renderReportReview/);
  assert.match(js, /confirmPendingFileReview/);
  assert.match(js, /document\?*\.type\s*===\s*['"]image['"]/);
  assert.match(js, /analysisTokens/);
  assert.doesNotMatch(js, /`report_fact:/);
  assert.doesNotMatch(js, /`report_review_confirmation:/);

  assert.match(
    js,
    /function applySuccessfulFileAnalysis[\s\S]*?if \(result\.document\?\.type === 'image'\) \{[\s\S]*?renderFileReview\(file, contentBase64, result\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?commitSuccessfulFileAnalysis\(file, contentBase64, result\);/
  );
  assert.match(
    js,
    /function confirmPendingFileReview[\s\S]*?commitSuccessfulFileAnalysis\(pending\.file, pending\.contentBase64, pending\.result, correctionDecisions\)/
  );
  assert.match(
    js,
    /function diagnosisDocument[\s\S]*?reportReview[\s\S]*?warnings:\['原始 OCR 全文未作为诊断事实传入；诊断使用已验证的结构化报表事实。'\]/
  );
  assert.match(
    js,
    /function commitSuccessfulFileAnalysis[\s\S]*?state\.diagnosis\.documents = \[diagnosisDocument\(result\)\]/
  );

  assert.match(css, /file-review/);
  assert.match(css, /file-review-text/);
});
