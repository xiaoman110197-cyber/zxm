const CANDIDATE_KINDS = new Set(['calculation_error', 'logic_error', 'anomaly']);
const METRIC_ALIAS_GROUPS = Object.freeze([
  ['营业收入','营业额','营收','销售额','收入'],
  ['营业成本','总成本','成本'],
  ['净利润','利润'],
  ['毛利率','毛利百分比'],
  ['毛利','毛利润'],
  ['库存周转率','周转率']
]);
const UNIT_ALIASES = Object.freeze({
  '%':['%','％','百分比','百分点'],
  '元':['元','￥','¥'],
  '万元':['万元','万'],
  '千元':['千元','千'],
  '亿元':['亿元','亿'],
  '次':['次'],
  '人':['人'],
  '天':['天','日']
});
const DATE_METRICS = new Set(['生产日期','失效日期','到期日期','有效期至']);

function clean(value, max = 600) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function normalizedText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function numericToken(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return String(value).replace(/,/g, '');
}

function sourceContainsValue(sourceText, value) {
  const source = normalizedText(sourceText);
  if (!source) return false;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalizedSource = source.replace(/,/g, '');
    const token = numericToken(value);
    if (!token) return false;
    const pattern = new RegExp(`(^|[^\\d.])${token.replace('.', '\\.')}(?=$|[^\\d.])`);
    return pattern.test(normalizedSource);
  }
  if (typeof value === 'string') {
    const token = normalizedText(value);
    return Boolean(token && source.includes(token));
  }
  return false;
}

function anchoredSource(sourceText, fullText) {
  const source = normalizedText(sourceText);
  const full = normalizedText(fullText);
  return Boolean(source && full && full.includes(source));
}

function containsText(sourceText, token) {
  const source = normalizedText(sourceText).toLowerCase();
  const value = normalizedText(token).toLowerCase();
  return Boolean(source && value && source.includes(value));
}

function metricAliases(metric) {
  const normalized = normalizedText(metric);
  const group = METRIC_ALIAS_GROUPS.find((items) => items.includes(normalized));
  return group || [normalized];
}

function sourceContainsMetric(sourceText, metric) {
  return metricAliases(metric).some((alias) => containsText(sourceText, alias));
}

function sourceContainsUnit(sourceText, unit) {
  const normalized = normalizedText(unit);
  if (!normalized) return false;
  const aliases = UNIT_ALIASES[normalized] || [normalized];
  return aliases.some((alias) => containsText(sourceText, alias));
}

function validCalendarDate(value) {
  if (typeof value !== 'string') return false;
  const match = value.trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/u);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function sourceContainsUnitOrEquivalent(sourceText, metric, value, unit) {
  if (sourceContainsUnit(sourceText, unit)) return true;
  return !normalizedText(unit) && DATE_METRICS.has(normalizedText(metric)) && validCalendarDate(value);
}

function normalizeFact(raw, { text, source, degraded, index }) {
  if (!raw || typeof raw !== 'object') return null;
  const scope = clean(raw.scope, 120);
  const metric = clean(raw.metric, 120);
  const sourceText = clean(raw.sourceText, 400);
  if (!scope || !metric || !sourceText) return null;
  if (!anchoredSource(sourceText, text)) return null;
  if (!containsText(sourceText, scope)) return null;
  if (!sourceContainsMetric(sourceText, metric)) return null;
  if (!sourceContainsUnitOrEquivalent(sourceText, metric, raw.value, raw.unit)) return null;
  if (!sourceContainsValue(sourceText, raw.value)) return null;

  let value = raw.value;
  if (typeof value === 'string') value = value.trim().slice(0, 160);
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;

  const confidence = degraded
    ? Math.min(0.64, clampConfidence(raw.confidence))
    : clampConfidence(raw.confidence);

  return {
    id:`report_fact_${index + 1}`,
    scope,
    metric,
    value,
    unit:clean(raw.unit, 40),
    sourceText,
    confidence,
    source:source === 'local_ocr' ? 'local_ocr_ai' : 'qianfan_ocr_ai'
  };
}

function normalizeCandidate(raw, factIdMap) {
  if (!raw || typeof raw !== 'object') return null;
  const title = clean(raw.title, 160);
  const scope = clean(raw.scope, 120);
  const explanation = clean(raw.explanation, 600);
  if (!title || !scope || !explanation) return null;
  const relatedFactIds = [];
  for (const rawId of Array.isArray(raw.relatedFactIds) ? raw.relatedFactIds : []) {
    const ids = factIdMap.get(clean(rawId, 100)) || [];
    for (const id of ids) {
      if (!relatedFactIds.includes(id)) relatedFactIds.push(id);
      if (relatedFactIds.length >= 20) break;
    }
    if (relatedFactIds.length >= 20) break;
  }
  if (!relatedFactIds.length) return null;
  return {
    title,
    scope,
    kind:CANDIDATE_KINDS.has(raw.kind) ? raw.kind : 'anomaly',
    explanation,
    relatedFactIds
  };
}

function normalizeConfirmation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const scope = clean(raw.scope, 120);
  const metric = clean(raw.metric, 120);
  const reason = clean(raw.reason, 600);
  if (!scope || !metric || !reason) return null;
  return {
    id:clean(raw.id, 120) || `confirm:${scope}:${metric}`,
    scope,
    metric,
    currentValue:raw.currentValue ?? raw.value ?? null,
    unit:clean(raw.unit, 40),
    reason,
    sourceText:clean(raw.sourceText, 400)
  };
}

export async function structureReportText({ text, source = 'qianfan_ocr', degraded = false } = {}, { provider } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('OCR text is required');
  if (!provider?.structureReport) throw new TypeError('report structure provider is required');

  const raw = await provider.structureReport({ text, source, degraded });
  const facts = [];
  const factIdMap = new Map();
  for (const item of Array.isArray(raw?.facts) ? raw.facts.slice(0, 160) : []) {
    const fact = normalizeFact(item, { text, source, degraded, index:facts.length });
    if (!fact) continue;
    facts.push(fact);
    const rawId = clean(item?.id, 100);
    if (rawId) factIdMap.set(rawId, [...(factIdMap.get(rawId) || []), fact.id]);
  }
  const candidates = Array.isArray(raw?.candidates)
    ? raw.candidates.slice(0, 40).map((item) => normalizeCandidate(item, factIdMap)).filter(Boolean)
    : [];
  const confirmations = Array.isArray(raw?.confirmations)
    ? raw.confirmations.slice(0, 40).map(normalizeConfirmation).filter(Boolean)
    : [];

  return { facts, candidates, confirmations };
}
