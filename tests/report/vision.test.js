import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReportImage } from '../../src/report/vision.js';

test('sends the original image to a vision-capable Responses API and returns bounded facts', async () => {
  let requestBody;
  const fetchImpl = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok:true,
      json:async () => ({ output_text:JSON.stringify({
        facts:[
          { id:'f1', scope:'华南大区', metric:'营收', value:9800, unit:'万元', sourceText:'营收 9,800', confidence:0.98 },
          { id:'f2', scope:'华南大区', metric:'营业成本', value:6100, unit:'万元', sourceText:'成本 6,100', confidence:0.97 },
          { id:'f3', scope:'华南大区', metric:'毛利率', value:85, unit:'%', sourceText:'毛利率 85.00%', confidence:0.99 }
        ],
        candidates:[]
      }) })
    };
  };

  const result = await analyzeReportImage({
    name:'report.png',
    buffer:Buffer.from('fake-image'),
    mimeType:'image/png',
    ocrText:'营收 9800 成本 6100 毛利率 85%'
  }, { apiKey:'test-key', model:'gpt-5-mini', fetchImpl });

  assert.equal(result.available, true);
  assert.equal(result.facts[0].scope, '华南大区');
  assert.equal(requestBody.input[0].content.some((item) => item.type === 'input_image'), true);
  assert.match(requestBody.input[0].content.find((item) => item.type === 'input_image').image_url, /^data:image\/png;base64,/);
});

test('returns an explicit non-fatal fallback when no vision key exists', async () => {
  const result = await analyzeReportImage({ name:'report.png', buffer:Buffer.from('x'), mimeType:'image/png', ocrText:'' }, { apiKey:'' });
  assert.deepEqual(result, {
    available:false,
    provider:null,
    model:null,
    facts:[],
    candidates:[],
    warning:'视觉分析暂不可用，已使用文字识别继续检查'
  });
});

test('surfaces a safe diagnostic code when the vision API returns an HTTP error', async () => {
  const logged = [];
  const fetchImpl = async () => ({ ok:false, status:401, json:async () => ({}) });
  const result = await analyzeReportImage(
    { name:'report.png', buffer:Buffer.from('x'), mimeType:'image/png', ocrText:'' },
    { apiKey:'bad-key', fetchImpl, logWarn:(...args) => logged.push(args) }
  );

  assert.equal(result.available, false);
  assert.equal(result.failureCode, 'VISION_HTTP_401');
  assert.match(result.warning, /VISION_HTTP_401/);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].includes('bad-key'), false);
});

test('drops malformed model facts and never accepts a model supplied corrected value', async () => {
  const fetchImpl = async () => ({
    ok:true,
    json:async () => ({ output_text:JSON.stringify({
      facts:[
        { id:'ok', scope:'华南大区', metric:'营收', value:9800, unit:'万元', sourceText:'营收 9800', confidence:3, correctedValue:123 },
        { id:'bad', scope:'', metric:'', value:1 }
      ],
      candidates:[{ title:'毛利率算错', scope:'华南大区', kind:'calculation_error', explanation:'模型猜的', correctedValue:37.76, relatedFactIds:['ok'] }]
    }) })
  });
  const result = await analyzeReportImage({ name:'r.png', buffer:Buffer.from('x'), mimeType:'image/png', ocrText:'' }, { apiKey:'k', fetchImpl });
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].confidence, 1);
  assert.equal('correctedValue' in result.facts[0], false);
  assert.equal('correctedValue' in result.candidates[0], false);
});
