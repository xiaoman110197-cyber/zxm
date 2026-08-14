import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateOpsLogs, parseOpsLog } from '../../src/observability/aggregate.js';

function log(event) {
  return { message:`OPS_EVENT ${JSON.stringify(event)}`, timestamp:event.timestamp };
}

test('correlates terminal requests and computes hand-checked summary and stage metrics', () => {
  const records = [
    log({ level:'info', event:'request_started', route:'diagnosis', requestId:'r1', timestamp:'2026-08-14T00:00:00.000Z' }),
    log({ level:'info', event:'stage_completed', route:'diagnosis', requestId:'r1', stage:'primary-model', stageDurationMs:80, timestamp:'2026-08-14T00:00:00.080Z' }),
    log({ level:'info', event:'request_completed', route:'diagnosis', requestId:'r1', durationMs:100, timestamp:'2026-08-14T00:00:00.100Z' }),
    log({ level:'error', event:'request_failed', route:'report', requestId:'r2', durationMs:200, failureCode:'REPORT_GENERATION_ERROR', timestamp:'2026-08-14T00:00:01.000Z' })
  ];
  const result = aggregateOpsLogs(records, { requestedSince:'2026-08-13T00:00:00.000Z', truncated:false });

  assert.deepEqual(result.summary, {
    total:2, succeeded:1, failed:1, successRate:50, averageDurationMs:150, p95DurationMs:200
  });
  assert.equal(result.requests[0].requestId, 'r2');
  assert.equal(result.requests[0].status, 'failed');
  assert.deepEqual(result.errors[0], { failureCode:'REPORT_GENERATION_ERROR', count:1, percentage:100 });
  assert.deepEqual(result.stages[0], { stage:'primary-model', count:1, averageDurationMs:80, p95DurationMs:80 });
  assert.equal(result.coverage.earliest, '2026-08-14T00:00:00.000Z');
  assert.equal(result.coverage.latest, '2026-08-14T00:00:01.000Z');
  assert.equal(result.partial, true);
});

test('ignores malformed, oversized, foreign and invalid event records', () => {
  const safe = log({ level:'info', event:'request_completed', route:'report', requestId:'safe', durationMs:10, timestamp:'2026-08-14T00:00:00.000Z' });
  const result = aggregateOpsLogs([
    { message:'ordinary application log', timestamp:'2026-08-14T00:00:00.000Z' },
    { message:'OPS_EVENT {bad-json', timestamp:'2026-08-14T00:00:00.000Z' },
    { message:`OPS_EVENT ${'x'.repeat(17 * 1024)}`, timestamp:'2026-08-14T00:00:00.000Z' },
    log({ level:'info', event:'request_completed', route:'unknown', requestId:'bad', durationMs:1, timestamp:'2026-08-14T00:00:00.000Z' }),
    safe
  ]);
  assert.equal(result.summary.total, 1);
  assert.equal(result.requests[0].requestId, 'safe');
  assert.equal(parseOpsLog({ message:'plain text' }), null);
});

test('uses the latest terminal event and caps recent requests', () => {
  const records = [];
  for (let index = 0; index < 105; index += 1) {
    records.push(log({
      level:'info', event:'request_completed', route:'diagnosis', requestId:`r${index}`,
      durationMs:index, timestamp:new Date(Date.UTC(2026, 7, 14, 0, 0, index)).toISOString()
    }));
  }
  records.push(log({ level:'error', event:'request_failed', route:'diagnosis', requestId:'r104', durationMs:999, failureCode:'LATE_FAILURE', timestamp:'2026-08-14T00:03:00.000Z' }));
  const result = aggregateOpsLogs(records);
  assert.equal(result.summary.total, 105);
  assert.equal(result.requests.length, 100);
  assert.equal(result.requests[0].requestId, 'r104');
  assert.equal(result.requests[0].durationMs, 999);
  assert.equal(result.summary.failed, 1);
});

test('empty data reports no coverage and no fake health percentage', () => {
  const result = aggregateOpsLogs([], { requestedSince:'2026-08-13T00:00:00.000Z', truncated:false });
  assert.deepEqual(result.coverage, { hasData:false, earliest:null, latest:null });
  assert.deepEqual(result.summary, {
    total:0, succeeded:0, failed:0, successRate:null, averageDurationMs:null, p95DurationMs:null
  });
  assert.equal(result.partial, false);
});
