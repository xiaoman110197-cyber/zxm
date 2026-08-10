import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBusinessDocument } from '../../src/documents/parse.js';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAALQAAABQAQAAAACYY2ILAAAA60lEQVR42u2UQUoEMRBFX3oEs+tautIcYW5gjuJNJt7Eo8QbzBGydBnBRZCelIuBoU2moREUF/2Xj0pR/F8Vo1zT+8B1bfw/82eBVzvnRoHTjak6oG2+E0qF0PYpECaILc8QC6S186QxpHwbc1cvHqzr53cORH7NH5eSk5ylq88RSvr2QFU1w6HAo16UUVUtoBMcZtwooMNuwpja+lypKNrN84GGT/BrfV70c/8Ed/vVPkQvOTlb/nw/Y4ZUVtf744u4t6Ntc4nwkGCc+X/OF5xAl6+At+DaPks5Lt3LLtxj4tjd1/Z/bvyH/AteJZN3Cv1sJwAAAABJRU5ErkJggg==';

test('default image OCR reads a real PNG through Tesseract', async () => {
  const result = await parseBusinessDocument({ name:'real.png', buffer:Buffer.from(PNG_BASE64, 'base64') });
  assert.equal(result.document.type, 'image');
  assert.match(result.document.text, /88/);
  assert.ok(result.document.confidence > 0.4);
});
