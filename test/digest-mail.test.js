import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';
import { localNow } from '../src/digest/digest-mailer.js';
import { digestMail } from '../src/mail/templates.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

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
 * Час письма — местный.
 *
 * Семь утра по Москве и семь утра по Красноярску — это разное время;
 * общий для всех час означает, что кому-то письмо приходит ночью.
 */
test('местный час и день считаются по поясу человека', () => {
  const at = new Date('2026-09-21T23:30:00Z');
  assert.deepEqual(localNow(at, 'UTC'), { date: '2026-09-21', hour: 23 });
  assert.deepEqual(localNow(at, 'Europe/Moscow'), { date: '2026-09-22', hour: 2 });
  assert.deepEqual(localNow(at, 'Asia/Krasnoyarsk'), { date: '2026-09-22', hour: 6 });
  // Пояс человек вписывает руками: непонятный — это UTC, а не отказ слать.
  assert.deepEqual(localNow(at, 'Марс/Олимп'), { date: '2026-09-21', hour: 23 });
});

/** Пустые разделы не печатаются: «просрочено: 0» — это шум. */
test('в письме нет пустых разделов', () => {
  const empty = digestMail({ workspaceName: 'Гранит', displayName: 'Анна', url: 'https://t.test/', digest: {} });
  assert.match(empty.text, /ничего, что требует вашего участия/);
  assert.ok(!/Сроки прошли/.test(empty.text));

  // Имена разделов — те же, под какими их отдаёт сводка. Здесь стояли
  // другие (`slipped` вместо `slippedDeadlines`), и письмо теряло шесть
  // разделов из восьми: совпадали только упоминания и приглашения,
  // только они и считались в «накопилось: N». Человек, который днями на
  // объекте и в приложение не заходит — а письмо ради него и есть, —
  // читал «ничего не накопилось» при просроченных сроках.
  const full = digestMail({
    workspaceName: 'Гранит', displayName: 'Анна', url: 'https://t.test/',
    digest: { slippedDeadlines: [{ title: 'Свозить бетон', promisedAt: '2026-09-20T09:00:00Z' }] },
  });
  assert.match(full.subject, /Что было без вас: 1/);
  assert.match(full.text, /Сроки прошли:/);
  assert.match(full.text, /Свозить бетон/);

  // Все разделы, какие сводка умеет отдавать, доходят до письма.
  const everything = digestMail({
    workspaceName: 'Гранит', displayName: 'Анна', url: 'https://t.test/',
    digest: {
      mentions: [{ authorName: 'Пётр', conversationTitle: 'Общий', snippet: 'смотри смету' }],
      awaitingYourAnswer: [{ title: 'Свести смету', status: 'in_review', ownerName: 'Лена' }],
      slippedDeadlines: [{ title: 'Акты', promisedAt: '2026-09-20T09:00:00Z' }],
      movedWithoutYou: [{ title: 'Реестр', eventType: 'commitment.rescheduled', actorName: 'Анна' }],
      meetingsHeld: [{ title: 'Планёрка', startAt: '2026-09-21T09:00:00Z' }],
      invitations: [{ title: 'Приёмка', startAt: '2026-09-25T09:00:00Z' }],
      joined: [{ displayName: 'Новичок' }],
    },
  });
  assert.match(everything.subject, /Что было без вас: 7/,
    `письмо потеряло разделы: ${everything.subject}`);
  for (const word of ['смотри смету', 'Свести смету', 'Акты', 'Реестр', 'Планёрка', 'Приёмка', 'Новичок']) {
    assert.match(everything.text, new RegExp(word), `в письме нет «${word}»`);
  }
  // И сданная на приёмку работа подписана тем, что от человека нужно.
  assert.match(everything.text, /нужна приёмка/);
});

/**
 * Сводка жила только внутри продукта: чтобы её увидеть, надо было туда
 * зайти. Человек, который два дня провёл на объекте, туда как раз и не
 * заходил.
 */
test('письмо со сводкой уходит раз в день и только тем, кто его попросил',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const email = `dg-${suffix}@t.test`;

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Сводка ${suffix}`, ownerName: 'Анна', email, password: 'OwnerPassword42' },
  });
  const mine = await request(base, '/api/v1/notification-preferences', { cookie: owner.cookie });
  // Выключено по умолчанию: пространство, которое начинает писать
  // письма само, — это то, от чего ставят фильтр в почте.
  assert.equal(mine.payload.preferences.dailyDigest, false);

  const mailer = app.digestMailer;
  assert.ok(mailer, 'рассыльщик сводок не собрался');
  const quiet = await mailer.runOnce();
  assert.equal(quiet.sent, 0, 'письмо ушло тому, кто его не просил');

  const saved = await request(base, '/api/v1/notification-preferences', {
    cookie: owner.cookie, method: 'PUT', body: { dailyDigest: true, digestHour: 0 },
  });
  assert.equal(saved.payload.preferences.dailyDigest, true);
  assert.equal(saved.payload.preferences.digestHour, 0);

  const first = await mailer.runOnce();
  assert.equal(first.sent, 1);
  const queue = (await request(base, '/api/v1/mail', { cookie: owner.cookie })).payload.items;
  const letter = queue.find((m) => m.kind === 'digest');
  assert.ok(letter, 'письма со сводкой нет в очереди');
  assert.equal(letter.to, email);

  // Второй проход в тот же день не должен слать второе письмо.
  const second = await mailer.runOnce();
  assert.equal(second.sent, 0, 'сводка ушла дважды за день');
  const still = (await request(base, '/api/v1/mail', { cookie: owner.cookie }))
    .payload.items.filter((m) => m.kind === 'digest');
  assert.equal(still.length, 1);

  const wrongHour = await request(base, '/api/v1/notification-preferences', {
    cookie: owner.cookie, method: 'PUT', body: { dailyDigest: true, digestHour: 25 },
  });
  assert.equal(wrongHour.status, 400);
  assert.equal(wrongHour.code, 'INVALID_DIGEST_HOUR');
});
