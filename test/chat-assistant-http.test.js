import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';
import { MemoryStore } from '../src/persistence/store.js';

class FakeChatAssistant {
  constructor() { this.calls = []; }
  status() { return { provider: 'fake', enabled: true }; }
  async summarizeThread({ messages, selfUserId }) {
    this.calls.push(['summarize', messages, selfUserId]);
    return { provider: 'fake', model: 'fake-model', requestId: 'req-1', summary: 'Обсудили релиз.', highlights: ['Срок — пятница'] };
  }
  async suggestReplies({ messages, selfUserId }) {
    this.calls.push(['suggest', messages, selfUserId]);
    if (!messages.length) throw Object.assign(new Error('There is nothing to reply to yet'), { code: 'CHAT_ASSISTANT_INPUT_EMPTY', statusCode: 400, expose: true });
    return { provider: 'fake', model: 'fake-model', requestId: 'req-2', replies: ['Да, успеваем.', 'Нужен ещё день.'] };
  }
}

class DisabledChatAssistant {
  status() { return { provider: 'none', enabled: false, reason: 'CHAT_ASSISTANT_PROVIDER is not configured' }; }
  async summarizeThread() { throw Object.assign(new Error('The chat assistant is not configured'), { code: 'CHAT_ASSISTANT_UNAVAILABLE', statusCode: 503, expose: true }); }
  async suggestReplies() { throw Object.assign(new Error('The chat assistant is not configured'), { code: 'CHAT_ASSISTANT_UNAVAILABLE', statusCode: 503, expose: true }); }
}

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

test('обзор и предложенные ответы читают реальную переписку и никогда не отправляют вместо человека', async (t) => {
  const assistant = new FakeChatAssistant();
  const app = await createChatServer({ store: new MemoryStore(), chatAssistant: assistant });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const owner = await request(base, '/api/v1/auth/register-company', { method: 'POST', body: { companyName: 'Assistant Co', ownerName: 'Owner', email: 'owner@assistant.test', password: 'OwnerPassword42' } });
  assert.equal(owner.response.status, 201);
  const cookie = owner.cookie;
  const boot = await request(base, '/api/v1/bootstrap', { cookie });
  const general = boot.payload.conversations.find((c) => c.slug === 'general');
  assert.ok(general);

  await request(base, `/api/v1/conversations/${general.id}/messages`, { cookie, method: 'POST', body: { kind: 'text', body: 'Когда релиз?' } });
  await request(base, `/api/v1/conversations/${general.id}/messages`, { cookie, method: 'POST', body: { kind: 'text', body: 'В пятницу, если QA не найдёт ничего критичного.' } });

  const summary = await request(base, `/api/v1/conversations/${general.id}/assistant/summarize`, { cookie, method: 'POST', body: {} });
  assert.equal(summary.response.status, 200);
  assert.equal(summary.payload.summary, 'Обсудили релиз.');
  assert.deepEqual(summary.payload.highlights, ['Срок — пятница']);
  const [, summarizedMessages] = assistant.calls[0];
  assert.equal(summarizedMessages.length, 2, 'ассистент должен получить реальные сообщения беседы, а не заглушку');
  assert.match(summarizedMessages[1].text, /пятницу/);

  const suggestions = await request(base, `/api/v1/conversations/${general.id}/assistant/suggest-replies`, { cookie, method: 'POST', body: {} });
  assert.equal(suggestions.response.status, 200);
  assert.deepEqual(suggestions.payload.replies, ['Да, успеваем.', 'Нужен ещё день.']);

  // Чужая беседа (гость снаружи) не должна быть видна ассистенту через тот же маршрут.
  const stranger = await request(base, '/api/v1/auth/register-company', { method: 'POST', body: { companyName: 'Other Co', ownerName: 'Other', email: 'owner@other-assistant.test', password: 'OwnerPassword42' } });
  const strangerSummary = await request(base, `/api/v1/conversations/${general.id}/assistant/summarize`, { cookie: stranger.cookie, method: 'POST', body: {} });
  assert.equal(strangerSummary.response.status, 404, 'посторонний не должен получать обзор чужой беседы');

  // Без сессии — тоже отказ, ключ Bearer здесь не участвует.
  const noSession = await request(base, `/api/v1/conversations/${general.id}/assistant/summarize`, { method: 'POST', body: {} });
  assert.equal(noSession.response.status, 401);
});

test('пустая беседа не порождает выдуманный обзор, а отключённый ассистент честно отвечает 503', async (t) => {
  const emptyAssistant = new FakeChatAssistant();
  const appEmpty = await createChatServer({ store: new MemoryStore(), chatAssistant: emptyAssistant });
  await new Promise((resolve) => appEmpty.server.listen(0, '127.0.0.1', resolve));
  t.after(() => appEmpty.close());
  const baseEmpty = `http://127.0.0.1:${appEmpty.server.address().port}`;
  const owner = await request(baseEmpty, '/api/v1/auth/register-company', { method: 'POST', body: { companyName: 'Empty Assistant Co', ownerName: 'Owner', email: 'owner@empty-assistant.test', password: 'OwnerPassword42' } });
  const boot = await request(baseEmpty, '/api/v1/bootstrap', { cookie: owner.cookie });
  const general = boot.payload.conversations.find((c) => c.slug === 'general');

  const emptyReply = await request(baseEmpty, `/api/v1/conversations/${general.id}/assistant/suggest-replies`, { cookie: owner.cookie, method: 'POST', body: {} });
  assert.equal(emptyReply.response.status, 400);
  assert.equal(emptyReply.payload.error.code, 'CHAT_ASSISTANT_INPUT_EMPTY');

  const appDisabled = await createChatServer({ store: new MemoryStore(), chatAssistant: new DisabledChatAssistant() });
  await new Promise((resolve) => appDisabled.server.listen(0, '127.0.0.1', resolve));
  t.after(() => appDisabled.close());
  const baseDisabled = `http://127.0.0.1:${appDisabled.server.address().port}`;
  const owner2 = await request(baseDisabled, '/api/v1/auth/register-company', { method: 'POST', body: { companyName: 'Disabled Assistant Co', ownerName: 'Owner', email: 'owner@disabled-assistant.test', password: 'OwnerPassword42' } });
  const boot2 = await request(baseDisabled, '/api/v1/bootstrap', { cookie: owner2.cookie });
  const general2 = boot2.payload.conversations.find((c) => c.slug === 'general');
  await request(baseDisabled, `/api/v1/conversations/${general2.id}/messages`, { cookie: owner2.cookie, method: 'POST', body: { kind: 'text', body: 'Привет' } });
  const disabledSummary = await request(baseDisabled, `/api/v1/conversations/${general2.id}/assistant/summarize`, { cookie: owner2.cookie, method: 'POST', body: {} });
  assert.equal(disabledSummary.response.status, 503);
  assert.equal(disabledSummary.payload.error.code, 'CHAT_ASSISTANT_UNAVAILABLE');
  assert.match(disabledSummary.payload.error.message, /not configured/, 'причина отказа должна быть видна, а не спрятана за "Internal server error"');
});
