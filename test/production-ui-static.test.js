import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('production navigation hides presentation-only surfaces unless preview is explicit',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const demo=await readFile(new URL('../public/demo.js',import.meta.url),'utf8');
  assert.match(app,/presentationMode=.*preview/);
  assert.match(app,/staff&&presentationMode\(\).*investor-tour/);
  assert.match(demo,/previewMode/);
});

test('project UI exposes transparent execution health and direct decision execution navigation',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/data-project-health/);
  assert.match(app,/Как рассчитан Execution Health/);
  assert.match(app,/data-project-decision-open/);
  assert.match(app,/decisionDetailModal\(b\.dataset\.projectDecisionOpen\)/);
});


test('project trends use factual 30-day series and explicit 7-day comparisons',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/function projectTrend\(project\)/);
  assert.match(app,/analytics\.time30d/);
  assert.match(app,/analytics\.closed30d/);
  assert.match(app,/Previous 7 days/);
  assert.match(app,/not a performance rating or forecast/);
});

test('More uses compact work-catalogue styling instead of oversized presentation tiles',async()=>{
  const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
  assert.match(css,/More is a work catalogue/);
  assert.match(css,/\.module-card\{display:grid;grid-template-columns:36px minmax\(0,1fr\)/);
});


test('email surface exposes operational communication facts rather than unread-only control',async()=>{
  const email=await readFile(new URL('../public/email.js',import.meta.url),'utf8');
  assert.match(email,/Контроль коммуникаций/);
  assert.match(email,/medianFirstResponseMinutes/);
  assert.match(email,/unassignedSharedCount/);
  assert.match(email,/overdueWaitingCount/);
  assert.match(email,/not a performance rating|не означает/);
});
