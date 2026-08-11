const CANDIDATE_KINDS = new Set(['calculation_error', 'logic_error', 'anomaly']);

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

function normalizeFact(raw, { text, source, degraded, index }) {
  if (!raw || typeof raw !== 'object') return null;
  const scope = clean(raw.scope, 120);
  const metric = clean(raw.metric, 120);
  const sourceText = clean(raw.sourceText, 400);
  if (!scope || !metric || !sourceText) return null;
  if (!anchoredSource(sourceText, text)) return null;
  if (!sourceContainsValue(sourceText, raw.value)) return null;

  let value = raw.value;
  if (typeof value === 'string') value = value.trim().slice(0, 160);
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;

  const confidence = degraded
    ? Math.min(0.64, clampConfidence(raw.confidence))
    : clampConfidence(raw.confidence);

  return {
    id:clean(raw.id, 100) || `report_fact_${index + 1}`,
    scope,
    metric,
    value,
    unit:clean(raw.unit, 40),
    sourceText,
    confidence,
    source:source === 'local_ocr' ? 'local_ocr_ai' : 'qianfan_ocr_ai'
  };
}

function normalizeCandidate(raw, survivingFactIds) {
  if (!raw || typeof raw !== 'object') return null;
  const title = clean(raw.title, 160);
  const scope = clean(raw.scope, 120);
  const explanation = clean(raw.explanation, 600);
  if (!title || !scope || !explanation) return null;
  const relatedFactIds = Array.isArray(raw.relatedFactIds)
    ? raw.relatedFactIds.map((item) => clean(item, 100)).filter((id) => id && survivingFactIds.has(id)).slice(0, 20)
    : [];
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
  const facts = Array.isArray(raw?.facts)
    ? raw.facts.slice(0, 160).map((item, index) => normalizeFact(item, { text, source, degraded, index })).filter(Boolean)
    : [];
  const survivingFactIds = new Set(facts.map((fact) => fact.id));
  const candidates = Array.isArray(raw?.candidates)
    ? raw.candidates.slice(0, 40).map((item) => normalizeCandidate(item, survivingFactIds)).filter(Boolean)
    : [];
  const confirmations = Array.isArray(raw?.confirmations)
    ? raw.confirmations.slice(0, 40).map(normalizeConfirmation).filter(Boolean)
    : [];

  return { facts, candidates, confirmations };
}
