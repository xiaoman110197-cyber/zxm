import { randomUUID } from 'node:crypto';
import { parseBusinessDocument } from '../src/documents/parse.js';
import { decodeBase64Strict } from '../src/http/base64.js';
import { summarizeWorkbook } from '../src/experience/summary.js';

const MAX_FILE_BYTES = 3 * 1024 * 1024;

function extensionOf(name=''){
  const lower = String(name).toLowerCase();
  const index = lower.lastIndexOf('.');
  return index >= 0 ? lower.slice(index) : '';
}

export async function handleExperienceSummaryRequest(req, res, deps={}){
  const requestId = deps.requestId || randomUUID();
  if (req.method !== 'POST') return res.status(405).json({ error:'只支持 POST', requestId });
  const file = req.body?.file;
  if (!file?.name || !file?.contentBase64) return res.status(400).json({ error:'缺少 file', requestId });
  const extension = extensionOf(file.name);
  if (!['.xlsx','.xls','.csv'].includes(extension)) return res.status(415).json({ error:'当前体验只支持 Excel / CSV', requestId });

  let buffer;
  try { buffer = decodeBase64Strict(file.contentBase64); }
  catch { return res.status(422).json({ error:'文件内容无法读取', requestId }); }
  if (buffer.length > MAX_FILE_BYTES) return res.status(413).json({ error:'文件过大，请控制在 3 MB 内', requestId });

  try {
    const parsed = await (deps.parseBusinessDocument || parseBusinessDocument)({ name:file.name, buffer });
    if (!parsed?.workbook) return res.status(422).json({ error:'未识别到表格数据', requestId });
    const summary = summarizeWorkbook(parsed.workbook, { now:deps.now || new Date() });
    return res.status(200).json({
      requestId,
      source:{ fileName:file.name, fileType:extension.slice(1) },
      summary
    });
  } catch {
    return res.status(422).json({ error:'表格无法解析，请检查文件格式或内容', requestId });
  }
}

export default async function handler(req, res){
  return handleExperienceSummaryRequest(req, res);
}
