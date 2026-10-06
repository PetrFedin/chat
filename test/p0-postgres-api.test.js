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

  const group=await request(base,'/api/v1/conversations',{
    cookie:ownerCookie,method:'POST',
    body:{kind:'group',title:'P0 execution room',participantIds:[worker.userId,reviewer.userId]}
  });
  assert.equal(group.response.status,201);
  const groupId=group.payload.conversation.id;

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
  assert.ok(reviewerInbox.payload.items.some(item=>item.type==='review.requested'&&item.commitmentId===taskId));

  const workerInbox=await request(base,'/api/v1/notifications',{cookie:worker.cookie});
  assert.equal(workerInbox.response.status,200);
  assert.ok(workerInbox.payload.items.some(item=>item.commitmentId===taskId));

  const detail=await request(base,`/api/v1/tasks/${taskId}`,{cookie:ownerCookie});
  assert.equal(detail.response.status,200);
  assert.equal(detail.payload.task.status,'closed');
  assert.equal(detail.payload.task.sourceMessageId,sourceId);
  assert.equal(detail.payload.task.evidence.length,2);
  assert.ok(detail.payload.task.audit.some(event=>event.eventType==='commitment.created'));
  assert.ok(detail.payload.task.audit.filter(event=>event.eventType==='commitment.transitioned').length>=7);
});
