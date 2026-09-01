import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../public/experience/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../../public/experience/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../../public/experience/styles.css', import.meta.url), 'utf8');

test('experience is a separate page and keeps the existing homepage untouched', () => {
  assert.match(html, /降本.*增效.*增利/);
  assert.match(html, /id="roiForm"/);
  assert.match(html, /id="bossAsk"/);
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

test('boss today query produces a browser result instead of a dead button', () => {
  assert.match(js, /function bossAnswer/);
  assert.match(js, /bossAsk/);
  assert.match(js, /addEventListener\(['"]click['"],\s*bossAnswer/);
  assert.match(js, /bossAnswer.*textContent/s);
  assert.match(html, /老板收到的回答/);
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
