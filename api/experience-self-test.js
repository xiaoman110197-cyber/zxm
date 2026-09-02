import { createDeepSeekProvider } from '../src/ai/providers.js';
import { parseBusinessDocument } from '../src/documents/parse.js';
import { buildFieldMappingInput, sanitizeMappingSuggestions } from '../src/experience/field-mapper.js';
import { summarizeWorkbook } from '../src/experience/summary.js';
import { handleExperienceQuestionRequest } from './experience-summary.js';

const FILE_BASE64 = '__B64__';
const EXPECTED = { records:21, appointments:18, arrivals:7, completed:4, noShows:4, revenue:3256, overdue:16 };

function mockRes(){
  return { statusCode:200, body:null, status(code){ this.statusCode=code; return this; }, json(value){ this.body=value; return this; }, setHeader(){} };
}

export default async function handler(req, res){
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'GET only' });
  const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey) return res.status(200).json({ ok:false, configured:false, stage:'env', error:'DEEPSEEK_API_KEY missing' });
  try {
    const provider = createDeepSeekProvider({ apiKey, timeoutMs:15000, maxOutputTokens:1600 });
    const parsed = await parseBusinessDocument({ name:'V7_混乱经营数据_测试.xlsx', buffer:Buffer.from(FILE_BASE64,'base64') });
    const workbook = parsed?.workbook;
    if (!workbook) return res.status(200).json({ ok:false, configured:true, stage:'parse', error:'workbook missing' });
    const before = summarizeWorkbook(workbook);
    const profile = buildFieldMappingInput(workbook);
    const raw = await provider.mapExperienceFields(profile);
    const suggestions = sanitizeMappingSuggestions(raw, workbook);
    const confirmedMappings = suggestions.filter(x => x.confidence >= 0.55).map(x => ({ sheet:x.sheet, header:x.header, field:x.field }));
    const after = summarizeWorkbook(workbook, { confirmedMappings });
    const q1res = mockRes();
    await handleExperienceQuestionRequest({ method:'POST', body:{ question:'今天怎样？', summary:after, source:{ fileName:'V7_混乱经营数据_测试.xlsx' }, history:[] } }, q1res, { provider });
    const q2res = mockRes();
    await handleExperienceQuestionRequest({ method:'POST', body:{ question:'今天利润怎么样？', summary:after, source:{ fileName:'V7_混乱经营数据_测试.xlsx' }, history:[{role:'owner',text:'今天怎样？'},{role:'assistant',text:q1res.body?.answer?.overview || ''}] } }, q2res, { provider });
    const metrics = after?.metrics || {};
    const checks = Object.fromEntries(Object.entries(EXPECTED).map(([k,v]) => [k, metrics[k] === v]));
    return res.status(200).json({
      ok:Object.values(checks).every(Boolean) && q1res.statusCode===200 && q2res.statusCode===200,
      configured:true,
      model:provider.model,
      before:{ ok:before.ok, missing:before.missing },
      suggestions:suggestions.map(x => ({ header:x.header, field:x.field, confidence:x.confidence })),
      after:{ usedSheet:after.usedSheet, period:after.period, metrics, missing:after.missing, fieldCoverage:after.fieldCoverage },
      checks,
      q1:{ status:q1res.statusCode, modelUsed:q1res.body?.modelUsed, answer:q1res.body?.answer },
      q2:{ status:q2res.statusCode, modelUsed:q2res.body?.modelUsed, answer:q2res.body?.answer },
      privacy:{ rawRowsReturned:false, apiKeyReturned:false }
    });
  } catch (error) {
    return res.status(200).json({ ok:false, configured:true, stage:'runtime', error:String(error?.message || error) });
  }
}
