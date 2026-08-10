import { analyzeUploadedBusinessFile, FileAnalysisError } from '../src/documents/analyze.js';

function writeEvent(res, event) {
  res.write(`${JSON.stringify(event)}\n`);
}

export async function handleAnalyzeFileStreamRequest(req, res, deps = {}) {
  if (req.method && req.method !== 'POST') {
    res.status(405);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    writeEvent(res, { type:'error', status:405, error:'Method not allowed' });
    return res.end();
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

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
