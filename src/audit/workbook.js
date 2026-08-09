import * as XLSX from 'xlsx';

export function parseWorkbook(buffer) {
  if (!buffer || !(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array)) {
    throw new TypeError('workbook buffer is required');
  }

  const source = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheets = source.SheetNames.map((name) => {
    const sheet = source.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
    const headers = rows.length ? [...new Set(rows.flatMap((row) => Object.keys(row)))] : [];
    return { name, headers, rows };
  });

  return { sheets, relations: [] };
}
