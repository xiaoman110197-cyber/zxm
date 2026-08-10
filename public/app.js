const $ = (id) => document.getElementById(id);
const PRIORITIES = ['P0', 'P1', 'P2'];
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const state = {
  diagnosis: { id: crypto.randomUUID(), answers: {}, evidence: [], findings: [], documents: [] },
  turn: 0,
  originalFile: null,
  originalBase64: '',
  audit: null,
  pendingFile: null,
  fileAnalysisController: null,
  fileElapsedTimer: null,
  fileAnalysisStartedAt: 0,
  fileProgressPercent: 0
};

function addBubble(text, who) {
  const node = document.createElement('div');
  node.className = `bubble ${who}`;
  node.textContent = text;
  $('conversation').append(node);
}

function findingLabel(status) {
  return ({ confirmed: '事实', probable: '高概率', hypothesis: '待验证' })[status] || '待验证';
}

function updateDownloadState() {
  $('download-excel').disabled = !(state.originalFile && state.originalBase64 && state.diagnosis.findings.length);
}

function renderFindings(findings) {
  const root = $('findings');
  root.replaceChildren();
  for (const finding of findings) {
    const card = document.createElement('article');
    card.className = 'finding';
    const evidence = Array.isArray(finding.evidence) ? finding.evidence.join('；') : '';
    const priority = PRIORITIES.includes(finding.priority) ? finding.priority : 'P2';
    card.innerHTML = `<span class="badge">${priority} · ${findingLabel(finding.status)}</span><h3></h3><p><strong>证据：</strong></p><p><strong>影响：</strong></p><p><strong>行动：</strong></p><p><strong>验证指标：</strong></p>`;
    card.querySelector('h3').textContent = finding.title || '经营问题';
    const ps = card.querySelectorAll('p');
    ps[0].append(document.createTextNode(evidence || '暂无直接证据'));
    ps[1].append(document.createTextNode(finding.impact || '待验证'));
    ps[2].append(document.createTextNode(finding.action || '待制定'));
    ps[3].append(document.createTextNode(finding.metric || '待定义'));
    root.append(card);
  }
  updateDownloadState();
}

async function postJson(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

async function sendDiagnosis() {
  const input = $('owner-input');
  const text = input.value.trim();
  if (!text) return;
  $('request-error').textContent = '';
  addBubble(text, 'owner');
  state.turn += 1;
  state.diagnosis.answers[`owner_turn_${state.turn}`] = text;
  input.value = '';
  $('send').disabled = true;
  try {
    const result = await postJson('/api/diagnosis', { diagnosis: state.diagnosis });
    if (result.mode === 'question') {
      addBubble(result.question.question, 'ai');
      state.diagnosis.evidence.push(`ai_question:${result.question.key}:${result.question.reason || ''}`);
    } else {
      state.diagnosis.findings = result.findings || [];
      renderFindings(state.diagnosis.findings);
      addBubble('已形成当前阶段的经营诊断。你仍可以继续补充信息，我会据此重新判断。', 'ai');
    }
  } catch (error) {
    $('request-error').textContent = error.message;
  } finally {
    $('send').disabled = false;
  }
}

function fileToBase64(file, { signal, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abortReader = () => reader.readyState === FileReader.LOADING && reader.abort();
    signal?.addEventListener('abort', abortReader, { once:true });
    reader.onerror = () => reject(new Error('无法读取文件'));
    reader.onabort = () => {
      const error = new Error('已取消分析');
      error.name = 'AbortError';
      reject(error);
    };
    reader.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onloadend = () => signal?.removeEventListener('abort', abortReader);
    reader.readAsDataURL(file);
  });
}

function fileTypeLabel(type) {
  return ({ excel:'Excel', csv:'CSV', pdf:'PDF', docx:'Word', image:'图片' })[type] || '文件';
}

function summarizeFileIssues(result) {
  const counts = new Map();
  const errors = Array.isArray(result.audit?.errors) ? result.audit.errors : [];
  const labels = {
    missing_value: '关键字段缺失',
    duplicate: '重复记录',
    duplicate_record: '重复记录',
    cross_sheet_mismatch: '跨表合计不一致'
  };
  for (const issue of errors) {
    const label = issue.reason || labels[issue.type] || issue.type || '数据问题';
    const scope = [issue.sheet, issue.field].filter(Boolean).join(' / ');
    const key = scope ? `${label}（${scope}）` : label;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const parts = [];
  for (const [label, count] of counts) parts.push(count > 1 ? `${label} × ${count}` : label);
  const warnings = Array.isArray(result.document?.warnings) ? result.document.warnings : [];
  for (const warning of warnings) parts.push(`识别提示：${warning}`);
  return parts.slice(0, 8).join('；');
}

function fileStatusText(result) {
  const summary = result.summary || {};
  const type = fileTypeLabel(result.document?.type);
  const issueText = `数据质量问题 ${summary.errorCount || 0} 个，经营异常 ${summary.anomalyCount || 0} 个`;
  if (result.document?.structured) {
    return `已读取 ${type}：${summary.sheetCount || 0} 个表，${summary.rowCount || 0} 行数据；${issueText}。`;
  }
  const confidence = typeof summary.confidence === 'number' ? `，识别置信度 ${Math.round(summary.confidence * 100)}%` : '';
  return `已读取 ${type}：提取 ${summary.textLength || 0} 个字符${confidence}；${issueText}。`;
}

function resetUploadedFileState() {
  state.originalFile = null;
  state.originalBase64 = '';
  state.audit = null;
  state.diagnosis.documents = [];
  state.diagnosis.evidence = state.diagnosis.evidence.filter((item) => !(typeof item === 'string' && item.startsWith('file_analysis:')));
  updateDownloadState();
}

function stopFileElapsedTimer() {
  if (state.fileElapsedTimer) clearInterval(state.fileElapsedTimer);
  state.fileElapsedTimer = null;
}

function renderFileElapsed() {
  if (!state.fileAnalysisStartedAt) return;
  const seconds = Math.max(0, Math.floor((Date.now() - state.fileAnalysisStartedAt) / 1000));
  $('file-progress-elapsed').textContent = `已用时 ${seconds} 秒`;
}

function startFileElapsedTimer() {
  stopFileElapsedTimer();
  state.fileAnalysisStartedAt = Date.now();
  renderFileElapsed();
  state.fileElapsedTimer = setInterval(renderFileElapsed, 1000);
}

function setFileProgress(percent, message, { reset = false } = {}) {
  const progress = $('file-progress');
  progress.hidden = false;
  if (reset) state.fileProgressPercent = 0;
  const numeric = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  state.fileProgressPercent = reset ? numeric : Math.max(state.fileProgressPercent, numeric);
  progress.setAttribute('aria-valuenow', String(state.fileProgressPercent));
  $('file-progress-percent').textContent = `${state.fileProgressPercent}%`;
  $('file-progress-message').textContent = message || '正在分析经营资料';
  $('file-progress-bar').style.width = `${state.fileProgressPercent}%`;
}

function setFileProgressActions({ analyzing = false, retry = false } = {}) {
  $('cancel-file').hidden = !analyzing;
  $('retry-file').hidden = !retry;
}

function parseSseBlock(block) {
  const lines = block.split(/\r?\n/);
  let event = 'message';
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join('\n');
  return { event, data: JSON.parse(raw) };
}

function handleAnalysisStreamEvent(parsed, onProgress) {
  if (!parsed) return null;
  if (parsed.event === 'progress') {
    onProgress(parsed.data);
    return null;
  }
  if (parsed.event === 'result') return parsed.data;
  if (parsed.event === 'error') {
    const error = new Error(parsed.data?.error || '文件分析失败');
    if (parsed.data?.requestId) error.requestId = parsed.data.requestId;
    throw error;
  }
  return null;
}

async function readAnalysisStream(response, onProgress) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `文件分析请求失败 (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    return response.json();
  }

  let finalResult = null;
  const processBlock = (block) => {
    if (!block.trim()) return;
    const value = handleAnalysisStreamEvent(parseSseBlock(block), onProgress);
    if (value) finalResult = value;
  };

  if (!response.body) {
    const text = await response.text();
    for (const block of text.split(/\r?\n\r?\n/)) processBlock(block);
    if (finalResult) return finalResult;
    throw new Error('分析连接提前结束，请重新分析');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = pending.split(/\r?\n\r?\n/);
    pending = blocks.pop() || '';
    for (const block of blocks) processBlock(block);
    if (done) break;
  }
  if (pending.trim()) processBlock(pending);
  if (finalResult) return finalResult;
  throw new Error('分析连接提前结束，请重新分析');
}

async function postFileAnalysisStream(file, contentBase64, { signal, onProgress }) {
  const response = await fetch('/api/analyze-file?stream=1', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ file:{ name:file.name, contentBase64 } }),
    signal
  });
  return readAnalysisStream(response, onProgress);
}

function applySuccessfulFileAnalysis(file, contentBase64, result) {
  if (result.document.type === 'excel') {
    state.originalFile = file;
    state.originalBase64 = contentBase64;
  } else {
    state.originalFile = null;
    state.originalBase64 = '';
  }

  state.audit = result.audit;
  state.diagnosis.documents = [result.document];
  state.diagnosis.evidence = state.diagnosis.evidence.filter((item) => !(typeof item === 'string' && item.startsWith('file_analysis:')));
  state.diagnosis.evidence.push(`file_analysis:${JSON.stringify(result.summary)}`);
  $('file-status').textContent = fileStatusText(result);
  $('file-errors').textContent = summarizeFileIssues(result);
  updateDownloadState();
}

async function analyzeBusinessFile(file) {
  const previousDocument = state.diagnosis.documents[0] || null;
  state.pendingFile = file;
  $('file-errors').textContent = '';

  if (file.size > MAX_FILE_BYTES) {
    state.pendingFile = null;
    $('file-progress').hidden = true;
    $('file-errors').textContent = `文件过大：当前版本单个文件最大支持 3 MB。${previousDocument ? ' 此前成功分析的资料仍保留。' : ''}`;
    return;
  }

  const controller = new AbortController();
  state.fileAnalysisController = controller;
  $('workbook').disabled = true;
  $('file-status').textContent = previousDocument ? '正在分析新资料；此前成功分析的资料会保留到新结果确认后再替换。' : '';
  setFileProgress(2, '正在读取文件', { reset:true });
  setFileProgressActions({ analyzing:true, retry:false });
  startFileElapsedTimer();

  try {
    const contentBase64 = await fileToBase64(file, {
      signal:controller.signal,
      onProgress:(fraction) => setFileProgress(2 + fraction * 6, '正在读取文件')
    });
    setFileProgress(8, '文件已读取，正在发送到分析服务');

    const result = await postFileAnalysisStream(file, contentBase64, {
      signal:controller.signal,
      onProgress:(event) => setFileProgress(event?.percent, event?.message)
    });

    applySuccessfulFileAnalysis(file, contentBase64, result);
    state.pendingFile = null;
    setFileProgress(100, '分析完成');
    setFileProgressActions({ analyzing:false, retry:false });
  } catch (error) {
    const cancelled = error?.name === 'AbortError';
    const baseMessage = cancelled ? '已取消分析。' : `文件分析失败：${error.message}`;
    const keepMessage = previousDocument ? ' 此前成功分析的资料仍保留。' : '';
    $('file-errors').textContent = `${baseMessage}${keepMessage}`;
    $('file-progress-message').textContent = cancelled ? '分析已取消，可重新分析' : '分析已中断，可重新分析';
    setFileProgressActions({ analyzing:false, retry:Boolean(state.pendingFile) });
  } finally {
    stopFileElapsedTimer();
    renderFileElapsed();
    $('workbook').disabled = false;
    if (state.fileAnalysisController === controller) state.fileAnalysisController = null;
  }
}

function base64ToBlob(contentBase64, mimeType) {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

async function downloadReport() {
  if (!state.originalFile || !state.originalBase64 || !state.diagnosis.findings.length) return;
  $('request-error').textContent = '';
  $('download-excel').disabled = true;
  try {
    const result = await postJson('/api/report', {
      file: { name: state.originalFile.name, contentBase64: state.originalBase64 },
      audit: state.audit || { errors: [], anomalies: [], metrics: {} },
      findings: state.diagnosis.findings
    });
    const blob = base64ToBlob(result.contentBase64, result.mimeType);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.filename || '经营诊断报告.xlsx';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    $('request-error').textContent = `报告下载失败：${error.message}`;
  } finally {
    updateDownloadState();
  }
}

$('send').addEventListener('click', sendDiagnosis);
$('owner-input').addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') sendDiagnosis();
});
$('workbook').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) analyzeBusinessFile(file);
});
$('cancel-file').addEventListener('click', () => state.fileAnalysisController?.abort());
$('retry-file').addEventListener('click', () => {
  if (state.pendingFile && !state.fileAnalysisController) analyzeBusinessFile(state.pendingFile);
});
$('download-excel').addEventListener('click', downloadReport);
