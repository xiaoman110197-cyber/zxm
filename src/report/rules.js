const REVENUE_METRICS = ['营收','营业收入','营业额','销售额'];
const TOTAL_REVENUE_METRICS = ['总营收','总营业收入','总营业额','总销售额'];
const COST_METRICS = ['营业成本','成本'];
const TOTAL_COST_METRICS = ['总营业成本','总成本'];
const GROSS_PROFIT_METRICS = ['毛利'];
const GROSS_MARGIN_METRICS = ['毛利率','销售毛利率'];
const NET_PROFIT_METRICS = ['净利润'];
const HEADCOUNT_METRICS = ['期末人数','人数','员工人数'];
const ATTENDANCE_METRICS = ['出勤率'];
const TURNOVER_METRICS = ['离职率'];
const PRODUCTION_DATE_METRICS = ['生产日期'];
const EXPIRY_DATE_METRICS = ['失效日期','到期日期','有效期至'];

const CURRENCY_SCALES = new Map([
  ['元', 1],
  ['人民币元', 1],
  ['千元', 1_000],
  ['万元', 10_000],
  ['万', 10_000],
  ['亿元', 100_000_000],
  ['亿', 100_000_000]
]);

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

function cleanUnit(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function amountDescriptor(fact) {
  const value = numeric(fact);
  if (value === null) return null;
  const unit = cleanUnit(fact?.unit);
  if (!unit) return { value, base:value, scale:1, family:'unitless', unit:'' };
  const scale = CURRENCY_SCALES.get(unit);
  if (scale) return { value, base:value * scale, scale, family:'currency', unit };
  return { value, base:value, scale:1, family:`literal:${unit}`, unit };
}

function comparableAmounts(...facts) {
  const descriptors = facts.map(amountDescriptor);
  if (descriptors.some((item) => !item)) return null;
  const families = new Set(descriptors.map((item) => item.family));
  if (families.size === 1) return descriptors;
  if ([...families].every((family) => family === 'currency')) return descriptors;
  return null;
}

function convertBaseToDescriptor(baseValue, descriptor) {
  return round(baseValue / descriptor.scale, 2);
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[年/.]/g, '-').replace(/月/g, '-').replace(/日/g, '');
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
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
  const descriptors = comparableAmounts(revenue, cost, reported);
  if (!descriptors) return [];
  const [revenueAmount, costAmount, reportedAmount] = descriptors;
  if (revenueAmount.base < 0 || costAmount.base < 0) return [];
  const expectedBase = revenueAmount.base - costAmount.base;
  if (!materialDifference(reportedAmount.base, expectedBase, Math.max(0.01, Math.abs(expectedBase) * 0.0001))) return [];
  const expected = convertBaseToDescriptor(expectedBase, reportedAmount);
  return [{
    id:issueId('gross-profit', scope, [revenue.id,cost.id,reported.id]),
    kind:'calculation_error',
    title:'毛利计算错误',
    scope,
    originalValue:reportedAmount.value,
    correctedValue:expected,
    unit:reportedAmount.unit,
    explanation:`按${revenue.metric} ${revenue.value}${revenue.unit || ''} 减去${cost.metric} ${cost.value}${cost.unit || ''}，换算到同一金额单位后，毛利应为 ${expected}${reportedAmount.unit || ''}。`,
    evidence:evidenceFor([revenue,cost,reported]),
    relatedFactIds:[revenue.id,cost.id,reported.id],
    severity:'high'
  }];
}

function grossMarginIssues(scope, facts) {
  const revenue = findFact(facts, REVENUE_METRICS);
  const cost = findFact(facts, COST_METRICS);
  const reported = findFact(facts, GROSS_MARGIN_METRICS);
  const amounts = comparableAmounts(revenue, cost);
  const reportedValue = numeric(reported);
  if (!amounts || reportedValue === null) return [];
  const [revenueAmount, costAmount] = amounts;
  if (revenueAmount.base <= 0 || costAmount.base < 0) return [];
  const expected = round((revenueAmount.base - costAmount.base) / revenueAmount.base * 100, 2);
  if (!materialDifference(reportedValue, expected, 0.05)) return [];
  return [{
    id:issueId('gross-margin', scope, [revenue.id,cost.id,reported.id]),
    kind:'calculation_error',
    title:'毛利率计算错误',
    scope,
    originalValue:reportedValue,
    correctedValue:expected,
    unit:'%',
    explanation:`按${revenue.metric} ${revenue.value}${revenue.unit || ''}、${cost.metric} ${cost.value}${cost.unit || ''}换算到同一金额单位后重新计算，毛利率应为 ${expected}%。`,
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
  const amounts = comparableAmounts(revenue, profit);
  if (!amounts) return [];
  const [revenueAmount, profitAmount] = amounts;
  if (revenueAmount.base < 0 || profitAmount.base <= revenueAmount.base) return [];
  return [{
    id:issueId('profit-over-revenue', scope, [revenue.id,profit.id]),
    kind:'anomaly',
    title:'净利润高于营业收入',
    scope,
    originalValue:profit.value,
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

  const summaryFacts = (facts || []).filter((fact) => fact.scope === summary.scope);
  const totalRevenue = findFact(summaryFacts, [...TOTAL_REVENUE_METRICS, ...REVENUE_METRICS]);
  const totalCost = findFact(summaryFacts, [...TOTAL_COST_METRICS, ...COST_METRICS]);
  const totalAmounts = comparableAmounts(totalRevenue, totalCost);
  if (totalAmounts) {
    const [revenueAmount, costAmount] = totalAmounts;
    if (revenueAmount.base > 0 && costAmount.base >= 0) {
      const expected = round((revenueAmount.base - costAmount.base) / revenueAmount.base * 100, 2);
      if (materialDifference(reported, expected, 0.05)) {
        return [{
          id:issueId('summary-gross-margin', summary.scope, [totalRevenue.id,totalCost.id,summary.id]),
          kind:'calculation_error',
          title:'总毛利率计算错误',
          scope:summary.scope,
          originalValue:reported,
          correctedValue:expected,
          unit:'%',
          explanation:`报表同时给出了${totalRevenue.metric} ${totalRevenue.value}${totalRevenue.unit || ''} 和${totalCost.metric} ${totalCost.value}${totalCost.unit || ''}，换算到同一金额单位后可直接复算，总毛利率应为 ${expected}%。`,
          evidence:evidenceFor([totalRevenue,totalCost,summary]),
          relatedFactIds:[totalRevenue.id,totalCost.id,summary.id],
          severity:'high'
        }];
      }
      return [];
    }
  }

  const detailMargins = (facts || []).filter((fact) => !isSummaryScope(fact.scope) && GROSS_MARGIN_METRICS.includes(fact.metric) && numeric(fact) !== null);
  if (detailMargins.length >= 2) {
    const directSum = round(detailMargins.reduce((sum, fact) => sum + numeric(fact), 0), 2);
    if (!materialDifference(reported, directSum, 0.05)) {
      return [{
        id:issueId('summary-margin-direct-sum', summary.scope, [...detailMargins.map((fact) => fact.id), summary.id]),
        kind:'logic_error',
        title:'总毛利率计算方式错误',
        scope:summary.scope,
        originalValue:reported,
        unit:'%',
        explanation:`总毛利率 ${reported}% 与可见部门毛利率 ${detailMargins.map((fact) => `${fact.value}%`).join(' + ')} 的直接相加结果 ${directSum}% 一致。毛利率属于比例，不能直接相加；应使用完整汇总营收和汇总成本加权计算。当前缺少可证明完整性的汇总金额，因此不编造正确总毛利率。`,
        evidence:[...evidenceFor(detailMargins), `${summary.metric}：${reported}%`],
        relatedFactIds:[...detailMargins.map((fact) => fact.id), summary.id],
        severity:'high'
      }];
    }
  }

  if (reported < 0 || reported > 100) {
    return [{
      id:issueId('summary-margin-anomaly', summary.scope, [summary.id]),
      kind:'anomaly',
      title:'总毛利率异常',
      scope:summary.scope,
      originalValue:reported,
      unit:'%',
      explanation:`总毛利率填写为 ${reported}%，明显需要核对。当前没有可验证的完整汇总营收和汇总成本，因此无法证明正确总毛利率，也不会根据部分明细猜一个答案。`,
      evidence:evidenceFor([summary]),
      relatedFactIds:[summary.id],
      severity:'high'
    }];
  }
  return [];
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
