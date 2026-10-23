import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { openapi } from '../src/openapi.js';
import { createEmailHandler } from '../src/http/email.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Спецификация умалчивала о половине работающих маршрутов: справочник людей,
 * журнал, сейф, напоминания, пометки, дела, игры, настройки компании. По
 * спецификации судят, что в продукте есть, — умолчание хуже отсутствия.
 *
 * Сравниваем не пути целиком (в коде они регулярки с параметрами), а корни
 * первого уровня: появился новый раздел API — он обязан быть описан.
 */
const rootOf = (path) => path.replace(/^\/api\/v1\//, '').split('/')[0].replace(/[^a-z-]/gi, '');

test('в спецификации есть каждый раздел API, который обслуживает сервер', () => {
  const documented = new Set(Object.keys(openapi.paths)
    .filter((path) => path.startsWith('/api/v1/'))
    .map(rootOf));

  const served = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const source = readFileSync(full, 'utf8');
      for (const match of source.matchAll(/['"`]\/api\/v1\/([a-z-]+)/gi)) served.add(match[1]);
    }
  };
  walk(join(root, 'src'));

  // Служебные пути, которые не являются разделами API.
  const ignore = new Set(['openapi']);
  const missing = [...served].filter((name) => !documented.has(name) && !ignore.has(name)).sort();
  assert.deepEqual(missing, [], `эти разделы сервер обслуживает, а спецификация о них молчит: ${missing.join(', ')}`);
});

test('спецификация не описывает того, чего нет', () => {
  const served = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const source = readFileSync(full, 'utf8');
      for (const match of source.matchAll(/['"`]\/api\/v1\/([a-z-]+)/gi)) served.add(match[1]);
    }
  };
  walk(join(root, 'src'));

  const phantom = [...new Set(Object.keys(openapi.paths)
    .filter((path) => path.startsWith('/api/v1/'))
    .map(rootOf))].filter((name) => !served.has(name)).sort();
  assert.deepEqual(phantom, [], `спецификация обещает то, чего сервер не отдаёт: ${phantom.join(', ')}`);
});


test('recent compositional APIs are documented at operation level', () => {
  const required = [
    ['get', '/api/v1/meetings/decisions/execution'],
    ['get', '/api/v1/meetings/decisions/{decisionId}/tasks'],
    ['post', '/api/v1/meetings/decisions/{decisionId}/tasks'],
    ['delete', '/api/v1/meetings/decisions/{decisionId}/tasks/{taskId}'],
    ['get', '/api/v1/projects'],
    ['post', '/api/v1/projects'],
    ['get', '/api/v1/projects/{projectId}'],
    ['post', '/api/v1/projects/{projectId}/tasks'],
    ['post', '/api/v1/projects/{projectId}/decisions'],
    ['get', '/api/v1/features'],
    ['put', '/api/v1/features/{featureId}'],
    ['get', '/api/v1/conversations/{conversationId}/topics'],
    ['post', '/api/v1/conversations/{conversationId}/topics'],
    ['patch', '/api/v1/conversations/{conversationId}/topics/{topicId}'],
    ['get', '/api/v1/conversations/{conversationId}/topics/{topicId}/messages'],
    ['post', '/api/v1/wiki/pages/{pageId}/tasks'],
    ['delete', '/api/v1/wiki/pages/{pageId}/tasks/{taskId}'],
    ['post', '/api/v1/wiki/pages/{pageId}/channels'],
    ['delete', '/api/v1/wiki/pages/{pageId}/channels/{conversationId}'],
    ['post', '/api/v1/wiki/pages/{pageId}/decisions'],
    ['delete', '/api/v1/wiki/pages/{pageId}/decisions/{decisionId}'],
    ['post', '/api/v1/wiki/pages/{pageId}/projects'],
    ['delete', '/api/v1/wiki/pages/{pageId}/projects/{projectId}'],
    ['get', '/api/v1/wiki/decisions/{decisionId}/pages'],
  ];
  for (const [method, path] of required) {
    assert.ok(openapi.paths[path]?.[method], `${method.toUpperCase()} ${path} is implemented but missing from OpenAPI`);
  }
});

const emailOperations = [
  ['get','/api/v1/email/bootstrap'],
  ['get','/api/v1/mailbox-connections'],['post','/api/v1/mailbox-connections'],
  ['get','/api/v1/mailbox-connections/{mailboxId}'],['patch','/api/v1/mailbox-connections/{mailboxId}'],['delete','/api/v1/mailbox-connections/{mailboxId}'],
  ['post','/api/v1/mailbox-connections/{mailboxId}/sync'],['post','/api/v1/mailbox-connections/{mailboxId}/disconnect'],['post','/api/v1/mailbox-connections/{mailboxId}/import'],
  ['post','/api/v1/mailbox-connections/{mailboxId}/members'],['delete','/api/v1/mailbox-connections/{mailboxId}/members/{userId}'],
  ['get','/api/v1/email/threads'],['get','/api/v1/email/threads/{threadId}'],['patch','/api/v1/email/threads/{threadId}'],
  ['post','/api/v1/email/threads/{threadId}/notes'],['delete','/api/v1/email/notes/{noteId}'],
  ['post','/api/v1/email/threads/{threadId}/waiting'],['patch','/api/v1/email/waiting/{waitingId}'],
  ['get','/api/v1/email/messages/{messageId}'],['get','/api/v1/email/messages/{messageId}/original'],
  ['post','/api/v1/email/messages/{messageId}/resource-links'],['get','/api/v1/email/resource-links/{kind}/{resourceId}'],
  ['get','/api/v1/email/drafts'],['post','/api/v1/email/drafts'],['get','/api/v1/email/drafts/{draftId}'],['patch','/api/v1/email/drafts/{draftId}'],['delete','/api/v1/email/drafts/{draftId}'],
  ['post','/api/v1/email/drafts/{draftId}/attachments'],['get','/api/v1/email/attachments/{attachmentId}/content'],
  ['post','/api/v1/email/drafts/{draftId}/approve'],['post','/api/v1/email/drafts/{draftId}/send-intents'],
  ['get','/api/v1/email/send-intents'],['get','/api/v1/email/send-intents/{intentId}'],['post','/api/v1/email/send-intents/{intentId}/cancel'],['post','/api/v1/email/send-intents/{intentId}/reconcile'],
  ['get','/api/v1/email/preferences'],['put','/api/v1/email/preferences'],
  ...['labels','templates'].flatMap(kind=>[['get','/api/v1/email/'+kind],['post','/api/v1/email/'+kind],['patch','/api/v1/email/'+kind+'/{'+(kind==='labels'?'labelId':'templateId')+'}'],['delete','/api/v1/email/'+kind+'/{'+(kind==='labels'?'labelId':'templateId')+'}']]),
];

test('email APIs and their path parameters are documented at operation level', () => {
  const extras = [
    ['post','/api/v1/email/threads/{threadId}/assistant'],
    ['get','/api/v1/email/mailboxes/{mailboxId}/rules'],['post','/api/v1/email/mailboxes/{mailboxId}/rules'],['post','/api/v1/email/mailboxes/{mailboxId}/rules/preview'],
    ['patch','/api/v1/email/rules/{ruleId}'],['delete','/api/v1/email/rules/{ruleId}'],
    ['post','/api/v1/email/messages/{messageId}/booking-links'],['delete','/api/v1/email/booking-links/{bookingId}'],
    ['get','/api/v1/email-booking/{token}'],['post','/api/v1/email-booking/{token}'],
    ...['task','event','page','decision'].map(kind=>['post','/api/v1/email/messages/{messageId}/'+kind+'-links']),
  ];
  for (const [method,path] of [...emailOperations,...extras]) {
    const item=openapi.paths[path], operation=item?.[method];
    assert.ok(operation,`${method.toUpperCase()} ${path}`);
    assert.ok(Object.keys(operation.responses).some(status=>/^2\d\d$/.test(status)),`success response for ${method} ${path}`);
    for (const [,name] of path.matchAll(/\{([^}]+)\}/g)) {
      assert.ok(item.parameters?.some(parameter=>parameter.name===name&&parameter.in==='path'&&parameter.required===true),`required ${name} parameter for ${path}`);
    }
  }
});

test('documented email success statuses match the actual HTTP handler', async () => {
  const handler=createEmailHandler();
  const id='11111111-2222-4333-8444-555555555555';
  // Repository behavior has domain/PostgreSQL coverage. This isolated adapter
  // probe catches contract drift such as documenting send-intents as 201 when
  // the real handler returns 202, without opening sockets or sending mail.
  const email=new Proxy({enabled:true},{get(target,key){
    if(key==='enabled')return true;
    if(key==='getOriginal'||key==='getAttachment')return async()=>({content:Buffer.from('fixture'),name:'fixture.eml',mimeType:'message/rfc822'});
    return async()=>({});
  }});
  for (const [method,template] of emailOperations) {
    const path=template.replace(/\{kind\}/g,'task').replace(/\{[^}]+\}/g,id);
    const request=Readable.from([Buffer.from('{}')]);request.headers={};
    let status;
    const response={setHeader(){},writeHead(value){status=value;},end(){}};
    const handled=await handler(request,response,{email,requireSession:async()=>({userId:id})},new URL(path,'http://localhost'),path,method.toUpperCase());
    assert.equal(handled,true,`${method.toUpperCase()} ${path} must be handled`);
    assert.ok(openapi.paths[template][method].responses[String(status)],`${method.toUpperCase()} ${template} returns undocumented ${status}`);
  }
});

test('email request fields, state enums and privacy-sensitive response envelopes match the contract', () => {
  const input=(path,method='post')=>openapi.paths[path][method].requestBody.content['application/json'].schema;
  const output=(path,method='get',status='200')=>openapi.paths[path][method].responses[status].content['application/json'].schema;
  const raw=input('/api/v1/mailbox-connections/{mailboxId}/import');
  assert.deepEqual(raw.required,['raw']);assert.equal(raw.properties.raw.type,'string');assert.equal(raw.properties.rawBase64,undefined);
  const mailbox=input('/api/v1/mailbox-connections/{mailboxId}','patch');
  assert.ok(mailbox.properties.requireApproval);assert.ok(mailbox.properties.signature);assert.equal(mailbox.properties.approvalRequired,undefined);assert.equal(mailbox.properties.config,undefined);
  const draft=input('/api/v1/email/drafts');
  assert.ok(draft.properties.fromAddress);assert.ok(draft.properties.attachments);assert.equal(draft.properties.from,undefined);assert.deepEqual(draft.required,['mailboxId']);
  assert.deepEqual(input('/api/v1/email/drafts/{draftId}','patch').required,['expectedVersion']);
  const waiting=input('/api/v1/email/threads/{threadId}/waiting');
  assert.ok(waiting.properties.title);assert.ok(waiting.properties.externalAddress);assert.equal(waiting.properties.summary,undefined);
  const update=input('/api/v1/email/waiting/{waitingId}','patch');
  assert.deepEqual(update.properties.status.enum,['waiting','answered','cancelled']);assert.ok(update.properties.evidenceMessageId);
  const template=input('/api/v1/email/templates');
  assert.deepEqual(template.properties.scope.enum,['personal','shared','workspace']);assert.deepEqual(template.properties.language.enum,['ru','en','es','it']);
  assert.deepEqual(input('/api/v1/email/preferences','put').properties.language.enum,['ru','en','es','it']);
  const queue=openapi.paths['/api/v1/email/drafts/{draftId}/send-intents'].post;
  assert.ok(queue.responses['202']);assert.equal(queue.responses['201'],undefined);
  assert.deepEqual(output('/api/v1/email/drafts/{draftId}/send-intents','post','202').properties.sendIntent.properties.status.enum,['queued','scheduled','dispatching','provider_accepted','unknown_outcome','failed','cancelled']);
  const message=output('/api/v1/email/messages/{messageId}');
  assert.deepEqual(message.required,['message']);assert.deepEqual(message.properties.message.properties.bodyStatus.enum,['complete','too_large','unparseable']);
  assert.deepEqual(input('/api/v1/email/send-intents/{intentId}/reconcile').properties,{});
  for(const method of ['get','post'])assert.deepEqual(openapi.paths['/api/v1/email-booking/{token}'][method].security,[]);
  assert.deepEqual(input('/api/v1/email-booking/{token}').required,['name','email','startAt','submissionId']);
  assert.ok(openapi.paths['/api/v1/email/messages/{messageId}/original'].get.responses['200'].content['message/rfc822']);
});
