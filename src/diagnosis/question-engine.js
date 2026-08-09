const TRACKS = [
  {
    id: 'traffic',
    matches: /客流|到店|没人|人少|曝光|获客/,
    fields: [
      { key: 'customer_source', question: '你现在的顾客主要从哪里知道你、最后到店？', reason: '客流问题先确认获客与到店来源，才能判断是曝光不足还是承接出了问题。' },
      { key: 'weekly_visitors', question: '最近一周大约有多少人实际到店？', reason: '需要实际到店人数作为客流基线，避免只凭体感判断。' },
      { key: 'exposure', question: '最近一周主要平台大约有多少曝光或浏览？', reason: '把曝光和到店放在一起看，才能判断流量入口是否是主要瓶颈。' },
      { key: 'location', question: '门店在哪里？请描述商圈、楼层或主要自然客流情况。', reason: '门店位置会直接影响自然到店，需要与线上获客证据交叉判断。' }
    ]
  },
  {
    id: 'profit',
    matches: /利润|亏|毛利|成本|不赚钱|赚不到/,
    fields: [
      { key: 'revenue', question: '最近一个完整月的营业额大约是多少？', reason: '利润问题先建立收入基线，再与成本和毛利核对。' },
      { key: 'cost', question: '同一个月主要成本大约是多少？请至少包含原料、人工、房租和平台费用。', reason: '成本结构是判断利润下降原因的直接证据。' },
      { key: 'gross_margin', question: '如果有记录，最近一个月整体毛利率大约是多少？', reason: '毛利能帮助区分产品结构问题和固定费用问题。' }
    ]
  }
];

function hasAnswer(answers, key) {
  const value = answers?.[key];
  return value !== undefined && value !== null && value !== '';
}

export function nextQuestion(diagnosis) {
  const answers = diagnosis?.answers || {};
  const problem = String(answers.problem || '').trim();
  if (!problem) {
    return {
      key: 'problem',
      question: '现在经营上最让你头疼的事情是什么？用自己的话说就可以。',
      reason: '先让老板描述真实问题，再决定后续需要哪些证据。'
    };
  }

  const track = TRACKS.find(item => item.matches.test(problem));
  if (!track) {
    return hasAnswer(answers, 'business_context') ? null : {
      key: 'business_context',
      question: '请补充一下你的生意类型、主要产品和当前最想改善的结果。',
      reason: '当前描述还不足以判断问题方向，需要最少的经营背景。'
    };
  }

  const missing = track.fields.find(field => !hasAnswer(answers, field.key));
  return missing ? { ...missing, track: track.id } : null;
}
