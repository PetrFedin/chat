import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

// Однопиксельный png — настоящий файл настоящего типа.
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

const upload = async (base, cookie, { name, type, body }) => {
  const response = await fetch(`${base}/api/v1/files`, {
    method: 'POST',
    headers: { cookie, 'content-type': type, 'x-file-name': encodeURIComponent(name) },
    body,
  });
  return (await response.json()).file;
};

/**
 * Столбец под фотографию лежал в схеме с самого начала и не был записан
 * ни разу: загрузить её было нечем. Люди различались двумя буквами
 * инициалов, группы — ничем.
 */
test('фотография человека и беседы доходит до списков',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const uploads = await mkdtemp(join(tmpdir(), 'avatar-'));
  const app = await createChatServer({ databaseUrl: DATABASE_URL, uploadsRoot: uploads, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); await rm(uploads, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Лица ${suffix}`, ownerName: 'Анна', email: `av-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const boot = await request(base, '/api/v1/bootstrap', { cookie: owner.cookie });
  const me = boot.payload.session.userId;
  const conversation = boot.payload.conversations.find((c) => c.kind === 'channel') ?? boot.payload.conversations[0];

  const photo = await upload(base, owner.cookie, { name: 'лицо.png', type: 'image/png', body: PNG });

  const saved = await request(base, `/api/v1/people/${me}`, {
    cookie: owner.cookie, method: 'PATCH', body: { avatarFileId: photo.id },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.person.avatarUrl, `/api/v1/files/${photo.id}/content`);

  // Адрес собирается из ссылки на файл, а не хранится строкой: одно
  // место правды, и битых картинок после удаления файла не остаётся.
  const again = await request(base, '/api/v1/bootstrap', { cookie: owner.cookie });
  assert.equal(again.payload.people.find((p) => p.userId === me).avatarUrl, `/api/v1/files/${photo.id}/content`);
  assert.equal(again.payload.session.profile.avatarUrl, `/api/v1/files/${photo.id}/content`);

  const cover = await upload(base, owner.cookie, { name: 'обложка.png', type: 'image/png', body: PNG });
  const dressed = await request(base, `/api/v1/conversations/${conversation.id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { avatarFileId: cover.id },
  });
  assert.equal(dressed.status, 200);
  assert.equal(dressed.payload.conversation.avatarUrl, `/api/v1/files/${cover.id}/content`);
  const listed = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie }))
    .payload.conversations.find((c) => c.id === conversation.id);
  assert.equal(listed.avatarUrl, `/api/v1/files/${cover.id}/content`);

  // Снять фотографию можно тем же путём.
  const bare = await request(base, `/api/v1/people/${me}`, {
    cookie: owner.cookie, method: 'PATCH', body: { avatarFileId: null },
  });
  assert.equal(bare.payload.person.avatarUrl, null);
});

/**
 * В аватар годится не всё.
 *
 * SVG — это документ со скриптами: показывать его как чужое лицо в
 * списке сотрудников значит пускать чужой код на страницу.
 */
test('в фотографию не проходят текст, SVG и чужие файлы',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const uploads = await mkdtemp(join(tmpdir(), 'avatar-'));
  const app = await createChatServer({ databaseUrl: DATABASE_URL, uploadsRoot: uploads, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); await rm(uploads, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Типы ${suffix}`, ownerName: 'Анна', email: `at-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const me = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.session.userId;

  const text = await upload(base, owner.cookie, { name: 'a.txt', type: 'text/plain', body: Buffer.from('нет') });
  const asText = await request(base, `/api/v1/people/${me}`, {
    cookie: owner.cookie, method: 'PATCH', body: { avatarFileId: text.id },
  });
  assert.equal(asText.status, 400);
  assert.equal(asText.code, 'INVALID_AVATAR_TYPE');

  const svg = await upload(base, owner.cookie, {
    name: 'a.svg', type: 'image/svg+xml',
    body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'),
  });
  const asSvg = await request(base, `/api/v1/people/${me}`, {
    cookie: owner.cookie, method: 'PATCH', body: { avatarFileId: svg.id },
  });
  assert.equal(asSvg.code, 'INVALID_AVATAR_TYPE');

  // Чужой файл сюда не подставить: проверка спрашивает файл так же, как
  // его спросил бы этот человек, — то есть в своём пространстве.
  const alien = await request(base, `/api/v1/people/${me}`, {
    cookie: owner.cookie, method: 'PATCH', body: { avatarFileId: '00000000-0000-0000-0000-000000000001' },
  });
  assert.equal(alien.status, 404);
  assert.equal(alien.code, 'FILE_NOT_FOUND');
});
