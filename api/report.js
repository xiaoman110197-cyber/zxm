import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { buildReportWorkbook } from '../src/reports/workbook-report.js';
import { decodeBase64Strict } from '../src/http/base64.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_FILE_BYTES = 3 * 1024 * 1024;

function isExcelName(name = '') {
  const lower = String(name).toLowerCase();
  return lower.endsWith('.xlsx') || lower.endsWith('.xls');
}

function safeReportName(name) {
  const base = String(name || '经营数据').replace(/\.(xlsx|xls)$/i, '').replace(/[\\/:*?"<>|]/g, '_');
  return `${base}-诊断报告.xlsx`;
}

function jsonError(res, status, error, requestId) {
  return res.status(status).json({ error, requestId });
}

export async function handleReportRequest(req, res, deps = {}) {
  const requestId = deps.requestId || randomUUID();
  if (req.method && req.method !== 'POST') return jsonError(res, 405, 'Method not allowed', requestId);

  const file = req.body?.file;
  if (!file?.name || !file?.contentBase64 || !isExcelName(file.name)) {
    return jsonError(res, 400, '需要原始 Excel file（name + contentBase64）才能生成报告', requestId);
  }

  let sourceBuffer;
  try {
    sourceBuffer = decodeBase64Strict(file.contentBase64);
  } catch {
    return jsonError(res, 422, '原始 Excel 文件内容无法读取', requestId);
  }
  if (sourceBuffer.length > MAX_FILE_BYTES) {
    return jsonError(res, 413, '文件过大：当前版本单个原始 Excel 最大支持 3 MB', requestId);
  }

  try {
    const workbook = XLSX.read(sourceBuffer, { type:'buffer', cellDates:true });
    if (!workbook.SheetNames?.length) return jsonError(res, 422, '原始 Excel 没有可读取的 Sheet', requestId);

    const output = buildReportWorkbook({
      workbook,
      audit:req.body?.audit || { errors:[], anomalies:[], metrics:{} },
      findings:Array.isArray(req.body?.findings) ? req.body.findings : []
    });

    return res.status(200).json({
      requestId,
      filename:safeReportName(file.name),
      mimeType:XLSX_MIME,
      contentBase64:output.toString('base64')
    });
  } catch (error) {
    console.error('[report]', requestId, 'failed', error?.name || 'Error');
    return jsonError(res, 422, 'Excel 报告生成失败', requestId);
  }
}

export default async function handler(req, res) {
  return handleReportRequest(req, res);
}
