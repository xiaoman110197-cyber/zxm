const $ = (id) => document.getElementById(id);
const PRIORITIES = ['P0', 'P1', 'P2'];
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const state = { diagnosis: { id: crypto.randomUUID(), answers: {}, evidence: [], findings: [], documents: [] }, turn: 0, originalFile: null, originalBase64: '', audit: null };

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

function resetUploadedFileState() {
  state.originalFile = null;
  state.originalBase64 = '';
  state.audit = null;
  state.diagnosis.documents = [];
  updateDownloadState();
}

async function analyzeBusinessFile(file) {
  $('file-errors').textContent = '';
  if (file.size > MAX_FILE_BYTES) {
    resetUploadedFileState();
    $('file-status').textContent = '';
    $('file-errors').textContent = '文件过大：当前版本单个文件最大支持 3 MB。';
    return;
  }

  $('file-status').textContent = `正在分析 ${file.name}…`;
  try {
    const contentBase64 = await fileToBase64(file);
    const result = await postJson('/api/analyze-file', { file: { name: file.name, contentBase64 } });

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
    updateDownloadState();
  } catch (error) {
    resetUploadedFileState();
    $('file-status').textContent = '';
    $('file-errors').textContent = `文件分析失败：${error.message}`;
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
$('download-excel').addEventListener('click', downloadReport);
