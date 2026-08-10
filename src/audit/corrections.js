const EPSILON = 0.001;

function numberFromToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  const multiplier = raw.includes('万') ? 10000 : raw.includes('千') ? 1000 : 1;
  const numeric = Number(raw.replace(/[,%％￥¥元万千\s]/g, ''));
  return Number.isFinite(numeric) ? numeric * multiplier : null;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function materiallyDifferent(actual, expected, absoluteTolerance = 0.01) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  const tolerance = Math.max(absoluteTolerance, Math.abs(expected) * EPSILON);
  return Math.abs(actual - expected) > tolerance;
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMetric(text, aliases, { percent = false } = {}) {
  const source = String(text || '');
  const sortedAliases = [...aliases].sort((a, b) => b.length - a.length);
  for (const alias of sortedAliases) {
    const pattern = new RegExp(`(?:^|\\n)\\s*${regexEscape(alias)}\\s*(?:[:：]\\s*|\\s+)([￥¥]?\\s*-?[\\d,]+(?:\\.\\d+)?\\s*(?:万|千)?\\s*${percent ? '[%％]?' : ''})`, 'm');
    const match = source.match(pattern);
    if (!match) continue;
    const token = String(match[1] || '').trim();
    const value = numberFromToken(token);
    if (value === null) continue;
    return { label:alias, token, value, rawLine:match[0].trim() };
  }
  return null;
}

function normalizeComparable(value) {
  return String(value || '').replace(/[\s,，:：￥¥元%％万千]/g, '').toLowerCase();
}

function metricIsUncertain(metric, segments) {
  if (!metric) return false;
  const token = normalizeComparable(metric.token);
  const label = normalizeComparable(metric.label);
  return (segments || []).some((segment) => {
    const text = normalizeComparable(segment?.text);
    const context = normalizeComparable(segment?.context);
    if (token && text && (text.includes(token) || token.includes(text))) return true;
    if (token && context.includes(token) && (!label || context.includes(label))) return true;
    return false;
  });
}

function structuredCorrections(audit) {
  const items = [];
  for (const error of audit?.errors || []) {
    if (error.type !== 'cross_sheet_mismatch' && error.type !== 'cross_sheet_total_mismatch') continue;
    const correctedValue = Number(error.expected ?? error.suggestedValue);
    const originalValue = Number(error.actual ?? error.originalValue);
    if (!Number.isFinite(correctedValue) || !Number.isFinite(originalValue)) continue;
    const metric = error.metric || error.field || '数据';
    const sourceSheet = error.sourceSheet || '明细表';
    const summarySheet = error.summarySheet || error.sheet || '汇总表';
    items.push({
      kind:'calculation_error',
      label:`${metric}合计`,
      originalValue,
      correctedValue,
      explanation:`${summarySheet}中的${metric}与${sourceSheet}逐行合计不一致，重新合计应为 ${correctedValue}。`,
      evidence:[`${sourceSheet}逐行合计：${correctedValue}`, `${summarySheet}原值：${originalValue}`]
    });
  }
  return items;
}

function metricConfirmation(label, metrics, uncertainNames) {
  const named = uncertainNames.join('、');
  return {
    kind:'needs_confirmation',
    label,
    originalValue:metrics[label]?.value,
    explanation:`${named}存在图片识别不确定内容，请先确认原数字，再进行计算订正。`,
    evidence:uncertainNames.map((name) => `${name}：${metrics[name]?.token || '待确认'}`)
  };
}

function imageCorrections(document) {
  if (document?.type !== 'image' || !document.text) return [];
  const segments = Array.isArray(document.uncertainSegments) ? document.uncertainSegments : [];
  const text = document.text;
  const metrics = {
    营业额: extractMetric(text, ['月营业额','营业额','销售额','收入']),
    成本: extractMetric(text, ['总成本','成本']),
    毛利: extractMetric(text, ['毛利']),
    毛利率: extractMetric(text, ['毛利率'], { percent:true }),
    日均订单: extractMetric(text, ['日均订单','日均单量']),
    客单价: extractMetric(text, ['客单价']),
    营业天数: extractMetric(text, ['营业天数','营业日数'])
  };
  const items = [];

  if (metrics.营业额 && metrics.成本 && metrics.毛利) {
    const involved = ['营业额','成本','毛利'];
    const uncertain = involved.filter((name) => metricIsUncertain(metrics[name], segments));
    const expected = round(metrics.营业额.value - metrics.成本.value, 2);
    if (materiallyDifferent(metrics.毛利.value, expected)) {
      if (uncertain.length) items.push(metricConfirmation('毛利', metrics, uncertain));
      else items.push({
        kind:'calculation_error',
        label:'毛利',
        originalValue:metrics.毛利.value,
        correctedValue:expected,
        explanation:`按营业额 ${metrics.营业额.value} 减去成本 ${metrics.成本.value} 计算，毛利应为 ${expected}。`,
        evidence:[`营业额：${metrics.营业额.value}`, `成本：${metrics.成本.value}`]
      });
    }
  }

  if (metrics.营业额 && metrics.成本 && metrics.毛利率 && metrics.营业额.value !== 0) {
    const involved = ['营业额','成本','毛利率'];
    const uncertain = involved.filter((name) => metricIsUncertain(metrics[name], segments));
    const grossProfit = metrics.营业额.value - metrics.成本.value;
    const expected = round(grossProfit / metrics.营业额.value * 100, 2);
    if (materiallyDifferent(metrics.毛利率.value, expected, 0.05)) {
      if (uncertain.length) items.push(metricConfirmation('毛利率', metrics, uncertain));
      else items.push({
        kind:'calculation_error',
        label:'毛利率',
        originalValue:metrics.毛利率.value,
        correctedValue:expected,
        explanation:`营业额 ${metrics.营业额.value}，成本 ${metrics.成本.value}，毛利应为 ${round(grossProfit, 2)}，所以毛利率应为 ${expected}%。`,
        evidence:[`营业额：${metrics.营业额.value}`, `成本：${metrics.成本.value}`, `毛利：${round(grossProfit, 2)}`]
      });
    }
  }

  const explicitMonthlyRevenue = extractMetric(text, ['月营业额']);
  if (explicitMonthlyRevenue && metrics.日均订单 && metrics.客单价 && metrics.营业天数) {
    const monthlyMetric = explicitMonthlyRevenue;
    const reliabilityMetrics = {
      月营业额:monthlyMetric,
      日均订单:metrics.日均订单,
      客单价:metrics.客单价,
      营业天数:metrics.营业天数
    };
    const uncertain = Object.keys(reliabilityMetrics).filter((name) => metricIsUncertain(reliabilityMetrics[name], segments));
    const estimate = round(metrics.日均订单.value * metrics.客单价.value * metrics.营业天数.value, 2);
    if (materiallyDifferent(monthlyMetric.value, estimate)) {
      if (uncertain.length) {
        items.push({
          kind:'needs_confirmation',
          label:'月营业额与订单估算',
          originalValue:monthlyMetric.value,
          explanation:`${uncertain.join('、')}存在图片识别不确定内容，请先确认原数字。`,
          evidence:uncertain.map((name) => `${name}：${reliabilityMetrics[name]?.token || '待确认'}`)
        });
      } else {
        items.push({
          kind:'inconsistency',
          label:'月营业额与订单估算',
          originalValue:monthlyMetric.value,
          explanation:`按日均订单 ${metrics.日均订单.value} × 客单价 ${metrics.客单价.value} × 营业天数 ${metrics.营业天数.value} 估算为 ${estimate}，与月营业额 ${monthlyMetric.value} 不一致。可能存在外卖、团购或统计口径差异，请确认哪组数据更准确。`,
          evidence:[`订单估算：${estimate}`, `月营业额原值：${monthlyMetric.value}`]
        });
      }
    }
  }

  return items;
}

export function detectCalculationCorrections({ workbook, audit, document } = {}) {
  void workbook;
  return [...structuredCorrections(audit), ...imageCorrections(document)];
}
