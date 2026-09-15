import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';
import { MemoryStore } from '../src/persistence/store.js';

async function start() {
  const app=await createChatServer({store:new MemoryStore()});
  await new Promise((resolve)=>app.server.listen(0,'127.0.0.1',resolve));
  const address=app.server.address();
  return {app,base:`http://127.0.0.1:${address.port}`};
}

test('register -> bootstrap -> channel -> message works through REST boundary', async (t) => {
  const {app,base}=await start(); t.after(()=>app.close());
  const register=await fetch(`${base}/api/v1/auth/register-company`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({companyName:'Contract Co',ownerName:'Owner User',email:'owner@contract.test',password:'ContractPass42'})});
  assert.equal(register.status,201);
  const cookie=register.headers.get('set-cookie').split(';')[0];
  const bootstrap=await fetch(`${base}/api/v1/bootstrap`,{headers:{cookie}});
  assert.equal(bootstrap.status,200);
  const initial=await bootstrap.json();
  assert.equal(initial.session.role,'owner');
  assert.equal(initial.conversations.length,2);

  const createChannel=await fetch(`${base}/api/v1/conversations`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({kind:'channel',title:'Product',visibility:'workspace'})});
  assert.equal(createChannel.status,201);
  const {conversation}=await createChannel.json();
  const send=await fetch(`${base}/api/v1/conversations/${conversation.id}/messages`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({body:'Hello team'})});
  assert.equal(send.status,201);
  const messages=await fetch(`${base}/api/v1/conversations/${conversation.id}/messages`,{headers:{cookie}}).then((r)=>r.json());
  assert.equal(messages.items[0].body,'Hello team');
});
