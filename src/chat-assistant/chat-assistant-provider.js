/**
 * ИИ прямо в переписке: сократи длинную ветку, предложи, как ответить.
 *
 * Meeting Intelligence уже доказывает решения и действия только
 * предложениями, которые подтверждает человек, — здесь то же самое
 * правило, только проще: это вообще не пишет за человека. «Предложи
 * ответ» кладёт текст в поле ввода, а не отправляет его; отправка —
 * всегда отдельное, осознанное действие того, кто сидит за клавиатурой.
 *
 * Тот же провайдер (OpenAI Responses API, structured outputs, те же
 * OPENAI_API_KEY/OPENAI_BASE_URL), что и для итогов встреч — не повод
 * заводить второй способ говорить с моделью ради одной кнопки в чате.
 */

const DEFAULT_BASE_URL='https://api.openai.com/v1';
const DEFAULT_MODEL='gpt-5.6';

function providerError(code,message,statusCode=502,details=null){
  const error=new Error(message);
  error.code=code;
  error.statusCode=statusCode;
  error.expose=true;
  if(details)error.details=details;
  return error;
}

function timeoutSignal(ms){
  const value=Math.max(Number(ms)||60000,1000);
  if(typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function')return AbortSignal.timeout(value);
  return undefined;
}

function requestId(response){return response?.headers?.get?.('x-request-id')??response?.headers?.get?.('request-id')??null}

async function responseError(response){
  const payload=await response.json().catch(()=>null);
  const message=payload?.error?.message||payload?.message||`Provider request failed with HTTP ${response.status}`;
  return {message,status:response.status,requestId:requestId(response)};
}

function outputText(payload){
  if(typeof payload?.output_text==='string'&&payload.output_text.trim())return payload.output_text;
  for(const item of payload?.output??[]){
    if(item?.type!=='message')continue;
    for(const content of item.content??[]){
      if(content?.type==='output_text'&&typeof content.text==='string'&&content.text.trim())return content.text;
    }
  }
  return null;
}

// Транскрипт встречи размечает время; здесь важнее, кто и что сказал —
// «свой» текст против чужого решает тон предложенного ответа.
const transcriptOf=(messages,selfUserId)=>messages.map((m)=>{
  const who=m.authorId===selfUserId?'you':`speaker:${m.authorId}`;
  return `[${m.id}] ${who}: ${m.text}`;
}).join('\n');

const summarySchema={
  type:'object',additionalProperties:false,
  properties:{
    summary:{type:'string'},
    highlights:{type:'array',items:{type:'string'},minItems:0,maxItems:8},
  },
  required:['summary','highlights'],
};

const repliesSchema={
  type:'object',additionalProperties:false,
  properties:{
    replies:{type:'array',items:{type:'string'},minItems:1,maxItems:3},
  },
  required:['replies'],
};

export class OpenAIChatAssistantProvider{
  constructor({apiKey,baseUrl=DEFAULT_BASE_URL,model=DEFAULT_MODEL,fetchImpl=globalThis.fetch,timeoutMs=60000,reasoningEffort='low'}={}){
    this.apiKey=apiKey??null;
    this.baseUrl=String(baseUrl||DEFAULT_BASE_URL).replace(/\/$/,'');
    this.model=model||DEFAULT_MODEL;
    this.fetchImpl=fetchImpl;
    this.timeoutMs=timeoutMs;
    this.reasoningEffort=reasoningEffort||'low';
  }

  status(){
    return{
      provider:'openai',
      enabled:Boolean(this.apiKey&&this.fetchImpl),
      model:this.model,
      reason:this.apiKey?null:'OPENAI_API_KEY is not configured',
    };
  }

  async #respond({instructions,input,schema,schemaName}){
    if(!this.status().enabled)throw providerError('CHAT_ASSISTANT_UNAVAILABLE','The chat assistant is not configured',503);
    const response=await this.fetchImpl(`${this.baseUrl}/responses`,{
      method:'POST',
      headers:{authorization:`Bearer ${this.apiKey}`,'content-type':'application/json'},
      body:JSON.stringify({
        model:this.model,
        store:false,
        truncation:'disabled',
        reasoning:{effort:this.reasoningEffort},
        instructions,
        input,
        text:{format:{type:'json_schema',name:schemaName,strict:true,schema}},
      }),
      signal:timeoutSignal(this.timeoutMs),
    });
    if(!response.ok){
      const details=await responseError(response);
      throw providerError('OPENAI_CHAT_ASSISTANT_FAILED',details.message,response.status>=500?502:400,details);
    }
    const payload=await response.json();
    const text=outputText(payload);
    if(!text)throw providerError('OPENAI_CHAT_ASSISTANT_EMPTY','OpenAI returned no structured output',502,{requestId:requestId(response)});
    try{return{parsed:JSON.parse(text),requestId:requestId(response),usage:payload?.usage??null}}
    catch{throw providerError('OPENAI_CHAT_ASSISTANT_INVALID_JSON','OpenAI returned invalid structured JSON',502,{requestId:requestId(response)})}
  }

  async summarizeThread({messages,selfUserId}){
    if(!Array.isArray(messages)||!messages.length)throw providerError('CHAT_ASSISTANT_INPUT_EMPTY','There is nothing to summarize yet',400);
    const instructions=[
      'You summarize a work chat thread for someone who has not read it.',
      'Use only the supplied messages. Do not invent facts, names, or decisions not present in the text.',
      'The summary is a short paragraph. Highlights are optional short bullet fragments for anything a reader must not miss — an open question, a deadline, a decision.',
      'Never address the reader in the second person as if they wrote the messages; describe what was discussed.',
      'The output must match the supplied JSON schema exactly.',
    ].join(' ');
    const{parsed,requestId:rid,usage}=await this.#respond({
      instructions,
      input:`Chat thread:\n${transcriptOf(messages,selfUserId)}`,
      schema:summarySchema,schemaName:'chat_thread_summary',
    });
    if(typeof parsed?.summary!=='string'||!Array.isArray(parsed?.highlights))throw providerError('OPENAI_CHAT_ASSISTANT_INVALID','The assistant reply did not match the expected contract',502,{requestId:rid});
    return{provider:'openai',model:this.model,requestId:rid,summary:parsed.summary,highlights:parsed.highlights,usage};
  }

  async suggestReplies({messages,selfUserId}){
    if(!Array.isArray(messages)||!messages.length)throw providerError('CHAT_ASSISTANT_INPUT_EMPTY','There is nothing to reply to yet',400);
    const instructions=[
      'You draft short candidate replies for the last message in a work chat, written as the person labelled "you".',
      'Use only the supplied messages as context. Do not invent facts, commitments, dates, or names not present in the text.',
      'Offer up to three distinct short replies, in the same language as the conversation. Each is a complete, ready-to-send message, not a description of one.',
      'Never draft a reply that promises a deadline, a decision, or an action not already stated by "you" in the thread — leave that to the human.',
      'The output must match the supplied JSON schema exactly.',
    ].join(' ');
    const{parsed,requestId:rid,usage}=await this.#respond({
      instructions,
      input:`Chat thread, oldest first — draft replies to the last message:\n${transcriptOf(messages,selfUserId)}`,
      schema:repliesSchema,schemaName:'chat_reply_suggestions',
    });
    if(!Array.isArray(parsed?.replies)||!parsed.replies.length)throw providerError('OPENAI_CHAT_ASSISTANT_INVALID','The assistant reply did not match the expected contract',502,{requestId:rid});
    return{provider:'openai',model:this.model,requestId:rid,replies:parsed.replies,usage};
  }
}

class DisabledChatAssistant{
  constructor(provider,reason){this.provider=provider;this.reason=reason}
  status(){return{provider:this.provider,enabled:false,reason:this.reason}}
  async summarizeThread(){throw providerError('CHAT_ASSISTANT_UNAVAILABLE',this.reason,503)}
  async suggestReplies(){throw providerError('CHAT_ASSISTANT_UNAVAILABLE',this.reason,503)}
}

export function createConfiguredChatAssistant(env=process.env,{fetchImpl=globalThis.fetch}={}){
  const apiKey=env.OPENAI_API_KEY??null;
  const baseUrl=env.OPENAI_BASE_URL||DEFAULT_BASE_URL;
  const choice=String(env.CHAT_ASSISTANT_PROVIDER??'').trim().toLowerCase();
  let assistant=null;
  if(choice==='openai'){
    assistant=new OpenAIChatAssistantProvider({
      apiKey,baseUrl,
      model:env.CHAT_ASSISTANT_MODEL||DEFAULT_MODEL,
      fetchImpl,
      timeoutMs:Number(env.CHAT_ASSISTANT_TIMEOUT_MS||60000),
      reasoningEffort:env.CHAT_ASSISTANT_REASONING||'low',
    });
  }else if(choice){
    assistant=new DisabledChatAssistant(choice,`Unsupported chat assistant provider: ${choice}`);
  }else{
    assistant=new DisabledChatAssistant('none','CHAT_ASSISTANT_PROVIDER is not configured');
  }
  return{assistant,status:assistant.status()};
}
