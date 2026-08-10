import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionSnapshot, restoreSessionSnapshot, SESSION_TTL_MS } from '../../public/session.js';

test('session snapshot keeps text diagnosis state but never file content', () => {
  const snapshot = createSessionSnapshot({
    diagnosis:{
      id:'d1',
      answers:{ owner_turn_1:'利润下降' },
      evidence:['file_analysis:{"secret":true}'],
      findings:[{ title:'利润下降', status:'hypothesis', priority:'P2', evidence:['老板反馈'], confidence:0.4, impact:'利润承压', action:'核对成本', metric:'毛利率' }],
      documents:[{ name:'账单.png', type:'image', text:'营业额 123456' }],
      dialogue:[{ who:'owner', text:'利润下降' }, { who:'ai', text:'最近成本变化多少？', reason:'拆解利润问题' }]
    },
    turn:1,
    originalBase64:'TOP_SECRET_BASE64',
    audit:{ errors:[{ reason:'secret' }] }
  }, 1000);
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.diagnosis.id, 'd1');
  assert.equal(snapshot.diagnosis.answers.owner_turn_1, '利润下降');
  assert.equal(snapshot.diagnosis.dialogue.length, 2);
  assert.equal(snapshot.diagnosis.documents, undefined);
  assert.equal(snapshot.diagnosis.evidence, undefined);
  assert.equal(snapshot.originalBase64, undefined);
  assert.doesNotMatch(JSON.stringify(snapshot), /123456|TOP_SECRET_BASE64|file_analysis/);
});

test('restores a fresh snapshot and rejects an expired one', () => {
  const snapshot = createSessionSnapshot({ diagnosis:{ id:'d1', answers:{}, findings:[], dialogue:[] }, turn:3 }, 1000);
  const fresh = restoreSessionSnapshot(snapshot, 1000 + SESSION_TTL_MS - 1);
  assert.equal(fresh.turn, 3);
  assert.equal(fresh.diagnosis.id, 'd1');
  assert.equal(restoreSessionSnapshot(snapshot, 1000 + SESSION_TTL_MS + 1), null);
});

test('restore sanitizes malformed or unsupported snapshots', () => {
  assert.equal(restoreSessionSnapshot(null, 1000), null);
  assert.equal(restoreSessionSnapshot({ version:2, savedAt:1000 }, 1000), null);
  assert.equal(restoreSessionSnapshot({ version:1, savedAt:1000, diagnosis:{} }, 1000), null);
});
