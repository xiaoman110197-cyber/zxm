import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleDiagnosisRequest } from '../../api/diagnosis.js';

function mockRes() {
  return { statusCode:200, body:null, status(code){ this.statusCode = code; return this; }, json(value){ this.body = value; return this; } };
}

const diagnosis = { id:'deepseek-only', answers:{ problem:'利润下降' }, evidence:[], findings:[], documents:[] };

test('production runtime has no OpenAI dependency', async () => {
  for (const path of ['../../api/analyze-file.js','../../api/diagnosis.js','../../src/ai/providers.js']) {
    const text = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /api\.openai\.com|OPENAI_API_KEY|createOpenAIProvider|analyzeReportImage/, path);
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
    fallbackProvider:null,
    disableBurstGuard:true
  });
  assert.equal(res.statusCode, 200);
  assert.equal(diagnoseCalls, 1);
  assert.equal(reviewCalls, 1);
  assert.equal(res.body.findings[0].crossModelStatus, 'consistent');
});
