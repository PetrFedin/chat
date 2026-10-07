import { randomUUID } from 'node:crypto';
import { normalizeProject,normalizeProjectMember,normalizeMilestone,canViewProject,assertProjectManage,assertProjectContribute } from './project-authority.js';

const fail=(message,code,statusCode=400)=>Object.assign(new Error(message),{code,statusCode,expose:true});
const ACTIVE_TASK=new Set(['proposed','accepted','scheduled','in_progress','blocked','in_review','deferred','clarify','inbox']);
const DONE_TASK=new Set(['accepted_result','closed']);

export function createProjectRepository({pool,store}={}){
  if(!pool||!store)return null;

  const tx=async(fn)=>{
    const client=await pool.connect();
    try{await client.query('BEGIN');const out=await fn(client);await client.query('COMMIT');return out}
    catch(error){try{await client.query('ROLLBACK')}catch{}throw error}
    finally{client.release()}
  };

  const row=async(session,id,db=pool)=>{
    const{rows}=await db.query(
      `SELECT p.id,p.organization_id "organizationId",p.workspace_id "workspaceId",p.name,p.goal,p.status,p.visibility,
              p.owner_id "ownerId",p.start_at "startAt",p.target_at "targetAt",p.version,
              p.created_by "createdBy",p.created_at "createdAt",p.updated_at "updatedAt",
              pm.role "memberRole",COALESCE(op.display_name,op.email,p.owner_id::text) "ownerName"
         FROM projects p
         LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$3
         LEFT JOIN workspace_profiles op ON op.workspace_id=p.workspace_id AND op.user_id=p.owner_id
        WHERE p.workspace_id=$1 AND p.id=$2`,
      [session.workspaceId,id,session.userId]);
    const project=rows[0]??null;
    return canViewProject(project,session)?project:null;
  };

  const members=async(projectId)=>(
    await pool.query(
      `SELECT pm.user_id "userId",pm.role,pm.added_at "addedAt",
              COALESCE(wp.display_name,wp.email,pm.user_id::text) "displayName",wp.title
         FROM project_members pm
         LEFT JOIN workspace_profiles wp ON wp.workspace_id=pm.workspace_id AND wp.user_id=pm.user_id
        WHERE pm.project_id=$1 ORDER BY CASE pm.role WHEN 'lead' THEN 0 WHEN 'member' THEN 1 ELSE 2 END,
              COALESCE(wp.display_name,wp.email,pm.user_id::text)`,[projectId])
  ).rows;

  const milestones=async(projectId)=>(
    await pool.query(
      `SELECT id,project_id "projectId",title,description,target_at "targetAt",status,version,
              created_by "createdBy",created_at "createdAt",updated_at "updatedAt"
         FROM project_milestones WHERE project_id=$1 ORDER BY target_at,id`,[projectId])
  ).rows;

  const visibleTasks=async(session,projectId)=>{
    const links=(await pool.query('SELECT commitment_id FROM project_tasks WHERE project_id=$1 ORDER BY linked_at,id',[projectId]).catch(async(error)=>{
      // project_tasks has no id column by design; keep order stable on commitment id.
      if(error.code!=='42703')throw error;
      return pool.query('SELECT commitment_id FROM project_tasks WHERE project_id=$1 ORDER BY linked_at,commitment_id',[projectId]);
    })).rows;
    const tasks=(await Promise.all(links.map(link=>store.getTask(session,link.commitment_id)))).filter(Boolean);
    return tasks;
  };

  const activity=async(session,projectId,taskIds=[])=>{
    const ids=[projectId,...taskIds].filter(Boolean);
    if(!ids.length)return[];
    return (await pool.query(
      `SELECT id,aggregate_type "aggregateType",aggregate_id "aggregateId",event_type "eventType",
              actor_id "actorId",payload,created_at "createdAt"
         FROM audit_events
        WHERE workspace_id=$1 AND aggregate_id=ANY($2::uuid[])
        ORDER BY created_at DESC,id DESC LIMIT 50`,
      [session.workspaceId,ids])).rows;
  };

  const enrich=async(session,project)=>{
    const [team,marks,tasks]=await Promise.all([members(project.id),milestones(project.id),visibleTasks(session,project.id)]);
    const active=tasks.filter(t=>ACTIVE_TASK.has(t.status));
    const done=tasks.filter(t=>DONE_TASK.has(t.status));
    const blocked=tasks.filter(t=>t.status==='blocked');
    const overdue=active.filter(t=>t.promisedAt&&Date.parse(t.promisedAt)<Date.now());
    const progress=tasks.length?Math.round(done.length/(tasks.filter(t=>!['cancelled','rejected'].includes(t.status)).length||1)*100):0;
    const workload=new Map();
    for(const task of active){
      const key=task.ownerId||'unassigned';
      const item=workload.get(key)||{userId:key,total:0,blocked:0,overdue:0};
      item.total+=1;
      if(task.status==='blocked')item.blocked+=1;
      if(task.promisedAt&&Date.parse(task.promisedAt)<Date.now())item.overdue+=1;
      workload.set(key,item);
    }
    return{...project,members:team,milestones:marks,tasks,
      metrics:{visibleTasks:tasks.length,active:active.length,done:done.length,blocked:blocked.length,overdue:overdue.length,progress},
      workload:[...workload.values()].map(item=>({...item,displayName:item.userId==='unassigned'?'':(team.find(m=>m.userId===item.userId)?.displayName??item.userId)})),
      activity:await activity(session,project.id,tasks.map(t=>t.id)),
      canManage:project.ownerId===session.userId||project.memberRole==='lead'||['owner','admin'].includes(session.role),
      canContribute:project.ownerId===session.userId||['lead','member'].includes(project.memberRole)||['owner','admin'].includes(session.role)
    };
  };

  return{
    async list(session,{includeArchived=false}={}){
      const{rows}=await pool.query(
        `SELECT p.id,p.name,p.goal,p.status,p.visibility,p.owner_id "ownerId",p.start_at "startAt",p.target_at "targetAt",
                p.version,p.created_at "createdAt",p.updated_at "updatedAt",pm.role "memberRole",
                COALESCE(op.display_name,op.email,p.owner_id::text) "ownerName",
                (SELECT count(*)::int FROM project_members x WHERE x.project_id=p.id) "memberCount",
                (SELECT count(*)::int FROM project_milestones x WHERE x.project_id=p.id AND x.status='planned') "openMilestoneCount",
                (SELECT min(x.target_at) FROM project_milestones x WHERE x.project_id=p.id AND x.status='planned') "nextMilestoneAt"
           FROM projects p
           LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2
           LEFT JOIN workspace_profiles op ON op.workspace_id=p.workspace_id AND op.user_id=p.owner_id
          WHERE p.workspace_id=$1
            AND ($3::boolean OR p.status<>'archived')
            AND (p.visibility='workspace' OR p.owner_id=$2 OR pm.user_id IS NOT NULL)
          ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'blocked' THEN 1 WHEN 'planned' THEN 2 ELSE 3 END,p.updated_at DESC`,
        [session.workspaceId,session.userId,Boolean(includeArchived)]);
      return rows;
    },

    async get(session,id){
      const project=await row(session,id);
      if(!project)throw fail('Project not found','PROJECT_NOT_FOUND',404);
      return enrich(session,project);
    },

    async create(session,input){
      const value=normalizeProject(input);
      return tx(async client=>{
        const id=randomUUID();
        const{rows}=await client.query(
          `INSERT INTO projects(id,organization_id,workspace_id,name,goal,status,visibility,owner_id,start_at,target_at,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$8)
           RETURNING id,name,goal,status,visibility,owner_id "ownerId",start_at "startAt",target_at "targetAt",version,
                     created_by "createdBy",created_at "createdAt",updated_at "updatedAt"`,
          [id,session.organizationId,session.workspaceId,value.name,value.goal,value.status,value.visibility,session.userId,value.startAt,value.targetAt]);
        await client.query(
          `INSERT INTO project_members(project_id,workspace_id,user_id,role,added_by) VALUES($1,$2,$3,'lead',$3)`,
          [id,session.workspaceId,session.userId]);
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'project',$3,'project.created',$4,$5)`,
          [session.organizationId,session.workspaceId,id,session.userId,{name:value.name,visibility:value.visibility}]);
        await client.query(
          `INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload)
           VALUES($1,$2,'project.created',$3,$4)`,
          [session.organizationId,session.workspaceId,id,{projectId:id,ownerId:session.userId,status:value.status}]);
        return{...rows[0],memberRole:'lead',ownerName:session.displayName??session.email};
      });
    },

    async update(session,id,input){
      const project=await row(session,id);
      assertProjectManage(project,session);
      const patch=normalizeProject(input,{partial:true});
      const expected=patch.expectedVersion??project.version;
      const next={name:patch.name??project.name,goal:patch.goal!==undefined?patch.goal:project.goal,status:patch.status??project.status,
        visibility:patch.visibility??project.visibility,startAt:patch.startAt!==undefined?patch.startAt:project.startAt,targetAt:patch.targetAt!==undefined?patch.targetAt:project.targetAt};
      if(next.startAt&&next.targetAt&&String(next.targetAt)<String(next.startAt))throw fail('Project target must not precede start','INVALID_PROJECT_RANGE');
      const{rows}=await pool.query(
        `UPDATE projects SET name=$4,goal=$5,status=$6,visibility=$7,start_at=$8,target_at=$9,version=version+1,updated_at=now()
          WHERE workspace_id=$1 AND id=$2 AND version=$3
          RETURNING id,name,goal,status,visibility,owner_id "ownerId",start_at "startAt",target_at "targetAt",version,updated_at "updatedAt"`,
        [session.workspaceId,id,expected,next.name,next.goal,next.status,next.visibility,next.startAt,next.targetAt]);
      if(!rows[0])throw fail('Project changed in another session','PROJECT_VERSION_CONFLICT',409);
      await pool.query(
        `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
         VALUES($1,$2,'project',$3,'project.updated',$4,$5)`,
        [session.organizationId,session.workspaceId,id,session.userId,{from:{status:project.status,targetAt:project.targetAt},to:{status:next.status,targetAt:next.targetAt},version:rows[0].version}]);
      return this.get(session,id);
    },

    async addMember(session,id,input){
      const project=await row(session,id);
      assertProjectManage(project,session);
      const member=normalizeProjectMember(input);
      const staff=await pool.query(
        `SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id
          WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role<>'guest' AND u.disabled_at IS NULL`,
        [session.workspaceId,member.userId]);
      if(!staff.rowCount)throw fail('Project member must be active workspace staff','INVALID_PROJECT_MEMBER',409);
      await pool.query(
        `INSERT INTO project_members(project_id,workspace_id,user_id,role,added_by)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(project_id,user_id) DO UPDATE SET role=EXCLUDED.role`,
        [id,session.workspaceId,member.userId,member.role,session.userId]);
      await pool.query(
        `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
         VALUES($1,$2,'project',$3,'project.member_upserted',$4,$5)`,
        [session.organizationId,session.workspaceId,id,session.userId,{userId:member.userId,role:member.role}]);
      return this.get(session,id);
    },

    async removeMember(session,id,userId){
      const project=await row(session,id);
      assertProjectManage(project,session);
      if(userId===project.ownerId)throw fail('Project owner cannot be removed','PROJECT_OWNER_REQUIRED',409);
      await pool.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',[id,userId]);
      await pool.query(
        `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
         VALUES($1,$2,'project',$3,'project.member_removed',$4,$5)`,
        [session.organizationId,session.workspaceId,id,session.userId,{userId}]);
      return this.get(session,id);
    },

    async createTask(session,id,input){
      const project=await row(session,id);
      assertProjectContribute(project,session);
      const task=await store.createTask(session,input);
      await pool.query(
        `INSERT INTO project_tasks(project_id,workspace_id,commitment_id,linked_by)
         VALUES($1,$2,$3,$4)`,
        [id,session.workspaceId,task.id,session.userId]);
      await pool.query(
        `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
         VALUES($1,$2,'project',$3,'project.task_linked',$4,$5)`,
        [session.organizationId,session.workspaceId,id,session.userId,{taskId:task.id}]);
      return task;
    },

    async linkTask(session,id,taskId){
      const project=await row(session,id);
      assertProjectContribute(project,session);
      const task=await store.getTask(session,taskId);
      if(!task)throw fail('Task not found','TASK_NOT_FOUND',404);
      try{
        await pool.query(
          `INSERT INTO project_tasks(project_id,workspace_id,commitment_id,linked_by) VALUES($1,$2,$3,$4)`,
          [id,session.workspaceId,taskId,session.userId]);
      }catch(error){
        if(error.code==='23505')throw fail('Task already belongs to a project','TASK_ALREADY_IN_PROJECT',409);
        throw error;
      }
      return this.get(session,id);
    },

    async unlinkTask(session,id,taskId){
      const project=await row(session,id);
      assertProjectManage(project,session);
      await pool.query('DELETE FROM project_tasks WHERE project_id=$1 AND commitment_id=$2',[id,taskId]);
      return this.get(session,id);
    },

    async addMilestone(session,id,input){
      const project=await row(session,id);
      assertProjectContribute(project,session);
      const value=normalizeMilestone(input);
      const{rows}=await pool.query(
        `INSERT INTO project_milestones(project_id,workspace_id,title,description,target_at,status,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         RETURNING id,project_id "projectId",title,description,target_at "targetAt",status,version,created_by "createdBy",created_at "createdAt",updated_at "updatedAt"`,
        [id,session.workspaceId,value.title,value.description,value.targetAt,value.status,session.userId]);
      await pool.query(
        `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
         VALUES($1,$2,'project',$3,'project.milestone_created',$4,$5)`,
        [session.organizationId,session.workspaceId,id,session.userId,{milestoneId:rows[0].id,targetAt:value.targetAt,title:value.title}]);
      return rows[0];
    },

    async updateMilestone(session,id,milestoneId,input){
      const project=await row(session,id);
      assertProjectContribute(project,session);
      const current=(await pool.query(
        `SELECT id,title,description,target_at "targetAt",status,version FROM project_milestones WHERE project_id=$1 AND id=$2`,
        [id,milestoneId])).rows[0];
      if(!current)throw fail('Milestone not found','MILESTONE_NOT_FOUND',404);
      const patch=normalizeMilestone(input,{partial:true});
      const expected=patch.expectedVersion??current.version;
      const{rows}=await pool.query(
        `UPDATE project_milestones
            SET title=$4,description=$5,target_at=$6,status=$7,version=version+1,updated_at=now()
          WHERE project_id=$1 AND id=$2 AND version=$3
          RETURNING id,project_id "projectId",title,description,target_at "targetAt",status,version,created_by "createdBy",created_at "createdAt",updated_at "updatedAt"`,
        [id,milestoneId,expected,patch.title??current.title,patch.description!==undefined?patch.description:current.description,patch.targetAt??current.targetAt,patch.status??current.status]);
      if(!rows[0])throw fail('Milestone changed in another session','MILESTONE_VERSION_CONFLICT',409);
      return rows[0];
    }
  };
}
