const BUSINESS_KEYWORDS = [
  '营业额','收入','销售额','成本','毛利','利润','订单','单量','客单价','客流','房租','租金','人工','工资','原料','采购','库存','退款','核销','转化率','复购','现金流'
];

function normalizedText(value) {
  return String(value || '').trim();
}

function isNoise(text) {
  if (!text) return true;
  if (/^[\s\p{P}\p{S}_]+$/u.test(text)) return true;
  if (text.length === 1 && !/\d/.test(text)) return true;
  return false;
}

function issueScore(issue) {
  const text = normalizedText(issue.text);
  const context = normalizedText(issue.context);
  const combined = `${context} ${text}`;
  let score = 0;
  if (/\d/.test(text)) score += 50;
  if (/%|元|¥|￥|万元|万|千|百/.test(combined)) score += 20;
  if (/\d{4}[-/.年]\d{1,2}/.test(combined)) score += 12;
  if (BUSINESS_KEYWORDS.some((keyword) => combined.includes(keyword))) score += 30;
  const confidence = Number(issue.confidence);
  if (Number.isFinite(confidence)) score += Math.max(0, 10 - confidence * 10);
  return score;
}

function normalizeIssue(issue) {
  return {
    text: normalizedText(issue?.text),
    confidence: Number.isFinite(Number(issue?.confidence)) ? Math.max(0, Math.min(1, Number(issue.confidence))) : null,
    context: normalizedText(issue?.context)
  };
}

export function buildFileReviewModel(result) {
  const document = result?.document || {};
  const segments = Array.isArray(document.uncertainSegments) ? document.uncertainSegments.map(normalizeIssue) : [];
  const useful = [];
  const other = [];

  for (const issue of segments) {
    if (isNoise(issue.text)) {
      other.push(issue);
      continue;
    }
    const score = issueScore(issue);
    if (score > 0) useful.push({ ...issue, score });
    else other.push(issue);
  }

  useful.sort((a, b) => b.score - a.score || (a.confidence ?? 1) - (b.confidence ?? 1));
  const importantIssues = useful.slice(0, 5).map(({ score, ...issue }) => issue);
  const overflow = useful.slice(5).map(({ score, ...issue }) => issue);

  return {
    confidence: Number.isFinite(Number(result?.summary?.confidence)) ? Math.max(0, Math.min(1, Number(result.summary.confidence))) : null,
    importantIssues,
    otherIssues:[...overflow, ...other],
    fullText:normalizedText(document.text),
    hasText:Boolean(normalizedText(document.text))
  };
}
