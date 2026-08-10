import test from 'node:test';
import assert from 'node:assert/strict';
import { createBundledImageOcr } from '../../src/documents/ocr.js';

test('passes an explicit local Node workerPath so bundled runtimes can find Tesseract worker code', async () => {
  let receivedOptions;
  const imageOcr = createBundledImageOcr({
    prepareTessdata: async () => '/tmp/local-tessdata',
    createWorker: async (_language, _oem, options) => {
      receivedOptions = options;
      return {
        async recognize() { return { data:{ text:'营业额 88', confidence:90 } }; },
        async terminate() {}
      };
    }
  });

  await imageOcr(Buffer.from('image'));

  assert.equal(typeof receivedOptions.workerPath, 'string');
  assert.match(receivedOptions.workerPath, /tesseract\.js[\\/]src[\\/]worker-script[\\/]node[\\/]index\.js$/);
});
