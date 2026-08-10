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

const CANDIDATE_REQUIRED_FIELDS = new Set([
  '日期','时间','订单号','订单编号','营业额','销售额','实收','收入','成本','金额','数量','销量','客单价','指标','数值'
]);
const CONSISTENT_FILL_RATIO = 0.85;
const MIN_OBSERVED_VALUES = 2;
const PAIRED_FIELDS = [['指标','数值']];

function isBlank(value) {
  return value === null || value === undefined || value === '';
}

function isMaterialRow(row) {
  return Object.values(row).some((value) => !isBlank(value));
}

function inferRequiredFields(sheet, materialRows) {
  const required = new Set();
  if (!materialRows.length) return required;

  for (const rawHeader of sheet.headers) {
    const field = String(rawHeader).trim();
    if (!CANDIDATE_REQUIRED_FIELDS.has(field)) continue;
    const populated = materialRows.reduce((count, row) => count + (isBlank(row[rawHeader]) ? 0 : 1), 0);
    if (populated >= MIN_OBSERVED_VALUES && populated / materialRows.length >= CONSISTENT_FILL_RATIO) {
      required.add(rawHeader);
    }
  }
  return required;
}

function addPairedFieldErrors(errors, sheet, row, rowNumber) {
  for (const [left, right] of PAIRED_FIELDS) {
    if (!sheet.headers.includes(left) || !sheet.headers.includes(right)) continue;
    const leftBlank = isBlank(row[left]);
    const rightBlank = isBlank(row[right]);
    if (leftBlank === rightBlank) continue;
    errors.push({ type:'missing_value', sheet:sheet.name, row:rowNumber, field:leftBlank ? left : right });
  }
}

export function auditWorkbook(workbook) {
  if (!workbook || !Array.isArray(workbook.sheets)) throw new TypeError('parsed workbook is required');

  const errors = [];
  const anomalies = [];
  const metrics = {};

  for (const sheet of workbook.sheets) {
    const seen = new Map();
    const materialRows = sheet.rows.filter(isMaterialRow);
    const requiredFields = inferRequiredFields(sheet, materialRows);

    sheet.rows.forEach((row, index) => {
      if (!isMaterialRow(row)) return;
      const rowNumber = index + 2;
      const signature = rowSignature(row);
      if (seen.has(signature)) errors.push({ type:'duplicate_record', sheet:sheet.name, row:rowNumber, duplicateOf:seen.get(signature) });
      else seen.set(signature, rowNumber);

      for (const field of requiredFields) {
        if (isBlank(row[field])) errors.push({ type:'missing_value', sheet:sheet.name, row:rowNumber, field });
      }
      addPairedFieldErrors(errors, sheet, row, rowNumber);
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
