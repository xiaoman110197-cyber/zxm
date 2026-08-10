import { randomUUID } from 'node:crypto';
import { auditWorkbook } from '../src/audit/rules.js';
import { detectCalculationCorrections } from '../src/audit/corrections.js';
import { parseBusinessDocument, supportedBusinessDocumentExtensions } from '../src/documents/parse.js';
import { decodeBase64Strict } from '../src/http/base64.js';
import { checkBurstLimit, requestClientKey } from '../src/http/guard.js';
import { analyzeReportImage } from '../src/report/vision.js';
import { buildReportFacts } from '../src/report/facts.js';
import { inspectReportFacts } from '../src/report/rules.js';
import { buildReportReview } from '../src/report/issues.js';

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_CONTEXT_ISSUES = 10;

function normalizeAudit(audit) {
  return {
    ...audit,
    errors: audit.errors.map((error) => {
      if (error.type === 'duplicate_record') return { ...error, type: 'duplicate' };
      if (error.type === 'cross_sheet_total_mismatch') {
        return {
          ...error,
          type: 'cross_sheet_mismatch',
          sheet: error.summarySheet,
          field: error.metric,
          originalValue: error.actual,
          suggestedValue: null,
          reason: `${error.summarySheet}中的${error.metric}与${error.sourceSheet}合计不一致`,
          confidence: 1
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
  return { errors: [], anomalies: [], metrics: {} };
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
    auditSummary: {
      errorCount: audit.errors.length,
      anomalyCount: audit.anomalies.length,
      metrics: audit.metrics,
      topIssues: audit.errors.slice(0, MAX_CONTEXT_ISSUES).map(compactIssue),
      topAnomalies: audit.anomalies.slice(0, MAX_CONTEXT_ISSUES).map(compactIssue)
    }
  };
}

function buildPayload(parsed, requestId, reportReview = null) {
  const audit = parsed.workbook ? normalizeAudit(auditWorkbook(parsed.workbook)) : emptyAudit();
  const document = attachAuditSummary(parsed.document, audit);
  const corrections = detectCalculationCorrections({ workbook:parsed.workbook, audit, document });
  const warnings = Array.isArray(document.warnings) ? document.warnings : [];
  const payload = {
    requestId,
    document,
    audit,
    corrections,
    summary: {
      fileType: document.type,
      sheetCount: parsed.workbook?.sheets?.length || 0,
      rowCount: countRows(parsed.workbook),
      textLength: typeof document.text === 'string' ? document.text.length : 0,
      warningCount: warnings.length,
      errorCount: audit.errors.length,
      anomalyCount: audit.anomalies.length,
      correctionCount: corrections.length,
      confidence: typeof document.confidence === 'number' ? document.confidence : null,
      metrics: audit.metrics
    }
  };
  if (reportReview) {
    payload.reportReview = reportReview;
    payload.summary.reportProblemCount = reportReview.summary.problemCount;
    payload.summary.reportCorrectionCount = reportReview.summary.provableCorrectionCount;
    payload.summary.reportConfirmationCount = reportReview.summary.confirmationCount;
    payload.summary.visionAvailable = reportReview.summary.visionAvailable;
  }
  return payload;
}

async function analyzeImageReport({ file, buffer, parsed, extension, deps, observeProgress }) {
  const visionAnalyzer = deps.analyzeReportImage || analyzeReportImage;
  observeProgress({ phase:'vision', percent:90, message:'正在理解报表行列和关键数据', stage:'reading-table' });
  const vision = await visionAnalyzer({
    name:file.name,
    buffer,
    mimeType:mimeTypeOf(extension),
    ocrText:parsed.document?.text || ''
  }, deps.visionOptions || {});
  observeProgress({ phase:'report-check', percent:96, message:'正在复算公式并检查数据逻辑', stage:'checking-rules' });
  const reconciled = buildReportFacts({ visionFacts:vision.facts || [], ocrDocument:parsed.document || {} });
  const ruleIssues = inspectReportFacts(reconciled.facts, { now:deps.now || new Date() });
  return buildReportReview({
    ruleIssues,
    visionCandidates:vision.candidates || [],
    confirmations:reconciled.confirmations,
    vision
  });
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
  const logInfo = deps.logInfo || console.info;
  const logError = deps.logError || console.error;
  if (req.method && req.method !== 'POST') return jsonError(res, 405, 'Method not allowed', requestId);
  const file = req.body?.file;
  if (!file?.name || !file?.contentBase64) return jsonError(res, 400, 'file with name and contentBase64 is required', requestId);

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
    const parserDeps = { ...deps, onProgress:observeProgress };
    const parsed = await parser({ name:file.name, buffer }, parserDeps);
    let reportReview = null;
    if (parsed.document?.type === 'image') {
      reportReview = await analyzeImageReport({ file, buffer, parsed, extension, deps, observeProgress });
    } else if (streamMode) {
      observeProgress({ phase:'audit', percent:90, message:'正在检查数据质量并整理结果' });
    }
    const payload = buildPayload(parsed, requestId, reportReview);

    logInfo('[analyze-file]', requestId, 'complete', Date.now() - startedAt);
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
