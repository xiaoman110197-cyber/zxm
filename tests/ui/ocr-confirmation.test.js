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

  assert.match(
    js,
    /function applySuccessfulFileAnalysis[\s\S]*?if \(result\.document\?\.type === 'image'\) \{[\s\S]*?renderFileReview\(file, contentBase64, result\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?commitSuccessfulFileAnalysis\(file, contentBase64, result\);/
  );
  assert.match(
    js,
    /function commitSuccessfulFileAnalysis[\s\S]*?state\.diagnosis\.documents = \[result\.document\]/
  );

  assert.match(css, /file-review/);
  assert.match(css, /file-review-text/);
});
