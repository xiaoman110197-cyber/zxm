import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeReportImage } from '../../src/report/qianfan-ocr.js';

test('preserves allowlisted Qianfan 401 subtype without exposing provider message or API key', async () => {
  const logs = [];
  const result = await recognizeReportImage({ mimeType:'image/png', buffer:Buffer.from('x') }, {
    apiKey:'bce-v3/secret-key',
    fetchImpl:async () => new Response(JSON.stringify({
      type:'invalid_request_error',
      code:'invalid_iam_token',
      message:'IAM Certification failed and includes sensitive provider detail'
    }), { status:401, headers:{ 'Content-Type':'application/json' } }),
    logWarn:(...args) => logs.push(args.join(' '))
  });

  assert.equal(result.failureCode, 'OCR_HTTP_401_INVALID_IAM_TOKEN');
  assert.match(result.warning, /OCR_HTTP_401_INVALID_IAM_TOKEN/);
  assert.doesNotMatch(result.warning, /IAM Certification failed|sensitive provider detail|secret-key/);
  assert.doesNotMatch(logs.join('\n'), /IAM Certification failed|sensitive provider detail|secret-key/);
});

test('does not reflect unknown provider error codes into user-visible diagnostics', async () => {
  const result = await recognizeReportImage({ mimeType:'image/png', buffer:Buffer.from('x') }, {
    apiKey:'k',
    fetchImpl:async () => new Response(JSON.stringify({
      type:'private_internal_type',
      code:'customer-secret-code-123',
      message:'private body'
    }), { status:401, headers:{ 'Content-Type':'application/json' } })
  });

  assert.equal(result.failureCode, 'OCR_HTTP_401');
  assert.doesNotMatch(result.warning, /customer-secret-code-123|private body/);
});
