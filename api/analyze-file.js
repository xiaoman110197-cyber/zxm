import { randomUUID } from 'node:crypto';
import { auditWorkbook } from '../src/audit/rules.js';
import { parseBusinessDocument, supportedBusinessDocumentExtensions } from '../src/documents/parse.js';
import { decodeBase64Strict } from '../src/http/base64.js';
import { checkBurstLimit, requestClientKey } from '../src/http/guard.js';

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_CONTEXT_ISSUES = 10;
const OCR_SMOKE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAWgAAABkCAAAAACOO/XGAAAG00lEQVR42u2afWyUVRaHn5lOl49qGeiskoKbVkpLpayARQ0ijsAKgnERDFXBUE2VKkrA+kUsxl2qoIjdRtytUaSw+NEta0AkBbqarUCjMBSMilbFClJB2hostGJb5vjHfHRm3nemgMGEmfP769zfve+Z5Hnv3I8zYxFUv4esikBBK2iVglbQClqloBW0SkEraAWtUtAKWqWgFbSCViloBa1S0ApaQasUtIJWKWgFraBVClpBqxS0glbQqnMtm4lX0QJjB3sbOz+B5BvPLvnxCyxK2CcxKg0o8zUeBiaYDBKnw+GYLyJS4HA4xhi6O1fdO8xaKSqvbGf9ho41wQmA1iY4ZuiOW7EbiifpTDZbOrJOAXAAWLjU6x0FajI98e7eZ5D53jmwdd9lACXzg7smVMU46LpOf3j4cIDf9oV3mTm9nK5qgBaA+RMBS5xOaGznIGf1w/6wqgqwPd/NAz+/vLOuLj55zAPDujMVdEQNdAJ81QAj+gBcHty9uvAQwLF9K/MX941oxuSpYziQJyKSD2QF9oROYJvHHgn2NpNEywKGju6MZJ7PMruwXOV0Ovv7GoOcTmfwDPy+tMb8nf20pSv+/7crak6IiAz0OftqYXYv41M7FgI4rkkBqFkSwYyepeP4TgDuAnjP6w0u9DcuTQXKl7tk2mjTXJtmjnx8uvfNSf5mrMXzvMttDfAGMPg9gOTMwKfmdQKLFsXzwR0N8Pe5fcOa0bN0uCIPfUpEZCUQ32i6dMwAbvAuHdOA3u+7XK6LwPZ1cJ68wM/8HsApIiLvAlSENaNv6YioaT2g43WznvbNwHVAgcjmDUDbuOzs7KN9VndEyncAYDwAk3v72qZmjBWV7DcCa8x63m2BuFwA3pl6qmvlnv1ypHw9AFoBsCQBvcKaUQZ6kvnMv9U/IAeo3WeSqgyYkgxIybSTAb4jB2CFJ8+R0KcGAWxxAzR/B1wW1oy6c/R/FhusGYu64ik9T8LaZwxjfqgE7gEaZ1YBzg2JUHa3QJG9GYC3NsGLhscSb9gKewqKgW1A6piwZpRthpOk1DgoX271bYYiNwN/chs2w2eBAZ0i8ssUYNz2Ablf/tsKjOmUr4EVsgBoOhK6GUq1FWBcnbQPB9ZGMGNrM4TpwMGPQt1T/wTuigP+8N/h5D82uaEsc7YbMjb4Kh3tvsU3WGMXA7yfOfX2vXD/zAhmtN0MS4HcruYsID+wvzkOeCh0Rr8NxNV7Rny+5oSvQOH4RsQ7o+8B2o0zWuQFf9HpUXdkM7ZmdL/RQEVoJe8fwC0pnnjInQlbh3rCH/920F8DBGu8WcKh/utIfWNkM5aOd8BNwHe7Qy7SHwAFvtb+h9I+80Tu1emPtHjCFrCbZHPfN7GJzCQAKoZ+HMGMRtBlFr/WGjonA2wK9oqA0Vd74mVXpBW3AgyzAr88n1HhOVCD2U06rxRSqg+9Mgig6S/7w5sxN6OzLjKArt8MPOFt7KkFIOGlj13XAJxMBaDJFPT6VdBr4x975n22JB5oXBjWjLpztH2Iwbo4uHldxcA7c3OCKs4PLv4he7K3MedNgOnPDmLE9jUFTYlbPEvAt4Y8AE8CM7KAHo+n3uGGdV+mhzGjDnROTncP3Zc3IeSbED83t3iUr3FtUjM9545yuYAeTxUtu3I/wJE2yDCkav7EX9Ug5/WNIK50czPKQK/MCzMwe1dXfL1Jf0Jh13J0t/W1xuX+pqdmwS7AiOtzgH7ehnMjUBfGjME1uls9tzTBaP4PyDK4HQB7ffVwAHcYU0GfntrXQ5+rsNjt9sBaXLoF+NdRD/T1AEPCmNG3RtPvzyHGgfqzyJxSDywqAkhtgrcOwkTb07Yfg/8lNmBsNTSMLxkHDfP3AhfcHMaMQtBXVoYYTxf+xq9NEoeXALMqn3RXr3EE9S2/uhM+He9IO7a/A+CZC8OZ0VXreBWTknQRkO0JP+0u34ciIpICKSIihUCpiBwfCYw61BcYuD04+ZtB73peBDPWah2nqdby8vJy70XcdUUtWJ9LnmeBQ9cH/+JyW+1UfzyysiSCGXUz2vx4d6Yz2q/Suvx4gBIR2ZAIsCCkHrfr/hEOmz191jp3d+b5q98BdKpn+3tCRES+yAB61+vfdrvTJeu6GTDYWOx7rRX6r/L8gzdjx1938FIKMScz0Kmhd/Ad2/xh4vQzPt4NXfpg0pwFvrNGUtVNA3JjjzOWkAL+nncgLfSno5pt0H/2WX9Gx9rbAu8obZKgoFXn/RVcQasUtIJWKWgFraBVClpBqxS0glbQKgWtoFUKWkEraJWCVtAqBa2gFbRKQStolYJW0ApapaAVtEpBK+jY1a9OF6Y9gJdStQAAAABJRU5ErkJggg==';

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

function buildPayload(parsed, requestId) {
  const audit = parsed.workbook ? normalizeAudit(auditWorkbook(parsed.workbook)) : emptyAudit();
  const document = attachAuditSummary(parsed.document, audit);
  const warnings = Array.isArray(document.warnings) ? document.warnings : [];
  return {
    requestId,
    document,
    audit,
    summary: {
      fileType: document.type,
      sheetCount: parsed.workbook?.sheets?.length || 0,
      rowCount: countRows(parsed.workbook),
      textLength: typeof document.text === 'string' ? document.text.length : 0,
      warningCount: warnings.length,
      errorCount: audit.errors.length,
      anomalyCount: audit.anomalies.length,
      confidence: typeof document.confidence === 'number' ? document.confidence : null,
      metrics: audit.metrics
    }
  };
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

  if (req.method === 'GET' && String(req.query?.ocr_smoke ?? '') === '1') {
    try {
      const parsed = await parseBusinessDocument({
        name:'ocr-smoke.png',
        buffer:Buffer.from(OCR_SMOKE_PNG_BASE64, 'base64')
      });
      const text = String(parsed.document?.text || '');
      return res.status(200).json({
        ok:/营业\s*额/.test(text) && /88/.test(text),
        confidence:parsed.document?.confidence ?? null,
        text
      });
    } catch (error) {
      return res.status(500).json({ ok:false, code:error?.code || error?.name || 'Error' });
    }
  }

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
    const parserDeps = {
      ...deps,
      onProgress: observeProgress
    };
    const parsed = await parser({ name:file.name, buffer }, parserDeps);
    if (streamMode) observeProgress({ phase:'audit', percent:90, message:'正在检查数据质量并整理结果' });
    const payload = buildPayload(parsed, requestId);

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
