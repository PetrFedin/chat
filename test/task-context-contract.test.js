import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openapi } from '../src/openapi.js';

test('task context is a read-only current-access composition of canonical modules',async()=>{
  const workspace=await readFile(new URL('../src/http/workspace.js',import.meta.url),'utf8');
  const projects=await readFile(new URL('../src/project/project-repository.js',import.meta.url),'utf8');
  const wiki=await readFile(new URL('../src/wiki/wiki-repository.js',import.meta.url),'utf8');
  const decisions=await readFile(new URL('../src/decisions/decision-task-links.js',import.meta.url),'utf8');

  assert.match(workspace,/TASK_ID\+'\/context\$'/);
  assert.match(workspace,/scope:'current_access_only'/);
  assert.match(workspace,/projectsForTask/);
  assert.match(workspace,/pagesForTask/);
  assert.match(workspace,/decisionsForTask/);
  assert.match(workspace,/getResourceLinks\(session,'task'/);

  assert.match(projects,/const task=await store\.getTask\(session,taskId\)/);
  assert.match(projects,/const project=await row\(session,link\.projectId\)/);
  assert.match(wiki,/const task = await store\.getTask\(session, taskId\)/);
  assert.match(wiki,/visibleRows\(session, rows\)/);
  assert.match(decisions,/await requireTask\(session,taskId\)/);
  assert.match(decisions,/meeting\.getDecision\(session,link\.decisionId\)/);

  assert.ok(openapi.paths['/api/v1/tasks/{taskId}/context']?.get);
});

test('task UI loads context dynamically instead of copying relation state into the Task',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/data-task-context/);
  assert.match(app,/\/api\/v1\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/context/);
  assert.match(app,/Only links you can access right now/);
  assert.match(app,/data-task-context-kind/);
});
