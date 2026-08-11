import test from 'node:test';
import assert from 'node:assert/strict';
import { structureReportText } from '../../src/report/structure.js';

test('drops model facts whose sourceText is not present in OCR text', async () => {
  const provider = { async structureReport() { return { facts:[{
    id:'x', scope:'华南', metric:'收入', value:999999, unit:'元',
    sourceText:'华南 收入 999999', confidence:0.99, correctedValue:100
  }], candidates:[], confirmations:[] }; } };
  const result = await structureReportText({ text:'华南 收入 9800', source:'qianfan_ocr', degraded:false }, { provider });
  assert.equal(result.facts.length, 0);
});

test('drops a fact when its value is not anchored inside sourceText', async () => {
  const provider = { async structureReport() { return { facts:[{
    id:'x', scope:'华南', metric:'收入', value:999999, unit:'',
    sourceText:'华南 收入 9800', confidence:0.99
  }], candidates:[], confirmations:[] }; } };
  const result = await structureReportText({ text:'华南 收入 9800', source:'qianfan_ocr', degraded:false }, { provider });
  assert.equal(result.facts.length, 0);
});

test('strips correctedValue and downgrades local OCR facts', async () => {
  const provider = { async structureReport() { return {
    facts:[{ id:'f1', scope:'华南', metric:'收入', value:9800, unit:'', sourceText:'华南 收入 9800', confidence:0.98, correctedValue:123 }],
    candidates:[{ title:'疑似异常', scope:'华南', kind:'anomaly', explanation:'需核对', relatedFactIds:['f1'], correctedValue:1 }],
    confirmations:[]
  }; } };
  const result = await structureReportText({ text:'华南 收入 9800', source:'local_ocr', degraded:true }, { provider });
  assert.equal(result.facts[0].source, 'local_ocr_ai');
  assert.ok(result.facts[0].confidence <= 0.64);
  assert.equal('correctedValue' in result.facts[0], false);
  assert.equal('correctedValue' in result.candidates[0], false);
});

test('drops candidates that only reference discarded facts', async () => {
  const provider = { async structureReport() { return {
    facts:[{ id:'bad', scope:'华南', metric:'收入', value:999, unit:'', sourceText:'不存在 999', confidence:0.9 }],
    candidates:[{ title:'异常', scope:'华南', kind:'anomaly', explanation:'...', relatedFactIds:['bad'] }],
    confirmations:[]
  }; } };
  const result = await structureReportText({ text:'华南 收入 9800', source:'qianfan_ocr', degraded:false }, { provider });
  assert.equal(result.candidates.length, 0);
});

test('normalizes anchored cloud OCR facts without inventing trust', async () => {
  const provider = { async structureReport() { return {
    facts:[{ id:'f1', scope:'华南', metric:'毛利率', value:85, unit:'%', sourceText:'华南 毛利率 85%', confidence:0.93 }],
    candidates:[], confirmations:[]
  }; } };
  const result = await structureReportText({ text:'华南 毛利率 85%', source:'qianfan_ocr', degraded:false }, { provider });
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].source, 'qianfan_ocr_ai');
  assert.equal(result.facts[0].confidence, 0.93);
  assert.equal('trusted' in result.facts[0], false);
});
