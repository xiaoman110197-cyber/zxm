import { SESSION_KEY, createSessionSnapshot, restoreSessionSnapshot } from './session.js';

const $ = (id) => document.getElementById(id);
const PRIORITIES = ['P0', 'P1', 'P2'];
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_OCR_IMAGE_DIMENSION = 2000;
const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;

function newDiagnosis() {
  return { id:crypto.randomUUID(), answers:{}, evidence:[], findings:[], documents:[], dialogue:[] };
}

const state = {
  diagnosis: newDiagnosis(),
  turn: 0,
  originalFile: null,
  originalBase64: '',
  audit: null,
  pendingDiagnosisRequest: false,
  diagnosisRequestInFlight: false,
  diagnosisRequestController: null,
  pendingFile: null,
  pendingFileReview: null,
  fileAnalysisController: null,
  fileElapsedTimer: null,
  fileAnalysisStartedAt: 0,
  fileProgressPercent: 0,
  fileResumeAfterBackground: false,
  fileBackgroundRetryCount: 0
};

function renderBubble(text, who, reason = '') {
  const node = document.createElement('div');
  node.className = `bubble ${who}`;

  const textNode = document.createElement('div');
  textNode.className = 'bubble-text';
  textNode.textContent = text;
  node.append(textNode);

  if (who === 'ai' && reason) {
    const details = document.createElement('details');
    details.className = 'bubble-reason';
    const summary = document.createElement('summary');
    summary.textContent = '为什么问这个';
    const explanation = document.createElement('p');
    explanation.textContent = reason;
    details.append(summary, explanation);
    node.append(details);
  }
  $('conversation').append(node);
}

function appendDialogue(text, who, reason = '') {
  const entry = { who, text, ...(reason ? { reason } : {}) };
  state.diagnosis.dialogue.push(entry);
  renderBubble(text, who, reason);
  saveSession();
}

function renderConversation() {
  $('conversation').replaceChildren();
  for (const entry of state.diagnosis.dialogue || []) {
    renderBubble(entry.text, entry.who, entry.reason || '');
  }
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
  if (!Array.isArray(findings) || !findings.length) {
    const placeholder = document.createElement('p');
    placeholder.className = 'muted';
    placeholder.textContent = '完成问诊后，这里会显示经营问题、证据、影响、行动和验证指标。';
    root.append(placeholder);
    updateDownloadState();
    return;
  }

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

function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(createSessionSnapshot(state)));
  } catch {
    $('session-status').textContent = '本机草稿暂时无法保存；当前页面内仍可继续问诊。';
  }
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const restored = restoreSessionSnapshot(JSON.parse(raw));
    if (!restored) {
      localStorage.removeItem(SESSION_KEY);
      return false;
    }
    state.turn = restored.turn;
    state.diagnosis = {
      ...restored.diagnosis,
      evidence: [],
      documents: [],
      dialogue: restored.diagnosis.dialogue || []
    };
    renderConversation();
    renderFindings(state.diagnosis.findings);
    $('session-status').textContent = '已恢复上次文字问诊。上传资料不会从本地草稿恢复，如需继续使用请重新选择文件。';
    $('send').textContent = '继续诊断';
    return true;
  } catch {
    return false;
  }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

function errorWithRequestId(message, requestId) {
  return requestId ? `${message}（错误编号：${requestId}）` : message;
}

async function postJson(url, body, { signal } = {}) {
  const response = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body), signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `请求失败 (${response.status})`);
    error.requestId = data.requestId || '';
    error.status = response.status;
    throw error;
  }
  return data;
}

function diagnosisErrorMessage(error) {
  let message = error.message || '本轮诊断失败，请重试';
  if (error.status === 429) message = '请求较频繁，请稍后再试。';
  else if (/AI diagnosis failed/i.test(message)) message = 'AI 暂时无法完成本轮判断，请直接重试。';
  return errorWithRequestId(message, error.requestId);
}

async function requestDiagnosis() {
  if (state.diagnosisRequestInFlight) return;
  const capturedDiagnosisId = state.diagnosis.id;
  const controller = new AbortController();
  state.diagnosisRequestController = controller;
  state.diagnosisRequestInFlight = true;
  state.pendingDiagnosisRequest = false;
  $('request-error').textContent = '';
  $('retry-diagnosis').hidden = true;
  $('send').disabled = true;
  const previousLabel = $('send').textContent;
  $('send').textContent = '正在判断…';

  try {
    const result = await postJson('/api/diagnosis', { diagnosis:state.diagnosis }, { signal:controller.signal });
    if (controller.signal.aborted || state.diagnosis.id !== capturedDiagnosisId) return;
    if (result.mode === 'question') {
      const reason = result.question.reason || '';
      appendDialogue(result.question.question, 'ai', reason);
      state.diagnosis.evidence.push(`ai_question:${result.question.key}:${reason}`);
    } else {
      state.diagnosis.findings = result.findings || [];
      renderFindings(state.diagnosis.findings);
      appendDialogue('已形成当前阶段的经营诊断。你仍可以继续补充信息，我会据此重新判断。', 'ai');
    }
    state.pendingDiagnosisRequest = false;
    saveSession();
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError' || state.diagnosis.id !== capturedDiagnosisId) return;
    state.pendingDiagnosisRequest = true;
    $('retry-diagnosis').hidden = false;
    $('request-error').textContent = diagnosisErrorMessage(error);
    saveSession();
  } finally {
    if (state.diagnosisRequestController === controller) {
      state.diagnosisRequestController = null;
      state.diagnosisRequestInFlight = false;
      $('send').disabled = false;
      $('send').textContent = state.turn ? '继续诊断' : previousLabel;
    }
  }
}

async function sendDiagnosis() {
  if (state.diagnosisRequestInFlight) return;
  const input = $('owner-input');
  const text = input.value.trim();
  if (!text) return;
  $('request-error').textContent = '';
  state.turn += 1;
  state.diagnosis.answers[`owner_turn_${state.turn}`] = text;
  appendDialogue(text, 'owner');
  input.value = '';
  state.pendingDiagnosisRequest = true;
  saveSession();
  await requestDiagnosis();
}

function stopFileElapsedTimer() {
  if (state.fileElapsedTimer) clearInterval(state.fileElapsedTimer);
  state.fileElapsedTimer = null;
}

function hideFileReview() {
  $('file-review').hidden = true;
  $('file-review-text').textContent = '';
  $('file-review-warning').textContent = '';
  $('file-review-confidence').textContent = '';
}

function clearPendingFileReview() {
  state.pendingFileReview = null;
  hideFileReview();
}

function resetDiagnosisExperience() {
  state.diagnosisRequestController?.abort();
  state.fileAnalysisController?.abort();
  state.diagnosisRequestController = null;
  state.fileAnalysisController = null;
  stopFileElapsedTimer();
  state.diagnosis = newDiagnosis();
  state.turn = 0;
  state.pendingDiagnosisRequest = false;
  state.diagnosisRequestInFlight = false;
  state.pendingFile = null;
  clearPendingFileReview();
  state.originalFile = null;
  state.originalBase64 = '';
  state.audit = null;
  state.fileAnalysisStartedAt = 0;
  state.fileProgressPercent = 0;
  state.fileResumeAfterBackground = false;
  state.fileBackgroundRetryCount = 0;
  $('conversation').replaceChildren();
  $('owner-input').value = '';
  $('request-error').textContent = '';
  $('retry-diagnosis').hidden = true;
  $('send').disabled = false;
  $('send').textContent = '开始诊断';
  $('workbook').value = '';
  $('workbook').disabled = false;
  $('file-progress').hidden = true;
  $('file-status').textContent = '';
  $('file-errors').textContent = '';
  $('session-status').textContent = '已开始新问诊。文字问诊会在本机保存 7 天；上传的原文件和识别全文不会写入本地草稿。';
  renderFindings([]);
  clearSession();
  updateDownloadState();
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

function isImageFile(file) {
  return Boolean(file && (String(file.type || '').startsWith('image/') || /\.(?:jpe?g|png)$/i.test(file.name || '')));
}

function loadBrowserImage(file, signal) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    let settled = false;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onAbort = () => {
      const error = new Error('已取消分析');
      error.name = 'AbortError';
      image.src = '';
      finish(reject, error);
    };
    signal?.addEventListener('abort', onAbort, { once:true });
    image.onload = () => finish(resolve, image);
    image.onerror = () => finish(reject, new Error('无法读取图片'));
    image.src = url;
  });
}

async function optimizeImageForOcr(file, { signal } = {}) {
  if (!isImageFile(file)) return file;
  if (file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error('图片过大，请先裁剪后再上传');

  const image = await loadBrowserImage(file, signal);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const longest = Math.max(width, height);
  if (!width || !height || longest <= MAX_OCR_IMAGE_DIMENSION) return file;

  const scale = MAX_OCR_IMAGE_DIMENSION / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return file;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const outputType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputType, outputType === 'image/jpeg' ? 0.9 : undefined));
  if (!blob) return file;
  return new File([blob], file.name, { type:outputType, lastModified:file.lastModified || Date.now() });
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
  const businessAnomalyText = summary.anomalyCount > 0
    ? `程序识别到经营异常 ${summary.anomalyCount} 个`
    : '经营异常将在问诊中结合经营背景继续判断';
  if (result.document?.structured) {
    return `已读取 ${type}：${summary.sheetCount || 0} 个表，${summary.rowCount || 0} 行数据；数据质量问题 ${summary.errorCount || 0} 个；${businessAnomalyText}。资料已加入本次问诊。`;
  }
  const confidence = typeof summary.confidence === 'number' ? `，识别置信度 ${Math.round(summary.confidence * 100)}%` : '';
  return `已读取 ${type}：提取 ${summary.textLength || 0} 个字符${confidence}；${businessAnomalyText}。资料已加入本次问诊。`;
}

function imageReviewStatusText(result) {
  const summary = result.summary || {};
  const confidence = typeof summary.confidence === 'number' ? `，识别置信度 ${Math.round(summary.confidence * 100)}%` : '';
  return `已读取图片：提取 ${summary.textLength || 0} 个字符${confidence}；请先确认识别内容，再加入本次问诊。`;
}

function renderFileReview(file, contentBase64, result) {
  state.pendingFileReview = { file, contentBase64, result };
  const confidence = result.summary?.confidence;
  $('file-review-confidence').textContent = typeof confidence === 'number'
    ? `置信度 ${Math.round(confidence * 100)}%`
    : '待人工确认';
  $('file-review-warning').textContent = typeof confidence === 'number' && confidence < 0.7
    ? '识别结果可能存在误差，请先核对关键数字。确认前，这张图片不会进入经营诊断。'
    : '请先确认识别内容，尤其是营业额、成本、订单量等关键数字。确认前，这张图片不会进入经营诊断。';
  $('file-review-text').textContent = String(result.document?.text || '').trim() || '没有提取到可展示的文字，请重新上传更清晰的图片。';
  $('file-review').hidden = false;
  $('file-status').textContent = imageReviewStatusText(result);
  $('file-errors').textContent = summarizeFileIssues(result);
}

function resetUploadedFileState() {
  state.originalFile = null;
  state.originalBase64 = '';
  state.audit = null;
  clearPendingFileReview();
  state.diagnosis.documents = [];
  state.diagnosis.evidence = state.diagnosis.evidence.filter((item) => !(typeof item === 'string' && item.startsWith('file_analysis:')));
  updateDownloadState();
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
  return { event, data:JSON.parse(raw) };
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
    const error = new Error(data.error || `文件分析请求失败 (${response.status})`);
    error.requestId = data.requestId || '';
    error.status = response.status;
    throw error;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) return response.json();

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
    pending += decoder.decode(value || new Uint8Array(), { stream:!done });
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

function commitSuccessfulFileAnalysis(file, contentBase64, result) {
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
  saveSession();
}

function applySuccessfulFileAnalysis(file, contentBase64, result) {
  if (result.document?.type === 'image') {
    renderFileReview(file, contentBase64, result);
    return;
  }
  clearPendingFileReview();
  commitSuccessfulFileAnalysis(file, contentBase64, result);
}

function confirmPendingFileReview() {
  const pending = state.pendingFileReview;
  if (!pending) return;
  state.pendingFileReview = null;
  hideFileReview();
  commitSuccessfulFileAnalysis(pending.file, pending.contentBase64, pending.result);
  $('file-status').textContent = `${fileStatusText(pending.result)} 已确认识别内容。`;
}

function replacePendingFileReview() {
  if (!state.pendingFileReview) return;
  clearPendingFileReview();
  $('file-status').textContent = '未使用刚才的图片识别结果，请重新选择经营资料。';
  $('file-errors').textContent = '';
  $('workbook').value = '';
  $('workbook').click();
}

async function analyzeBusinessFile(file, { automaticRetry = false } = {}) {
  if (!file || state.fileAnalysisController) return;
  const capturedDiagnosisId = state.diagnosis.id;
  const previousDocument = state.diagnosis.documents[0] || null;
  clearPendingFileReview();
  state.pendingFile = file;
  $('file-errors').textContent = '';

  if (!isImageFile(file) && file.size > MAX_FILE_BYTES) {
    state.pendingFile = null;
    $('file-progress').hidden = true;
    $('file-errors').textContent = `文件过大：当前版本单个文件最大支持 3 MB。${previousDocument ? ' 此前成功分析的资料仍保留。' : ''}`;
    return;
  }

  const controller = new AbortController();
  state.fileAnalysisController = controller;
  $('workbook').disabled = true;
  $('file-status').textContent = automaticRetry
    ? '检测到刚才切换到后台后连接中断，正在自动重新分析一次。'
    : (previousDocument ? '正在分析新资料；此前成功分析的资料会保留到新结果确认后再替换。' : '');
  setFileProgress(2, isImageFile(file) ? '正在优化图片' : '正在读取文件', { reset:true });
  setFileProgressActions({ analyzing:true, retry:false });
  startFileElapsedTimer();
  let retryAfterFinally = false;

  try {
    const transportFile = isImageFile(file) ? await optimizeImageForOcr(file, { signal:controller.signal }) : file;
    if (transportFile.size > MAX_FILE_BYTES) {
      throw new Error('优化后的文件仍超过 3 MB，请先裁剪或压缩后再上传');
    }
    if (transportFile !== file) setFileProgress(6, '图片已优化，正在读取');

    const contentBase64 = await fileToBase64(transportFile, {
      signal:controller.signal,
      onProgress:(fraction) => setFileProgress(2 + fraction * 6, transportFile !== file ? '正在读取优化后的图片' : '正在读取文件')
    });
    setFileProgress(8, '文件已读取，正在发送到分析服务');

    const result = await postFileAnalysisStream(transportFile, contentBase64, {
      signal:controller.signal,
      onProgress:(event) => setFileProgress(event?.percent, event?.message)
    });
    if (controller.signal.aborted || state.diagnosis.id !== capturedDiagnosisId) return;

    applySuccessfulFileAnalysis(file, contentBase64, result);
    state.pendingFile = null;
    state.fileResumeAfterBackground = false;
    state.fileBackgroundRetryCount = 0;
    setFileProgress(100, result.document?.type === 'image' ? '识别完成，等待确认' : '分析完成');
    setFileProgressActions({ analyzing:false, retry:false });
  } catch (error) {
    if (state.diagnosis.id !== capturedDiagnosisId) return;
    const cancelled = error?.name === 'AbortError';
    const canAutoRetry = !cancelled && state.fileResumeAfterBackground && state.fileBackgroundRetryCount < 1;
    if (canAutoRetry && document.visibilityState === 'visible') {
      state.fileBackgroundRetryCount += 1;
      retryAfterFinally = true;
      $('file-errors').textContent = '刚才切换到后台后分析连接中断，正在自动重试一次。';
      $('file-progress-message').textContent = '连接中断，准备自动重新分析';
      setFileProgressActions({ analyzing:false, retry:false });
    } else if (canAutoRetry) {
      $('file-errors').textContent = '分析连接已中断；返回本页面后会自动重新分析一次。';
      $('file-progress-message').textContent = '等待返回页面后自动重试';
      setFileProgressActions({ analyzing:false, retry:true });
    } else {
      let baseMessage;
      if (cancelled) baseMessage = '已取消分析。';
      else if (error.status === 429) baseMessage = errorWithRequestId('文件分析请求较频繁，请稍后再试。', error.requestId);
      else baseMessage = errorWithRequestId(`文件分析失败：${error.message}`, error.requestId);
      const keepMessage = previousDocument ? ' 此前成功分析的资料仍保留。' : '';
      $('file-errors').textContent = `${baseMessage}${keepMessage}`;
      $('file-progress-message').textContent = cancelled ? '分析已取消，可重新分析' : '分析已中断，可重新分析';
      setFileProgressActions({ analyzing:false, retry:Boolean(state.pendingFile) });
    }
  } finally {
    if (state.fileAnalysisController === controller) {
      stopFileElapsedTimer();
      renderFileElapsed();
      $('workbook').disabled = false;
      state.fileAnalysisController = null;
    }
    if (retryAfterFinally && state.pendingFile && state.diagnosis.id === capturedDiagnosisId) {
      setTimeout(() => analyzeBusinessFile(state.pendingFile, { automaticRetry:true }), 0);
    }
  }
}

function base64ToBlob(contentBase64, mimeType) {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type:mimeType });
}

async function downloadReport() {
  if (!state.originalFile || !state.originalBase64 || !state.diagnosis.findings.length) return;
  $('request-error').textContent = '';
  $('download-excel').disabled = true;
  try {
    const result = await postJson('/api/report', {
      file:{ name:state.originalFile.name, contentBase64:state.originalBase64 },
      audit:state.audit || { errors:[], anomalies:[], metrics:{} },
      findings:state.diagnosis.findings
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
    $('request-error').textContent = errorWithRequestId(`报告下载失败：${error.message}`, error.requestId);
  } finally {
    updateDownloadState();
  }
}

function retryPendingFile({ automaticRetry = false } = {}) {
  if (!state.pendingFile || state.fileAnalysisController) return;
  analyzeBusinessFile(state.pendingFile, { automaticRetry });
}

$('send').addEventListener('click', sendDiagnosis);
$('retry-diagnosis').addEventListener('click', () => {
  if (state.pendingDiagnosisRequest) requestDiagnosis();
});
$('new-diagnosis').addEventListener('click', resetDiagnosisExperience);
$('owner-input').addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') sendDiagnosis();
});
$('workbook').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) {
    state.fileResumeAfterBackground = false;
    state.fileBackgroundRetryCount = 0;
    analyzeBusinessFile(file);
  }
});
$('cancel-file').addEventListener('click', () => {
  state.fileResumeAfterBackground = false;
  state.fileAnalysisController?.abort();
});
$('retry-file').addEventListener('click', () => {
  state.fileResumeAfterBackground = false;
  state.fileBackgroundRetryCount = 0;
  retryPendingFile();
});
$('confirm-file').addEventListener('click', confirmPendingFileReview);
$('replace-file').addEventListener('click', replacePendingFileReview);
$('download-excel').addEventListener('click', downloadReport);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && state.fileAnalysisController && state.pendingFile) {
    state.fileResumeAfterBackground = true;
    $('file-progress-message').textContent = '页面已切到后台；若连接被系统中断，返回后会自动重试一次';
    return;
  }
  if (document.visibilityState === 'visible' && state.fileResumeAfterBackground && !state.fileAnalysisController && state.pendingFile && state.fileBackgroundRetryCount < 1) {
    state.fileBackgroundRetryCount += 1;
    $('file-errors').textContent = '检测到后台切换导致连接中断，正在自动重新分析一次。';
    retryPendingFile({ automaticRetry:true });
  }
});

restoreSession();
