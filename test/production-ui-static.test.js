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
