import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosis, addEvidence, addFinding } from '../../src/domain/diagnosis.js';

test('creates unique diagnosis ids and documents arrays', () => {
  const a = createDiagnosis();
  const b = createDiagnosis();
  assert.notEqual(a.id, b.id);
  assert.deepEqual(a.documents, []);
  assert.deepEqual(a.evidence, []);
  assert.deepEqual(a.findings, []);
});

test('adds traceable evidence', () => {
  const d = createDiagnosis();
  addEvidence(d, { source: 'owner_answer', value: '客流下降' });
  assert.equal(d.evidence.length, 1);
  assert.equal(d.evidence[0].source, 'owner_answer');
});

test('rejects findings without required evidence-based fields', () => {
  const d = createDiagnosis();
  assert.throws(() => addFinding(d, { status: 'confirmed', priority: 'P0' }), /finding requires/);
});

test('accepts a complete evidence-based finding', () => {
  const d = createDiagnosis();
  addFinding(d, {
    status: 'probable',
    priority: 'P1',
    evidence: ['ev-1'],
    confidence: 0.78,
    action: '核对近30天渠道到店数据',
    metric: '渠道到店人数'
  });
  assert.equal(d.findings.length, 1);
});

test('rejects invalid confidence', () => {
  const d = createDiagnosis();
  assert.throws(() => addFinding(d, {
    status: 'confirmed', priority: 'P1', evidence: ['ev-1'], confidence: 1.2,
    action: '检查', metric: '营业额'
  }), /confidence/);
});
