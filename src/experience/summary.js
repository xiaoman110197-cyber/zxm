const FIELD_ALIASES = {
  date:['日期','业务日期','时间','发生时间','创建时间','预约日期','成交日期','date','datetime','time'],
  customer:['客户','客户名','客户姓名','姓名','顾客','患者','customer','client','patient'],
  valid:['有效咨询','是否有效','有效','valid'],
  status:['预约状态','业务状态','订单状态','到店状态','完成状态','状态','status'],
  amount:['营业额','金额','实收','收款金额','成交额','消费金额','收入','revenue','amount','sales'],
  channel:['渠道','来源','客户来源','获客渠道','source','channel'],
  owner:['负责人','销售','顾问','员工','技师','医生','律师','owner','staff','sales'],
  due:['下次跟进','跟进时间','截止时间','任务截止时间','due','due_at','next_followup'],
  taskStatus:['任务状态','跟进状态','待办状态','task_status']
};

export const EXPERIENCE_FIELD_LABELS = Object.freeze({
  date:'日期', customer:'客户', valid:'有效咨询', status:'业务/预约状态', amount:'金额/营业额', channel:'渠道', owner:'负责人', due:'跟进截止时间', taskStatus:'任务状态'
});

function normalize(value){ return String(value ?? '').trim().toLowerCase().replace(/[\s_\-—/\\（）()【】\[\]:：.]/g, ''); }
const NORMALIZED_ALIASES = Object.fromEntries(Object.entries(FIELD_ALIASES).map(([key, values]) => [key, new Set(values.map(normalize))]));
const CANONICAL_FIELDS = new Set(Object.keys(EXPERIENCE_FIELD_LABELS));

function confirmedMapForSheet(headers, sheetName, confirmedMappings){
  const headerSet = new Set(headers);
  const result = {};
  for (const item of Array.isArray(confirmedMappings) ? confirmedMappings : []) {
    if (!item || item.sheet !== sheetName || !CANONICAL_FIELDS.has(item.field) || !headerSet.has(item.header)) continue;
    if (result[item.field] === undefined) result[item.field] = item.header;
  }
  return result;
}

function mapHeaders(headers = [], confirmedMappings = [], sheetName = ''){
  const map = {};
  for (const header of headers) {
    const normalized = normalize(header);
    for (const [key, aliases] of Object.entries(NORMALIZED_ALIASES)) {
      if (map[key] === undefined && aliases.has(normalized)) map[key] = header;
    }
  }
  const confirmed = confirmedMapForSheet(headers, sheetName, confirmedMappings);
  for (const [key, header] of Object.entries(confirmed)) {
    if (map[key] === undefined) map[key] = header;
  }
  return map;
}

function toNumber(value){
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[,，￥¥元\s]/g, '').replace(/\(([^)]+)\)/, '-$1');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function dateKey(value){
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth()+1).padStart(2,'0')}-${String(value.getUTCDate()).padStart(2,'0')}`;
  }
  const text = String(value ?? '').trim();
  const match = text.match(/(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth()+1).padStart(2,'0')}-${String(parsed.getUTCDate()).padStart(2,'0')}`;
}

function toTime(value){
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function truthy(value){ return ['是','有效','true','1','yes','y'].includes(normalize(value)); }
function taskDone(value){ const text = normalize(value); return ['已完成','完成','done','closed','已处理','已结案'].some((item) => text.includes(normalize(item))); }

function stage(value){
  const text = normalize(value);
  if (!text) return 'unknown';
  if (/未到店|未到诊|爽约|noshow/.test(text)) return 'no_show';
  if (/取消|cancel/.test(text)) return 'cancelled';
  if (/已成交|成交|已完成|完成|paid|completed|done/.test(text)) return 'completed';
  if (/已到店|到店|已到诊|到诊|checkedin|arrived/.test(text)) return 'arrived';
  if (/已预约|预约|booked|confirmed/.test(text)) return 'booked';
  if (/咨询|inquiry|lead/.test(text)) return 'inquiry';
  return 'other';
}

function statusCounts(rows, map){
  if (!map.status) return { appointments:null, arrivals:null, completed:null, noShows:null, cancelled:null };
  let appointments=0, arrivals=0, completed=0, noShows=0, cancelled=0;
  for (const row of rows) {
    const value = stage(row[map.status]);
    if (['booked','arrived','completed','no_show','cancelled'].includes(value)) appointments += 1;
    if (['arrived','completed'].includes(value)) arrivals += 1;
    if (value === 'completed') completed += 1;
    if (value === 'no_show') noShows += 1;
    if (value === 'cancelled') cancelled += 1;
  }
  return { appointments, arrivals, completed, noShows, cancelled };
}

function pickSheet(workbook, confirmedMappings){
  const candidates = (workbook?.sheets || []).map((sheet) => {
    const map = mapHeaders(sheet.headers || [], confirmedMappings, sheet.name);
    const matched = Object.keys(map).length;
    const businessMatched = ['date','customer','status','amount','channel','owner','due','taskStatus'].filter((key) => map[key]).length;
    return { sheet, map, matched, businessMatched, score:businessMatched*1000 + matched*100 + (sheet.rows?.length || 0) };
  }).filter((item) => item.businessMatched >= 2 || item.matched >= 3);
  candidates.sort((a,b) => b.score-a.score);
  return candidates[0] || null;
}

function channelGroups(rows, map){
  if (!map.channel) return null;
  const groups = new Map();
  for (const row of rows) {
    const channel = String(row[map.channel] ?? '未填写').trim() || '未填写';
    const item = groups.get(channel) || { channel, records:0, revenue:0 };
    item.records += 1;
    const amount = map.amount ? toNumber(row[map.amount]) : null;
    if (amount !== null) item.revenue += amount;
    groups.set(channel, item);
  }
  return [...groups.values()].sort((a,b) => b.records-a.records || b.revenue-a.revenue).slice(0,8);
}

function overdueOwners(rows, map, cutoff){
  if (!map.owner || !map.due) return null;
  const groups = new Map();
  for (const row of rows) {
    const due = toTime(row[map.due]);
    if (due === null || due > cutoff || taskDone(map.taskStatus ? row[map.taskStatus] : '')) continue;
    const owner = String(row[map.owner] ?? '未填写').trim() || '未填写';
    groups.set(owner, (groups.get(owner) || 0) + 1);
  }
  return [...groups.entries()].map(([owner, overdue]) => ({ owner, overdue })).sort((a,b) => b.overdue-a.overdue).slice(0,8);
}

export function summarizeWorkbook(workbook, { now=new Date(), confirmedMappings=[] } = {}){
  const selected = pickSheet(workbook, confirmedMappings);
  if (!selected) {
    return { ok:false, reason:'没有识别到足够的业务字段', metrics:{}, fields:{}, missing:Object.values(EXPERIENCE_FIELD_LABELS), warnings:['请至少提供日期、客户、状态、金额、渠道、负责人等字段中的两类。'] };
  }

  const { sheet, map } = selected;
  const allRows = sheet.rows || [];
  const dateKeys = map.date ? allRows.map((row) => dateKey(row[map.date])).filter(Boolean) : [];
  const latestDate = dateKeys.length ? [...dateKeys].sort().at(-1) : null;
  const rows = latestDate ? allRows.filter((row) => dateKey(row[map.date]) === latestDate) : allRows;
  const status = statusCounts(rows, map);
  const revenue = map.amount ? rows.reduce((sum,row) => sum + (toNumber(row[map.amount]) ?? 0), 0) : null;
  const validInquiries = map.valid ? rows.filter((row) => truthy(row[map.valid])).length : null;

  let cutoff = now.getTime();
  if (latestDate) cutoff = new Date(`${latestDate}T23:59:59.999Z`).getTime();
  const overdue = map.due ? rows.filter((row) => {
    const due = toTime(row[map.due]);
    return due !== null && due <= cutoff && !taskDone(map.taskStatus ? row[map.taskStatus] : '');
  }).length : null;

  const present = Object.keys(EXPERIENCE_FIELD_LABELS).filter((key) => map[key]);
  const missing = Object.keys(EXPERIENCE_FIELD_LABELS).filter((key) => !map[key]).map((key) => EXPERIENCE_FIELD_LABELS[key]);
  const warnings = [];
  if (!latestDate) warnings.push('未识别到可用日期，本次按主明细表整份数据汇总。');
  if ((workbook?.sheets || []).length > 1) warnings.push(`当前选择“${sheet.name}”作为主明细表，未自动跨表合并，避免重复统计。`);
  if (!map.status) warnings.push('缺少状态列，无法计算预约、到店、完成和爽约。');
  if (!map.amount) warnings.push('缺少金额列，无法计算营业额。');

  return {
    ok:true,
    usedSheet:sheet.name,
    period:latestDate || 'all',
    recordCount:rows.length,
    fields:map,
    fieldCoverage:Math.round(present.length / Object.keys(EXPERIENCE_FIELD_LABELS).length * 100),
    missing,
    warnings,
    metrics:{ records:rows.length, validInquiries, ...status, revenue, overdue },
    channels:channelGroups(rows, map),
    overdueOwners:overdueOwners(rows, map, cutoff)
  };
}

function finiteNumber(value){
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function percentage(numerator, denominator){
  const n = finiteNumber(numerator);
  const d = finiteNumber(denominator);
  if (n === null || d === null || d <= 0) return null;
  return Math.round((n / d) * 1000) / 10;
}

function safeList(value, mapper){
  return Array.isArray(value) ? value.slice(0, 8).map(mapper).filter(Boolean) : [];
}

export function buildBusinessQuestionContext(summary, { source={} } = {}){
  if (!summary?.ok) {
    return {
      available:false,
      reason:String(summary?.reason || '当前没有可靠经营汇总').slice(0,240),
      source:{ fileName:String(source?.fileName || '').slice(0,180) },
      period:summary?.period || null,
      facts:{},
      derived:{},
      channels:[],
      overdueOwners:[],
      missing:Array.isArray(summary?.missing) ? summary.missing.slice(0,16).map(String) : [],
      warnings:Array.isArray(summary?.warnings) ? summary.warnings.slice(0,12).map(String) : [],
      availability:{ revenue:false, profit:false, channels:false, ownerOverdue:false },
      unavailable:['可靠经营汇总','利润/毛利']
    };
  }

  const metrics = summary.metrics || {};
  const facts = {
    records:finiteNumber(metrics.records),
    validInquiries:finiteNumber(metrics.validInquiries),
    appointments:finiteNumber(metrics.appointments),
    arrivals:finiteNumber(metrics.arrivals),
    completed:finiteNumber(metrics.completed),
    noShows:finiteNumber(metrics.noShows),
    cancelled:finiteNumber(metrics.cancelled),
    revenue:finiteNumber(metrics.revenue),
    overdue:finiteNumber(metrics.overdue),
    profit:finiteNumber(metrics.profit),
    grossProfit:finiteNumber(metrics.grossProfit)
  };

  const derived = {
    arrivalRate:percentage(facts.arrivals, facts.appointments),
    completionRate:percentage(facts.completed, facts.appointments),
    noShowRate:percentage(facts.noShows, facts.appointments),
    averageRevenuePerCompleted:facts.revenue !== null && facts.completed !== null && facts.completed > 0
      ? Math.round((facts.revenue / facts.completed) * 100) / 100
      : null
  };

  const channels = safeList(summary.channels, (item) => {
    if (!item) return null;
    const channel = String(item.channel ?? '').trim().slice(0,80);
    if (!channel) return null;
    return { channel, records:finiteNumber(item.records), revenue:finiteNumber(item.revenue) };
  });
  const overdueOwners = safeList(summary.overdueOwners, (item) => {
    if (!item) return null;
    const owner = String(item.owner ?? '').trim().slice(0,80);
    if (!owner) return null;
    return { owner, overdue:finiteNumber(item.overdue) };
  });

  const profitAvailable = facts.profit !== null || facts.grossProfit !== null;
  const unavailable = [];
  if (facts.revenue === null) unavailable.push('营业额');
  if (facts.appointments === null) unavailable.push('预约/业务阶段');
  if (facts.overdue === null) unavailable.push('逾期任务');
  if (!channels.length) unavailable.push('渠道表现');
  if (!overdueOwners.length) unavailable.push('负责人逾期分布');
  if (!profitAvailable) unavailable.push('利润/毛利');

  return {
    available:true,
    source:{
      fileName:String(source?.fileName || '').slice(0,180),
      usedSheet:String(summary.usedSheet || '').slice(0,120)
    },
    period:summary.period || 'all',
    fieldCoverage:Number.isFinite(summary.fieldCoverage) ? Math.max(0, Math.min(100, Math.round(summary.fieldCoverage))) : null,
    facts,
    derived,
    channels,
    overdueOwners,
    missing:Array.isArray(summary.missing) ? summary.missing.slice(0,16).map((item) => String(item).slice(0,120)) : [],
    warnings:Array.isArray(summary.warnings) ? summary.warnings.slice(0,12).map((item) => String(item).slice(0,240)) : [],
    availability:{
      revenue:facts.revenue !== null,
      profit:profitAvailable,
      channels:channels.length > 0,
      ownerOverdue:overdueOwners.length > 0
    },
    unavailable
  };
}
