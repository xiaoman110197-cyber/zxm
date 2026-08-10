const KIND_ORDER = new Map([
  ['calculation_error', 0],
  ['logic_error', 1],
  ['anomaly', 2],
  ['needs_confirmation', 3]
]);
const SEVERITY_ORDER = new Map([['high',0],['medium',1],['low',2]]);

function clean(value, max = 600) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function confirmationFactId(item) {
  if (clean(item?.factId, 100)) return clean(item.factId, 100);
  const id = clean(item?.id, 140);
  return id.startsWith('confirm:') ? id.slice('confirm:'.length) : '';
}

function confirmationIssue(item) {
  const factId = confirmationFactId(item);
  return {
    id:clean(item.id, 140) || `confirm:${item.scope}:${item.metric}`,
    kind:'needs_confirmation',
    title:`${clean(item.metric, 120) || '关键数据'}需要核对`,
    scope:clean(item.scope, 120) || '报表',
    originalValue:item.currentValue,
    unit:clean(item.unit, 40),
    explanation:clean(item.reason) || '这个关键数据需要核对后才能用于结论。',
    evidence:clean(item.sourceText, 300) ? [`原图内容：${clean(item.sourceText, 300)}`] : [],
    relatedFactIds:factId ? [factId] : [],
    severity:'high',
    source:'reconciliation'
  };
}

function confirmedFactIds(confirmations) {
  return new Set((confirmations || []).map(confirmationFactId).filter(Boolean));
}

function ruleIssue(item, conflictedIds) {
  const related = Array.isArray(item.relatedFactIds) ? item.relatedFactIds.filter(Boolean) : [];
  const hasConflict = related.some((id) => conflictedIds.has(id));
  if (!hasConflict) return {
    ...item,
    evidence:Array.isArray(item.evidence) ? item.evidence.slice(0, 20) : [],
    relatedFactIds:related,
    source:'program'
  };

  const downgraded = {
    ...item,
    kind:'needs_confirmation',
    explanation:`这条结论依赖的关键数字存在识别冲突，先核对原数据。${clean(item.explanation)}`,
    evidence:Array.isArray(item.evidence) ? item.evidence.slice(0, 20) : [],
    relatedFactIds:related,
    source:'program'
  };
  delete downgraded.correctedValue;
  return downgraded;
}

function candidateIssue(candidate) {
  const related = Array.isArray(candidate?.relatedFactIds) ? candidate.relatedFactIds.filter((id) => typeof id === 'string' && id.trim()).slice(0, 20) : [];
  if (!related.length) return null;
  const base = {
    id:`vision:${clean(candidate.scope, 120)}:${clean(candidate.title, 160)}`,
    title:clean(candidate.title, 160) || '报表异常',
    scope:clean(candidate.scope, 120) || '报表',
    explanation:clean(candidate.explanation) || '视觉分析发现一处需要核对的异常。',
    evidence:[],
    relatedFactIds:related,
    severity:'medium',
    source:'vision'
  };

  if (candidate.kind === 'calculation_error') {
    return {
      ...base,
      kind:'needs_confirmation',
      explanation:`视觉分析发现疑似计算问题，但程序目前不能复算证明正确结果，请核对原数据和公式。${base.explanation}`
    };
  }
  if (candidate.kind === 'logic_error') return { ...base, kind:'anomaly' };
  return { ...base, kind:'anomaly' };
}

function dedupeKey(issue) {
  return `${clean(issue.scope,120)}\u0000${clean(issue.title,160)}`;
}

function sortIssues(left, right) {
  const kind = (KIND_ORDER.get(left.kind) ?? 9) - (KIND_ORDER.get(right.kind) ?? 9);
  if (kind) return kind;
  const severity = (SEVERITY_ORDER.get(left.severity) ?? 9) - (SEVERITY_ORDER.get(right.severity) ?? 9);
  if (severity) return severity;
  if (left.source === 'program' && right.source !== 'program') return -1;
  if (right.source === 'program' && left.source !== 'program') return 1;
  return dedupeKey(left).localeCompare(dedupeKey(right), 'zh-CN');
}

export function buildReportReview({ ruleIssues = [], visionCandidates = [], confirmations = [], vision = null } = {}) {
  const conflictedIds = confirmedFactIds(confirmations);
  const combined = [];
  const keys = new Set();

  for (const raw of ruleIssues || []) {
    const issue = ruleIssue(raw, conflictedIds);
    const key = dedupeKey(issue);
    if (keys.has(key)) continue;
    keys.add(key);
    combined.push(issue);
  }

  for (const raw of visionCandidates || []) {
    const issue = candidateIssue(raw);
    if (!issue) continue;
    const key = dedupeKey(issue);
    if (keys.has(key)) continue;
    keys.add(key);
    combined.push(issue);
  }

  for (const raw of confirmations || []) {
    const issue = confirmationIssue(raw);
    const key = dedupeKey(issue);
    if (keys.has(key)) continue;
    keys.add(key);
    combined.push(issue);
  }

  combined.sort(sortIssues);
  const provableCorrectionCount = combined.filter((item) => item.kind === 'calculation_error' && item.source === 'program' && Object.prototype.hasOwnProperty.call(item, 'correctedValue')).length;
  const confirmationCount = combined.filter((item) => item.kind === 'needs_confirmation').length;
  const problemCount = combined.filter((item) => item.kind !== 'needs_confirmation').length;
  return {
    issues:combined,
    summary:{
      problemCount,
      provableCorrectionCount,
      confirmationCount,
      visionAvailable:Boolean(vision?.available),
      visionWarning:clean(vision?.warning, 300) || null
    }
  };
}
