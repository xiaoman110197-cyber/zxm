import { auditWorkbook } from '../src/audit/rules.js';
import { parseBusinessDocument, supportedBusinessDocumentExtensions } from '../src/documents/parse.js';

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

export async function handleAnalyzeFileRequest(req, res, deps = {}) {
  if (req.method && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const file = req.body?.file;
  if (!file?.name || !file?.contentBase64) return res.status(400).json({ error: 'file with name and contentBase64 is required' });

  const extension = extensionOf(file.name);
  if (!supportedBusinessDocumentExtensions.includes(extension)) {
    return res.status(415).json({ error: '支持 Excel、CSV、PDF、Word DOCX 和 JPG/PNG 图片' });
  }

  let buffer;
  try {
    buffer = Buffer.from(file.contentBase64, 'base64');
  } catch {
    return res.status(422).json({ error: '文件内容损坏或无法解析' });
  }
  if (!buffer.length) return res.status(422).json({ error: '文件内容为空或无法解析' });
  if (buffer.length > MAX_FILE_BYTES) {
    return res.status(413).json({ error: '文件过大：当前版本单个文件最大支持 3 MB' });
  }

  try {
    const parser = deps.parseBusinessDocument || parseBusinessDocument;
    const parsed = await parser({ name:file.name, buffer }, deps);
    const audit = parsed.workbook ? normalizeAudit(auditWorkbook(parsed.workbook)) : emptyAudit();
    const document = attachAuditSummary(parsed.document, audit);
    const warnings = Array.isArray(document.warnings) ? document.warnings : [];
    return res.status(200).json({
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
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[analyze-file]', file.name, detail);
    return res.status(422).json({ error: '文件损坏、格式不匹配或内容无法解析', detail });
  }
}

export default async function handler(req, res) {
  return handleAnalyzeFileRequest(req, res);
}
