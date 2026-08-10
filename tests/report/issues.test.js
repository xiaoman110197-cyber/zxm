import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportReview } from '../../src/report/issues.js';

const proven = {
  id:'p1', kind:'calculation_error', title:'毛利率计算错误', scope:'华南大区',
  originalValue:85, correctedValue:37.76, unit:'%', explanation:'程序复算',
  evidence:['营收 9800','成本 6100'], relatedFactIds:['r','c','m'], severity:'high'
};

test('keeps program-proven correction with corrected value', () => {
  const review = buildReportReview({ ruleIssues:[proven], visionCandidates:[], confirmations:[] });
  assert.equal(review.issues[0].kind, 'calculation_error');
  assert.equal(review.issues[0].correctedValue, 37.76);
  assert.equal(review.issues[0].source, 'program');
  assert.equal(review.summary.provableCorrectionCount, 1);
});

test('downgrades an AI claimed calculation error when the program cannot prove it', () => {
  const review = buildReportReview({
    ruleIssues:[],
    visionCandidates:[{ title:'库存周转率计算错误', scope:'仓储部', kind:'calculation_error', explanation:'模型认为公式不对', relatedFactIds:['x'] }],
    confirmations:[]
  });
  assert.equal(review.issues[0].kind, 'needs_confirmation');
  assert.equal('correctedValue' in review.issues[0], false);
  assert.match(review.issues[0].explanation, /不能证明|核对/);
});

test('downgrades a proven-looking calculation when one of its inputs has a vision OCR conflict', () => {
  const review = buildReportReview({
    ruleIssues:[proven],
    visionCandidates:[],
    confirmations:[{ id:'confirm:c', scope:'华南大区', metric:'营业成本', currentValue:6100, reason:'视觉与 OCR 不一致', sourceText:'成本 6100', factId:'c' }]
  });
  const issue = review.issues.find((item) => item.title === '毛利率计算错误');
  assert.equal(issue.kind, 'needs_confirmation');
  assert.equal('correctedValue' in issue, false);
});

test('program issue wins over a duplicate vision candidate', () => {
  const review = buildReportReview({
    ruleIssues:[proven],
    visionCandidates:[{ title:'毛利率计算错误', scope:'华南大区', kind:'calculation_error', explanation:'AI候选', relatedFactIds:['r','c','m'] }],
    confirmations:[]
  });
  assert.equal(review.issues.filter((item) => item.title === '毛利率计算错误').length, 1);
  assert.equal(review.issues[0].source, 'program');
});

test('does not turn visual logic candidates into fabricated hard facts', () => {
  const review = buildReportReview({
    ruleIssues:[],
    visionCandidates:[{ title:'某字段逻辑错误', scope:'部门A', kind:'logic_error', explanation:'模型观察到异常', relatedFactIds:['x'] }],
    confirmations:[]
  });
  assert.equal(review.issues[0].kind, 'anomaly');
  assert.equal(review.issues[0].source, 'vision');
});
