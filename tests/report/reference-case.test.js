import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectReportFacts } from '../../src/report/rules.js';
import { buildReportReview } from '../../src/report/issues.js';

function fact(id, scope, metric, value, unit = '') {
  return { id, scope, metric, value, unit, sourceText:`${metric} ${value}${unit}`, confidence:0.99, source:'vision' };
}

test('screenshot-style report returns concrete issues without fabricated corrections', () => {
  const facts = [
    fact('hn-r','华南大区','营收',9800,'万元'),
    fact('hn-c','华南大区','营业成本',6100,'万元'),
    fact('hn-m','华南大区','毛利率',85,'%'),

    fact('hb-c','华北大区','营业成本',-1200,'万元'),

    fact('ec-r','跨境电商部','营收',8900,'万元'),
    fact('ec-p','跨境电商部','净利润',12000,'万元'),

    fact('mk-a','市场营销部','出勤率',105,'%'),
    fact('cs-h','客户服务部','期末人数',-15,'人'),
    fact('sc-t','供应链管理部','离职率',-5,'%'),

    fact('sku2-p','SKU-8802','生产日期','2027-05-20'),
    fact('sku2-e','SKU-8802','失效日期','2028-05-19'),
    fact('sku3-p','SKU-8803','生产日期','2025-10-10'),
    fact('sku3-e','SKU-8803','失效日期','2024-10-10'),

    fact('m1','华南分部','毛利率',85,'%'),
    fact('m2','华北分部','毛利率',97.5,'%'),
    fact('sum-m','财务汇总行','总毛利率',182.5,'%')
  ];

  const review = buildReportReview({
    ruleIssues:inspectReportFacts(facts, { now:new Date('2026-08-10T00:00:00Z') }),
    visionCandidates:[],
    confirmations:[],
    vision:{ available:true }
  });

  const byTitle = new Map(review.issues.map((item) => [item.title, item]));

  assert.equal(byTitle.get('毛利率计算错误')?.correctedValue, 37.76);
  assert.equal(byTitle.get('毛利率计算错误')?.kind, 'calculation_error');

  assert.equal(byTitle.get('营业成本出现负数')?.kind, 'anomaly');
  assert.equal('correctedValue' in byTitle.get('营业成本出现负数'), false);

  assert.equal(byTitle.get('净利润高于营业收入')?.kind, 'anomaly');
  assert.equal('correctedValue' in byTitle.get('净利润高于营业收入'), false);

  assert.equal(byTitle.get('出勤率超出 0%–100% 范围')?.kind, 'logic_error');
  assert.equal(byTitle.get('期末人数不能为负数')?.kind, 'logic_error');
  assert.equal(byTitle.get('离职率不能为负数')?.kind, 'logic_error');

  assert.equal(byTitle.get('生产日期在未来')?.kind, 'anomaly');
  assert.equal('correctedValue' in byTitle.get('生产日期在未来'), false);

  assert.equal(byTitle.get('失效日期早于生产日期')?.kind, 'logic_error');
  assert.equal('correctedValue' in byTitle.get('失效日期早于生产日期'), false);

  assert.equal(byTitle.get('总毛利率计算方式错误')?.kind, 'logic_error');
  assert.equal('correctedValue' in byTitle.get('总毛利率计算方式错误'), false);

  for (const issue of review.issues) {
    if (Object.prototype.hasOwnProperty.call(issue, 'correctedValue')) {
      assert.equal(issue.kind, 'calculation_error');
      assert.equal(issue.source, 'program');
    }
  }
});

test('invalid calendar dates are not silently normalized into report logic', () => {
  const issues = inspectReportFacts([
    fact('p','SKU-X','生产日期','2026-02-31'),
    fact('e','SKU-X','失效日期','2026-03-01')
  ], { now:new Date('2026-08-10T00:00:00Z') });

  assert.equal(issues.some((item) => item.title === '失效日期早于生产日期'), false);
});
