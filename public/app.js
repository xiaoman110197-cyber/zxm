const $ = (id) => document.getElementById(id);
const PRIORITIES = ['P0', 'P1', 'P2'];
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const state = {
  diagnosis: { id: crypto.randomUUID(), answers: {}, evidence: [], findings: [], documents: [] },
  turn: 0,
  originalFile: null,
  originalBase64: '',
  audit: null,
  diagnosisBusy: false,
  fileAnalyzing: false,
  fileRequestId: 0,
  fileController: null,
  lastFile: null
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

function updateSendState() {
  $('send').disabled = state.fileAnalyzing || state.diagnosisBusy;
  $('send').textContent = state.diagnosisBusy ? '正在分析…' : '开始诊断';
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
  if (state.diagnosisBusy) return;
  if (state.fileAnalyzing) {
    $('request-error').textContent = '经营资料仍在分析，请稍候完成后再开始诊断。';
    return;
  }
  const input = $('owner-input');
  const text = input.value.trim();
  if (!text) return;

  state.diagnosisBusy = true;
  updateSendState();
  $('request-error').textContent = '';
  addBubble(text, 'owner');
  state.turn += 1;
  state.diagnosis.answers[`owner_turn_${state.turn}`] = text;
  input.value = '';
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
    state.diagnosisBusy = false;
    updateSendState();
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取文件'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
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

function clearFileEvidence() {
  state.diagnosis.evidence = state.diagnosis.evidence.filter((entry) => !(typeof entry === 'string' && entry.startsWith('file_analysis:')));
}

function resetUploadedFileState() {
  state.originalFile = null;
  state.originalBase64 = '';
  state.audit = null;
  state.diagnosis.documents = [];
  clearFileEvidence();
  updateDownloadState();
}

function setFileProgress(percent, message) {
  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  $('file-progress').hidden = false;
  $('file-progress-percent').textContent = `${value}%`;
  $('file-progress-stage').textContent = message || '正在分析经营资料…';
  $('file-progress-bar').setAttribute('aria-valuenow', String(value));
  $('file-progress-fill').style.width = `${value}%`;
}

function setRetryVisible(visible) {
  $('retry-file').hidden = !visible;
}

function networkFailure(message = '连接中断，未收到服务器结果') {
  const error = new Error(message);
  error.networkFailure = true;
  return error;
}

function isNetworkFailure(error) {
  if (error?.name === 'AbortError') return false;
  if (error?.networkFailure === true) return true;
  const message = String(error?.message || '');
  return /Load failed|Failed to fetch|NetworkError|network|连接中断/i.test(message);
}

function safeFileError(error) {
  if (isNetworkFailure(error)) return '连接中断，未收到服务器结果';
  return String(error?.message || '文件分析失败');
}

function parseNdjsonLine(line, onProgress) {
  const event = JSON.parse(line);
  if (event.type === 'progress') onProgress(event);
  if (event.type === 'error') {
    const error = new Error(event.error || '文件分析失败');
    error.serverAnalysis = true;
    error.statusCode = event.status;
    throw error;
  }
  return event.type === 'result' ? event.result : null;
}

async function streamFileAnalysis(file, contentBase64, { signal, onProgress }) {
  let response;
  try {
    response = await fetch('/api/analyze-file-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: { name:file.name, contentBase64 } }),
      signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw networkFailure();
  }
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    try {
      const first = raw.split('\n').find((line) => line.trim());
      const event = first ? JSON.parse(first) : null;
      throw new Error(event?.error || `请求失败 (${response.status})`);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`请求失败 (${response.status})`);
      throw error;
    }
  }
  if (!response.body?.getReader) throw networkFailure('当前浏览器未收到流式分析结果');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream:true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const maybeResult = parseNdjsonLine(line, onProgress);
        if (maybeResult) result = maybeResult;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const maybeResult = parseNdjsonLine(buffer, onProgress);
      if (maybeResult) result = maybeResult;
    }
  } catch (error) {
    if (error?.name === 'AbortError' || error?.serverAnalysis) throw error;
    throw networkFailure();
  }
  if (!result) throw networkFailure();
  return result;
}

function waitUntilVisible(requestId) {
  if (document.visibilityState !== 'hidden') return Promise.resolve();
  return new Promise((resolve) => {
    const handler = () => {
      if (document.visibilityState === 'hidden') return;
      document.removeEventListener('visibilitychange', handler);
      resolve(requestId === state.fileRequestId);
    };
    document.addEventListener('visibilitychange', handler);
  });
}

function applyFileResult(result, file, contentBase64, requestId) {
  if (requestId !== state.fileRequestId) return false;
  clearFileEvidence();
  if (result.document.type === 'excel') {
    state.originalFile = file;
    state.originalBase64 = contentBase64;
  } else {
    state.originalFile = null;
    state.originalBase64 = '';
  }
  state.audit = result.audit;
  state.diagnosis.documents = [result.document];
  state.diagnosis.evidence.push(`file_analysis:${JSON.stringify(result.summary)}`);
  $('file-status').textContent = fileStatusText(result);
  $('file-errors').textContent = summarizeFileIssues(result);
  setFileProgress(100, '分析完成');
  setRetryVisible(false);
  updateDownloadState();
  return true;
}

async function analyzeBusinessFile(file) {
  state.fileRequestId += 1;
  const requestId = state.fileRequestId;
  state.fileController?.abort();
  state.fileController = null;
  state.lastFile = file;
  state.fileAnalyzing = true;
  updateSendState();
  resetUploadedFileState();
  $('file-errors').textContent = '';
  $('file-status').textContent = '';
  setRetryVisible(false);

  if (file.size > MAX_FILE_BYTES) {
    state.fileAnalyzing = false;
    setFileProgress(0, '文件未开始分析');
    $('file-errors').textContent = '文件过大：当前版本单个文件最大支持 3 MB。';
    updateSendState();
    return;
  }

  try {
    setFileProgress(5, `正在读取 ${file.name}…`);
    const contentBase64 = await fileToBase64(file);
    if (requestId !== state.fileRequestId) return;

    let result = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      state.fileController = controller;
      try {
        setFileProgress(attempt === 0 ? 15 : 16, attempt === 0 ? '正在上传并连接分析服务…' : '连接中断，正在自动重试（1/1）…');
        result = await streamFileAnalysis(file, contentBase64, {
          signal: controller.signal,
          onProgress(event) {
            if (requestId !== state.fileRequestId) return;
            setFileProgress(event.percent, event.message);
          }
        });
        break;
      } catch (error) {
        if (requestId !== state.fileRequestId || error?.name === 'AbortError') return;
        if (attempt === 0 && isNetworkFailure(error)) {
          setFileProgress(16, '连接中断，正在自动重试（1/1）…');
          await waitUntilVisible(requestId);
          if (requestId !== state.fileRequestId) return;
          continue;
        }
        throw error;
      }
    }

    if (!result) throw networkFailure();
    applyFileResult(result, file, contentBase64, requestId);
  } catch (error) {
    if (requestId !== state.fileRequestId || error?.name === 'AbortError') return;
    resetUploadedFileState();
    const network = isNetworkFailure(error);
    $('file-status').textContent = '';
    $('file-errors').textContent = `文件分析失败：${safeFileError(error)}`;
    if (network) {
      setFileProgress(Number($('file-progress-bar').getAttribute('aria-valuenow') || 0), '连接中断，可重新分析');
      setRetryVisible(true);
    } else {
      setRetryVisible(false);
    }
  } finally {
    if (requestId === state.fileRequestId) {
      state.fileAnalyzing = false;
      state.fileController = null;
      updateSendState();
    }
  }
}

function retryFile() {
  if (!state.lastFile || state.fileAnalyzing) return;
  $('retry-file').textContent = '重新分析';
  analyzeBusinessFile(state.lastFile);
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
$('retry-file').addEventListener('click', retryFile);
$('download-excel').addEventListener('click', downloadReport);
