import * as XLSX from 'xlsx';
import { createDeepSeekProvider } from '../src/ai/providers.js';
import { parseBusinessDocument } from '../src/documents/parse.js';
import { buildFieldMappingInput, sanitizeMappingSuggestions } from '../src/experience/field-mapper.js';
import { summarizeWorkbook } from '../src/experience/summary.js';
import { handleExperienceQuestionRequest } from '../api/experience-summary.js';

const expected = { records:21, appointments:18, arrivals:7, completed:4, noShows:4, revenue:3256, overdue:16 };

function assert(condition, message){ if (!condition) throw new Error(`LIVE_SELF_TEST_FAIL: ${message}`); }
function mockRes(){ return { statusCode:200, body:null, status(code){this.statusCode=code;return this;}, json(v){this.body=v;return this;}, setHeader(){} }; }

function makeXlsx(){
  const statuses=['已成交','已成交','已完成','完成','已到店','到店','已到诊','未到店','爽约','未到诊','no_show','取消','已取消','cancelled','取消','已预约','预约','confirmed','咨询','lead','咨询中'];
  const dateForms=['2026/09/02','2026-09-02','2026年09月02日','2026.09.02'];
  const amounts=['¥688','488元','￥1,080',1000,...Array(17).fill('')];
  const rows=statuses.map((status,i)=>({
    '发生日':dateForms[i%4], '客户称呼':`测试客${i+1}`, '进度口径':status, '到账口径':amounts[i],
    '来路口径':['抖音','企业微信','小红书','美团'][i%4], '跟单人':['小王','小李','小陈'][i%3],
    '下次处理点':i<16?'2026-09-01 18:00':'2026-09-03 10:00', '待办口径':i<16?'待处理':'进行中',
    '手机':`1390000${String(1000+i).slice(-4)}`
  }));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'门店流水');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{指标:'营业额',数值:99999},{指标:'成交单量',数值:99}]),'经营汇总_人工');
  return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
}

const key=String(process.env.DEEPSEEK_API_KEY||'').trim();
assert(key,'DEEPSEEK_API_KEY missing');
const provider=createDeepSeekProvider({apiKey:key,timeoutMs:20000,maxOutputTokens:1800});
const parsed=await parseBusinessDocument({name:'V7_混乱经营数据_测试.xlsx',buffer:makeXlsx()});
assert(parsed?.workbook,'xlsx parser returned no workbook');
const before=summarizeWorkbook(parsed.workbook);
assert(before.ok===false,'messy headers should not be silently treated as standard');

const profile=buildFieldMappingInput(parsed.workbook);
const raw=await provider.mapExperienceFields(profile);
const suggestions=sanitizeMappingSuggestions(raw,parsed.workbook);
const fieldSet=new Set(suggestions.map(x=>x.field));
for(const field of ['date','status','amount','channel','owner','due']) assert(fieldSet.has(field),`DeepSeek did not map ${field}`);
const confirmed=suggestions.filter(x=>x.confidence>=0.55).map(x=>({sheet:x.sheet,header:x.header,field:x.field}));
const after=summarizeWorkbook(parsed.workbook,{confirmedMappings:confirmed});
assert(after.ok===true,'summary still unavailable after confirmed mappings');
for(const [keyName,value] of Object.entries(expected)) assert(after.metrics?.[keyName]===value,`${keyName}: expected ${value}, got ${after.metrics?.[keyName]}`);
assert(after.usedSheet==='门店流水','wrong sheet selected; artificial summary sheet must not win');

const q1=mockRes();
await handleExperienceQuestionRequest({method:'POST',body:{question:'今天怎样？',summary:after,source:{fileName:'V7_混乱经营数据_测试.xlsx'},history:[]}},q1,{provider});
assert(q1.statusCode===200 && q1.body?.modelUsed===true,'natural-language question did not use DeepSeek successfully');
const q2=mockRes();
await handleExperienceQuestionRequest({method:'POST',body:{question:'今天利润怎么样？',summary:after,source:{fileName:'V7_混乱经营数据_测试.xlsx'},history:[{role:'owner',text:'今天怎样？'},{role:'assistant',text:q1.body?.answer?.overview||''}]}},q2,{provider});
assert(q2.statusCode===200 && q2.body?.modelUsed===true,'profit follow-up did not use DeepSeek successfully');
assert(/无法判断利润|不能判断利润|营业额不能等同利润|缺少成本/.test(String(q2.body?.answer?.profit||'')),'profit guard failed');

console.log('LIVE_SELF_TEST_PASS');
console.log(JSON.stringify({model:provider.model,suggestions:suggestions.map(x=>({header:x.header,field:x.field,confidence:x.confidence})),metrics:after.metrics,fieldCoverage:after.fieldCoverage,q1Overview:q1.body.answer.overview,q2Profit:q2.body.answer.profit}));
