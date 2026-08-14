import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRuntimeLogs } from '../../src/observability/vercel-logs.js';

function response(body, { status = 200, contentType = 'application/json' } = {}) {
  return new Response(body, { status, headers:{ 'content-type':contentType } });
}

test('queries bounded production deployments and parses runtime NDJSON', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url:String(url), authorization:init.headers.Authorization });
    if (String(url).includes('/v6/deployments')) {
      return response(JSON.stringify({ deployments:Array.from({ length:7 }, (_, index) => ({ uid:`dpl_${index}` })) }));
    }
    return response(`${JSON.stringify({ message:'OPS_EVENT safe', timestampInMs:1 })}\n`, { contentType:'application/x-ndjson' });
  };
  const result = await fetchRuntimeLogs({
    token:'vercel-secret', projectId:'prj_1', teamId:'team_1', since:'30d',
    until:new Date('2026-08-14T00:00:00Z'), limit:5000, fetchImpl
  });
  assert.equal(result.records.length, 5);
  assert.equal(result.truncated, true);
  assert.equal(calls.length, 6);
  assert.ok(calls.every(({ authorization }) => authorization === 'Bearer vercel-secret'));
  const deploymentUrl = new URL(calls[0].url);
  assert.equal(deploymentUrl.searchParams.get('projectId'), 'prj_1');
  assert.equal(deploymentUrl.searchParams.get('teamId'), 'team_1');
  assert.equal(deploymentUrl.searchParams.get('target'), 'production');
  assert.equal(Number(deploymentUrl.searchParams.get('since')), Date.parse('2026-08-07T00:00:00Z'));
});

test('caps total runtime records at one thousand', async () => {
  const line = `${JSON.stringify({ message:'OPS_EVENT safe', timestampInMs:1 })}\n`;
  const fetchImpl = async (url) => String(url).includes('/v6/deployments')
    ? response(JSON.stringify({ deployments:[{ uid:'dpl_one' }] }))
    : response(line.repeat(1200), { contentType:'application/x-ndjson' });
  const result = await fetchRuntimeLogs({ token:'token', projectId:'prj', since:'24h', until:new Date('2026-08-14T00:00:00Z'), fetchImpl });
  assert.equal(result.records.length, 1000);
  assert.equal(result.truncated, true);
});

test('normalizes upstream authorization, rate, timeout and availability failures', async () => {
  for (const [status, code] of [[401,'VERCEL_AUTH_FAILED'], [403,'VERCEL_AUTH_FAILED'], [429,'VERCEL_RATE_LIMITED'], [500,'VERCEL_UNAVAILABLE']]) {
    await assert.rejects(
      fetchRuntimeLogs({ token:'secret', projectId:'prj', fetchImpl:async () => response('upstream secret body', { status }) }),
      (error) => error.code === code && !error.message.includes('secret body')
    );
  }
  await assert.rejects(
    fetchRuntimeLogs({ token:'secret', projectId:'prj', fetchImpl:async () => { const error = new Error('aborted secret'); error.name = 'AbortError'; throw error; } }),
    (error) => error.code === 'VERCEL_TIMEOUT' && !error.message.includes('secret')
  );
});

test('rejects missing configuration before issuing a request', async () => {
  let calls = 0;
  await assert.rejects(fetchRuntimeLogs({ token:'', projectId:'', fetchImpl:async () => { calls += 1; } }), /configuration/i);
  assert.equal(calls, 0);
});
