export const CHANNEL_CAPABILITIES = Object.freeze({
  web:Object.freeze({ label:'Web', enabled:true, canSendExternally:false }),
  wecom:Object.freeze({ label:'企业微信', enabled:false, canSendExternally:false }),
  feishu:Object.freeze({ label:'飞书', enabled:false, canSendExternally:false }),
  dingtalk:Object.freeze({ label:'钉钉', enabled:false, canSendExternally:false }),
  workbuddy:Object.freeze({ label:'WorkBuddy', enabled:false, canSendExternally:false }),
  douyin:Object.freeze({ label:'抖音', enabled:false, canSendExternally:false })
});

function cleanText(value, max=1000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeTask(task={}) {
  const priority = ['low','medium','high'].includes(task?.priority) ? task.priority : 'medium';
  const dueHint = ['today','within_24h','before_appointment','none'].includes(task?.dueHint) ? task.dueHint : 'none';
  return {
    title:cleanText(task?.title, 220) || '继续跟进客户',
    priority,
    dueHint,
    reason:cleanText(task?.reason, 360),
    persisted:false
  };
}

export function createWebAdapter() {
  const conversations = new Map();
  const tasks = [];

  function normalizeConversation(raw={}) {
    const id = cleanText(raw?.id || raw?.conversationId || `web-${Date.now()}`, 120);
    const sourceMessages = Array.isArray(raw?.messages) ? raw.messages : [];
    const messages = sourceMessages.slice(-50).map((item) => ({
      role:item?.role === 'operator' ? 'operator' : 'customer',
      text:cleanText(item?.text, 4000)
    })).filter((item) => item.text);
    return {
      id,
      channel:'web',
      externalConversationId:null,
      messages,
      receivedAt:cleanText(raw?.receivedAt, 80) || new Date().toISOString()
    };
  }

  return {
    connect() {
      return { channel:'web', status:'ready', ...CHANNEL_CAPABILITIES.web };
    },
    getStatus() {
      return { channel:'web', status:'ready', ...CHANNEL_CAPABILITIES.web };
    },
    receiveMessage(payload={}) {
      const conversation = normalizeConversation(payload);
      conversations.set(conversation.id, conversation);
      return conversation;
    },
    getConversation(reference) {
      const id = typeof reference === 'string' ? reference : reference?.conversationId || reference?.id;
      return id ? conversations.get(String(id)) || null : null;
    },
    normalizeConversation,
    async sendMessage({ conversationId, approvedReply, approval } = {}) {
      if (approval?.approved !== true) throw new Error('sendMessage requires explicit 人工确认 approval');
      const reply = cleanText(approvedReply, 4000);
      if (!reply) throw new Error('approvedReply 不能为空');
      return {
        channel:'web',
        conversationId:cleanText(conversationId, 120) || null,
        approved:true,
        status:'not_connected',
        sentExternally:false
      };
    },
    createTask(task={}) {
      const normalized = normalizeTask(task);
      tasks.push(normalized);
      return normalized;
    }
  };
}
