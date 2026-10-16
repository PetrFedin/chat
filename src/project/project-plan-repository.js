// Project Planning v1: time and dependency metadata only.
// Task status, owners, permissions and evidence remain canonical in Task Authority.
const fail=(message,code,statusCode=400)=>Object.assign(new Error(message),{code,statusCode,expose:true});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayMs=86400000;
const day=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)
    ||new Date(value+'T00:00:00.000Z').toISOString?.().slice(0,10)!==value)
    throw fail('Date must be a real YYYY-MM-DD','INVALID_PLAN_DATE');
  return value;
};
const dates=(start,end)=>{
  const first=day(start),last=day(end);
  if(first>last)throw fail('Plan end precedes start','INVALID_PLAN_RANGE');
  return [first,last];
};
const expected=value=>{
  if(!Number.isSafeInteger(value)||value<0)throw fail('Expected version is required (0 for a new task plan)','PLAN_VERSION_REQUIRED',400);
  return value;
};
const title=value=>{
  if(typeof value!=='string'||!value.trim()||value.trim().length>160)
    throw fail('Phase title must contain 1-160 characters','INVALID_PLAN_PHASE_TITLE');
  return value.trim();
};
const minutes=value=>{
  const n=value===undefined?0:value;
  if(!Number.isSafeInteger(n)||n<0||n>1000000)
    throw fail('Estimate must be an integer in minutes','INVALID_PLAN_ESTIMATE');
  return n;
};
const lag=value=>{
  const n=value===undefined?0:value;
  if(!Number.isSafeInteger(n)||n<0||n>365)throw fail('Lag must be 0-365 whole days','INVALID_PLAN_LAG');
  return n;
};
const id=value=>{
  if(typeof value!=='string'||!uuid.test(value))throw fail('Item not found','PROJECT_PLAN_NOT_FOUND',404);
  return value;
};
const asDate=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
const projection=row=>({
  ...row,
  plannedStart:asDate(row.plannedStart),
  plannedEnd:asDate(row.plannedEnd),
  estimateMinutes:Number(row.estimateMinutes||0),
});
const phaseProjection=row=>({
  ...row,startAt:asDate(row.startAt),endAt:asDate(row.endAt),
});
const audit=async(db,session,projectId,event,payload)=>{
  await db.query(
    `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
     VALUES($1,$2,'project',$3,$4,$5,$6)`,
    [session.organizationId,session.workspaceId,projectId,event,session.userId,payload],
  );
};
function wouldCycle(edges,predecessor,successor){
  const outgoing=new Map();
  for(const e of edges){
    const source=e.predecessorTaskId,target=e.successorTaskId;
    if(!outgoing.has(source))outgoing.set(source,[]);
    outgoing.get(source).push(target);
  }
  const seen=new Set(),stack=[successor];
  while(stack.length){
    const node=stack.pop();
    if(node===predecessor)return true;
    if(seen.has(node))continue;
    seen.add(node);
    stack.push(...(outgoing.get(node)||[]));
  }
  return false;
}

export function createProjectPlanning({pool,store,row,lockProject,tx,assertManage,assertContribute}){
  const writable=async(db,session,projectId,manage=false)=>{
    await lockProject(db,session,projectId);
    const project=await row(session,projectId,db);
    if(manage)assertManage(project,session);
    else assertContribute(project,session);
  };
  const visibleLinkedTask=async(db,session,projectId,taskId)=>{
    id(taskId);
    const task=await store.getTask(session,taskId);
    if(!task)throw fail('Task not found','TASK_NOT_FOUND',404);
    const {rowCount}=await db.query(
      'SELECT 1 FROM project_tasks WHERE workspace_id=$1 AND project_id=$2 AND commitment_id=$3',
      [session.workspaceId,projectId,taskId],
    );
    if(!rowCount)throw fail('Task not found','TASK_NOT_FOUND',404);
  };

  return {
    async read(session,projectId,visibleTaskIds=[]){
      const [phaseResult,planResult,depResult]=await Promise.all([
        pool.query(
          `SELECT id,title,start_at "startAt",end_at "endAt",version,
                  created_by "createdBy",updated_at "updatedAt"
             FROM project_plan_phases WHERE workspace_id=$1 AND project_id=$2
            ORDER BY start_at,id`,[session.workspaceId,projectId]),
        pool.query(
          `SELECT task_id "taskId",phase_id "phaseId",planned_start "plannedStart",
                  planned_end "plannedEnd",estimate_minutes "estimateMinutes",version,
                  updated_by "updatedBy",updated_at "updatedAt"
             FROM project_plan_tasks WHERE workspace_id=$1 AND project_id=$2
            ORDER BY planned_start,task_id`,[session.workspaceId,projectId]),
        pool.query(
          `SELECT predecessor_task_id "predecessorTaskId",
                  successor_task_id "successorTaskId",lag_days "lagDays"
             FROM project_plan_dependencies WHERE workspace_id=$1 AND project_id=$2
            ORDER BY predecessor_task_id,successor_task_id`,[session.workspaceId,projectId]),
      ]);
      const allowed=new Set(visibleTaskIds);
      const schedules=planResult.rows.filter(r=>allowed.has(r.taskId)).map(projection);
      const dependencies=depResult.rows.filter(r=>allowed.has(r.predecessorTaskId)&&allowed.has(r.successorTaskId));
      const plans=new Map(schedules.map(r=>[r.taskId,r]));
      const violations=dependencies.flatMap(link=>{
        const from=plans.get(link.predecessorTaskId),to=plans.get(link.successorTaskId);
        if(!from||!to)return[];
        const minDate=Date.parse(from.plannedEnd+'T00:00:00Z')+(link.lagDays+1)*dayMs;
        return Date.parse(to.plannedStart+'T00:00:00Z')<minDate
          ? [{predecessorTaskId:link.predecessorTaskId,successorTaskId:link.successorTaskId,kind:'finish_to_start'}]
          : [];
      });
      return{
        phases:phaseResult.rows.map(phaseProjection),schedules,dependencies,violations,
        visibleScheduledTasks:schedules.length,
        visibleEstimatedMinutes:schedules.reduce((sum,s)=>sum+s.estimateMinutes,0),
      };
    },

    async createPhase(session,projectId,input={}){
      const [start,end]=dates(input.startAt,input.endAt),name=title(input.title);
      return tx(async db=>{
        await writable(db,session,projectId,true);
        const {rows}=await db.query(
          `INSERT INTO project_plan_phases(
              organization_id,workspace_id,project_id,title,start_at,end_at,created_by,updated_by)
            VALUES($1,$2,$3,$4,$5,$6,$7,$7)
            RETURNING id,title,start_at "startAt",end_at "endAt",version,
                      created_by "createdBy",updated_at "updatedAt"`,
          [session.organizationId,session.workspaceId,projectId,name,start,end,session.userId],
        );
        await audit(db,session,projectId,'project.plan_phase_created',{phaseId:rows[0].id});
        return phaseProjection(rows[0]);
      });
    },

    async updatePhase(session,projectId,phaseId,input={}){
      id(phaseId);
      const version=expected(input.expectedVersion);
      if(version===0)throw fail('Phase version is stale','PLAN_VERSION_CONFLICT',409);
      return tx(async db=>{
        await writable(db,session,projectId,true);
        const {rows:current}=await db.query(
          `SELECT title,start_at "startAt",end_at "endAt",version
             FROM project_plan_phases WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE`,
          [session.workspaceId,projectId,phaseId],
        );
        if(!current[0])throw fail('Phase not found','PLAN_PHASE_NOT_FOUND',404);
        if(current[0].version!==version)throw fail('Phase changed','PLAN_VERSION_CONFLICT',409);
        const [start,end]=dates(input.startAt===undefined?asDate(current[0].startAt):input.startAt,
          input.endAt===undefined?asDate(current[0].endAt):input.endAt);
        const name=input.title===undefined?current[0].title:title(input.title);
        const {rows}=await db.query(
          `UPDATE project_plan_phases
              SET title=$4,start_at=$5,end_at=$6,version=version+1,updated_by=$7,updated_at=now()
            WHERE workspace_id=$1 AND project_id=$2 AND id=$3
            RETURNING id,title,start_at "startAt",end_at "endAt",version,
                      created_by "createdBy",updated_at "updatedAt"`,
          [session.workspaceId,projectId,phaseId,name,start,end,session.userId],
        );
        await audit(db,session,projectId,'project.plan_phase_updated',{phaseId,version:rows[0].version});
        return phaseProjection(rows[0]);
      });
    },

    async scheduleTask(session,projectId,taskId,input={}){
      const [start,end]=dates(input.plannedStart,input.plannedEnd);
      const estimate=minutes(input.estimateMinutes),version=expected(input.expectedVersion);
      const phaseId=input.phaseId? id(input.phaseId):null;
      return tx(async db=>{
        await writable(db,session,projectId);
        await visibleLinkedTask(db,session,projectId,taskId);
        if(phaseId){
          const found=await db.query(
            'SELECT 1 FROM project_plan_phases WHERE workspace_id=$1 AND project_id=$2 AND id=$3',
            [session.workspaceId,projectId,phaseId],
          );
          if(!found.rowCount)throw fail('Phase not found','PLAN_PHASE_NOT_FOUND',404);
        }
        const current=await db.query(
          `SELECT version FROM project_plan_tasks
            WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3 FOR UPDATE`,
          [session.workspaceId,projectId,taskId],
        );
        if((current.rows[0]?.version??0)!==version)
          throw fail('Task plan changed','PLAN_VERSION_CONFLICT',409);
        const statement=current.rows.length
          ? `UPDATE project_plan_tasks SET phase_id=$4,planned_start=$5,planned_end=$6,
                 estimate_minutes=$7,version=version+1,updated_by=$8,updated_at=now()
               WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3
               RETURNING task_id "taskId",phase_id "phaseId",planned_start "plannedStart",
                         planned_end "plannedEnd",estimate_minutes "estimateMinutes",version`
          : `INSERT INTO project_plan_tasks(
                 workspace_id,project_id,task_id,phase_id,planned_start,planned_end,
                 estimate_minutes,updated_by)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8)
               RETURNING task_id "taskId",phase_id "phaseId",planned_start "plannedStart",
                         planned_end "plannedEnd",estimate_minutes "estimateMinutes",version`;
        const result=await db.query(statement,
          [session.workspaceId,projectId,taskId,phaseId,start,end,estimate,session.userId]);
        await audit(db,session,projectId,'project.plan_task_scheduled',
          {taskId,version:result.rows[0].version});
        return projection(result.rows[0]);
      });
    },

    async addDependency(session,projectId,input={}){
      const predecessor=id(input.predecessorTaskId),successor=id(input.successorTaskId);
      if(predecessor===successor)throw fail('Task cannot depend on itself','PLAN_DEPENDENCY_CYCLE',409);
      const lagDays=lag(input.lagDays);
      return tx(async db=>{
        await writable(db,session,projectId);
        await visibleLinkedTask(db,session,projectId,predecessor);
        await visibleLinkedTask(db,session,projectId,successor);
        const {rows}=await db.query(
          `SELECT predecessor_task_id "predecessorTaskId",successor_task_id "successorTaskId"
             FROM project_plan_dependencies WHERE workspace_id=$1 AND project_id=$2`,
          [session.workspaceId,projectId],
        );
        if(rows.some(e=>e.predecessorTaskId===predecessor&&e.successorTaskId===successor))
          throw fail('Dependency already exists','PLAN_DEPENDENCY_EXISTS',409);
        if(wouldCycle(rows,predecessor,successor))
          throw fail('Dependency creates a cycle','PLAN_DEPENDENCY_CYCLE',409);
        await db.query(
          `INSERT INTO project_plan_dependencies(
              workspace_id,project_id,predecessor_task_id,successor_task_id,lag_days,created_by)
            VALUES($1,$2,$3,$4,$5,$6)`,
          [session.workspaceId,projectId,predecessor,successor,lagDays,session.userId],
        );
        await audit(db,session,projectId,'project.plan_dependency_added',
          {predecessorTaskId:predecessor,successorTaskId:successor,lagDays});
        return{predecessorTaskId:predecessor,successorTaskId:successor,lagDays};
      });
    },

    async removeDependency(session,projectId,predecessorTaskId,successorTaskId){
      const predecessor=id(predecessorTaskId),successor=id(successorTaskId);
      return tx(async db=>{
        await writable(db,session,projectId);
        await visibleLinkedTask(db,session,projectId,predecessor);
        await visibleLinkedTask(db,session,projectId,successor);
        const {rowCount}=await db.query(
          `DELETE FROM project_plan_dependencies
            WHERE workspace_id=$1 AND project_id=$2
              AND predecessor_task_id=$3 AND successor_task_id=$4`,
          [session.workspaceId,projectId,predecessor,successor],
        );
        if(!rowCount)throw fail('Dependency not found','PLAN_DEPENDENCY_NOT_FOUND',404);
        await audit(db,session,projectId,'project.plan_dependency_removed',
          {predecessorTaskId:predecessor,successorTaskId:successor});
        return{ok:true};
      });
    },
  };
}
