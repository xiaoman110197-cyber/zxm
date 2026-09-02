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

test('DeepSeek provider analyzes customer consultation into a complete reply without send authority or invented business facts', async () => {
  let body;
  const expected = {
    customerNeed:'客户想了解价格并预约周六下午',
    knownFacts:['客户第一次来'],
    missingCustomerInfo:['具体项目'],
    missingBusinessFacts:['价格/收费信息','档期/可预约时间'],
    lead:{ intent:'booking', stage:'booking_intent' },
    risk:{ level:'none', reason:'' },
    answer:'可以先告诉我具体想咨询哪个项目，我确认价格和周六档期后再准确回复您。',
    nextTask:{ title:'确认项目与时间', priority:'medium', dueHint:'within_24h', reason:'客户有预约意向' },
    appointmentCandidate:{ requested:true, date:null, time:null }
  };
  const provider = createDeepSeekProvider({
    apiKey:'deepseek-key',
    fetchImpl:async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices:[{ message:{ content:JSON.stringify(expected) } }] }), { status:200 });
    }
  });

  assert.equal(typeof provider.analyzeExperienceConsultation, 'function');
  const result = await provider.analyzeExperienceConsultation({
    industry:'massage',
    channel:'douyin',
    conversationText:'第一次来，多少钱？周六下午能约吗？',
    businessContext:'',
    regenerateFrom:''
  });

  const systemPrompt = body.messages[0].content;
  assert.deepEqual(body.thinking, { type:'disabled' });
  assert.deepEqual(body.response_format, { type:'json_object' });
  assert.match(systemPrompt, /完整.*回复|完整回复/);
  assert.match(systemPrompt, /不能自行发送|没有发送权/);
  assert.match(systemPrompt, /不得编造.*价格|价格.*不得编造/);
  assert.match(systemPrompt, /档期|可预约/);
  assert.match(systemPrompt, /专业人员|人工接手/);
  assert.match(systemPrompt, /不可信业务输入/);
  assert.match(systemPrompt, /customerNeed/);
  assert.match(systemPrompt, /appointmentCandidate/);
  assert.doesNotMatch(systemPrompt, /"sent"|bookingConfirmed/);
  assert.deepEqual(result, expected);
});
