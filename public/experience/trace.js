const nativeFetch = window.fetch.bind(window);

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
  if (mappings.length) {
    const mappingTitle = document.createElement('p');
    mappingTitle.className = 'fine-print';
    const strong = document.createElement('b');
    strong.textContent = 'DeepSeek 实际返回并通过服务端校验的字段映射：';
    mappingTitle.append(strong);
    root.append(mappingTitle);
    for (const item of mappings) {
      const row = document.createElement('p');
      row.className = 'fine-print';
      row.textContent = `“${item.header}” → ${item.label} · ${Math.round((item.confidence || 0) * 100)}%`;
      root.append(row);
    }
  }

  const note = document.createElement('p');
  note.className = 'fine-print';
  note.textContent = '说明：这里的请求ID是本系统服务请求ID，用于核对本次调用，不是 DeepSeek 官方 request ID；页面不会显示 API Key。';
  root.append(note);
}

function clearMappingTrace(){
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
    }).catch(() => {});
  }
  return response;
};

document.addEventListener('click', (event) => {
  const id = event.target?.id;
  if (id === 'clearBusinessFile' || id === 'analyzeBusinessFile') clearMappingTrace();
});

window.renderMappingTrace = renderMappingTrace;
