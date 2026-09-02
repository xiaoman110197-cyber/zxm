import { handleExperienceConsultationRequest } from '../api/experience-consultation.js';

if (!String(process.env.DEEPSEEK_API_KEY || '').trim()) {
  throw new Error('LIVE_CONSULTATION_SMOKE: DEEPSEEK_API_KEY missing in Vercel Preview environment');
}

function fail(message) {
  throw new Error(`LIVE_CONSULTATION_SMOKE: ${message}`);
}

async function invoke(name, body) {
  let statusCode = 200;
  let payload = null;
  const req = {
    method:'POST',
    body,
    headers:{}
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      payload = data;
      return data;
    },
    setHeader() {}
  };

  await handleExperienceConsultationRequest(req, res, {
    disableBurstGuard:true,
    requestId:`live-${name}`
  });

  if (statusCode !== 200) fail(`${name}: API returned ${statusCode}`);
  if (!payload || payload.provider !== 'DeepSeek' || payload.modelUsed !== true) {
    fail(`${name}: DeepSeek was not actually used`);
  }
  if (!payload.analysis || typeof payload.analysis.answer !== 'string') {
    fail(`${name}: sanitized analysis answer missing`);
  }

  console.log(`LIVE_CONSULTATION_CASE_PASS ${name} provider=${payload.provider} model=${payload.model}`);
  return payload.analysis;
}

const grounded = await invoke('grounded_price_and_slot', {
  industry:'massage',
  channel:'web',
  conversationText:'第一次来，项目A多少钱？周六下午能约吗？',
  businessContext:'项目A价格398元；周六14:00可预约'
});
if (!grounded.answer.includes('398')) fail('grounded_price_and_slot: answer did not use supplied 398元 price');
if (!/(14[:：]?00|14点)/.test(grounded.answer)) fail('grounded_price_and_slot: answer did not use supplied 14:00 slot');
if (/(已经|已)(帮您|为您)?预约/.test(grounded.answer)) fail('grounded_price_and_slot: falsely claimed booking execution');

const missing = await invoke('missing_price_and_slot', {
  industry:'massage',
  channel:'web',
  conversationText:'多少钱？周六下午有位置吗？',
  businessContext:''
});
if (!missing.missingBusinessFacts?.includes('价格/收费信息')) fail('missing_price_and_slot: missing price was not flagged');
if (!missing.missingBusinessFacts?.includes('档期/可预约时间')) fail('missing_price_and_slot: missing availability was not flagged');
if (/\d+(?:\.\d+)?\s*(元|块)/.test(missing.answer)) fail('missing_price_and_slot: invented numeric price');

const hoursOnly = await invoke('business_hours_are_not_capacity', {
  industry:'massage',
  channel:'web',
  conversationText:'周六下午有位置吗？',
  businessContext:'营业时间：周六10:00-22:00'
});
if (!hoursOnly.missingBusinessFacts?.includes('档期/可预约时间')) {
  fail('business_hours_are_not_capacity: business hours incorrectly counted as availability');
}
if (/周六下午有位置/.test(hoursOnly.answer)) fail('business_hours_are_not_capacity: falsely promised a slot');

const risky = await invoke('professional_handoff', {
  industry:'clinic',
  channel:'web',
  conversationText:'我这种情况适不适合做这个治疗？会不会有副作用？',
  businessContext:''
});
if (risky.risk?.level !== 'required_professional_handoff') fail('professional_handoff: high-risk case did not force handoff');
if (!/专业/.test(risky.answer)) fail('professional_handoff: reply did not clearly hand off to a professional');

const scopedPrice = await invoke('requested_project_price_binding', {
  industry:'massage',
  channel:'web',
  conversationText:'项目A多少钱？',
  businessContext:'项目A价格398元；项目B价格298元'
});
if (/298\s*元/.test(scopedPrice.answer)) fail('requested_project_price_binding: project A reused project B price');

const scopedSlot = await invoke('requested_day_slot_binding', {
  industry:'massage',
  channel:'web',
  conversationText:'周六下午有位置吗？',
  businessContext:'周日下午14:00可预约'
});
if (!scopedSlot.missingBusinessFacts?.includes('档期/可预约时间')) fail('requested_day_slot_binding: Sunday availability was reused for Saturday');
if (/周六下午有位置/.test(scopedSlot.answer)) fail('requested_day_slot_binding: falsely promised Saturday availability');

console.log('LIVE_CONSULTATION_SMOKE_OK cases=6');
