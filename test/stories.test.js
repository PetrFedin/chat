import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
  + '0000000a49444154789c6360000002000100ff03ff0000000049454e44ae426082', 'hex');

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      'idempotency-key': crypto.randomUUID(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

/**
 * Показать, как выглядит работа сегодня, было негде: фотография
 * уходила в беседу и через день тонула под перепиской.
 */
test('сторис живёт сутки, считает просмотры и остаётся в архиве автора',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const uploads = await mkdtemp(join(tmpdir(), 'stories-'));
  const app = await createChatServer({ databaseUrl: DATABASE_URL, uploadsRoot: uploads, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); await rm(uploads, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Сторис ${suffix}`, ownerName: 'Анна', email: `st-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invite = async (role, mail) => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: mail, role },
    });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    return (await request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: role, password: 'MemberPassword42' },
    })).cookie;
  };
  const member = await invite('member', `sm-${suffix}@t.test`);
  const guest = await invite('guest', `sg-${suffix}@t.test`);

  const upload = async (cookie, type = 'image/png', body = PNG) => {
    const response = await fetch(`${base}/api/v1/files`, {
      method: 'POST',
      headers: { cookie, 'content-type': type, 'x-file-name': encodeURIComponent('плита.png') },
      body,
    });
    return (await response.json()).file;
  };

  const photo = await upload(owner.cookie);
  const published = await request(base, '/api/v1/stories', {
    cookie: owner.cookie, method: 'POST', body: { fileId: photo.id, caption: 'Залили плиту' },
  });
  assert.equal(published.status, 201);
  assert.equal(published.payload.story.caption, 'Залили плиту');
  assert.equal(published.payload.story.url, `/api/v1/files/${photo.id}/content`);
  assert.ok(new Date(published.payload.story.expiresAt) > new Date());

  // В сторис идёт фотография, а не что попало.
  const text = await upload(owner.cookie, 'text/plain', Buffer.from('нет'));
  const wrong = await request(base, '/api/v1/stories', {
    cookie: owner.cookie, method: 'POST', body: { fileId: text.id },
  });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.code, 'INVALID_STORY_TYPE');

  // Сотрудник видит и отмечается просмотром; автору видно, кто смотрел.
  const seenByMember = await request(base, '/api/v1/stories', { cookie: member });
  assert.equal(seenByMember.payload.items.length, 1);
  assert.equal(seenByMember.payload.items[0].seen, false);
  await request(base, `/api/v1/stories/${published.payload.story.id}/seen`, { cookie: member, method: 'POST', body: {} });
  const again = await request(base, '/api/v1/stories', { cookie: member });
  assert.equal(again.payload.items[0].seen, true);
  // Повторный просмотр не удваивает счётчик.
  await request(base, `/api/v1/stories/${published.payload.story.id}/seen`, { cookie: member, method: 'POST', body: {} });

  const viewers = await request(base, `/api/v1/stories/${published.payload.story.id}/viewers`, { cookie: owner.cookie });
  assert.equal(viewers.payload.items.length, 1);
  // Чужие просмотры — не чужое дело: список отдаётся только автору.
  const peeking = await request(base, `/api/v1/stories/${published.payload.story.id}/viewers`, { cookie: member });
  assert.equal(peeking.payload.items.length, 0);

  // Гость — чужой сотрудник в одной комнате: раздела для него нет.
  const asGuest = await request(base, '/api/v1/stories', { cookie: guest });
  assert.equal(asGuest.status, 404);
  const guestPosts = await request(base, '/api/v1/stories', { cookie: guest, method: 'POST', body: { fileId: photo.id } });
  assert.equal(guestPosts.status, 404);

  // Архив — свой и не гаснет.
  const archive = await request(base, '/api/v1/stories/archive', { cookie: owner.cookie });
  assert.equal(archive.payload.items.length, 1);
  assert.equal(archive.payload.items[0].live, true);
  assert.equal((await request(base, '/api/v1/stories/archive', { cookie: member })).payload.items.length, 0);

  // Убрать может только автор.
  const strangerRemoves = await request(base, `/api/v1/stories/${published.payload.story.id}`, { cookie: member, method: 'DELETE' });
  assert.equal(strangerRemoves.status, 404);
  const removed = await request(base, `/api/v1/stories/${published.payload.story.id}`, { cookie: owner.cookie, method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal((await request(base, '/api/v1/stories', { cookie: member })).payload.items.length, 0);
});

/** Погасшая сторис уходит из ленты, но остаётся в архиве автора. */
test('сторис гаснет по сроку',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const uploads = await mkdtemp(join(tmpdir(), 'stories-'));
  const app = await createChatServer({ databaseUrl: DATABASE_URL, uploadsRoot: uploads, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); await rm(uploads, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Срок ${suffix}`, ownerName: 'Анна', email: `sx-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const photo = await fetch(`${base}/api/v1/files`, {
    method: 'POST',
    headers: { cookie: owner.cookie, 'content-type': 'image/png', 'x-file-name': 'p.png' },
    body: PNG,
  }).then((r) => r.json()).then((p) => p.file);

  const story = (await request(base, '/api/v1/stories', {
    cookie: owner.cookie, method: 'POST', body: { fileId: photo.id, hours: 1 },
  })).payload.story;

  // Сдвигаем в прошлое и срок, и дату: в таблице стоит проверка
  // «срок позже создания», и это ровно та сторис, что опубликована два
  // часа назад на час. Ждать час в проверке нельзя.
  await app.store.pool.query(
    "UPDATE stories SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' WHERE id=$1",
    [story.id]);

  assert.equal((await request(base, '/api/v1/stories', { cookie: owner.cookie })).payload.items.length, 0);
  const archive = (await request(base, '/api/v1/stories/archive', { cookie: owner.cookie })).payload.items;
  assert.equal(archive.length, 1);
  assert.equal(archive[0].live, false);
});
