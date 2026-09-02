import { randomUUID } from 'node:crypto';
import { createDeepSeekProvider } from '../src/ai/providers.js';
import { parseBusinessDocument } from '../src/documents/parse.js';
import { decodeBase64Strict } from '../src/http/base64.js';
import { buildFieldMappingInput, sanitizeMappingSuggestions } from '../src/experience/field-mapper.js';
import { summarizeWorkbook, buildBusinessQuestionContext } from '../src/experience/summary.js';

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_QUESTION_CHARS = 600;
const MAX_HISTORY_TURNS = 8;
const MAX_HISTORY_CHARS = 900;

function extensionOf(name=''){
  const lower = String(name).toLowerCase();
  const index = lower.lastIndexOf('.');
  return index >= 0 ? lower.slice(index) : '';
}

function runtimeFieldMapper(deps){
  if (typeof deps.fieldMapper === 'function') {
    return {
      map:deps.fieldMapper,
      provider:deps.fieldMapperProvider || 'AI',
      model:deps.fieldMapperModel || 'unknown'
    };
  }
  const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey) return null;
  const provider = createDeepSeekProvider({ apiKey, timeoutMs:10000, maxOutputTokens:1200 });
  return {
    map:(input) => provider.mapExperienceFields(input),
    provider:provider.name === 'deepseek' ? 'DeepSeek' : (provider.name || 'AI'),
    model:provider.model || 'unknown'
  };
}

function runtimeQuestionProvider(deps){
  if (deps.provider?.answerExperienceQuestion) return deps.provider;
  const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey) return null;
  return createDeepSeekProvider({ apiKey, timeoutMs:12000, maxOutputTokens:1500 });
}

function clip(value, max=600){
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanHistory(history){
  if (!Array.isArray(history)) return [];
  return history.slice(-MAX_HISTORY_TURNS).map((item) => {
    const role = item?.role === 'assistant' ? 'assistant' : 'owner';
    const text = clip(item?.text, MAX_HISTORY_CHARS);
    return text ? { role, text } : null;
  }).filter(Boolean);
}

function unsupportedProfitAmount(text){
  return /(利润|毛利)[^\n]{0,28}[¥￥]?\s*\d[\d,]*(?:\.\d+)?/i.test(String(text || ''));
}

function safeAnswer(raw, context){
  const source = raw && typeof raw === 'object' ? raw : {};
  let overview = clip(source.overview, 900) || '当前数据可以支持部分经营判断。';
  let profit = clip(source.profit, 700) || '暂时无法判断利润。';
  let actions = Array.isArray(source.actions) ? source.actions.slice(0,3).map((item) => clip(item, 260)).filter(Boolean) : [];
  const limits = Array.isArray(source.limits) ? source.limits.slice(0,6).map((item) => clip(item, 260)).filter(Boolean) : [];

  if (!context.availability?.profit) {
    profit = '暂时无法判断利润：当前营业额不能等同利润；还需要成本、毛利率或明确的利润字段。';
    if (unsupportedProfitAmount(overview)) overview = '现有经营指标可以继续判断业务量、营业额和效率问题；利润暂时无法判断，因为缺少成本或毛利证据。';
    actions = actions.filter((item) => !unsupportedProfitAmount(item));
    if (!limits.some((item) => /利润|毛利|成本/.test(item))) limits.push('缺少成本、毛利率或利润字段，不能判断利润金额。');
  }

  return {
    overview,
    cost:clip(source.cost, 700) || '当前数据不足以补充更多降本判断。',
    efficiency:clip(source.efficiency, 700) || '当前数据不足以补充更多效率判断。',
    profit,
    actions,
    limits
  };
}

function evidenceFromContext(context){
  const evidence = [];
  if (context.source?.fileName) evidence.push(`来源：${context.source.fileName}`);
  if (context.source?.usedSheet) evidence.push(`主明细表：${context.source.usedSheet}`);
  if (context.period) evidence.push(`统计范围：${context.period === 'all' ? '整份主明细表' : context.period}`);
  if (context.facts?.records !== null && context.facts?.records !== undefined) evidence.push(`业务记录：${context.facts.records}`);
  if (context.fieldCoverage !== null && context.fieldCoverage !== undefined) evidence.push(`数据完整度：${context.fieldCoverage}%`);
  return evidence.slice(0,6);
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
    let aiMappingTrace = null;

    if (req.body?.requestFieldMapping === true && !confirmedMappings.length) {
      const mapper = runtimeFieldMapper(deps);
      if (!mapper) {
        mappingStatus = 'unavailable';
        mappingError = 'AI字段识别暂不可用；现有确定性汇总仍可继续使用。';
        aiMappingTrace = {
          provider:'DeepSeek',
          model:process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
          callStatus:'unavailable',
          requestId,
          mappingCount:0
        };
      } else {
        try {
          const input = buildFieldMappingInput(parsed.workbook);
          const raw = await mapper.map(input);
          mappingSuggestions = sanitizeMappingSuggestions(raw, parsed.workbook);
          mappingStatus = mappingSuggestions.length ? 'needs_confirmation' : 'no_suggestions';
          aiMappingTrace = {
            provider:mapper.provider,
            model:mapper.model,
            callStatus:'success',
            requestId,
            mappingCount:mappingSuggestions.length
          };
          if (!mappingSuggestions.length) mappingError = 'AI没有找到足够明确的字段映射，建议人工确认列含义。';
        } catch {
          mappingStatus = 'failed';
          mappingError = 'AI字段识别失败；不会影响现有确定性汇总，请稍后重试。';
          aiMappingTrace = {
            provider:mapper.provider,
            model:mapper.model,
            callStatus:'failed',
            requestId,
            mappingCount:0
          };
        }
      }
    }

    return res.status(200).json({
      requestId,
      source:{ fileName:file.name, fileType:extension.slice(1) },
      summary,
      mappingStatus,
      mappingSuggestions,
      ...(aiMappingTrace ? { aiMappingTrace } : {}),
      ...(mappingError ? { mappingError } : {})
    });
  } catch {
    return res.status(422).json({ error:'表格无法解析，请检查文件格式或内容', requestId });
  }
}

export async function handleExperienceQuestionRequest(req, res, deps={}){
  const requestId = deps.requestId || randomUUID();
  if (req.method !== 'POST') return res.status(405).json({ error:'只支持 POST', requestId });
  const question = clip(req.body?.question, MAX_QUESTION_CHARS);
  if (!question) return res.status(400).json({ error:'请输入老板的问题', requestId });
  const summary = req.body?.summary;
  if (!summary || typeof summary !== 'object') return res.status(400).json({ error:'缺少经营汇总数据', requestId });

  const context = buildBusinessQuestionContext(summary, { source:req.body?.source || {} });
  const evidence = evidenceFromContext(context);
  if (!context.available) {
    return res.status(200).json({
      requestId,
      modelUsed:false,
      answer:{
        overview:`当前数据还不足以可靠回答这个问题：${context.reason || '经营汇总不完整'}。`,
        cost:'可以先补齐关键字段，再判断具体降本空间。',
        efficiency:'现有数据不足以形成可靠效率判断。',
        profit:'暂时无法判断利润：缺少可靠经营汇总以及成本/毛利证据。',
        actions:['先补齐页面提示的关键字段'],
        limits:context.missing || []
      },
      evidence
    });
  }

  const provider = runtimeQuestionProvider(deps);
  if (!provider) return res.status(503).json({ error:'AI经营问答暂时不可用，程序汇总仍可继续使用。', requestId, evidence });

  try {
    const history = cleanHistory(req.body?.history);
    const raw = await provider.answerExperienceQuestion({ question, context, history });
    const answer = safeAnswer(raw, context);
    return res.status(200).json({
      requestId,
      modelUsed:true,
      model:provider.model || provider.name || 'AI',
      answer,
      evidence
    });
  } catch {
    return res.status(503).json({ error:'AI经营问答暂时不可用，程序汇总仍可继续使用。', requestId, evidence });
  }
}

export default async function handler(req, res){
  return handleExperienceSummaryRequest(req, res);
}
