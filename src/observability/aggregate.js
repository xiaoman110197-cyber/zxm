import { OPS_EVENT_PREFIX, normalizeOpsEvent } from './events.js';

const MAX_LOG_MESSAGE_BYTES = 16 * 1024;
const MAX_RECENT_REQUESTS = 100;

export function parseOpsLog(record) {
  if (!record || typeof record.message !== 'string') return null;
  if (!record.message.startsWith(OPS_EVENT_PREFIX)) return null;
  if (Buffer.byteLength(record.message, 'utf8') > MAX_LOG_MESSAGE_BYTES) return null;
  try {
    const parsed = JSON.parse(record.message.slice(OPS_EVENT_PREFIX.length));
    return normalizeOpsEvent(parsed, { env:{} });
  } catch {
    return null;
  }
}

function percentile95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function average(values) {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentage(part, total) {
  return total ? Math.round((part / total) * 1000) / 10 : null;
}

function requestView(terminal, stages) {
  const lastStage = [...stages].sort((left, right) => left.timestamp.localeCompare(right.timestamp)).at(-1);
  return {
    timestamp:terminal.timestamp,
    route:terminal.route,
    requestId:terminal.requestId,
    status:terminal.event === 'request_completed' ? 'succeeded' : 'failed',
    durationMs:terminal.durationMs ?? null,
    stage:lastStage?.stage ?? null,
    failureCode:terminal.failureCode ?? null,
    deploymentId:terminal.deploymentId ?? null,
    gitSha:terminal.gitSha ?? null,
    environment:terminal.environment ?? null
  };
}

export function aggregateOpsLogs(records, { requestedSince, truncated = false } = {}) {
  const events = records.map(parseOpsLog).filter(Boolean).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const byRequest = new Map();
  for (const event of events) {
    const current = byRequest.get(event.requestId) || { stages:[], terminal:null };
    if (event.event === 'stage_completed') current.stages.push(event);
    if (event.event === 'request_completed' || event.event === 'request_failed') current.terminal = event;
    byRequest.set(event.requestId, current);
  }

  const requests = [];
  const stageDurations = new Map();
  for (const { stages, terminal } of byRequest.values()) {
    if (terminal) requests.push(requestView(terminal, stages));
    for (const stage of stages) {
      if (!Number.isFinite(stage.stageDurationMs)) continue;
      const durations = stageDurations.get(stage.stage) || [];
      durations.push(stage.stageDurationMs);
      stageDurations.set(stage.stage, durations);
    }
  }
  requests.sort((left, right) => right.timestamp.localeCompare(left.timestamp));

  const succeeded = requests.filter(({ status }) => status === 'succeeded').length;
  const failed = requests.filter(({ status }) => status === 'failed').length;
  const durations = requests.map(({ durationMs }) => durationMs).filter(Number.isFinite);
  const errorCounts = new Map();
  for (const request of requests) {
    if (request.status !== 'failed' || !request.failureCode) continue;
    errorCounts.set(request.failureCode, (errorCounts.get(request.failureCode) || 0) + 1);
  }

  const errors = [...errorCounts].map(([failureCode, count]) => ({
    failureCode,
    count,
    percentage:percentage(count, failed)
  })).sort((left, right) => right.count - left.count || left.failureCode.localeCompare(right.failureCode));

  const stages = [...stageDurations].map(([stage, values]) => ({
    stage,
    count:values.length,
    averageDurationMs:average(values),
    p95DurationMs:percentile95(values)
  })).sort((left, right) => left.stage.localeCompare(right.stage));

  const earliest = events[0]?.timestamp ?? null;
  const latest = events.at(-1)?.timestamp ?? null;
  return {
    coverage:{ hasData:events.length > 0, earliest, latest },
    partial:Boolean(truncated || (earliest && requestedSince && earliest > requestedSince)),
    summary:{
      total:requests.length,
      succeeded,
      failed,
      successRate:percentage(succeeded, requests.length),
      averageDurationMs:average(durations),
      p95DurationMs:percentile95(durations)
    },
    errors,
    stages,
    requests:requests.slice(0, MAX_RECENT_REQUESTS)
  };
}
