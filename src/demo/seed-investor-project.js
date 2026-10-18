/**
 * Synthetic Northstar investor walkthrough: seed only the demo tenant, only on
 * PostgreSQL, and only through canonical Project Authority operations.
 * No copied Task statuses or manufactured performance metrics.
 */
import { DEMO_EMAIL } from './seed-demo.js';

export const INVESTOR_PROJECT_NAME = 'Mobile Launch · Northstar Studio (demo)';
const MILESTONES = [
  ['Подтверждённый mobile QA', 2],
  ['Go / No-Go и план отката', 4],
];
const TASK_TITLES = [
  'Закрыть mobile QA звонков',
  'Подготовить финальный UX review',
  'Проверить RBAC приватных каналов',
  'Подготовить operational checklist релиза',
];

export async function seedDemoInvestorProject({ store, projects }) {
  if (!store?.pool?.query || !projects) return null;
  const auth = await store.findAuthByEmail(DEMO_EMAIL);
  if (!auth) return null;
  const { rows } = await store.pool.query(
    `SELECT w.organization_id "organizationId",m.role,wp.display_name "displayName"
       FROM workspaces w
       JOIN memberships m ON m.workspace_id=w.id AND m.user_id=$2
       LEFT JOIN workspace_profiles wp ON wp.workspace_id=w.id AND wp.user_id=m.user_id
      WHERE w.id=$1`, [auth.workspaceId,auth.id]);
  const identity = rows[0];
  if (!identity || identity.role !== 'owner') return null;
  const session = {
    organizationId:identity.organizationId,workspaceId:auth.workspaceId,userId:auth.id,
    role:'owner',displayName:identity.displayName || auth.email,
  };
  const bootstrap = await store.getBootstrap(session);
  const existing = (await projects.list(session,{includeArchived:true})).find(p => p.name === INVESTOR_PROJECT_NAME);
  const project = existing || await projects.create(session, {
    name:INVESTOR_PROJECT_NAME,visibility:'workspace',status:'active',
    goal:'Демонстрационный релиз: связь обсуждений, ответственных, рисков, доказательств и приёмки. Все данные синтетические.',
  });

  // Adding current team members is idempotent. Project must admit real Task
  // participants before relations are written, never weaken their admission.
  const current = await projects.get(session,project.id);
  const admitted = new Set(current.members.map(m => m.userId));
  for (const person of bootstrap.people || []) {
    if (person.role === 'guest' || person.userId === session.userId || admitted.has(person.userId)) continue;
    await projects.addMember(session,project.id,{userId:person.userId,role:'member'});
  }
  const linked = new Set((await projects.get(session,project.id)).tasks.map(t => t.id));
  const tasks = (await store.pool.query(
    `SELECT id,title FROM commitments WHERE workspace_id=$1 AND title=ANY($2::text[])`,
    [session.workspaceId,TASK_TITLES])).rows;
  for (const task of tasks) {
    if (!linked.has(task.id)) await projects.linkTask(session,project.id,task.id);
  }

  const again = await projects.get(session,project.id);
  const product = (bootstrap.conversations || []).find(c => c.slug === 'product');
  if (product && !again.discussions.some(c => c.id === product.id || c.conversationId === product.id)) {
    await projects.linkDiscussion(session,project.id,product.id);
  }
  const milestoneNames = new Set(again.milestones.map(m=>m.title));
  for (const [title,days] of MILESTONES) {
    if (milestoneNames.has(title)) continue;
    await projects.addMilestone(session,project.id,{
      title,
      description:'Синтетическая демонстрационная веха — не фактический срок клиентского релиза.',
      targetAt:new Date(Date.now()+days*86400000).toISOString(),
    });
  }
  // Give the real Project Planning UI a genuine, reproducible demo graph.
  // Every phase, schedule and dependency is written through Project Authority,
  // not injected into a screenshot. Never overwrite demo edits on restart.
  const planDates=(offset)=>{
    const now=new Date(),utc=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
    const monday=utc.getUTCDay()===0?6:utc.getUTCDay()-1;
    utc.setUTCDate(utc.getUTCDate()-monday+offset);
    return utc.toISOString().slice(0,10);
  };
  let currentPlan=(await projects.get(session,project.id)).plan;
  const phaseDefs=[
    {title:'Discovery / Mobile QA · demo',startAt:planDates(0),endAt:planDates(7)},
    {title:'Release readiness · demo',startAt:planDates(8),endAt:planDates(21)},
  ];
  for(const phase of phaseDefs){
    if(currentPlan.phases.some(p=>p.title===phase.title))continue;
    await projects.createPhase(session,project.id,phase);
    currentPlan=(await projects.get(session,project.id)).plan;
  }
  const phaseIds=phaseDefs.map(p=>currentPlan.phases.find(item=>item.title===p.title)?.id);
  const scheduleDefs=[
    {name:TASK_TITLES[0],start:0,end:3,estimate:900,phase:0},
    {name:TASK_TITLES[1],start:4,end:6,estimate:540,phase:0},
    {name:TASK_TITLES[2],start:8,end:10,estimate:600,phase:1},
    {name:TASK_TITLES[3],start:11,end:14,estimate:420,phase:1},
  ];
  for(const config of scheduleDefs){
    const task=tasks.find(item=>item.title===config.name);
    if(!task||currentPlan.schedules.some(item=>item.taskId===task.id))continue;
    await projects.scheduleTask(session,project.id,task.id,{
      plannedStart:planDates(config.start),plannedEnd:planDates(config.end),
      phaseId:phaseIds[config.phase],estimateMinutes:config.estimate,expectedVersion:0,
    });
    currentPlan=(await projects.get(session,project.id)).plan;
  }
  for(let i=0;i<scheduleDefs.length-1;i++){
    const predecessor=tasks.find(item=>item.title===scheduleDefs[i].name);
    const successor=tasks.find(item=>item.title===scheduleDefs[i+1].name);
    if(!predecessor||!successor||
       currentPlan.dependencies.some(link=>
         link.predecessorTaskId===predecessor.id&&link.successorTaskId===successor.id))continue;
    await projects.addDependency(session,project.id,{
      predecessorTaskId:predecessor.id,successorTaskId:successor.id,lagDays:0,
    });
    currentPlan=(await projects.get(session,project.id)).plan;
  }
  return { id:project.id,name:INVESTOR_PROJECT_NAME,synthetic:true };
}
