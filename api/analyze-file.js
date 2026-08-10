import { analyzeUploadedBusinessFile, FileAnalysisError } from '../src/documents/analyze.js';
import { clientIp, createBurstLimiter } from '../src/http/guards.js';

const fileAnalysisLimiter = createBurstLimiter({ limit:20, windowMs:60_000 });

function checkRateLimit(req, res, limiter) {
  const check = limiter.check(clientIp(req));
  if (check.allowed) return false;
  if (typeof res.setHeader === 'function') res.setHeader('Retry-After', String(check.retryAfterSeconds));
  res.status(429).json({ error:'文件分析请求过于频繁，请稍后再试' });
  return true;
}

export async function handleAnalyzeFileRequest(req, res, deps = {}) {
  if (req.method && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (checkRateLimit(req, res, deps.rateLimiter || fileAnalysisLimiter)) return res;

  const analyze = deps.analyzeUploadedBusinessFile || analyzeUploadedBusinessFile;
  try {
    const result = await analyze(req.body?.file, deps);
    return res.status(200).json(result);
  } catch (error) {
    const status = error instanceof FileAnalysisError || Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    const userMessage = typeof error?.userMessage === 'string'
      ? error.userMessage
      : status >= 500
        ? '文件分析服务暂时不可用，请稍后重试'
        : '文件损坏、格式不匹配或内容无法解析';
    console.error('[analyze-file]', req.body?.file?.name || 'unknown', error instanceof Error ? error.message : String(error));
    return res.status(status).json({ error:userMessage });
  }
}

export default async function handler(req, res) {
  return handleAnalyzeFileRequest(req, res);
}
