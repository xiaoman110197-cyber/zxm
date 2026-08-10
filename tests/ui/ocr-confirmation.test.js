import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');

test('image OCR requires merchant confirmation before the document enters diagnosis', () => {
  assert.match(html, /id="file-review"/);
  assert.match(html, /id="file-review-text"/);
  assert.match(html, /id="confirm-file"/);
  assert.match(html, /id="replace-file"/);
  assert.match(html, /确认无误/);
  assert.match(html, /重新上传/);

  assert.match(js, /pendingFileReview/);
  assert.match(js, /renderFileReview/);
  assert.match(js, /confirmPendingFileReview/);
  assert.match(js, /document\?*\.type\s*===\s*['"]image['"]/);
  assert.match(js, /识别结果可能存在误差/);
  assert.match(js, /请先确认识别内容/);

  const imageReviewIndex = js.indexOf("result.document?.type === 'image'");
  const diagnosisCommitIndex = js.indexOf('state.diagnosis.documents = [result.document]');
  assert.ok(imageReviewIndex >= 0, 'image review gate should exist');
  assert.ok(diagnosisCommitIndex >= 0, 'confirmed document commit should still exist');
  assert.ok(imageReviewIndex < diagnosisCommitIndex, 'image review gate should be evaluated before diagnosis commit');

  assert.match(css, /file-review/);
  assert.match(css, /file-review-text/);
});
