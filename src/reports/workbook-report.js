import * as XLSX from 'xlsx';

const ANALYSIS_SHEETS = ['诊断总览','错误清单','异常清单','关键指标','修正记录','经营建议'];

function cloneWorkbook(workbook) {
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return XLSX.read(buffer, { type: 'buffer' });
}

function appendJsonSheet(workbook, name, rows, headers) {
  const safeRows = rows.length ? rows : [Object.fromEntries(headers.map(h => [h, '']))];
  const sheet = XLSX.utils.json_to_sheet(safeRows, { header: headers });
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

export function buildReportWorkbook({ workbook, audit = {}, findings = [] } = {}) {
  if (!workbook?.SheetNames || !workbook?.Sheets) throw new TypeError('workbook is required');
  const out = cloneWorkbook(workbook);
  for (const name of ANALYSIS_SHEETS) {
    if (out.SheetNames.includes(name)) {
      delete out.Sheets[name];
      out.SheetNames = out.SheetNames.filter(n => n !== name);
    }
  }

  const errors = Array.isArray(audit.errors) ? audit.errors : [];
  const anomalies = Array.isArray(audit.anomalies) ? audit.anomalies : [];
  const metrics = audit.metrics && typeof audit.metrics === 'object' ? audit.metrics : {};
  const safeFindings = Array.isArray(findings) ? findings : [];

  const summary = [{
    数据错误数: errors.length,
    程序识别异常数: anomalies.length,
    经营问题数: safeFindings.length,
    P0: safeFindings.filter(f => f.priority === 'P0').length,
    P1: safeFindings.filter(f => f.priority === 'P1').length,
    P2: safeFindings.filter(f => f.priority === 'P2').length
  }];
  appendJsonSheet(out, '诊断总览', summary, ['数据错误数','程序识别异常数','经营问题数','P0','P1','P2']);

  appendJsonSheet(out, '错误清单', errors.map(e => ({
    类型: e.type ?? '', Sheet: e.sheet ?? '', 字段: e.field ?? '', 原值: e.originalValue ?? '', 原因: e.reason ?? '', 置信度: e.confidence ?? ''
  })), ['类型','Sheet','字段','原值','原因','置信度']);

  appendJsonSheet(out, '异常清单', anomalies.map(a => ({
    类型: a.type ?? '', Sheet: a.sheet ?? '', 指标: a.metric ?? a.field ?? '', 说明: a.reason ?? a.message ?? '', 置信度: a.confidence ?? ''
  })), ['类型','Sheet','指标','说明','置信度']);

  appendJsonSheet(out, '关键指标', Object.entries(metrics).map(([key, value]) => ({ 指标: key, 数值: value })), ['指标','数值']);

  appendJsonSheet(out, '修正记录', errors.map(e => ({
    Sheet: e.sheet ?? '', 字段: e.field ?? '', 原值: e.originalValue ?? '',
    建议值: e.suggestedValue === undefined || e.suggestedValue === null ? '待确认' : e.suggestedValue,
    原因: e.reason ?? '', 置信度: e.confidence ?? ''
  })), ['Sheet','字段','原值','建议值','原因','置信度']);

  appendJsonSheet(out, '经营建议', safeFindings.map(f => ({
    优先级: f.priority ?? '', 结论等级: f.status ?? '', 证据: Array.isArray(f.evidence) ? f.evidence.join('；') : (f.evidence ?? ''),
    置信度: f.confidence ?? '', 行动: f.action ?? '', 验证指标: f.metric ?? ''
  })), ['优先级','结论等级','证据','置信度','行动','验证指标']);

  return XLSX.write(out, { type: 'buffer', bookType: 'xlsx' });
}
