import { Permission, requirePermission } from '../rbac.js';
import { json, readJson } from './helpers.js';
import { buildVisibleExecutionCockpit } from '../decisions/execution-projection.js';

const COCKPIT='/api/v1/meetings/decisions/execution';
const UUID='([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const VALID_UUID=new RegExp('^'+UUID+'$', 'i');
const TASKS=new RegExp('^/api/v1/meetings/decisions/'+UUID+'/tasks$', 'i');
const TASK=new RegExp('^/api/v1/meetings/decisions/'+UUID+'/tasks/'+UUID+'$', 'i');

export function createDecisionTaskHandler(){
  return async function handleDecisionTasks(req,res,ctx,path,method){
    const list=path.match(TASKS);
    const task=path.match(TASK);
    const cockpit=path===COCKPIT;
    if(!list && !task && !cockpit)return false;
    const session=await ctx.requireSession(req);
    // Workspace guests are never members of the accountability chain.
    requirePermission(session.role,Permission.TASK_CREATE);
    if(!ctx.decisionTasks?.enabled){
      throw Object.assign(new Error('Связи решений и задач недоступны'),{
        code:'DECISION_TASKS_UNAVAILABLE',statusCode:503,expose:true,
      });
    }
    if(cockpit && method==='GET'){
      const url=new URL(req.url??COCKPIT,`http://${req.headers.host??'localhost'}`);
      const result=await buildVisibleExecutionCockpit({
        meeting:ctx.meeting,decisionTasks:ctx.decisionTasks,session,
        query:url.searchParams.get('q'),from:url.searchParams.get('from'),
        to:url.searchParams.get('to'),limit:url.searchParams.get('limit')??20,
      });
      json(res,200,result);
      return true;
    }
    if(list && method==='GET'){
      json(res,200,{items:await ctx.decisionTasks.list(session,list[1])});
      return true;
    }
    if(list && method==='POST'){
      const body=await readJson(req);
      if(!body.taskId || !VALID_UUID.test(String(body.taskId)))throw Object.assign(new Error('A valid taskId is required'),{
        code:'TASK_ID_INVALID',statusCode:400,expose:true,
      });
      json(res,200,{items:await ctx.decisionTasks.link(session,list[1],String(body.taskId),body.reason)});
      return true;
    }
    if(task && method==='DELETE'){
      const body=await readJson(req);
      json(res,200,{items:await ctx.decisionTasks.unlink(session,task[1],task[2],body.reason)});
      return true;
    }
    return false;
  };
}
