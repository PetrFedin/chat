const fail=(message,code,statusCode=400)=>Object.assign(new Error(message),{code,statusCode,expose:true});
const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const positiveVersion=value=>Number.isSafeInteger(value)&&value>0;
const ref=value=>{if(!id.test(value||''))throw fail('Invalid identifier','PLAN_ID_INVALID');return value};
const days=(from,to)=>Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000);
export function createProjectPlanning({pool,projectRow,assertManage,assertContribute}){
  const tx=async fn=>{const db=await pool.connect();try{await db.query('BEGIN');const v=await fn(db);await db.query('COMMIT');return v;}catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}};
  const lock=async(db,session,projectId,mode='contribute')=>{
    const project=await projectRow(session,projectId,db);
    if(mode==='manage')assertManage(project,session);else assertContribute(project,session);
    await db.query('SELECT id FROM projects WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[session.workspaceId,projectId]);
    const fresh=await projectRow(session,projectId,db);
    if(mode==='manage')assertManage(fresh,session);else assertContribute(fresh,session);
    return fresh;
  };
  const schedule=async(db,session,projectId)=>(
    await db.query('SELECT task_id "taskId",phase_id "phaseId",planned_start::text "plannedStart",planned_end::text "plannedEnd",estimate_minutes "estimateMinutes",version FROM project_plan_tasks WHERE workspace_id=$1 AND project_id=$2 ORDER BY planned_start,task_id',[session.workspaceId,projectId])
  ).rows;
  return {
    async roadmap(session,projectId){
      const project=await projectRow(session,projectId);
      if(!project)throw fail('Project not found','PROJECT_NOT_FOUND',404);
      const [phases,scheduled,deps]=await Promise.all([
        pool.query('SELECT id,title,start_at::text "startAt",end_at::text "endAt",version FROM project_plan_phases WHERE workspace_id=$1 AND project_id=$2 ORDER BY start_at,id',[session.workspaceId,projectId]),
        schedule(pool,session,projectId),
        pool.query('SELECT predecessor_task_id "predecessorTaskId",successor_task_id "successorTaskId",lag_days "lagDays" FROM project_plan_dependencies WHERE workspace_id=$1 AND project_id=$2 ORDER BY predecessor_task_id,successor_task_id',[session.workspaceId,projectId]),
      ]);
      return {phases:phases.rows,schedules:scheduled,dependencies:deps.rows};
    },
    async phase(session,projectId,input){
      const title=typeof input?.title==='string'?input.title.trim():'';
      if(title.length<1||title.length>160||!date(input?.startAt)||!date(input?.endAt)||input.endAt<input.startAt)throw fail('Invalid phase','PLAN_PHASE_INVALID');
      return tx(async db=>{
        await lock(db,session,projectId,'manage');
        const r=await db.query('INSERT INTO project_plan_phases(organization_id,workspace_id,project_id,title,start_at,end_at,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id,title,start_at::text "startAt",end_at::text "endAt",version',[session.organizationId,session.workspaceId,projectId,title,input.startAt,input.endAt,session.userId]);
        await db.query("INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload) VALUES($1,$2,'project',$3,'project.phase_created',$4,$5)",[session.organizationId,session.workspaceId,projectId,session.userId,{phaseId:r.rows[0].id}]);
        return r.rows[0];
      });
    },
    async planTask(session,projectId,taskId,input){
      ref(taskId);
      if(!date(input?.plannedStart)||!date(input?.plannedEnd)||input.plannedEnd<input.plannedStart||!Number.isSafeInteger(input.estimateMinutes??0)||Number(input.estimateMinutes??0)<0||Number(input.estimateMinutes??0)>1000000)throw fail('Invalid schedule','PLAN_SCHEDULE_INVALID');
      if(input.phaseId!=null)ref(input.phaseId);
      return tx(async db=>{
        await lock(db,session,projectId);
        const exists=await db.query('SELECT 1 FROM project_tasks WHERE workspace_id=$1 AND project_id=$2 AND commitment_id=$3',[session.workspaceId,projectId,taskId]);
        if(!exists.rowCount)throw fail('Project task not found','PROJECT_TASK_NOT_FOUND',404);
        if(input.phaseId){
          const phase=await db.query('SELECT 1 FROM project_plan_phases WHERE workspace_id=$1 AND project_id=$2 AND id=$3',[session.workspaceId,projectId,input.phaseId]);
          if(!phase.rowCount)throw fail('Project phase not found','PROJECT_PHASE_NOT_FOUND',404);
        }
        const current=await db.query('SELECT version FROM project_plan_tasks WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3 FOR UPDATE',[session.workspaceId,projectId,taskId]);
        if(current.rowCount&&(!positiveVersion(input.expectedVersion)||current.rows[0].version!==input.expectedVersion))throw fail('Schedule changed','STALE_VERSION',409);
        if(!current.rowCount&&input.expectedVersion!=null)throw fail('Schedule changed','STALE_VERSION',409);
        const r=await db.query(`INSERT INTO project_plan_tasks(workspace_id,project_id,task_id,phase_id,planned_start,planned_end,estimate_minutes,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (project_id,task_id) DO UPDATE SET phase_id=EXCLUDED.phase_id,planned_start=EXCLUDED.planned_start,planned_end=EXCLUDED.planned_end,estimate_minutes=EXCLUDED.estimate_minutes,updated_by=EXCLUDED.updated_by,updated_at=now(),version=project_plan_tasks.version+1
          RETURNING task_id "taskId",phase_id "phaseId",planned_start::text "plannedStart",planned_end::text "plannedEnd",estimate_minutes "estimateMinutes",version`,
          [session.workspaceId,projectId,taskId,input.phaseId??null,input.plannedStart,input.plannedEnd,input.estimateMinutes??0,session.userId]);
        await db.query("INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload) VALUES($1,$2,'project',$3,'project.task_scheduled',$4,$5)",[session.organizationId,session.workspaceId,projectId,session.userId,{taskId,version:r.rows[0].version}]);
        return r.rows[0];
      });
    },
    async depend(session,projectId,input){
      const predecessor=ref(input?.predecessorTaskId),successor=ref(input?.successorTaskId);
      if(predecessor===successor)throw fail('Self-dependency','PLAN_DEPENDENCY_CYCLE',409);
      const lag=input?.lagDays??0;if(!Number.isSafeInteger(lag)||lag<0||lag>365)throw fail('Invalid lag','PLAN_LAG_INVALID');
      return tx(async db=>{
        await lock(db,session,projectId);
        const edges=(await db.query('SELECT predecessor_task_id a,successor_task_id b FROM project_plan_dependencies WHERE workspace_id=$1 AND project_id=$2',[session.workspaceId,projectId])).rows;
        const adjacency=new Map();
        for(const e of edges){if(!adjacency.has(e.a))adjacency.set(e.a,[]);adjacency.get(e.a).push(e.b);}
        const seen=new Set(),stack=[successor];
        while(stack.length){const node=stack.pop();if(node===predecessor)throw fail('Dependency cycle','PLAN_DEPENDENCY_CYCLE',409);if(seen.has(node))continue;seen.add(node);stack.push(...(adjacency.get(node)||[]));}
        const checked=await db.query('SELECT commitment_id FROM project_tasks WHERE workspace_id=$1 AND project_id=$2 AND commitment_id=ANY($3::uuid[])',[session.workspaceId,projectId,[predecessor,successor]]);
        if(checked.rowCount!==2)throw fail('Task not found in project','PROJECT_TASK_NOT_FOUND',404);
        try{await db.query('INSERT INTO project_plan_dependencies(workspace_id,project_id,predecessor_task_id,successor_task_id,lag_days,created_by) VALUES($1,$2,$3,$4,$5,$6)',[session.workspaceId,projectId,predecessor,successor,lag,session.userId]);}
        catch(error){if(error.code==='23505')throw fail('Dependency already exists','PLAN_DEPENDENCY_EXISTS',409);throw error;}
        await db.query("INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload) VALUES($1,$2,'project',$3,'project.dependency_created',$4,$5)",[session.organizationId,session.workspaceId,projectId,session.userId,{predecessorTaskId:predecessor,successorTaskId:successor,lagDays:lag}]);
        return {predecessorTaskId:predecessor,successorTaskId:successor,lagDays:lag};
      });
    },
  };
}
