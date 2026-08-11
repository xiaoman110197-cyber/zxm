import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeReportImage } from '../../src/report/qianfan-ocr.js';

test('sends one Base64 image to Qianfan deepseek-ocr and returns message content', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init, body:JSON.parse(init.body) };
    return new Response(JSON.stringify({
      choices:[{ message:{ content:'| 区域 | 收入 | 成本 | 毛利率 |\n| 华南 | 9800 | 6100 | 85% |' } }]
    }), { status:200, headers:{ 'Content-Type':'application/json' } });
  };

  const result = await recognizeReportImage({
    name:'report.png',
    mimeType:'image/png',
    buffer:Buffer.from('abc')
  }, { apiKey:'  qianfan-key  ', fetchImpl });

  assert.equal(seen.url, 'https://qianfan.baidubce.com/v2/chat/completions');
  assert.equal(seen.init.headers.Authorization, 'Bearer qianfan-key');
  assert.equal(seen.body.model, 'deepseek-ocr');
  assert.equal(seen.body.messages.length, 1);
  assert.equal(seen.body.messages[0].role, 'user');
  assert.match(seen.body.messages[0].content[0].text, /Convert the document to markdown|Parse the figure/);
  assert.equal(seen.body.messages[0].content[1].type, 'image_url');
  assert.match(seen.body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(result.available, true);
  assert.equal(result.provider, 'qianfan');
  assert.equal(result.failureCode, null);
  assert.match(result.text, /华南/);
});

test('returns safe HTTP code and never logs API key or provider body', async () => {
  const logs = [];
  const result = await recognizeReportImage({ mimeType:'image/png', buffer:Buffer.from('x') }, {
    apiKey:'secret-qianfan-key',
    fetchImpl:async () => new Response('{"error":"secret provider body"}', { status:429 }),
    logWarn:(...args) => logs.push(args.join(' '))
  });
  assert.equal(result.failureCode, 'OCR_HTTP_429');
  assert.equal(result.available, false);
  assert.doesNotMatch(logs.join('\n'), /secret-qianfan-key|secret provider body/);
  assert.doesNotMatch(result.warning, /secret-qianfan-key|secret provider body/);
});

test('classifies timeout as OCR_TIMEOUT', async () => {
  const result = await recognizeReportImage({ mimeType:'image/png', buffer:Buffer.from('x') }, {
    apiKey:'k',
    timeoutMs:5,
    fetchImpl:(_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name:'AbortError' })));
    })
  });
  assert.equal(result.failureCode, 'OCR_TIMEOUT');
});

for (const [code, expected] of [
  ['ENOTFOUND', 'OCR_DNS_ERROR'],
  ['EAI_AGAIN', 'OCR_DNS_ERROR'],
  ['UND_ERR_CONNECT_TIMEOUT', 'OCR_CONNECT_TIMEOUT'],
  ['ETIMEDOUT', 'OCR_CONNECT_TIMEOUT'],
  ['ECONNRESET', 'OCR_CONNECTION_RESET'],
  ['UND_ERR_SOCKET', 'OCR_CONNECTION_RESET'],
  ['CERT_HAS_EXPIRED', 'OCR_TLS_ERROR'],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'OCR_TLS_ERROR']
]) {
  test(`classifies ${code} as ${expected}`, async () => {
    const result = await recognizeReportImage({ mimeType:'image/png', buffer:Buffer.from('x') }, {
      apiKey:'k',
      fetchImpl:async () => { throw Object.assign(new Error('network'), { cause:{ code } }); }
    });
    assert.equal(result.failureCode, expected);
  });
}

test('classifies invalid response JSON and empty output safely', async () => {
  const badJson = await recognizeReportImage({ mimeType:'image/png', buffer:Buffer.from('x') }, {
    apiKey:'k',
    fetchImpl:async () => new Response('not-json', { status:200 })
  });
  assert.equal(badJson.failureCode, 'OCR_RESPONSE_JSON');

  const empty = await recognizeReportImage({ mimeType:'image/png', buffer:Buffer.from('x') }, {
    apiKey:'k',
    fetchImpl:async () => new Response(JSON.stringify({ choices:[{ message:{ content:'   ' } }] }), { status:200 })
  });
  assert.equal(empty.failureCode, 'OCR_EMPTY_OUTPUT');
});

test('rejects unsupported image MIME type before network dispatch', async () => {
  let called = false;
  const result = await recognizeReportImage({ mimeType:'application/pdf', buffer:Buffer.from('x') }, {
    apiKey:'k',
    fetchImpl:async () => { called = true; throw new Error('should not run'); }
  });
  assert.equal(called, false);
  assert.equal(result.failureCode, 'OCR_UNSUPPORTED_IMAGE');
});

test('missing key returns safe failure without network dispatch', async () => {
  let called = false;
  const result = await recognizeReportImage({ mimeType:'image/jpeg', buffer:Buffer.from('x') }, {
    apiKey:'   ',
    fetchImpl:async () => { called = true; throw new Error('should not run'); }
  });
  assert.equal(called, false);
  assert.equal(result.failureCode, 'OCR_KEY_MISSING');
});
