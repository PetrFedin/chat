import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';
import { MemoryStore } from '../src/persistence/store.js';

async function request(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(`${base}${path}`,{method,headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});
  const payload=response.status===204?null:await response.json().catch(()=>null);
  return{response,payload,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}

async function invite(base,ownerCookie,email,name,role='member'){
  const invitation=await request(base,'/api/v1/invitations',{cookie:ownerCookie,method:'POST',body:{email,role}});
  assert.equal(invitation.response.status,201);
  const token=new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await request(base,'/api/v1/invitations/accept',{method:'POST',body:{token,displayName:name,password:'StrongPassword42'}});
  assert.equal(accepted.response.status,201);
  const boot=await request(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  return{cookie:accepted.cookie,userId:boot.payload.session.userId,boot:boot.payload};
}

test('conversation authority closes announcement, membership and reaction gaps',async(t)=>{
  const app=await createChatServer({store:new MemoryStore()});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;

  const owner=await request(base,'/api/v1/auth/register-company',{method:'POST',body:{companyName:'Authority Co',ownerName:'Owner',email:'owner@authority.test',password:'OwnerPassword42'}});
  assert.equal(owner.response.status,201);
  const ownerCookie=owner.cookie;
  const ownerBoot=(await request(base,'/api/v1/bootstrap',{cookie:ownerCookie})).payload;
  const announcements=ownerBoot.conversations.find(c=>c.slug==='announcements');
  assert.ok(announcements?.announcementOnly);

  const alice=await invite(base,ownerCookie,'alice@authority.test','Alice');
  const bob=await invite(base,ownerCookie,'bob@authority.test','Bob');
  const carol=await invite(base,ownerCookie,'carol@authority.test','Carol');

  const memberPost=await request(base,`/api/v1/conversations/${announcements.id}/messages`,{cookie:alice.cookie,method:'POST',body:{body:'I should not publish this'}});
  assert.equal(memberPost.response.status,403);
  assert.equal(memberPost.payload.error.code,'ANNOUNCEMENT_ONLY');

  const memberVoice=await fetch(`${base}/api/v1/conversations/${announcements.id}/voice?durationMs=1000`,{method:'POST',headers:{cookie:alice.cookie,'content-type':'audio/webm'},body:new Uint8Array([1,2,3,4])});
  assert.equal(memberVoice.status,403);
  const memberVoicePayload=await memberVoice.json();
  assert.equal(memberVoicePayload.error.code,'ANNOUNCEMENT_ONLY');

  const ownerPost=await request(base,`/api/v1/conversations/${announcements.id}/messages`,{cookie:ownerCookie,method:'POST',body:{body:'Official announcement'}});
  assert.equal(ownerPost.response.status,201);

  const group=await request(base,'/api/v1/conversations',{cookie:ownerCookie,method:'POST',body:{kind:'group',title:'Launch group',participantIds:[alice.userId,bob.userId]}});
  assert.equal(group.response.status,201);
  const groupId=group.payload.conversation.id;

  const members=await request(base,`/api/v1/conversations/${groupId}/members`,{cookie:ownerCookie});
  assert.equal(members.response.status,200);
  assert.equal(members.payload.items.length,3);
  assert.equal(members.payload.canManage,true);

  const aliceManage=await request(base,`/api/v1/conversations/${groupId}/members`,{cookie:alice.cookie,method:'POST',body:{userIds:[carol.userId]}});
  assert.equal(aliceManage.response.status,403);

  const addCarol=await request(base,`/api/v1/conversations/${groupId}/members`,{cookie:ownerCookie,method:'POST',body:{userIds:[carol.userId]}});
  assert.equal(addCarol.response.status,200);
  assert.equal(addCarol.payload.items.length,4);

  const groupMessage=await request(base,`/api/v1/conversations/${groupId}/messages`,{cookie:ownerCookie,method:'POST',body:{body:'Private launch detail'}});
  assert.equal(groupMessage.response.status,201);
  const messageId=groupMessage.payload.message.id;

  const carolReaction=await request(base,`/api/v1/messages/${messageId}/reactions`,{cookie:carol.cookie,method:'POST',body:{reaction:'👍'}});
  assert.equal(carolReaction.response.status,200);

  const removeCarol=await request(base,`/api/v1/conversations/${groupId}/members/${carol.userId}`,{cookie:ownerCookie,method:'DELETE'});
  assert.equal(removeCarol.response.status,200);

  const hiddenAfterRemoval=await request(base,`/api/v1/conversations/${groupId}/messages`,{cookie:carol.cookie});
  assert.equal(hiddenAfterRemoval.response.status,404);

  const outsiderReaction=await request(base,`/api/v1/messages/${messageId}/reactions`,{cookie:carol.cookie,method:'POST',body:{reaction:'🔥'}});
  assert.equal(outsiderReaction.response.status,404);

  const removeLastOwner=await request(base,`/api/v1/conversations/${groupId}/members/${ownerBoot.session.userId}`,{cookie:ownerCookie,method:'DELETE'});
  assert.equal(removeLastOwner.response.status,409);
  assert.equal(removeLastOwner.payload.error.code,'LAST_CONVERSATION_OWNER');

  const privateChannel=await request(base,'/api/v1/conversations',{cookie:ownerCookie,method:'POST',body:{kind:'channel',title:'Private finance',visibility:'private',participantIds:[alice.userId]}});
  assert.equal(privateChannel.response.status,201);
  const privateId=privateChannel.payload.conversation.id;
  assert.equal((await request(base,`/api/v1/conversations/${privateId}/messages`,{cookie:alice.cookie})).response.status,200);
  assert.equal((await request(base,`/api/v1/conversations/${privateId}/messages`,{cookie:bob.cookie})).response.status,404);
  assert.equal((await request(base,`/api/v1/conversations/${privateId}/members`,{cookie:ownerCookie,method:'POST',body:{userIds:[bob.userId]}})).response.status,200);
  assert.equal((await request(base,`/api/v1/conversations/${privateId}/messages`,{cookie:bob.cookie})).response.status,200);
});

test('group conversations require two colleagues in addition to the creator',async(t)=>{
  const app=await createChatServer({store:new MemoryStore()});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const owner=await request(base,'/api/v1/auth/register-company',{method:'POST',body:{companyName:'Group Co',ownerName:'Owner',email:'owner@group.test',password:'OwnerPassword42'}});
  const alice=await invite(base,owner.cookie,'alice@group.test','Alice');
  const invalid=await request(base,'/api/v1/conversations',{cookie:owner.cookie,method:'POST',body:{kind:'group',title:'Not a group',participantIds:[alice.userId]}});
  assert.equal(invalid.response.status,400);
  assert.equal(invalid.payload.error.code,'GROUP_REQUIRES_THREE_PARTICIPANTS');
});
