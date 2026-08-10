import { analyzeUploadedBusinessFile, FileAnalysisError } from '../src/documents/analyze.js';
import { clientIp, createBurstLimiter } from '../src/http/guards.js';

const streamedFileLimiter = createBurstLimiter({ limit:20, windowMs:60_000 });

function writeEvent(res, event) {
  res.write(`${JSON.stringify(event)}\n`);
}

function checkRateLimit(req, res, limiter) {
  const check = limiter.check(clientIp(req));
  if (check.allowed) return false;
  res.status(429);
  if (typeof res.setHeader === 'function') res.setHeader('Retry-After', String(check.retryAfterSeconds));
  writeEvent(res, { type:'error', status:429, error:'文件分析请求过于频繁，请稍后再试' });
  res.end();
  return true;
}

export async function handleAnalyzeFileStreamRequest(req, res, deps = {}) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method && req.method !== 'POST') {
    res.status(405);
    writeEvent(res, { type:'error', status:405, error:'Method not allowed' });
    return res.end();
  }
  if (checkRateLimit(req, res, deps.rateLimiter || streamedFileLimiter)) return res;

  const analyze = deps.analyzeUploadedBusinessFile || analyzeUploadedBusinessFile;
  try {
    const result = await analyze(req.body?.file, {
      ...deps,
      onProgress(event) {
        writeEvent(res, { type:'progress', ...event });
      }
    });
    writeEvent(res, { type:'result', result });
  } catch (error) {
    const status = error instanceof FileAnalysisError || Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    const userMessage = typeof error?.userMessage === 'string'
      ? error.userMessage
      : status >= 500
        ? '文件分析服务暂时不可用，请稍后重试'
        : '文件损坏、格式不匹配或内容无法解析';
    console.error('[analyze-file-stream]', req.body?.file?.name || 'unknown', error instanceof Error ? error.message : String(error));
    writeEvent(res, { type:'error', status, error:userMessage });
  }
  return res.end();
}

export default async function handler(req, res) {
  return handleAnalyzeFileStreamRequest(req, res);
}
