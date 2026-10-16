import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
async function req(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(base+path,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  return{status:response.status,payload:await response.json().catch(()=>null),
    cookie:response.headers.get('set-cookie')?.split(';')[0]??null};
}
async function register(base,label){
  const suffix=randomUUID().slice(0,10);
  const made=await req(base,'/api/v1/auth/register-company',{method:'POST',body:{
    companyName:label+' '+suffix,ownerName:'Owner',email:'planning-'+suffix+'@example.test',
    password:'ProjectPlanningPassword42',
  }});
  assert.equal(made.status,201);
  const boot=await req(base,'/api/v1/bootstrap',{cookie:made.cookie});
  assert.equal(boot.status,200);
  return{cookie:made.cookie,userId:boot.payload.session.userId,
    workspaceId:boot.payload.session.workspaceId};
}
async function invite(base,cookie){
  const suffix=randomUUID().slice(0,10);
  const made=await req(base,'/api/v1/invitations',{cookie,method:'POST',body:{
    email:'planning-member-'+suffix+'@example.test',role:'member',
  }});
  assert.equal(made.status,201);
  const token=new URL(made.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await req(base,'/api/v1/invitations/accept',{method:'POST',body:{
    token,displayName:'Planning colleague',password:'ProjectPlanningPassword42',
  }});
  assert.equal(accepted.status,201);
  return accepted.cookie;
}

test('Project planning: tenant authority, canonical tasks, phases, CAS versions and DAG', 
  {skip:!databaseUrl,timeout:120000},async t=>{
    const app=await createChatServer({databaseUrl,startMeetingWorker:false});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    t.after(()=>app.close());
    const base='http://127.0.0.1:'+app.server.address().port;
    const owner=await register(base,'Planning');
    const stranger=await register(base,'Other workspace');
    const colleague=await invite(base,owner.cookie);
    const createProject=async name=>req(base,'/api/v1/projects',{
      cookie:owner.cookie,method:'POST',body:{name,visibility:'members',
        startAt:'2026-11-01',targetAt:'2026-12-20'},
    });
    const made=await createProject('Planning canonical');
    assert.equal(made.status,201);
    const projectId=made.payload.project.id;
    const project2=(await createProject('Other scoped context')).payload.project.id;
    const root=`/api/v1/projects/${projectId}/plan`;
    const newTask=async(title,context=projectId)=>req(base,`/api/v1/projects/${context}/tasks`,{
      cookie:owner.cookie,method:'POST',body:{title,outcome:'Verified result',
        ownerId:owner.userId,acceptorId:owner.userId},
    });
    const first=(await newTask('Design')).payload.task;
    const second=(await newTask('Develop')).payload.task;
    const other=(await newTask('Another context',project2)).payload.task;
    const unlinked=(await req(base,root,{cookie:owner.cookie})).payload.plan;
    assert.deepEqual(unlinked.phases,[]);
    assert.deepEqual(unlinked.dependencies,[]);
    assert.equal((await req(base,root,{cookie:stranger.cookie})).status,404);
    assert.equal((await req(base,root,{cookie:colleague})).status,404);

    const phaseMade=await req(base,root+'/phases',{cookie:owner.cookie,method:'POST',body:{
      title:'Build',startAt:'2026-11-01',endAt:'2026-11-30',
    }});
    assert.equal(phaseMade.status,201);
    const phase=phaseMade.payload.phase;
    assert.equal(phase.version,1);
    assert.equal((await req(base,root+'/phases',{cookie:owner.cookie,method:'POST',body:{
      title:'Invalid',startAt:'2026-02-30',endAt:'2026-03-10',
    }})).status,400);
    const updatedPhase=await req(base,root+'/phases/'+phase.id,{cookie:owner.cookie,method:'PATCH',body:{
      title:'Build and launch',expectedVersion:1,
    }});
    assert.equal(updatedPhase.status,200);
    assert.equal(updatedPhase.payload.phase.version,2);
    const stale=await req(base,root+'/phases/'+phase.id,{cookie:owner.cookie,method:'PATCH',body:{
      title:'Stale title',expectedVersion:1,
    }});
    assert.equal(stale.status,409);

    const taskPath=id=>root+'/tasks/'+id;
    const scheduled=await req(base,taskPath(first.id),{cookie:owner.cookie,method:'PUT',body:{
      plannedStart:'2026-11-02',plannedEnd:'2026-11-20',phaseId:phase.id,
      estimateMinutes:1200,expectedVersion:0,
    }});
    assert.equal(scheduled.status,200);
    assert.equal(scheduled.payload.schedule.version,1);
    assert.equal(scheduled.payload.schedule.estimateMinutes,1200);
    assert.equal((await req(base,taskPath(first.id),{cookie:owner.cookie,method:'PUT',body:{
      plannedStart:'2026-11-04',plannedEnd:'2026-11-17',expectedVersion:0,
    }})).status,409);
    assert.equal((await req(base,taskPath(other.id),{cookie:owner.cookie,method:'PUT',body:{
      plannedStart:'2026-11-02',plannedEnd:'2026-11-03',expectedVersion:0,
    }})).status,404,'cross-project task must not be scheduled');
    const secondPlan=await req(base,taskPath(second.id),{cookie:owner.cookie,method:'PUT',body:{
      plannedStart:'2026-11-18',plannedEnd:'2026-11-29',estimateMinutes:900,expectedVersion:0,
    }});
    assert.equal(secondPlan.status,200);
    const dependency={predecessorTaskId:first.id,successorTaskId:second.id};
    assert.equal((await req(base,root+'/dependencies',{
      cookie:owner.cookie,method:'POST',body:dependency,
    })).status,201);
    assert.equal((await req(base,root+'/dependencies',{
      cookie:owner.cookie,method:'POST',body:dependency,
    })).status,409);
    const cycle=await req(base,root+'/dependencies',{cookie:owner.cookie,method:'POST',body:{
      predecessorTaskId:second.id,successorTaskId:first.id,
    }});
    assert.equal(cycle.status,409);
    assert.equal(cycle.payload.error.code,'PLAN_DEPENDENCY_CYCLE');
    const cross=await req(base,root+'/dependencies',{cookie:owner.cookie,method:'POST',body:{
      predecessorTaskId:first.id,successorTaskId:other.id,
    }});
    assert.equal(cross.status,404);
    let plan=(await req(base,root,{cookie:owner.cookie})).payload.plan;
    assert.equal(plan.phases.length,1);
    assert.equal(plan.schedules.length,2);
    assert.equal(plan.dependencies.length,1);
    assert.equal(plan.violations.length,1,'finish-to-start overlap is presented, not silently rescheduled');
    assert.equal(plan.visibleEstimatedMinutes,2100);
    const corrected=await req(base,taskPath(second.id),{cookie:owner.cookie,method:'PUT',body:{
      plannedStart:'2026-11-23',plannedEnd:'2026-11-29',
      estimateMinutes:900,expectedVersion:secondPlan.payload.schedule.version,
    }});
    assert.equal(corrected.status,200);
    assert.equal(corrected.payload.schedule.version,2);
    plan=(await req(base,root,{cookie:owner.cookie})).payload.plan;
    assert.equal(plan.violations.length,0);

    // A scenario previews a dependency shift, but cannot change persisted
    // schedules, Task Authority status, or reveal a private project's tasks.
    const baseline=(await req(base,root,{cookie:owner.cookie})).payload.plan;
    const preview=await req(base,root+'/preview',{cookie:owner.cookie,method:'POST',body:{
      taskId:first.id,shiftDays:3,
    }});
    assert.equal(preview.status,200);
    assert.equal(preview.payload.preview.kind,'read_only_preview');
    assert.equal(preview.payload.preview.shiftDays,3);
    assert.ok(preview.payload.preview.changedTasks.some(t=>t.taskId===first.id));
    assert.deepEqual((await req(base,root,{cookie:owner.cookie})).payload.plan.schedules,
      baseline.schedules,'preview must not persist any schedule change');
    assert.equal((await req(base,root+'/preview',{cookie:stranger.cookie,method:'POST',body:{
      taskId:first.id,shiftDays:2,
    }})).status,404);
    assert.equal((await req(base,root+'/preview',{cookie:owner.cookie,method:'POST',body:{
      taskId:other.id,shiftDays:1,
    }})).status,404);
    assert.equal((await req(base,root+'/preview',{cookie:owner.cookie,method:'POST',body:{
      taskId:first.id,shiftDays:500,
    }})).status,400);

    const canonical=await req(base,`/api/v1/tasks/${first.id}`,{cookie:owner.cookie});
    assert.equal(canonical.status,200);
    assert.equal(canonical.payload.task.id,first.id);
    assert.equal(canonical.payload.task.status,first.status,
      'planning cannot overwrite the Task Authority lifecycle');
    const outsiderProject=await req(base,`/api/v1/projects/${projectId}`,{cookie:stranger.cookie});
    assert.equal(outsiderProject.status,404);
    const visibleProject=await req(base,`/api/v1/projects/${projectId}`,{cookie:owner.cookie});
    assert.equal(visibleProject.payload.project.plan.schedules.length,2);

    const audit=await app.store.pool.query(
      `SELECT event_type,payload FROM audit_events
       WHERE workspace_id=$1 AND aggregate_id=$2 AND event_type LIKE 'project.plan_%'`,
      [owner.workspaceId,projectId],
    );
    assert.ok(audit.rows.some(event=>event.event_type==='project.plan_dependency_added'));
    assert.ok(audit.rows.every(event=>!JSON.stringify(event.payload).includes('Verified result')),
      'planning audit contains IDs and versions, never task bodies');
    assert.equal((await req(base,root+'/dependencies/'+first.id+'/'+second.id,{
      cookie:owner.cookie,method:'DELETE',
    })).status,200);
    assert.equal((await req(base,root,{cookie:owner.cookie})).payload.plan.dependencies.length,0);
    assert.equal((await req(base,`/api/v1/projects/${projectId}/tasks/${first.id}`,{
      cookie:owner.cookie,method:'DELETE',
    })).status,200);
    assert.equal((await req(base,root,{cookie:owner.cookie})).payload.plan.schedules.length,1,
      'unlinking a canonical project task cascades its planning projection');
  });
