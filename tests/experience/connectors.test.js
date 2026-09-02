import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebAdapter, CHANNEL_CAPABILITIES } from '../../src/experience/connectors.js';

test('web adapter exposes the standard interface', () => {
  const adapter = createWebAdapter();
  for (const name of ['connect','getStatus','receiveMessage','getConversation','normalizeConversation','sendMessage','createTask']) {
    assert.equal(typeof adapter[name], 'function');
  }
});

test('send requires explicit operator approval', async () => {
  const adapter = createWebAdapter();
  await assert.rejects(
    () => adapter.sendMessage({ conversationId:'c1', approvedReply:'你好', approval:null }),
    /人工确认|approval/
  );
});

test('web approval never claims external sending', async () => {
  const result = await createWebAdapter().sendMessage({
    conversationId:'c1',
    approvedReply:'你好',
    approval:{ approved:true, actor:'operator' }
  });
  assert.equal(result.status, 'not_connected');
  assert.equal(result.approved, true);
  assert.equal(result.sentExternally, false);
});

test('channel registry preserves unconnected sources', () => {
  assert.equal(CHANNEL_CAPABILITIES.web.enabled, true);
  assert.equal(CHANNEL_CAPABILITIES.web.canSendExternally, false);
  assert.equal(CHANNEL_CAPABILITIES.douyin.enabled, false);
  assert.equal(CHANNEL_CAPABILITIES.wecom.canSendExternally, false);
});
