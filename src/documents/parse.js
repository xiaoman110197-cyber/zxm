import { parseWorkbook } from '../audit/workbook.js';

const SUPPORTED = new Set(['.xlsx','.xls','.csv','.pdf','.docx','.jpg','.jpeg','.png']);
const MAX_EXTRACTED_TEXT_CHARS = 12000;
const TRUNCATION_MARKER = '\n…[中间内容已截断]…\n';
const TRUNCATION_WARNING = '文档内容过长，当前诊断仅保留开头和结尾部分；关键内容请人工确认或拆分文件上传';
const MAX_PREVIEW_SHEETS = 6;
const MAX_PREVIEW_ROWS_PER_SHEET = 6;
const MAX_PREVIEW_COLUMNS = 12;
const MAX_PREVIEW_CELL_CHARS = 120;
const MAX_STRUCTURED_PREVIEW_CHARS = 8000;
const STRUCTURED_PREVIEW_WARNING = '表格数据较多，AI 诊断上下文仅保留有限样本；完整表格仍用于程序化数据审计';

function extensionOf(name) {
  const lower = String(name || '').toLowerCase();
  const index = lower.lastIndexOf('.');
  return index >= 0 ? lower.slice(index) : '';
}

function startsWith(buffer, bytes) {
  if (!Buffer.isBuffer(buffer) || buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function assertSignature(extension, buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('文件内容为空或损坏');
  if (extension === '.xlsx' || extension === '.docx') {
    if (!startsWith(buffer, [0x50,0x4b,0x03,0x04]) && !startsWith(buffer, [0x50,0x4b,0x05,0x06]) && !startsWith(buffer, [0x50,0x4b,0x07,0x08])) {
      throw new Error('文件格式签名不匹配或文件损坏');
    }
  } else if (extension === '.xls') {
    if (!startsWith(buffer, [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1])) throw new Error('文件格式签名不匹配或文件损坏');
  } else if (extension === '.pdf') {
    if (buffer.subarray(0,5).toString('ascii') !== '%PDF-') throw new Error('文件格式签名不匹配或 PDF 损坏');
  } else if (extension === '.jpg' || extension === '.jpeg') {
    if (!startsWith(buffer, [0xff,0xd8,0xff])) throw new Error('文件格式签名不匹配或图片损坏');
  } else if (extension === '.png') {
    if (!startsWith(buffer, [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) throw new Error('文件格式签名不匹配或图片损坏');
  } else if (extension === '.csv') {
    if (buffer.includes(0x00)) throw new Error('CSV 文件格式异常或损坏');
  }
}

function reportProgress(onProgress, phase, percent, message) {
  if (typeof onProgress !== 'function') return;
  const boundedPercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  onProgress({ phase, percent:boundedPercent, message });
}

function ocrProgressMessage(status = '') {
  const normalized = String(status).toLowerCase();
  if (normalized.includes('loading tesseract core')) return '正在加载文字识别引擎';
  if (normalized.includes('loading language')) return '正在加载中文和英文识别模型';
  if (normalized.includes('initializing')) return '正在初始化文字识别';
  if (normalized.includes('recognizing text')) return '正在识别图片中的文字和数字';
  return '正在处理图片文字';
}

function mapOcrProgress(message = {}) {
  const status = String(message.status || '').toLowerCase();
  const progress = Number.isFinite(message.progress) ? Math.max(0, Math.min(1, message.progress)) : 0;
  if (status.includes('loading tesseract core')) return 30 + progress * 8;
  if (status.includes('loading language')) return 38 + progress * 14;
  if (status.includes('initializing')) return 52 + progress * 6;
  if (status.includes('recognizing text')) return 58 + progress * 27;
  return 30 + progress * 25;
}

function boundExtractedText(value, initialWarnings = []) {
  const text = String(value || '').trim();
  const warnings = [...initialWarnings];
  if (text.length <= MAX_EXTRACTED_TEXT_CHARS) return { text, truncated:false, warnings };

  const available = MAX_EXTRACTED_TEXT_CHARS - TRUNCATION_MARKER.length;
  const headLength = Math.ceil(available / 2);
  const tailLength = Math.floor(available / 2);
  warnings.push(TRUNCATION_WARNING);
  return {
    text: `${text.slice(0, headLength)}${TRUNCATION_MARKER}${text.slice(-tailLength)}`,
    truncated:true,
    warnings
  };
}

function sampleRows(rows) {
  if (rows.length <= MAX_PREVIEW_ROWS_PER_SHEET) return rows;
  const headCount = Math.ceil(MAX_PREVIEW_ROWS_PER_SHEET / 2);
  const tailCount = Math.floor(MAX_PREVIEW_ROWS_PER_SHEET / 2);
  return [...rows.slice(0, headCount), ...rows.slice(-tailCount)];
}

function clipPreviewValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'string') return value;
  if (value.length <= MAX_PREVIEW_CELL_CHARS) return value;
  return `${value.slice(0, MAX_PREVIEW_CELL_CHARS - 1)}…`;
}

function buildStructuredPreview(workbook) {
  const preview = [];
  let remaining = MAX_STRUCTURED_PREVIEW_CHARS;
  let truncated = workbook.sheets.length > MAX_PREVIEW_SHEETS;

  for (const sheet of workbook.sheets.slice(0, MAX_PREVIEW_SHEETS)) {
    const headers = sheet.headers.slice(0, MAX_PREVIEW_COLUMNS);
    if (sheet.headers.length > headers.length || sheet.rows.length > MAX_PREVIEW_ROWS_PER_SHEET) truncated = true;
    const rows = [];

    for (const sourceRow of sampleRows(sheet.rows)) {
      const row = {};
      for (const header of headers) row[header] = clipPreviewValue(sourceRow[header]);
      const estimated = JSON.stringify(row).length;
      if (estimated > remaining) {
        truncated = true;
        break;
      }
      rows.push(row);
      remaining -= estimated;
    }

    preview.push({ name:sheet.name, rows });
    if (remaining <= 0) {
      truncated = true;
      break;
    }
  }

  return { preview, truncated };
}

function sheetDocument(name, extension, workbook) {
  const type = extension === '.csv' ? 'csv' : 'excel';
  const bounded = buildStructuredPreview(workbook);
  return {
    document: {
      name,
      source: { kind:'upload', name },
      type,
      structured: true,
      confidence: 1,
      warnings: bounded.truncated ? [STRUCTURED_PREVIEW_WARNING] : [],
      sheetNames: workbook.sheets.map((sheet) => sheet.name),
      sheets: workbook.sheets.map((sheet) => ({ name:sheet.name, headers:sheet.headers, rowCount:sheet.rows.length })),
      preview: bounded.preview,
      previewTruncated: bounded.truncated
    },
    workbook
  };
}

async function defaultPdfTextExtractor(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return { text:String(result.text || '').trim(), pageCount:result.total ?? result.pages?.length ?? null };
  } finally {
    await parser.destroy();
  }
}

async function defaultDocxTextExtractor(buffer) {
  const mammothModule = await import('mammoth');
  const mammoth = mammothModule.default || mammothModule;
  const result = await mammoth.extractRawText({ buffer });
  return {
    text:String(result.value || '').trim(),
    warnings:(result.messages || []).map((message) => message.message || String(message))
  };
}

async function defaultImageOcr(buffer, reportOcrProgress) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['chi_sim','eng'], 1, {
    logger: (message) => reportOcrProgress?.(message)
  });
  try {
    const result = await worker.recognize(buffer);
    return {
      text:String(result.data?.text || '').trim(),
      confidence:Math.max(0, Math.min(1, Number(result.data?.confidence || 0) / 100))
    };
  } finally {
    await worker.terminate();
  }
}

export async function parseBusinessDocument({ name, buffer }, deps = {}) {
  const extension = extensionOf(name);
  const onProgress = deps.onProgress;
  if (!SUPPORTED.has(extension)) throw new Error('不支持的文件格式');
  reportProgress(onProgress, 'validation', 15, '正在校验文件格式');
  assertSignature(extension, buffer);

  if (extension === '.xlsx' || extension === '.xls' || extension === '.csv') {
    reportProgress(onProgress, 'parsing', 30, '正在读取表格数据');
    const workbook = parseWorkbook(buffer);
    if (!workbook.sheets.length) throw new Error('表格文件没有可读取的数据');
    reportProgress(onProgress, 'parsing', 70, '已读取表格，正在整理字段和数据样本');
    const result = sheetDocument(name, extension, workbook);
    reportProgress(onProgress, 'parsing', 80, '表格内容读取完成');
    return result;
  }

  if (extension === '.pdf') {
    reportProgress(onProgress, 'parsing', 30, '正在读取 PDF 内容');
    const extractor = deps.pdfTextExtractor || defaultPdfTextExtractor;
    const extracted = await extractor(buffer);
    reportProgress(onProgress, 'parsing', 75, '已提取 PDF 文字，正在整理内容');
    const initialWarnings = [];
    if (!extracted.text) initialWarnings.push('PDF 未提取到可用文字；扫描件可能需要图片识别');
    const bounded = boundExtractedText(extracted.text, initialWarnings);
    reportProgress(onProgress, 'parsing', 85, 'PDF 内容读取完成');
    return {
      document:{ name, source:{kind:'upload',name}, type:'pdf', structured:false, confidence:bounded.text ? 1 : 0, text:bounded.text, truncated:bounded.truncated, pageCount:extracted.pageCount ?? null, warnings:bounded.warnings },
      workbook:null
    };
  }

  if (extension === '.docx') {
    reportProgress(onProgress, 'parsing', 30, '正在读取 Word 内容');
    const extractor = deps.docxTextExtractor || defaultDocxTextExtractor;
    const extracted = await extractor(buffer);
    reportProgress(onProgress, 'parsing', 75, '已提取 Word 文字，正在整理内容');
    const initialWarnings = [...(extracted.warnings || [])];
    if (!extracted.text) initialWarnings.push('Word 文档未提取到可用文字');
    const bounded = boundExtractedText(extracted.text, initialWarnings);
    reportProgress(onProgress, 'parsing', 85, 'Word 内容读取完成');
    return {
      document:{ name, source:{kind:'upload',name}, type:'docx', structured:false, confidence:bounded.text ? 1 : 0, text:bounded.text, truncated:bounded.truncated, warnings:bounded.warnings },
      workbook:null
    };
  }

  reportProgress(onProgress, 'ocr', 28, '准备图片文字识别');
  const ocr = deps.imageOcr || defaultImageOcr;
  const extracted = await ocr(buffer, (message) => {
    reportProgress(onProgress, 'ocr', mapOcrProgress(message), ocrProgressMessage(message?.status));
  });
  reportProgress(onProgress, 'ocr', 88, '文字识别完成，正在整理识别结果');
  const confidence = Number.isFinite(extracted.confidence) ? Math.max(0, Math.min(1, extracted.confidence)) : 0;
  const initialWarnings = [];
  if (confidence < 0.65) initialWarnings.push('图片文字识别置信度较低，请人工确认关键数字');
  if (!extracted.text) initialWarnings.push('图片未识别到可用文字');
  const bounded = boundExtractedText(extracted.text, initialWarnings);
  return {
    document:{ name, source:{kind:'upload',name}, type:'image', structured:false, confidence, text:bounded.text, truncated:bounded.truncated, warnings:bounded.warnings },
    workbook:null
  };
}

export const supportedBusinessDocumentExtensions = Object.freeze([...SUPPORTED]);
