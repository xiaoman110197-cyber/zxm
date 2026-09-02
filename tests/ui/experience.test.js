import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../public/experience/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../../public/experience/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../../public/experience/styles.css', import.meta.url), 'utf8');

test('experience browser bundle parses as JavaScript', () => {
  assert.doesNotThrow(() => new Function(js));
});

test('experience is a separate standalone page', () => {
  assert.match(html, /降本.*增效.*增利/);
  assert.match(html, /id="roiForm"/);
  assert.match(html, /id="bossAsk"/);
  assert.doesNotMatch(html, /老板经营问诊器|真实经营问诊器|完整经营问诊/);
  assert.doesNotMatch(html, /href="\/"/);
});

test('experience diagnosis calculates cost efficiency and profit independently', () => {
  assert.match(js, /function diagnoseROI/);
  assert.match(js, /diagHours/);
  assert.match(js, /diagEfficiencyMain/);
  assert.match(js, /diagProfitMain/);
  assert.match(js, /lostCustomers/);
  assert.match(js, /margin/);
  assert.match(js, /ticket/);
});

test('profit amount is not estimated unless ticket margin and loss data are all known', () => {
  assert.match(js, /ticket\s*!==\s*null\s*&&\s*margin\s*!==\s*null\s*&&\s*lostCustomers\s*!==\s*null/);
  assert.match(js, /暂不估算利润金额/);
});

test('experience accepts real Excel or CSV and calls the aggregate-only summary api', () => {
  assert.match(html, /id="businessFile"/);
  assert.match(html, /\.xlsx/);
  assert.match(html, /\.csv/);
  assert.match(js, /\/api\/experience-summary/);
  assert.match(js, /fileToBase64/);
  assert.match(js, /realBusinessSummary/);
});

test('uploaded business summary replaces demo data for boss query without treating missing values as zero', () => {
  assert.match(js, /realBusinessSummary\s*\?/);
  assert.match(js, /无法计算|暂时无法判断/);
  assert.match(js, /missing/);
  assert.match(html, /数据完整度|缺少的数据/);
});

test('ambiguous spreadsheet fields require an explicit AI mapping request and owner confirmation', () => {
  assert.match(js, /requestFieldMapping/);
  assert.match(js, /fieldMappingPanel/);
  assert.match(js, /fieldMappingSuggestions/);
  assert.match(js, /confirmFieldMappings/);
  assert.match(js, /只读取.*列名.*类型统计|列名.*类型统计/);
  assert.match(js, /requestFieldMapping\s*:\s*true/);
  assert.match(js, /mappingSuggestions/);
  assert.match(js, /confirmedMappings/);
});

test('V7 real-data boss query uses AI for arbitrary questions and keeps follow-up history', () => {
  assert.match(js, /async function askBossQuestion/);
  assert.match(js, /\/api\/experience-question/);
  assert.match(js, /bossConversation/);
  assert.match(js, /history/);
  assert.match(js, /AI.*分析|正在分析/);
  assert.match(js, /evidence/);
  assert.match(html, /老板收到的回答/);
  assert.match(html + js, /bossHistory/);
});

test('V7 keeps a deterministic fallback when the model is unavailable instead of hiding the failure', () => {
  assert.match(js, /AI.*暂时不可用|大模型.*暂时不可用/);
  assert.match(js, /realBossAnswer/);
  assert.match(js, /catch/);
});

test('experience makes demo and deployment requirements explicit', () => {
  assert.match(html, /虚构|演示/);
  assert.match(html, /正式部署需要/);
  assert.match(html, /大模型|经营数据|数据源/);
});

test('module center exposes unopened modules without claiming they are deployed', () => {
  assert.match(html, /模块中心/);
  assert.match(js, /moduleCatalog/);
  assert.match(js, /recommended|optional|locked|enabled/);
  assert.match(html, /建议开启|待接数据|当前不适用/);
});

test('experience remains mobile-first', () => {
  assert.match(html, /viewport/);
  assert.match(css, /@media/);
  assert.doesNotMatch(css, /width:\s*1[2-9]\d{2}px/);
});
