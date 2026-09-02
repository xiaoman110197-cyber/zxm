import test from 'node:test';
import assert from 'node:assert/strict';
import { handleExperienceConsultationRequest } from '../../api/experience-consultation.js';

function mockRes(){
  return { statusCode:200, body:null, status(code){ this.statusCode=code; return this; }, json(value){ this.body=value; return this; }, setHeader(){} };
}

function validRaw(overrides={}){
  return {
    customerNeed:'客户想咨询价格并预约',
    knownFacts:['第一次来'],
    missingCustomerInfo:['具体项目'],
    missingBusinessFacts:[],
    lead:{ intent:'booking', stage:'booking_intent' },
    risk:{ level:'none', reason:'' },
    answer:'可以先告诉我具体项目，我再帮您确认。',
    nextTask:{ title:'确认项目', priority:'medium', dueHint:'within_24h', reason:'客户有预约意向' },
    appointmentCandidate:{ requested:true, date:null, time:null },
    ...overrides
  };
}

test('consultation API returns sanitized complete reply and preserves manually selected source channel', async () => {
  const res = mockRes();
  await handleExperienceConsultationRequest({ method:'POST', body:{
    industry:'massage', channel:'douyin', conversationText:'第一次来，想了解一下项目', businessContext:''
  } }, res, {
    requestId:'req-consult-1',
    provider:{ name:'deepseek', model:'test-model', analyzeExperienceConsultation:async () => validRaw() }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.requestId, 'req-consult-1');
  assert.equal(res.body.modelUsed, true);
  assert.equal(res.body.provider, 'DeepSeek');
  assert.equal(res.body.model, 'test-model');
  assert.match(res.body.analysis.answer, /告诉我|确认/);
  assert.equal(res.body.connector.channel, 'douyin');
  assert.equal(res.body.connector.enabled, false);
  assert.equal(res.body.connector.canSendExternally, false);
});

test('consultation API removes invented price and availability when merchant facts are missing', async () => {
  const res = mockRes();
  await handleExperienceConsultationRequest({ method:'POST', body:{
    industry:'massage', channel:'web', conversationText:'多少钱？周六下午有位置吗？', businessContext:''
  } }, res, {
    provider:{ name:'deepseek', model:'test-model', analyzeExperienceConsultation:async () => validRaw({
      missingBusinessFacts:[],
      answer:'现在298元，周六下午有位置。'
    }) }
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.analysis.missingBusinessFacts, ['价格/收费信息','档期/可预约时间']);
  assert.doesNotMatch(res.body.analysis.answer, /298/);
  assert.doesNotMatch(res.body.analysis.answer, /周六下午有位置/);
});

test('consultation API forces professional handoff even when model says risk none', async () => {
  const res = mockRes();
  await handleExperienceConsultationRequest({ method:'POST', body:{
    industry:'clinic', channel:'web', conversationText:'我这种情况适不适合做这个治疗？会不会有副作用？', businessContext:''
  } }, res, {
    provider:{ name:'deepseek', model:'test-model', analyzeExperienceConsultation:async () => validRaw({
      risk:{ level:'none', reason:'' },
      answer:'你适合做，可以放心。'
    }) }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.analysis.risk.level, 'required_professional_handoff');
  assert.match(res.body.analysis.answer, /专业人员|专业判断/);
  assert.doesNotMatch(res.body.analysis.answer, /适合做，可以放心/);
});

test('consultation API strips model execution-state fields', async () => {
  const res = mockRes();
  await handleExperienceConsultationRequest({ method:'POST', body:{
    industry:'massage', channel:'web', conversationText:'想预约', businessContext:''
  } }, res, {
    provider:{ name:'deepseek', model:'test-model', analyzeExperienceConsultation:async () => validRaw({ sent:true, bookingConfirmed:true }) }
  });
  assert.equal(res.statusCode, 200);
  assert.equal('sent' in res.body.analysis, false);
  assert.equal('bookingConfirmed' in res.body.analysis, false);
});

test('consultation API returns safe 503 when DeepSeek is unavailable', async () => {
  const res = mockRes();
  await handleExperienceConsultationRequest({ method:'POST', body:{
    industry:'massage', channel:'web', conversationText:'想了解一下', businessContext:''
  } }, res, {
    provider:{ name:'deepseek', model:'test-model', analyzeExperienceConsultation:async () => { throw new Error('secret upstream detail'); } }
  });
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /暂不可用/);
  assert.equal(JSON.stringify(res.body).includes('secret upstream detail'), false);
});

test('consultation API rejects unsupported method empty message unknown channel and oversized input', async () => {
  const cases = [
    [{ method:'GET', body:{} }, 405],
    [{ method:'POST', body:{ industry:'massage', channel:'web', conversationText:' ' } }, 400],
    [{ method:'POST', body:{ industry:'massage', channel:'unknown', conversationText:'你好' } }, 400],
    [{ method:'POST', body:{ industry:'massage', channel:'web', conversationText:'x'.repeat(12001) } }, 400]
  ];
  for (const [req, status] of cases) {
    const res = mockRes();
    await handleExperienceConsultationRequest(req, res, { provider:{ analyzeExperienceConsultation:async () => validRaw() } });
    assert.equal(res.statusCode, status);
  }
});
