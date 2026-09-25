import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIChatAssistantProvider, createConfiguredChatAssistant } from '../src/chat-assistant/chat-assistant-provider.js';

const jsonResponse=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});

test('summarizeThread uses Responses structured output, disables storage, and never fabricates when the thread is empty',async()=>{
  let requestBody;
  const fetchImpl=async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    requestBody=JSON.parse(options.body);
    return jsonResponse({
      id:'resp_fixture',
      output_text:JSON.stringify({ summary:'Обсудили сроки релиза и договорились созвониться завтра.', highlights:['Созвон завтра в 10:00'] }),
      usage:{input_tokens:80,output_tokens:20,total_tokens:100},
    },200,{'x-request-id':'req_summary_fixture'});
  };
  const provider=new OpenAIChatAssistantProvider({apiKey:'test-key',fetchImpl});
  const result=await provider.summarizeThread({
    messages:[{id:'m1',authorId:'u1',text:'Когда релиз?'},{id:'m2',authorId:'u2',text:'Завтра в 10 созвонимся и решим.'}],
    selfUserId:'u2',
  });
  assert.equal(requestBody.model,'gpt-5.6');
  assert.equal(requestBody.store,false);
  assert.equal(requestBody.text.format.type,'json_schema');
  assert.equal(requestBody.text.format.strict,true);
  assert.match(requestBody.input,/\[m1\] speaker:u1: Когда релиз\?/);
  assert.match(requestBody.input,/\[m2\] you: Завтра в 10/, 'автор от текущего пользователя помечен как you, а не своим id');
  assert.match(requestBody.instructions,/Do not invent facts/);
  assert.equal(result.requestId,'req_summary_fixture');
  assert.equal(result.summary,'Обсудили сроки релиза и договорились созвониться завтра.');
  assert.deepEqual(result.highlights,['Созвон завтра в 10:00']);

  await assert.rejects(
    ()=>provider.summarizeThread({messages:[],selfUserId:'u1'}),
    (error)=>error.code==='CHAT_ASSISTANT_INPUT_EMPTY'&&error.statusCode===400,
    'пустая ветка не должна доходить до провайдера',
  );
});

test('suggestReplies asks for up to three drafts and rejects a contract mismatch',async()=>{
  let requestBody;
  const fetchImpl=async(url,options)=>{
    requestBody=JSON.parse(options.body);
    return jsonResponse({
      id:'resp_replies',
      output_text:JSON.stringify({replies:['Да, давайте в 10.','Мне удобнее в 11, подойдёт?']}),
    },200,{'x-request-id':'req_replies_fixture'});
  };
  const provider=new OpenAIChatAssistantProvider({apiKey:'test-key',fetchImpl});
  const result=await provider.suggestReplies({
    messages:[{id:'m1',authorId:'u2',text:'Созвонимся в 10?'}],
    selfUserId:'u1',
  });
  assert.match(requestBody.instructions,/Never draft a reply that promises a deadline/);
  assert.equal(result.replies.length,2);
  assert.equal(result.requestId,'req_replies_fixture');

  const brokenFetch=async()=>jsonResponse({id:'resp_broken',output_text:JSON.stringify({replies:[]})});
  const broken=new OpenAIChatAssistantProvider({apiKey:'test-key',fetchImpl:brokenFetch});
  await assert.rejects(
    ()=>broken.suggestReplies({messages:[{id:'m1',authorId:'u1',text:'x'}],selfUserId:'u1'}),
    (error)=>error.code==='OPENAI_CHAT_ASSISTANT_INVALID',
  );
});

test('provider selection is explicit and fails closed without credentials',()=>{
  const absent=createConfiguredChatAssistant({});
  assert.equal(absent.assistant.status().enabled,false);
  assert.equal(absent.assistant.status().reason,'CHAT_ASSISTANT_PROVIDER is not configured');

  const configuredNoKey=createConfiguredChatAssistant({CHAT_ASSISTANT_PROVIDER:'openai'});
  assert.equal(configuredNoKey.assistant.status().enabled,false);
  assert.equal(configuredNoKey.assistant.status().reason,'OPENAI_API_KEY is not configured');

  const enabled=createConfiguredChatAssistant({CHAT_ASSISTANT_PROVIDER:'openai',OPENAI_API_KEY:'test-key'});
  assert.equal(enabled.assistant.status().enabled,true);

  const unsupported=createConfiguredChatAssistant({CHAT_ASSISTANT_PROVIDER:'anthropic'});
  assert.equal(unsupported.assistant.status().enabled,false);
  assert.match(unsupported.assistant.status().reason,/Unsupported chat assistant provider/);
});

test('a disabled assistant fails closed on both operations with an exposed 503, never silently succeeding',async()=>{
  const { assistant } = createConfiguredChatAssistant({});
  await assert.rejects(
    ()=>assistant.summarizeThread({messages:[{id:'m',authorId:'u',text:'x'}],selfUserId:'u'}),
    (error)=>error.code==='CHAT_ASSISTANT_UNAVAILABLE'&&error.statusCode===503&&error.expose===true,
  );
  await assert.rejects(
    ()=>assistant.suggestReplies({messages:[{id:'m',authorId:'u',text:'x'}],selfUserId:'u'}),
    (error)=>error.code==='CHAT_ASSISTANT_UNAVAILABLE'&&error.statusCode===503,
  );
});

test('provider HTTP errors remain structured, exposed, and retain the provider request ID',async()=>{
  const provider=new OpenAIChatAssistantProvider({
    apiKey:'test-key',
    fetchImpl:async()=>jsonResponse({error:{message:'provider unavailable'}},503,{'x-request-id':'req_fail'}),
  });
  await assert.rejects(
    ()=>provider.summarizeThread({messages:[{id:'m',authorId:'u',text:'x'}],selfUserId:'u'}),
    (error)=>error.code==='OPENAI_CHAT_ASSISTANT_FAILED'&&error.statusCode===502&&error.expose===true&&error.details?.requestId==='req_fail',
  );
});
