import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Permission, hasPermission } from '../src/rbac.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const operations = readFileSync(new URL('../public/meeting-operations.js', import.meta.url), 'utf8');

/**
 * Отчёт о расходах на встречи.
 *
 * Единственным входом была кнопка «Контроль», которую этот файл сам
 * дорисовывал в шапку чужой карточки — «Итоги встреч». Чтобы увидеть,
 * сколько компания тратит на расшифровки, приходилось открыть «Ещё»,
 * открыть итоги встреч, найти кнопку в их шапке и переключить вкладку.
 * Четыре шага за чужим экраном — при том что это отдельный отчёт
 * с собственным правом доступа.
 */
test('расходы на встречи открываются из «Ещё» одним нажатием', () => {
  assert.match(app, /data-action="meeting-ops"/, 'плитка расходов пропала из «Ещё»');
  assert.match(app, /\$\{can\('meeting\.cost\.read'\)\|\|can\('meeting\.ops\.manage'\)\?/,
    'плитку видно не по праву доступа');
  assert.match(app, /Расходы на встречи/);
  assert.match(app, /'meeting-ops':\(\)=>window\.ChatMeetingOperations\?\.open\?\.\(can\('meeting\.cost\.read'\)\?'costs':'jobs'\)/,
    'плитка перестала открывать сразу вкладку расходов');

  // Панель должна отдавать наружу то, что плитка зовёт.
  assert.match(operations, /window\.ChatMeetingOperations=\{open:openOps/);
  // И сама решать по правам, а не доверять вызывающему.
  assert.match(operations, /if\(!canOpen\(\)\)\{toast\(/);

  // Кто не платит за встречи, тот плитки и не видит.
  assert.equal(hasPermission('guest', Permission.MEETING_COST_READ), false);
  assert.equal(hasPermission('member', Permission.MEETING_COST_READ), false);
  assert.equal(hasPermission('owner', Permission.MEETING_COST_READ), true);
});
