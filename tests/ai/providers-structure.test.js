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

test('V7 DeepSeek provider answers arbitrary boss questions from deterministic context without recalculating profit', async () => {
  let body;
  const provider = createDeepSeekProvider({
    apiKey:'deepseek-key',
    fetchImpl:async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        choices:[{ message:{ content:JSON.stringify({
          overview:'今天有几项经营问题需要先处理。',
          cost:'重复整理可以继续减少。',
          efficiency:'优先处理逾期任务。',
          profit:'需要成本或毛利率才能判断利润。',
          actions:['先处理逾期任务'],
          limits:['利润数据不足']
        }) } }]
      }), { status:200 });
    }
  });
  assert.equal(typeof provider.answerExperienceQuestion, 'function');
  const result = await provider.answerExperienceQuestion({
    question:'为什么今天看起来营业额还可以但你不说利润好？',
    context:{ facts:{ revenue:11860 }, derived:{}, availability:{ profit:false }, unavailable:['利润/毛利'] },
    history:[{ role:'owner', text:'今天怎样？' }, { role:'assistant', text:'营业额已确认，但利润暂时无法判断。' }]
  });
  assert.deepEqual(body.thinking, { type:'disabled' });
  assert.match(body.messages[0].content, /营业额.*不.*利润|利润.*营业额/);
  assert.match(body.messages[0].content, /不得重新计算|不要重新计算/);
  assert.match(body.messages[0].content, /history|历史|前文/);
  assert.deepEqual(result.actions, ['先处理逾期任务']);
});
