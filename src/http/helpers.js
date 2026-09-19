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
export const errorJson=(res,error)=>{const status=error.statusCode??(error.code==='FORBIDDEN'?403:400),headers=error.retryAfterSeconds?{'retry-after':String(error.retryAfterSeconds)}:{};json(res,status,{error:{code:error.code??'BAD_REQUEST',message:status>=500?'Internal server error':error.message}},headers)};
export const clientAddress=(req)=>String(req.headers['x-forwarded-for']??req.socket?.remoteAddress??'').split(',')[0].trim()||null;
// camera/microphone stay permitted: the product is a calling app.
export const securityHeaders=({production=false}={})=>({
  'content-security-policy':["default-src 'self'","base-uri 'self'","object-src 'none'","frame-ancestors 'none'","form-action 'self'","script-src 'self' blob:","worker-src 'self' blob:","style-src 'self' 'unsafe-inline'","img-src 'self' data: blob:","media-src 'self' blob:","font-src 'self' data:","connect-src 'self' ws: wss: https:"].join('; '),
  'x-content-type-options':'nosniff',
  'x-frame-options':'DENY',
  'referrer-policy':'no-referrer',
  'permissions-policy':'geolocation=(), payment=(), usb=(), interest-cohort=()',
  ...(production?{'strict-transport-security':'max-age=31536000; includeSubDomains'}:{}),
});
export async function readBuffer(req,limit){const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>limit)throw Object.assign(new Error('Request too large'),{code:'PAYLOAD_TOO_LARGE',statusCode:413});chunks.push(chunk)}return Buffer.concat(chunks)}
export async function readJson(req){const body=await readBuffer(req,MAX_JSON);if(!body.length)return{};try{return JSON.parse(body.toString('utf8'))}catch{throw Object.assign(new Error('Invalid JSON'),{code:'INVALID_JSON'})}}
export const sha256=(buffer)=>createHash('sha256').update(buffer).digest('hex');
