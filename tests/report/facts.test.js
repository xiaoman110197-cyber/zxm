import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportFacts } from '../../src/report/facts.js';

test('keeps reliable vision facts without exposing unrelated OCR garbage', () => {
  const result = buildReportFacts({
    visionFacts:[{ id:'f1', scope:'华南大区', metric:'营收', value:9800, unit:'万元', sourceText:'营收 9,800', confidence:0.98, source:'vision' }],
    ocrDocument:{ text:'9:21 al 全 可) [—', uncertainSegments:[{ text:'al', confidence:0.29, context:'9:21 al 全 可)' }] }
  });
  assert.equal(result.facts.length, 1);
  assert.equal(result.confirmations.length, 0);
});

test('flags only a conflicting key value in the same scope and metric neighborhood', () => {
  const result = buildReportFacts({
    visionFacts:[{ id:'f1', scope:'华南大区', metric:'营业成本', value:6100, unit:'万元', sourceText:'营业成本 6,100', confidence:0.91, source:'vision' }],
    ocrDocument:{ text:'华南大区 营业成本 8100 万元\n华北大区 营业成本 6100 万元', uncertainSegments:[] }
  });
  assert.equal(result.confirmations.length, 1);
  assert.equal(result.confirmations[0].metric, '营业成本');
  assert.equal(result.confirmations[0].currentValue, 6100);
});

test('does not create OCR conflict when the same value differs only by commas or percent formatting', () => {
  const result = buildReportFacts({
    visionFacts:[
      { id:'f1', scope:'华南大区', metric:'营收', value:9800, unit:'万元', sourceText:'营收 9,800', confidence:0.98, source:'vision' },
      { id:'f2', scope:'华南大区', metric:'毛利率', value:37.76, unit:'%', sourceText:'毛利率 37.76%', confidence:0.98, source:'vision' }
    ],
    ocrDocument:{ text:'华南大区 营收 9,800 万元 毛利率 37.76%', uncertainSegments:[] }
  });
  assert.equal(result.confirmations.length, 0);
});

test('deduplicates repeated vision facts without inventing values', () => {
  const fact = { id:'f1', scope:'华南大区', metric:'营收', value:9800, unit:'万元', sourceText:'营收 9800', confidence:0.98, source:'vision' };
  const result = buildReportFacts({ visionFacts:[fact, { ...fact, id:'f2', confidence:0.91 }], ocrDocument:{} });
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].value, 9800);
});
