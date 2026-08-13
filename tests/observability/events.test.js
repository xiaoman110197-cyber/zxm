import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emitOpsEvent,
  failureCodeFor,
  normalizeOpsEvent
} from '../../src/observability/events.js';

test('normalizes only approved technical fields', () => {
  const event = normalizeOpsEvent({
    level:'info',
    event:'request_completed',
    route:'diagnosis',
    requestId:'req-1',
    timestamp:'2026-08-14T00:00:00.000Z',
    durationMs:42,
    filename:'secret.xlsx',
    ocrText:'营业额 999',
    authorization:'Bearer secret'
  }, { env:{} });

  assert.deepEqual(event, {
    level:'info',
    event:'request_completed',
    route:'diagnosis',
    requestId:'req-1',
    timestamp:'2026-08-14T00:00:00.000Z',
    durationMs:42
  });
  assert.doesNotMatch(JSON.stringify(event), /secret|营业额|filename|authorization/i);
});

test('rejects unknown event names, routes, stages and malformed request ids', () => {
  assert.throws(() => normalizeOpsEvent({ event:'raw_dump', route:'diagnosis', requestId:'req-1' }), /event/i);
  assert.throws(() => normalizeOpsEvent({ event:'request_started', route:'unknown', requestId:'req-1' }), /route/i);
  assert.throws(() => normalizeOpsEvent({ event:'stage_completed', route:'analyze-file', requestId:'req 1', stage:'ocr' }), /requestId/i);
  assert.throws(() => normalizeOpsEvent({ event:'stage_completed', route:'analyze-file', requestId:'req-1', stage:'unknown' }), /stage/i);
});

test('emits one prefixed JSON line with bounded deployment metadata', () => {
  const lines = [];
  const event = emitOpsEvent({
    event:'stage_completed',
    route:'analyze-file',
    requestId:'req-stage',
    stage:'cloud-ocr',
    stageDurationMs:19.6
  }, {
    logger:(line) => lines.push(line),
    now:Date.parse('2026-08-14T01:02:03.000Z'),
    env:{
      VERCEL_DEPLOYMENT_ID:'dpl_abc123',
      VERCEL_GIT_COMMIT_SHA:'54cf85fe69cc26c4d522ddba9ae3e945574ae1ca',
      VERCEL_ENV:'preview'
    }
  });

  assert.equal(lines.length, 1);
  assert.match(lines[0], /^OPS_EVENT \{/);
  assert.deepEqual(JSON.parse(lines[0].slice('OPS_EVENT '.length)), event);
  assert.equal(event.stageDurationMs, 20);
  assert.equal(event.gitSha, '54cf85fe69cc');
  assert.equal(event.environment, 'preview');
});

test('maps provider errors to stable bounded failure codes', () => {
  assert.equal(failureCodeFor({ code:'ocr-http-401' }, 'OCR_PROVIDER_ERROR'), 'OCR_HTTP_401');
  assert.equal(failureCodeFor({}, 'PRIMARY_PROVIDER_ERROR'), 'PRIMARY_PROVIDER_ERROR');
  assert.match(failureCodeFor({ code:'x'.repeat(100) }), /^[A-Z0-9_]{1,64}$/);
});
