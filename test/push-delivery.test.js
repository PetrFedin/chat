import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { selfSigned } from '../test-support/self-signed.mjs';

/**
 * Push доходит не «в браузер», а на сервер Apple, Google или Mozilla, и
 * оттуда на устройство. Последний участок здесь не проверить ничем, а
 * вот всё, что до него, — можно и нужно: ключи, подпись и шифр.
 *
 * Уведомление шифруется ключом подписки, а запрос подписывается ключом
 * VAPID. Ошибка в любом из двух даёт молчание: сервер уведомлений
 * отвечает отказом, человек ничего не получает, и в журнале это
 * выглядит как «отправлено».
 */

/** Подписка такая же, какую отдаёт браузер: открытый ключ и секрет. */
function subscription(endpoint = 'https://push.example.test/abc') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}

test('ключи VAPID подписывают запрос, а уведомление уходит зашифрованным', () => {
  const keys = webpush.generateVAPIDKeys();
  webpush.setVapidDetails('mailto:admin@chat.test', keys.publicKey, keys.privateKey);

  const request = webpush.generateRequestDetails(
    subscription(), JSON.stringify({ title: 'Задача', kind: 'tasks' }), { TTL: 60 });

  assert.equal(request.method, 'POST');
  // Текст уведомления в запросе не лежит: сервер уведомлений его не видит.
  assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
  assert.ok(request.body.length > 0);
  assert.ok(!request.body.includes(Buffer.from('Задача', 'utf8')), 'текст ушёл незашифрованным');

  // Подпись: «vapid t=<токен>, k=<открытый ключ>». Токен — JWT, и в нём
  // должен стоять адрес того сервера, которому мы шлём.
  const authorization = String(request.headers.Authorization);
  assert.match(authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  const claims = JSON.parse(Buffer.from(authorization.split('t=')[1].split('.')[1], 'base64url').toString('utf8'));
  assert.equal(claims.aud, 'https://push.example.test');
  assert.equal(claims.sub, 'mailto:admin@chat.test');
  assert.ok(claims.exp * 1000 > Date.now(), 'подпись выдана уже просроченной');
});

test('испорченный ключ подписки виден сразу, а не превращается в тишину', () => {
  const keys = webpush.generateVAPIDKeys();
  webpush.setVapidDetails('mailto:admin@chat.test', keys.publicKey, keys.privateKey);
  const broken = subscription();
  broken.keys.p256dh = 'не-ключ';
  assert.throws(() => webpush.generateRequestDetails(broken, JSON.stringify({ title: 'x' })));
});

/**
 * Отказ сервера уведомлений — обычное дело: подписка протухает, когда
 * человек снёс приложение или почистил браузер. Проверяем, что отказ
 * виден вызывающему, а не теряется.
 */
test('отказ сервера уведомлений доходит до вызывающего', async (t) => {
  const keys = webpush.generateVAPIDKeys();
  webpush.setVapidDetails('mailto:admin@chat.test', keys.publicKey, keys.privateKey);

  const seen = [];
  // Сервер уведомлений всегда по шифру: открытым текстом библиотека не
  // разговаривает вовсе, и подложить сюда обычный http нельзя.
  const certificate = selfSigned();
  const server = https.createServer(certificate, (request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({ headers: request.headers, body: Buffer.concat(chunks) });
      response.writeHead(seen.length === 1 ? 201 : 410).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const endpoint = `https://127.0.0.1:${server.address().port}/push`;
  // Доверяем ровно этому сертификату — не отключая проверку вообще.
  const trust = { agent: new https.Agent({ ca: certificate.cert }) };

  const accepted = await webpush.sendNotification(subscription(endpoint), JSON.stringify({ title: 'Задача' }), { TTL: 60, ...trust });
  assert.equal(accepted.statusCode, 201);
  assert.equal(seen[0].headers['content-encoding'], 'aes128gcm');
  assert.ok(seen[0].headers.authorization.startsWith('vapid t='));
  assert.ok(seen[0].body.length > 0);

  // 410 — «подписки больше нет». Такое молчать нельзя: на нём чистят
  // мёртвые подписки.
  await assert.rejects(
    () => webpush.sendNotification(subscription(endpoint), JSON.stringify({ title: 'Задача' }), { TTL: 60, ...trust }),
    (error) => { assert.equal(error.statusCode, 410); return true; },
  );
});
