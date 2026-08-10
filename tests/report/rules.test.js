import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectReportFacts } from '../../src/report/rules.js';

function fact(id, scope, metric, value, unit = '') {
  return { id, scope, metric, value, unit, sourceText:`${metric} ${value}${unit}`, confidence:0.99, source:'vision' };
}

test('recomputes gross margin and gives only the provable corrected value', () => {
  const issues = inspectReportFacts([
    fact('r','华南大区','营收',9800,'万元'),
    fact('c','华南大区','营业成本',6100,'万元'),
    fact('m','华南大区','毛利率',85,'%')
  ]);
  const issue = issues.find((x) => x.title === '毛利率计算错误');
  assert.equal(issue.kind, 'calculation_error');
  assert.equal(issue.correctedValue, 37.76);
  assert.match(issue.explanation, /9800.*6100.*37\.76/);
});

test('normalizes different currency units before recomputing gross margin', () => {
  const issues = inspectReportFacts([
    fact('r','华南大区','营收',1,'亿元'),
    fact('c','华南大区','营业成本',5000,'万元'),
    fact('m','华南大区','毛利率',85,'%')
  ]);
  const issue = issues.find((x) => x.title === '毛利率计算错误');
  assert.equal(issue.kind, 'calculation_error');
  assert.equal(issue.correctedValue, 50);
});

test('does not falsely flag a correct gross profit when amount units differ', () => {
  const issues = inspectReportFacts([
    fact('r','华南大区','营收',1,'亿元'),
    fact('c','华南大区','营业成本',5000,'万元'),
    fact('g','华南大区','毛利',5000,'万元')
  ]);
  assert.equal(issues.some((x) => x.title === '毛利计算错误'), false);
});

test('does not compare financial amounts when one unit is ambiguous', () => {
  const issues = inspectReportFacts([
    fact('r','跨境电商部','营收',1,'亿元'),
    fact('p','跨境电商部','净利润',9000,'')
  ]);
  assert.equal(issues.some((x) => x.title.includes('净利润')), false);
});

test('negative operating cost is an anomaly to verify, not an invented correction', () => {
  const [issue] = inspectReportFacts([fact('c','华北大区','营业成本',-1200,'万元')]);
  assert.equal(issue.kind, 'anomaly');
  assert.equal('correctedValue' in issue, false);
  assert.match(issue.explanation, /冲销|退回|核对/);
});

test('net profit above revenue is flagged as anomaly without inventing a correct profit', () => {
  const issues = inspectReportFacts([
    fact('r','跨境电商部','营收',8900,'万元'),
    fact('p','跨境电商部','净利润',12000,'万元')
  ]);
  const issue = issues.find((x) => x.title.includes('净利润'));
  assert.equal(issue.kind, 'anomaly');
  assert.equal('correctedValue' in issue, false);
});

test('does not falsely flag net profit above revenue when currency units differ', () => {
  const issues = inspectReportFacts([
    fact('r','跨境电商部','营收',1,'亿元'),
    fact('p','跨境电商部','净利润',9000,'万元')
  ]);
  assert.equal(issues.some((x) => x.title.includes('净利润')), false);
});

test('attendance rate above 100 percent is a logic error', () => {
  const [issue] = inspectReportFacts([fact('a','市场营销部','出勤率',105,'%')]);
  assert.equal(issue.kind, 'logic_error');
  assert.match(issue.title, /出勤率/);
});

test('negative headcount is a logic error', () => {
  const [issue] = inspectReportFacts([fact('h','客户服务部','期末人数',-15,'人')]);
  assert.equal(issue.kind, 'logic_error');
  assert.equal(issue.originalValue, -15);
});

test('negative turnover rate is a logic error', () => {
  const [issue] = inspectReportFacts([fact('t','供应链管理部','离职率',-5,'%')]);
  assert.equal(issue.kind, 'logic_error');
});

test('expiry date earlier than production date is a logic error with no fabricated corrected date', () => {
  const issues = inspectReportFacts([
    fact('p','SKU-8803','生产日期','2025-10-10',''),
    fact('e','SKU-8803','失效日期','2024-10-10','')
  ], { now:new Date('2026-08-10T00:00:00Z') });
  const issue = issues.find((x) => x.title.includes('失效日期'));
  assert.equal(issue.kind, 'logic_error');
  assert.equal('correctedValue' in issue, false);
});

test('future production date is an anomaly, because report context may be forecast data', () => {
  const issues = inspectReportFacts([
    fact('p','SKU-8802','生产日期','2027-05-20',''),
    fact('e','SKU-8802','失效日期','2028-05-19','')
  ], { now:new Date('2026-08-10T00:00:00Z') });
  const issue = issues.find((x) => x.title.includes('未来'));
  assert.equal(issue.kind, 'anomaly');
});

test('does not invent an exact summary gross margin from partial detail rows', () => {
  const issues = inspectReportFacts([
    fact('r1','华南大区','营收',9800,'万元'), fact('c1','华南大区','营业成本',6100,'万元'),
    fact('r2','华北大区','营收',8000,'万元'), fact('c2','华北大区','营业成本',5000,'万元'),
    fact('sum','财务汇总行','总毛利率',182.5,'%')
  ]);
  const issue = issues.find((x) => x.title === '总毛利率异常');
  assert.equal(issue.kind, 'logic_error');
  assert.equal('correctedValue' in issue, false);
  assert.match(issue.explanation, /不能.*直接相加|完整.*汇总/);
});

test('corrects summary gross margin only when explicit summary revenue and cost prove it', () => {
  const issues = inspectReportFacts([
    fact('r','财务汇总行','总营收',1.8,'亿元'),
    fact('c','财务汇总行','总营业成本',9000,'万元'),
    fact('sum','财务汇总行','总毛利率',182.5,'%')
  ]);
  const issue = issues.find((x) => x.title === '总毛利率计算错误');
  assert.equal(issue.kind, 'calculation_error');
  assert.equal(issue.correctedValue, 50);
});
