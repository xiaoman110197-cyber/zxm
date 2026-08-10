import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');

test('upload area explains processing scope and discourages unrelated sensitive data', () => {
  assert.match(html, /原文件.*本地草稿|本地草稿.*原文件/);
  assert.match(html, /提取.*经营.*内容.*诊断|诊断.*提取.*经营.*内容/);
  assert.match(html, /身份证|银行卡|敏感/);
});
