import test from 'node:test';
import assert from 'node:assert/strict';
import { createCachedImageOcr } from '../../src/documents/ocr.js';

function workerResult(text = '营业额 88', confidence = 91) {
  return { data:{ text, confidence } };
}

test('uses a stable Node cache path for traineddata and terminates the worker after success', async () => {
  let receivedOptions;
  let terminateCount = 0;
  const progress = [];
  const imageOcr = createCachedImageOcr({
    cachePath:'/tmp/zhenduan-test-cache',
    createWorker: async (_langs, _oem, options) => {
      receivedOptions = options;
      options.logger?.({ status:'recognizing text', progress:0.5 });
      return {
        async recognize() { return workerResult(); },
        async terminate() { terminateCount += 1; }
      };
    }
  });

  const result = await imageOcr(Buffer.from('image'), (event) => progress.push(event));

  assert.equal(result.text, '营业额 88');
  assert.equal(result.confidence, 0.91);
  assert.equal(receivedOptions.cachePath, '/tmp/zhenduan-test-cache');
  assert.equal(terminateCount, 1);
  assert.equal(progress.length, 1);
});

test('sequential image requests create fresh workers but reuse the same traineddata cache location', async () => {
  const cachePaths = [];
  let createCount = 0;
  let terminateCount = 0;
  const imageOcr = createCachedImageOcr({
    cachePath:'/tmp/shared-tess-cache',
    createWorker: async (_langs, _oem, options) => {
      createCount += 1;
      cachePaths.push(options.cachePath);
      return {
        async recognize() { return workerResult(`image-${createCount}`, 90); },
        async terminate() { terminateCount += 1; }
      };
    }
  });

  const first = await imageOcr(Buffer.from('one'));
  const second = await imageOcr(Buffer.from('two'));

  assert.equal(first.text, 'image-1');
  assert.equal(second.text, 'image-2');
  assert.equal(createCount, 2);
  assert.equal(terminateCount, 2);
  assert.deepEqual(cachePaths, ['/tmp/shared-tess-cache','/tmp/shared-tess-cache']);
});

test('terminates an initialized worker even when recognition fails', async () => {
  let terminateCount = 0;
  const imageOcr = createCachedImageOcr({
    createWorker: async () => ({
      async recognize() { throw new Error('worker crashed'); },
      async terminate() { terminateCount += 1; }
    })
  });

  await assert.rejects(() => imageOcr(Buffer.from('bad')), /worker crashed/);
  assert.equal(terminateCount, 1);
});
