import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createChatServer } from '../src/server.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const password = 'PageChannelPassword42';

async function request(base, path, {cookie, method='GET', body}={}) {
  const response = await fetch(base+path, {
    method,
    headers: {...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  return {
    status:response.status,
    payload:await response.json().catch(()=>null),
    cookie:response.headers.get('set-cookie')?.split(';')[0]??null,
  };
}

async function register(base,prefix) {
  const nonce=randomUUID().slice(0,8);
  const created=await request(base,'/api/v1/auth/register-company',{
    method:'POST',body:{companyName:prefix+' '+nonce,ownerName:'Owner',email:prefix.toLowerCase().replace(/\W/g,'')+'-'+nonce+'@example.test',password},
  });
  assert.equal(created.status,201);
  const boot=await request(base,'/api/v1/bootstrap',{cookie:created.cookie});
  return {cookie:created.cookie,session:boot.payload.session};
}

async function invite(base,ownerCookie) {
  const created=await request(base,'/api/v1/invitations',{
    cookie:ownerCookie,method:'POST',
    body:{email:'channel-member-'+randomUUID().slice(0,8)+'@example.test',role:'member'},
  });
  assert.equal(created.status,201);
  const token=new URL(created.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await request(base,'/api/v1/invitations/accept',{
    method:'POST',body:{token,displayName:'Member',password},
  });
  assert.equal(accepted.status,201);
  return accepted.cookie;
}

async function createConversation(base,cookie,kind,title,visibility) {
  const value=await request(base,'/api/v1/conversations',{
    cookie,method:'POST',body:{kind,title,visibility},
  });
  assert.equal(value.status,201,JSON.stringify(value.payload?.error??{}));
  return value.payload.conversation.id;
}

test('Page <-> Channel: private membership, canonical conversation authority and tenant FK',
  {skip:!databaseUrl},async t=>{
    const app=await createChatServer({databaseUrl,startMeetingWorker:false});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    t.after(()=>app.close());
    const base='http://127.0.0.1:'+app.server.address().port;
    const pool=new pg.Pool({connectionString:databaseUrl});
    t.after(()=>pool.end());

    const owner=await register(base,'Page Channels');
    const colleagueCookie=await invite(base,owner.cookie);
    const foreign=await register(base,'Foreign Channels');
    const privateChannel=await createConversation(base,owner.cookie,'channel','Private board','private');
    const openChannel=await createConversation(base,owner.cookie,'channel','Company board','workspace');
    const group=await createConversation(base,owner.cookie,'group','Direct room','private');
    const foreignChannel=await createConversation(base,foreign.cookie,'channel','Other company','private');
    const pageCreated=await request(base,'/api/v1/wiki/pages',{
      cookie:owner.cookie,method:'POST',
      body:{title:'Communications brief',content:'References only, not copied messages'},
    });
    assert.equal(pageCreated.status,201);
    const pageId=pageCreated.payload.id;
    const link=(cookie,conversationId)=>request(base,`/api/v1/wiki/pages/${pageId}/channels`,{
      cookie,method:'POST',body:{conversationId},
    });

    assert.equal((await link(owner.cookie,privateChannel)).status,200);
    assert.equal((await link(owner.cookie,openChannel)).status,200);
    assert.equal((await link(owner.cookie,privateChannel)).status,409);
    assert.equal((await link(owner.cookie,group)).status,404,'group is not a channel link');
    assert.equal((await link(owner.cookie,foreignChannel)).status,404,'foreign conversation must be absent');
    assert.equal((await link(colleagueCookie,privateChannel)).status,404,'guessed private channel cannot be linked');

    const visible=await request(base,`/api/v1/wiki/pages/${pageId}`,{cookie:colleagueCookie});
    assert.equal(visible.status,200);
    assert.deepEqual(visible.payload.channels.map(c=>c.id),[openChannel],
      'a private channel must never appear in a shared page response');
    assert.equal((await request(base,`/api/v1/wiki/pages/${pageId}`,{cookie:foreign.cookie})).status,404);

    await assert.rejects(pool.query(
      `INSERT INTO wiki_page_channels(organization_id,workspace_id,page_id,conversation_id,linked_by)
       VALUES($1,$2,$3,$4,$5)`,
      [owner.session.organizationId,owner.session.workspaceId,pageId,foreignChannel,owner.session.userId],
    ),{code:'23503'});

    const denied=await request(base,`/api/v1/wiki/pages/${pageId}/channels/${privateChannel}`,{
      cookie:colleagueCookie,method:'DELETE',
    });
    assert.equal(denied.status,404);
    const removed=await request(base,`/api/v1/wiki/pages/${pageId}/channels/${privateChannel}`,{
      cookie:owner.cookie,method:'DELETE',
    });
    assert.equal(removed.status,200);
    assert.deepEqual(removed.payload.channels.map(c=>c.id),[openChannel]);
    // Removing a Page relation cannot change or delete Conversation Authority.
    assert.equal((await request(base,`/api/v1/conversations/${privateChannel}/members`,{cookie:owner.cookie})).status,200);
    const audit=await pool.query(
      `SELECT event_type FROM audit_events
        WHERE workspace_id=$1 AND aggregate_type='wiki_page' AND aggregate_id=$2`,
      [owner.session.workspaceId,pageId],
    );
    assert.equal(audit.rows.filter(x=>x.event_type==='wiki.channel_linked').length,2);
    assert.equal(audit.rows.filter(x=>x.event_type==='wiki.channel_unlinked').length,1);
  });
