import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { buildReportWorkbook } from '../src/reports/workbook-report.js';
import { decodeBase64Strict } from '../src/http/base64.js';
import { parseWorkbook } from '../src/audit/workbook.js';
import { auditWorkbook } from '../src/audit/rules.js';
import { checkBurstLimit, requestClientKey } from '../src/http/guard.js';
import { verifyTrustToken } from '../src/security/trust-token.js';
import { sourceDigest } from '../src/security/source-digest.js';
import { resolveTrustSecret } from '../src/config/runtime.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_REPORT_FINDINGS = 100;

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

function usableInjectedTrustSecret(secret) {
  if (Buffer.isBuffer(secret)) return secret.length > 0;
  return typeof secret === 'string' && Boolean(secret.trim());
}

function normalizeAudit(audit) {
  return {
    ...audit,
    errors:(audit?.errors || []).map((error) => {
      if (error.type === 'duplicate_record') return { ...error, type:'duplicate' };
      if (error.type !== 'cross_sheet_total_mismatch') return error;
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
    })
  };
}

function applyBurstGuard(req, res, requestId, deps) {
  if (deps.disableBurstGuard) return null;
  const key = requestClientKey(req, 'report');
  if (!key) return null;
  const result = checkBurstLimit(key, { limit:10, windowMs:10 * 60 * 1000 });
  if (result.allowed) return null;
  res.setHeader?.('Retry-After', String(result.retryAfterSeconds));
  return jsonError(res, 429, '报告生成请求较频繁，请稍后再试', requestId);
}

export async function handleReportRequest(req, res, deps = {}) {
  const requestId = deps.requestId || randomUUID();
  if (req.method && req.method !== 'POST') return jsonError(res, 405, 'Method not allowed', requestId);

  const file = req.body?.file;
  if (!file?.name || !file?.contentBase64 || !isExcelName(file.name)) {
    return jsonError(res, 400, '需要原始 Excel file（name + contentBase64）才能生成报告', requestId);
  }
  const trust = resolveTrustSecret(deps.env || process.env);
  const productionTrustRequired = deps.requireTrustToken === true || process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL_ENV);
  if (productionTrustRequired && !usableInjectedTrustSecret(deps.trustSecret) && !trust.secret) {
    return jsonError(res, 503, '服务端证据签名配置不可用', requestId);
  }
  const limited = applyBurstGuard(req, res, requestId, deps);
  if (limited) return limited;

  let sourceBuffer;
  try {
    sourceBuffer = decodeBase64Strict(file.contentBase64);
  } catch {
    return jsonError(res, 422, '原始 Excel 文件内容无法读取', requestId);
  }
  if (sourceBuffer.length > MAX_FILE_BYTES) {
    return jsonError(res, 413, '文件过大：当前版本单个原始 Excel 最大支持 3 MB', requestId);
  }

  let findings;
  try {
    const diagnosis = verifyTrustToken(req.body?.diagnosisToken, 'diagnosis', {
      secret:deps.trustSecret,
      env:deps.env,
      now:deps.trustNow
    });
    findings = diagnosis?.findings;
    if (!Array.isArray(findings) || findings.length > MAX_REPORT_FINDINGS) throw new TypeError('invalid findings');
    const digests = Array.isArray(diagnosis?.sourceDigests) ? diagnosis.sourceDigests : [];
    if (digests.length !== 1 || digests[0] !== sourceDigest(sourceBuffer)) throw new TypeError('source mismatch');
  } catch {
    return jsonError(res, 422, '诊断结果验证失败，请重新生成诊断后再下载', requestId);
  }

  try {
    const workbook = XLSX.read(sourceBuffer, { type:'buffer', cellDates:true });
    if (!workbook.SheetNames?.length) return jsonError(res, 422, '原始 Excel 没有可读取的 Sheet', requestId);
    const audit = normalizeAudit(auditWorkbook(parseWorkbook(sourceBuffer)));

    const output = buildReportWorkbook({
      workbook,
      audit,
      findings
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
