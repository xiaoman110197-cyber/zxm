import test from 'node:test';
import assert from 'node:assert/strict';
import { createReusableImageOcr } from '../../src/documents/ocr.js';

function workerResult(text = '营业额 88', confidence = 91) {
  return { data:{ text, confidence } };
}

test('reuses one OCR worker for sequential images instead of reinitializing every request', async () => {
  let createCount = 0;
  let recognizeCount = 0;
  let terminateCount = 0;
  let logger;
  const worker = {
    async recognize() {
      recognizeCount += 1;
      logger?.({ status:'recognizing text', progress:0.5 });
      return workerResult();
    },
    async terminate() { terminateCount += 1; }
  };
  const imageOcr = createReusableImageOcr({
    createWorker: async (_langs, _oem, options) => {
      createCount += 1;
      logger = options.logger;
      return worker;
    }
  });

  const firstProgress = [];
  const secondProgress = [];
  const first = await imageOcr(Buffer.from('one'), (event) => firstProgress.push(event));
  const second = await imageOcr(Buffer.from('two'), (event) => secondProgress.push(event));

  assert.equal(first.text, '营业额 88');
  assert.equal(second.confidence, 0.91);
  assert.equal(createCount, 1);
  assert.equal(recognizeCount, 2);
  assert.equal(terminateCount, 0);
  assert.ok(firstProgress.length > 0);
  assert.ok(secondProgress.length > 0);
});

test('serializes overlapping OCR calls so one Tesseract worker never recognizes concurrently', async () => {
  let active = 0;
  let maxActive = 0;
  const worker = {
    async recognize(buffer) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, buffer.toString() === 'first' ? 10 : 1));
      active -= 1;
      return workerResult(buffer.toString(), 80);
    },
    async terminate() {}
  };
  const imageOcr = createReusableImageOcr({ createWorker: async () => worker });

  const [first, second] = await Promise.all([
    imageOcr(Buffer.from('first')),
    imageOcr(Buffer.from('second'))
  ]);

  assert.equal(maxActive, 1);
  assert.equal(first.text, 'first');
  assert.equal(second.text, 'second');
});

test('discards a failed worker so the next image gets a fresh worker', async () => {
  let createCount = 0;
  let terminateCount = 0;
  const imageOcr = createReusableImageOcr({
    createWorker: async () => {
      createCount += 1;
      const thisWorker = createCount;
      return {
        async recognize() {
          if (thisWorker === 1) throw new Error('worker crashed');
          return workerResult('恢复成功', 95);
        },
        async terminate() { terminateCount += 1; }
      };
    }
  });

  await assert.rejects(() => imageOcr(Buffer.from('bad')), /worker crashed/);
  const recovered = await imageOcr(Buffer.from('good'));

  assert.equal(createCount, 2);
  assert.equal(terminateCount, 1);
  assert.equal(recovered.text, '恢复成功');
});
