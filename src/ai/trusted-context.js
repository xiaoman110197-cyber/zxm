import { verifyTrustToken } from '../security/trust-token.js';

const RESERVED_EVIDENCE_PATTERN = /(?:^|[\r\n])\s*(?:file_analysis|file_review|report_fact|report_issue|report_review_confirmation|correction_decision|program)\s*[:：]/iu;
const DECISIONS = new Set(['accepted', 'kept_original']);
const MAX_ANALYSIS_TOKENS = 3;
const MAX_DECISIONS = 40;

function isReservedEvidence(value) {
  if (typeof value !== 'string') return false;
  return RESERVED_EVIDENCE_PATTERN.test(value);
}

function jsonEvidence(prefix, value) {
  const serialized = `${prefix}:${JSON.stringify(value)}`;
  if (serialized.length <= 950) return serialized;
  const compact = { ...value };
  delete compact.evidence;
  if (typeof compact.explanation === 'string') compact.explanation = compact.explanation.slice(0, 240);
  return `${prefix}:${JSON.stringify(compact)}`;
}

function analysisEvidence(data) {
  const evidence = [];
  if (data?.summary && typeof data.summary === 'object') {
    evidence.push(jsonEvidence('file_analysis', data.summary));
  }
  for (const correction of data?.corrections || []) {
    if (correction?.kind === 'calculation_error') continue;
    evidence.push(jsonEvidence('file_review', {
      id:correction?.id,
      kind:correction?.kind,
      label:correction?.label,
      originalValue:correction?.originalValue,
      explanation:correction?.explanation,
      evidence:correction?.evidence
    }));
  }
  for (const fact of data?.reportFacts || []) {
    const prefix = fact?.trusted === true ? 'report_fact' : 'report_review_confirmation';
    evidence.push(jsonEvidence(prefix, fact?.trusted === true ? fact : {
      ...fact,
      reason:'关键数据识别存在冲突或不确定，不能作为确定事实'
    }));
  }
  for (const issue of data?.reportIssues || []) {
    const prefix = issue?.kind === 'needs_confirmation' ? 'report_review_confirmation' : 'report_issue';
    evidence.push(jsonEvidence(prefix, issue));
  }
  return evidence;
}

function correctionMap(analyses) {
  const result = new Map();
  for (const analysis of analyses) {
    for (const correction of analysis?.corrections || []) {
      if (typeof correction?.id !== 'string' || !correction.id || result.has(correction.id)) {
        throw new TypeError('Correction identity is ambiguous');
      }
      result.set(correction.id, correction);
    }
  }
  return result;
}

function decisionEvidence(decisions, analyses) {
  if (!Array.isArray(decisions)) return [];
  if (decisions.length > MAX_DECISIONS) throw new TypeError('Too many correction decisions');
  const corrections = correctionMap(analyses);
  const used = new Set();
  return decisions.map((item) => {
    const id = typeof item?.correctionId === 'string' ? item.correctionId : '';
    const decision = item?.decision;
    if (!id || used.has(id) || !DECISIONS.has(decision)) throw new TypeError('Correction decision is invalid');
    const correction = corrections.get(id);
    if (!correction || correction.kind !== 'calculation_error' || !Object.prototype.hasOwnProperty.call(correction, 'correctedValue')) {
      throw new TypeError('Correction decision is invalid');
    }
    used.add(id);
    return jsonEvidence('correction_decision', {
      correctionId:id,
      label:correction.label,
      originalValue:correction.originalValue,
      correctedValue:correction.correctedValue,
      decision,
      explanation:correction.explanation || ''
    });
  });
}

function verifyAnalyses(tokens, options) {
  if (tokens === undefined) return [];
  if (!Array.isArray(tokens) || tokens.length > MAX_ANALYSIS_TOKENS) throw new TypeError('Analysis token is invalid');
  return tokens.map((token) => verifyTrustToken(token, 'analysis', options));
}

function verifiedPriorDiagnosis(token, options) {
  if (token === undefined || token === null || token === '') return { findings:[], sourceDigests:[] };
  const data = verifyTrustToken(token, 'diagnosis', options);
  if (!Array.isArray(data?.findings)) throw new TypeError('Diagnosis token is invalid');
  const sourceDigests = data.sourceDigests;
  if (!Array.isArray(sourceDigests) || sourceDigests.some((value) => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) {
    throw new TypeError('Diagnosis token is invalid');
  }
  return { findings:data.findings, sourceDigests:[...new Set(sourceDigests)] };
}

function trustedDocuments(analyses) {
  return analyses.map((analysis) => {
    if (!analysis?.document || typeof analysis.document !== 'object') return null;
    const audit = analysis.audit && typeof analysis.audit === 'object' ? analysis.audit : {};
    const summary = analysis.summary && typeof analysis.summary === 'object' ? analysis.summary : {};
    const document = { ...analysis.document };
    if (document.type === 'image') delete document.text;
    document.auditSummary = {
      errorCount:Number.isFinite(summary.errorCount) ? summary.errorCount : Array.isArray(audit.errors) ? audit.errors.length : 0,
      anomalyCount:Number.isFinite(summary.anomalyCount) ? summary.anomalyCount : Array.isArray(audit.anomalies) ? audit.anomalies.length : 0,
      metrics:audit.metrics && typeof audit.metrics === 'object' && !Array.isArray(audit.metrics) ? audit.metrics : {},
      topIssues:Array.isArray(audit.errors) ? audit.errors.slice(0, 10) : [],
      topAnomalies:Array.isArray(audit.anomalies) ? audit.anomalies.slice(0, 10) : []
    };
    return document;
  }).filter(Boolean);
}

export function assembleTrustedDiagnosis(diagnosis, options = {}) {
  if (!diagnosis || typeof diagnosis !== 'object') throw new TypeError('diagnosis is required');
  const tokenOptions = { secret:options.secret, env:options.env, now:options.now };
  const analyses = verifyAnalyses(diagnosis.analysisTokens, tokenOptions);
  const ordinaryEvidence = Array.isArray(diagnosis.evidence)
    ? diagnosis.evidence.filter((item) => !isReservedEvidence(item))
    : [];
  const trustedEvidence = analyses.flatMap(analysisEvidence);
  const decisions = decisionEvidence(diagnosis.correctionDecisions, analyses);
  const sourceDigests = [...new Set(analyses.map((analysis) => analysis?.sourceDigest).filter((value) => (
    typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
  )))];
  if (sourceDigests.length !== analyses.length) throw new TypeError('Analysis token is invalid');
  const prior = verifiedPriorDiagnosis(diagnosis.diagnosisToken, tokenOptions);
  if (prior.sourceDigests.some((digest) => !sourceDigests.includes(digest))) {
    throw new TypeError('Diagnosis source is invalid');
  }
  return {
    ...diagnosis,
    evidence:[...ordinaryEvidence, ...trustedEvidence, ...decisions],
    findings:prior.findings,
    documents:trustedDocuments(analyses),
    sourceDigests,
    analysisTokens:undefined,
    correctionDecisions:undefined,
    diagnosisToken:undefined
  };
}
