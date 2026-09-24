import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { createChatServer } from '../src/server.js';
import { createMailRepository } from '../src/mail/mail-repository.js';
import { createMailWorker, mailSettings } from '../src/mail/mail-worker.js';
import { composeMail, encodeHeader } from '../src/mail/compose.js';
import { sendSmtpMail, SmtpError } from '../src/mail/smtp.js';
import { invitationMail, passwordResetMail } from '../src/mail/templates.js';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { selfSigned } from '../test-support/self-signed.mjs';

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

test('заголовок с кириллицей кодируется, а не уезжает в вопросительные знаки', () => {
  assert.equal(encodeHeader('Invitation'), 'Invitation', 'латиница не должна кодироваться без нужды');
  const encoded = encodeHeader('Приглашение в «Северная Гавань»');
  assert.match(encoded, /^=\?utf-8\?B\?/);
  const decoded = encoded.split(/\r\n /).map((chunk) =>
    Buffer.from(chunk.replace(/^=\?utf-8\?B\?/, '').replace(/\?=$/, ''), 'base64').toString('utf8')).join('');
  assert.equal(decoded, 'Приглашение в «Северная Гавань»');
  for (const line of encoded.split('\r\n')) assert.ok(line.length <= 78, `строка заголовка длиной ${line.length}`);
});

// Название компании приходит от человека. Перевод строки в нём дописал бы
// в письмо собственные заголовки — вплоть до второго получателя.
test('перевод строки из названия компании не попадает в заголовки', () => {
  const raw = composeMail({
    to: 'someone@example.test', from: 'bot@chat.test', fromName: 'Chat',
    subject: 'Приглашение\r\nBcc: victim@example.test', text: 'тело', messageId: 'x@chat.test',
  });
  const headers = raw.split('\r\n\r\n')[0];
  assert.equal(headers.toLowerCase().includes('bcc:'), false, 'в заголовки письма дописали чужую строку');
});

/**
 * Игрушечный SMTP-сервер: говорит ровно то, что положено по протоколу,
 * и запоминает разговор. Настоящий почтовый сервер в тестах не поднять,
 * а проверять надо именно разговор — на нём и ломается своя реализация.
 */
function fakeSmtp({ failWith = null, certificate = null, implicit = false } = {}) {
  const seen = [];

  /** Один разговор. После подъёма шифра продолжается на том же месте. */
  const serve = (socket, session, { encrypted, greet }) => {
    let mode = 'commands';
    let letter = '';
    if (greet) socket.write('220 test.local ESMTP\r\n');
    socket.on('data', (chunk) => {
      for (const line of chunk.toString('utf8').split('\r\n')) {
        if (line === '' && mode === 'commands') continue;
        if (mode === 'data') {
          if (line === '.') { mode = 'commands'; session.letter = letter; socket.write('250 OK queued\r\n'); continue; }
          letter += `${line}\n`;
          continue;
        }
        session.commands.push(line);
        // Что сервер услышал до шифра: пароля здесь быть не должно.
        if (!encrypted) session.plain.push(line);
        const command = line.split(' ')[0].toUpperCase();
        if (command === 'EHLO') {
          socket.write(`250-test.local\r\n250-AUTH PLAIN LOGIN\r\n`
            + `${certificate && !encrypted ? '250-STARTTLS\r\n' : ''}250 SIZE 10240000\r\n`);
        } else if (command === 'STARTTLS') {
          socket.write('220 go ahead\r\n');
          socket.removeAllListeners('data');
          const upgraded = new tls.TLSSocket(socket, {
            isServer: true, key: certificate.key, cert: certificate.cert,
          });
          upgraded.on('error', () => {});
          // Здороваться заново не положено: клиент сразу шлёт EHLO.
          serve(upgraded, session, { encrypted: true, greet: false });
        } else if (command === 'AUTH') socket.write('235 authenticated\r\n');
        else if (command === 'MAIL') socket.write('250 sender ok\r\n');
        else if (command === 'RCPT') socket.write(failWith ? `${failWith} no such mailbox\r\n` : '250 recipient ok\r\n');
        else if (command === 'DATA') { mode = 'data'; socket.write('354 go ahead\r\n'); }
        else if (command === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else if (line) socket.write('250 ok\r\n');
      }
    });
    socket.on('error', () => {});
  };

  const open = (socket) => {
    const session = { commands: [], plain: [], letter: null };
    seen.push(session);
    serve(socket, session, { encrypted: implicit, greet: true });
  };
  const server = implicit
    ? tls.createServer({ key: certificate.key, cert: certificate.cert }, open)
    : net.createServer(open);
  return { server, seen, listen: () => new Promise((r) => server.listen(0, '127.0.0.1', r)), port: () => server.address().port };
}

test('письмо уходит по-настоящему: разговор с сервером, тема и тело', async (t) => {
  const smtp = fakeSmtp();
  await smtp.listen();
  t.after(() => smtp.server.close());

  const letter = invitationMail({
    workspaceName: 'Северная Гавань', inviterName: 'Анна Директор', role: 'member',
    url: 'https://chat.test/?invite=abc', expiresAt: new Date('2026-10-01T09:00:00Z').toISOString(),
  });
  const raw = composeMail({
    to: 'new@example.test', from: 'bot@chat.test', fromName: 'Северная Гавань',
    subject: letter.subject, text: letter.text, html: letter.html, messageId: 'id1@chat.test',
  });
  await sendSmtpMail({ to: 'new@example.test', envelopeFrom: 'bot@chat.test', raw },
    { host: '127.0.0.1', port: smtp.port(), user: 'u', pass: 'p', helo: 'chat.test' });

  const session = smtp.seen[0];
  assert.deepEqual(session.commands.map((c) => c.split(' ')[0]), ['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
  assert.ok(session.commands.includes('MAIL FROM:<bot@chat.test>'));
  assert.ok(session.commands.includes('RCPT TO:<new@example.test>'));
  assert.match(session.letter, /Content-Type: multipart\/alternative/);
  // Тело пришло целиком и читается — то есть base64 не порвался.
  const body = session.letter.split(/\n\n/).map((part) => {
    try { return Buffer.from(part.replace(/\n/g, ''), 'base64').toString('utf8'); } catch { return ''; }
  }).join('\n');
  assert.match(body, /Анна Директор приглашает вас/);
  assert.match(body, /https:\/\/chat\.test\/\?invite=abc/);
  assert.match(body, /1 октября/, 'срок должен быть написан по-русски');
});

// «Такого ящика нет» повторять нельзя: это жжёт попытки и репутацию
// отправителя. «Занят, попробуйте позже» — можно и нужно.
test('постоянный отказ отличается от временного', async (t) => {
  for (const [code, permanent] of [['550', true], ['451', false]]) {
    const smtp = fakeSmtp({ failWith: code });
    await smtp.listen();
    t.after(() => smtp.server.close());
    await assert.rejects(
      () => sendSmtpMail({ to: 'nobody@example.test', envelopeFrom: 'bot@chat.test', raw: 'Subject: x\r\n\r\nx' },
        { host: '127.0.0.1', port: smtp.port() }),
      (error) => {
        assert.ok(error instanceof SmtpError);
        assert.equal(error.permanent, permanent, `${code} сочли ${error.permanent ? 'постоянным' : 'временным'}`);
        return true;
      });
  }
});

/**
 * Переход на шифр — то, что на самом деле происходит с каждым письмом:
 * обычный почтовый сервис слушает 587 открытым, объявляет STARTTLS и
 * ждёт, что клиент поднимет шифр сам. Если этого не сделать, пароль от
 * почтового ящика компании уйдёт по проводу открытым текстом.
 */
test('пароль уходит только после STARTTLS, и письмо доходит по шифру', async (t) => {
  const certificate = selfSigned();
  const smtp = fakeSmtp({ certificate });
  await smtp.listen();
  t.after(() => smtp.server.close());

  await sendSmtpMail(
    { to: 'new@example.test', envelopeFrom: 'bot@chat.test', raw: 'Subject: x\r\n\r\nтело' },
    { host: '127.0.0.1', port: smtp.port(), user: 'u', pass: 'секрет', helo: 'chat.test', ca: certificate.cert },
  );

  const session = smtp.seen[0];
  // До шифра сервер услышал только приветствие и просьбу его поднять.
  assert.deepEqual(session.plain.map((line) => line.split(' ')[0]), ['EHLO', 'STARTTLS']);
  assert.ok(!session.plain.some((line) => /секрет/.test(line)), 'пароль ушёл открытым текстом');
  // После шифра — заново приветствие и весь остальной разговор.
  assert.deepEqual(session.commands.map((line) => line.split(' ')[0]),
    ['EHLO', 'STARTTLS', 'EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
  assert.match(session.letter, /тело/);
});

/**
 * Чужой сертификат на пути к почтовому серверу — это либо подмена, либо
 * настроенная не так пересылка. Ни в том, ни в другом случае пароль
 * туда отдавать нельзя, поэтому письмо не уходит вовсе.
 */
test('подменённый сертификат обрывает отправку, а не проходит молча', async (t) => {
  const smtp = fakeSmtp({ certificate: selfSigned() });
  await smtp.listen();
  t.after(() => smtp.server.close());

  // Доверяем совсем другому центру — такому, каким сервер не подписан.
  await assert.rejects(() => sendSmtpMail(
    { to: 'new@example.test', envelopeFrom: 'bot@chat.test', raw: 'Subject: x\r\n\r\nx' },
    { host: '127.0.0.1', port: smtp.port(), user: 'u', pass: 'секрет', ca: selfSigned().cert },
  ));
  assert.ok(!smtp.seen[0].plain.some((line) => /секрет/.test(line)), 'пароль ушёл до проверки сертификата');
});

/** Порт 465: шифр с первого байта, без открытой части вовсе. */
test('сервер с шифром сразу тоже работает', async (t) => {
  const certificate = selfSigned();
  const smtp = fakeSmtp({ certificate, implicit: true });
  await smtp.listen();
  t.after(() => smtp.server.close());

  await sendSmtpMail(
    { to: 'new@example.test', envelopeFrom: 'bot@chat.test', raw: 'Subject: x\r\n\r\nтело' },
    { host: '127.0.0.1', port: smtp.port(), secure: true, user: 'u', pass: 'секрет', ca: certificate.cert },
  );
  const session = smtp.seen[0];
  assert.deepEqual(session.plain, [], 'что-то ушло открытым текстом при шифре с первого байта');
  assert.deepEqual(session.commands.map((line) => line.split(' ')[0]),
    ['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
});

test('очередь писем: аренда, повтор, мёртвая буква',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  t.after(() => pool.end());
  const mail = createMailRepository(pool);

  // Своё рабочее пространство и работа только с ним: база общая на весь
  // прогон, и без этого тест забирает из очереди чужие письма — а другой
  // тест забирает наши.
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [organizationId, `Почта ${organizationId.slice(0, 8)}`]);
  await pool.query('INSERT INTO workspaces(id,organization_id,name) VALUES($1,$2,$3)', [workspaceId, organizationId, 'Очередь']);
  const actorId = randomUUID();
  await pool.query('INSERT INTO users(id,email) VALUES($1,$2)', [actorId, `${actorId}@example.test`]);
  await pool.query('INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES($1,$2,$3,$4)',
    [organizationId, workspaceId, actorId, 'owner']);
  const only = { workspaceIds: [workspaceId] };

  const letter = passwordResetMail({ workspaceName: 'Тест', url: 'https://chat.test/?reset=t', expiresAt: new Date().toISOString() });
  const sourceId = randomUUID();
  const first = await mail.enqueue({ organizationId, workspaceId, actorId, kind: 'password_reset', to: 'Someone@Example.TEST', subject: letter.subject, text: letter.text, sourceId });
  assert.ok(first, 'письмо не встало в очередь');
  assert.equal(first.to, 'someone@example.test', 'адрес должен приводиться к нижнему регистру');
  // Повторный вызов маршрута не должен слать второе письмо.
  assert.equal(await mail.enqueue({ organizationId, workspaceId, kind: 'password_reset', to: 'someone@example.test', subject: 'x', text: 'y', sourceId }), null);

  const claimed = await mail.claimDue({ limit: 10, ...only });
  const mine = claimed.filter((m) => m.id === first.id);
  assert.equal(mine.length, 1, 'письмо не досталось работнику ровно один раз');
  // Второй работник в ту же секунду не должен получить то же письмо.
  assert.equal((await mail.claimDue({ limit: 10, ...only })).some((m) => m.id === first.id), false);

  await mail.recordFailure(mine[0], { error: 'сервер занят', retryInMs: 0 });
  const again = (await mail.claimDue({ limit: 10, ...only })).find((m) => m.id === first.id);
  assert.ok(again, 'временный отказ не вернул письмо в очередь');
  assert.equal(again.attempts, 2);

  await mail.recordFailure(again, { error: 'нет такого ящика', permanent: true });
  const dead = (await pool.query('SELECT status FROM mail_messages WHERE id=$1', [first.id])).rows[0];
  assert.equal(dead.status, 'dead', 'постоянный отказ должен хоронить письмо сразу');
  assert.equal((await mail.claimDue({ limit: 10, ...only })).some((m) => m.id === first.id), false);

  // Непришедшее приглашение выглядит для компании как «человек не
  // отвечает»: в журнале обязан остаться след, и у следа — автор.
  const audited = (await pool.query(
    `SELECT actor_id, payload FROM audit_events
      WHERE workspace_id=$1 AND aggregate_id=$2 AND event_type='mail.undelivered'`,
    [workspaceId, first.id])).rows;
  assert.equal(audited.length, 1, 'умершее письмо не попало в журнал');
  assert.equal(audited[0].actor_id, actorId);
  assert.equal(audited[0].payload.to, 'someone@example.test');
});

test('без MAIL_HOST канал выключен и говорит почему', () => {
  assert.equal(mailSettings({}).configured, false);
  assert.equal(mailSettings({}).reason, 'no-host');
  assert.equal(mailSettings({ MAIL_HOST: 'smtp.test' }).reason, 'no-from');
  // Забытая переменная в docker-compose приходит пустой строкой, и это
  // «не задано», а не «настроенный сервер по адресу пустая строка».
  assert.equal(mailSettings({ MAIL_HOST: '', MAIL_FROM: 'a@b.test' }).configured, false);
  const ready = mailSettings({ MAIL_HOST: 'smtp.test', MAIL_FROM: 'bot@chat.test' });
  assert.equal(ready.configured, true);
  assert.equal(ready.messageIdDomain, 'chat.test', 'Message-ID должен быть на нашем домене');
  assert.equal(ready.envelopeFrom, 'bot@chat.test');
});

/**
 * Главное, ради чего всё это: приглашение и сброс пароля доходят сами.
 */
test('приглашение и сброс пароля уходят письмом',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const smtp = fakeSmtp();
  await smtp.listen();
  t.after(() => smtp.server.close());

  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Почта ${suffix}`, ownerName: 'Анна Директор', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });

  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `new-${suffix}@example.test`, role: 'member' } });
  assert.equal(invitation.status, 201);
  assert.equal(invitation.payload.mail.queued, true, 'приглашение не поставило письмо в очередь');
  // Ссылка остаётся в ответе: пригласивший часто отправляет её сам.
  assert.match(invitation.payload.invitation.inviteUrl, /\?invite=/);

  // Работник — только для этой компании: база на весь прогон общая, и
  // без этого он разошлёт письма чужих тестов на наш игрушечный сервер.
  const workspaceId = (await request(base, '/api/v1/me', { cookie: owner.cookie })).payload.workspaceId;
  const worker = createMailWorker(app.mail, {}, {
    workspaceIds: [workspaceId],
    settings: { ...mailSettings({ MAIL_HOST: '127.0.0.1', MAIL_FROM: `bot@chat-${suffix}.test` }), port: smtp.port(), host: '127.0.0.1' },
  });
  await worker.tick();

  const sent = smtp.seen.find((s) => (s.letter ?? '').length);
  assert.ok(sent, 'работник не отправил ни одного письма');
  assert.ok(sent.commands.includes(`RCPT TO:<new-${suffix}@example.test>`), 'письмо ушло не тому');
  // И журнал почты показывает то же самое тому, кто вправе приглашать.
  const log = await request(base, '/api/v1/mail', { cookie: owner.cookie });
  assert.equal(log.status, 200);
  assert.equal(log.payload.items[0].to, `new-${suffix}@example.test`);
  assert.equal(log.payload.items[0].status, 'sent');

  // «Забыл пароль» — без входа и без администратора.
  const asked = await request(base, '/api/v1/password-resets/request', {
    method: 'POST', body: { email: `own-${suffix}@t.test` } });
  assert.equal(asked.status, 204);
  // Тот же ответ на адрес, которого у нас нет: иначе по маршруту
  // перебирают, кто работает в компании.
  const stranger = await request(base, '/api/v1/password-resets/request', {
    method: 'POST', body: { email: `nobody-${suffix}@example.test` } });
  assert.equal(stranger.status, 204);

  await worker.tick();
  const reset = smtp.seen.filter((s) => (s.letter ?? '').includes('reset=') || (s.commands ?? []).includes(`RCPT TO:<own-${suffix}@t.test>`));
  assert.equal(reset.length, 1, 'письмо о сбросе ушло не ровно одному человеку');
  // Никакого письма чужому адресу при этом отправлено не было.
  assert.equal(smtp.seen.some((s) => (s.commands ?? []).includes(`RCPT TO:<nobody-${suffix}@example.test>`)), false);

  // И ссылка из письма действительно меняет пароль.
  const body = (reset[0].letter ?? '').split(/\n\n/).map((part) => {
    try { return Buffer.from(part.replace(/\n/g, ''), 'base64').toString('utf8'); } catch { return ''; }
  }).join('\n');
  const token = body.match(/\?reset=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(token, 'в письме нет ссылки на смену пароля');
  assert.equal((await request(base, '/api/v1/password-resets/redeem', {
    method: 'POST', body: { token, password: 'BrandNewPassword42' } })).status, 204);
  assert.equal((await request(base, '/api/v1/auth/login', {
    method: 'POST', body: { email: `own-${suffix}@t.test`, password: 'BrandNewPassword42' } })).status, 200);
});
