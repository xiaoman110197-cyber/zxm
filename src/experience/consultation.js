export const CHANNELS = new Set(['web','wecom','feishu','dingtalk','workbuddy','douyin']);
export const INTENTS = new Set(['price','booking','service_fit','followup','aftersales','complaint','other']);
export const STAGES = new Set(['new_inquiry','qualified','booking_intent','followup','aftersales']);
export const RISK_LEVELS = new Set(['none','human_review','required_professional_handoff']);
export const PRIORITIES = new Set(['low','medium','high']);
export const DUE_HINTS = new Set(['today','within_24h','before_appointment','none']);

const MAX_CONVERSATION_CHARS = 12000;
const MAX_BUSINESS_CONTEXT_CHARS = 4000;
const MAX_REGENERATE_CHARS = 2000;
const MAX_TEXT_CHARS = 1200;
const MAX_LIST_ITEMS = 12;

const PRICE_QUESTION = /(多少钱|价格|收费|费用|价位|优惠)/i;
const PRICE_EVIDENCE = /(?:¥|￥)\s*\d|\d+(?:\.\d+)?\s*(?:元|块)|(?:价格|收费|费用|价位|优惠)\s*[:：]?\s*\d/i;
const AVAILABILITY_QUESTION = /(有位置|有空|档期|能约|预约.*时间|周[一二三四五六日天]|几点)/i;
const AVAILABILITY_EVIDENCE = /(可预约|可以预约|有空|有档期|有位置|有名额|可安排|可以安排|满约|已满|无空位|没位置|没有位置|不可预约|不能预约)/i;
const AVAILABILITY_CLAIM = /(可预约|可以预约|有空|有档期|有位置|有名额|可安排|可以安排|满约|已满|无空位|没位置|没有位置|不可预约|不能预约)/i;

const HIGH_RISK_INDUSTRIES = new Set([
  'clinic',
  'medical_aesthetic',
  'dental',
  'tcm',
  'legal',
  'insurance'
]);
const PROFESSIONAL_JUDGMENT_PATTERN = /(适不适合|能不能做|诊断|治疗方案|用药|副作用|疗效|治好|胜诉|法律责任|违法吗|怎么判|能不能赔|理赔结论|核保|承保)/i;
const EXECUTION_CLAIM_PATTERN = /(已经|已)(?:帮您|为您)?(?:预约|预订|发送|付款|下单|确认成功)|(?:预约|预订|付款|下单)(?:已经|已)成功/i;

function cleanText(value, max = MAX_TEXT_CHARS) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanOptionalText(value, max = MAX_TEXT_CHARS) {
  const text = cleanText(value, max);
  return text || null;
}

function cleanList(value, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const text = cleanText(item, 260);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

function enumValue(value, allowed, fallback) {
  const normalized = String(value ?? '').trim();
  return allowed.has(normalized) ? normalized : fallback;
}

function boundedInput(value, { name, max, required = false }) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`${name}不能为空`);
  if (text.length > max) throw new Error(`${name}过长，请缩短或分段后再试`);
  return text;
}

function normalizeMoneyAmount(value) {
  const number = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(number) ? String(number) : null;
}

function moneyClaims(text = '') {
  const source = String(text || '');
  const patterns = [
    /(?:¥|￥)\s*(\d[\d,]*(?:\.\d+)?)/g,
    /(\d[\d,]*(?:\.\d+)?)\s*(?:元|块)/g,
    /(?:价格|收费|费用|价位|优惠)\s*[:：]?\s*(\d[\d,]*(?:\.\d+)?)/g
  ];
  const values = new Set();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const normalized = normalizeMoneyAmount(match[1]);
      if (normalized !== null) values.add(normalized);
    }
  }
  return values;
}

function hasUnsupportedBusinessClaim(answer, businessContext) {
  const answerMoney = moneyClaims(answer);
  const contextMoney = moneyClaims(businessContext);
  for (const amount of answerMoney) {
    if (!contextMoney.has(amount)) return true;
  }
  return AVAILABILITY_CLAIM.test(answer) && !AVAILABILITY_EVIDENCE.test(String(businessContext || ''));
}

export function normalizeConsultationInput(body = {}) {
  const channel = String(body?.channel || 'web').trim().toLowerCase();
  if (!CHANNELS.has(channel)) throw new Error('来源渠道不受支持');

  const conversationText = boundedInput(body?.conversationText, {
    name:'客户消息',
    max:MAX_CONVERSATION_CHARS,
    required:true
  });
  const businessContext = boundedInput(body?.businessContext, {
    name:'商家事实',
    max:MAX_BUSINESS_CONTEXT_CHARS
  });
  const regenerateFrom = boundedInput(body?.regenerateFrom, {
    name:'上一版回复',
    max:MAX_REGENERATE_CHARS
  });

  const industry = cleanText(body?.industry || 'other', 60) || 'other';
  return { industry, channel, conversationText, businessContext, regenerateFrom };
}

export function detectRequiredBusinessFacts({ conversationText = '', businessContext = '' } = {}) {
  const question = String(conversationText || '');
  const context = String(businessContext || '');
  const missing = [];
  if (PRICE_QUESTION.test(question) && !PRICE_EVIDENCE.test(context)) missing.push('价格/收费信息');
  if (AVAILABILITY_QUESTION.test(question) && !AVAILABILITY_EVIDENCE.test(context)) missing.push('档期/可预约时间');
  return missing;
}

export function requiresProfessionalHandoff({ industry, conversationText = '', raw = {} } = {}) {
  if (raw?.risk?.level === 'required_professional_handoff') return true;
  if (!HIGH_RISK_INDUSTRIES.has(String(industry || '').trim())) return false;
  return PROFESSIONAL_JUDGMENT_PATTERN.test(String(conversationText || ''));
}

function safeMissingBusinessReply(missing) {
  const gaps = missing.join('、');
  if (missing.includes('价格/收费信息') && missing.includes('档期/可预约时间')) {
    return '可以先帮您确认。现在还需要核实具体项目的价格/收费信息和可预约档期，暂时不能直接给您确定答案。您可以先告诉我具体想咨询的项目和希望到店的大概时间，我确认后再准确回复您。';
  }
  if (missing.includes('价格/收费信息')) {
    return '可以先帮您确认价格。现在还缺少对应项目的准确收费信息，暂时不能直接报一个金额。您告诉我具体想咨询的项目后，我确认价格再准确回复您。';
  }
  if (missing.includes('档期/可预约时间')) {
    return '可以先帮您确认时间。现在还缺少实时可预约档期，暂时不能直接承诺有位置。您告诉我希望预约的日期和大概时间，我确认档期后再准确回复您。';
  }
  return `可以先帮您确认。当前还缺少${gaps || '必要的商家信息'}，确认后再给您准确回复。`;
}

function safeUnsupportedBusinessClaimReply() {
  return '我先按商家已确认的资料帮您核对价格和预约情况。当前这条回复里有价格或档期说法无法从已提供资料中确认，核对准确后再回复您。';
}

function safeExecutionReply() {
  return '可以先帮您继续处理。当前还没有完成实际预约、付款或外部发送，请先确认具体需求和必要信息，再由工作人员完成后续操作。';
}

export function sanitizeConsultationAnalysis(raw, input = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const deterministicMissing = detectRequiredBusinessFacts(input);
  const modelMissing = cleanList(source.missingBusinessFacts);
  const missingBusinessFacts = [...new Set([...deterministicMissing, ...modelMissing])].slice(0, MAX_LIST_ITEMS);

  const handoff = requiresProfessionalHandoff({
    industry:input?.industry,
    conversationText:input?.conversationText,
    raw:source
  });

  let riskLevel = enumValue(source?.risk?.level, RISK_LEVELS, 'none');
  let riskReason = cleanText(source?.risk?.reason, 500);
  let answer = cleanText(source.answer, 1800);

  if (handoff) {
    riskLevel = 'required_professional_handoff';
    riskReason = '客户问题涉及需要专业人员判断的内容。';
    answer = '这个问题涉及专业判断，我可以先帮您整理需求和必要信息，并安排专业人员确认后再回复您。';
  } else if (deterministicMissing.length) {
    answer = safeMissingBusinessReply(deterministicMissing);
  } else if (hasUnsupportedBusinessClaim(answer, input?.businessContext)) {
    answer = safeUnsupportedBusinessClaimReply();
  } else if (!answer || EXECUTION_CLAIM_PATTERN.test(answer)) {
    answer = safeExecutionReply();
  }

  return {
    customerNeed:cleanText(source.customerNeed, 700) || '暂未识别到明确需求',
    knownFacts:cleanList(source.knownFacts),
    missingCustomerInfo:cleanList(source.missingCustomerInfo),
    missingBusinessFacts,
    lead:{
      intent:enumValue(source?.lead?.intent, INTENTS, 'other'),
      stage:enumValue(source?.lead?.stage, STAGES, 'new_inquiry')
    },
    risk:{
      level:riskLevel,
      reason:riskReason
    },
    answer,
    nextTask:{
      title:cleanText(source?.nextTask?.title, 220) || '继续确认客户需求',
      priority:enumValue(source?.nextTask?.priority, PRIORITIES, 'medium'),
      dueHint:enumValue(source?.nextTask?.dueHint, DUE_HINTS, 'none'),
      reason:cleanText(source?.nextTask?.reason, 360)
    },
    appointmentCandidate:{
      requested:source?.appointmentCandidate?.requested === true,
      date:cleanOptionalText(source?.appointmentCandidate?.date, 40),
      time:cleanOptionalText(source?.appointmentCandidate?.time, 40)
    }
  };
}
