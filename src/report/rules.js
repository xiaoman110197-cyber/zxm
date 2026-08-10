const REVENUE_METRICS = ['营收','营业收入','营业额','销售额'];
const COST_METRICS = ['营业成本','成本'];
const GROSS_PROFIT_METRICS = ['毛利'];
const GROSS_MARGIN_METRICS = ['毛利率','销售毛利率'];
const NET_PROFIT_METRICS = ['净利润'];
const HEADCOUNT_METRICS = ['期末人数','人数','员工人数'];
const ATTENDANCE_METRICS = ['出勤率'];
const TURNOVER_METRICS = ['离职率'];
const PRODUCTION_DATE_METRICS = ['生产日期'];
const EXPIRY_DATE_METRICS = ['失效日期','到期日期','有效期至'];

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function numeric(fact) {
  return typeof fact?.value === 'number' && Number.isFinite(fact.value) ? fact.value : null;
}

function findFact(facts, names) {
  return facts.find((fact) => names.includes(fact.metric)) || null;
}

function evidenceFor(facts) {
  return facts.filter(Boolean).map((fact) => `${fact.metric}：${fact.value}${fact.unit || ''}`);
}

function issueId(prefix, scope, factIds = []) {
  return `${prefix}:${scope}:${factIds.filter(Boolean).join(',')}`;
}

function materialDifference(actual, expected, tolerance = 0.05) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  return Math.abs(actual - expected) > Math.max(tolerance, Math.abs(expected) * 0.001);
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[年/.]/g, '-').replace(/月/g, '-').replace(/日/g, '');
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function groupByScope(facts) {
  const groups = new Map();
  for (const fact of facts || []) {
    if (!fact?.scope || !fact?.metric) continue;
    if (!groups.has(fact.scope)) groups.set(fact.scope, []);
    groups.get(fact.scope).push(fact);
  }
  return groups;
}

function grossProfitIssues(scope, facts) {
  const revenue = findFact(facts, REVENUE_METRICS);
  const cost = findFact(facts, COST_METRICS);
  const reported = findFact(facts, GROSS_PROFIT_METRICS);
  const revenueValue = numeric(revenue);
  const costValue = numeric(cost);
  const reportedValue = numeric(reported);
  if (revenueValue === null || costValue === null || reportedValue === null || costValue < 0) return [];
  const expected = round(revenueValue - costValue, 2);
  if (!materialDifference(reportedValue, expected, 0.01)) return [];
  return [{
    id:issueId('gross-profit', scope, [revenue.id,cost.id,reported.id]),
    kind:'calculation_error',
    title:'毛利计算错误',
    scope,
    originalValue:reportedValue,
    correctedValue:expected,
    unit:reported.unit || revenue.unit || cost.unit || '',
    explanation:`按${revenue.metric} ${revenueValue}${revenue.unit || ''} 减去${cost.metric} ${costValue}${cost.unit || ''}，毛利应为 ${expected}${reported.unit || revenue.unit || ''}。`,
    evidence:evidenceFor([revenue,cost,reported]),
    relatedFactIds:[revenue.id,cost.id,reported.id],
    severity:'high'
  }];
}

function grossMarginIssues(scope, facts) {
  const revenue = findFact(facts, REVENUE_METRICS);
  const cost = findFact(facts, COST_METRICS);
  const reported = findFact(facts, GROSS_MARGIN_METRICS);
  const revenueValue = numeric(revenue);
  const costValue = numeric(cost);
  const reportedValue = numeric(reported);
  if (revenueValue === null || costValue === null || reportedValue === null || revenueValue <= 0 || costValue < 0) return [];
  const expected = round((revenueValue - costValue) / revenueValue * 100, 2);
  if (!materialDifference(reportedValue, expected, 0.05)) return [];
  return [{
    id:issueId('gross-margin', scope, [revenue.id,cost.id,reported.id]),
    kind:'calculation_error',
    title:'毛利率计算错误',
    scope,
    originalValue:reportedValue,
    correctedValue:expected,
    unit:'%',
    explanation:`按${revenue.metric} ${revenueValue}${revenue.unit || ''}、${cost.metric} ${costValue}${cost.unit || ''}重新计算，(${revenueValue} - ${costValue}) ÷ ${revenueValue} = ${expected}%。`,
    evidence:evidenceFor([revenue,cost,reported]),
    relatedFactIds:[revenue.id,cost.id,reported.id],
    severity:'high'
  }];
}

function negativeCostIssues(scope, facts) {
  const cost = findFact(facts, COST_METRICS);
  const value = numeric(cost);
  if (value === null || value >= 0) return [];
  return [{
    id:issueId('negative-cost', scope, [cost.id]),
    kind:'anomaly',
    title:'营业成本出现负数',
    scope,
    originalValue:value,
    unit:cost.unit || '',
    explanation:'营业成本为负数较异常，但可能来自冲销、退回或会计调整，不能直接改成其他数值，请核对来源和公式。',
    evidence:evidenceFor([cost]),
    relatedFactIds:[cost.id],
    severity:'high'
  }];
}

function netProfitIssues(scope, facts) {
  const revenue = findFact(facts, REVENUE_METRICS);
  const profit = findFact(facts, NET_PROFIT_METRICS);
  const revenueValue = numeric(revenue);
  const profitValue = numeric(profit);
  if (revenueValue === null || profitValue === null || revenueValue < 0 || profitValue <= revenueValue) return [];
  return [{
    id:issueId('profit-over-revenue', scope, [revenue.id,profit.id]),
    kind:'anomaly',
    title:'净利润高于营业收入',
    scope,
    originalValue:profitValue,
    unit:profit.unit || revenue.unit || '',
    explanation:'净利润高于营业收入需要核对。它可能来自营业外收益、投资收益或统计口径差异，因此这里只标记异常，不猜测正确净利润。',
    evidence:evidenceFor([revenue,profit]),
    relatedFactIds:[revenue.id,profit.id],
    severity:'high'
  }];
}

function boundedRateIssues(scope, facts) {
  const issues = [];
  for (const metric of ATTENDANCE_METRICS) {
    const fact = findFact(facts, [metric]);
    const value = numeric(fact);
    if (value !== null && (value < 0 || value > 100)) {
      issues.push({
        id:issueId('bounded-rate', scope, [fact.id]),
        kind:'logic_error',
        title:`${metric}超出 0%–100% 范围`,
        scope,
        originalValue:value,
        unit:'%',
        explanation:`${metric}作为比例应在 0% 到 100% 之间，当前填写为 ${value}%，请检查公式或原始记录。`,
        evidence:evidenceFor([fact]),
        relatedFactIds:[fact.id],
        severity:'high'
      });
    }
  }
  for (const metric of TURNOVER_METRICS) {
    const fact = findFact(facts, [metric]);
    const value = numeric(fact);
    if (value !== null && value < 0) {
      issues.push({
        id:issueId('negative-rate', scope, [fact.id]),
        kind:'logic_error',
        title:`${metric}不能为负数`,
        scope,
        originalValue:value,
        unit:'%',
        explanation:`${metric}当前为 ${value}%，负比例不符合该指标定义，请核对公式或原始人数。`,
        evidence:evidenceFor([fact]),
        relatedFactIds:[fact.id],
        severity:'high'
      });
    }
  }
  return issues;
}

function headcountIssues(scope, facts) {
  const fact = findFact(facts, HEADCOUNT_METRICS);
  const value = numeric(fact);
  if (value === null || value >= 0) return [];
  return [{
    id:issueId('negative-headcount', scope, [fact.id]),
    kind:'logic_error',
    title:`${fact.metric}不能为负数`,
    scope,
    originalValue:value,
    unit:fact.unit || '人',
    explanation:`${fact.metric}当前为 ${value}${fact.unit || '人'}，人数不能为负数，请核对公式或数据来源。`,
    evidence:evidenceFor([fact]),
    relatedFactIds:[fact.id],
    severity:'high'
  }];
}

function dateIssues(scope, facts, now) {
  const production = findFact(facts, PRODUCTION_DATE_METRICS);
  const expiry = findFact(facts, EXPIRY_DATE_METRICS);
  const productionDate = parseDate(production?.value);
  const expiryDate = parseDate(expiry?.value);
  const issues = [];

  if (productionDate && expiryDate && expiryDate < productionDate) {
    issues.push({
      id:issueId('expiry-before-production', scope, [production.id,expiry.id]),
      kind:'logic_error',
      title:'失效日期早于生产日期',
      scope,
      originalValue:expiry.value,
      unit:'',
      explanation:`生产日期为 ${production.value}，失效日期为 ${expiry.value}，日期先后关系不成立。这里无法推断正确日期，请核对原表。`,
      evidence:evidenceFor([production,expiry]),
      relatedFactIds:[production.id,expiry.id],
      severity:'high'
    });
  }

  if (productionDate && now instanceof Date && !Number.isNaN(now.getTime())) {
    const oneDay = 24 * 60 * 60 * 1000;
    if (productionDate.getTime() > now.getTime() + oneDay) {
      issues.push({
        id:issueId('future-production', scope, [production.id]),
        kind:'anomaly',
        title:'生产日期在未来',
        scope,
        originalValue:production.value,
        unit:'',
        explanation:`生产日期 ${production.value} 晚于当前日期。如果这不是计划/预测数据，请核对日期；仅凭这张报表不能直接断定正确日期。`,
        evidence:evidenceFor([production]),
        relatedFactIds:[production.id],
        severity:'medium'
      });
    }
  }
  return issues;
}

function isSummaryScope(scope) {
  return /汇总|总计|合计/.test(scope || '');
}

function summaryGrossMarginIssues(facts) {
  const summary = (facts || []).find((fact) => fact.metric === '总毛利率' || (fact.metric === '毛利率' && isSummaryScope(fact.scope)));
  const reported = numeric(summary);
  if (!summary || reported === null) return [];

  const groups = groupByScope((facts || []).filter((fact) => fact.scope !== summary.scope && !isSummaryScope(fact.scope)));
  let revenueTotal = 0;
  let costTotal = 0;
  const related = [];
  for (const scopedFacts of groups.values()) {
    const revenue = findFact(scopedFacts, REVENUE_METRICS);
    const cost = findFact(scopedFacts, COST_METRICS);
    const revenueValue = numeric(revenue);
    const costValue = numeric(cost);
    if (revenueValue === null || costValue === null || revenueValue < 0 || costValue < 0) continue;
    if ((revenue.unit || '') !== (cost.unit || '')) continue;
    revenueTotal += revenueValue;
    costTotal += costValue;
    related.push(revenue, cost);
  }
  if (!related.length || revenueTotal <= 0) return [];
  const expected = round((revenueTotal - costTotal) / revenueTotal * 100, 2);
  if (!materialDifference(reported, expected, 0.05)) return [];
  return [{
    id:issueId('summary-gross-margin', summary.scope, [...related.map((fact) => fact.id), summary.id]),
    kind:'calculation_error',
    title:'总毛利率计算错误',
    scope:summary.scope,
    originalValue:reported,
    correctedValue:expected,
    unit:'%',
    explanation:`总毛利率不能直接累加各部门百分比。按可读取明细的总营收 ${revenueTotal} 与总成本 ${costTotal} 加权重算，应为 ${expected}%。`,
    evidence:[...evidenceFor(related), `${summary.metric}原值：${reported}%`],
    relatedFactIds:[...related.map((fact) => fact.id), summary.id],
    severity:'high'
  }];
}

export function inspectReportFacts(facts, { now = new Date() } = {}) {
  const issues = [];
  const groups = groupByScope(facts);
  for (const [scope, scopedFacts] of groups) {
    issues.push(
      ...grossProfitIssues(scope, scopedFacts),
      ...grossMarginIssues(scope, scopedFacts),
      ...negativeCostIssues(scope, scopedFacts),
      ...netProfitIssues(scope, scopedFacts),
      ...boundedRateIssues(scope, scopedFacts),
      ...headcountIssues(scope, scopedFacts),
      ...dateIssues(scope, scopedFacts, now)
    );
  }
  issues.push(...summaryGrossMarginIssues(facts));
  return issues;
}
