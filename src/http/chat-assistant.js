import { json, readJson, pageSize } from './helpers.js';

const CONVERSATION_ID='([0-9a-f-]+)';
const SUMMARIZE=new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/assistant/summarize$`,'i');
const SUGGEST=new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/assistant/suggest-replies$`,'i');

const kindLabel=(kind)=>({voice:'Voice message',file:'File',call:'Call',task:'Task',calendar:'Event'}[kind]??'Message');

/** Только видимый человеку текст: удалённое сообщение не несёт содержания, вложение описывается словом, а не молчанием. */
function toThread(items){
  return items
    .map((m)=>({id:m.id,authorId:m.authorId,text:m.deletedAt?null:(m.body??kindLabel(m.kind))}))
    .filter((m)=>m.text&&m.text.trim());
}

export function createChatAssistantHandler(){
  return async function handleChatAssistant(req,res,ctx,path,method){
    const summarize=path.match(SUMMARIZE);
    if(summarize&&method==='POST'){
      const s=await ctx.requireSession(req);
      const body=await readJson(req);
      const limit=pageSize(body.limit,60,120);
      const items=await ctx.store.listMessages(s,summarize[1],limit);
      const result=await ctx.chatAssistant.summarizeThread({messages:toThread(items),selfUserId:s.userId});
      json(res,200,result);
      return true;
    }
    const suggest=path.match(SUGGEST);
    if(suggest&&method==='POST'){
      const s=await ctx.requireSession(req);
      const body=await readJson(req);
      const limit=pageSize(body.limit,30,120);
      const items=await ctx.store.listMessages(s,suggest[1],limit);
      const result=await ctx.chatAssistant.suggestReplies({messages:toThread(items),selfUserId:s.userId});
      json(res,200,result);
      return true;
    }
    return false;
  };
}
