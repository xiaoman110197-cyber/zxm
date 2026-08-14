import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAdminOpsRequest } from '../../api/admin-ops.js';

function mockRes() {
  return {
    statusCode:200, body:null, headers:{},
    status(code){ this.statusCode = code; return this; },
    setHeader(name, value){ this.headers[String(name).toLowerCase()] = value; },
    json(value){ this.body = value; return this; }
  };
}

const env = {
  ADMIN_SESSION_SECRET:'s'.repeat(32), VERCEL_TOKEN:'token-secret',
  VERCEL_PROJECT_ID:'prj_1', VERCEL_TEAM_ID:'team_1'
};
const safeLog = {
  message:'OPS_EVENT {"level":"info","event":"request_completed","route":"diagnosis","requestId":"r1","timestamp":"2026-08-14T00:00:00.000Z","durationMs":10}'
};

test('rejects unauthenticated access before fetching Vercel logs', async () => {
  let fetched = false;
  const res = mockRes();
  await handleAdminOpsRequest({ method:'GET', query:{ range:'24h' }, headers:{} }, res, {
    env, fetchRuntimeLogs:async () => { fetched = true; }
  });
  assert.equal(res.statusCode, 401);
  assert.equal(fetched, false);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('authenticated administrator receives aggregates without raw logs or secrets', async () => {
  const res = mockRes();
  await handleAdminOpsRequest({ method:'GET', query:{ range:'24h' }, headers:{ cookie:'zhenduan_admin=valid' } }, res, {
    env, verifySession:() => ({ v:1 }),
    fetchRuntimeLogs:async () => ({ records:[safeLog], truncated:false }),
    now:Date.parse('2026-08-14T01:00:00Z')
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.available, true);
  assert.equal(res.body.summary.total, 1);
  assert.equal(res.body.requests[0].requestId, 'r1');
  assert.equal(res.body.rawLogs, undefined);
  assert.doesNotMatch(JSON.stringify(res.body), /OPS_EVENT|token-secret|team_1/);
});

test('validates range and exact request id filter', async () => {
  for (const query of [{ range:'30d' }, { range:'24h', requestId:'bad id' }]) {
    const res = mockRes();
    await handleAdminOpsRequest({ method:'GET', query, headers:{ cookie:'zhenduan_admin=valid' } }, res, {
      env, verifySession:() => ({ v:1 }), fetchRuntimeLogs:async () => { throw new Error('must not fetch'); }
    });
    assert.equal(res.statusCode, 400);
  }

  const res = mockRes();
  await handleAdminOpsRequest({ method:'GET', query:{ range:'7d', requestId:'wanted' }, headers:{ cookie:'zhenduan_admin=valid' } }, res, {
    env, verifySession:() => ({ v:1 }),
    fetchRuntimeLogs:async () => ({ records:[safeLog, { ...safeLog, message:safeLog.message.replace(/r1/g, 'wanted') }], truncated:false })
  });
  assert.equal(res.body.summary.total, 1);
  assert.equal(res.body.requests[0].requestId, 'wanted');
});

test('maps upstream failure to a safe partial response', async () => {
  const res = mockRes();
  const upstream = new Error('upstream secret detail'); upstream.code = 'VERCEL_TIMEOUT';
  await handleAdminOpsRequest({ method:'GET', query:{ range:'24h' }, headers:{ cookie:'zhenduan_admin=valid' } }, res, {
    env, verifySession:() => ({ v:1 }), fetchRuntimeLogs:async () => { throw upstream; }
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { available:false, partial:true, code:'VERCEL_TIMEOUT' });
  assert.doesNotMatch(JSON.stringify(res.body), /upstream|secret/);
});

test('missing server configuration returns 503 after authentication', async () => {
  const res = mockRes();
  await handleAdminOpsRequest({ method:'GET', query:{ range:'24h' }, headers:{ cookie:'zhenduan_admin=valid' } }, res, {
    env:{ ADMIN_SESSION_SECRET:'s'.repeat(32) }, verifySession:() => ({ v:1 })
  });
  assert.equal(res.statusCode, 503);
});
