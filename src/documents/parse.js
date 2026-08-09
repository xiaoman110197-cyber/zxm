import { parseWorkbook } from '../audit/workbook.js';

const SUPPORTED = new Set(['.xlsx','.xls','.csv','.pdf','.docx','.jpg','.jpeg','.png']);

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

function sheetDocument(name, extension, workbook) {
  const type = extension === '.csv' ? 'csv' : 'excel';
  return {
    document: {
      name,
      type,
      structured: true,
      confidence: 1,
      warnings: [],
      sheetNames: workbook.sheets.map((sheet) => sheet.name),
      sheets: workbook.sheets.map((sheet) => ({ name:sheet.name, headers:sheet.headers, rowCount:sheet.rows.length }))
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

async function defaultImageOcr(buffer) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['chi_sim','eng']);
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
  if (!SUPPORTED.has(extension)) throw new Error('不支持的文件格式');
  assertSignature(extension, buffer);

  if (extension === '.xlsx' || extension === '.xls' || extension === '.csv') {
    const workbook = parseWorkbook(buffer);
    if (!workbook.sheets.length) throw new Error('表格文件没有可读取的数据');
    return sheetDocument(name, extension, workbook);
  }

  if (extension === '.pdf') {
    const extractor = deps.pdfTextExtractor || defaultPdfTextExtractor;
    const extracted = await extractor(buffer);
    const warnings = [];
    if (!extracted.text) warnings.push('PDF 未提取到可用文字；扫描件可能需要图片识别');
    return {
      document:{ name, type:'pdf', structured:false, confidence:extracted.text ? 1 : 0, text:extracted.text || '', pageCount:extracted.pageCount ?? null, warnings },
      workbook:null
    };
  }

  if (extension === '.docx') {
    const extractor = deps.docxTextExtractor || defaultDocxTextExtractor;
    const extracted = await extractor(buffer);
    const warnings = [...(extracted.warnings || [])];
    if (!extracted.text) warnings.push('Word 文档未提取到可用文字');
    return {
      document:{ name, type:'docx', structured:false, confidence:extracted.text ? 1 : 0, text:extracted.text || '', warnings },
      workbook:null
    };
  }

  const ocr = deps.imageOcr || defaultImageOcr;
  const extracted = await ocr(buffer);
  const confidence = Number.isFinite(extracted.confidence) ? Math.max(0, Math.min(1, extracted.confidence)) : 0;
  const warnings = [];
  if (confidence < 0.65) warnings.push('图片文字识别置信度较低，请人工确认关键数字');
  if (!extracted.text) warnings.push('图片未识别到可用文字');
  return {
    document:{ name, type:'image', structured:false, confidence, text:extracted.text || '', warnings },
    workbook:null
  };
}

export const supportedBusinessDocumentExtensions = Object.freeze([...SUPPORTED]);
