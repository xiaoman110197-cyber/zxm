import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBundledImageOcr } from '../../src/documents/ocr.js';

const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));

function workerResult(text = '营业额 88', confidence = 91, blocks = null) {
  return { data:{ text, confidence, blocks } };
}

function blockWithWords(words) {
  return [{
    paragraphs:[{
      lines:[{
        text:words.map((word) => word.text).join(' '),
        words
      }]
    }]
  }];
}

test('ships only the simplified-Chinese traineddata needed for Chinese business screenshots', () => {
  assert.equal(pkg.dependencies?.['@tesseract.js-data/chi_sim'], '1.0.0');
  assert.equal(pkg.dependencies?.['@tesseract.js-data/eng'], undefined);
});

test('uses one simplified-Chinese worker with bundled local langPath and terminates after success', async () => {
  let receivedLanguages;
  let receivedOptions;
  let terminateCount = 0;
  const progress = [];
  const imageOcr = createBundledImageOcr({
    prepareTessdata: async () => '/tmp/zhenduan-local-tessdata',
    createWorker: async (languages, _oem, options) => {
      receivedLanguages = languages;
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
  assert.equal(receivedLanguages, 'chi_sim');
  assert.equal(receivedOptions.langPath, '/tmp/zhenduan-local-tessdata');
  assert.equal(receivedOptions.cachePath, '/tmp/zhenduan-local-tessdata');
  assert.equal(terminateCount, 1);
  assert.equal(progress.length, 1);
});

test('requests block output and returns concrete low-confidence words for review', async () => {
  let recognizeArgs;
  const imageOcr = createBundledImageOcr({
    prepareTessdata: async () => '/tmp/local-tessdata',
    createWorker: async () => ({
      async recognize(...args) {
        recognizeArgs = args;
        return workerResult('营业额 2865O\n客单价 38.5', 47, blockWithWords([
          { text:'营业额', confidence:93 },
          { text:'2865O', confidence:31 },
          { text:'客单价', confidence:90 },
          { text:'38.5', confidence:84 }
        ]));
      },
      async terminate() {}
    })
  });

  const result = await imageOcr(Buffer.from('image'));

  assert.deepEqual(recognizeArgs?.[2], { blocks:true });
  assert.deepEqual(result.uncertainSegments, [
    { text:'2865O', confidence:0.31, context:'营业额 2865O 客单价 38.5' }
  ]);
});

test('does not invent uncertain segments when block details are unavailable', async () => {
  const imageOcr = createBundledImageOcr({
    prepareTessdata: async () => '/tmp/local-tessdata',
    createWorker: async () => ({
      async recognize() { return workerResult('营业额 88', 47, null); },
      async terminate() {}
    })
  });

  const result = await imageOcr(Buffer.from('image'));
  assert.deepEqual(result.uncertainSegments, []);
});

test('sequential image requests reuse local traineddata but create fresh workers', async () => {
  let prepareCount = 0;
  let createCount = 0;
  let terminateCount = 0;
  const imageOcr = createBundledImageOcr({
    prepareTessdata: async () => {
      prepareCount += 1;
      return '/tmp/local-tessdata';
    },
    createWorker: async () => {
      createCount += 1;
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
  assert.equal(prepareCount, 2);
  assert.equal(createCount, 2);
  assert.equal(terminateCount, 2);
});

test('terminates an initialized worker even when recognition fails', async () => {
  let terminateCount = 0;
  const imageOcr = createBundledImageOcr({
    prepareTessdata: async () => '/tmp/local-tessdata',
    createWorker: async () => ({
      async recognize() { throw new Error('worker crashed'); },
      async terminate() { terminateCount += 1; }
    })
  });

  await assert.rejects(() => imageOcr(Buffer.from('bad')), /worker crashed/);
  assert.equal(terminateCount, 1);
});

test('times out worker initialization and terminates a worker that resolves late', async () => {
  let recognizeCount = 0;
  let terminateCount = 0;
  const imageOcr = createBundledImageOcr({
    workerInitTimeoutMs: 10,
    prepareTessdata: async () => '/tmp/local-tessdata',
    createWorker: async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
      return {
        async recognize() { recognizeCount += 1; return workerResult(); },
        async terminate() { terminateCount += 1; }
      };
    }
  });

  await assert.rejects(
    () => imageOcr(Buffer.from('slow')),
    (error) => error?.code === 'OCR_INIT_TIMEOUT' && /初始化|timeout/i.test(error.message)
  );

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(recognizeCount, 0);
  assert.equal(terminateCount, 1);
});
