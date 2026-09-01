import { randomUUID } from 'node:crypto';
import { createDeepSeekProvider } from '../src/ai/providers.js';
import { parseBusinessDocument } from '../src/documents/parse.js';
import { decodeBase64Strict } from '../src/http/base64.js';
import { buildFieldMappingInput, sanitizeMappingSuggestions } from '../src/experience/field-mapper.js';
import { summarizeWorkbook } from '../src/experience/summary.js';

const MAX_FILE_BYTES = 3 * 1024 * 1024;

function extensionOf(name=''){
  const lower = String(name).toLowerCase();
  const index = lower.lastIndexOf('.');
  return index >= 0 ? lower.slice(index) : '';
}

function runtimeFieldMapper(deps){
  if (typeof deps.fieldMapper === 'function') return deps.fieldMapper;
  const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey) return null;
  const provider = createDeepSeekProvider({ apiKey, timeoutMs:10000, maxOutputTokens:1200 });
  return (input) => provider.mapExperienceFields(input);
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

    const confirmedMappings = Array.isArray(req.body?.confirmedMappings) ? req.body.confirmedMappings : [];
    const summary = summarizeWorkbook(parsed.workbook, { now:deps.now || new Date(), confirmedMappings });
    let mappingSuggestions = [];
    let mappingStatus = confirmedMappings.length ? 'confirmed' : 'not_requested';
    let mappingError = null;

    if (req.body?.requestFieldMapping === true && !confirmedMappings.length) {
      const mapper = runtimeFieldMapper(deps);
      if (!mapper) {
        mappingStatus = 'unavailable';
        mappingError = 'AI字段识别暂不可用；现有确定性汇总仍可继续使用。';
      } else {
        try {
          const input = buildFieldMappingInput(parsed.workbook);
          const raw = await mapper(input);
          mappingSuggestions = sanitizeMappingSuggestions(raw, parsed.workbook);
          mappingStatus = mappingSuggestions.length ? 'needs_confirmation' : 'no_suggestions';
          if (!mappingSuggestions.length) mappingError = 'AI没有找到足够明确的字段映射，建议人工确认列含义。';
        } catch {
          mappingStatus = 'failed';
          mappingError = 'AI字段识别失败；不会影响现有确定性汇总，请稍后重试。';
        }
      }
    }

    return res.status(200).json({
      requestId,
      source:{ fileName:file.name, fileType:extension.slice(1) },
      summary,
      mappingStatus,
      mappingSuggestions,
      ...(mappingError ? { mappingError } : {})
    });
  } catch {
    return res.status(422).json({ error:'表格无法解析，请检查文件格式或内容', requestId });
  }
}

export default async function handler(req, res){
  return handleExperienceSummaryRequest(req, res);
}
