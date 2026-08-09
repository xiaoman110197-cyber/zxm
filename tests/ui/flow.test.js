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
  assert.match(js, /\/api\/analyze-file/);
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
