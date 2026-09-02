const consultationState = {
  lastRequest:null,
  analysis:null,
  editedReply:'',
  decision:'pending',
  connector:null
};

const consultationChannelLabels = {
  web:'Web',
  wecom:'企业微信',
  feishu:'飞书',
  dingtalk:'钉钉',
  workbuddy:'WorkBuddy',
  douyin:'抖音'
};

const consultationStageLabels = {
  new_inquiry:'新咨询',
  qualified:'需求已初步明确',
  booking_intent:'有预约意向',
  followup:'跟进中',
  aftersales:'售后 / 复购阶段'
};

const consultationPriorityLabels = { low:'低', medium:'中', high:'高' };
const consultationDueLabels = {
  today:'今天',
  within_24h:'24小时内',
  before_appointment:'预约前',
  none:'未指定'
};

function consultationEl(id){ return document.getElementById(id); }

function consultationList(id, items, emptyText='暂无'){
  const root = consultationEl(id);
  if (!root) return;
  root.replaceChildren();
  if (!Array.isArray(items) || !items.length) {
    root.textContent = emptyText;
    return;
  }
  const list = document.createElement('ul');
  list.className = 'consultation-list';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = String(item);
    list.append(li);
  }
  root.append(list);
}

function setConsultationActions(enabled){
  for (const id of ['consultationEdit','consultationRegenerate','consultationHold','consultationApprove']) {
    const node = consultationEl(id);
    if (node) node.disabled = !enabled;
  }
}

function updateConsultationChannelStatus(){
  const select = consultationEl('consultationChannel');
  const status = consultationEl('consultationChannelStatus');
  if (!select || !status) return;
  const channel = select.value;
  const label = consultationChannelLabels[channel] || channel;
  status.textContent = channel === 'web'
    ? 'Web 当前只用于体验输入；本页不会自动向客户外发消息。'
    : `来源已标记为${label}；该渠道当前为待接接口，本次只分析、不外发。`;
}

function renderConsultation(data){
  const analysis = data?.analysis || {};
  consultationState.lastRequest = data?.requestId || null;
  consultationState.analysis = analysis;
  consultationState.editedReply = analysis.answer || '';
  consultationState.decision = 'pending';
  consultationState.connector = data?.connector || null;

  consultationEl('consultationNeed').textContent = analysis.customerNeed || '暂未识别到明确需求。';
  consultationList('consultationKnown', analysis.knownFacts, '当前没有额外确认事实。');
  consultationList('consultationMissingCustomer', analysis.missingCustomerInfo, '暂时不需要继续向客户补问。');
  consultationList('consultationMissingBusiness', analysis.missingBusinessFacts, '当前没有识别到缺失的商家事实。');
  consultationEl('consultationStage').textContent = consultationStageLabels[analysis?.lead?.stage] || analysis?.lead?.stage || '未判断';

  const risk = consultationEl('consultationRisk');
  if (risk) {
    const risky = analysis?.risk?.level === 'required_professional_handoff' || analysis?.risk?.level === 'human_review';
    risk.hidden = !risky;
    const p = risk.querySelector('p');
    if (p) p.textContent = risky ? (analysis?.risk?.reason || '这条咨询需要人工确认后再处理。') : '';
  }

  const reply = consultationEl('consultationReply');
  if (reply) reply.value = analysis.answer || '';

  const task = analysis.nextTask || {};
  const taskParts = [task.title || '继续确认客户需求'];
  if (task.priority) taskParts.push(`优先级：${consultationPriorityLabels[task.priority] || task.priority}`);
  if (task.dueHint) taskParts.push(`建议时点：${consultationDueLabels[task.dueHint] || task.dueHint}`);
  if (task.reason) taskParts.push(task.reason);
  consultationEl('consultationTask').textContent = taskParts.join(' · ');

  const channel = data?.connector?.channel || consultationEl('consultationChannel')?.value || 'web';
  const label = consultationChannelLabels[channel] || channel;
  const channelState = data?.connector?.enabled ? '体验入口' : '待接接口';
  consultationEl('consultationTrace').textContent = `AI：${data?.provider || 'DeepSeek'} · 模型：${data?.model || '未返回'} · 请求ID：${data?.requestId || '未返回'} · 来源：${label}（${channelState}）`;
  consultationEl('consultationDecision').textContent = 'AI 已生成完整回复，但当前没有执行任何发送动作。';
  setConsultationActions(true);
}

async function analyzeConsultation({ regenerate=false } = {}){
  const conversation = consultationEl('consultationConversation')?.value.trim() || '';
  if (!conversation) {
    consultationEl('consultationStatus').textContent = '请先粘贴客户消息或聊天记录。';
    return;
  }

  const analyzeButton = consultationEl('consultationAnalyze');
  const regenerateButton = consultationEl('consultationRegenerate');
  if (analyzeButton) analyzeButton.disabled = true;
  if (regenerateButton) regenerateButton.disabled = true;
  consultationEl('consultationStatus').textContent = regenerate ? '正在让 DeepSeek 重新生成完整回复…' : 'DeepSeek 正在分析客户咨询…';

  const body = {
    industry:consultationEl('consultationIndustry')?.value || 'other',
    channel:consultationEl('consultationChannel')?.value || 'web',
    conversationText:conversation,
    businessContext:consultationEl('consultationBusinessContext')?.value || '',
    regenerateFrom:regenerate ? (consultationEl('consultationReply')?.value || consultationState.editedReply || '') : ''
  };

  try {
    const response = await fetch('/api/experience-consultation', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
    renderConsultation(data);
    consultationEl('consultationStatus').textContent = regenerate ? '已重新生成。操作人员可以继续修改、暂不回复或确认采用。' : '分析完成。操作人员可以修改答案、重新生成、暂不回复或确认采用。';
  } catch (error) {
    consultationEl('consultationStatus').textContent = `AI咨询分析暂不可用：${error.message || '请稍后重试'}`;
  } finally {
    if (analyzeButton) analyzeButton.disabled = false;
    if (regenerateButton) regenerateButton.disabled = !consultationState.analysis;
  }
}

function editConsultationReply(){
  consultationEl('consultationReply')?.focus();
  consultationEl('consultationDecision').textContent = '正在编辑答案；还没有对客户发送消息。';
}

function holdConsultationReply(){
  consultationState.decision = 'held';
  consultationState.editedReply = consultationEl('consultationReply')?.value || '';
  consultationEl('consultationDecision').textContent = '已选择暂不回复；没有对客户发送消息。';
}

function approveConsultationReply(){
  consultationState.decision = 'approved';
  consultationState.editedReply = consultationEl('consultationReply')?.value || '';
  const channel = consultationState.connector?.channel || consultationEl('consultationChannel')?.value || 'web';
  const label = consultationChannelLabels[channel] || channel;
  consultationEl('consultationDecision').textContent = `已批准采用这条回复；当前体验版没有对客户发送消息。${label}如需真实发送，必须接入授权渠道接口后再由操作人员确认。`;
}

consultationEl('consultationChannel')?.addEventListener('change', updateConsultationChannelStatus);
consultationEl('consultationAnalyze')?.addEventListener('click', () => analyzeConsultation());
consultationEl('consultationRegenerate')?.addEventListener('click', () => analyzeConsultation({ regenerate:true }));
consultationEl('consultationEdit')?.addEventListener('click', editConsultationReply);
consultationEl('consultationHold')?.addEventListener('click', holdConsultationReply);
consultationEl('consultationApprove')?.addEventListener('click', approveConsultationReply);
consultationEl('consultationReply')?.addEventListener('input', (event) => {
  consultationState.editedReply = event.target.value;
  if (consultationState.decision === 'approved') {
    consultationState.decision = 'pending';
    consultationEl('consultationDecision').textContent = '答案已修改，需要重新确认采用；未连接外部渠道，没有自动发送。';
  }
});

updateConsultationChannelStatus();
setConsultationActions(false);
