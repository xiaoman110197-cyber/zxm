import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { handleDiagnosisRequest } from '../../api/diagnosis.js';

function mockRes() {
  return { statusCode:200, body:null, status(code){ this.statusCode = code; return this; }, json(value){ this.body = value; return this; } };
}

const diagnosis = { id:'deepseek-only', answers:{ problem:'利润下降' }, evidence:[], findings:[], documents:[] };
const FORBIDDEN = /api\.openai\.com|OPENAI_API_KEY|OPENAI_VISION_MODEL|OPENAI_MODEL|createOpenAIProvider|analyzeReportImage/;

async function sourceFiles(relativeDir) {
  const root = new URL(relativeDir, import.meta.url);
  const entries = await readdir(root, { withFileTypes:true });
  const files = [];
  for (const entry of entries) {
    const url = new URL(entry.name, root.href.endsWith('/') ? root : new URL(`${root.href}/`));
    if (entry.isDirectory()) files.push(...await sourceFiles(`${relativeDir}${entry.name}/`));
    else if (/\.(?:js|html|css|md)$/.test(entry.name)) files.push(url);
  }
  return files;
}

test('all production runtime sources have no OpenAI dependency', async () => {
  const files = [
    ...await sourceFiles('../../api/'),
    ...await sourceFiles('../../src/'),
    ...await sourceFiles('../../public/'),
    new URL('../../README.md', import.meta.url)
  ];
  for (const url of files) {
    const text = await readFile(url, 'utf8');
    assert.doesNotMatch(text, FORBIDDEN, url.pathname);
  }
});

test('same DeepSeek provider performs a separate review pass', async () => {
  let diagnoseCalls = 0;
  let reviewCalls = 0;
  const provider = {
    name:'deepseek',
    diagnose:async () => {
      diagnoseCalls += 1;
      return { mode:'finding', question:null, findings:[{
        title:'毛利异常', status:'confirmed', priority:'P1', evidence:['程序复算'], confidence:0.9,
        impact:'利润判断失真', action:'核对数据', metric:'毛利率'
      }] };
    },
    review:async () => {
      reviewCalls += 1;
      return { reviews:[{ title:'毛利异常', verdict:'agree', reason:'证据一致', missingEvidence:[] }] };
    }
  };
  const res = mockRes();
  await handleDiagnosisRequest({ method:'POST', body:{ diagnosis } }, res, {
    primaryProvider:provider,
    reviewerProvider:provider,
    disableBurstGuard:true
  });
  assert.equal(res.statusCode, 200);
  assert.equal(diagnoseCalls, 1);
  assert.equal(reviewCalls, 1);
  assert.equal(res.body.findings[0].crossModelStatus, 'consistent');
});
