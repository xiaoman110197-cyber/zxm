import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCalculationCorrections } from '../../src/audit/corrections.js';

test('turns a proven cross-sheet total mismatch into a calculation error with the recomputed value', () => {
  const audit = {
    errors:[{
      type:'cross_sheet_mismatch',
      metric:'营业额',
      sourceSheet:'订单明细',
      summarySheet:'汇总',
      originalValue:250,
      expected:200,
      actual:250,
      confidence:1
    }],
    anomalies:[],
    metrics:{ revenue:200 }
  };

  const corrections = detectCalculationCorrections({ audit, workbook:{ sheets:[] }, document:{ type:'excel', structured:true } });
  assert.deepEqual(corrections[0], {
    kind:'calculation_error',
    label:'营业额合计',
    originalValue:250,
    correctedValue:200,
    explanation:'汇总中的营业额与订单明细逐行合计不一致，重新合计应为 200。',
    evidence:['订单明细逐行合计：200','汇总原值：250']
  });
});

test('corrects gross margin only when explicit reliable source values prove the answer', () => {
  const corrections = detectCalculationCorrections({
    audit:{ errors:[], anomalies:[], metrics:{} },
    workbook:null,
    document:{
      type:'image',
      confidence:0.91,
      text:'营业额：100000 元\n成本：40000 元\n毛利：60000 元\n毛利率：68%',
      uncertainSegments:[]
    }
  });

  const margin = corrections.find((item) => item.label === '毛利率');
  assert.equal(margin.kind, 'calculation_error');
  assert.equal(margin.originalValue, 68);
  assert.equal(margin.correctedValue, 60);
  assert.match(margin.explanation, /100000|40000|60%/);
});

test('does not auto-correct when a required OCR input is uncertain', () => {
  const corrections = detectCalculationCorrections({
    audit:{ errors:[], anomalies:[], metrics:{} },
    workbook:null,
    document:{
      type:'image',
      confidence:0.84,
      text:'营业额：100000 元\n成本：40000 元\n毛利：60000 元\n毛利率：68%',
      uncertainSegments:[{ text:'40000', confidence:0.31, context:'成本：40000 元' }]
    }
  });

  const margin = corrections.find((item) => item.label === '毛利率');
  assert.equal(margin.kind, 'needs_confirmation');
  assert.equal(margin.correctedValue, undefined);
  assert.match(margin.explanation, /成本|确认/);
});

test('does not auto-correct from an image whose overall OCR confidence is low', () => {
  const corrections = detectCalculationCorrections({
    audit:{ errors:[], anomalies:[], metrics:{} },
    workbook:null,
    document:{
      type:'image',
      confidence:0.47,
      text:'营业额：100000 元\n成本：40000 元\n毛利：60000 元\n毛利率：68%',
      uncertainSegments:[]
    }
  });

  const margin = corrections.find((item) => item.label === '毛利率');
  assert.equal(margin.kind, 'needs_confirmation');
  assert.equal(margin.correctedValue, undefined);
  assert.match(margin.explanation, /整体|识别|确认/);
});

test('treats order-price-days versus monthly revenue as an inconsistency instead of a forced correction', () => {
  const corrections = detectCalculationCorrections({
    audit:{ errors:[], anomalies:[], metrics:{} },
    workbook:null,
    document:{
      type:'image',
      confidence:0.93,
      text:'月营业额：100000 元\n日均订单：70 单\n客单价：38 元\n营业天数：30 天',
      uncertainSegments:[]
    }
  });

  const item = corrections.find((entry) => entry.kind === 'inconsistency');
  assert.equal(item.label, '月营业额与订单估算');
  assert.equal(item.originalValue, 100000);
  assert.equal(item.correctedValue, undefined);
  assert.match(item.explanation, /79800|口径|确认/);
});
