import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics } from '../src/obs/metrics.js';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

/**
 * Журнал отвечает «что случилось с этим запросом». На вопросы «сколько
 * их в секунду» и «растёт ли очередь» он не отвечает никак: считать
 * строки журнала в поисках тренда — не мониторинг.
 */
test('счётчики, гистограммы и датчики складываются в формат Prometheus', () => {
  const metrics = createMetrics();
  metrics.count('chat_http_requests_total', { method: 'GET', route: '/api/v1/me', status: 200 });
  metrics.count('chat_http_requests_total', { method: 'GET', route: '/api/v1/me', status: 200 });
  metrics.observe('chat_http_request_seconds', { route: '/api/v1/me' }, 0.03);
  metrics.observe('chat_http_request_seconds', { route: '/api/v1/me' }, 3);
  metrics.gauge('chat_websocket_connections', () => 7);

  const text = metrics.render();
  assert.match(text, /chat_http_requests_total\{method="GET",route="\/api\/v1\/me",status="200"\} 2/);
  assert.match(text, /# TYPE chat_http_request_seconds histogram/);
  // Гистограмма кумулятивная: в корзину «до 2.5 с» попадает и быстрый запрос.
  assert.match(text, /chat_http_request_seconds_bucket\{route="\/api\/v1\/me",le="0\.05"\} 1/);
  assert.match(text, /chat_http_request_seconds_bucket\{route="\/api\/v1\/me",le="2\.5"\} 1/);
  assert.match(text, /chat_http_request_seconds_bucket\{route="\/api\/v1\/me",le="\+Inf"\} 2/);
  assert.match(text, /chat_http_request_seconds_count\{route="\/api\/v1\/me"\} 2/);
  assert.match(text, /chat_websocket_connections 7/);

  // Сломанный датчик не роняет сбор: мониторинг, падающий вместе с тем,
  // что он мониторит, бесполезен.
  metrics.gauge('chat_broken', () => { throw new Error('датчик сломан'); });
  assert.doesNotThrow(() => metrics.render());
  assert.doesNotMatch(metrics.render(), /chat_broken \d/);

  // Кавычка в метке не должна ломать формат.
  metrics.count('chat_odd_total', { route: 'кавычка"внутри' });
  assert.match(metrics.render(), /route="кавычка\\"внутри"/);
});

test('метрики отдаются маршрутом и считают настоящие запросы',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  await fetch(`${base}/healthz`);
  await fetch(`${base}/api/v1/me`);
  const text = await (await fetch(`${base}/metrics`)).text();

  assert.match(text, /chat_http_requests_total\{method="GET",route="\/healthz",status="200"\} 1/);
  assert.match(text, /chat_http_requests_total\{method="GET",route="\/api\/v1\/me",status="401"\} 1/);
  // Глубина очередей и пул соединений — то, по чему видно аварию заранее.
  assert.match(text, /chat_queue_pending\{queue="mail"\}/);
  assert.match(text, /chat_queue_pending\{queue="webhooks"\}/);
  assert.match(text, /chat_db_pool_total \d+/);
  assert.match(text, /chat_websocket_connections \d+/);

  // В мониторинг не должны утекать люди и пространства: он живёт годами
  // и виден всей эксплуатации. В маршруте — только :id.
  assert.doesNotMatch(text, /userId|wsId|workspaceId/);
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-/, 'в метрику попал идентификатор');
});

test('метрики закрываются токеном, когда он задан',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const previous = process.env.METRICS_TOKEN;
  process.env.METRICS_TOKEN = 'tok3n';
  t.after(() => { if (previous === undefined) delete process.env.METRICS_TOKEN; else process.env.METRICS_TOKEN = previous; });

  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  assert.equal((await fetch(`${base}/metrics`)).status, 401);
  assert.equal((await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer tok3n' } })).status, 200);
});
