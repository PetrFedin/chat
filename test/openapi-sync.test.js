import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openapi } from '../src/openapi.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Спецификация умалчивала о половине работающих маршрутов: справочник людей,
 * журнал, сейф, напоминания, пометки, дела, игры, настройки компании. По
 * спецификации судят, что в продукте есть, — умолчание хуже отсутствия.
 *
 * Сравниваем не пути целиком (в коде они регулярки с параметрами), а корни
 * первого уровня: появился новый раздел API — он обязан быть описан.
 */
const rootOf = (path) => path.replace(/^\/api\/v1\//, '').split('/')[0].replace(/[^a-z-]/gi, '');

test('в спецификации есть каждый раздел API, который обслуживает сервер', () => {
  const documented = new Set(Object.keys(openapi.paths)
    .filter((path) => path.startsWith('/api/v1/'))
    .map(rootOf));

  const served = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const source = readFileSync(full, 'utf8');
      for (const match of source.matchAll(/['"`]\/api\/v1\/([a-z-]+)/gi)) served.add(match[1]);
    }
  };
  walk(join(root, 'src'));

  // Служебные пути, которые не являются разделами API.
  const ignore = new Set(['openapi']);
  const missing = [...served].filter((name) => !documented.has(name) && !ignore.has(name)).sort();
  assert.deepEqual(missing, [], `эти разделы сервер обслуживает, а спецификация о них молчит: ${missing.join(', ')}`);
});

test('спецификация не описывает того, чего нет', () => {
  const served = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const source = readFileSync(full, 'utf8');
      for (const match of source.matchAll(/['"`]\/api\/v1\/([a-z-]+)/gi)) served.add(match[1]);
    }
  };
  walk(join(root, 'src'));

  const phantom = [...new Set(Object.keys(openapi.paths)
    .filter((path) => path.startsWith('/api/v1/'))
    .map(rootOf))].filter((name) => !served.has(name)).sort();
  assert.deepEqual(phantom, [], `спецификация обещает то, чего сервер не отдаёт: ${phantom.join(', ')}`);
});


test('recent compositional APIs are documented at operation level', () => {
  const required = [
    ['get', '/api/v1/projects'],
    ['post', '/api/v1/projects'],
    ['get', '/api/v1/projects/{projectId}'],
    ['post', '/api/v1/projects/{projectId}/tasks'],
    ['post', '/api/v1/projects/{projectId}/decisions'],
    ['get', '/api/v1/features'],
    ['put', '/api/v1/features/{featureId}'],
    ['get', '/api/v1/conversations/{conversationId}/topics'],
    ['post', '/api/v1/conversations/{conversationId}/topics'],
    ['patch', '/api/v1/conversations/{conversationId}/topics/{topicId}'],
    ['get', '/api/v1/conversations/{conversationId}/topics/{topicId}/messages'],
    ['post', '/api/v1/wiki/pages/{pageId}/tasks'],
    ['delete', '/api/v1/wiki/pages/{pageId}/tasks/{taskId}'],
    ['post', '/api/v1/wiki/pages/{pageId}/channels'],
    ['delete', '/api/v1/wiki/pages/{pageId}/channels/{conversationId}'],
    ['get', '/api/v1/wiki/pages/{pageId}/access'],
    ['put', '/api/v1/wiki/pages/{pageId}/access'],
    ['post', '/api/v1/wiki/pages/{pageId}/access'],
    ['delete', '/api/v1/wiki/pages/{pageId}/access/{userId}'],
    ['post', '/api/v1/wiki/pages/{pageId}/calendar-meetings'],
    ['delete', '/api/v1/wiki/pages/{pageId}/calendar-meetings/{eventId}'],
    ['post', '/api/v1/wiki/pages/{pageId}/calls'],
    ['delete', '/api/v1/wiki/pages/{pageId}/calls/{callId}'],
    ['post', '/api/v1/wiki/pages/{pageId}/decisions'],
    ['delete', '/api/v1/wiki/pages/{pageId}/decisions/{decisionId}'],
    ['post', '/api/v1/wiki/pages/{pageId}/projects'],
    ['delete', '/api/v1/wiki/pages/{pageId}/projects/{projectId}'],
    ['get', '/api/v1/wiki/decisions/{decisionId}/pages'],
  ];
  for (const [method, path] of required) {
    assert.ok(openapi.paths[path]?.[method], `${method.toUpperCase()} ${path} is implemented but missing from OpenAPI`);
  }
});
