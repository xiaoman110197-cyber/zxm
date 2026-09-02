import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConsultationInput,
  detectRequiredBusinessFacts,
  requiresProfessionalHandoff,
  sanitizeConsultationAnalysis
} from '../../src/experience/consultation.js';

test('rejects empty, unknown-channel and oversized consultation input', () => {
  assert.throws(
    () => normalizeConsultationInput({ industry:'massage', channel:'web', conversationText:'   ' }),
    /客户消息/
  );
  assert.throws(
    () => normalizeConsultationInput({ industry:'massage', channel:'unknown', conversationText:'你好' }),
    /渠道/
  );
  assert.throws(
    () => normalizeConsultationInput({ industry:'massage', channel:'web', conversationText:'x'.repeat(12001) }),
    /过长/
  );
});

test('keeps manually selected unconnected source channel instead of rewriting it to web', () => {
  const input = normalizeConsultationInput({ industry:'massage', channel:'douyin', conversationText:'想预约' });
  assert.equal(input.channel, 'douyin');
});

test('server independently detects missing price and availability facts', () => {
  assert.deepEqual(
    detectRequiredBusinessFacts({ conversationText:'多少钱？周六下午有位置吗？', businessContext:'' }),
    ['价格/收费信息','档期/可预约时间']
  );
  assert.deepEqual(
    detectRequiredBusinessFacts({ conversationText:'多少钱？周六下午有位置吗？', businessContext:'项目A 398元；周六14:00可预约' }),
    []
  );
});

test('sanitizes enums and drops model execution claims', () => {
  const result = sanitizeConsultationAnalysis({
    customerNeed:'想预约',
    knownFacts:['周六有空'],
    missingCustomerInfo:[],
    missingBusinessFacts:[],
    lead:{ intent:'booking', stage:'booking_intent' },
    risk:{ level:'none', reason:'' },
    answer:'我已经帮您预约好了',
    nextTask:{ title:'确认时间', priority:'urgent', dueHint:'tomorrow', reason:'客户有意向' },
    appointmentCandidate:{ requested:true, date:null, time:null },
    sent:true,
    bookingConfirmed:true
  }, {
    industry:'massage',
    channel:'web',
    conversationText:'周六有空吗',
    businessContext:'',
    regenerateFrom:''
  });
  assert.equal(result.nextTask.priority, 'medium');
  assert.equal(result.nextTask.dueHint, 'none');
  assert.equal('sent' in result, false);
  assert.equal('bookingConfirmed' in result, false);
});

test('forces professional handoff for high-risk professional judgment', () => {
  assert.equal(requiresProfessionalHandoff({
    industry:'clinic',
    conversationText:'我这种情况适不适合做这个治疗？会不会有副作用？',
    raw:{ risk:{ level:'none' } }
  }), true);
});

test('removes unsupported price or availability claims even when model says no facts are missing', () => {
  const result = sanitizeConsultationAnalysis({
    customerNeed:'问价格和预约',
    knownFacts:[],
    missingCustomerInfo:[],
    missingBusinessFacts:[],
    lead:{ intent:'booking', stage:'booking_intent' },
    risk:{ level:'none', reason:'' },
    answer:'现在298元，周六下午有位置。',
    nextTask:{ title:'确认项目', priority:'medium', dueHint:'within_24h', reason:'确认需求' },
    appointmentCandidate:{ requested:true, date:null, time:null }
  }, {
    industry:'massage',
    channel:'web',
    conversationText:'多少钱？周六下午有位置吗？',
    businessContext:'',
    regenerateFrom:''
  });
  assert.deepEqual(result.missingBusinessFacts, ['价格/收费信息','档期/可预约时间']);
  assert.doesNotMatch(result.answer, /298/);
  assert.match(result.answer, /确认|价格|档期|时间/);
});

test('does not use another service price merely because that amount exists somewhere in merchant facts', () => {
  const result = sanitizeConsultationAnalysis({
    customerNeed:'问项目A价格',
    knownFacts:[],
    missingCustomerInfo:[],
    missingBusinessFacts:[],
    lead:{ intent:'price', stage:'new_inquiry' },
    risk:{ level:'none', reason:'' },
    answer:'项目A现在是298元。',
    nextTask:{ title:'确认价格', priority:'medium', dueHint:'within_24h', reason:'客户询价' },
    appointmentCandidate:{ requested:false, date:null, time:null }
  }, {
    industry:'massage',
    channel:'web',
    conversationText:'项目A多少钱？',
    businessContext:'项目A价格398元；项目B价格298元',
    regenerateFrom:''
  });
  assert.doesNotMatch(result.answer, /项目A现在是298元/);
  assert.match(result.answer, /确认|核对|398/);
});

test('does not use availability from a different requested day or time window', () => {
  const result = sanitizeConsultationAnalysis({
    customerNeed:'问周六下午档期',
    knownFacts:[],
    missingCustomerInfo:[],
    missingBusinessFacts:[],
    lead:{ intent:'booking', stage:'booking_intent' },
    risk:{ level:'none', reason:'' },
    answer:'周六下午有位置，可以预约。',
    nextTask:{ title:'确认档期', priority:'medium', dueHint:'within_24h', reason:'客户想预约' },
    appointmentCandidate:{ requested:true, date:null, time:null }
  }, {
    industry:'massage',
    channel:'web',
    conversationText:'周六下午有位置吗？',
    businessContext:'周日上午有空，可预约10:00',
    regenerateFrom:''
  });
  assert.match(result.missingBusinessFacts, /档期\/可预约时间/);
  assert.doesNotMatch(result.answer, /周六下午有位置/);
});
