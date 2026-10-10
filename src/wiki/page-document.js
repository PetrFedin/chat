/**
 * Pages Authority: bounded, canonical Tiptap/ProseMirror JSON contract.
 * Tiptap is a client editor, never an alternative page store. JSON is the
 * structured source of truth and wiki_pages.content is its text/search
 * projection. Old text-only pages keep document=NULL until explicitly
 * edited through the structured API.
 */

const fail = (message, code='INVALID_PAGE_DOCUMENT') =>
  Object.assign(new Error(message), { code, statusCode:400, expose:true });

const MAX_NODES=3000;
const MAX_DEPTH=20;
const MAX_DOCUMENT_BYTES=500000;
const MAX_TEXT=100000;

const childrenFor=Object.freeze({
  doc: new Set(['paragraph','heading','bulletList','orderedList','blockquote','codeBlock','horizontalRule']),
  blockquote: new Set(['paragraph','heading','bulletList','orderedList','codeBlock']),
  paragraph: new Set(['text','hardBreak']),
  heading: new Set(['text','hardBreak']),
  codeBlock: new Set(['text']),
  bulletList: new Set(['listItem']),
  orderedList: new Set(['listItem']),
  listItem: new Set(['paragraph','bulletList','orderedList','blockquote','codeBlock']),
});
const allowedMarks=new Set(['bold','italic','strike','underline','code','link']);

const isRecord=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const failShape=()=>fail('Некорректная структура документа');

function checkKeys(obj,allowed){
  if(Object.keys(obj).some(k=>!allowed.includes(k)))throw failShape();
}

function normalizeMarks(marks){
  if(marks===undefined)return undefined;
  if(!Array.isArray(marks)||marks.length>8)throw failShape();
  const seen=new Set();
  const out=marks.map(mark=>{
    if(!isRecord(mark)||!allowedMarks.has(mark.type)||seen.has(mark.type))throw failShape();
    checkKeys(mark,['type','attrs']);
    seen.add(mark.type);
    if(mark.type!=='link'){
      if(mark.attrs!==undefined && ( !isRecord(mark.attrs)||Object.keys(mark.attrs).length))throw failShape();
      return{type:mark.type};
    }
    if(!isRecord(mark.attrs)||typeof mark.attrs.href!=='string')throw failShape();
    const href=mark.attrs.href.trim();
    if(href.length>2048||!(/^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|#\/[a-z0-9/_?=&.%-]+)$/i.test(href))) {
      throw fail('Ссылка должна быть HTTP(S), mailto: или внутренним адресом ChatX','INVALID_PAGE_LINK');
    }
    return{type:'link',attrs:{href}};
  });
  return out;
}

export function normalizePageDocument(input){
  if(!isRecord(input)||input.type!=='doc')throw failShape();
  const rawBytes=Buffer.byteLength(JSON.stringify(input),'utf8');
  if(rawBytes>MAX_DOCUMENT_BYTES)throw fail('Документ превышает допустимый размер','PAGE_DOCUMENT_TOO_LARGE');
  const state={nodes:0,textChars:0};
  function node(value,parent,depth){
    if(!isRecord(value)||typeof value.type!=='string'||depth>MAX_DEPTH)throw failShape();
    if(++state.nodes>MAX_NODES)throw fail('Документ содержит слишком много элементов','PAGE_DOCUMENT_TOO_LARGE');
    if(parent!==null&&!childrenFor[parent]?.has(value.type))throw failShape();
    if(value.type==='text'){
      checkKeys(value,['type','text','marks']);
      if(typeof value.text!=='string'||!value.text.length)throw failShape();
      state.textChars+=value.text.length;
      if(state.textChars>MAX_TEXT)throw fail('Текст страницы длиннее 100000 символов','INVALID_TEXT');
      const marks=normalizeMarks(value.marks);
      return{type:'text',text:value.text,...(marks?.length?{marks}:{})};
    }
    if(!childrenFor[value.type]&&!['hardBreak','horizontalRule'].includes(value.type))throw failShape();
    checkKeys(value,['type','content','attrs']);
    const attrs=value.attrs;
    const normalized={type:value.type};
    if(value.type==='heading'){
      if(!isRecord(attrs)||![1,2,3].includes(attrs.level)||Object.keys(attrs).some(k=>k!=='level'))throw failShape();
      normalized.attrs={level:attrs.level};
    }else if(value.type==='orderedList'){
      const start=attrs?.start??1;
      if(!Number.isSafeInteger(start)||start<1||start>100000 ||
         (attrs!==undefined&&(!isRecord(attrs)||Object.keys(attrs).some(k=>k!=='start'))))throw failShape();
      normalized.attrs={start};
    }else if(attrs!==undefined && (!isRecord(attrs)||Object.keys(attrs).length))throw failShape();
    if(!childrenFor[value.type]){
      if(value.content!==undefined)throw failShape();
      return normalized;
    }
    const contents=value.content??[];
    if(!Array.isArray(contents))throw failShape();
    if(['bulletList','orderedList','listItem'].includes(value.type)&&!contents.length)throw failShape();
    const normalizedChildren=contents.map(child=>node(child,value.type,depth+1));
    if(normalizedChildren.length)normalized.content=normalizedChildren;
    return normalized;
  }
  checkKeys(input,['type','content']);
  const document=node(input,null,0);
  const content=pageDocumentText(document);
  if(content.length>MAX_TEXT)throw fail('Текст страницы длиннее 100000 символов','INVALID_TEXT');
  return {document,content};
}

export function plainTextPageDocument(content=''){
  return{
    type:'doc',
    content:String(content).split('\n').map(line=>({
      type:'paragraph',
      ...(line?{content:[{type:'text',text:line}]}:{}),
    })),
  };
}

/** Text is a rebuildable index/search projection, not a second editor state. */
export function pageDocumentText(doc){
  const flatten=node=>{
    if(!node)return '';
    if(node.type==='text')return node.text;
    if(node.type==='hardBreak')return '\n';
    const children=(node.content||[]).map(flatten);
    if(['doc','blockquote','bulletList','orderedList','listItem'].includes(node.type))
      return children.filter(v=>v!==undefined).join('\n');
    return children.join('');
  };
  return flatten(doc);
}
