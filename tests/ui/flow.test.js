import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8');

test('mobile flow starts from free description instead of a fixed questionnaire', () => {
  assert.match(html, /经营情况|经营问题/);
  assert.match(html, /textarea/);
  assert.doesNotMatch(html, /第\s*1\s*题|1\s*\/\s*10/);
  assert.match(js, /\/api\/diagnosis/);
});

test('diagnosis can be resumed, retried, or explicitly restarted', () => {
  assert.match(html, /id="new-diagnosis"/);
  assert.match(html, /id="retry-diagnosis"/);
  assert.match(html, /开始新问诊/);
  assert.match(html, /重试本轮/);
  assert.match(js, /saveSession/);
  assert.match(js, /restoreSession/);
  assert.match(js, /requestDiagnosis/);
  assert.match(js, /pendingDiagnosisRequest/);
  assert.match(js, /错误编号/);
});

test('AI follow-up can explain why the question matters without replacing the question', () => {
  assert.match(js, /为什么问这个/);
  assert.match(css, /bubble-reason/);
  assert.match(js, /question\.reason/);
});

test('business-material upload is optional and exposes five mainstream categories', () => {
  assert.match(html, /上传经营资料/);
  assert.match(html, /type="file"/);
  assert.match(html, /可选|选填/);
  for (const extension of ['.xlsx','.xls','.csv','.pdf','.docx','.jpg','.jpeg','.png']) assert.match(html, new RegExp(extension.replace('.', '\\.')));
  assert.match(js, /\/api\/analyze-file/);
});

test('current Base64 upload transport blocks files above 3 MB before the request', () => {
  assert.match(js, /MAX_FILE_BYTES\s*=\s*3\s*\*\s*1024\s*\*\s*1024/);
  assert.match(js, /file\.size\s*>\s*MAX_FILE_BYTES/);
  assert.match(js, /3\s*MB/);
});

test('file analysis exposes live percent stage elapsed time cancel and retry', () => {
  assert.match(html, /id="file-progress"/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /id="file-progress-percent"/);
  assert.match(html, /id="file-progress-message"/);
  assert.match(html, /id="file-progress-elapsed"/);
  assert.match(html, /id="cancel-file"/);
  assert.match(html, /id="retry-file"/);
  assert.match(js, /analyze-file\?stream=1/);
  assert.match(js, /getReader\(\)/);
  assert.match(js, /AbortController/);
  assert.match(js, /pendingFile/);
  assert.match(css, /progress-track/);
  assert.match(css, /progress-bar/);
});

test('file analysis failure keeps the previous successful business document available', () => {
  assert.match(js, /previousDocument/);
  assert.match(js, /上一次.*资料.*保留|此前.*资料.*保留/);
});

test('file issue display groups repeated errors instead of dumping every code', () => {
  assert.match(js, /summarizeFileIssues/);
  assert.match(js, /Map\(/);
  assert.doesNotMatch(js, /audit\.errors\.map\([^\n]+join/);
});

test('business findings and file errors have separate display regions', () => {
  assert.match(html, /id="findings"/);
  assert.match(html, /id="file-errors"/);
  assert.match(js, /confirmed|probable|hypothesis/);
  assert.match(js, /P0|P1|P2/);
});

test('report UI exposes evidence and a real Excel report API download action', () => {
  assert.match(html, /证据/);
  assert.match(html, /下载.*Excel|Excel.*下载/);
  assert.match(js, /evidence/);
  assert.match(js, /\/api\/report/);
  assert.doesNotMatch(js, /报告生成接口尚未接入/);
});

test('non-Excel uploads do not enable Excel report reconstruction', () => {
  assert.match(js, /document\.type\s*===\s*['"]excel['"]/);
});

test('layout is mobile-first and avoids fixed desktop width', () => {
  assert.match(html, /viewport/);
  assert.match(css, /max-width/);
  assert.match(css, /@media/);
  assert.doesNotMatch(css, /width:\s*1[2-9]\d{2}px/);
});
