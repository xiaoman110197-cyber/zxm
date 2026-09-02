const nativeFetch = window.fetch.bind(window);
let latestMappingSuggestions = [];

const realMetricUnits = {
  realRecords:'条',
  realAppointments:'条',
  realArrivals:'条',
  realCompleted:'笔',
  realOverdue:'项'
};

function ensureFieldMappingTrace(){
  let root = document.getElementById('fieldMappingTrace');
  if (root) return root;
  const panel = document.getElementById('fieldMappingPanel');
  if (!panel) return null;
  root = document.createElement('div');
  root.id = 'fieldMappingTrace';
  root.className = 'info-box mapping-trace';
  root.hidden = true;
  const status = document.getElementById('fieldMappingStatus');
  if (status) status.insertAdjacentElement('afterend', root);
  else panel.append(root);
  return root;
}

function traceStatusLabel(status){
  if (status === 'success') return '✅ 调用成功';
  if (status === 'failed') return '❌ 调用失败';
  return '⚠️ 暂不可用';
}

function humanConfidenceLabel(confidence){
  const value = Number(confidence);
  if (Number.isFinite(value) && value >= .85) return '高置信度';
  if (Number.isFinite(value) && value >= .65) return '中置信度';
  return '低置信度';
}

function humanMappingText(item){
  return `“${item?.header || '未命名列'}” → 作为“${item?.label || '待确认字段'}”使用（${humanConfidenceLabel(item?.confidence)}）`;
}

function appendTraceRow(root, label, value){
  const row = document.createElement('p');
  row.className = 'fine-print';
  const key = document.createElement('b');
  key.textContent = `${label}：`;
  const text = document.createElement('span');
  text.textContent = String(value ?? '未返回');
  row.append(key, text);
  root.append(row);
}

function renderMappingTrace(data){
  const trace = data?.aiMappingTrace;
  if (!trace) return;
  const root = ensureFieldMappingTrace();
  if (!root) return;
  root.hidden = false;
  root.replaceChildren();

  const title = document.createElement('b');
  title.textContent = 'AI 字段识别 · 现场调用信息';
  root.append(title);
  appendTraceRow(root, '供应商', trace.provider || 'DeepSeek');
  appendTraceRow(root, '模型', trace.model || '未返回');
  appendTraceRow(root, '调用状态', traceStatusLabel(trace.callStatus));
  appendTraceRow(root, '本次服务请求ID', trace.requestId || data?.requestId || '未返回');
  appendTraceRow(root, '返回映射', `${trace.mappingCount ?? 0} 条`);

  const mappings = Array.isArray(data?.mappingSuggestions) ? data.mappingSuggestions : [];
  latestMappingSuggestions = mappings;
  if (mappings.length) {
    const mappingTitle = document.createElement('p');
    mappingTitle.className = 'fine-print';
    const strong = document.createElement('b');
    strong.textContent = 'DeepSeek 返回并通过服务端校验的字段含义建议：';
    mappingTitle.append(strong);
    root.append(mappingTitle);
    for (const item of mappings) {
      const row = document.createElement('p');
      row.className = 'fine-print';
      row.textContent = humanMappingText(item);
      root.append(row);
    }
  }

  const meaningNote = document.createElement('p');
  meaningNote.className = 'fine-print';
  meaningNote.textContent = '确认的是列含义，不是确认计算结果。确认后由程序重新读取并计算整张表，AI不负责计算营业额或利润。';
  root.append(meaningNote);

  const note = document.createElement('p');
  note.className = 'fine-print';
  note.textContent = '说明：这里的请求ID是本系统服务请求ID，用于核对本次调用，不是 DeepSeek 官方 request ID；页面不会显示 API Key。';
  root.append(note);
}

function rewriteMappingSuggestionRows(){
  if (!latestMappingSuggestions.length) return;
  const root = document.getElementById('fieldMappingSuggestions');
  if (!root) return;
  for (const row of root.querySelectorAll('.mapping-suggestion')) {
    const input = row.querySelector('input[data-index]');
    const text = row.querySelector('span');
    const item = input ? latestMappingSuggestions[Number(input.dataset.index)] : null;
    if (!item || !text) continue;
    const expected = humanMappingText(item);
    if (text.textContent !== expected) text.textContent = expected;
  }
  const status = document.getElementById('fieldMappingStatus');
  if (status && root.querySelector('.mapping-suggestion')) {
    const expected = 'AI认为这些列可能代表下面的业务字段。请确认列含义是否正确；确认后由程序重新计算，AI不会计算营业额或利润。';
    if (status.textContent !== expected) status.textContent = expected;
  }
}

function applyRealMetricUnits(){
  for (const [id, unit] of Object.entries(realMetricUnits)) {
    const node = document.getElementById(id);
    if (!node) continue;
    const text = String(node.textContent || '').trim();
    if (!text || text === '—' || text === '无法计算' || text.endsWith(unit)) continue;
    if (/^-?\d[\d,]*(?:\.\d+)?$/.test(text)) node.textContent = `${text} ${unit}`;
  }
}

function clearMappingTrace(){
  latestMappingSuggestions = [];
  const root = document.getElementById('fieldMappingTrace');
  if (!root) return;
  root.hidden = true;
  root.replaceChildren();
}

window.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  const target = typeof args[0] === 'string' ? args[0] : String(args[0]?.url || '');
  if (target.includes('/api/experience-summary')) {
    void response.clone().json().then((data) => {
      if (data?.aiMappingTrace) renderMappingTrace(data);
      requestAnimationFrame(() => {
        rewriteMappingSuggestionRows();
        applyRealMetricUnits();
      });
    }).catch(() => {});
  }
  return response;
};

document.addEventListener('click', (event) => {
  const id = event.target?.id;
  if (id === 'clearBusinessFile' || id === 'analyzeBusinessFile') clearMappingTrace();
});

const uiObserver = new MutationObserver(() => {
  rewriteMappingSuggestionRows();
  applyRealMetricUnits();
});
uiObserver.observe(document.body, { subtree:true, childList:true, characterData:true });
applyRealMetricUnits();

window.renderMappingTrace = renderMappingTrace;
window.applyRealMetricUnits = applyRealMetricUnits;
