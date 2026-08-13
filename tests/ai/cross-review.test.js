import test from 'node:test';
import assert from 'node:assert/strict';
import { crossReviewDiagnosis } from '../../src/ai/cross-review.js';

test('keeps a finding when reviewer agrees with its evidence and priority', async () => {
  const primary = { findings: [{ title:'毛利下降', status:'confirmed', priority:'P1', evidence:['报表毛利率连续下降'], confidence:0.9, impact:'利润承压', action:'检查成本结构', metric:'毛利率' }] };
  const reviewer = async ({ findings }) => ({ reviews:[{ id:findings[0].id, title:'毛利下降', verdict:'agree', reason:'证据支持', missingEvidence:[] }] });
  const result = await crossReviewDiagnosis(primary, { reviewer });
  assert.equal(result.findings[0].review.verdict, 'agree');
  assert.equal(result.findings[0].crossModelStatus, 'consistent');
});

test('downgrades certainty when reviewer says causal evidence is missing', async () => {
  const primary = { findings: [{ title:'原材料成本导致利润下降', status:'confirmed', priority:'P0', evidence:['毛利下降'], confidence:0.9, impact:'利润下降', action:'压供应商价格', metric:'原材料成本率' }] };
  const reviewer = async ({ findings }) => ({ reviews:[{ id:findings[0].id, title:'原材料成本导致利润下降', verdict:'disagree', reason:'只有毛利下降，不能证明原因是原材料', missingEvidence:['原材料成本','人工成本','平台佣金'] }] });
  const result = await crossReviewDiagnosis(primary, { reviewer });
  assert.equal(result.findings[0].status, 'hypothesis');
  assert.notEqual(result.findings[0].priority, 'P0');
  assert.equal(result.findings[0].crossModelStatus, 'disputed');
  assert.deepEqual(result.findings[0].missingEvidence, ['原材料成本','人工成本','平台佣金']);
});

test('never lets model review override deterministic program facts', async () => {
  const primary = { findings: [{ title:'汇总金额与明细不一致', status:'confirmed', priority:'P0', evidence:['program:audit:cross_sheet_total_mismatch'], confidence:1, impact:'报表口径错误', action:'核对汇总公式', metric:'营业额', deterministic:true }] };
  const reviewer = async () => ({ reviews:[{ title:'汇总金额与明细不一致', verdict:'disagree', reason:'模型认为可能没问题', missingEvidence:[] }] });
  const result = await crossReviewDiagnosis(primary, { reviewer });
  assert.equal(result.findings[0].status, 'confirmed');
  assert.equal(result.findings[0].priority, 'P0');
  assert.equal(result.findings[0].crossModelStatus, 'program_fact');
});

test('can skip reviewer for ordinary low-risk findings', async () => {
  let called = false;
  const primary = { findings: [{ title:'优化菜单图片', status:'hypothesis', priority:'P2', evidence:['老板主观反馈'], confidence:0.4, impact:'可能影响转化', action:'A/B测试', metric:'点击率' }] };
  const result = await crossReviewDiagnosis(primary, { reviewer: async () => { called = true; return {reviews:[]}; }, shouldReview: () => false });
  assert.equal(called, false);
  assert.equal(result.findings[0].crossModelStatus, 'single_model');
});

test('missing or malformed reviewer entries are review_unavailable', async () => {
  const primary = { findings:[
    { title:'A', status:'confirmed', priority:'P1', evidence:['e'], confidence:0.9 },
    { title:'B', status:'confirmed', priority:'P1', evidence:['e'], confidence:0.9 }
  ] };
  const result = await crossReviewDiagnosis(primary, {
    reviewer:async ({ findings }) => ({ reviews:[{ id:findings[0].id, title:'A', verdict:'agree' }, { id:findings[1].id, title:'B', verdict:'invalid' }] }),
    shouldReview:() => true
  });
  assert.equal(result.findings[0].crossModelStatus, 'consistent');
  assert.equal(result.findings[1].crossModelStatus, 'review_unavailable');
});

test('title-only reviews cannot approve findings without stable ids', async () => {
  const primary = { findings:[
    { title:'重复标题', status:'confirmed', priority:'P1', evidence:['e1'], confidence:0.9 },
    { title:'重复标题', status:'confirmed', priority:'P1', evidence:['e2'], confidence:0.9 }
  ] };
  const result = await crossReviewDiagnosis(primary, {
    reviewer:async () => ({ reviews:[{ title:'重复标题', verdict:'agree' }] }),
    shouldReview:() => true
  });
  assert.deepEqual(result.findings.map((item) => item.crossModelStatus), ['review_unavailable','review_unavailable']);
});
