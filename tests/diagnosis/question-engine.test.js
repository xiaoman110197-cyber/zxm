import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosis } from '../../src/domain/diagnosis.js';
import { nextQuestion } from '../../src/diagnosis/question-engine.js';

test('traffic problem asks for acquisition evidence before unrelated finance questions', () => {
  const diagnosis = createDiagnosis({ answers: { problem: '最近客流明显下降' } });
  const q = nextQuestion(diagnosis);
  assert.equal(q.key, 'customer_source');
  assert.match(q.reason, /客流|获客|到店/);
});

test('profit problem asks for revenue or cost evidence first', () => {
  const diagnosis = createDiagnosis({ answers: { problem: '营业额有但利润越来越低' } });
  const q = nextQuestion(diagnosis);
  assert.ok(['revenue','cost','gross_margin'].includes(q.key));
  assert.match(q.reason, /利润|成本|毛利|收入/);
});

test('does not repeat a question already answered', () => {
  const diagnosis = createDiagnosis({
    answers: { problem: '客流少', customer_source: '小红书和路过客' }
  });
  const q = nextQuestion(diagnosis);
  assert.notEqual(q.key, 'customer_source');
});

test('returns null when required evidence set for known problem is complete', () => {
  const diagnosis = createDiagnosis({
    answers: {
      problem: '客流少',
      customer_source: '小红书',
      weekly_visitors: 120,
      exposure: 15000,
      location: '商场二楼'
    }
  });
  assert.equal(nextQuestion(diagnosis), null);
});
