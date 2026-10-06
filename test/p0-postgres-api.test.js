import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createChatServer } from '../src/server.js';
import { PostgresStore } from '../src/persistence/store.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

async function request(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(`${base}${path}`,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},
    body:body!==undefined?JSON.stringify(body):undefined,
  });
  const payload=response.status===204?null:await response.json().catch(()=>null);
  return {response,payload,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}

async function invite(base,ownerCookie,email,name){
  const created=await request(base,'/api/v1/invitations',{cookie:ownerCookie,method:'POST',body:{email,role:'member'}});
  assert.equal(created.response.status,201);
  const token=new URL(created.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await request(base,'/api/v1/invitations/accept',{
    method:'POST',
    body:{token,displayName:name,password:'StrongPassword42'}
  });
  assert.equal(accepted.response.status,201);
  const boot=await request(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  assert.equal(boot.response.status,200);
  return {cookie:accepted.cookie,userId:boot.payload.session.userId};
}

test('P0 PostgreSQL API golden path closes the corporate work loop',{skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  const store=new PostgresStore(pool);
  const app=await createChatServer({store});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const suffix=randomUUID().slice(0,8);

  const owner=await request(base,'/api/v1/auth/register-company',{
    method:'POST',
    body:{companyName:`P0 ${suffix}`,ownerName:'Owner',email:`owner-${suffix}@p0.test`,password:'OwnerPassword42'}
  });
  assert.equal(owner.response.status,201);
  const ownerCookie=owner.cookie;
  const ownerBoot=await request(base,'/api/v1/bootstrap',{cookie:ownerCookie});
  const ownerId=ownerBoot.payload.session.userId;

  const worker=await invite(base,ownerCookie,`worker-${suffix}@p0.test`,'Worker');
  const reviewer=await invite(base,ownerCookie,`reviewer-${suffix}@p0.test`,'Reviewer');
  const observer=await invite(base,ownerCookie,`observer-${suffix}@p0.test`,'Observer');

  const group=await request(base,'/api/v1/conversations',{
    cookie:ownerCookie,method:'POST',
    body:{kind:'group',title:'P0 execution room',participantIds:[worker.userId,reviewer.userId]}
  });
  assert.equal(group.response.status,201);
  const groupId=group.payload.conversation.id;

  const addObserver=await request(base,`/api/v1/conversations/${groupId}/members`,{
    cookie:ownerCookie,method:'POST',body:{userIds:[observer.userId]}
  });
  assert.equal(addObserver.response.status,200);
  assert.ok(addObserver.payload.items.some(item=>item.userId===observer.userId));

  const removeObserver=await request(base,`/api/v1/conversations/${groupId}/members/${observer.userId}`,{
    cookie:ownerCookie,method:'DELETE'
  });
  assert.equal(removeObserver.response.status,200);
  assert.ok(!removeObserver.payload.items.some(item=>item.userId===observer.userId));

  const source=await request(base,`/api/v1/conversations/${groupId}/messages`,{
    cookie:ownerCookie,method:'POST',body:{body:'Prepare the board pack and return an accepted result.'}
  });
  assert.equal(source.response.status,201);
  const sourceId=source.payload.message.id;

  const reply=await request(base,`/api/v1/conversations/${groupId}/messages`,{
    cookie:worker.cookie,method:'POST',body:{body:'Accepted, starting now.',replyToId:sourceId}
  });
  assert.equal(reply.response.status,201);
  assert.equal(reply.payload.message.replyToId,sourceId);

  const pin=await request(base,`/api/v1/messages/${sourceId}/pin`,{cookie:ownerCookie,method:'POST'});
  assert.equal(pin.response.status,200);
  const pins=await request(base,`/api/v1/conversations/${groupId}/pins`,{cookie:worker.cookie});
  assert.ok(pins.payload.items.some(item=>item.id===sourceId));

  const direct=await request(base,'/api/v1/conversations',{
    cookie:worker.cookie,method:'POST',
    body:{kind:'direct',title:'Owner',participantIds:[ownerId]}
  });
  assert.equal(direct.response.status,201);
  const forwarded=await request(base,`/api/v1/messages/${sourceId}/forward`,{
    cookie:worker.cookie,method:'POST',body:{conversationId:direct.payload.conversation.id}
  });
  assert.equal(forwarded.response.status,201);
  assert.equal(forwarded.payload.message.forwardedFrom.messageId,sourceId);

  const fileUpload=await fetch(`${base}/api/v1/files`,{
    method:'POST',
    headers:{cookie:worker.cookie,'content-type':'text/plain','x-file-name':encodeURIComponent('p0-board-pack.txt')},
    body:Buffer.from('P0 board pack evidence file','utf8')
  });
  assert.equal(fileUpload.status,201);
  const uploadedFile=(await fileUpload.json()).file;

  const fileMessage=await request(base,`/api/v1/conversations/${groupId}/messages`,{
    cookie:worker.cookie,method:'POST',
    body:{kind:'file',metadata:{fileId:uploadedFile.id,name:'p0-board-pack.txt',mimeType:'text/plain',size:uploadedFile.sizeBytes}}
  });
  assert.equal(fileMessage.response.status,201);
  assert.equal(fileMessage.payload.message.metadata.fileId,uploadedFile.id);

  const fileRead=await fetch(`${base}${uploadedFile.contentUrl}`,{headers:{cookie:reviewer.cookie}});
  assert.equal(fileRead.status,200);
  assert.equal(await fileRead.text(),'P0 board pack evidence file');

  const voiceUpload=await fetch(`${base}/api/v1/conversations/${groupId}/voice?durationMs=1250`,{
    method:'POST',headers:{cookie:worker.cookie,'content-type':'audio/webm'},body:Buffer.from([1,2,3,4,5,6])
  });
  assert.equal(voiceUpload.status,201);
  const voicePayload=await voiceUpload.json();
  assert.equal(voicePayload.message.kind,'voice');
  assert.equal(voicePayload.voice.durationMs,1250);

  const created=await request(base,'/api/v1/tasks',{
    cookie:ownerCookie,method:'POST',
    body:{
      title:'Close P0 board pack',
      outcome:'Reviewer accepts the board pack and owner closes the work',
      ownerId:worker.userId,
      acceptorId:reviewer.userId,
      priority:'urgent',
      promisedAt:'2026-10-08T12:00:00.000Z',
      sourceMessageId:sourceId
    }
  });
  assert.equal(created.response.status,201);
  const taskId=created.payload.task.id;
  let version=created.payload.task.version;
  assert.equal(created.payload.task.status,'proposed');

  const accepted=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:worker.cookie,method:'POST',body:{to:'accepted',expectedVersion:version}
  });
  assert.equal(accepted.response.status,200);
  version=accepted.payload.task.version;

  const orphanBlock=await request(base,'/api/v1/calendar-events',{
    cookie:worker.cookie,method:'POST',body:{kind:'task_block',title:'Orphan work block',startAt:'2026-10-07T09:00:00.000Z',endAt:'2026-10-07T10:00:00.000Z',visibility:'private'}
  });
  assert.equal(orphanBlock.response.status,400);
  assert.equal(orphanBlock.payload.error.code,'TASK_BLOCK_TASK_REQUIRED');

  const focus=await request(base,'/api/v1/calendar-events',{
    cookie:worker.cookie,method:'POST',body:{kind:'focus',title:'Existing focus block',startAt:'2026-10-07T09:30:00.000Z',endAt:'2026-10-07T10:30:00.000Z',visibility:'private'}
  });
  assert.equal(focus.response.status,201);

  const recurringFocus=await request(base,'/api/v1/calendar-events',{
    cookie:worker.cookie,method:'POST',body:{kind:'focus',title:'Weekly planning series',startAt:'2026-10-01T08:00:00.000Z',endAt:'2026-10-01T09:00:00.000Z',visibility:'private',recurrenceRule:'FREQ=WEEKLY'}
  });
  assert.equal(recurringFocus.response.status,201);

  const recurringConflict=await request(base,'/api/v1/calendar-events',{
    cookie:worker.cookie,method:'POST',body:{kind:'focus',title:'Should collide with weekly series',startAt:'2026-10-08T08:30:00.000Z',endAt:'2026-10-08T08:45:00.000Z',visibility:'private'}
  });
  assert.equal(recurringConflict.response.status,409);
  assert.equal(recurringConflict.payload.error.code,'CALENDAR_CONFLICT');

  const conflictBlock=await request(base,'/api/v1/calendar-events',{
    cookie:worker.cookie,method:'POST',body:{kind:'task_block',title:'Work on P0 board pack',startAt:'2026-10-07T09:00:00.000Z',endAt:'2026-10-07T10:00:00.000Z',visibility:'private',commitmentId:taskId}
  });
  assert.equal(conflictBlock.response.status,409);
  assert.equal(conflictBlock.payload.error.code,'CALENDAR_CONFLICT');

  const linkedBlock=await request(base,'/api/v1/calendar-events',{
    cookie:worker.cookie,method:'POST',body:{kind:'task_block',title:'Work on P0 board pack',startAt:'2026-10-07T09:00:00.000Z',endAt:'2026-10-07T10:00:00.000Z',visibility:'private',commitmentId:taskId,allowConflict:true}
  });
  assert.equal(linkedBlock.response.status,201);
  const blockId=linkedBlock.payload.event.id;

  let taskWithBlock=await request(base,`/api/v1/tasks/${taskId}`,{cookie:worker.cookie});
  assert.equal(taskWithBlock.response.status,200);
  assert.equal(taskWithBlock.payload.task.status,'accepted');
  assert.equal(taskWithBlock.payload.task.version,version);
  assert.equal(taskWithBlock.payload.task.calendarBlocks.length,1);
  assert.equal(taskWithBlock.payload.task.calendarBlocks[0].id,blockId);

  const movedBlock=await request(base,`/api/v1/calendar-events/${blockId}`,{
    cookie:worker.cookie,method:'PATCH',body:{startAt:'2026-10-07T11:00:00.000Z',endAt:'2026-10-07T12:30:00.000Z'}
  });
  assert.equal(movedBlock.response.status,200);
  taskWithBlock=await request(base,`/api/v1/tasks/${taskId}`,{cookie:worker.cookie});
  assert.equal(taskWithBlock.payload.task.status,'accepted');
  assert.equal(taskWithBlock.payload.task.version,version);
  assert.equal(new Date(taskWithBlock.payload.task.calendarBlocks[0].startAt).toISOString(),'2026-10-07T11:00:00.000Z');

  const earlierDeadline=await request(base,`/api/v1/tasks/${taskId}/schedule`,{
    cookie:worker.cookie,method:'PATCH',body:{promisedAt:'2026-10-07T11:00:00.000Z',reason:'Board review moved earlier',expectedVersion:version}
  });
  assert.equal(earlierDeadline.response.status,200);
  version=earlierDeadline.payload.task.version;

  let proposal=await request(base,`/api/v1/tasks/${taskId}/schedule-proposal?eventId=${encodeURIComponent(blockId)}`,{cookie:worker.cookie});
  assert.equal(proposal.response.status,200);
  assert.equal(new Date(proposal.payload.proposal.suggestedStartAt).toISOString(),'2026-10-07T08:00:00.000Z');
  assert.equal(new Date(proposal.payload.proposal.suggestedEndAt).toISOString(),'2026-10-07T09:30:00.000Z');
  assert.equal(proposal.payload.proposal.avoidedConflictCount,1);

  const rejectedProposal=await request(base,`/api/v1/tasks/${taskId}/schedule-proposal`,{
    cookie:worker.cookie,method:'POST',body:{eventId:blockId,action:'reject',reason:'Keep the current slot for now',expectedVersion:version}
  });
  assert.equal(rejectedProposal.response.status,200);
  assert.equal(rejectedProposal.payload.decision,'reject');
  assert.equal(new Date(rejectedProposal.payload.event.startAt).toISOString(),'2026-10-07T11:00:00.000Z');

  proposal=await request(base,`/api/v1/tasks/${taskId}/schedule-proposal?eventId=${encodeURIComponent(blockId)}`,{cookie:worker.cookie});
  assert.equal(proposal.response.status,200);

  const approvedProposal=await request(base,`/api/v1/tasks/${taskId}/schedule-proposal`,{
    cookie:worker.cookie,method:'POST',body:{eventId:blockId,action:'approve',reason:'Move work before the board review',expectedVersion:version}
  });
  assert.equal(approvedProposal.response.status,200);
  assert.equal(approvedProposal.payload.decision,'approve');
  assert.equal(new Date(approvedProposal.payload.event.startAt).toISOString(),'2026-10-07T08:00:00.000Z');
  assert.equal(new Date(approvedProposal.payload.event.endAt).toISOString(),'2026-10-07T09:30:00.000Z');

  const deletedBlock=await request(base,`/api/v1/calendar-events/${blockId}`,{cookie:worker.cookie,method:'DELETE'});
  assert.equal(deletedBlock.response.status,204);
  taskWithBlock=await request(base,`/api/v1/tasks/${taskId}`,{cookie:worker.cookie});
  assert.equal(taskWithBlock.payload.task.status,'accepted');
  assert.equal(taskWithBlock.payload.task.version,version);
  assert.equal(taskWithBlock.payload.task.calendarBlocks.length,0);
  const calendarAudit=taskWithBlock.payload.task.audit.filter(event=>event.eventType.startsWith('calendar.block_'));
  assert.deepEqual(calendarAudit.map(event=>event.eventType),['calendar.block_linked','calendar.block_moved','calendar.block_moved','calendar.block_unlinked']);
  assert.ok(calendarAudit.every(event=>event.payload.calendarEventId===blockId));
  const proposalAudit=taskWithBlock.payload.task.audit.filter(event=>event.eventType.startsWith('calendar.reschedule_proposal_'));
  assert.deepEqual(proposalAudit.map(event=>event.eventType),['calendar.reschedule_proposal_rejected','calendar.reschedule_proposal_approved']);

  const started=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:worker.cookie,method:'POST',body:{to:'in_progress',expectedVersion:version}
  });
  assert.equal(started.response.status,200);
  version=started.payload.task.version;

  const blocked=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:worker.cookie,method:'POST',
    body:{to:'blocked',reason:'Waiting for the final finance extract',expectedVersion:version}
  });
  assert.equal(blocked.response.status,200);
  assert.equal(blocked.payload.task.status,'blocked');
  version=blocked.payload.task.version;

  const resumed=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:worker.cookie,method:'POST',body:{to:'in_progress',expectedVersion:version}
  });
  assert.equal(resumed.response.status,200);
  version=resumed.payload.task.version;

  const evidence1=await request(base,`/api/v1/tasks/${taskId}/evidence`,{
    cookie:worker.cookie,method:'POST',
    body:{type:'note',value:'Board pack v1 reconciled against the finance extract.',expectedVersion:version}
  });
  assert.equal(evidence1.response.status,201);
  version=evidence1.payload.task.version;

  const review1=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:worker.cookie,method:'POST',body:{to:'in_review',expectedVersion:version}
  });
  assert.equal(review1.response.status,200);
  version=review1.payload.task.version;

  const returned=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:reviewer.cookie,method:'POST',
    body:{to:'in_progress',reason:'Add the revised cash-flow appendix.',expectedVersion:version}
  });
  assert.equal(returned.response.status,200);
  assert.equal(returned.payload.task.status,'in_progress');
  version=returned.payload.task.version;

  const evidence2=await request(base,`/api/v1/tasks/${taskId}/evidence`,{
    cookie:worker.cookie,method:'POST',
    body:{type:'note',value:'Revised cash-flow appendix added and cross-checked.',expectedVersion:version}
  });
  assert.equal(evidence2.response.status,201);
  version=evidence2.payload.task.version;

  const review2=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:worker.cookie,method:'POST',body:{to:'in_review',expectedVersion:version}
  });
  assert.equal(review2.response.status,200);
  version=review2.payload.task.version;

  const acceptedResult=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:reviewer.cookie,method:'POST',body:{to:'accepted_result',expectedVersion:version}
  });
  assert.equal(acceptedResult.response.status,200);
  assert.equal(acceptedResult.payload.task.status,'accepted_result');
  version=acceptedResult.payload.task.version;

  const closed=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:ownerCookie,method:'POST',body:{to:'closed',expectedVersion:version}
  });
  assert.equal(closed.response.status,200);
  assert.equal(closed.payload.task.status,'closed');

  const reviewerInbox=await request(base,'/api/v1/notifications',{cookie:reviewer.cookie});
  assert.equal(reviewerInbox.response.status,200);
  const reviewNotice=reviewerInbox.payload.items.find(item=>item.type==='review.requested'&&item.commitmentId===taskId);
  assert.ok(reviewNotice);
  assert.equal(reviewNotice.url,`/#/tasks/${taskId}`);
  assert.ok(reviewerInbox.payload.items.some(item=>item.messageId===fileMessage.payload.message.id&&item.url===`/#/chats/${groupId}?message=${fileMessage.payload.message.id}`));
  assert.ok(reviewerInbox.payload.items.some(item=>item.messageId===voicePayload.message.id&&item.url===`/#/chats/${groupId}?message=${voicePayload.message.id}`));

  const workerInbox=await request(base,'/api/v1/notifications',{cookie:worker.cookie});
  assert.equal(workerInbox.response.status,200);
  const workerTaskNotice=workerInbox.payload.items.find(item=>item.commitmentId===taskId);
  assert.ok(workerTaskNotice);
  assert.equal(workerTaskNotice.url,`/#/tasks/${taskId}`);

  const detail=await request(base,`/api/v1/tasks/${taskId}`,{cookie:ownerCookie});
  assert.equal(detail.response.status,200);
  assert.equal(detail.payload.task.status,'closed');
  assert.equal(detail.payload.task.sourceMessageId,sourceId);
  assert.equal(detail.payload.task.evidence.length,2);
  assert.ok(detail.payload.task.audit.some(event=>event.eventType==='commitment.created'));
  assert.ok(detail.payload.task.audit.filter(event=>event.eventType==='commitment.transitioned').length>=7);
});
