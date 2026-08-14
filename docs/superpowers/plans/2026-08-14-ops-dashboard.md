# Admin Operations Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a password-protected `/admin/ops` dashboard that turns privacy-safe Vercel Runtime Logs into request success, failure, and latency evidence without storing business data.

**Architecture:** Existing API routes emit one-line allowlisted JSON events through a shared observability module. Separate admin login and data APIs validate a signed short-lived cookie, query a bounded Vercel runtime-log stream, parse only known events, and return an aggregate DTO to a static admin page. No database, log drain, alerting service, or raw-log browser is introduced.

**Tech Stack:** Node.js 20 ES modules, Vercel Serverless Functions and Runtime Logs REST API, Web Crypto/`node:crypto`, native `fetch`, native `node:test`, static HTML/CSS/JavaScript.

## Global Constraints

- Only the project administrator may access `/admin/ops` data.
- Query range is capped at 7 days, but the UI must report the actual retained interval; Vercel currently documents 3-day Runtime Logs retention on standard plans.
- Store, log, parse, and return technical metadata only—never filenames, request bodies, OCR text, business values, model output, cookies, authorization headers, API keys, or passwords.
- Version 1 has no automatic alerts and no database or third-party monitoring dependency.
- An admin/logging failure must never affect file analysis, diagnosis, report generation, or report download.
- All admin HTML and API responses use `Cache-Control: no-store`; admin pages use `X-Robots-Tag: noindex, nofollow`.
- `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, and `VERCEL_TOKEN` are server-only secrets. `VERCEL_PROJECT_ID` and optional `VERCEL_TEAM_ID` identify the log source.
- Every implementation task follows red-green-refactor TDD and ends in a focused commit.

## File Structure

- Create `src/observability/events.js`: event schema, allowlisting, safe logger, stable failure-code helpers.
- Create `src/observability/aggregate.js`: runtime-log parsing, request correlation, percentile and dashboard aggregation.
- Create `src/observability/vercel-logs.js`: bounded Vercel stream client and upstream error normalization.
- Create `src/admin/session.js`: password verification and signed short-lived cookie functions.
- Create `src/admin/http.js`: cookie parsing, no-store headers, client identity and admin rate-limit helpers.
- Create `api/admin-login.js`: login/logout endpoint.
- Create `api/admin-ops.js`: authenticated aggregate-data endpoint.
- Create `public/admin/ops.html`, `public/admin/ops.js`, `public/admin/ops.css`: static administrator UI.
- Modify `api/analyze-file.js`, `api/diagnosis.js`, `api/report.js`: emit shared structured lifecycle/stage events.
- Modify `vercel.json`, `scripts/verify-server-imports.js`, `.env.example`, `README.md`: routing, bundling verification, configuration, and operating instructions.
- Create focused tests under `tests/observability/`, `tests/admin/`, `tests/api/`, and `tests/ui/`.

---

### Task 1: Privacy-safe structured event contract

**Files:**
- Create: `src/observability/events.js`
- Create: `tests/observability/events.test.js`

**Interfaces:**
- Produces: `emitOpsEvent(event, options?)`, `normalizeOpsEvent(event)`, `failureCodeFor(error, fallback)`, and constants `OPS_EVENT_PREFIX`, `OPS_EVENT_NAMES`, `OPS_ROUTES`.
- `emitOpsEvent` accepts an event object plus `{ logger, now, env }`; it writes exactly one `OPS_EVENT {json}` string and returns the normalized event for tests.
- `normalizeOpsEvent` returns only `level`, `event`, `route`, `requestId`, `timestamp`, `durationMs`, `stage`, `stageDurationMs`, `failureCode`, `deploymentId`, `gitSha`, and `environment`.

- [ ] **Step 1: Write failing allowlist and redaction tests**

```js
test('normalizes only approved technical fields', () => {
  const event = normalizeOpsEvent({
    level:'info', event:'request_completed', route:'diagnosis', requestId:'req-1',
    timestamp:'2026-08-14T00:00:00.000Z', durationMs:42,
    filename:'secret.xlsx', ocrText:'营业额 999', authorization:'Bearer secret'
  });
  assert.deepEqual(event, {
    level:'info', event:'request_completed', route:'diagnosis', requestId:'req-1',
    timestamp:'2026-08-14T00:00:00.000Z', durationMs:42
  });
  assert.doesNotMatch(JSON.stringify(event), /secret|营业额|filename|authorization/i);
});

test('rejects unknown event names, routes, stages and malformed request ids', () => {
  assert.throws(() => normalizeOpsEvent({ event:'raw_dump', route:'diagnosis', requestId:'req-1' }), /event/i);
  assert.throws(() => normalizeOpsEvent({ event:'request_started', route:'unknown', requestId:'req-1' }), /route/i);
  assert.throws(() => normalizeOpsEvent({ event:'stage_completed', route:'analyze-file', requestId:'req 1', stage:'ocr' }), /requestId/i);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/observability/events.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/observability/events.js`.

- [ ] **Step 3: Implement the minimal schema and logger**

```js
export const OPS_EVENT_PREFIX = 'OPS_EVENT ';
export const OPS_EVENT_NAMES = new Set(['request_started', 'stage_completed', 'request_completed', 'request_failed']);
export const OPS_ROUTES = new Set(['analyze-file', 'diagnosis', 'report']);
const STAGES = new Set(['validation', 'parsing', 'cloud-ocr', 'local-ocr', 'structuring', 'checking-rules', 'primary-model', 'review-model', 'report-generation']);
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const FAILURE = /^[A-Z0-9_]{1,64}$/;

export function normalizeOpsEvent(input, { now = Date.now(), env = process.env } = {}) {
  if (!OPS_EVENT_NAMES.has(input?.event)) throw new TypeError('invalid ops event');
  if (!OPS_ROUTES.has(input?.route)) throw new TypeError('invalid ops route');
  if (!ID.test(String(input?.requestId || ''))) throw new TypeError('invalid requestId');
  if (input.stage !== undefined && !STAGES.has(input.stage)) throw new TypeError('invalid stage');
  if (input.failureCode !== undefined && !FAILURE.test(input.failureCode)) throw new TypeError('invalid failureCode');
  const result = {
    level:input.level === 'error' ? 'error' : 'info',
    event:input.event,
    route:input.route,
    requestId:String(input.requestId),
    timestamp:new Date(input.timestamp || now).toISOString()
  };
  for (const key of ['durationMs', 'stageDurationMs']) {
    if (Number.isFinite(input[key]) && input[key] >= 0) result[key] = Math.round(input[key]);
  }
  for (const key of ['stage', 'failureCode']) if (input[key] !== undefined) result[key] = input[key];
  if (ID.test(String(env.VERCEL_DEPLOYMENT_ID || ''))) result.deploymentId = env.VERCEL_DEPLOYMENT_ID;
  if (/^[a-f0-9]{7,40}$/i.test(String(env.VERCEL_GIT_COMMIT_SHA || ''))) result.gitSha = env.VERCEL_GIT_COMMIT_SHA.slice(0, 12);
  if (['production', 'preview', 'development'].includes(env.VERCEL_ENV)) result.environment = env.VERCEL_ENV;
  return result;
}

export function emitOpsEvent(event, { logger = console.info, now, env } = {}) {
  const normalized = normalizeOpsEvent(event, { now, env });
  logger(`${OPS_EVENT_PREFIX}${JSON.stringify(normalized)}`);
  return normalized;
}

export function failureCodeFor(error, fallback = 'UNEXPECTED_ERROR') {
  const candidate = String(error?.code || fallback).toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 64);
  return FAILURE.test(candidate) ? candidate : fallback;
}
```

- [ ] **Step 4: Run tests and inspect the emitted line**

Run: `node --test tests/observability/events.test.js`

Expected: PASS; the test logger receives one string beginning `OPS_EVENT ` and contains none of the forbidden sample values.

- [ ] **Step 5: Commit the event contract**

```bash
git add src/observability/events.js tests/observability/events.test.js
git commit -m "feat: add privacy-safe operations events"
```

### Task 2: Instrument the three business API routes

**Files:**
- Modify: `api/analyze-file.js`
- Modify: `api/diagnosis.js`
- Modify: `api/report.js`
- Modify: `tests/api/analyze-file-observability.test.js`
- Modify: `tests/api/diagnosis.test.js`
- Modify: `tests/api/report.test.js`

**Interfaces:**
- Consumes: `emitOpsEvent`, `failureCodeFor` from Task 1.
- Produces: lifecycle sequences keyed by the existing public `requestId`; dependency injection key `emitOpsEvent` permits isolated tests.

- [ ] **Step 1: Add failing lifecycle tests for success and failure**

```js
test('diagnosis emits safe start, stage and completion events', async () => {
  const events = [];
  await handleDiagnosisRequest(req, res, {
    requestId:'req-diagnosis-ops', emitOpsEvent:(event) => events.push(event),
    primaryProvider:{ name:'deepseek', diagnose:async () => ({ mode:'question', question:'继续核对？', reason:'收集证据' }) },
    reviewerProvider:null
  });
  assert.deepEqual(events.map(({ event }) => event), ['request_started', 'stage_completed', 'request_completed']);
  assert.ok(events.every(({ route, requestId }) => route === 'diagnosis' && requestId === 'req-diagnosis-ops'));
  assert.doesNotMatch(JSON.stringify(events), /继续核对|收集证据/);
});
```

Add equivalent assertions for `analyze-file` and `report`, and a provider failure asserting `request_failed` with `failureCode:'PRIMARY_PROVIDER_ERROR'` but no upstream message.

- [ ] **Step 2: Run the route tests and verify RED**

Run: `node --test tests/api/analyze-file-observability.test.js tests/api/diagnosis.test.js tests/api/report.test.js`

Expected: FAIL because no route accepts or calls `deps.emitOpsEvent` yet.

- [ ] **Step 3: Add minimal lifecycle instrumentation**

At each handler start, bind a non-throwing wrapper so observability can never break the business request:

```js
const emit = deps.emitOpsEvent || ((event) => {
  try { emitOpsEvent(event); } catch { /* monitoring must not break business APIs */ }
});
emit({ event:'request_started', route:'diagnosis', requestId });
```

Measure every named stage with a local `stageStartedAt`, emit `stage_completed`, and emit one terminal `request_completed` or `request_failed`. Map expected failures to stable codes such as `INVALID_REQUEST`, `RATE_LIMITED`, `TRUST_CONFIG_MISSING`, `DOCUMENT_PARSE_ERROR`, `OCR_PROVIDER_ERROR`, `PRIMARY_PROVIDER_ERROR`, `REVIEW_PROVIDER_ERROR`, and `REPORT_GENERATION_ERROR`. Never pass the request body, filename, parsed content, provider response, or exception message to `emit`.

- [ ] **Step 4: Run route tests and verify GREEN**

Run: `node --test tests/api/analyze-file-observability.test.js tests/api/diagnosis.test.js tests/api/report.test.js`

Expected: PASS with exactly one terminal event per tested request and no forbidden values in serialized event arrays.

- [ ] **Step 5: Run the full API regression set**

Run: `node --test tests/api/*.test.js`

Expected: PASS with zero failures.

- [ ] **Step 6: Commit route instrumentation**

```bash
git add api/analyze-file.js api/diagnosis.js api/report.js tests/api/analyze-file-observability.test.js tests/api/diagnosis.test.js tests/api/report.test.js
git commit -m "feat: instrument business request lifecycle"
```

### Task 3: Parse logs and aggregate dashboard evidence

**Files:**
- Create: `src/observability/aggregate.js`
- Create: `tests/observability/aggregate.test.js`

**Interfaces:**
- Consumes: log records shaped as `{ message, timestamp, deploymentId?, environment? }`.
- Produces: `parseOpsLog(record)`, `aggregateOpsLogs(records, options?)`, and DTO `{ coverage, partial, summary, errors, stages, requests }`.

- [ ] **Step 1: Write failing parser, correlation, percentile, and partial-data tests**

```js
const records = [
  log({ event:'request_started', route:'diagnosis', requestId:'r1', timestamp:'2026-08-14T00:00:00.000Z' }),
  log({ event:'stage_completed', route:'diagnosis', requestId:'r1', stage:'primary-model', stageDurationMs:80, timestamp:'2026-08-14T00:00:00.080Z' }),
  log({ event:'request_completed', route:'diagnosis', requestId:'r1', durationMs:100, timestamp:'2026-08-14T00:00:00.100Z' }),
  log({ event:'request_failed', route:'report', requestId:'r2', durationMs:200, failureCode:'REPORT_GENERATION_ERROR', timestamp:'2026-08-14T00:00:01.000Z' })
];
const result = aggregateOpsLogs(records, { requestedSince:'2026-08-13T00:00:00.000Z', truncated:false });
assert.deepEqual(result.summary, { total:2, succeeded:1, failed:1, successRate:50, averageDurationMs:150, p95DurationMs:200 });
assert.equal(result.requests[0].requestId, 'r2');
assert.equal(result.errors[0].failureCode, 'REPORT_GENERATION_ERROR');
assert.equal(result.stages[0].stage, 'primary-model');
```

Also assert malformed lines, oversized lines, unknown fields, duplicate terminal events, and non-`OPS_EVENT` messages are ignored; empty results set `coverage.hasData=false` and never claim 100% health.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/observability/aggregate.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement strict parsing and aggregation**

Implement `parseOpsLog` with a 16 KB message ceiling, exact `OPS_EVENT ` prefix, JSON parse guard, and a second call to `normalizeOpsEvent`. Correlate by `requestId`, prefer the last valid terminal event, cap returned recent requests at 100, calculate nearest-rank P95 from sorted numeric values, and return actual earliest/latest timestamps. Set `partial=true` when upstream says truncated or the earliest available event is later than the requested start.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/observability/aggregate.test.js`

Expected: PASS with deterministic ordering and numeric results.

- [ ] **Step 5: Commit aggregation**

```bash
git add src/observability/aggregate.js tests/observability/aggregate.test.js
git commit -m "feat: aggregate operations log evidence"
```

### Task 4: Create the bounded Vercel Runtime Logs client

**Files:**
- Create: `src/observability/vercel-logs.js`
- Create: `tests/observability/vercel-logs.test.js`

**Interfaces:**
- Produces: `fetchRuntimeLogs({ token, projectId, teamId, since, until, limit, fetchImpl, signal })` returning `{ records, truncated, upstreamCoverage }`.
- The client calls `GET https://api.vercel.com/v1/projects/{projectId}/deployments/{deploymentId}/runtime-logs` only after resolving a bounded set of matching deployments through `GET /v6/deployments`; it accepts NDJSON or JSON responses and never returns upstream error bodies.

- [ ] **Step 1: Write failing URL, authorization, bounds, stream, and error tests**

```js
test('caps range, deployments, events and does not expose upstream text', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url:String(url), authorization:init.headers.Authorization });
    if (String(url).includes('/v6/deployments')) return jsonResponse({ deployments:[{ uid:'dpl_one', createdAt:1 }] });
    return textResponse('{"message":"OPS_EVENT {\\"event\\":\\"request_completed\\",\\"route\\":\\"diagnosis\\",\\"requestId\\":\\"r1\\",\\"timestamp\\":\\"2026-08-14T00:00:00.000Z\\",\\"durationMs\\":10}"}\n');
  };
  const result = await fetchRuntimeLogs({ token:'vercel-secret', projectId:'prj_1', since:'30d', until:new Date('2026-08-14T00:00:00Z'), limit:5000, fetchImpl });
  assert.equal(result.records.length, 1);
  assert.ok(calls.every((call) => call.authorization === 'Bearer vercel-secret'));
  assert.ok(calls.length <= 6);
});
```

Add tests for 401/403, 429, timeout/abort, non-OK HTML, malformed NDJSON, 1 MB cumulative response ceiling, five-deployment ceiling, and 1,000-record ceiling. Assert thrown errors expose only `VERCEL_AUTH_FAILED`, `VERCEL_RATE_LIMITED`, `VERCEL_TIMEOUT`, or `VERCEL_UNAVAILABLE`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/observability/vercel-logs.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the client with explicit safety bounds**

Use `AbortSignal.timeout(8000)` when no signal is injected. Clamp `since` to `now - 7 days`, deployment count to 5, per-deployment records so the combined maximum is 1,000, and total decoded response to 1 MB. Apply `projectId`, `teamId`, `since`, `until`, `limit`, and production environment filters to the Vercel requests. Parse the response incrementally by newline when a stream body is available; discard records without a string `message`. Never include `token`, URL query contents, upstream body, or response headers in thrown error messages.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/observability/vercel-logs.test.js`

Expected: PASS, including timeout and malformed-stream cases.

- [ ] **Step 5: Commit the Vercel adapter**

```bash
git add src/observability/vercel-logs.js tests/observability/vercel-logs.test.js
git commit -m "feat: add bounded Vercel log reader"
```

### Task 5: Implement administrator sessions and login API

**Files:**
- Create: `src/admin/session.js`
- Create: `src/admin/http.js`
- Create: `api/admin-login.js`
- Create: `tests/admin/session.test.js`
- Create: `tests/api/admin-login.test.js`

**Interfaces:**
- Produces: `passwordMatches(candidate, configured)`, `issueAdminSession(options)`, `verifyAdminSession(token, options)`, `readCookie(req, name)`, `applyAdminHeaders(res)`, and `handleAdminLoginRequest(req, res, deps?)`.
- Session token format is `base64url(payload).base64url(hmac)` with payload `{ v:1, exp:number, nonce:string }`; cookie name is `zhenduan_admin` and TTL is 30 minutes.

- [ ] **Step 1: Write failing cryptographic and cookie tests**

```js
test('session expires and rejects tampering', () => {
  const token = issueAdminSession({ secret:'a'.repeat(32), now:1_000, ttlMs:30 * 60_000, nonce:'n1' });
  assert.equal(verifyAdminSession(token, { secret:'a'.repeat(32), now:1_001 }).v, 1);
  assert.throws(() => verifyAdminSession(`${token}x`, { secret:'a'.repeat(32), now:1_001 }), /invalid/i);
  assert.throws(() => verifyAdminSession(token, { secret:'a'.repeat(32), now:1_801_001 }), /expired/i);
});
```

API tests must assert: unsupported method 405; missing configuration 503; bad password 401 with no distinction; repeated failure 429 and `Retry-After`; success 200 with `HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=1800`; logout clears the cookie; every response is `no-store`; serialized response/logs contain no submitted password or session secret.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/admin/session.test.js tests/api/admin-login.test.js`

Expected: FAIL because session and login modules do not exist.

- [ ] **Step 3: Implement constant-time verification, signed sessions, and rate limiting**

Hash candidate and configured passwords with `createHmac('sha256', ADMIN_SESSION_SECRET)` before `timingSafeEqual` so buffers always have equal length. Sign payload with HMAC-SHA256. Reuse `checkBurstLimit` with identity `admin-login:<client-ip>`, limit 5 attempts per 15 minutes. Accept `{ password }` on `POST`; accept `DELETE` for logout. Return only `{ ok:true }` or `{ error:'管理员登录失败' }`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/admin/session.test.js tests/api/admin-login.test.js`

Expected: PASS with secure cookie attributes and no secret reflection.

- [ ] **Step 5: Commit administrator authentication**

```bash
git add src/admin/session.js src/admin/http.js api/admin-login.js tests/admin/session.test.js tests/api/admin-login.test.js
git commit -m "feat: add secure administrator session"
```

### Task 6: Build the authenticated operations API

**Files:**
- Create: `api/admin-ops.js`
- Create: `tests/api/admin-ops.test.js`
- Modify: `scripts/verify-server-imports.js`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `verifyAdminSession`, `readCookie`, `applyAdminHeaders`, `fetchRuntimeLogs`, `aggregateOpsLogs`.
- Produces: `handleAdminOpsRequest(req, res, deps?)`; `GET /api/admin-ops?range=24h|7d&requestId=<safe-id>`.

- [ ] **Step 1: Write failing authentication, configuration, filtering, and degradation tests**

```js
test('authenticated admin receives aggregate DTO and never raw logs', async () => {
  const res = mockRes();
  await handleAdminOpsRequest({ method:'GET', query:{ range:'24h' }, headers:{ cookie:'zhenduan_admin=valid' } }, res, {
    env:{ VERCEL_TOKEN:'token', VERCEL_PROJECT_ID:'prj_1', ADMIN_SESSION_SECRET:'s'.repeat(32) },
    verifySession:() => ({ v:1 }),
    fetchRuntimeLogs:async () => ({ records:[safeLog], truncated:false }), now:Date.parse('2026-08-14T00:00:00Z')
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.summary.total, 1);
  assert.equal(res.body.rawLogs, undefined);
  assert.doesNotMatch(JSON.stringify(res.body), /OPS_EVENT|token/);
});
```

Add tests for 401 unauthenticated, 503 missing admin/Vercel config, 400 invalid range/request ID, 429 upstream mapped safely, timeout returning `{ available:false, partial:true, code:'VERCEL_TIMEOUT' }`, and main API imports remaining successful.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/api/admin-ops.test.js tests/deploy/vercel-config.test.js`

Expected: FAIL because the endpoint and Vercel function entry are absent.

- [ ] **Step 3: Implement the thin authenticated controller**

Parse only `range=24h|7d`; validate `requestId` with `/^[A-Za-z0-9_-]{1,128}$/`; verify cookie before reading log configuration; call the Vercel adapter; aggregate results; apply a final response whitelist. Return 200 with explicit `available`, `partial`, `coverage`, and safe `code` even when logs are unavailable, except missing server configuration which returns 503. Add `api/admin-login.js` and `api/admin-ops.js` to `vercel.json` with `maxDuration:10`, and to the server import verifier.

- [ ] **Step 4: Run endpoint and deployment tests and verify GREEN**

Run: `node --test tests/api/admin-ops.test.js tests/api/admin-login.test.js tests/deploy/vercel-config.test.js && node scripts/verify-server-imports.js`

Expected: PASS and `Verified 6 server API modules`.

- [ ] **Step 5: Commit the protected data API**

```bash
git add api/admin-ops.js scripts/verify-server-imports.js vercel.json tests/api/admin-ops.test.js tests/deploy/vercel-config.test.js
git commit -m "feat: expose protected operations summary"
```

### Task 7: Build the mobile-safe administrator page

**Files:**
- Create: `public/admin/ops.html`
- Create: `public/admin/ops.js`
- Create: `public/admin/ops.css`
- Create: `tests/ui/admin-ops.test.js`

**Interfaces:**
- Consumes: `POST/DELETE /api/admin-login`, `GET /api/admin-ops?range=24h|7d&requestId=...`.
- Produces: login state, coverage banner, summary cards, error table, stage table, recent-request table, exact request-ID filter, retry and logout controls.

- [ ] **Step 1: Write failing static UI contract tests**

```js
test('admin page has accessible login and evidence regions without secret inputs in URLs', async () => {
  const html = await readFile(new URL('../../public/admin/ops.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../../public/admin/ops.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../../public/admin/ops.css', import.meta.url), 'utf8');
  for (const id of ['admin-login','coverage-status','summary-cards','error-table','stage-table','request-table','request-filter','logout']) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(js, /\/api\/admin-login/);
  assert.match(js, /\/api\/admin-ops/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|VERCEL_TOKEN|ADMIN_PASSWORD/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)/);
});
```

- [ ] **Step 2: Run focused UI test and verify RED**

Run: `node --test tests/ui/admin-ops.test.js`

Expected: FAIL because the three static assets do not exist.

- [ ] **Step 3: Implement the page with safe rendering**

Use `textContent` exclusively for values returned by APIs. Submit the password in a JSON request body, immediately clear the password input, and never retain it in a variable after the request settles. Default to `24h`; offer `7d`; show actual earliest/latest data, `partial`, and documented retention caveat. Render no-data as “没有可用日志，不能据此判断系统健康”, not 100%. On narrow screens, make tables scroll within `.table-scroll { overflow-x:auto }` while the page itself stays within viewport width.

- [ ] **Step 4: Run UI tests and build**

Run: `node --test tests/ui/admin-ops.test.js && npm run build`

Expected: PASS; `dist/admin/ops.html`, `dist/admin/ops.js`, and `dist/admin/ops.css` exist after build.

- [ ] **Step 5: Commit the administrator UI**

```bash
git add public/admin/ops.html public/admin/ops.js public/admin/ops.css tests/ui/admin-ops.test.js
git commit -m "feat: add administrator operations dashboard"
```

### Task 8: Document configuration and run the complete acceptance gate

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Create: `tests/security/ops-privacy.test.js`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: deployer instructions and a repository-wide privacy regression gate.

- [ ] **Step 1: Write the failing repository privacy test**

```js
test('operations implementation contains no sample secrets or raw business payload logging', async () => {
  const files = await Promise.all(opsFiles.map((file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8')));
  const source = files.join('\n');
  const envExample = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\([^\n]*(?:req\.body|file\.name|ocrText|contentBase64)/);
  assert.doesNotMatch(source, /Bearer\s+[A-Za-z0-9_-]{16,}/);
  for (const name of ['ADMIN_PASSWORD','ADMIN_SESSION_SECRET','VERCEL_TOKEN','VERCEL_PROJECT_ID']) {
    assert.match(envExample, new RegExp(`^${name}=`, 'm'));
  }
});
```

- [ ] **Step 2: Run the privacy test and verify RED until documentation/configuration is complete**

Run: `node --test tests/security/ops-privacy.test.js`

Expected: FAIL because the four required administrator/Vercel variables are not yet documented in `.env.example`.

- [ ] **Step 3: Add exact environment and operating documentation**

Append to `.env.example`:

```text
# Administrator operations dashboard (server only)
ADMIN_PASSWORD=replace-with-a-long-unique-password
ADMIN_SESSION_SECRET=replace-with-at-least-32-random-bytes
VERCEL_TOKEN=replace-with-a-read-only-expiring-token
VERCEL_PROJECT_ID=prj_replace-with-project-id
VERCEL_TEAM_ID=
```

Document in `README.md`: `/admin/ops`; how to generate the session secret; least-privilege/expiry guidance for the Vercel token; Preview versus Production variables; current 3-day Vercel retention and 7-day query cap; no-data/partial meanings; exact rollback action (remove the four admin environment variables or revert this branch); and the rule that no live OCR call is required for this feature’s acceptance.

- [ ] **Step 4: Run the full local verification gate**

Run: `npm test && npm run build && git diff --check`

Expected: all Node tests pass, build reports all six server modules import successfully, static admin assets exist in `dist/admin/`, and `git diff --check` exits 0.

- [ ] **Step 5: Perform Preview acceptance without a paid OCR call**

After pushing and configuring Preview secrets, verify:

```text
1. GET /admin/ops shows only the login form.
2. Wrong password receives the generic failure message; repeated failures receive a retry delay.
3. Correct password sets a Secure/HttpOnly/SameSite=Strict cookie.
4. Dashboard loads existing technical logs and shows actual coverage/partial state.
5. Search for a known request ID returns only its route, stage, status, duration, safe code and deployment SHA.
6. Browser source and Network responses contain no ADMIN_PASSWORD, ADMIN_SESSION_SECRET, VERCEL_TOKEN, filename, OCR text or business values.
7. Temporarily use an invalid injected token in an isolated API test: dashboard degrades safely while /api/health and the existing main page remain available.
8. Check desktop and phone widths for page-level horizontal overflow.
```

Expected: all eight checks pass. Do not invoke Qianfan OCR; use existing Runtime Logs or test fixtures because OCR may incur cost and is outside this feature’s acceptance scope.

- [ ] **Step 6: Commit documentation and acceptance guard**

```bash
git add .env.example README.md tests/security/ops-privacy.test.js
git commit -m "docs: add operations dashboard runbook"
```

## Final Review Checklist

- [ ] Every design requirement maps to Tasks 1–8.
- [ ] Runtime queries are bounded to 7 days, five deployments, 1,000 events, 1 MB, and 8 seconds.
- [ ] The UI presents Vercel’s actual coverage and does not promise seven retained days.
- [ ] Authentication precedes all Vercel reads and every admin response is non-cacheable.
- [ ] No raw Vercel response, secret, filename, OCR content, model output, or business value reaches the browser or structured log.
- [ ] Observability failures are swallowed at business-route boundaries and tested not to change business responses.
- [ ] Empty/partial data cannot be mistaken for a healthy system.
- [ ] Full tests, build, Preview authentication, privacy inspection, and responsive layout checks have fresh evidence before completion is claimed.
