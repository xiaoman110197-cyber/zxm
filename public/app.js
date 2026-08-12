import { SESSION_KEY, createSessionSnapshot, restoreSessionSnapshot } from './session.js';
import { buildFileReviewModel } from './file-review.js';

const $ = (id) => document.getElementById(id);
const PRIORITIES = ['P0', 'P1', 'P2'];
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_OCR_IMAGE_DIMENSION = 2000;
const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;

function newDiagnosis() {
  return {
    id:crypto.randomUUID(),
    answers:{},
    evidence:[],
    findings:[],
    documents:[],
    dialogue:[],
    analysisTokens:[],
    correctionDecisions:[],
    diagnosisToken:null
  };
}

const state = {
  diagnosis:newDiagnosis(),
  turn:0,
  originalFile:null,
  originalBase64:'',
  audit:null,
  pendingDiagnosisRequest:false,
  diagnosisRequestInFlight:false,
  diagnosisRequestController:null,
  pendingFile:null,
  pendingFileReview:null,
  fileAnalysisController:null,
  fileElapsedTimer:null,
  fileAnalysisStartedAt:0,
  fileProgressPercent:0,
  fileResumeAfterBackground:false,
  fileBackgroundRetryCount:0
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
  for (const entry of state.diagnosis.dialogue || []) renderBubble(entry.text, entry.who, entry.reason || '');
}

function findingLabel(status) {
  return ({ confirmed:'事实', probable:'高概率', hypothesis:'待验证' })[status] || '待验证';
}

function updateDownloadState() {
  $('download-excel').disabled = !(state.originalFile && state.originalBase64 && state.diagnosis.findings.length && state.diagnosis.diagnosisToken);
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
      evidence:[],
      documents:[],
      dialogue:restored.diagnosis.dialogue || [],
      analysisTokens:[],
      correctionDecisions:[],
      diagnosisToken:null
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
      state.diagnosis.diagnosisToken = result.diagnosisToken || null;
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

function clearNode(id) {
  $(id)?.replaceChildren();
}

function hideFileReview() {
  $('file-review').hidden = true;
  clearNode('file-review-lead');
  clearNode('file-review-summary');
  clearNode('file-review-corrections-list');
  clearNode('file-review-important-list');
  clearNode('file-review-other-list');
  $('file-review-text').textContent = '';
  $('file-review-warning').textContent = '';
  $('file-review-confidence').textContent = '';
  $('file-review-corrections').hidden = true;
  $('file-review-important').hidden = true;
  $('file-review-other').hidden = true;
  $('file-review-fulltext').hidden = true;
  $('file-review-other').open = false;
  $('file-review-fulltext').open = false;
  $('confirm-file').disabled = false;
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
  if (!width || !height || (longest <= MAX_OCR_IMAGE_DIMENSION && file.size <= MAX_FILE_BYTES)) return file;
  const scale = Math.min(1, MAX_OCR_IMAGE_DIMENSION / longest);
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
  const labels = { missing_value:'关键字段缺失', duplicate:'重复记录', duplicate_record:'重复记录', cross_sheet_mismatch:'跨表合计不一致' };
  for (const issue of errors) {
    const label = issue.reason || labels[issue.type] || issue.type || '数据问题';
    const scope = [issue.sheet, issue.field].filter(Boolean).join(' / ');
    const key = scope ? `${label}（${scope}）` : label;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const parts = [];
  for (const [label, count] of counts) parts.push(count > 1 ? `${label} × ${count}` : label);
  return parts.slice(0, 8).join('；');
}

function fileStatusText(result) {
  const summary = result.summary || {};
  const type = fileTypeLabel(result.document?.type);
  const businessAnomalyText = summary.anomalyCount > 0 ? `程序识别到经营异常 ${summary.anomalyCount} 个` : '经营异常将在问诊中结合经营背景继续判断';
  if (result.document?.structured) return `已读取 ${type}：${summary.sheetCount || 0} 个表，${summary.rowCount || 0} 行数据；${businessAnomalyText}。资料已加入本次问诊。`;
  if (result.reportReview) {
    const mode = result.reportReview.summary?.recognitionMode;
    const complete = result.reportReview.summary?.completeReview === true;
    if (mode === 'local_ocr_degraded') return '报表已用降级识别读取。按你的确认加入本次问诊；未确认的数据不会作为确定事实。';
    if (!complete) return '报表检查未完整完成。仅已验证的内容会用于本次问诊。';
    return '已完成报表检查。资料已加入本次问诊。';
  }
  return `已读取 ${type}：提取 ${summary.textLength || 0} 个字符；${businessAnomalyText}。资料已加入本次问诊。`;
}

function imageReviewStatusText(result) {
  const summary = result.reportReview?.summary || {};
  if (summary.recognitionMode === 'ocr_unavailable') return '报表识别未完成。请重新上传更清晰的图片后再继续诊断。';
  if (summary.completeReview !== true) return '报表检查未完成。请先核对识别状态和关键数据，再决定是否用于经营诊断。';
  if (result.reportReview) return '报表已检查完成。请先看具体问题和依据，确认后再用于经营诊断。';
  return '资料已读取。请先确认识别内容，确认后再用于经营诊断。';
}

function formatValue(issue, value) {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  const formatted = value.toLocaleString('zh-CN', { maximumFractionDigits:2 });
  const unit = issue?.unit || '';
  return unit ? `${formatted} ${unit}` : formatted;
}

function displayValue(label, value) {
  return formatValue({ unit:/率/.test(label) ? '%' : '' }, value);
}

function summaryItem(value, label) {
  const node = document.createElement('div');
  node.className = 'review-summary-item';
  const strong = document.createElement('strong');
  strong.textContent = value;
  const span = document.createElement('span');
  span.textContent = label;
  node.append(strong, span);
  return node;
}

function reportIssueBadge(issue) {
  if (issue.kind === 'calculation_error') return '计算错误';
  if (issue.kind === 'logic_error') return '数据逻辑错误';
  if (issue.kind === 'anomaly') return '异常，需核对';
  return '关键数据需核对';
}

function appendLabeledValue(parent, label, value, className = '') {
  const row = document.createElement('div');
  row.className = `report-value-row ${className}`.trim();
  const key = document.createElement('span');
  key.textContent = label;
  const strong = document.createElement('strong');
  strong.textContent = value;
  row.append(key, strong);
  parent.append(row);
}

function renderReportIssueCard(issue, index) {
  const card = document.createElement('article');
  card.className = `report-issue-card report-${issue.kind || 'anomaly'}`;
  const head = document.createElement('div');
  head.className = 'report-issue-head';
  const titleWrap = document.createElement('div');
  const number = document.createElement('span');
  number.className = 'report-issue-number';
  number.textContent = `${index + 1}.`;
  const title = document.createElement('strong');
  title.textContent = `${issue.title || '报表问题'}${issue.scope ? `｜${issue.scope}` : ''}`;
  titleWrap.append(number, title);
  const badge = document.createElement('span');
  badge.className = 'report-issue-badge';
  badge.textContent = reportIssueBadge(issue);
  head.append(titleWrap, badge);
  card.append(head);

  const values = document.createElement('div');
  values.className = 'report-values';
  if (issue.originalValue !== undefined) appendLabeledValue(values, '原数据', formatValue(issue, issue.originalValue));
  if (issue.kind === 'calculation_error' && issue.source === 'program' && Object.prototype.hasOwnProperty.call(issue, 'correctedValue')) {
    appendLabeledValue(values, '正确结果', formatValue(issue, issue.correctedValue), 'report-correct-value');
  }
  if (values.childElementCount) card.append(values);

  const explanation = document.createElement('p');
  explanation.className = 'report-issue-explanation';
  explanation.textContent = issue.explanation || '请核对原始报表。';
  card.append(explanation);

  if (Array.isArray(issue.evidence) && issue.evidence.length) {
    const details = document.createElement('details');
    details.className = 'report-evidence';
    const summary = document.createElement('summary');
    summary.textContent = '查看计算/判断依据';
    const list = document.createElement('ul');
    for (const item of issue.evidence.slice(0, 8)) {
      const li = document.createElement('li');
      li.textContent = item;
      list.append(li);
    }
    details.append(summary, list);
    card.append(details);
  }
  return card;
}

function renderReportReview(file, contentBase64, result) {
  const review = result.reportReview || { issues:[], summary:{} };
  const issues = Array.isArray(review.issues) ? review.issues : [];
  const confirmedIssues = issues.filter((item) => item.kind !== 'needs_confirmation');
  const confirmations = issues.filter((item) => item.kind === 'needs_confirmation');
  const recognitionMode = review.summary?.recognitionMode || 'ocr_unavailable';
  const completeReview = review.summary?.completeReview === true;
  state.pendingFileReview = { file, contentBase64, result, mode:'report', correctionDecisions:{} };

  if (recognitionMode === 'cloud_ocr_deepseek' && completeReview) $('file-review-confidence').textContent = '云端原图已读取并复算';
  else if (recognitionMode === 'local_ocr_degraded') $('file-review-confidence').textContent = '降级识别，关键数据需核对';
  else $('file-review-confidence').textContent = '报表识别或分析未完整完成';

  const lead = $('file-review-lead');
  lead.replaceChildren();
  const headline = document.createElement('strong');
  const problemCount = Number(review.summary?.problemCount) || confirmedIssues.length;
  const correctionCount = Number(review.summary?.provableCorrectionCount) || confirmedIssues.filter((item) => item.kind === 'calculation_error').length;
  const confirmationCount = Number(review.summary?.confirmationCount) || confirmations.length;
  if (recognitionMode === 'ocr_unavailable') {
    headline.textContent = '这张报表还没有可靠识别';
  } else if (problemCount) {
    headline.textContent = `发现 ${problemCount} 处报表问题${correctionCount ? `，其中 ${correctionCount} 处可以确定订正` : ''}`;
  } else if (!completeReview) {
    headline.textContent = '当前证据下没有发现可证明的错误，但本次识别或分析不完整，不能据此判断报表没有问题。';
  } else {
    headline.textContent = '暂未发现可以确定的报表错误';
  }
  lead.append(headline);
  if (confirmationCount) {
    const note = document.createElement('span');
    note.textContent = `另有 ${confirmationCount} 个关键数据需要核对，不会当成确定事实。`;
    lead.append(note);
  }

  const summary = $('file-review-summary');
  summary.replaceChildren();
  summary.append(summaryItem(`${problemCount} 处`, '发现的问题'));
  summary.append(summaryItem(`${correctionCount} 处`, '可以确定订正'));
  summary.append(summaryItem(`${confirmationCount} 个`, '关键数据待核对'));

  const problemList = $('file-review-corrections-list');
  problemList.replaceChildren();
  confirmedIssues.forEach((issue, index) => problemList.append(renderReportIssueCard(issue, index)));
  $('file-review-corrections').hidden = confirmedIssues.length === 0;

  const confirmationList = $('file-review-important-list');
  confirmationList.replaceChildren();
  confirmations.forEach((issue, index) => confirmationList.append(renderReportIssueCard(issue, index)));
  $('file-review-important').hidden = confirmations.length === 0;

  $('file-review-other').hidden = true;
  $('file-review-other').open = false;
  $('file-review-text').textContent = String(result.document?.text || '').trim() || '没有可展示的文字识别详情。';
  $('file-review-fulltext').hidden = !String(result.document?.text || '').trim();
  $('file-review-fulltext').open = false;

  if (review.summary?.reviewWarning) {
    $('file-review-warning').textContent = `${review.summary.reviewWarning}${completeReview ? '' : ' 本次结果不能视为完整报表检查。'}`;
  } else if (recognitionMode === 'ocr_unavailable') {
    $('file-review-warning').textContent = '请重新上传更清晰的图片；在可靠识别前，这份报表不会进入经营诊断。';
  } else if (confirmationCount) {
    $('file-review-warning').textContent = '待核对的数据不会作为确定事实；其余有明确依据的问题可以继续用于经营诊断。';
  } else if (!completeReview) {
    $('file-review-warning').textContent = '本次识别或分析不完整，不能把“0 个确定问题”理解为报表没有问题。';
  } else {
    $('file-review-warning').textContent = '只有程序能够复算或明确验证的内容，才会显示“正确结果”。';
  }
  $('confirm-file').disabled = recognitionMode === 'ocr_unavailable';
  $('file-review').hidden = false;
  $('file-errors').textContent = '';
  $('file-status').textContent = imageReviewStatusText(result);
}

function plainAuditIssues(result) {
  const issues = [];
  for (const issue of result.audit?.errors || []) {
    if (issue.type === 'cross_sheet_mismatch' || issue.type === 'cross_sheet_total_mismatch') continue;
    if (issue.type === 'missing_value') issues.push({ text:`${issue.field || '关键字段'}可能漏填`, context:`${issue.sheet || '表格'}${issue.row ? `第 ${issue.row} 行` : ''}，请确认是否需要补充。` });
    else if (issue.type === 'duplicate' || issue.type === 'duplicate_record') issues.push({ text:'发现可能重复的数据', context:`${issue.sheet || '表格'}${issue.row ? `第 ${issue.row} 行` : ''}，请确认是否重复录入。` });
    else issues.push({ text:'发现一处数据需要确认', context:issue.reason || '请核对原资料。' });
  }
  return issues;
}

function renderIssueCard(issue, { badge = '需要确认' } = {}) {
  const card = document.createElement('article');
  card.className = 'review-issue-card';
  const head = document.createElement('div');
  head.className = 'review-card-title';
  const title = document.createElement('strong');
  title.textContent = issue.text || issue.label || '需要确认';
  const badgeNode = document.createElement('span');
  badgeNode.className = 'review-card-badge';
  badgeNode.textContent = badge;
  head.append(title, badgeNode);
  card.append(head);
  if (issue.explanation) {
    const copy = document.createElement('p');
    copy.className = 'review-card-copy';
    copy.textContent = issue.explanation;
    card.append(copy);
  }
  if (issue.context) {
    const context = document.createElement('div');
    context.className = 'review-context';
    context.textContent = `所在内容：${issue.context}`;
    card.append(context);
  }
  return card;
}

function renderCorrectionCard(correction, index) {
  const card = document.createElement('article');
  card.className = 'review-correction-card';
  card.dataset.correctionIndex = String(index);
  const head = document.createElement('div');
  head.className = 'review-card-title';
  const title = document.createElement('strong');
  title.textContent = correction.label || '计算结果';
  const badge = document.createElement('span');
  badge.className = 'review-card-badge';
  badge.textContent = '可以确定';
  head.append(title, badge);
  const values = document.createElement('div');
  values.className = 'review-values';
  const original = document.createElement('div');
  original.className = 'review-value';
  original.innerHTML = '<span>原数据</span><strong></strong>';
  original.querySelector('strong').textContent = displayValue(correction.label, correction.originalValue);
  const corrected = document.createElement('div');
  corrected.className = 'review-value review-correct-value';
  corrected.innerHTML = '<span>正确结果</span><strong></strong>';
  corrected.querySelector('strong').textContent = displayValue(correction.label, correction.correctedValue);
  values.append(original, corrected);
  const copy = document.createElement('p');
  copy.className = 'review-card-copy';
  copy.textContent = correction.explanation || '根据资料中的明确数字重新计算得到。';
  const actions = document.createElement('div');
  actions.className = 'review-correction-actions';
  for (const [choice, text] of [['accept','采用正确值'],['keep','保留原数据']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.correctionChoice = choice;
    button.dataset.correctionIndex = String(index);
    button.textContent = text;
    actions.append(button);
  }
  card.append(head, values, copy, actions);
  return card;
}

function updateReviewConfirmState() {
  const pending = state.pendingFileReview;
  if (!pending || pending.mode === 'report') return;
  const proven = (pending.result.corrections || []).filter((item) => item.kind === 'calculation_error');
  const decided = proven.filter((_, index) => pending.correctionDecisions[index]).length;
  if (decided < proven.length) {
    $('confirm-file').disabled = true;
    $('file-review-warning').textContent = `还有 ${proven.length - decided} 个计算错误，请先选择“采用正确值”或“保留原数据”。`;
    return;
  }
  $('confirm-file').disabled = false;
  $('file-review-warning').textContent = '请先确认识别内容。确认后，这份资料才会用于经营诊断。';
}

function renderLegacyFileReview(file, contentBase64, result) {
  const reviewModel = buildFileReviewModel(result);
  state.pendingFileReview = { file, contentBase64, result, reviewModel, mode:'legacy', correctionDecisions:{} };
  const corrections = Array.isArray(result.corrections) ? result.corrections : [];
  const provenCorrections = corrections.filter((item) => item.kind === 'calculation_error');
  const mainIssues = [
    ...corrections.filter((item) => item.kind !== 'calculation_error').map((item) => ({ text:item.label || '数据需要确认', explanation:item.explanation, context:Array.isArray(item.evidence) ? item.evidence.join('；') : '' })),
    ...plainAuditIssues(result)
  ];
  $('file-review-confidence').textContent = '资料已读取';
  $('file-review-lead').textContent = '系统先检查能确定的数据问题，再进入经营诊断。';
  const summary = $('file-review-summary');
  summary.replaceChildren();
  summary.append(summaryItem(`${result.summary?.rowCount || 0} 行`, '已读取数据'));
  summary.append(summaryItem(`${provenCorrections.length} 个`, '确定的计算错误'));
  summary.append(summaryItem(`${mainIssues.length} 处`, '需要确认'));
  const correctionsList = $('file-review-corrections-list');
  correctionsList.replaceChildren();
  provenCorrections.forEach((item, index) => correctionsList.append(renderCorrectionCard(item, index)));
  $('file-review-corrections').hidden = provenCorrections.length === 0;
  const importantList = $('file-review-important-list');
  importantList.replaceChildren();
  mainIssues.forEach((item) => importantList.append(renderIssueCard(item)));
  $('file-review-important').hidden = mainIssues.length === 0;
  $('file-review-other').hidden = true;
  $('file-review-fulltext').hidden = true;
  $('file-review-warning').textContent = '';
  $('file-review').hidden = false;
  $('file-errors').textContent = '';
  updateReviewConfirmState();
}

function renderFileReview(file, contentBase64, result) {
  if (result.reportReview) return renderReportReview(file, contentBase64, result);
  return renderLegacyFileReview(file, contentBase64, result);
}

function resetUploadedFileState() {
  state.originalFile = null;
  state.originalBase64 = '';
  state.audit = null;
  clearPendingFileReview();
  state.diagnosis.documents = [];
  state.diagnosis.analysisTokens = [];
  state.diagnosis.correctionDecisions = [];
  state.diagnosis.diagnosisToken = null;
  state.diagnosis.evidence = state.diagnosis.evidence.filter((item) => !(typeof item === 'string' && (
    item.startsWith('file_analysis:') || item.startsWith('correction_decision:') || item.startsWith('file_review:') ||
    item.startsWith('report_fact:') || item.startsWith('report_issue:') || item.startsWith('report_review_confirmation:')
  )));
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


async function postFileAnalysis(file, contentBase64, { signal } = {}) {
  let response;
  try {
    response = await fetch('/api/analyze-file', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ file:{ name:file.name, contentBase64 } }),
      signal
    });
  } catch (cause) {
    if (signal?.aborted || cause?.name === 'AbortError') throw cause;
    const error = new Error('分析请求没有正常连接到服务器。请保持页面打开并重试。');
    error.code = 'FILE_TRANSPORT_FAILED';
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `文件分析请求失败 (${response.status})`);
    error.requestId = data.requestId || '';
    error.status = response.status;
    throw error;
  }
  return data;
}

function correctionDecisionSelections(pending) {
  const corrections = (pending?.result?.corrections || []).filter((item) => item.kind === 'calculation_error');
  return corrections.map((correction, index) => {
    const choice = pending.correctionDecisions[index];
    const decision = choice === 'accept' ? 'accepted' : 'kept_original';
    return { correctionId:correction.id, decision };
  });
}

function diagnosisDocument(result) {
  if (!result.reportReview || result.document?.type !== 'image') return result.document;
  return {
    name:result.document.name,
    type:'image',
    structured:false,
    source:result.document.source,
    confidence:result.document.confidence,
    warnings:['原始 OCR 全文未作为诊断事实传入；诊断使用已验证的结构化报表事实。']
  };
}

function commitSuccessfulFileAnalysis(file, contentBase64, result, correctionDecisions = []) {
  if (result.document.type === 'excel') {
    state.originalFile = file;
    state.originalBase64 = contentBase64;
  } else {
    state.originalFile = null;
    state.originalBase64 = '';
  }
  state.audit = result.audit;
  state.diagnosis.documents = [diagnosisDocument(result)];
  state.diagnosis.analysisTokens = result.analysisToken ? [result.analysisToken] : [];
  state.diagnosis.correctionDecisions = correctionDecisions;
  state.diagnosis.diagnosisToken = null;
  state.diagnosis.findings = [];
  renderFindings([]);
  $('file-status').textContent = fileStatusText(result);
  $('file-errors').textContent = '';
  updateDownloadState();
  saveSession();
}

function requiresFileReview(result) {
  return Boolean(result.reportReview || (result.corrections || []).length || (result.audit?.errors || []).length);
}

function applySuccessfulFileAnalysis(file, contentBase64, result) {
  if (result.document?.type === 'image') {
    renderFileReview(file, contentBase64, result);
    return;
  }
  if (requiresFileReview(result)) {
    renderFileReview(file, contentBase64, result);
    return;
  }
  clearPendingFileReview();
  commitSuccessfulFileAnalysis(file, contentBase64, result);
}

function confirmPendingFileReview() {
  const pending = state.pendingFileReview;
  if (!pending) return;
  if (pending.mode === 'report' && pending.result.reportReview?.summary?.recognitionMode === 'ocr_unavailable') {
    $('confirm-file').disabled = true;
    $('file-review-warning').textContent = '这张报表还没有可靠识别，请重新上传更清晰的图片后再继续诊断。';
    return;
  }
  if ($('confirm-file').disabled) return;
  const correctionDecisions = pending.mode === 'report' ? [] : correctionDecisionSelections(pending);
  state.pendingFileReview = null;
  hideFileReview();
  commitSuccessfulFileAnalysis(pending.file, pending.contentBase64, pending.result, correctionDecisions);
  $('file-status').textContent = `${fileStatusText(pending.result)} 已确认资料检查结果。`;
}

function replacePendingFileReview() {
  if (!state.pendingFileReview) return;
  clearPendingFileReview();
  $('file-status').textContent = '未使用刚才的资料，请重新选择经营资料。';
  $('file-errors').textContent = '';
  $('workbook').value = '';
  $('workbook').click();
}

function chooseCorrection(index, choice) {
  const pending = state.pendingFileReview;
  if (!pending || pending.mode === 'report') return;
  pending.correctionDecisions[index] = choice;
  for (const button of document.querySelectorAll(`[data-correction-index="${index}"]`)) button.classList.toggle('selected', button.dataset.correctionChoice === choice);
  updateReviewConfirmState();
}

async function analyzeBusinessFile(file) {
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
  $('file-status').textContent = previousDocument ? '正在分析新资料；此前成功分析的资料会保留到新结果确认后再替换。' : '';
  setFileProgress(2, isImageFile(file) ? '正在优化图片' : '正在读取文件', { reset:true });
  setFileProgressActions({ analyzing:true, retry:false });
  startFileElapsedTimer();
  try {
    const transportFile = isImageFile(file) ? await optimizeImageForOcr(file, { signal:controller.signal }) : file;
    if (transportFile.size > MAX_FILE_BYTES) throw new Error('优化后的文件仍超过 3 MB，请先裁剪或压缩后再上传');
    if (transportFile !== file) setFileProgress(6, '图片已优化，正在读取');
    const contentBase64 = await fileToBase64(transportFile, {
      signal:controller.signal,
      onProgress:(fraction) => setFileProgress(2 + fraction * 6, transportFile !== file ? '正在读取优化后的图片' : '正在读取文件')
    });
    setFileProgress(8, '正在上传资料');
    setFileProgress(15, '正在分析报表，请保持页面打开');
    const result = await postFileAnalysis(transportFile, contentBase64, { signal:controller.signal });
    if (controller.signal.aborted || state.diagnosis.id !== capturedDiagnosisId) return;
    applySuccessfulFileAnalysis(file, contentBase64, result);
    state.pendingFile = null;
    const reportSummary = result.reportReview?.summary || null;
    const completionMessage = result.document?.type === 'image'
      ? (reportSummary?.recognitionMode === 'ocr_unavailable'
          ? '报表识别未完成，请重新上传'
          : reportSummary?.completeReview === true
            ? '报表检查完成，等待确认'
            : '报表检查未完成，等待核对')
      : (requiresFileReview(result) ? '报表检查完成，等待确认' : '分析完成');
    setFileProgress(100, completionMessage);
    setFileProgressActions({ analyzing:false, retry:false });
  } catch (error) {
    if (state.diagnosis.id !== capturedDiagnosisId) return;
    const cancelled = error?.name === 'AbortError';
    let baseMessage;
    if (cancelled) baseMessage = '已取消分析。';
    else if (error.code === 'FILE_TRANSPORT_FAILED') baseMessage = `${error.message}（错误类型：FILE_TRANSPORT_FAILED）`;
    else if (error.status === 429) baseMessage = errorWithRequestId('文件分析请求较频繁，请稍后再试。', error.requestId);
    else baseMessage = errorWithRequestId(`文件分析失败：${error.message}`, error.requestId);
    $('file-errors').textContent = `${baseMessage}${previousDocument ? ' 此前成功分析的资料仍保留。' : ''}`;
    $('file-progress-message').textContent = cancelled ? '分析已取消，可重新分析' : '分析已中断，可重新分析';
    setFileProgressActions({ analyzing:false, retry:Boolean(state.pendingFile) });
  } finally {
    if (state.fileAnalysisController === controller) {
      stopFileElapsedTimer();
      renderFileElapsed();
      $('workbook').disabled = false;
      state.fileAnalysisController = null;
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
  if (!state.originalFile || !state.originalBase64 || !state.diagnosis.findings.length || !state.diagnosis.diagnosisToken) return;
  $('request-error').textContent = '';
  $('download-excel').disabled = true;
  try {
    const result = await postJson('/api/report', {
      file:{ name:state.originalFile.name, contentBase64:state.originalBase64 },
      diagnosisToken:state.diagnosis.diagnosisToken
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

function retryPendingFile() {
  if (!state.pendingFile || state.fileAnalysisController) return;
  analyzeBusinessFile(state.pendingFile);
}

$('send').addEventListener('click', sendDiagnosis);
$('retry-diagnosis').addEventListener('click', () => { if (state.pendingDiagnosisRequest) requestDiagnosis(); });
$('new-diagnosis').addEventListener('click', resetDiagnosisExperience);
$('owner-input').addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') sendDiagnosis(); });
$('workbook').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) analyzeBusinessFile(file);
});
$('cancel-file').addEventListener('click', () => { state.fileAnalysisController?.abort(); });
$('retry-file').addEventListener('click', () => { retryPendingFile(); });
$('file-review-corrections').addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-correction-choice]');
  if (!button) return;
  const index = Number(button.dataset.correctionIndex);
  if (Number.isInteger(index)) chooseCorrection(index, button.dataset.correctionChoice);
});
$('confirm-file').addEventListener('click', confirmPendingFileReview);
$('replace-file').addEventListener('click', replacePendingFileReview);
$('download-excel').addEventListener('click', downloadReport);

restoreSession();
