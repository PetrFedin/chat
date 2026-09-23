import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
process.env.VAULT_KEY ||= randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');

async function call(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      'idempotency-key': randomUUID(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

const at = (seriesId, moment) => `${seriesId}@${encodeURIComponent(moment)}`;

/**
 * Протокол принадлежит встрече, а не серии.
 *
 * Еженедельная планёрка — одна строка в базе и двенадцать встреч в
 * календаре. Протокол привязывался к строке: записали, что решили в
 * понедельник, в среду записали среду — и понедельник исчезал без
 * предупреждения, вместе с решениями. «Что мы решили» отвечало
 * неправдой, а в общем списке решений компании решение среды стояло
 * датой понедельника.
 */
test('у каждой встречи серии свой протокол, и он не затирается следующей',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = randomUUID().slice(0, 8);

  const owner = await call(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Планёрка ${suffix}`, ownerName: 'Владелец', email: `notes-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const series = (await call(base, '/api/v1/calendar-events', {
    cookie: owner.cookie, method: 'POST',
    body: {
      title: 'Еженедельная планёрка',
      startAt: '2026-09-21T05:00:00.000Z', endAt: '2026-09-21T05:30:00.000Z',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6',
    },
  })).payload.event;

  const monday = at(series.id, '2026-09-21T05:00:00.000Z');
  const wednesday = at(series.id, '2026-09-23T05:00:00.000Z');

  assert.equal((await call(base, `/api/v1/calendar-events/${monday}/notes`, {
    cookie: owner.cookie, method: 'PUT',
    body: { title: 'Планёрка 21 сентября', notes: 'Обсудили метизы', decisions: ['Метизы берём у прежнего поставщика'], actionItems: [] },
  })).status, 200);
  assert.equal((await call(base, `/api/v1/calendar-events/${wednesday}/notes`, {
    cookie: owner.cookie, method: 'PUT',
    body: { title: 'Планёрка 23 сентября', notes: 'Обсудили покраску', decisions: ['Красим после приёмки'], actionItems: [] },
  })).status, 200);

  const first = (await call(base, `/api/v1/calendar-events/${monday}/notes`, { cookie: owner.cookie })).payload.notes;
  assert.ok(first, 'протокол понедельника пропал, как только записали среду');
  assert.equal(first.title, 'Планёрка 21 сентября');
  assert.deepEqual(first.decisions, ['Метизы берём у прежнего поставщика']);

  const second = (await call(base, `/api/v1/calendar-events/${wednesday}/notes`, { cookie: owner.cookie })).payload.notes;
  assert.equal(second.title, 'Планёрка 23 сентября');
  assert.deepEqual(second.decisions, ['Красим после приёмки']);

  // Оба решения живут в общем списке решений компании, а не одно вместо
  // другого.
  const decisions = (await call(base, '/api/v1/meetings/decisions', { cookie: owner.cookie })).payload.items;
  const texts = decisions.map((item) => item.decision ?? item.text ?? item.title);
  assert.ok(texts.includes('Метизы берём у прежнего поставщика'), `понедельничное решение потеряно: ${JSON.stringify(texts)}`);
  assert.ok(texts.includes('Красим после приёмки'));

  // У одиночной встречи протокол по-прежнему один — и второй раз
  // сохранение его правит, а не заводит соседний.
  const single = (await call(base, '/api/v1/calendar-events', {
    cookie: owner.cookie, method: 'POST',
    body: { title: 'Разовая встреча', startAt: '2026-09-25T05:00:00.000Z', endAt: '2026-09-25T06:00:00.000Z' },
  })).payload.event;
  for (const notes of ['Первая запись', 'Поправленная запись']) {
    assert.equal((await call(base, `/api/v1/calendar-events/${single.id}/notes`, {
      cookie: owner.cookie, method: 'PUT', body: { title: 'Разовая встреча', notes, decisions: [], actionItems: [] },
    })).status, 200);
  }
  const only = (await call(base, `/api/v1/calendar-events/${single.id}/notes`, { cookie: owner.cookie })).payload.notes;
  assert.equal(only.notes, 'Поправленная запись');
});
