const $ = (id) => document.getElementById(id);
const money = (value) => new Intl.NumberFormat('zh-CN', { style:'currency', currency:'CNY', maximumFractionDigits:0 }).format(value || 0);
const numberValue = (id) => {
  const raw = $(id)?.value;
  return raw === '' || raw == null ? null : Number(raw);
};

let realBusinessSummary = null;
let realBusinessSource = null;

const taskWeights = { reply:.5, collect:.62, copy:.76, book:.55, remind:.68, follow:.66 };
const leakLabels = { reply:'存在漏回复风险', booking:'存在漏预约或撞档风险', follow:'存在漏回访/漏跟进风险', renew:'存在漏复诊/续费/续期风险', quote:'存在报价后无人跟进风险', conflict:'存在排班/资源冲突风险' };
const industryPilots = {
  massage:'预约信息自动整理 → 人员/档期检查 → 到店异常提醒 → 老板日报',
  clinic:'咨询/预约信息整理 → 到诊/复诊待办 → 异常清单 → 老板日报',
  legal:'咨询事实整理 → 材料缺口 → 分案/跟进任务 → 主任经营摘要',
  home:'客户需求整理 → 量房/报价任务 → 逾期跟进 → 销售日报',
  other:'统一客户与业务台账 → 自动任务 → 异常清单 → 老板摘要'
};

const moduleCatalog = {
  data:{name:'自动数据台账', value:['降本','增效'], description:'把 Excel、POS、CRM、预约等来源整理成统一台账。', needs:'📊 数据源 · 🗄️ 数据库 · ⚙️ 清洗校验 · 🧠 大模型（复杂表格时）'},
  task:{name:'任务与异常提醒', value:['降本','增效'], description:'逾期、爽约、冲突、缺数据自动进入待办。', needs:'🗄️ 业务台账 · ⚙️ 规则引擎 · 💬 通知入口（可选）'},
  boss:{name:'老板经营助理', value:['增效','增利'], description:'老板直接问今天怎样、哪里异常、先处理什么。', needs:'🧠 大模型 · 📊 经营数据 · ⚙️ 指标计算 · 💬 消息入口（可选）'},
  reception:{name:'AI 客户接待', value:['增效','增利'], description:'整理咨询、补齐信息、生成可修改回复草稿。', needs:'🧠 大模型 · 💬 客户入口 · 🗄️ 客户/CRM 台账 · 👤 人工确认'},
  booking:{name:'预约与排班', value:['增效','增利'], description:'检查档期、人员/资源冲突并减少空档。', needs:'📅 预约/排班数据 · 🗄️ 数据库 · ⚙️ 冲突规则 · 💬 通知入口'},
  sales:{name:'销售/咨询跟进', value:['增效','增利'], description:'线索阶段、报价、跟进和成交节点不再靠人记。', needs:'🗄️ CRM/客户台账 · ⚙️ 任务系统 · 🧠 大模型（摘要/回复可选）'},
  retention:{name:'会员/复购/复诊', value:['增利'], description:'找出到期、沉睡、应复诊客户并创建回访任务。', needs:'📊 会员/消费/复诊数据 · 🗄️ 客户台账 · ⚙️ 召回规则'},
  staff:{name:'员工业绩分析', value:['增效','增利'], description:'看处理量、转化、业绩和资源利用率。', needs:'📊 员工/POS/CRM/排班数据 · ⚙️ 指标计算'},
  content:{name:'内容营销', value:['增利'], description:'活动和社媒内容辅助，根据实际业务再开。', needs:'🧠 大模型 · 📣 内容渠道 · 👤 人工审核'}
};

const statusLabels = { enabled:'✅ 已启用', recommended:'◐ 建议开启', optional:'○ 可选', locked:'🔒 待接数据', na:'— 当前不适用' };

function selectedTasks(){ return [...document.querySelectorAll('#diagTasks input:checked')].map((node) => node.value); }

function moduleStatus(industry, goal, tasks, leak){
  const status = { data:'enabled', task:'enabled', boss:'enabled', reception:'optional', booking:'optional', sales:'optional', retention:'locked', staff:'locked', content:'optional' };
  if (tasks.includes('reply') || tasks.includes('collect') || leak === 'reply') status.reception = 'recommended';
  if (tasks.includes('book') || leak === 'booking' || leak === 'conflict') status.booking = 'recommended';
  if (tasks.includes('follow') || leak === 'follow' || leak === 'quote') status.sales = 'recommended';
  if (leak === 'renew') status.retention = 'recommended';
  if (goal === 'data') status.data = 'recommended';
  if (goal === 'capacity') status.staff = 'recommended';
  if (industry === 'legal') status.booking = 'na';
  if (industry === 'home') status.retention = 'na';
  return status;
}

function renderModuleCenter(industry, goal, tasks, leak){
  const status = moduleStatus(industry, goal, tasks, leak);
  $('moduleCards').replaceChildren();
  const recommended = [];
  for (const [key, module] of Object.entries(moduleCatalog)) {
    const state = status[key];
    if (state === 'recommended') recommended.push(module.name);
    const card = document.createElement('article');
    card.className = `module-card state-${state}`;
    card.innerHTML = `<div class="module-head"><h3></h3><span></span></div><p class="module-desc"></p><div class="value-tags"></div><div class="needs"></div>`;
    card.querySelector('h3').textContent = module.name;
    card.querySelector('.module-head span').textContent = statusLabels[state];
    card.querySelector('.module-desc').textContent = module.description;
    card.querySelector('.value-tags').textContent = module.value.join(' · ');
    card.querySelector('.needs').textContent = `正式部署需要：${module.needs}`;
    $('moduleCards').append(card);
  }
  $('moduleOpportunity').textContent = recommended.length ? `当前优先建议：${recommended.join('、')}。先小范围试点，验证有效再开下一模块。` : '当前没有明显需要额外开启的模块；先把基础数据台账、异常提醒和老板经营助理跑稳。';
}

function diagnoseROI(){
  const volume = numberValue('diagVolume');
  const avg = numberValue('diagAvgTime');
  const duplicate = numberValue('diagDuplicate');
  const report = numberValue('diagReport');
  const salary = numberValue('diagSalary');
  const ticket = numberValue('diagTicket');
  const margin = numberValue('diagMargin');
  const lostCustomers = numberValue('diagLostCustomers');
  const leak = $('diagLeak').value || null;
  const tasks = selectedTasks();
  const industry = $('diagIndustry').value;
  const goal = $('diagGoal').value;

  const core = [volume, avg, duplicate, report, salary, leak, tasks.length ? 1 : null];
  const known = core.filter((value) => value !== null).length;
  const confidence = known >= 6 ? '高' : known >= 3 ? '中' : '低';
  $('diagConfidence').textContent = `${confidence}置信度`;
  $('diagConfidenceNote').textContent = confidence === '高' ? '流程信息较完整，可以给出相对具体的区间；仍需真实试点校准。' : confidence === '中' ? '可以做初步流程判断，部分数字仍需真实数据校准。' : '目前信息较少，只给方向性判断，不强行估算。';

  let lowHours = null;
  let highHours = null;
  if (volume !== null && avg !== null && tasks.length) {
    const weight = tasks.reduce((sum, key) => sum + taskWeights[key], 0) / tasks.length;
    const share = Math.min(.82, Math.max(.25, weight + (duplicate ? Math.min(.12, duplicate * .04) : 0)));
    const taskHours = volume * avg * 26 / 60;
    const reportHours = report !== null ? report * 26 : 0;
    const automatable = taskHours * share + reportHours * .72;
    lowHours = automatable * .45;
    highHours = automatable * .8;
    const reductionLow = Math.min(.55, share * .45);
    const reductionHigh = Math.min(.68, share * .8);
    $('diagHours').textContent = `约 ${Math.round(lowHours)}–${Math.round(highHours)} 小时/月可进入试点`;
    $('diagEfficiencyMain').textContent = `重复处理时间预计可减少 ${Math.round(reductionLow*100)}%–${Math.round(reductionHigh*100)}%`;
    const capLow = Math.round((1/(1-reductionLow)-1)*100);
    const capHigh = Math.min(120, Math.round((1/(1-reductionHigh)-1)*100));
    $('diagEfficiencyNote').textContent = `在业务量不变时，同样人手理论处理容量约可提升 ${capLow}%–${capHigh}%；这是试点假设，不是承诺。`;
  } else {
    $('diagHours').textContent = '暂不估算工时 · 数据不足';
    $('diagEfficiencyMain').textContent = '暂不估算效率提升';
    $('diagEfficiencyNote').textContent = '需要业务量、单条耗时和实际步骤后再测算。';
  }

  if (salary !== null && lowHours !== null && highHours !== null) {
    const hourly = salary / 174;
    $('diagMoney').textContent = `对应工时价值（仅测算）：${money(lowHours*hourly)}–${money(highHours*hourly)} / 月`;
  } else {
    $('diagMoney').textContent = '暂不估算人工金额；不知道月薪也不影响流程诊断。';
  }

  if (ticket !== null && margin !== null && lostCustomers !== null && lostCustomers > 0) {
    const grossPool = lostCustomers * ticket * (margin/100);
    $('diagProfitMain').textContent = `约 ${money(grossPool*.25)}–${money(grossPool*.5)} / 月毛利机会`;
    $('diagProfitNote').textContent = `按明确流失 ${lostCustomers} 人、客单 ${money(ticket)}、毛利率 ${margin}% 测算，并假设试点能减少 25%–50% 这类流失；不代表一定成交。`;
  } else {
    $('diagProfitMain').textContent = '暂不估算利润金额';
    const missing = [];
    if (ticket === null) missing.push('平均客单/项目价值');
    if (margin === null) missing.push('毛利率');
    if (lostCustomers === null) missing.push('每月明确流失客户数');
    $('diagProfitNote').textContent = lostCustomers === 0 ? '目前没有明确流失量，先看复购、空档和渠道投入是否还有利润空间。' : `先识别漏单、爽约、复购和空档机会${missing.length ? `；如要估金额还需 ${missing.join('、')}` : ''}。`;
  }

  const issues = [];
  if (duplicate !== null && duplicate >= 2) issues.push(`同一份资料重复录入 ${duplicate} 次以上`);
  if (leak && leak !== 'none') issues.push(leakLabels[leak]);
  if (report !== null && report >= .5) issues.push('老板/店长仍需人工整理经营数据');
  if (tasks.includes('copy')) issues.push('客户资料仍需跨系统复制');
  if (!issues.length) issues.push('当前证据还不够明确，建议先记录一周真实工作步骤和耗时');
  $('diagLoss').textContent = `${issues.slice(0,3).join('；')}。`;

  let pilot = industryPilots[industry];
  if (goal === 'data') pilot = '统一关键数据 → 自动生成老板日报 → 异常事项单独提醒';
  if (goal === 'miss') pilot = '统一客户/预约台账 → 设置截止时间 → 逾期自动提醒 → 每日异常清单';
  if (goal === 'capacity') pilot = 'AI先完成信息整理与初步分流 → 员工只处理需要判断和成交的部分';
  $('diagPilot').textContent = `${pilot}。首轮只跑一个流程，不建议一次改造全部系统。`;

  const missing = [];
  if (volume === null) missing.push('每天咨询/预约量');
  if (avg === null) missing.push('单条业务耗时');
  if (!tasks.length) missing.push('员工实际重复步骤');
  if (report === null) missing.push('老板整理数据时间');
  if (ticket === null) missing.push('平均客单（仅估增利金额需要）');
  if (margin === null) missing.push('毛利率（仅估增利金额需要）');
  if (lostCustomers === null) missing.push('明确流失客户数（仅估增利金额需要）');
  $('diagMissing').textContent = missing.length ? `${missing.join('、')}。这些都可以在真实试点时再补。` : '基础信息较完整；下一步用 5–7 天真实数据校准。';
  $('diagBasis').textContent = '系统根据已知流程信息做区间诊断。降本看重复工时，增效看处理时间和流程容量，增利只有在客单、毛利和明确流失数据齐全时估金额。';

  renderModuleCenter(industry, goal, tasks, leak);
}

function fileToBase64(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取文件'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

function metricText(value, formatter){
  if (value === null || value === undefined) return '无法计算';
  return formatter ? formatter(value) : String(value);
}

function resetRealSummaryView(){
  for (const id of ['realRecords','realAppointments','realArrivals','realCompleted','realRevenue','realOverdue']) $(id).textContent = '—';
  $('businessUsedSheet').textContent = '等待上传。';
  $('businessCompleteness').textContent = '等待上传。';
  $('businessMissing').textContent = '等待上传。';
  $('businessWarnings').textContent = '等待上传。';
}

function renderRealBusinessSummary(){
  const summary = realBusinessSummary;
  if (!summary) { resetRealSummaryView(); return; }
  if (!summary.ok) {
    resetRealSummaryView();
    $('businessUsedSheet').textContent = summary.reason || '没有识别到足够业务字段。';
    $('businessCompleteness').textContent = '暂时无法形成经营汇总。';
    $('businessMissing').textContent = (summary.missing || []).join('、') || '请补充更明确的业务字段。';
    $('businessWarnings').textContent = (summary.warnings || []).join('；') || '当前文件无法用于老板经营问答。';
    $('bossDataMode').textContent = '已上传，但字段不足';
    return;
  }
  const metrics = summary.metrics || {};
  $('realRecords').textContent = metricText(metrics.records);
  $('realAppointments').textContent = metricText(metrics.appointments);
  $('realArrivals').textContent = metricText(metrics.arrivals);
  $('realCompleted').textContent = metricText(metrics.completed);
  $('realRevenue').textContent = metricText(metrics.revenue, money);
  $('realOverdue').textContent = metricText(metrics.overdue);
  $('businessUsedSheet').textContent = `主明细表：${summary.usedSheet || '未确认'}；统计范围：${summary.period === 'all' ? '整份主明细表' : summary.period}。`;
  $('businessCompleteness').textContent = `${summary.fieldCoverage ?? 0}%（按日期、客户、状态、金额、渠道、负责人、跟进等基础字段计算）。`;
  $('businessMissing').textContent = summary.missing?.length ? summary.missing.join('、') : '当前关键字段较完整。';
  $('businessWarnings').textContent = summary.warnings?.length ? summary.warnings.join('；') : '未发现需要额外说明的结构问题。';
  $('bossDataMode').textContent = `真实表格汇总 · ${realBusinessSource?.fileName || ''}`;
}

async function analyzeBusinessFile(){
  const file = $('businessFile').files?.[0];
  if (!file) { $('businessFileStatus').textContent = '请先选择 Excel 或 CSV。'; return; }
  if (file.size > 3 * 1024 * 1024) { $('businessFileStatus').textContent = '文件超过 3 MB，请先精简后再试。'; return; }
  $('analyzeBusinessFile').disabled = true;
  $('businessFileStatus').textContent = '正在读取并计算表格，请保持页面打开…';
  try {
    const contentBase64 = await fileToBase64(file);
    const response = await fetch('/api/experience-summary', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ file:{ name:file.name, contentBase64 } })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
    realBusinessSummary = data.summary || null;
    realBusinessSource = data.source || { fileName:file.name };
    $('businessFileStatus').textContent = realBusinessSummary?.ok ? '已完成真实表格汇总；老板问答已切换到真实数据模式。' : '表格已读取，但字段不足，老板问答会明确提示无法判断的部分。';
    renderRealBusinessSummary();
    bossAnswer();
  } catch (error) {
    realBusinessSummary = { ok:false, reason:error.message || '表格分析失败', missing:[], warnings:['请检查文件格式后重试。'], metrics:{} };
    realBusinessSource = { fileName:file.name };
    $('businessFileStatus').textContent = `分析失败：${error.message || '请重试'}`;
    renderRealBusinessSummary();
    bossAnswer();
  } finally {
    $('analyzeBusinessFile').disabled = false;
  }
}

function clearBusinessFile(){
  realBusinessSummary = null;
  realBusinessSource = null;
  $('businessFile').value = '';
  $('businessFileStatus').textContent = '已清除真实表格，老板问答恢复虚构演示数据。';
  $('bossDataMode').textContent = '演示数据';
  resetRealSummaryView();
  bossAnswer();
}

const business = {
  massage:{inquiries:32,valid:26,appointments:24,arrivals:16,completed:14,revenue:11860,overdue:5,noshow:3,conflicts:1,channel:'企业微信',owner:'前台小林',repeatOps:18,reportMinutes:45,idleSlots:2,recoverable:3,grossProfitPerOrder:140},
  clinic:{inquiries:30,valid:24,appointments:16,arrivals:12,completed:9,revenue:22600,overdue:6,noshow:4,conflicts:1,channel:'企业微信',owner:'顾问小吴',repeatOps:21,reportMinutes:50,idleSlots:2,recoverable:4,grossProfitPerOrder:520},
  legal:{inquiries:22,valid:18,appointments:10,arrivals:8,completed:4,revenue:38000,overdue:7,noshow:2,conflicts:0,channel:'客户转介绍',owner:'行政小叶',repeatOps:12,reportMinutes:60,idleSlots:0,recoverable:3,grossProfitPerOrder:2800},
  home:{inquiries:28,valid:21,appointments:12,arrivals:9,completed:3,revenue:58000,overdue:6,noshow:3,conflicts:1,channel:'抖音',owner:'销售小程',repeatOps:16,reportMinutes:55,idleSlots:1,recoverable:3,grossProfitPerOrder:4200}
};

function demoBossAnswer(){
  const d = business[$('bossIndustry').value];
  const q = $('bossQuestion').value.trim();
  const profitPool = d.recoverable * d.grossProfitPerOrder;
  if (q.includes('渠道')) return `当前演示记录里表现最好的渠道是 ${d.channel}。\n\n增利判断还不完整：演示数据没有接入广告成本，所以不能直接说“这个渠道最赚钱”。正式版还需要渠道花费、成交和毛利。`;
  if (q.includes('谁') || q.includes('跟进')) return `当前有 ${d.overdue} 项逾期任务，${d.owner}负责的待处理事项优先级较高。\n\n【增效】先按逾期时长和客户阶段排序，减少员工逐个翻记录。\n【增利】高意向、报价后或应复购客户应优先处理。`;
  if (q.includes('问题')) return `【降本】今天仍有约 ${d.repeatOps} 次重复登记/整理动作，老板或店长还要花约 ${d.reportMinutes} 分钟做汇总。\n\n【增效】当前有 ${d.overdue} 项逾期、${d.noshow} 名未到店/未完成预约${d.conflicts ? `、${d.conflicts} 处排班或资源冲突` : ''}。\n\n【增利】有 ${d.recoverable} 个可优先挽回的客户/机会，按虚构演示单笔毛利 ${money(d.grossProfitPerOrder)} 计算，机会池约 ${money(profitPool)}；不是保证成交。`;
  return `截至当前，共有 ${d.inquiries} 条业务记录，其中 ${d.valid} 条有效，${d.appointments} 条进入预约或下一阶段，${d.arrivals} 条已到店/到诊，${d.completed} 条已完成或成交，记录营业额 ${money(d.revenue)}。\n\n【降本】演示数据中约有 ${d.repeatOps} 次重复登记/整理动作，老板/店长还需约 ${d.reportMinutes} 分钟人工汇总。\n\n【增效】当前 ${d.overdue} 项任务逾期、${d.noshow} 名客户未到店/未完成预约${d.conflicts ? `，另有 ${d.conflicts} 处排班或资源冲突` : ''}。\n\n【增利】有 ${d.recoverable} 个可优先挽回的客户/机会${d.idleSlots ? `，以及 ${d.idleSlots} 个可尝试填补的空档` : ''}。按虚构演示单笔毛利 ${money(d.grossProfitPerOrder)} 计算，机会池约 ${money(profitPool)}；这里只是机会估算。`;
}

function realBossAnswer(){
  const summary = realBusinessSummary;
  const q = $('bossQuestion').value.trim();
  if (!summary?.ok) {
    return `当前上传文件还不足以形成可靠经营汇总，所以这次不会退回虚构数据代替真实数据。\n\n目前原因：${summary?.reason || '关键字段不足'}。\n需要补充：${summary?.missing?.length ? summary.missing.join('、') : '日期、客户、状态、金额、渠道、负责人等基础字段'}。`;
  }
  const m = summary.metrics || {};
  const periodLabel = summary.period === 'all' ? '整份主明细表' : `文件中最近日期 ${summary.period}`;
  if (q.includes('渠道')) {
    if (!summary.channels?.length) return `暂时无法判断哪个渠道表现更好，因为当前数据缺少渠道字段。\n\n已有数据仍可继续用于其他经营分析；补充“渠道/来源”列后再比较记录量和营业额。`;
    const top = summary.channels[0];
    const revenueText = summary.fields?.amount ? `，记录营业额 ${money(top.revenue)}` : '';
    return `${periodLabel}里，记录量最多的渠道是 ${top.channel}，共有 ${top.records} 条记录${revenueText}。\n\n这只能说明当前表里的业务结果，暂时不能判断“最赚钱”，因为还缺各渠道广告成本和毛利。`;
  }
  if (q.includes('谁') || q.includes('跟进')) {
    if (!summary.overdueOwners?.length) return `暂时无法判断谁还有客户没跟进。\n\n需要同时有“负责人”和“下次跟进/截止时间”字段；现有数据仍会继续分析能确定的部分。`;
    const top = summary.overdueOwners[0];
    return `${periodLabel}里，${top.owner}有 ${top.overdue} 项逾期待办，是当前最需要先处理的负责人。\n\n建议先按逾期时长和客户阶段排序，不需要老板再逐个翻表。`;
  }
  if (q.includes('问题')) {
    const issues = [];
    if (m.overdue !== null && m.overdue !== undefined) issues.push(`${m.overdue} 项逾期任务`);
    if (m.noShows !== null && m.noShows !== undefined) issues.push(`${m.noShows} 名未到店/爽约`);
    const issueText = issues.length ? issues.join('、') : '现有字段暂时无法直接计算逾期和爽约异常';
    return `基于 ${periodLabel}：${issueText}。\n\n【降本】这份表的汇总已经由程序完成，不需要老板再手工计算这些指标。\n【增效】能确认的异常优先进入待办；无法计算的指标会明确提示缺列。\n【增利】如果存在爽约或逾期客户，可以作为挽回机会，但当前没有毛利/成本数据，所以不估算利润金额。\n\n缺少的数据：${summary.missing?.length ? summary.missing.join('、') : '关键字段较完整'}。`;
  }
  const lines = [`按 ${periodLabel}，识别 ${m.records ?? 0} 条业务记录。`];
  lines.push(`预约/下一阶段：${m.appointments === null || m.appointments === undefined ? '暂时无法判断' : m.appointments}；到店/到诊：${m.arrivals === null || m.arrivals === undefined ? '暂时无法判断' : m.arrivals}；完成/成交：${m.completed === null || m.completed === undefined ? '暂时无法判断' : m.completed}。`);
  lines.push(`营业额：${m.revenue === null || m.revenue === undefined ? '暂时无法判断（缺金额字段）' : money(m.revenue)}。`);
  lines.push(`\n【降本】这次经营汇总已由程序自动完成，不需要老板再把同一份表手工汇总一遍；要估实际节省多少工时，可结合体验01的人工时间数据。`);
  const efficiencyParts = [];
  if (m.overdue !== null && m.overdue !== undefined) efficiencyParts.push(`${m.overdue} 项逾期任务`);
  if (m.noShows !== null && m.noShows !== undefined) efficiencyParts.push(`${m.noShows} 名未到店/爽约`);
  lines.push(`【增效】${efficiencyParts.length ? `当前可直接识别 ${efficiencyParts.join('、')}，优先处理这些异常。` : '当前状态/截止时间字段不足，暂时无法计算逾期和爽约；其他已知指标仍可继续使用。'}`);
  if (m.revenue !== null && m.revenue !== undefined) lines.push(`【增利】当前能确认营业额 ${money(m.revenue)}，但利润还需要成本或毛利率；不会把营业额直接当利润。${m.noShows ? `另有 ${m.noShows} 名未到店/爽约客户可作为挽回机会，但暂不估金额。` : ''}`);
  else lines.push('【增利】当前缺少金额/营业额字段，暂时不能判断收入和利润；如果补充金额、成本/毛利率，再继续测算。');
  if (summary.missing?.length) lines.push(`\n还缺：${summary.missing.join('、')}。补充后可继续提高分析完整度。`);
  return lines.join('\n');
}

function bossAnswer(){
  const dataMode = realBusinessSummary ? 'real' : 'demo';
  const text = dataMode === 'real' ? realBossAnswer() : demoBossAnswer();
  $('bossAnswer').textContent = text;
  if (dataMode === 'real') {
    const summary = realBusinessSummary;
    $('bossSource').textContent = `数据来源：${realBusinessSource?.fileName || '上传表格'} · 主明细表：${summary?.usedSheet || '未识别'} · 数据完整度：${summary?.fieldCoverage ?? 0}% · 原始客户明细未返回此页面。`;
  } else {
    $('bossSource').textContent = '数据来源：虚构演示台账 · 未连接真实商家系统。';
  }
}

$('roiForm').addEventListener('submit', (event) => { event.preventDefault(); diagnoseROI(); });
['diagIndustry','diagVolume','diagAvgTime','diagDuplicate','diagLeak','diagReport','diagStaff','diagSalary','diagTicket','diagMargin','diagLostCustomers','diagGoal'].forEach((id) => $(id).addEventListener('change', diagnoseROI));
document.querySelectorAll('#diagTasks input').forEach((node) => node.addEventListener('change', diagnoseROI));
document.querySelectorAll('[data-question]').forEach((button) => button.addEventListener('click', () => { $('bossQuestion').value = button.dataset.question; bossAnswer(); }));
$('bossAsk').addEventListener('click', bossAnswer);
$('bossIndustry').addEventListener('change', bossAnswer);
$('analyzeBusinessFile').addEventListener('click', analyzeBusinessFile);
$('clearBusinessFile').addEventListener('click', clearBusinessFile);

diagnoseROI();
resetRealSummaryView();
bossAnswer();
