import { cleanText } from '../http/helpers.js';

const fail=(message,code,statusCode=400)=>Object.assign(new Error(message),{code,statusCode,expose:true});

export function createDecisionTaskLinks({pool,store,meeting}={}){
  if(!pool || !store?.getTask || !meeting?.getDecision){
    const stop=()=>{throw fail('Связи решений и задач требуют PostgreSQL и канонические модули','DECISION_TASKS_UNAVAILABLE',503)};
    return {enabled:false,list:stop,decisionsForTask:stop,link:stop,unlink:stop};
  }

  const requireDecision=async(session,decisionId)=>{
    const decision=await meeting.getDecision(session,decisionId);
    if(!decision)throw fail('Решение не найдено','DECISION_NOT_FOUND',404);
    return decision;
  };
  const requireTask=async(session,taskId)=>{
    const task=await store.getTask(session,taskId);
    if(!task)throw fail('Задача не найдена','TASK_NOT_FOUND',404);
    return task;
  };
  const project=(task,link)=>({
    id:task.id,title:task.title,status:task.status,
    ownerId:task.ownerId??null,acceptorId:task.acceptorId??null,
    // Task Authority uses promisedAt as the canonical deadline field.
    dueAt:task.promisedAt??task.dueAt??null,priority:task.priority??null,
    linkedBy:link.linkedBy,linkedAt:link.linkedAt,reason:link.reason,
  });
  const tx=async(fn)=>{
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const result=await fn(client);
      await client.query('COMMIT');
      return result;
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      throw error;
    }finally{client.release()}
  };
  const lockDecision=async(client,session,decisionId)=>{
    const {rows}=await client.query(
      "SELECT id FROM decisions WHERE workspace_id=$1 AND id=$2 AND status='active' FOR UPDATE",
      [session.workspaceId,decisionId],
    );
    if(!rows.length)throw fail('Решение не найдено','DECISION_NOT_FOUND',404);
  };

  const api={
    enabled:true,
    async list(session,decisionId){
      await requireDecision(session,decisionId);
      const {rows}=await pool.query(
        'SELECT commitment_id "taskId",linked_by "linkedBy",linked_at "linkedAt",reason FROM decision_task_links WHERE workspace_id=$1 AND decision_id=$2 ORDER BY linked_at DESC,commitment_id LIMIT 100',
        [session.workspaceId,decisionId],
      );
      const visible=await Promise.all(rows.map(async row=>{
        const task=await store.getTask(session,row.taskId);
        return task?project(task,row):null;
      }));
      return visible.filter(Boolean);
    },
    async decisionsForTask(session,taskId){
      await requireTask(session,taskId);
      const {rows}=await pool.query(
        'SELECT decision_id "decisionId",linked_by "linkedBy",linked_at "linkedAt",reason FROM decision_task_links WHERE workspace_id=$1 AND commitment_id=$2 ORDER BY linked_at DESC,decision_id LIMIT 100',
        [session.workspaceId,taskId],
      );
      const visible=await Promise.all(rows.map(async link=>{
        const decision=await meeting.getDecision(session,link.decisionId);
        return decision?{
          id:decision.id,title:decision.title,acceptedAt:decision.acceptedAt??null,
          sourceKind:decision.sourceKind??null,linkedBy:link.linkedBy,
          linkedAt:link.linkedAt,reason:link.reason,
        }:null;
      }));
      return visible.filter(Boolean);
    },
    async link(session,decisionId,taskId,reason){
      // Canonical visibility comes first: a guessed private identifier does not
      // expose relation existence, count, or target metadata.
      await requireDecision(session,decisionId);
      await requireTask(session,taskId);
      const cleanReason=cleanText(reason,500,'Причина связи');
      await tx(async client=>{
        await lockDecision(client,session,decisionId);
        // Reauthorize from canonical sources inside the write window.
        // A revoked meeting participant or Task collaborator must not retain
        // mutation rights based only on the initial preflight.
        await requireDecision(session,decisionId);
        await requireTask(session,taskId);
        const count=await client.query(
          'SELECT count(*)::int AS n FROM decision_task_links WHERE workspace_id=$1 AND decision_id=$2',
          [session.workspaceId,decisionId],
        );
        if(count.rows[0].n>=100)throw fail('Для решения уже задано максимальное количество задач','DECISION_TASK_LIMIT',409);
        // Ensure the canonical Task still exists while creating the relation;
        // Task Authority reauthorizes each reader on every subsequent view.
        const target=await client.query(
          'SELECT id FROM commitments WHERE workspace_id=$1 AND id=$2 FOR SHARE',
          [session.workspaceId,taskId],
        );
        if(!target.rowCount)throw fail('Задача не найдена','TASK_NOT_FOUND',404);
        try{
          await client.query(
            'INSERT INTO decision_task_links(organization_id,workspace_id,decision_id,commitment_id,linked_by,reason) VALUES($1,$2,$3,$4,$5,$6)',
            [session.organizationId,session.workspaceId,decisionId,taskId,session.userId,cleanReason],
          );
        }catch(error){
          if(error.code==='23505')throw fail('Задача уже связана с решением','DECISION_TASK_ALREADY_LINKED',409);
          if(error.code==='23503')throw fail('Решение или задача не найдены','DECISION_TASK_TARGET_NOT_FOUND',404);
          throw error;
        }
        await client.query(
          "INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload) VALUES($1,$2,'decision',$3,'decision.task_linked',$4,$5)",
          [session.organizationId,session.workspaceId,decisionId,session.userId,{taskId,reason:cleanReason}],
        );
      });
      return api.list(session,decisionId);
    },
    async unlink(session,decisionId,taskId,reason){
      await requireDecision(session,decisionId);
      await requireTask(session,taskId);
      const cleanReason=cleanText(reason,500,'Причина удаления связи');
      await tx(async client=>{
        await lockDecision(client,session,decisionId);
        await requireDecision(session,decisionId);
        await requireTask(session,taskId);
        const removed=await client.query(
          'DELETE FROM decision_task_links WHERE workspace_id=$1 AND decision_id=$2 AND commitment_id=$3 RETURNING commitment_id',
          [session.workspaceId,decisionId,taskId],
        );
        if(!removed.rowCount)throw fail('Связь решения с задачей не найдена','DECISION_TASK_NOT_LINKED',404);
        await client.query(
          "INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload) VALUES($1,$2,'decision',$3,'decision.task_unlinked',$4,$5)",
          [session.organizationId,session.workspaceId,decisionId,session.userId,{taskId,reason:cleanReason}],
        );
      });
      return api.list(session,decisionId);
    },
  };
  return api;
}
