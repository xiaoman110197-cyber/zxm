const MAX_OWNER_TURNS = 30;
const MAX_OTHER_ANSWERS = 10;
const MAX_TEXT_CHARS = 4000;
const MAX_EVIDENCE_ITEMS = 50;
const MAX_EVIDENCE_CHARS = 1000;
const MAX_DOCUMENTS = 3;
const MAX_DOCUMENT_TEXT_CHARS = 12000;
const MAX_FINDINGS = 12;
const MAX_FINDING_EVIDENCE = 20;
const MAX_DIALOGUE_ITEMS = 60;

function clipString(value, maxChars) {
  if (typeof value !== 'string') return value;
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function primitive(value, maxChars = MAX_TEXT_CHARS) {
  if (typeof value === 'string') return clipString(value, maxChars);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean' || value === null) return value;
  return undefined;
}

function boundAnswers(answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return {};
  const entries = Object.entries(answers);
  const turns = entries
    .filter(([key]) => /^owner_turn_\d+$/.test(key))
    .sort((a, b) => Number(a[0].slice('owner_turn_'.length)) - Number(b[0].slice('owner_turn_'.length)))
    .slice(-MAX_OWNER_TURNS);
  const other = entries.filter(([key]) => !/^owner_turn_\d+$/.test(key)).slice(-MAX_OTHER_ANSWERS);
  const result = {};
  for (const [rawKey, value] of [...other, ...turns]) {
    const key = clipString(String(rawKey), 80);
    const safeValue = primitive(value);
    if (safeValue !== undefined) result[key] = safeValue;
  }
  return result;
}

function boundEvidence(evidence, maxItems = MAX_EVIDENCE_ITEMS) {
  if (!Array.isArray(evidence)) return [];
  return evidence
    .slice(-maxItems)
    .map((item) => primitive(item, MAX_EVIDENCE_CHARS))
    .filter((item) => item !== undefined);
}

function boundIssue(issue) {
  if (!issue || typeof issue !== 'object') return null;
  const result = {};
  for (const key of ['type','sheet','row','field','reason','metric','expected','actual','duplicateOf','sourceSheet','summarySheet','confidence']) {
    const value = primitive(issue[key], 600);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function boundMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return {};
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(metrics).slice(0, 30)) {
    const value = primitive(rawValue, 300);
    if (value !== undefined) result[clipString(String(rawKey), 80)] = value;
  }
  return result;
}

function boundPreviewValue(value) {
  const safe = primitive(value, 300);
  if (safe !== undefined) return safe;
  return null;
}

function boundDocument(document) {
  if (!document || typeof document !== 'object') return null;
  const result = {};
  for (const key of ['name','type']) {
    if (typeof document[key] === 'string') result[key] = clipString(document[key], 240);
  }
  for (const key of ['structured','truncated','previewTruncated']) {
    if (typeof document[key] === 'boolean') result[key] = document[key];
  }
  if (typeof document.confidence === 'number' && Number.isFinite(document.confidence)) result.confidence = document.confidence;
  if (typeof document.pageCount === 'number' && Number.isFinite(document.pageCount)) result.pageCount = document.pageCount;
  if (typeof document.text === 'string') result.text = clipString(document.text, MAX_DOCUMENT_TEXT_CHARS);

  if (document.source && typeof document.source === 'object') {
    result.source = {};
    if (typeof document.source.kind === 'string') result.source.kind = clipString(document.source.kind, 40);
    if (typeof document.source.name === 'string') result.source.name = clipString(document.source.name, 240);
  }

  if (Array.isArray(document.warnings)) {
    result.warnings = document.warnings.slice(0, 10).map((item) => clipString(String(item), 600));
  }
  if (Array.isArray(document.sheetNames)) {
    result.sheetNames = document.sheetNames.slice(0, 20).map((item) => clipString(String(item), 120));
  }
  if (Array.isArray(document.sheets)) {
    result.sheets = document.sheets.slice(0, 12).map((sheet) => ({
      name:clipString(String(sheet?.name || ''), 120),
      headers:Array.isArray(sheet?.headers) ? sheet.headers.slice(0, 30).map((item) => clipString(String(item), 120)) : [],
      rowCount:Number.isFinite(sheet?.rowCount) ? sheet.rowCount : 0
    }));
  }
  if (Array.isArray(document.preview)) {
    result.preview = document.preview.slice(0, 6).map((sheet) => ({
      name:clipString(String(sheet?.name || ''), 120),
      rows:Array.isArray(sheet?.rows) ? sheet.rows.slice(0, 6).map((row) => {
        const boundedRow = {};
        for (const [rawKey, rawValue] of Object.entries(row || {}).slice(0, 12)) {
          boundedRow[clipString(String(rawKey), 120)] = boundPreviewValue(rawValue);
        }
        return boundedRow;
      }) : []
    }));
  }
  if (document.auditSummary && typeof document.auditSummary === 'object') {
    result.auditSummary = {
      errorCount:Number.isFinite(document.auditSummary.errorCount) ? document.auditSummary.errorCount : 0,
      anomalyCount:Number.isFinite(document.auditSummary.anomalyCount) ? document.auditSummary.anomalyCount : 0,
      metrics:boundMetrics(document.auditSummary.metrics),
      topIssues:Array.isArray(document.auditSummary.topIssues) ? document.auditSummary.topIssues.slice(0, 10).map(boundIssue).filter(Boolean) : [],
      topAnomalies:Array.isArray(document.auditSummary.topAnomalies) ? document.auditSummary.topAnomalies.slice(0, 10).map(boundIssue).filter(Boolean) : []
    };
  }
  return result;
}

export function boundFinding(finding) {
  if (!finding || typeof finding !== 'object') return null;
  const result = {};
  for (const key of ['title','status','priority','impact','action','metric','crossModelStatus']) {
    if (typeof finding[key] === 'string') result[key] = clipString(finding[key], key === 'action' ? 2000 : 1000);
  }
  if (typeof finding.confidence === 'number' && Number.isFinite(finding.confidence)) result.confidence = finding.confidence;
  result.evidence = boundEvidence(finding.evidence, MAX_FINDING_EVIDENCE);
  if (Array.isArray(finding.missingEvidence)) result.missingEvidence = boundEvidence(finding.missingEvidence, 20);
  return result;
}

function boundDialogue(dialogue) {
  if (!Array.isArray(dialogue)) return undefined;
  return dialogue.slice(-MAX_DIALOGUE_ITEMS).map((entry) => ({
    who:entry?.who === 'ai' ? 'ai' : 'owner',
    text:clipString(String(entry?.text || ''), MAX_TEXT_CHARS),
    ...(typeof entry?.reason === 'string' ? { reason:clipString(entry.reason, 1000) } : {})
  }));
}

export function boundDiagnosisContext(diagnosis) {
  if (!diagnosis || typeof diagnosis !== 'object') throw new TypeError('diagnosis is required');
  const result = {
    id:clipString(String(diagnosis.id || ''), 128),
    answers:boundAnswers(diagnosis.answers),
    evidence:boundEvidence(diagnosis.evidence),
    findings:Array.isArray(diagnosis.findings) ? diagnosis.findings.slice(-MAX_FINDINGS).map(boundFinding).filter(Boolean) : [],
    documents:Array.isArray(diagnosis.documents) ? diagnosis.documents.slice(-MAX_DOCUMENTS).map(boundDocument).filter(Boolean) : []
  };
  const dialogue = boundDialogue(diagnosis.dialogue);
  if (dialogue) result.dialogue = dialogue;
  if (Array.isArray(diagnosis.sourceDigests)) {
    result.sourceDigests = diagnosis.sourceDigests.filter((value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)).slice(0, 3);
  }
  return result;
}
