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

test('business-material upload is optional and exposes five mainstream categories', () => {
  assert.match(html, /上传经营资料/);
  assert.match(html, /type="file"/);
  assert.match(html, /可选|选填/);
  for (const extension of ['.xlsx','.xls','.csv','.pdf','.docx','.jpg','.jpeg','.png']) assert.match(html, new RegExp(extension.replace('.', '\\.')));
  assert.match(js, /\/api\/analyze-file-stream/);
});

test('upload card explains data use and warns against unnecessary highly sensitive personal data', () => {
  assert.match(html, /经营诊断/);
  assert.match(html, /身份证|银行卡/);
  assert.match(html, /避免|不要/);
});

test('current Base64 upload transport blocks files above 3 MB before the request', () => {
  assert.match(js, /MAX_FILE_BYTES\s*=\s*3\s*\*\s*1024\s*\*\s*1024/);
  assert.match(js, /file\.size\s*>\s*MAX_FILE_BYTES/);
  assert.match(js, /3\s*MB/);
});

test('file analysis exposes percentage, stage and accessible progressbar', () => {
  assert.match(html, /role="progressbar"/);
  assert.match(html, /id="file-progress-percent"/);
  assert.match(html, /id="file-progress-stage"/);
  assert.match(html, /id="file-progress-fill"/);
  assert.match(js, /setFileProgress/);
  assert.match(js, /aria-valuenow/);
  assert.match(css, /file-progress/);
});

test('file upload retries one network interruption and supports manual retry', () => {
  assert.match(html, /id="retry-file"/);
  assert.match(js, /AbortController/);
  assert.match(js, /自动重试（1\/1）/);
  assert.match(js, /重新分析/);
  assert.match(js, /retryFile/);
  assert.match(js, /Load failed|Failed to fetch/);
});

test('file upload ignores stale responses and clears prior file evidence', () => {
  assert.match(js, /fileRequestId/);
  assert.match(js, /requestId\s*!==\s*state\.fileRequestId/);
  assert.match(js, /file_analysis:/);
  assert.match(js, /filter\([^\n]+file_analysis:/);
});

test('diagnosis request has an explicit busy guard and visible pending label', () => {
  assert.match(js, /diagnosisBusy/);
  assert.match(js, /if\s*\(state\.diagnosisBusy\)\s*return/);
  assert.match(js, /正在分析…/);
  assert.match(js, /state\.diagnosisBusy\s*=\s*true/);
  assert.match(js, /state\.diagnosisBusy\s*=\s*false/);
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
