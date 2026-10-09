import { Permission,requirePermission } from '../rbac.js';
import { json,readJson } from './helpers.js';
import { isGuest } from '../persistence/visibility.js';

const ID='([0-9a-f-]{36})';
const PROJECT=new RegExp(`^/api/v1/projects/${ID}$`,'i');
const MEMBERS=new RegExp(`^/api/v1/projects/${ID}/members$`,'i');
const MEMBER=new RegExp(`^/api/v1/projects/${ID}/members/${ID}$`,'i');
const TASKS=new RegExp(`^/api/v1/projects/${ID}/tasks$`,'i');
const TASK=new RegExp(`^/api/v1/projects/${ID}/tasks/${ID}$`,'i');
const FILES=new RegExp(`^/api/v1/projects/${ID}/files$`,'i');
const FILE=new RegExp(`^/api/v1/projects/${ID}/files/${ID}$`,'i');
const DISCUSSIONS=new RegExp(`^/api/v1/projects/${ID}/discussions$`,'i');
const DISCUSSION=new RegExp(`^/api/v1/projects/${ID}/discussions/${ID}$`,'i');
const MILESTONES=new RegExp(`^/api/v1/projects/${ID}/milestones$`,'i');
const MILESTONE=new RegExp(`^/api/v1/projects/${ID}/milestones/${ID}$`,'i');

export function createProjectsHandler(){
  return async function handleProjects(req,res,ctx,url,path,method){
    if(!path.startsWith('/api/v1/projects'))return false;
    const session=await ctx.requireSession(req);
    if(isGuest(session))throw Object.assign(new Error('Not found'),{code:'NOT_FOUND',statusCode:404});
    const projects=ctx.projects;
    if(!projects)throw Object.assign(new Error('Projects require PostgreSQL'),{code:'PROJECTS_UNAVAILABLE',statusCode:503,expose:true});

    if(path==='/api/v1/projects'){
      if(method==='GET'){
        json(res,200,{items:await projects.list(session,{includeArchived:url.searchParams.get('archived')==='1'})});
        return true;
      }
      if(method==='POST'){
        requirePermission(session.role,Permission.PROJECT_CREATE);
        const project=await projects.create(session,await readJson(req));
        json(res,201,{project});
        ctx.hub?.broadcastWorkspace?.(session.workspaceId,'project.created',{projectId:project.id});
        return true;
      }
    }

    let match=path.match(PROJECT);
    if(match&&method==='GET'){json(res,200,{project:await projects.get(session,match[1])});return true}
    if(match&&method==='PATCH'){
      json(res,200,{project:await projects.update(session,match[1],await readJson(req))});
      ctx.hub?.broadcastWorkspace?.(session.workspaceId,'project.updated',{projectId:match[1]});
      return true;
    }

    match=path.match(MEMBERS);
    if(match&&method==='POST'){
      json(res,200,{project:await projects.addMember(session,match[1],await readJson(req))});
      return true;
    }
    match=path.match(MEMBER);
    if(match&&method==='DELETE'){
      json(res,200,{project:await projects.removeMember(session,match[1],match[2])});
      return true;
    }

    match=path.match(TASKS);
    if(match&&method==='POST'){
      requirePermission(session.role,Permission.TASK_CREATE);
      const body=await readJson(req);
      if(body.taskId){
        json(res,200,{project:await projects.linkTask(session,match[1],String(body.taskId))});
      }else{
        json(res,201,{task:await projects.createTask(session,match[1],body)});
      }
      return true;
    }
    match=path.match(TASK);
    if(match&&method==='DELETE'){
      json(res,200,{project:await projects.unlinkTask(session,match[1],match[2])});
      return true;
    }

    match=path.match(FILES);
    if(match&&method==='POST'){
      const body=await readJson(req);
      if(!body.fileId)throw Object.assign(new Error('fileId is required'),{code:'FILE_ID_REQUIRED',statusCode:400,expose:true});
      json(res,200,{project:await projects.linkFile(session,match[1],String(body.fileId))});
      return true;
    }
    match=path.match(FILE);
    if(match&&method==='DELETE'){
      json(res,200,{project:await projects.unlinkFile(session,match[1],match[2])});
      return true;
    }

    match=path.match(DISCUSSIONS);
    if(match&&method==='POST'){
      const body=await readJson(req);
      if(!body.conversationId)throw Object.assign(new Error('conversationId is required'),{code:'CONVERSATION_ID_REQUIRED',statusCode:400,expose:true});
      json(res,200,{project:await projects.linkDiscussion(session,match[1],String(body.conversationId))});
      return true;
    }
    match=path.match(DISCUSSION);
    if(match&&method==='DELETE'){
      json(res,200,{project:await projects.unlinkDiscussion(session,match[1],match[2])});
      return true;
    }

    match=path.match(MILESTONES);
    if(match&&method==='POST'){
      json(res,201,{milestone:await projects.addMilestone(session,match[1],await readJson(req))});
      return true;
    }
    match=path.match(MILESTONE);
    if(match&&method==='PATCH'){
      json(res,200,{milestone:await projects.updateMilestone(session,match[1],match[2],await readJson(req))});
      return true;
    }
    return false;
  };
}
