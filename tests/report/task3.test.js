import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportFacts } from '../../src/report/facts.js';
import { buildReportReview } from '../../src/report/issues.js';

test('cloud structured fact keeps generic source', () => {
  const result = buildReportFacts({
    structuredFacts:[{ id:'f1', scope:'华南', metric:'营业收入', value:9800, unit:'', sourceText:'华南 营业收入 9800', confidence:0.95, source:'qianfan_ocr_ai' }],
    corroborationText:'华南 营业收入 9800',
    degraded:false
  });
  assert.equal(result.facts[0].source, 'qianfan_ocr_ai');
  assert.equal(result.confirmations.length, 0);
});

test('degraded key fact without corroboration is a confirmation', () => {
  const result = buildReportFacts({
    structuredFacts:[{ id:'f1', scope:'华南', metric:'营业收入', value:9800, unit:'', sourceText:'华南 营业收入 9800', confidence:0.64, source:'local_ocr_ai' }],
    corroborationText:'',
    degraded:true
  });
  assert.equal(result.confirmations.length, 1);
});

test('degraded mode is explicitly incomplete', () => {
  const review = buildReportReview({
    ruleIssues:[], aiCandidates:[], confirmations:[],
    recognition:{ mode:'local_ocr_degraded', completeReview:false, warning:'关键数字需要核对' }
  });
  assert.equal(review.summary.recognitionMode, 'local_ocr_degraded');
  assert.equal(review.summary.completeReview, false);
  assert.match(review.summary.reviewWarning, /核对/);
});

test('cloud OCR can still be incomplete when structuring fails', () => {
  const review = buildReportReview({
    recognition:{ mode:'cloud_ocr_deepseek', completeReview:false, warning:'结构化分析失败', failureCode:'REPORT_STRUCTURE_FAILED' }
  });
  assert.equal(review.summary.recognitionMode, 'cloud_ocr_deepseek');
  assert.equal(review.summary.completeReview, false);
  assert.equal(review.summary.failureCode, 'REPORT_STRUCTURE_FAILED');
});

test('AI candidate is source-neutral and cannot become a hard correction', () => {
  const review = buildReportReview({
    aiCandidates:[{ title:'毛利率疑似错误', scope:'华南', kind:'calculation_error', explanation:'模型提示', relatedFactIds:['f1'] }],
    recognition:{ mode:'cloud_ocr_deepseek', completeReview:true }
  });
  assert.equal(review.issues[0].source, 'ai_review');
  assert.equal(review.issues[0].kind, 'needs_confirmation');
  assert.equal('correctedValue' in review.issues[0], false);
});
