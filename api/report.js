import * as XLSX from 'xlsx';
import { buildReportWorkbook } from '../src/reports/workbook-report.js';
import { clientIp, createBurstLimiter, RequestGuardError, serializedSize, strictBase64ToBuffer } from '../src/http/guards.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_SOURCE_BYTES = 3 * 1024 * 1024;
const MAX_FINDINGS = 50;
const MAX_AUDIT_ITEMS = 1000;
const MAX_ANALYSIS_BYTES = 256 * 1024;
const reportLimiter = createBurstLimiter({ limit:10, windowMs:60_000 });

function isExcelName(name = '') {
  const lower = String(name).toLowerCase();
  return lower.endsWith('.xlsx') || lower.endsWith('.xls');
}

function safeReportName(name) {
  const base = String(name || '经营数据').replace(/\.(xlsx|xls)$/i, '').replace(/[\\/:*?"<>|]/g, '_');
  return `${base}-诊断报告.xlsx`;
}

function normalizedAudit(value) {
  const audit = value && typeof value === 'object' ? value : {};
  return {
    errors: Array.isArray(audit.errors) ? audit.errors : [],
    anomalies: Array.isArray(audit.anomalies) ? audit.anomalies : [],
    metrics: audit.metrics && typeof audit.metrics === 'object' ? audit.metrics : {}
  };
}

function reportPayloadTooLarge(audit, findings) {
  return findings.length > MAX_FINDINGS
    || audit.errors.length > MAX_AUDIT_ITEMS
    || audit.anomalies.length > MAX_AUDIT_ITEMS
    || serializedSize({ audit, findings }) > MAX_ANALYSIS_BYTES;
}

function checkRateLimit(req, res, limiter) {
  const check = limiter.check(clientIp(req));
  if (check.allowed) return false;
  if (typeof res.setHeader === 'function') res.setHeader('Retry-After', String(check.retryAfterSeconds));
  res.status(429).json({ error:'报告生成请求过于频繁，请稍后再试' });
  return true;
}

export async function handleReportRequest(req, res, deps = {}) {
  if (req.method && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (checkRateLimit(req, res, deps.rateLimiter || reportLimiter)) return res;

  const file = req.body?.file;
  if (!file?.name || !file?.contentBase64 || !isExcelName(file.name)) {
    return res.status(400).json({ error: '需要原始 Excel file（name + contentBase64）才能生成报告' });
  }

  let sourceBuffer;
  try {
    sourceBuffer = strictBase64ToBuffer(file.contentBase64, {
      maxBytes:MAX_SOURCE_BYTES,
      label:'原始 Excel 文件',
      tooLargeMessage:'原始 Excel 文件过大：当前版本最大支持 3 MB'
    });
    if (!sourceBuffer.length) throw new RequestGuardError(422, '原始 Excel 文件内容无法读取');
  } catch (error) {
    if (error instanceof RequestGuardError) return res.status(error.statusCode).json({ error:error.userMessage });
    return res.status(422).json({ error: '原始 Excel 文件内容无法读取' });
  }

  const audit = normalizedAudit(req.body?.audit);
  const findings = Array.isArray(req.body?.findings) ? req.body.findings : [];
  if (reportPayloadTooLarge(audit, findings)) {
    return res.status(413).json({ error:'报告分析内容过多，请精简诊断结果后再生成报告' });
  }

  try {
    const workbook = XLSX.read(sourceBuffer, { type: 'buffer', cellDates: true });
    if (!workbook.SheetNames?.length) return res.status(422).json({ error: '原始 Excel 没有可读取的 Sheet' });

    const output = buildReportWorkbook({ workbook, audit, findings });
    return res.status(200).json({
      filename: safeReportName(file.name),
      mimeType: XLSX_MIME,
      contentBase64: output.toString('base64')
    });
  } catch (error) {
    console.error('[report]', file.name, error instanceof Error ? error.message : String(error));
    return res.status(422).json({ error: 'Excel 报告生成失败' });
  }
}

export default async function handler(req, res) {
  return handleReportRequest(req, res);
}
