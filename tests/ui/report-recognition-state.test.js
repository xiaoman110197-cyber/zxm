import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const js = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');

test('report UI distinguishes complete, degraded and unavailable recognition modes', () => {
  assert.match(js, /cloud_ocr_deepseek/);
  assert.match(js, /local_ocr_degraded/);
  assert.match(js, /ocr_unavailable/);
  assert.match(js, /completeReview/);
  assert.match(js, /reviewWarning/);
});

test('degraded zero-result copy cannot be mistaken for a clean report', () => {
  assert.match(js, /当前证据下没有发现可证明的错误/);
  assert.match(js, /不能据此判断报表没有问题/);
});

test('unavailable OCR blocks report confirmation and asks for a clearer upload', () => {
  assert.match(js, /这张报表还没有可靠识别/);
  assert.match(js, /重新上传更清晰/);
  const start = js.indexOf('function confirmPendingFileReview');
  const end = js.indexOf('\nfunction ', start + 10);
  const functionText = js.slice(start, end > start ? end : undefined);
  assert.match(functionText, /ocr_unavailable/);
});

test('finished progress copy does not call an incomplete report fully checked', () => {
  assert.match(js, /报表检查未完成/);
  assert.match(js, /报表识别未完成/);
});

test('degraded report warning exposes only the safe OCR failure code for diagnosis', () => {
  assert.match(js, /failureCode/);
  assert.match(js, /错误编号/);
  assert.match(js, /OCR_HTTP_/);
});
