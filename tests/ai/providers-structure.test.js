import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekProvider } from '../../src/ai/providers.js';

test('DeepSeek provider structures OCR text with JSON output and non-thinking mode', async () => {
  let body;
  const provider = createDeepSeekProvider({
    apiKey:'deepseek-key',
    fetchImpl:async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        choices:[{ message:{ content:JSON.stringify({ facts:[], candidates:[], confirmations:[] }) } }]
      }), { status:200 });
    }
  });

  const result = await provider.structureReport({
    text:'华南 收入 9800 成本 6100 毛利率 85%',
    source:'qianfan_ocr',
    degraded:false
  });

  assert.equal(body.model, 'deepseek-v4-flash');
  assert.deepEqual(body.thinking, { type:'disabled' });
  assert.deepEqual(body.response_format, { type:'json_object' });
  assert.match(body.messages[0].content, /不得生成 correctedValue/);
  assert.match(body.messages[0].content, /sourceText/);
  assert.deepEqual(result, { facts:[], candidates:[], confirmations:[] });
});
