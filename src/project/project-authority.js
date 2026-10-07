const PROJECT_STATUS=new Set(['planned','active','blocked','completed','cancelled','archived']);
const PROJECT_VISIBILITY=new Set(['members','workspace']);
const PROJECT_MEMBER_ROLE=new Set(['lead','member','observer']);
const MILESTONE_STATUS=new Set(['planned','reached','cancelled']);

const fail=(message,code,statusCode=400)=>Object.assign(new Error(message),{code,statusCode,expose:true});
const text=(value,{name='value',max=4000,required=false}={})=>{
  if(value==null||String(value).trim()===''){
    if(required)throw fail(`${name} is required`,`INVALID_${name.toUpperCase()}`);
    return null;
  }
  const out=String(value).trim();
  if(out.length>max)throw fail(`${name} is too long`,`INVALID_${name.toUpperCase()}`);
  return out;
};
const dateOnly=(value,name)=>{
  if(value==null||value==='')return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))throw fail(`${name} must be YYYY-MM-DD`,`INVALID_${name.toUpperCase()}`);
  return String(value);
};

export function normalizeProject(input,{partial=false}={}){
  const out={};
  if(!partial||input?.name!==undefined)out.name=text(input?.name,{name:'project_name',max:160,required:!partial});
  if(!partial||input?.goal!==undefined)out.goal=text(input?.goal,{name:'project_goal',max:4000});
  if(!partial||input?.status!==undefined){
    const value=input?.status??'active';
    if(!PROJECT_STATUS.has(value))throw fail('Unsupported project status','INVALID_PROJECT_STATUS');
    out.status=value;
  }
  if(!partial||input?.visibility!==undefined){
    const value=input?.visibility??'members';
    if(!PROJECT_VISIBILITY.has(value))throw fail('Unsupported project visibility','INVALID_PROJECT_VISIBILITY');
    out.visibility=value;
  }
  if(!partial||input?.startAt!==undefined)out.startAt=dateOnly(input?.startAt,'project_start');
  if(!partial||input?.targetAt!==undefined)out.targetAt=dateOnly(input?.targetAt,'project_target');
  if(out.startAt&&out.targetAt&&out.targetAt<out.startAt)throw fail('Project target must not precede start','INVALID_PROJECT_RANGE');
  if(input?.expectedVersion!==undefined){
    const version=Number(input.expectedVersion);
    if(!Number.isInteger(version)||version<1)throw fail('expectedVersion must be a positive integer','INVALID_EXPECTED_VERSION');
    out.expectedVersion=version;
  }
  return out;
}

export function normalizeProjectMember(input){
  const userId=text(input?.userId,{name:'project_member',max:80,required:true});
  const role=input?.role??'member';
  if(!PROJECT_MEMBER_ROLE.has(role))throw fail('Unsupported project member role','INVALID_PROJECT_MEMBER_ROLE');
  return{userId,role};
}

export function normalizeMilestone(input,{partial=false}={}){
  const out={};
  if(!partial||input?.title!==undefined)out.title=text(input?.title,{name:'milestone_title',max:200,required:!partial});
  if(!partial||input?.description!==undefined)out.description=text(input?.description,{name:'milestone_description',max:2000});
  if(!partial||input?.targetAt!==undefined){
    const d=new Date(input?.targetAt);
    if(!input?.targetAt||Number.isNaN(d.getTime()))throw fail('Milestone targetAt must be a valid date/time','INVALID_MILESTONE_TARGET');
    out.targetAt=d.toISOString();
  }
  if(!partial||input?.status!==undefined){
    const value=input?.status??'planned';
    if(!MILESTONE_STATUS.has(value))throw fail('Unsupported milestone status','INVALID_MILESTONE_STATUS');
    out.status=value;
  }
  if(input?.expectedVersion!==undefined){
    const version=Number(input.expectedVersion);
    if(!Number.isInteger(version)||version<1)throw fail('expectedVersion must be a positive integer','INVALID_EXPECTED_VERSION');
    out.expectedVersion=version;
  }
  return out;
}

export const canViewProject=(project,session)=>
  Boolean(project&&(project.visibility==='workspace'||project.ownerId===session.userId||project.memberRole));

export function assertProjectManage(project,session){
  if(!project)throw fail('Project not found','PROJECT_NOT_FOUND',404);
  if(project.ownerId===session.userId||project.memberRole==='lead'||['owner','admin'].includes(session.role))return;
  throw fail('Project management permission denied','PROJECT_FORBIDDEN',403);
}

export function assertProjectContribute(project,session){
  if(!project)throw fail('Project not found','PROJECT_NOT_FOUND',404);
  if(project.ownerId===session.userId||['lead','member'].includes(project.memberRole)||['owner','admin'].includes(session.role))return;
  throw fail('Project contribution permission denied','PROJECT_FORBIDDEN',403);
}
