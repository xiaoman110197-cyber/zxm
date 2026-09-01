import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFieldMappingInput, sanitizeMappingSuggestions } from '../../src/experience/field-mapper.js';

test('field mapping profile includes headers and type stats but not raw customer values', () => {
  const workbook = { sheets:[{ name:'门店流水', headers:['到账口径','客户称呼','手机'], rows:[{ 到账口径:'688元', 客户称呼:'张三', 手机:'13800000000' }] }] };
  const profile = buildFieldMappingInput(workbook);
  const text = JSON.stringify(profile);
  assert.match(text, /到账口径/);
  assert.match(text, /number/);
  assert.equal(text.includes('688元'), false);
  assert.equal(text.includes('张三'), false);
  assert.equal(text.includes('13800000000'), false);
});

test('mapping suggestions must reference real headers and remain one-to-one', () => {
  const workbook = { sheets:[{ name:'门店流水', headers:['到账口径','发生日'], rows:[] }] };
  const result = sanitizeMappingSuggestions({ mappings:[
    { sheet:'门店流水', header:'到账口径', field:'amount', confidence:.9, reason:'表示到账金额' },
    { sheet:'门店流水', header:'发生日', field:'amount', confidence:.8, reason:'冲突字段' },
    { sheet:'门店流水', header:'不存在', field:'date', confidence:.99, reason:'非法字段' },
    { sheet:'门店流水', header:'发生日', field:'date', confidence:.7, reason:'表示日期' }
  ] }, workbook);
  assert.deepEqual(result.map((item) => item.field), ['amount','date']);
  assert.equal(result[0].header, '到账口径');
});
