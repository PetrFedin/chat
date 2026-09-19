import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';
import { MemoryStore } from '../src/persistence/store.js';

async function request(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(`${base}${path}`,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},
    body:body!==undefined?JSON.stringify(body):undefined,
  });
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
  return{cookie:accepted.cookie,userId:boot.payload.session.userId};
}

test('message work actions preserve personal state, shared authority and provenance',async(t)=>{
  const app=await createChatServer({store:new MemoryStore()});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;

  const owner=await request(base,'/api/v1/auth/register-company',{method:'POST',body:{companyName:'Messaging Co',ownerName:'Owner',email:'owner@message-actions.test',password:'OwnerPassword42'}});
  assert.equal(owner.response.status,201);
  const ownerCookie=owner.cookie;
  const ownerBoot=(await request(base,'/api/v1/bootstrap',{cookie:ownerCookie})).payload;
  const ownerId=ownerBoot.session.userId;
  const alice=await invite(base,ownerCookie,'alice@message-actions.test','Alice');
  const bob=await invite(base,ownerCookie,'bob@message-actions.test','Bob');

  const group=await request(base,'/api/v1/conversations',{cookie:ownerCookie,method:'POST',body:{kind:'group',title:'Execution group',participantIds:[alice.userId]}});
  assert.equal(group.response.status,201);
  const groupId=group.payload.conversation.id;

  const source=await request(base,`/api/v1/conversations/${groupId}/messages`,{cookie:ownerCookie,method:'POST',body:{body:'Initial approved instruction'}});
  assert.equal(source.response.status,201);
  const sourceId=source.payload.message.id;

  const outsiderSave=await request(base,`/api/v1/messages/${sourceId}/save`,{cookie:bob.cookie,method:'POST'});
  assert.equal(outsiderSave.response.status,404);

  const saved=await request(base,`/api/v1/messages/${sourceId}/save`,{cookie:alice.cookie,method:'POST'});
  assert.equal(saved.response.status,200);
  assert.equal(saved.payload.saved,true);
  const aliceSaved=await request(base,'/api/v1/saved-messages',{cookie:alice.cookie});
  assert.equal(aliceSaved.payload.items.length,1);
  assert.equal(aliceSaved.payload.items[0].id,sourceId);
  const ownerSaved=await request(base,'/api/v1/saved-messages',{cookie:ownerCookie});
  assert.equal(ownerSaved.payload.items.length,0);

  const memberPin=await request(base,`/api/v1/messages/${sourceId}/pin`,{cookie:alice.cookie,method:'POST'});
  assert.equal(memberPin.response.status,403);
  const ownerPin=await request(base,`/api/v1/messages/${sourceId}/pin`,{cookie:ownerCookie,method:'POST'});
  assert.equal(ownerPin.response.status,200);
  const pins=await request(base,`/api/v1/conversations/${groupId}/pins`,{cookie:alice.cookie});
  assert.equal(pins.response.status,200);
  assert.equal(pins.payload.items.length,1);
  assert.equal(pins.payload.items[0].id,sourceId);

  const direct=await request(base,'/api/v1/conversations',{cookie:alice.cookie,method:'POST',body:{kind:'direct',title:'Owner',participantIds:[ownerId]}});
  assert.equal(direct.response.status,201);
  const directId=direct.payload.conversation.id;
  const forwarded=await request(base,`/api/v1/messages/${sourceId}/forward`,{cookie:alice.cookie,method:'POST',body:{conversationId:directId}});
  assert.equal(forwarded.response.status,201);
  assert.equal(forwarded.payload.message.forwarded,true);
  assert.equal(forwarded.payload.message.forwardedFrom.messageId,sourceId);
  assert.equal(forwarded.payload.message.forwardedFrom.conversationId,groupId);
  assert.equal(forwarded.payload.message.forwardedFrom.authorId,ownerId);

  const editForward=await request(base,`/api/v1/messages/${forwarded.payload.message.id}`,{cookie:alice.cookie,method:'PATCH',body:{body:'Changed forwarded content'}});
  assert.equal(editForward.response.status,409);
  assert.equal(editForward.payload.error.code,'MESSAGE_FORWARD_IMMUTABLE');

  const externalTarget=await request(base,'/api/v1/conversations',{cookie:alice.cookie,method:'POST',body:{kind:'direct',title:'Bob',participantIds:[bob.userId]}});
  assert.equal(externalTarget.response.status,201);
  const restrictedForward=await request(base,`/api/v1/messages/${sourceId}/forward`,{cookie:alice.cookie,method:'POST',body:{conversationId:externalTarget.payload.conversation.id}});
  assert.equal(restrictedForward.response.status,201);
  const bobForwardView=await request(base,`/api/v1/conversations/${externalTarget.payload.conversation.id}/messages`,{cookie:bob.cookie});
  const bobForward=bobForwardView.payload.items.find(item=>item.id===restrictedForward.payload.message.id);
  assert.equal(bobForward.forwarded,true);
  assert.deepEqual(bobForward.forwardedFrom,{restricted:true});

  const bobGroup=await request(base,'/api/v1/conversations',{cookie:ownerCookie,method:'POST',body:{kind:'group',title:'Other group',participantIds:[bob.userId]}});
  const crossReply=await request(base,`/api/v1/conversations/${bobGroup.payload.conversation.id}/messages`,{cookie:ownerCookie,method:'POST',body:{body:'Invalid cross-chat reply',replyToId:sourceId}});
  assert.equal(crossReply.response.status,400);
  assert.equal(crossReply.payload.error.code,'INVALID_MESSAGE_REFERENCE');

  const otherEdit=await request(base,`/api/v1/messages/${sourceId}`,{cookie:alice.cookie,method:'PATCH',body:{body:'Unauthorized edit'}});
  assert.equal(otherEdit.response.status,403);
  const edited=await request(base,`/api/v1/messages/${sourceId}`,{cookie:ownerCookie,method:'PATCH',body:{body:'Approved instruction — revised'}});
  assert.equal(edited.response.status,200);
  assert.equal(edited.payload.message.body,'Approved instruction — revised');
  assert.ok(edited.payload.message.editedAt);

  await request(base,'/api/v1/notifications/read-all',{cookie:alice.cookie,method:'POST',body:{}});
  const mutedUntil=new Date(Date.now()+8*3600000).toISOString();
  const muted=await request(base,`/api/v1/conversations/${groupId}/preferences`,{cookie:alice.cookie,method:'PATCH',body:{mutedUntil}});
  assert.equal(muted.response.status,200);
  assert.ok(muted.payload.preferences.mutedUntil);
  const quietMessage=await request(base,`/api/v1/conversations/${groupId}/messages`,{cookie:ownerCookie,method:'POST',body:{body:'Quiet update while muted'}});
  assert.equal(quietMessage.response.status,201);
  const aliceInbox=await request(base,'/api/v1/notifications?status=unread',{cookie:alice.cookie});
  assert.ok(!aliceInbox.payload.items.some(item=>item.messageId===quietMessage.payload.message.id));

  const archived=await request(base,`/api/v1/conversations/${groupId}/preferences`,{cookie:alice.cookie,method:'PATCH',body:{archived:true}});
  assert.equal(archived.response.status,200);
  assert.ok(archived.payload.preferences.archivedAt);
  const aliceActive=await request(base,'/api/v1/conversations',{cookie:alice.cookie});
  assert.ok(!aliceActive.payload.items.some(item=>item.id===groupId));
  const ownerActive=await request(base,'/api/v1/conversations',{cookie:ownerCookie});
  assert.ok(ownerActive.payload.items.some(item=>item.id===groupId));
  const aliceArchive=await request(base,'/api/v1/conversations/archived',{cookie:alice.cookie});
  assert.ok(aliceArchive.payload.items.some(item=>item.id===groupId));
  const restored=await request(base,`/api/v1/conversations/${groupId}/preferences`,{cookie:alice.cookie,method:'PATCH',body:{archived:false}});
  assert.equal(restored.response.status,200);
  assert.equal(restored.payload.preferences.archivedAt,null);

  const memberDelete=await request(base,`/api/v1/messages/${sourceId}`,{cookie:alice.cookie,method:'DELETE'});
  assert.equal(memberDelete.response.status,403);
  const deleted=await request(base,`/api/v1/messages/${sourceId}`,{cookie:ownerCookie,method:'DELETE'});
  assert.equal(deleted.response.status,200);
  assert.ok(deleted.payload.message.deletedAt);
  assert.equal(deleted.payload.message.body,null);

  const reactDeleted=await request(base,`/api/v1/messages/${sourceId}/reactions`,{cookie:alice.cookie,method:'POST',body:{reaction:'👍'}});
  assert.equal(reactDeleted.response.status,404);
  const pinsAfterDelete=await request(base,`/api/v1/conversations/${groupId}/pins`,{cookie:alice.cookie});
  assert.equal(pinsAfterDelete.payload.items.length,0);
  const savedAfterDelete=await request(base,'/api/v1/saved-messages',{cookie:alice.cookie});
  assert.ok(!savedAfterDelete.payload.items.some(item=>item.id===sourceId));
});
