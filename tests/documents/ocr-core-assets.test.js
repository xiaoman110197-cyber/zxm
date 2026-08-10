import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBundledImageOcr } from '../../src/documents/ocr.js';

test('passes an explicit tesseract.js-core directory into createWorker', async () => {
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

  assert.equal(typeof receivedOptions.corePath, 'string');
  assert.match(receivedOptions.corePath, /node_modules[\\/]tesseract\.js-core$/);
});

test('Vercel analyze-file bundle explicitly includes OCR worker core and Chinese traineddata assets', async () => {
  const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const includeFiles = config.functions?.['api/analyze-file.js']?.includeFiles;
  assert.equal(typeof includeFiles, 'string');
  assert.match(includeFiles, /tesseract\.js\/src\/worker-script\/node/);
  assert.match(includeFiles, /tesseract\.js-core/);
  assert.match(includeFiles, /@tesseract\.js-data\/chi_sim/);
});
