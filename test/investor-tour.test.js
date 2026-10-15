import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalProofLink, hypotheticalEconomics, isSyntheticDemoWorkspace } from '../public/investor-tour.js';

test('investor tour deep links only reference canonical UUID objects',()=>{
  const id='7f59efde-8859-4255-9382-1de0d06ec990';
  assert.equal(canonicalProofLink('project',id),'/#/projects/'+id);
  assert.equal(canonicalProofLink('task',id),'/#/tasks/'+id);
  assert.equal(canonicalProofLink('conversation',id),'/#/chats/'+id);
  assert.equal(canonicalProofLink('calendar',id),'/#/calendar/'+id);
  for(const malformed of ['../../another','"><script>','not-a-uuid',undefined]){
    assert.equal(canonicalProofLink('project',malformed),null);
  }
  assert.equal(canonicalProofLink('unknown',id),null);
});

test('economics contains no fabricated defaults and rejects invalid assumptions',()=>{
  assert.equal(hypotheticalEconomics(),null);
  const valid={people:2,hoursPerWeek:2,hourCost:100,platformPerMonth:200,implementationCost:1200,months:12};
  for(const key of Object.keys(valid))assert.equal(hypotheticalEconomics({...valid,[key]:''}),null);
  for(const invalid of [
    {...valid,people:0},{...valid,people:1.5},{...valid,hoursPerWeek:-1},
    {...valid,hourCost:Infinity},{...valid,months:0},{...valid,months:121},
  ]) assert.equal(hypotheticalEconomics(invalid),null);
  const result=hypotheticalEconomics(valid);
  const gross=2*2*100*52/12;
  assert.ok(result);
  assert.equal(result.monthlyGross,gross);
  assert.equal(result.monthlyNet,gross-200-1200/12);
  assert.equal(result.paybackMonths,1200/(gross-200));
  assert.equal(hypotheticalEconomics({...valid,platformPerMonth:5000}).paybackMonths,null);
});

test('investor walkthrough is present only as non-guest action in navigation',async()=>{
  const {readFile}=await import('node:fs/promises');
  const src=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/staff\?\x60<button class="module-card pressable" data-action="investor-tour"/);
  assert.match(src,/if\(guestShell\(\)\)return;/);
  assert.match(src,/async function investorTourModal\(/);
});

test('all demo actors are labeled synthetic, unrelated tenants are not',()=>{
  const demo={enabled:true,label:'Northstar Studio'};
  assert.equal(isSyntheticDemoWorkspace(demo,{email:'demo@northstar.example',organizationName:'Northstar Studio'}),true);
  assert.equal(isSyntheticDemoWorkspace(demo,{email:'marina@northstar.example',organizationName:'Northstar Studio'}),true);
  assert.equal(isSyntheticDemoWorkspace(demo,{email:'ilya@northstar.example',organizationName:'Northstar Studio'}),true);
  assert.equal(isSyntheticDemoWorkspace(demo,{email:'customer@example.org',organizationName:'Northstar Studio'}),false);
  assert.equal(isSyntheticDemoWorkspace(demo,{email:'marina@northstar.example',organizationName:'Another Workspace'}),false);
  assert.equal(isSyntheticDemoWorkspace({enabled:false,label:'Northstar Studio'},{email:'demo@northstar.example',organizationName:'Northstar Studio'}),false);
});
