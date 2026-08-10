import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBusinessDocument } from '../../src/documents/parse.js';

const deps = {
  pdfTextExtractor: async () => ({ text: '营业额 100 元', pageCount: 1 }),
  docxTextExtractor: async () => ({ text: '门店经营方案', warnings: [] }),
  imageOcr: async () => ({ text: '今日营业额 88 元', confidence: 0.82 })
};

test('parses CSV as structured tabular data', async () => {
  const buffer = Buffer.from('订单号,营业额\nA001,100\nA002,200', 'utf8');
  const result = await parseBusinessDocument({ name:'订单.csv', buffer }, deps);
  assert.equal(result.document.type, 'csv');
  assert.equal(result.document.structured, true);
  assert.equal(result.workbook.sheets[0].rows.length, 2);
});

test('parses PDF text without inventing structured metrics', async () => {
  const buffer = Buffer.from('%PDF-1.4\nmock', 'utf8');
  const result = await parseBusinessDocument({ name:'报告.pdf', buffer }, deps);
  assert.equal(result.document.type, 'pdf');
  assert.equal(result.document.text, '营业额 100 元');
  assert.equal(result.document.structured, false);
  assert.equal(result.workbook, null);
});

test('bounds very long unstructured text and marks the document as truncated', async () => {
  const buffer = Buffer.from('%PDF-1.4\nmock', 'utf8');
  const longText = `开头-${'A'.repeat(15000)}-结尾`;
  const result = await parseBusinessDocument({ name:'长报告.pdf', buffer }, { ...deps, pdfTextExtractor: async () => ({ text:longText, pageCount:40 }) });
  assert.equal(result.document.truncated, true);
  assert.ok(result.document.text.length <= 12100);
  assert.match(result.document.text, /开头/);
  assert.match(result.document.text, /结尾/);
  assert.ok(result.document.warnings.some((warning) => /截断|过长/.test(warning)));
});

test('parses DOCX text through the document extractor', async () => {
  const buffer = Buffer.from([0x50,0x4b,0x03,0x04,1,2,3,4]);
  const result = await parseBusinessDocument({ name:'方案.docx', buffer }, deps);
  assert.equal(result.document.type, 'docx');
  assert.match(result.document.text, /经营方案/);
});

test('parses image OCR with explicit confidence', async () => {
  const buffer = Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3,4]);
  const result = await parseBusinessDocument({ name:'后台.jpg', buffer }, deps);
  assert.equal(result.document.type, 'image');
  assert.equal(result.document.confidence, 0.82);
  assert.match(result.document.text, /营业额/);
});

test('accepts JPG/PNG filename mismatch when the bytes are still a supported image', async () => {
  const pngBytes = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]);
  const result = await parseBusinessDocument({ name:'手机重编码.jpg', buffer:pngBytes }, deps);
  assert.equal(result.document.type, 'image');
  assert.match(result.document.text, /营业额/);
});

test('image parser forwards OCR progress into the shared progress callback', async () => {
  const buffer = Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3,4]);
  const events = [];
  const result = await parseBusinessDocument({ name:'后台.jpg', buffer }, {
    ...deps,
    onProgress: (event) => events.push(event),
    imageOcr: async (_buffer, reportOcrProgress) => {
      assert.equal(typeof reportOcrProgress, 'function');
      reportOcrProgress({ status:'loading language traineddata', progress:0.5 });
      reportOcrProgress({ status:'recognizing text', progress:0.6 });
      return { text:'今日营业额 88 元', confidence:0.82 };
    }
  });
  assert.equal(result.document.type, 'image');
  assert.ok(events.length >= 2);
  assert.ok(events.every((event) => typeof event.percent === 'number' && event.percent >= 0 && event.percent <= 100));
  assert.ok(events.some((event) => event.phase === 'ocr' && event.percent > 30 && event.percent < 90));
});

test('marks low-confidence image OCR as uncertain instead of reliable fact', async () => {
  const buffer = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1]);
  const result = await parseBusinessDocument({ name:'模糊截图.png', buffer }, { ...deps, imageOcr: async () => ({ text:'营业额 800?', confidence:0.41 }) });
  assert.equal(result.document.confidence, 0.41);
  assert.ok(result.document.warnings.some((warning) => /置信度|确认/.test(warning)));
});

test('rejects an extension whose file signature does not match', async () => {
  await assert.rejects(
    () => parseBusinessDocument({ name:'伪造.pdf', buffer:Buffer.from('not a pdf') }, deps),
    /格式|签名|损坏/
  );
});
