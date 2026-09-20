import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const ID = '00000000-0000-4000-8000-000000000000';

const FRONT = ['app.js', 'daily-work.js', 'meeting-intelligence.js', 'meeting-operations.js', 'calls-ui.js', 'demo.js'];

function frontendPaths() {
  const paths = new Map();
  for (const file of FRONT) {
    let source;
    try { source = read(`public/${file}`); } catch { continue; }
    for (const m of source.matchAll(/['"`](\/api\/v1\/[^'"`\s]*)/g)) {
      const path = m[1]
        .replace(/([^/])\$\{[^}]*\}/g, '$1')
        .replace(/\$\{[^}]*\}/g, ID)
        .split('?')[0].replace(/\/+$/, '');
      // Подстановка внутри подстановки — не адрес, а кусок выражения.
      if (path.includes('${') || path.length <= '/api/v1/'.length) continue;
      if (!paths.has(path)) paths.set(path, file);
    }
  }
  return paths;
}

function serverRoutes() {
  // Маршруты записаны по-разному: строкой, шаблоном, регулярным
  // выражением-литералом. Разбирать каждую форму отдельно — значит
  // проглядеть четвёртую, поэтому берём любой кусок текста, похожий на
  // адрес, и приводим его к образцу.
  const routes = [];
  const files = ['src/server.js', ...readdirSync(join(root, 'src/http')).map((f) => `src/http/${f}`),
    'src/demo/preview-demo.js'];
  for (const file of files) {
    let source;
    try { source = read(file); } catch { continue; }
    for (const m of source.matchAll(/\/api\\?\/?v1[^'"`\s]*/g)) {
      const raw = m[0]
        .replace(/\\\//g, '/')                    // \/ → /
        .replace(/\$\{[^}]*\}/g, '<id>')           // ${ID} и прочие подстановки
        .replace(/\(\[[^\]]*\][^)]*\)/g, '<id>')    // ([0-9a-f-]{36})
        .replace(/\$$/, '');
      if (!raw.startsWith('/api/v1/')) continue;
      const pattern = raw
        .split('<id>')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[0-9a-zA-Z-]+');
      try { routes.push({ re: new RegExp(`^${pattern}(/|$)`, 'i'), file }); } catch { /* не адрес */ }
    }
  }
  return routes;
}

// Экран, зовущий несуществующий адрес, выглядит как сломанная кнопка:
// нажал — ничего. Такую связь надо ловить до человека.
test('every address the interface calls exists on the server', () => {
  const wanted = frontendPaths();
  const routes = serverRoutes();
  assert.ok(routes.length > 80, `правил на сервере подозрительно мало: ${routes.length}`);

  const missing = [...wanted].filter(([path]) => !routes.some(({ re }) => re.test(path)));
  assert.deepEqual(missing.map(([path, file]) => `${file} → ${path}`), [],
    'интерфейс зовёт адреса, которых на сервере нет');
});

// Обратная сторона: действие в разметке без обработчика — та же
// сломанная кнопка, только молча.
test('every data-action in the markup has a handler', async () => {
  const app = read('public/app.js');
  const html = read('public/index.html');
  const declared = new Set();
  const table = app.match(/const actions=\{([\s\S]*?)\n/)?.[1] ?? '';
  for (const m of table.matchAll(/(?:^|,|\{)\s*'?([a-z-]+)'?\s*(?=[:,])/g)) declared.add(m[1]);

  const used = new Set();
  for (const source of [app, html]) {
    for (const m of source.matchAll(/data-action="([a-z-]+)"/g)) used.add(m[1]);
  }
  // Эти обрабатываются своими модулями, а не общей таблицей.
  const elsewhere = new Set(['search', 'files', 'audio', 'video']);
  const orphans = [...used].filter((action) => !declared.has(action) && !elsewhere.has(action));
  assert.deepEqual(orphans, [], 'в разметке есть действия, которые никто не обрабатывает');
});
