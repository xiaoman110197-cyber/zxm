import { parseWorkbook } from '../src/audit/workbook.js';
import { auditWorkbook } from '../src/audit/rules.js';

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

function isValidExcelBuffer(name, buffer) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx')) return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (lower.endsWith('.xls')) return buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf;
  return false;
}

export async function handleAnalyzeFileRequest(req, res) {
  if (req.method && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const file = req.body?.file;
  if (!file?.name || !file?.contentBase64) return res.status(400).json({ error: 'file with name and contentBase64 is required' });

  const lower = file.name.toLowerCase();
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
    return res.status(415).json({ error: '当前阶段仅支持 Excel (.xlsx/.xls)' });
  }

  let buffer;
  try {
    buffer = Buffer.from(file.contentBase64, 'base64');
  } catch {
    return res.status(422).json({ error: '文件内容损坏或无法解析' });
  }
  if (!buffer.length || !isValidExcelBuffer(file.name, buffer)) {
    return res.status(422).json({ error: 'Excel 文件损坏或无法解析' });
  }

  try {
    const workbook = parseWorkbook(buffer);
    if (!workbook.sheets.length) return res.status(422).json({ error: 'Excel 文件无法解析：没有可读取的工作表' });
    const audit = normalizeAudit(auditWorkbook(workbook));
    return res.status(200).json({
      document: {
        name: file.name,
        type: 'excel',
        sheetNames: workbook.sheets.map((sheet) => sheet.name),
        sheets: workbook.sheets.map((sheet) => ({ name: sheet.name, headers: sheet.headers, rowCount: sheet.rows.length }))
      },
      audit,
      summary: {
        sheetCount: workbook.sheets.length,
        errorCount: audit.errors.length,
        anomalyCount: audit.anomalies.length,
        metrics: audit.metrics
      }
    });
  } catch (error) {
    return res.status(422).json({ error: 'Excel 文件损坏或无法解析', detail: error instanceof Error ? error.message : String(error) });
  }
}

export default async function handler(req, res) {
  return handleAnalyzeFileRequest(req, res);
}
