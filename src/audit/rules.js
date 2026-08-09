function rowSignature(row) {
  return JSON.stringify(Object.keys(row).sort().map((key) => [key, row[key]]));
}

function findSheet(workbook, nameIncludes) {
  return workbook.sheets.find((sheet) => nameIncludes.some((token) => sheet.name.includes(token)));
}

function numericSum(rows, field) {
  return rows.reduce((sum, row) => {
    const value = row[field];
    return typeof value === 'number' && Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

const CRITICAL_FIELDS = new Set([
  '日期','时间','订单号','订单编号','营业额','销售额','实收','收入','成本','金额','数量','销量','客单价','指标','数值'
]);

function isBlank(value) {
  return value === null || value === undefined || value === '';
}

function isMaterialRow(row) {
  return Object.values(row).some((value) => !isBlank(value));
}

export function auditWorkbook(workbook) {
  if (!workbook || !Array.isArray(workbook.sheets)) throw new TypeError('parsed workbook is required');

  const errors = [];
  const anomalies = [];
  const metrics = {};

  for (const sheet of workbook.sheets) {
    const seen = new Map();
    sheet.rows.forEach((row, index) => {
      if (!isMaterialRow(row)) return;
      const rowNumber = index + 2;
      const signature = rowSignature(row);
      if (seen.has(signature)) errors.push({ type:'duplicate_record', sheet:sheet.name, row:rowNumber, duplicateOf:seen.get(signature) });
      else seen.set(signature, rowNumber);

      for (const field of sheet.headers.filter((header) => CRITICAL_FIELDS.has(String(header).trim()))) {
        if (isBlank(row[field])) errors.push({ type:'missing_value', sheet:sheet.name, row:rowNumber, field });
      }
    });
  }

  const orders = findSheet(workbook, ['订单', '销售']);
  if (orders?.headers.includes('营业额')) metrics.revenue = numericSum(orders.rows, '营业额');
  const costs = findSheet(workbook, ['成本']);
  if (costs?.headers.includes('成本')) metrics.cost = numericSum(costs.rows, '成本');

  const summary = findSheet(workbook, ['汇总', '总览']);
  if (orders && summary && Number.isFinite(metrics.revenue)) {
    const summaryRevenueRow = summary.rows.find((row) => row['指标'] === '营业额');
    const summaryRevenue = summaryRevenueRow?.['数值'];
    if (typeof summaryRevenue === 'number' && Number.isFinite(summaryRevenue) && summaryRevenue !== metrics.revenue) {
      errors.push({ type:'cross_sheet_total_mismatch', metric:'营业额', sourceSheet:orders.name, summarySheet:summary.name, expected:metrics.revenue, actual:summaryRevenue });
    }
  }
  return { errors, anomalies, metrics };
}
