import * as XLSX from 'xlsx';
import { createDeepSeekProvider } from '../src/ai/providers.js';
import { parseBusinessDocument } from '../src/documents/parse.js';
import { buildFieldMappingInput, sanitizeMappingSuggestions } from '../src/experience/field-mapper.js';
import { summarizeWorkbook } from '../src/experience/summary.js';
import { handleExperienceQuestionRequest } from './experience-summary.js';

const EXPECTED = { records:21, appointments:18, arrivals:7, completed:4, noShows:4, revenue:3256, overdue:16 };

function makeMessyWorkbookBuffer(){
  const statuses = [
    '已成交','已成交','已完成','完成',
    '已到店','到店','已到诊',
    '未到店','爽约','未到诊','no_show',
    '取消','已取消','cancelled','取消',
    '已预约','预约','confirmed',
    '咨询','lead','咨询中'
  ];
  const revenue = [688,488,1080,1000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
  const channels = ['抖音','企业微信','小红书','美团'];
  const owners = ['小王','小李','小陈'];
  const dateForms = ['2026/09/02','2026-09-02','2026年09月02日','2026.09.02'];
  const rows = statuses.map((status, i) => ({
    '发生日':dateForms[i%dateForms.length],
    '客户称呼':`测试客${String.fromCharCode(65+i)}`,
    '进度口径':status,
    '到账口径':i===0?'¥688':i===1?'488元':i===2?'￥1,080':i===3?1000:'',
    '来路口径':channels[i%channels.length],
    '跟单人':owners[i%owners.length],
    '下次处理点':i<16?'2026-09-01 18:00':'2026-09-03 10:00',
    '待办口径':i<16?'待处理':'进行中',
    '手机':`1390000${String(1000+i).slice(-4)}`
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '门店流水');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{指标:'营业额',数值:99999},{指标:'完成单量',数值:99}]), '经营汇总_人工');
  return XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
}

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
    const parsed = await parseBusinessDocument({ name:'V7_混乱经营数据_测试.xlsx', buffer:makeMessyWorkbookBuffer() });
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
    const profitGuard = /无法判断利润|不能判断利润|营业额不能等同利润|缺少成本/.test(String(q2res.body?.answer?.profit || ''));
    return res.status(200).json({
      ok:Object.values(checks).every(Boolean) && q1res.statusCode===200 && q2res.statusCode===200 && profitGuard,
      configured:true,
      model:provider.model,
      before:{ ok:before.ok, missing:before.missing },
      suggestions:suggestions.map(x => ({ header:x.header, field:x.field, confidence:x.confidence })),
      after:{ usedSheet:after.usedSheet, period:after.period, metrics, missing:after.missing, fieldCoverage:after.fieldCoverage },
      checks,
      q1:{ status:q1res.statusCode, modelUsed:q1res.body?.modelUsed, answer:q1res.body?.answer },
      q2:{ status:q2res.statusCode, modelUsed:q2res.body?.modelUsed, profitGuard, answer:q2res.body?.answer },
      privacy:{ rawCustomerRowsReturned:false, apiKeyReturned:false }
    });
  } catch (error) {
    return res.status(200).json({ ok:false, configured:true, stage:'runtime', error:String(error?.message || error) });
  }
}
