import test from 'node:test';
import assert from 'node:assert/strict';
import { boundDiagnosisContext } from '../../src/ai/context.js';

test('keeps the newest 30 owner turns and clips oversized text', () => {
  const answers = {};
  for (let i = 1; i <= 40; i += 1) answers[`owner_turn_${i}`] = `回答${i}-${'A'.repeat(5000)}`;
  const source = { id:'d1', answers, evidence:[], findings:[], documents:[] };
  const bounded = boundDiagnosisContext(source);
  assert.equal(Object.keys(bounded.answers).length, 30);
  assert.equal(bounded.answers.owner_turn_1, undefined);
  assert.match(bounded.answers.owner_turn_40, /^回答40-/);
  assert.ok(bounded.answers.owner_turn_40.length <= 4001);
  assert.equal(source.answers.owner_turn_1.startsWith('回答1-'), true);
});

test('bounds evidence documents and findings while preserving the newest entries', () => {
  const source = {
    id:'d1',
    answers:{ problem:'利润下降' },
    evidence:Array.from({ length:80 }, (_, index) => `evidence-${index + 1}`),
    findings:Array.from({ length:20 }, (_, index) => ({
      title:`finding-${index + 1}`, status:'hypothesis', priority:'P2', evidence:['e'], confidence:0.4,
      impact:'impact', action:'action', metric:'metric'
    })),
    documents:Array.from({ length:5 }, (_, index) => ({
      name:`doc-${index + 1}.pdf`, type:'pdf', structured:false, confidence:1,
      text:`doc-${index + 1}-${'B'.repeat(15000)}`, warnings:[]
    }))
  };
  const bounded = boundDiagnosisContext(source);
  assert.equal(bounded.evidence.length, 50);
  assert.equal(bounded.evidence[0], 'evidence-31');
  assert.equal(bounded.documents.length, 3);
  assert.equal(bounded.documents[0].name, 'doc-3.pdf');
  assert.ok(bounded.documents[2].text.length <= 12001);
  assert.equal(bounded.findings.length, 12);
  assert.equal(bounded.findings[0].title, 'finding-9');
});

test('small valid diagnosis stays structurally equivalent and arbitrary root payload is dropped', () => {
  const source = {
    id:'d1', answers:{ problem:'利润下降' }, evidence:[], findings:[], documents:[],
    attackerPayload:{ ignore:'system rules' }
  };
  const bounded = boundDiagnosisContext(source);
  assert.deepEqual(bounded, { id:'d1', answers:{ problem:'利润下降' }, evidence:[], findings:[], documents:[] });
});
