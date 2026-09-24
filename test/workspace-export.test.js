import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatServer } from '../src/server.js';
import { inflateRawSync } from 'node:zlib';
import { createZipWriter } from '../src/export/zip.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

/**
 * Читатель ZIP ровно настолько, насколько нужно проверке.
 *
 * Разбираем не локальные заголовки, а оглавление в конце: именно по
 * нему читают архив все настоящие распаковщики, и именно в нём
 * обнаружился бы разъезд между тем, что мы записали, и тем, что мы
 * пообещали в конце.
 */
function readZip(buffer) {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, 'в архиве нет оглавления');
  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50, 'испорченная запись оглавления');
    const flags = buffer.readUInt16LE(at + 8);
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const start = buffer.readUInt32LE(at + 42);
    const name = buffer.slice(at + 46, at + 46 + nameLength).toString('utf8');
    // Имя должно быть помечено как UTF-8, иначе распаковщик прочитает
    // кириллицу как набор вопросительных знаков.
    assert.equal(flags & 0x0800, 0x0800, `имя «${name}» не помечено как UTF-8`);
    const localName = buffer.readUInt16LE(start + 26);
    const localExtra = buffer.readUInt16LE(start + 28);
    const dataAt = start + 30 + localName + localExtra;
    const raw = buffer.slice(dataAt, dataAt + compressed);
    entries.set(name, { method, raw });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const text = (entries, name) => {
  const entry = entries.get(name);
  assert.ok(entry, `в архиве нет ${name}`);
  const body = entry.method === 8 ? inflateRawSync(entry.raw) : entry.raw;
  return body.toString('utf8');
};

const lines = (entries, name) => text(entries, name).split('\n').filter(Boolean).map((line) => JSON.parse(line));

/**
 * Имена внутри архива — не ASCII, и это не мелочь.
 *
 * Флаг UTF-8 стоит в двух местах: в локальном заголовке и в оглавлении.
 * Разойдутся — и распаковщик покажет «?+??????????.txt» вместо имени.
 */
test('архив держит кириллические имена и потоковые записи', async () => {
  const chunks = [];
  const sink = {
    write(chunk) { chunks.push(Buffer.from(chunk)); return true; },
    on() {},
    once() {},
  };
  const zip = createZipWriter(sink);
  await zip.add('привет.txt', 'Здравствуйте');
  await zip.add('поток/кусками.txt', (async function* pieces() {
    yield Buffer.from('первый ');
    yield Buffer.from('второй');
  })());
  const done = await zip.finish();
  assert.equal(done.entries, 2);

  const entries = readZip(Buffer.concat(chunks));
  assert.deepEqual([...entries.keys()], ['привет.txt', 'поток/кусками.txt']);
  assert.equal(entries.get('поток/кусками.txt').raw.toString('utf8'), 'первый второй');
});

/**
 * Данные компании должны уметь уходить наружу.
 *
 * Пространство хранило переписку, обязательства и вложения без единого
 * способа их забрать: переезд, проверка или спор с подрядчиком
 * упирались в «выгрузите руками из базы».
 */
test('выгрузка отдаёт переписку, задачи, журнал и сами вложения',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const uploads = await mkdtemp(join(tmpdir(), 'export-'));
  const app = await createChatServer({ databaseUrl: DATABASE_URL, uploadsRoot: uploads, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); await rm(uploads, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Выгрузка ${suffix}`, ownerName: 'Владелец', email: `ex-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations[0];
  await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: 'Смета согласована' },
  });
  const doomed = (await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: 'Это сообщение удалят' },
  })).payload.message;
  await request(base, `/api/v1/messages/${doomed.id}`, { cookie: owner.cookie, method: 'DELETE' });
  await request(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST', body: { title: 'Свозить бетон' },
  });

  const content = 'двоичное содержимое вложения';
  const uploaded = await fetch(`${base}/api/v1/files`, {
    method: 'POST',
    headers: { cookie: owner.cookie, 'content-type': 'text/plain', 'x-file-name': encodeURIComponent('смета версия 2.txt') },
    body: Buffer.from(content, 'utf8'),
  });
  assert.equal(uploaded.status, 201);
  const file = (await uploaded.json()).file;

  const response = await fetch(`${base}/api/v1/export`, { headers: { cookie: owner.cookie } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.match(response.headers.get('content-disposition') ?? '', /attachment; filename\*=UTF-8''/);
  const entries = readZip(Buffer.from(await response.arrayBuffer()));

  const manifest = JSON.parse(text(entries, 'опись.json'));
  assert.equal(manifest.counts['выгружено файлов'], 1);
  assert.equal(manifest.counts['файлов не найдено в хранилище'], 0);
  assert.equal(manifest.counts['сообщения'], 2);

  const messages = lines(entries, 'сообщения.jsonl');
  assert.ok(messages.some((m) => m.body === 'Смета согласована'));
  // Удалённое сообщение остаётся записью без текста: то, что оно было и
  // было убрано, — тоже часть переписки.
  const removed = messages.find((m) => m.id === doomed.id);
  assert.ok(removed, 'удалённое сообщение пропало из выгрузки целиком');
  assert.equal(removed.body, null);
  assert.ok(removed.deletedAt);

  const people = lines(entries, 'люди.jsonl');
  assert.equal(people.length, 1);
  assert.equal(people[0].email, `ex-${suffix}@t.test`);

  assert.ok(lines(entries, 'задачи.jsonl').some((task) => task.title === 'Свозить бетон'));

  // Само вложение, а не только упоминание о нём.
  const described = lines(entries, 'файлы.jsonl').find((f) => f.id === file.id);
  assert.ok(described, 'вложения нет в описи');
  assert.equal(described.sizeBytes, Buffer.byteLength(content));
  assert.equal(text(entries, described.path), content);

  // И след в журнале — до того, как первый байт ушёл наружу.
  const journal = lines(entries, 'журнал.jsonl');
  assert.ok(journal.some((event) => event.eventType === 'workspace.exported'),
    'выгрузка пространства не попала в журнал');
});

/**
 * Выгрузка обходит видимость бесед — в этом её смысл и её опасность.
 *
 * Поэтому право на неё то же, что и на пространство целиком, а гостю о
 * её существовании знать незачем.
 */
test('выгрузка закрыта для сотрудника и невидима для гостя',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Права ${suffix}`, ownerName: 'Владелец', email: `xo-${suffix}@t.test`, password: 'OwnerPassword42' },
  });

  const join = async (role, email) => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email, role },
    });
    const url = invitation.payload?.invitation?.inviteUrl;
    const token = url ? new URL(url).searchParams.get('invite') : null;
    assert.ok(token, `приглашение ${role} не создалось: ${invitation.code ?? invitation.status}`);
    const accepted = await request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: role, password: 'MemberPassword42' },
    });
    return accepted.cookie;
  };

  const member = await join('member', `xm-${suffix}@t.test`);
  const guest = await join('guest', `xg-${suffix}@t.test`);

  const asMember = await fetch(`${base}/api/v1/export`, { headers: { cookie: member } });
  assert.equal(asMember.status, 403);

  // Именно 404, а не 403: гость не должен узнать даже о наличии такой
  // возможности в чужом пространстве.
  const asGuest = await fetch(`${base}/api/v1/export`, { headers: { cookie: guest } });
  assert.equal(asGuest.status, 404);
});
