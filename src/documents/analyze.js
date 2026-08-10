import { auditWorkbook } from '../audit/rules.js';
import { RequestGuardError, strictBase64ToBuffer } from '../http/guards.js';
import { parseBusinessDocument, supportedBusinessDocumentExtensions } from './parse.js';

export const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_CONTEXT_ISSUES = 10;

export class FileAnalysisError extends Error {
  constructor(statusCode, userMessage, detail = userMessage) {
    super(detail);
    this.name = 'FileAnalysisError';
    this.statusCode = statusCode;
    this.userMessage = userMessage;
  }
}

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

function validatePayload(file) {
  if (!file?.name || !file?.contentBase64) {
    throw new FileAnalysisError(400, 'file with name and contentBase64 is required');
  }
  const extension = extensionOf(file.name);
  if (!supportedBusinessDocumentExtensions.includes(extension)) {
    throw new FileAnalysisError(415, '支持 Excel、CSV、PDF、Word DOCX 和 JPG/PNG 图片');
  }

  try {
    const buffer = strictBase64ToBuffer(file.contentBase64, {
      maxBytes: MAX_FILE_BYTES,
      label: '文件',
      tooLargeMessage: '文件过大：当前版本单个文件最大支持 3 MB'
    });
    if (!buffer.length) throw new FileAnalysisError(422, '文件内容为空或无法解析');
    return buffer;
  } catch (error) {
    if (error instanceof FileAnalysisError) throw error;
    if (error instanceof RequestGuardError) {
      throw new FileAnalysisError(error.statusCode, error.userMessage, error.message);
    }
    throw new FileAnalysisError(422, '文件内容损坏或无法解析', error instanceof Error ? error.message : String(error));
  }
}

export async function analyzeUploadedBusinessFile(file, deps = {}) {
  const onProgress = typeof deps.onProgress === 'function' ? deps.onProgress : () => {};
  onProgress({ stage:'validating', percent:20, message:'正在校验文件…' });
  const buffer = validatePayload(file);

  try {
    const parser = deps.parseBusinessDocument || parseBusinessDocument;
    const parsed = await parser({ name:file.name, buffer }, { ...deps, onProgress });
    onProgress({ stage:'auditing', percent:86, message:'正在检查数据质量…' });
    const audit = parsed.workbook ? normalizeAudit(auditWorkbook(parsed.workbook)) : emptyAudit();
    onProgress({ stage:'preparing', percent:94, message:'正在整理经营数据…' });
    const document = attachAuditSummary(parsed.document, audit);
    const warnings = Array.isArray(document.warnings) ? document.warnings : [];
    return {
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
  } catch (error) {
    if (error instanceof FileAnalysisError) throw error;
    throw new FileAnalysisError(
      422,
      '文件损坏、格式不匹配或内容无法解析',
      error instanceof Error ? error.message : String(error)
    );
  }
}
