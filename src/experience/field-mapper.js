import { EXPERIENCE_FIELD_LABELS } from './summary.js';

const MAX_PROFILE_SHEETS = 6;
const MAX_PROFILE_COLUMNS = 60;
const MAX_PROFILE_ROWS = 200;
const MAX_SUGGESTIONS = 16;
const CANONICAL_FIELDS = new Set(Object.keys(EXPERIENCE_FIELD_LABELS));

function valueKind(value){
  if (value === null || value === undefined || String(value).trim() === '') return 'blank';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return 'date';
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  if (typeof value === 'boolean') return 'boolean';
  const text = String(value).trim();
  if (/^(?:20\d{2})[年\-/.]\d{1,2}[月\-/.]\d{1,2}/.test(text)) return 'date';
  if (/^[￥¥]?\s*-?[\d,.]+\s*(?:元)?$/.test(text)) return 'number';
  return 'text';
}

function columnProfile(rows, header){
  const stats = { nonEmpty:0, blank:0, number:0, date:0, boolean:0, text:0 };
  for (const row of rows.slice(0, MAX_PROFILE_ROWS)) {
    const kind = valueKind(row?.[header]);
    stats[kind] += 1;
    if (kind !== 'blank') stats.nonEmpty += 1;
  }
  return { header:String(header).slice(0, 160), stats };
}

export function buildFieldMappingInput(workbook){
  return {
    canonicalFields:Object.entries(EXPERIENCE_FIELD_LABELS).map(([field, label]) => ({ field, label })),
    sheets:(workbook?.sheets || []).slice(0, MAX_PROFILE_SHEETS).map((sheet) => ({
      name:String(sheet.name || '').slice(0, 160),
      rowCount:Array.isArray(sheet.rows) ? sheet.rows.length : 0,
      columns:(sheet.headers || []).slice(0, MAX_PROFILE_COLUMNS).map((header) => columnProfile(sheet.rows || [], header))
    }))
  };
}

function workbookHeaderIndex(workbook){
  const result = new Map();
  for (const sheet of workbook?.sheets || []) result.set(sheet.name, new Set(sheet.headers || []));
  return result;
}

export function sanitizeMappingSuggestions(raw, workbook){
  const headersBySheet = workbookHeaderIndex(workbook);
  const candidates = [];
  for (const item of Array.isArray(raw?.mappings) ? raw.mappings : []) {
    const sheet = String(item?.sheet || '').trim();
    const header = String(item?.header || '').trim();
    const field = String(item?.field || '').trim();
    if (!headersBySheet.get(sheet)?.has(header) || !CANONICAL_FIELDS.has(field)) continue;
    const confidence = Number(item?.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) continue;
    const reason = String(item?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    candidates.push({ sheet, header, field, label:EXPERIENCE_FIELD_LABELS[field], confidence, reason });
  }
  candidates.sort((a,b) => b.confidence-a.confidence);
  const usedField = new Set();
  const usedHeader = new Set();
  const result = [];
  for (const item of candidates) {
    const fieldKey = `${item.sheet}\u0000${item.field}`;
    const headerKey = `${item.sheet}\u0000${item.header}`;
    if (usedField.has(fieldKey) || usedHeader.has(headerKey)) continue;
    usedField.add(fieldKey);
    usedHeader.add(headerKey);
    result.push(item);
    if (result.length >= MAX_SUGGESTIONS) break;
  }
  return result;
}
