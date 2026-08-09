import * as XLSX from 'xlsx';
import { buildReportWorkbook } from '../src/reports/workbook-report.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function isExcelName(name = '') {
  const lower = String(name).toLowerCase();
  return lower.endsWith('.xlsx') || lower.endsWith('.xls');
}

function safeReportName(name) {
  const base = String(name || '经营数据').replace(/\.(xlsx|xls)$/i, '').replace(/[\\/:*?"<>|]/g, '_');
  return `${base}-诊断报告.xlsx`;
}

export async function handleReportRequest(req, res) {
  if (req.method && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const file = req.body?.file;
  if (!file?.name || !file?.contentBase64 || !isExcelName(file.name)) {
    return res.status(400).json({ error: '需要原始 Excel file（name + contentBase64）才能生成报告' });
  }

  let sourceBuffer;
  try {
    sourceBuffer = Buffer.from(file.contentBase64, 'base64');
    if (!sourceBuffer.length) throw new Error('empty file');
  } catch {
    return res.status(422).json({ error: '原始 Excel 文件内容无法读取' });
  }

  try {
    const workbook = XLSX.read(sourceBuffer, { type: 'buffer', cellDates: true });
    if (!workbook.SheetNames?.length) return res.status(422).json({ error: '原始 Excel 没有可读取的 Sheet' });

    const output = buildReportWorkbook({
      workbook,
      audit: req.body?.audit || { errors: [], anomalies: [], metrics: {} },
      findings: Array.isArray(req.body?.findings) ? req.body.findings : []
    });

    return res.status(200).json({
      filename: safeReportName(file.name),
      mimeType: XLSX_MIME,
      contentBase64: output.toString('base64')
    });
  } catch (error) {
    return res.status(422).json({
      error: 'Excel 报告生成失败',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

export default async function handler(req, res) {
  return handleReportRequest(req, res);
}
