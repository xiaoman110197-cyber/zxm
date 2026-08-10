import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFileReviewModel } from '../../public/file-review.js';

function resultWithSegments(segments, confidence = 0.77) {
  return {
    summary:{ confidence },
    document:{
      type:'image',
      text:'营业额 100000 元\n成本 40000 元\n毛利率 68%\n其他说明',
      uncertainSegments:segments
    }
  };
}

test('keeps OCR punctuation and isolated one-character noise out of the important list', () => {
  const model = buildFileReviewModel(resultWithSegments([
    { text:'。', confidence:0.1, context:'。' },
    { text:'_', confidence:0.2, context:'____' },
    { text:'可', confidence:0.3, context:'可' },
    { text:'68%', confidence:0.42, context:'毛利率 68%' }
  ]));

  assert.deepEqual(model.importantIssues.map((item) => item.text), ['68%']);
  assert.equal(model.otherIssues.length, 3);
});

test('ranks numeric and business-context uncertainty before generic text and caps main list at five', () => {
  const model = buildFileReviewModel(resultWithSegments([
    { text:'abc', confidence:0.2, context:'备注 abc' },
    { text:'98.5', confidence:0.45, context:'转化率 98.5%' },
    { text:'5000', confidence:0.5, context:'人工 5000 元' },
    { text:'2026-08-10', confidence:0.55, context:'日期 2026-08-10' },
    { text:'120', confidence:0.4, context:'订单 120 单' },
    { text:'88', confidence:0.6, context:'库存 88' },
    { text:'note', confidence:0.1, context:'普通说明 note' }
  ]));

  assert.equal(model.importantIssues.length, 5);
  assert.ok(model.importantIssues.every((item) => /\d/.test(item.text)));
  assert.equal(model.otherIssues.length, 2);
  assert.equal(model.confidence, 0.77);
  assert.equal(model.hasText, true);
});

test('returns full OCR text and no important issues when no uncertain segment matters', () => {
  const model = buildFileReviewModel(resultWithSegments([]));
  assert.equal(model.fullText.includes('营业额'), true);
  assert.deepEqual(model.importantIssues, []);
  assert.deepEqual(model.otherIssues, []);
});
