const v7State = {
  summary:null,
  source:null,
  summarySignature:'',
  bossConversation:[],
  inFlight:false
};
const bossConversation = v7State.bossConversation;
const originalFetch = window.fetch.bind(window);

function summarySignature(summary){
  if (!summary) return '';
  return JSON.stringify({
    ok:summary.ok,
    period:summary.period,
    usedSheet:summary.usedSheet,
    fieldCoverage:summary.fieldCoverage,
    metrics:summary.metrics,
    missing:summary.missing,
    channels:summary.channels,
    overdueOwners:summary.overdueOwners
  });
}

function ensureBossHistoryPanel(){
  if (document.getElementById('bossHistory')) return;
  const source = document.getElementById('bossSource');
  if (!source) return;
  const panel = document.createElement('div');
  panel.id = 'bossHistory';
  panel.className = 'info-box';
  panel.hidden = true;
  const title = document.createElement('b');
  title.textContent = '连续追问记录';
  const list = document.createElement('div');
  list.id = 'bossHistoryList';
  panel.append(title, list);
  source.insertAdjacentElement('afterend', panel);
}

function renderBossHistory(){
  ensureBossHistoryPanel();
  const panel = document.getElementById('bossHistory');
  const list = document.getElementById('bossHistoryList');
  if (!panel || !list) return;
  list.replaceChildren();
  const turns = bossConversation.slice(-8);
  panel.hidden = !turns.length;
  for (const turn of turns) {
    const line = document.createElement('p');
    line.className = 'fine-print';
    line.textContent = `${turn.role === 'assistant' ? '答' : '问'}：${String(turn.text || '').slice(0,500)}`;
    list.append(line);
  }
}

function resetBossConversation(){
  bossConversation.splice(0, bossConversation.length);
  renderBossHistory();
}

function rememberBossTurn(role, text){
  bossConversation.push({ role, text:String(text || '').slice(0,900) });
  if (bossConversation.length > 8) bossConversation.splice(0, bossConversation.length - 8);
  renderBossHistory();
}

window.fetch = async (input, init = {}) => {
  const response = await originalFetch(input, init);
  try {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const method = String(init?.method || 'GET').toUpperCase();
    if (url.includes('/api/experience-summary') && method === 'POST') {
      const data = await response.clone().json().catch(() => null);
      if (data?.summary) {
        const nextSignature = summarySignature(data.summary);
        if (nextSignature !== v7State.summarySignature) resetBossConversation();
        v7State.summary = data.summary;
        v7State.source = data.source || null;
        v7State.summarySignature = nextSignature;
      }
    }
  } catch {}
  return response;
};

function formatAiAnswer(answer){
  const parts = [];
  if (answer?.overview) parts.push(answer.overview);
  parts.push(`【降本】${answer?.cost || '当前数据不足以判断更多降本空间。'}`);
  parts.push(`【增效】${answer?.efficiency || '当前数据不足以判断更多效率问题。'}`);
  parts.push(`【增利】${answer?.profit || '当前数据不足以判断利润。'}`);
  const actions = Array.isArray(answer?.actions) ? answer.actions.filter(Boolean).slice(0,3) : [];
  if (actions.length) parts.push(`建议老板先处理：\n${actions.map((item, index) => `${index + 1}. ${item}`).join('\n')}`);
  const limits = Array.isArray(answer?.limits) ? answer.limits.filter(Boolean).slice(0,6) : [];
  if (limits.length) parts.push(`暂时不能确定：${limits.join('；')}`);
  return parts.join('\n\n');
}

function fallbackRealAnswer(summary){
  if (!summary?.ok) return `当前上传数据还不足以形成可靠经营汇总。${summary?.reason ? `原因：${summary.reason}。` : ''}`;
  const metrics = summary.metrics || {};
  const lines = [];
  lines.push(`当前可确认 ${metrics.records ?? 0} 条业务记录。`);
  if (metrics.revenue == null) lines.push('营业额暂时无法判断。');
  else lines.push(`营业额 ${new Intl.NumberFormat('zh-CN', { style:'currency', currency:'CNY', maximumFractionDigits:0 }).format(metrics.revenue)}。`);
  if (metrics.overdue != null) lines.push(`有 ${metrics.overdue} 项逾期任务。`);
  if (metrics.noShows != null) lines.push(`有 ${metrics.noShows} 名未到店/爽约。`);
  lines.push('利润暂时不能由营业额直接推出；需要成本、毛利率或利润字段。');
  if (summary.missing?.length) lines.push(`还缺：${summary.missing.join('、')}。`);
  return lines.join('\n');
}

async function askBossQuestion(questionOverride = ''){
  const input = document.getElementById('bossQuestion');
  const answerNode = document.getElementById('bossAnswer');
  const sourceNode = document.getElementById('bossSource');
  const button = document.getElementById('bossAsk');
  const question = String(questionOverride || input?.value || '').trim();
  if (!question || !v7State.summary || v7State.inFlight) return;

  rememberBossTurn('owner', question);
  if (!v7State.summary.ok) {
    const fallback = fallbackRealAnswer(v7State.summary);
    answerNode.textContent = fallback;
    sourceNode.textContent = '依据：当前上传表格的程序汇总 · 数据字段不足，未调用大模型。';
    rememberBossTurn('assistant', fallback);
    return;
  }

  v7State.inFlight = true;
  button.disabled = true;
  const previousLabel = button.textContent;
  button.textContent = 'AI 正在分析…';
  answerNode.textContent = 'AI 正在分析老板的问题；数字仍由程序计算，大模型只负责理解和表达。';

  try {
    const history = bossConversation.slice(0, -1).slice(-8);
    const response = await originalFetch('/api/experience-question', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({
        question,
        summary:v7State.summary,
        source:v7State.source,
        history
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
    const rendered = formatAiAnswer(data.answer || {});
    answerNode.textContent = rendered;
    const evidence = Array.isArray(data.evidence) ? data.evidence.filter(Boolean) : [];
    sourceNode.textContent = `依据：${evidence.length ? evidence.join(' · ') : '当前程序汇总'}${data.modelUsed ? ` · AI表达：${data.model || '大模型'}` : ' · 未调用大模型'}`;
    rememberBossTurn('assistant', rendered);
  } catch (error) {
    const fallback = fallbackRealAnswer(v7State.summary);
    const rendered = `AI经营问答暂时不可用，本次显示程序汇总。\n\n${fallback}`;
    answerNode.textContent = rendered;
    sourceNode.textContent = `大模型暂时不可用 · 当前仍基于已上传表格的程序汇总回答${error?.message ? ` · ${String(error.message).slice(0,120)}` : ''}`;
    rememberBossTurn('assistant', rendered);
  } finally {
    v7State.inFlight = false;
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

function attachV7BossHandlers(){
  ensureBossHistoryPanel();
  const ask = document.getElementById('bossAsk');
  ask?.addEventListener('click', (event) => {
    if (!v7State.summary) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    askBossQuestion();
  }, true);

  document.querySelectorAll('[data-question]').forEach((button) => {
    button.addEventListener('click', (event) => {
      if (!v7State.summary) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const question = button.dataset.question || button.textContent || '';
      const input = document.getElementById('bossQuestion');
      if (input) input.value = question;
      askBossQuestion(question);
    }, true);
  });

  document.getElementById('bossQuestion')?.addEventListener('keydown', (event) => {
    if (!v7State.summary || event.key !== 'Enter') return;
    event.preventDefault();
    askBossQuestion();
  });

  document.getElementById('clearBusinessFile')?.addEventListener('click', () => {
    v7State.summary = null;
    v7State.source = null;
    v7State.summarySignature = '';
    resetBossConversation();
  });
}

attachV7BossHandlers();
