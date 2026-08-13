import { randomUUID } from 'node:crypto';
import { auditWorkbook } from '../src/audit/rules.js';
import { detectCalculationCorrections } from '../src/audit/corrections.js';
import { createDeepSeekProvider } from '../src/ai/providers.js';
import { parseBusinessDocument, parseImageDocument, supportedBusinessDocumentExtensions } from '../src/documents/parse.js';
import { decodeBase64Strict } from '../src/http/base64.js';
import { checkBurstLimit, requestClientKey } from '../src/http/guard.js';
import { recognizeReportImage } from '../src/report/qianfan-ocr.js';
import { structureReportText } from '../src/report/structure.js';
import { buildReportFacts } from '../src/report/facts.js';
import { inspectReportFacts } from '../src/report/rules.js';
import { buildReportReview } from '../src/report/issues.js';
import { signTrustToken } from '../src/security/trust-token.js';
import { sourceDigest } from '../src/security/source-digest.js';
import { resolveTrustSecret } from '../src/config/runtime.js';
import { emitOpsEvent as emitRuntimeOpsEvent } from '../src/observability/events.js';

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_CONTEXT_ISSUES = 10;
const MAX_SIGNED_ISSUES = 30;
const MAX_SIGNED_FACTS = 80;
const MAX_SIGNED_CORRECTIONS = 40;
const MAX_SIGNED_DOCUMENT_TEXT = 6000;
const MAX_SIGNED_PREVIEW_SHEETS = 3;
const MAX_SIGNED_PREVIEW_ROWS = 4;
const MAX_SIGNED_PREVIEW_COLUMNS = 8;

function clipped(value, max = 600) {
  return typeof value === 'string' ? value.trim().slice(0, max) : value;
}

function usableInjectedTrustSecret(secret) {
  if (Buffer.isBuffer(secret)) return secret.length > 0;
  return typeof secret === 'string' && Boolean(secret.trim());
}

function normalizeAudit(audit) {
  return {
    ...audit,
    errors:audit.errors.map((error) => {
      if (error.type === 'duplicate_record') return { ...error, type:'duplicate' };
      if (error.type === 'cross_sheet_total_mismatch') {
        return {
          ...error,
          type:'cross_sheet_mismatch',
          sheet:error.summarySheet,
          field:error.metric,
          originalValue:error.actual,
          suggestedValue:null,
          reason:`${error.summarySheet}中的${error.metric}与${error.sourceSheet}合计不一致`,
          confidence:1
        };
      }
      return error;
    })
  };
}

function extensionOf(name) {
  const lower = String(name || '').toLowerCase();
  const index = lower.lastIndexOf('.');
  return index >= 0 ? lower.slice(index) : '';
}

function mimeTypeOf(extension) {
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function emptyAudit() {
  return { errors:[], anomalies:[], metrics:{} };
}

function countRows(workbook) {
  return workbook?.sheets?.reduce((sum, sheet) => sum + sheet.rows.length, 0) || 0;
}

function compactIssue(issue) {
  const keys = ['type','sheet','row','field','reason','metric','expected','actual','duplicateOf','sourceSheet','summarySheet','confidence'];
  const compact = {};
  for (const key of keys) {
    if (issue?.[key] !== undefined && issue?.[key] !== null) compact[key] = issue[key];
  }
  return compact;
}

function attachAuditSummary(document, audit) {
  return {
    ...document,
    auditSummary:{
      errorCount:audit.errors.length,
      anomalyCount:audit.anomalies.length,
      metrics:audit.metrics,
      topIssues:audit.errors.slice(0, MAX_CONTEXT_ISSUES).map(compactIssue),
      topAnomalies:audit.anomalies.slice(0, MAX_CONTEXT_ISSUES).map(compactIssue)
    }
  };
}

function compactCorrection(item) {
  return {
    id:clipped(item?.id, 80),
    kind:clipped(item?.kind, 80),
    label:clipped(item?.label, 160),
    originalValue:item?.originalValue ?? null,
    ...(Object.prototype.hasOwnProperty.call(item || {}, 'correctedValue') ? { correctedValue:item.correctedValue } : {}),
    explanation:clipped(item?.explanation, 600),
    evidence:Array.isArray(item?.evidence) ? item.evidence.slice(0, 8).map((value) => clipped(String(value), 300)) : []
  };
}

function compactReportFact(item) {
  return {
    id:clipped(item?.id, 100),
    scope:clipped(item?.scope, 120),
    metric:clipped(item?.metric, 120),
    value:item?.value,
    unit:clipped(item?.unit, 40),
    trusted:item?.trusted === true,
    source:clipped(item?.source, 80)
  };
}

function compactReportIssue(item) {
  return {
    id:clipped(item?.id, 140),
    kind:clipped(item?.kind, 80),
    title:clipped(item?.title, 160),
    scope:clipped(item?.scope, 120),
    originalValue:item?.originalValue ?? null,
    ...(Object.prototype.hasOwnProperty.call(item || {}, 'correctedValue') ? { correctedValue:item.correctedValue } : {}),
    unit:clipped(item?.unit, 40),
    explanation:clipped(item?.explanation, 600),
    evidence:Array.isArray(item?.evidence) ? item.evidence.slice(0, 8).map((value) => clipped(String(value), 300)) : [],
    source:clipped(item?.source, 80)
  };
}

function compactDocumentValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return clipped(value, 120);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean' || value === null) return value;
  return null;
}

function compactSignedDocument(document = {}) {
  const result = {
    name:clipped(document.name, 240),
    type:clipped(document.type, 40),
    confidence:Number.isFinite(document.confidence) ? document.confidence : null
  };
  for (const key of ['structured','truncated','previewTruncated']) {
    if (typeof document[key] === 'boolean') result[key] = document[key];
  }
  if (Number.isFinite(document.pageCount)) result.pageCount = document.pageCount;
  if (document.type !== 'image' && typeof document.text === 'string') {
    result.text = clipped(document.text, MAX_SIGNED_DOCUMENT_TEXT);
  }
  if (Array.isArray(document.warnings)) {
    result.warnings = document.warnings.slice(0, 8).map((item) => clipped(String(item), 300));
  }
  if (Array.isArray(document.sheetNames)) {
    result.sheetNames = document.sheetNames.slice(0, 12).map((item) => clipped(String(item), 120));
  }
  if (Array.isArray(document.preview)) {
    result.preview = document.preview.slice(0, MAX_SIGNED_PREVIEW_SHEETS).map((sheet) => ({
      name:clipped(String(sheet?.name || ''), 120),
      rows:Array.isArray(sheet?.rows) ? sheet.rows.slice(0, MAX_SIGNED_PREVIEW_ROWS).map((row) => {
        const bounded = {};
        for (const [key, value] of Object.entries(row || {}).slice(0, MAX_SIGNED_PREVIEW_COLUMNS)) {
          bounded[clipped(String(key), 120)] = compactDocumentValue(value);
        }
        return bounded;
      }) : []
    }));
  }
  return result;
}

function analysisEvidence(payload, digest) {
  return {
    sourceDigest:digest,
    document:compactSignedDocument(payload.document),
    summary:payload.summary,
    audit:{
      errors:(payload.audit?.errors || []).slice(0, MAX_SIGNED_ISSUES).map(compactIssue),
      anomalies:(payload.audit?.anomalies || []).slice(0, MAX_SIGNED_ISSUES).map(compactIssue),
      metrics:payload.audit?.metrics || {}
    },
    corrections:(payload.corrections || []).slice(0, MAX_SIGNED_CORRECTIONS).map(compactCorrection),
    reportFacts:(payload.reportFacts || []).slice(0, MAX_SIGNED_FACTS).map(compactReportFact),
    reportIssues:(payload.reportReview?.issues || []).slice(0, MAX_SIGNED_ISSUES).map(compactReportIssue),
    reportSummary:payload.reportReview?.summary || null
  };
}

function buildPayload(parsed, requestId, reportData = null, deps = {}, digest) {
  const audit = parsed.workbook ? normalizeAudit(auditWorkbook(parsed.workbook)) : emptyAudit();
  const document = attachAuditSummary(parsed.document, audit);
  const corrections = detectCalculationCorrections({ workbook:parsed.workbook, audit, document })
    .map((item, index) => ({ ...item, id:`correction_${digest}_${index + 1}` }));
  const warnings = Array.isArray(document.warnings) ? document.warnings : [];
  const payload = {
    requestId,
    document,
    audit,
    corrections,
    summary:{
      fileType:document.type,
      sheetCount:parsed.workbook?.sheets?.length || 0,
      rowCount:countRows(parsed.workbook),
      textLength:typeof document.text === 'string' ? document.text.length : 0,
      warningCount:warnings.length,
      errorCount:audit.errors.length,
      anomalyCount:audit.anomalies.length,
      correctionCount:corrections.length,
      confidence:typeof document.confidence === 'number' ? document.confidence : null,
      metrics:audit.metrics
    }
  };
  if (reportData) {
    payload.reportReview = reportData.reportReview;
    payload.reportFacts = reportData.reportFacts;
    payload.summary.reportProblemCount = reportData.reportReview.summary.problemCount;
    payload.summary.reportCorrectionCount = reportData.reportReview.summary.provableCorrectionCount;
    payload.summary.reportConfirmationCount = reportData.reportReview.summary.confirmationCount;
    payload.summary.reportRecognitionMode = reportData.reportReview.summary.recognitionMode;
    payload.summary.reportCompleteReview = reportData.reportReview.summary.completeReview;
  }
  try {
    payload.analysisToken = signTrustToken('analysis', analysisEvidence(payload, digest), {
      secret:deps.trustSecret,
      env:deps.env,
      now:deps.trustNow
    });
  } catch (error) {
    const production = deps.requireTrustToken === true || process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL_ENV);
    if (production) throw error;
    payload.analysisToken = null;
  }
  return payload;
}

function confirmationFactIds(confirmations, facts = []) {
  const ids = new Set();
  for (const item of confirmations || []) {
    if (typeof item?.factId === 'string' && item.factId) {
      ids.add(item.factId);
      continue;
    }
    if (typeof item?.id === 'string' && item.id.startsWith('confirm:')) {
      const possibleId = item.id.slice('confirm:'.length);
      if (facts.some((fact) => fact.id === possibleId)) ids.add(possibleId);
    }
    if (item?.scope && item?.metric) {
      for (const fact of facts) {
        if (fact.scope === item.scope && fact.metric === item.metric) ids.add(fact.id);
      }
    }
  }
  return ids;
}

function runtimeReportStructureProvider(deps) {
  if (deps.reportStructureProvider) return deps.reportStructureProvider;
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  if (!String(apiKey).trim()) return null;
  return createDeepSeekProvider({ apiKey, timeoutMs:12000 });
}

async function analyzeImageReport({ file, buffer, parsed, extension, deps, observeProgress }) {
  const recognizer = deps.recognizeReportImage || recognizeReportImage;
  observeProgress({ phase:'cloud-ocr', percent:88, message:'正在读取报表原图和表格结构', stage:'cloud-ocr' });

  let cloud;
  try {
    cloud = await recognizer({
      name:file.name,
      buffer,
      mimeType:mimeTypeOf(extension)
    }, deps.qianfanOcrOptions || {});
  } catch {
    cloud = {
      available:false,
      provider:null,
      model:null,
      text:'',
      failureCode:'OCR_PROVIDER_FAILED',
      warning:'云端报表识别暂时失败'
    };
  }

  let recognition;
  let text;
  let source;
  let degraded;

  if (cloud?.available && typeof cloud.text === 'string' && cloud.text.trim()) {
    recognition = {
      mode:'cloud_ocr_deepseek',
      completeReview:true,
      provider:cloud.provider || 'qianfan',
      model:cloud.model || null,
      warning:null,
      failureCode:null
    };
    text = cloud.text.trim();
    source = 'qianfan_ocr';
    degraded = false;
  } else {
    let localParsed = parsed;
    if (!String(localParsed.document?.text || '').trim() && localParsed.document?.recognitionDeferred === true) {
      try {
        localParsed = await parseImageDocument({ name:file.name, buffer }, { ...deps, onProgress:observeProgress });
      } catch {
        localParsed = parsed;
      }
    }
    if (String(localParsed.document?.text || '').trim()) {
    const failureCode = cloud?.failureCode || null;
    const failureLabel = failureCode ? `（错误编号 ${failureCode}）` : '';
    recognition = {
      mode:'local_ocr_degraded',
      completeReview:false,
      provider:'tesseract',
      model:null,
      warning:`云端报表识别未完成${failureLabel}，本次使用降级识别。关键数字需要核对，结果不能视为完整报表检查。`,
      failureCode
    };
    text = String(localParsed.document.text).trim();
    source = 'local_ocr';
    degraded = true;
    parsed = localParsed;
    } else {
    recognition = {
      mode:'ocr_unavailable',
      completeReview:false,
      provider:null,
      model:null,
      warning:'未能可靠读取报表内容，请重新上传更清晰的图片。',
      failureCode:cloud?.failureCode || 'OCR_UNAVAILABLE'
    };
    return { reportReview:buildReportReview({ recognition }), reportFacts:[], document:parsed.document };
    }
  }

  const selectedDocument = source === 'qianfan_ocr'
    ? {
        ...parsed.document,
        confidence:null,
        text,
        truncated:false,
        uncertainSegments:[],
        warnings:[],
        recognitionDeferred:false
      }
    : { ...parsed.document, recognitionDeferred:false };

  observeProgress({ phase:'structuring', percent:93, message:'正在整理经营字段和行列关系', stage:'structuring' });
  let structured;
  try {
    if (typeof deps.reportStructurer === 'function') {
      structured = await deps.reportStructurer({ text, source, degraded, name:file.name });
    } else {
      const provider = runtimeReportStructureProvider(deps);
      structured = await structureReportText({ text, source, degraded }, { provider });
    }
  } catch {
    recognition = {
      ...recognition,
      completeReview:false,
      warning:'报表文字已识别，但经营字段结构化分析未完成，请重试后再确认报表。',
      failureCode:'REPORT_STRUCTURE_FAILED'
    };
    return { reportReview:buildReportReview({ recognition }), reportFacts:[], document:selectedDocument };
  }

  observeProgress({ phase:'report-check', percent:96, message:'正在复算公式并检查数据逻辑', stage:'checking-rules' });
  const reconciled = buildReportFacts({
    structuredFacts:structured?.facts || [],
    corroborationText:text,
    degraded
  });
  if (!degraded && reconciled.facts.length === 0) {
    recognition = {
      ...recognition,
      completeReview:false,
      warning:'报表文字已读取，但未形成可复核的经营字段，请核对图片清晰度和表格结构后重试。',
      failureCode:'REPORT_STRUCTURE_EMPTY'
    };
  }
  const confirmations = [
    ...(Array.isArray(structured?.confirmations) ? structured.confirmations : []),
    ...(Array.isArray(reconciled.confirmations) ? reconciled.confirmations : [])
  ];
  const ruleIssues = inspectReportFacts(reconciled.facts, { now:deps.now || new Date() });
  const reportReview = buildReportReview({
    ruleIssues,
    aiCandidates:structured?.candidates || [],
    confirmations,
    recognition
  });
  const conflicted = confirmationFactIds(confirmations, reconciled.facts);
  const reportFacts = reconciled.facts.map((fact) => ({ ...fact, trusted:!conflicted.has(fact.id) }));
  return { reportReview, reportFacts, document:selectedDocument };
}

function isStreamRequest(req) {
  return String(req.query?.stream ?? '') === '1';
}

function startEventStream(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function jsonError(res, status, error, requestId) {
  return res.status(status).json({ error, requestId });
}

function applyBurstGuard(req, res, requestId, deps) {
  if (deps.disableBurstGuard) return null;
  const key = requestClientKey(req, 'file-analysis');
  if (!key) return null;
  const result = checkBurstLimit(key, { limit:20, windowMs:10 * 60 * 1000 });
  if (result.allowed) return null;
  res.setHeader?.('Retry-After', String(result.retryAfterSeconds));
  return jsonError(res, 429, '文件分析请求较频繁，请稍后再试', requestId);
}

function safeProgressStage(value) {
  const stage = String(value || '');
  return /^[a-z0-9_-]{1,40}$/i.test(stage) ? stage : '-';
}

function safeParseErrorMessage(error) {
  if (error?.code === 'OCR_INIT_TIMEOUT') return '图片文字识别初始化超时，请重新分析';
  return '文件损坏、格式不匹配或内容无法解析';
}

export async function handleAnalyzeFileRequest(req, res, deps = {}) {
  const requestId = deps.requestId || randomUUID();
  const startedAt = Date.now();
  const emitOps = (event) => {
    try {
      (deps.emitOpsEvent || emitRuntimeOpsEvent)({ route:'analyze-file', requestId, ...event });
    } catch {
      // Observability must never change a business response.
    }
  };
  emitOps({ event:'request_started' });
  const logInfo = deps.logInfo || console.info;
  const logError = deps.logError || console.error;
  if (req.method && req.method !== 'POST') return jsonError(res, 405, 'Method not allowed', requestId);
  const file = req.body?.file;
  if (!file?.name || !file?.contentBase64) return jsonError(res, 400, 'file with name and contentBase64 is required', requestId);

  const trust = resolveTrustSecret(deps.env || process.env);
  const productionTrustRequired = deps.requireTrustToken === true || process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL_ENV);
  if (productionTrustRequired && !usableInjectedTrustSecret(deps.trustSecret) && !trust.secret) {
    return jsonError(res, 503, '服务端证据签名配置不可用', requestId);
  }

  const extension = extensionOf(file.name);
  if (!supportedBusinessDocumentExtensions.includes(extension)) {
    return jsonError(res, 415, '支持 Excel、CSV、PDF、Word DOCX 和 JPG/PNG 图片', requestId);
  }
  const limited = applyBurstGuard(req, res, requestId, deps);
  if (limited) return limited;

  let buffer;
  try {
    buffer = decodeBase64Strict(file.contentBase64);
  } catch {
    return jsonError(res, 422, '文件内容损坏或无法解析', requestId);
  }
  if (buffer.length > MAX_FILE_BYTES) {
    return jsonError(res, 413, '文件过大：当前版本单个文件最大支持 3 MB', requestId);
  }
  const digest = sourceDigest(buffer);

  const streamMode = isStreamRequest(req);
  const emitProgress = (event) => writeSse(res, 'progress', { requestId, ...event });
  let lastLoggedPhase = '';
  let lastLoggedStage = '';
  let lastLoggedPercent = -Infinity;
  const observeProgress = (event = {}) => {
    const phase = String(event.phase || 'unknown');
    const stage = safeProgressStage(event.stage);
    const percent = Math.max(0, Math.min(100, Math.round(Number(event.percent) || 0)));
    if (phase !== lastLoggedPhase || stage !== lastLoggedStage || percent >= lastLoggedPercent + 5 || percent === 100) {
      logInfo('[analyze-file]', requestId, 'progress', phase, stage, percent, Date.now() - startedAt);
      lastLoggedPhase = phase;
      lastLoggedStage = stage;
      lastLoggedPercent = percent;
    }
    deps.onProgress?.(event);
    if (streamMode) emitProgress(event);
  };

  if (streamMode) {
    startEventStream(res);
    observeProgress({ phase:'preparing', percent:10, message:'文件已接收，准备分析' });
  }

  try {
    const parser = deps.parseBusinessDocument || parseBusinessDocument;
    const parserDeps = { ...deps, onProgress:observeProgress, deferImageOcr:true };
    const parsingStartedAt = Date.now();
    const parsed = await parser({ name:file.name, buffer }, parserDeps);
    emitOps({ event:'stage_completed', stage:'parsing', stageDurationMs:Date.now() - parsingStartedAt });
    let reportData = null;
    if (parsed.document?.type === 'image') {
      reportData = await analyzeImageReport({ file, buffer, parsed, extension, deps, observeProgress });
    } else if (streamMode) {
      observeProgress({ phase:'audit', percent:90, message:'正在检查数据质量并整理结果' });
    }
    const effectiveParsed = reportData?.document ? { ...parsed, document:reportData.document } : parsed;
    const payload = buildPayload(effectiveParsed, requestId, reportData, deps, digest);

    logInfo('[analyze-file]', requestId, 'complete', Date.now() - startedAt);
    emitOps({ event:'request_completed', durationMs:Date.now() - startedAt });
    if (streamMode) {
      observeProgress({ phase:'complete', percent:100, message:'分析完成' });
      writeSse(res, 'result', payload);
      res.end();
      return;
    }
    return res.status(200).json(payload);
  } catch (error) {
    const clientMessage = safeParseErrorMessage(error);
    logError('[analyze-file]', requestId, 'failed', Date.now() - startedAt, error?.code || error?.name || 'Error');
    emitOps({ event:'request_failed', level:'error', durationMs:Date.now() - startedAt, failureCode:'DOCUMENT_PARSE_ERROR' });
    if (streamMode) {
      writeSse(res, 'error', { error:clientMessage, requestId });
      res.end();
      return;
    }
    return jsonError(res, 422, clientMessage, requestId);
  }
}

export default async function handler(req, res) {
  return handleAnalyzeFileRequest(req, res);
}
