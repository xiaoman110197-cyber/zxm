const $ = (id) => document.getElementById(id);
const PRIORITIES = ['P0', 'P1', 'P2'];
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

async function analyzeWorkbook(file) {
  $('file-errors').textContent = '';
  $('file-status').textContent = `正在分析 ${file.name}…`;
  try {
    const contentBase64 = await fileToBase64(file);
    const result = await postJson('/api/analyze-file', { file: { name: file.name, contentBase64 } });
    state.originalFile = file;
    state.originalBase64 = contentBase64;
    state.audit = result.audit;
    state.diagnosis.documents = [result.document];
    state.diagnosis.evidence.push(`excel_audit:${JSON.stringify(result.summary)}`);
    $('file-status').textContent = `已读取 ${result.summary.sheetCount} 个 Sheet；发现 ${result.summary.errorCount} 个数据错误、${result.summary.anomalyCount} 个经营异常。`;
    if (result.audit.errors?.length) $('file-errors').textContent = `数据错误：${result.audit.errors.map(e => e.reason || e.type).join('；')}`;
    updateDownloadState();
  } catch (error) {
    state.originalFile = null;
    state.originalBase64 = '';
    state.audit = null;
    updateDownloadState();
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
  if (file) analyzeWorkbook(file);
});
$('download-excel').addEventListener('click', downloadReport);
