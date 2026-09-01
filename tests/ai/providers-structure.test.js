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
  assert.match(body.messages[0].content, /表头.*数据行|数据行.*表头/);
  assert.deepEqual(result, { facts:[], candidates:[], confirmations:[] });
});

test('DeepSeek provider maps ambiguous spreadsheet headers without asking for raw rows', async () => {
  let body;
  const provider = createDeepSeekProvider({
    apiKey:'deepseek-key',
    fetchImpl:async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        choices:[{ message:{ content:JSON.stringify({ mappings:[{ sheet:'门店流水', header:'到账口径', field:'amount', confidence:.91, reason:'表示到账金额' }] }) } }]
      }), { status:200 });
    }
  });
  const input = {
    canonicalFields:[{ field:'amount', label:'金额/营业额' }],
    sheets:[{ name:'门店流水', rowCount:10, columns:[{ header:'到账口径', stats:{ nonEmpty:10, blank:0, number:10, date:0, boolean:0, text:0 } }] }]
  };
  const result = await provider.mapExperienceFields(input);
  assert.deepEqual(body.thinking, { type:'disabled' });
  assert.match(body.messages[0].content, /字段映射/);
  assert.match(body.messages[0].content, /不确定.*不要|不要.*猜/);
  assert.match(body.messages[0].content, /原始.*业务行|业务行.*原始/);
  assert.deepEqual(result.mappings[0], { sheet:'门店流水', header:'到账口径', field:'amount', confidence:.91, reason:'表示到账金额' });
});
