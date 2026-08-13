import * as XLSX from 'xlsx';

const MAX_SHEETS = 30;
const MAX_ROWS_PER_SHEET = 50_000;
const MAX_COLUMNS_PER_SHEET = 200;
const MAX_RANGE_CELLS = 250_000;

function enforceWorkbookLimits(source) {
  if (source.SheetNames.length > MAX_SHEETS) throw new RangeError('工作表数量超过 30 个上限');
  let rangeCells = 0;
  for (const name of source.SheetNames) {
    const ref = source.Sheets[name]?.['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const rows = range.e.r - range.s.r + 1;
    const columns = range.e.c - range.s.c + 1;
    const dataRows = Math.max(0, rows - 1);
    if (dataRows > MAX_ROWS_PER_SHEET) throw new RangeError(`工作表 ${name} 超过 50000 行上限`);
    if (columns > MAX_COLUMNS_PER_SHEET) throw new RangeError(`工作表 ${name} 超过 200 列上限`);
    rangeCells += rows * columns;
    if (rangeCells > MAX_RANGE_CELLS) throw new RangeError('工作簿单元格范围超过 250000 上限');
  }
}

export function parseWorkbook(buffer) {
  if (!buffer || !(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array)) {
    throw new TypeError('workbook buffer is required');
  }

  const source = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  enforceWorkbookLimits(source);
  const sheets = source.SheetNames.map((name) => {
    const sheet = source.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
    const headers = rows.length ? [...new Set(rows.flatMap((row) => Object.keys(row)))] : [];
    return { name, headers, rows };
  });

  return { sheets, relations: [] };
}
