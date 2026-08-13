const KEY_METRICS = new Set([
  '营业额','营收','营业收入','销售额','营业成本','成本','毛利','毛利率','净利润',
  '出勤率','离职率','人数','期末人数','生产日期','失效日期','库存','销量'
]);

const METRIC_ALIASES = new Map([
  ['营收', ['营收','营业收入','营业额','销售额']],
  ['营业收入', ['营业收入','营收','营业额','销售额']],
  ['营业额', ['营业额','营业收入','营收','销售额']],
  ['销售额', ['销售额','营业额','营业收入','营收']],
  ['营业成本', ['营业成本','成本']],
  ['成本', ['成本','营业成本']],
  ['人数', ['人数','期末人数','员工人数']],
  ['期末人数', ['期末人数','人数','员工人数']]
]);

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return clean(value).replace(/[，,￥¥元\s]/g, '').toLowerCase();
}

function valueKey(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return `n:${value}`;
  return `s:${normalized(value)}`;
}

function dedupeFacts(structuredFacts) {
  const chosen = new Map();
  for (const fact of structuredFacts || []) {
    if (!fact || typeof fact !== 'object') continue;
    const scope = clean(fact.scope);
    const metric = clean(fact.metric);
    if (!scope || !metric) continue;
    const key = `${scope}\u0000${metric}\u0000${valueKey(fact.value)}\u0000${clean(fact.unit)}`;
    const current = chosen.get(key);
    if (!current || Number(fact.confidence || 0) > Number(current.confidence || 0)) chosen.set(key, { ...fact, scope, metric });
  }
  return [...chosen.values()];
}

function metricNames(metric) {
  return METRIC_ALIASES.get(metric) || [metric];
}

function parseNumericToken(token) {
  const raw = clean(token);
  if (!raw) return null;
  const match = raw.match(/-?[\d,]+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0].replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return null;
  const after = raw.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 4);
  const before = raw.slice(Math.max(0, (match.index || 0) - 2), match.index || 0);
  const unitContext = `${before}${after}`;
  const multiplier = /亿元/.test(unitContext) ? 100000000 : /万元/.test(unitContext) ? 10000 : /千元/.test(unitContext) ? 1000 : 1;
  return { number:numeric, multiplier, raw:match[0] };
}

function canonicalNumber(value, unit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const u = clean(unit);
  if (u === '亿元') return value * 100000000;
  if (u === '万元' || u === '万') return value * 10000;
  if (u === '千元' || u === '千') return value * 1000;
  return value;
}

function equivalentValue(fact, parsed) {
  if (!parsed) return true;
  if (typeof fact.value === 'number') {
    const left = canonicalNumber(fact.value, fact.unit);
    const right = parsed.number * parsed.multiplier;
    if (!Number.isFinite(left) || !Number.isFinite(right)) return true;
    const tolerance = Math.max(0.01, Math.abs(left) * 0.0001);
    return Math.abs(left - right) <= tolerance;
  }
  const left = normalized(fact.value);
  const right = normalized(parsed.raw);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function linesNearScope(ocrText, scope) {
  const lines = String(ocrText || '').split(/\r?\n/).map(clean).filter(Boolean);
  const scopeText = clean(scope);
  if (!scopeText) return [];
  return lines.filter((line) => line.includes(scopeText));
}

function findOcrValueForFact(fact, ocrText) {
  const aliases = metricNames(fact.metric);
  const scopedLines = linesNearScope(ocrText, fact.scope);
  for (const line of scopedLines) {
    for (const alias of aliases) {
      const metricIndex = line.indexOf(alias);
      if (metricIndex < 0) continue;
      const afterMetric = line.slice(metricIndex + alias.length, metricIndex + alias.length + 45);
      const parsed = parseNumericToken(afterMetric);
      if (parsed) return parsed;
    }
  }
  return null;
}

function confirmationFor(fact, reason) {
  return {
    id:`confirm:${fact.id}`,
    scope:fact.scope,
    metric:fact.metric,
    currentValue:fact.value,
    reason,
    sourceText:clean(fact.sourceText)
  };
}

export function buildReportFacts({ structuredFacts, corroborationText, degraded = false, visionFacts, ocrDocument } = {}) {
  const inputFacts = Array.isArray(structuredFacts) ? structuredFacts : (visionFacts || []);
  const evidenceText = typeof corroborationText === 'string' ? corroborationText : (ocrDocument?.text || '');
  const facts = dedupeFacts(inputFacts);
  const confirmations = [];
  const seen = new Set();

  for (const fact of facts) {
    if (!KEY_METRICS.has(fact.metric)) continue;
    const corroboratedValue = findOcrValueForFact(fact, evidenceText);
    if (corroboratedValue && !equivalentValue(fact, corroboratedValue)) {
      const item = confirmationFor(fact, '关键数据在识别证据中不一致，请核对原报表。');
      if (!seen.has(item.id)) {
        confirmations.push(item);
        seen.add(item.id);
      }
      continue;
    }
    if (degraded && Number(fact.confidence) < 0.65) {
      const item = confirmationFor(fact, '本次为降级识别，这个关键数据需要核对原报表后再用于确定结论。');
      if (!seen.has(item.id)) {
        confirmations.push(item);
        seen.add(item.id);
      }
      continue;
    }
    if (!corroboratedValue && Number(fact.confidence) < 0.65) {
      const item = confirmationFor(fact, '这个关键数据在识别证据中不够清楚，请核对后再用于结论。');
      if (!seen.has(item.id)) {
        confirmations.push(item);
        seen.add(item.id);
      }
    }
  }

  return { facts, confirmations };
}
