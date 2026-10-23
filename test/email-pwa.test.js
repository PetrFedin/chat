import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('PWA shell installs email assets and never caches authenticated mail or public booking tokens', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const handlers = new Map();
  let assets, installing;
  vm.runInNewContext(source, {
    self: { addEventListener: (name, handler) => handlers.set(name, handler), skipWaiting: async () => {} },
    caches: { open: async () => ({addAll: async paths => { assets = Array.from(paths); }}) },
    location: new URL('https://chatx.example.test'), URL, Response,
  });
  handlers.get('install')({waitUntil: promise => { installing = promise; }});
  await installing;
  assert.ok(assets.includes('/email.js'));
  assert.ok(assets.includes('/email.css'));
  for (const path of ['/api/v1/email/bootstrap', '/api/v1/email/messages/secret/original', '/API/V1/email/mailboxes/secret/rules', '/Api/v1/email/bootstrap', '/email-booking/' + 'x'.repeat(43), '/EMAIL-BOOKING/' + 'x'.repeat(43)]) {
    let intercepted = false;
    handlers.get('fetch')({request: {method:'GET',url:'https://chatx.example.test' + path},respondWith: () => { intercepted = true; }});
    assert.equal(intercepted, false, 'sensitive route must use the network cache policy: ' + path);
  }
});

test('PWA honors private/no-store responses and evicts all older shell caches', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const handlers = new Map(), deleted = [], stored = [];
  let activated, responsePromise, directive = 'no-store', claimed = false;
  const response = {ok:true,type:'basic',headers:{get:()=>directive},clone:()=>({body:'private'})};
  vm.runInNewContext(source, {
    self: { addEventListener:(name,handler)=>handlers.set(name,handler), clients:{claim:async()=>{claimed=true;}} },
    caches: {
      keys:async()=>['chat-shell-v30','chat-shell-v31','chat-shell-v32'],
      delete:async key=>{deleted.push(key);return true;},
      open:async()=>({put:async(request)=>stored.push(request.url)}),
    },
    fetch:async()=>response, location:new URL('https://chatx.example.test'), URL, Response,
  });
  handlers.get('activate')({waitUntil:promise=>{activated=promise;}});
  await activated;
  assert.deepEqual(deleted,['chat-shell-v30','chat-shell-v31']);
  assert.equal(claimed,true);
  for (directive of ['no-store','max-age=0, private']) {
    handlers.get('fetch')({request:{method:'GET',url:'https://chatx.example.test/private-export'},respondWith:promise=>{responsePromise=promise;}});
    assert.equal(await responsePromise,response);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(stored.length,0,'server cache policy must prevent private response persistence');
  }
  directive='public, max-age=3600';
  handlers.get('fetch')({request:{method:'GET',url:'https://chatx.example.test/email.css'},respondWith:promise=>{responsePromise=promise;}});
  await responsePromise;
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(stored,['https://chatx.example.test/email.css']);
});
