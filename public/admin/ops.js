const byId = (id) => document.getElementById(id);
const login = byId('admin-login');
const dashboard = byId('dashboard');
const logout = byId('logout');
const status = byId('login-status');

function setText(element, value) {
  element.textContent = value ?? '—';
}

function cell(row, value) {
  const element = document.createElement('td');
  setText(element, value);
  row.append(element);
}

function fillTable(id, rows, columns, emptyText) {
  const body = byId(id).querySelector('tbody');
  body.replaceChildren();
  if (!rows.length) {
    const row = document.createElement('tr');
    const value = document.createElement('td');
    value.colSpan = columns.length;
    value.className = 'empty';
    setText(value, emptyText);
    row.append(value);
    body.append(row);
    return;
  }
  for (const item of rows) {
    const row = document.createElement('tr');
    for (const column of columns) cell(row, column(item));
    body.append(row);
  }
}

function formatMs(value) {
  return Number.isFinite(value) ? `${value} ms` : '—';
}

function showLogin(message = '') {
  login.hidden = false;
  dashboard.hidden = true;
  logout.hidden = true;
  setText(status, message);
}

function render(data) {
  if (!data.available) {
    setText(byId('coverage-status'), `监控数据暂不可用（${data.code || '未知错误'}），主业务不受影响。`);
    return;
  }
  const coverage = data.coverage || {};
  setText(byId('coverage-status'), coverage.hasData
    ? `实际覆盖：${coverage.earliest} 至 ${coverage.latest}${data.partial ? '；数据可能不完整。' : '。'}`
    : '没有可用日志，不能据此判断系统健康。');
  const metrics = [
    ['请求总数', data.summary.total], ['成功数', data.summary.succeeded], ['失败数', data.summary.failed],
    ['成功率', data.summary.successRate === null ? '无数据' : `${data.summary.successRate}%`],
    ['平均耗时', formatMs(data.summary.averageDurationMs)], ['P95 耗时', formatMs(data.summary.p95DurationMs)]
  ];
  const cards = byId('summary-cards');
  cards.replaceChildren();
  for (const [label, value] of metrics) {
    const card = document.createElement('article');
    const title = document.createElement('span');
    const number = document.createElement('strong');
    setText(title, label); setText(number, value);
    card.append(title, number); cards.append(card);
  }
  fillTable('error-table', data.errors || [], [x => x.failureCode, x => x.count, x => `${x.percentage}%`], '没有失败样本');
  fillTable('stage-table', data.stages || [], [x => x.stage, x => x.count, x => formatMs(x.averageDurationMs), x => formatMs(x.p95DurationMs)], '没有阶段样本');
  fillTable('request-table', data.requests || [], [
    x => x.timestamp, x => x.route, x => x.requestId, x => x.status, x => formatMs(x.durationMs),
    x => x.stage, x => x.failureCode, x => x.gitSha
  ], '没有请求记录');
}

async function loadDashboard() {
  const params = new URLSearchParams({ range:byId('range').value });
  const requestId = byId('request-filter').value.trim();
  if (requestId) params.set('requestId', requestId);
  const response = await fetch(`/api/admin-ops?${params}`, { credentials:'same-origin', cache:'no-store' });
  if (response.status === 401) return showLogin('登录已过期，请重新登录。');
  const data = await response.json();
  login.hidden = true; dashboard.hidden = false; logout.hidden = false;
  render(data);
}

byId('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = byId('admin-password');
  const password = input.value;
  input.value = '';
  setText(status, '正在验证…');
  try {
    const response = await fetch('/api/admin-login', {
      method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'same-origin',
      body:JSON.stringify({ password })
    });
    const data = await response.json();
    if (!response.ok) return setText(status, data.error || '管理员登录失败');
    await loadDashboard();
  } catch {
    setText(status, '网络暂时不可用，请稍后重试。');
  }
});

byId('refresh').addEventListener('click', () => loadDashboard().catch(() => setText(byId('coverage-status'), '刷新失败，请稍后重试。')));
logout.addEventListener('click', async () => {
  await fetch('/api/admin-login', { method:'DELETE', credentials:'same-origin' });
  showLogin('已退出。');
});

loadDashboard().catch(() => showLogin());
