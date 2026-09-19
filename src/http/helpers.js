import { createHash } from 'node:crypto';

export const MAX_JSON=1_000_000,MAX_FILE=50*1024*1024;
export const allowedPresence=new Set(['online','away','busy','do_not_disturb','offline']);
export const allowedConversationKinds=new Set(['direct','group','channel','team','project','task','decision','approval','control','incident','meeting','external']);
export const allowedMessageKinds=new Set(['text','system','file','call','task','calendar','poll']);
export const messageKindLabel=(kind)=>({voice:'Голосовое сообщение',file:'Файл',call:'Звонок',task:'Задача',calendar:'Событие'})[kind]||'Новое сообщение';
export const cleanText=(value,max=500)=>{const s=String(value??'').trim();if(!s||s.length>max)throw Object.assign(new Error('Invalid text value'),{code:'INVALID_TEXT'});return s};
export const cookies=(req)=>Object.fromEntries(String(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return i<0?[x,'']:[x.slice(0,i),decodeURIComponent(x.slice(i+1))]}));
export const json=(res,status,value,headers={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});res.end(JSON.stringify(value))};
export const noContent=(res,headers={})=>{res.writeHead(204,{'cache-control':'no-store',...headers});res.end()};
// A driver error (a 5-digit SQLSTATE, a constraint name) is internal detail:
// it names our tables to anyone who can POST. Map the ones a client can
// legitimately provoke, hide the rest behind a generic 400.
const PG_CODES={'23505':{code:'ALREADY_EXISTS',statusCode:409,message:'A record with these values already exists'},'23503':{code:'REFERENCE_NOT_FOUND',statusCode:400,message:'A referenced record does not exist'},'23514':{code:'INVALID_VALUE',statusCode:400,message:'A value failed a validation rule'},'22P02':{code:'INVALID_VALUE',statusCode:400,message:'A value has the wrong format'}};
export const normalizeError=(error)=>{if(!/^[0-9A-Z]{5}$/.test(String(error?.code??''))||error.statusCode)return error;const mapped=PG_CODES[error.code]??{code:'STORAGE_ERROR',statusCode:500,message:'Internal server error'};return Object.assign(new Error(mapped.message),mapped)};
export const errorJson=(res,rawError)=>{const error=normalizeError(rawError);const status=error.statusCode??(error.code==='FORBIDDEN'?403:400),headers=error.retryAfterSeconds?{'retry-after':String(error.retryAfterSeconds)}:{},hide=status>=500&&!error.expose;json(res,status,{error:{code:error.code??'BAD_REQUEST',message:hide?'Internal server error':error.message}},headers)};
export const clientAddress=(req)=>String(req.headers['x-forwarded-for']??req.socket?.remoteAddress??'').split(',')[0].trim()||null;
// camera/microphone stay permitted: the product is a calling app.
// frameAncestors defaults to denying every embed. Set CSP_FRAME_ANCESTORS to a
// space-separated source list to embed the workspace in an intranet portal or a
// local preview pane; X-Frame-Options is then dropped because its DENY has no
// source list and would veto the allowance in older browsers.
export const securityHeaders=({production=false,frameAncestors=null}={})=>{
  const ancestors=String(frameAncestors??'').trim()||"'none'";
  return{
    'content-security-policy':["default-src 'self'","base-uri 'self'","object-src 'none'",`frame-ancestors ${ancestors}`,"form-action 'self'","script-src 'self' blob:","worker-src 'self' blob:","style-src 'self' 'unsafe-inline'","img-src 'self' data: blob:","media-src 'self' blob:","font-src 'self' data:","connect-src 'self' ws: wss: https:"].join('; '),
    'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer',
    'permissions-policy':'geolocation=(), payment=(), usb=(), interest-cohort=()',
    ...(ancestors==="'none'"?{'x-frame-options':'DENY'}:{}),
    ...(production?{'strict-transport-security':'max-age=31536000; includeSubDomains'}:{}),
  };
};
export async function readBuffer(req,limit){const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>limit)throw Object.assign(new Error('Request too large'),{code:'PAYLOAD_TOO_LARGE',statusCode:413});chunks.push(chunk)}return Buffer.concat(chunks)}
export async function readJson(req){const body=await readBuffer(req,MAX_JSON);if(!body.length)return{};try{return JSON.parse(body.toString('utf8'))}catch{throw Object.assign(new Error('Invalid JSON'),{code:'INVALID_JSON'})}}
export const sha256=(buffer)=>createHash('sha256').update(buffer).digest('hex');
