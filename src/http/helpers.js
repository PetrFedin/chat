import { createHash } from 'node:crypto';

export const MAX_JSON=1_000_000,MAX_FILE=50*1024*1024;
export const allowedPresence=new Set(['online','away','busy','do_not_disturb','offline']);
export const allowedConversationKinds=new Set(['direct','group','channel','team','project','task','decision','approval','control','incident','meeting','external']);
// Only the server writes these: they record what the system did, and a
// member forging one fabricates an audit-looking notice in the transcript.
export const serverOnlyMessageKinds=new Set(['system','call','task','calendar']);
export const allowedMessageKinds=new Set(['text','system','file','call','task','calendar','poll']);
export const messageKindLabel=(kind)=>({voice:'Голосовое сообщение',file:'Файл',call:'Звонок',task:'Задача',calendar:'Событие'})[kind]||'Новое сообщение';
// Нулевой байт PostgreSQL в текст не принимает, и запрос падал пятисоткой
// «внутренняя ошибка сервера» — на обычную вставку из внешней системы.
// Заодно уходят прочие управляющие символы, кроме перевода строки и
// табуляции: в названии задачи им делать нечего.
const CONTROL=/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export const cleanText=(value,max=500)=>{const s=String(value??'').replace(CONTROL,'').trim();if(!s||s.length>max)throw Object.assign(new Error('Invalid text value'),{code:'INVALID_TEXT'});return s};
// То же для длинных текстов, которые не проходят через cleanText: тело
// сообщения, заметки. Здесь только вычищаем, длину меряет вызывающий.
/**
 * Дата, написанная человеком, — и никакая другая.
 *
 * `new Date` дописывает несуществующие дни: 31 февраля молча становится
 * 3 марта, и человек получает напоминание не в тот день, звонок не в тот
 * день и срок доступа не тогда, когда назначил. Календарная часть
 * обязана совпасть с написанной.
 *
 * Всё, что пришло не строкой и не числом, — ошибка. Массив `[1]`
 * превращался в 2000 год: обещание, просроченное с рождения, проходило
 * все проверки.
 */
export const INVALID_DATE=()=>Object.assign(new Error('Такой даты не бывает'),{code:'INVALID_DATE',statusCode:400,expose:true});
export const toDateOrNull=(value)=>{
  if(value===undefined)return undefined;
  if(value===null||value==='')return null;
  if(typeof value!=='string'&&typeof value!=='number'&&!(value instanceof Date))throw INVALID_DATE();
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))throw INVALID_DATE();
  const iso=date.toISOString();
  if(typeof value==='string'){
    const written=value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(written&&!iso.startsWith(`${written[1]}-${written[2]}-${written[3]}`)){
      // Смещение пояса может законно сдвинуть дату на сутки — сверяем и
      // местную календарную часть тоже.
      const local=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      if(local!==`${written[1]}-${written[2]}-${written[3]}`)throw INVALID_DATE();
    }
  }
  const year=date.getUTCFullYear();
  if(year<1970||year>2200)throw INVALID_DATE();
  return iso;
};

export const stripControl=(value)=>String(value??'').replace(CONTROL,'');
/**
 * Размер страницы.
 *
 * Зажим был написан по-своему в шести местах: где-то `Number(x)||50`,
 * где-то `Math.min(Math.max(...))` без запасного значения, где-то ничего.
 * Дробное `1.5` проходило все проверки и падало уже в PostgreSQL —
 * «A value has the wrong format» на безобидный параметр в адресе.
 */
export const pageSize=(value,fallback,max)=>{
  const number=Math.trunc(Number(value));
  // Ноль и отрицательное — не размер страницы, а опечатка: отвечаем
  // умолчанием, как это и делал список задач. Раньше одни маршруты
  // возвращали на такой запрос одну строку, другие — пятьдесят.
  if(!Number.isFinite(number)||number<1)return fallback;
  return Math.min(number,max);
};
export const cookies=(req)=>Object.fromEntries(String(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return i<0?[x,'']:[x.slice(0,i),decodeURIComponent(x.slice(i+1))]}));
export const json=(res,status,value,headers={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});res.end(JSON.stringify(value))};
export const noContent=(res,headers={})=>{res.writeHead(204,{'cache-control':'no-store',...headers});res.end()};
// A driver error (a 5-digit SQLSTATE, a constraint name) is internal detail:
// it names our tables to anyone who can POST. Map the ones a client can
// legitimately provoke, hide the rest behind a generic 400.
const PG_CODES={'23505':{code:'ALREADY_EXISTS',statusCode:409,message:'A record with these values already exists'},'23503':{code:'REFERENCE_NOT_FOUND',statusCode:400,message:'A referenced record does not exist'},'23514':{code:'INVALID_VALUE',statusCode:400,message:'A value failed a validation rule'},'22P02':{code:'INVALID_VALUE',statusCode:400,message:'A value has the wrong format'},'22021':{code:'INVALID_TEXT',statusCode:400,message:'The text contains characters the database cannot store'},'22008':{code:'INVALID_DATE',statusCode:400,message:'The date is out of range'},'22003':{code:'INVALID_VALUE',statusCode:400,message:'The number is out of range'}};
/**
 * Отказ инфраструктуры — не ошибка клиента.
 *
 * База не отвечает, диск переполнен, каталог недоступен — всё это уходило
 * наружу как HTTP 400 с текстом вроде «connect ECONNREFUSED
 * 127.0.0.1:55432» или полным путём файла на сервере. В сводке по кодам
 * такая авария выглядит как «пользователи шлют кривые запросы», а
 * внутренний адрес и структура каталогов достаются любому желающему.
 */
const INFRA_CODES=new Set(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND','EPIPE','EHOSTUNREACH','ENETUNREACH','EACCES','ENOSPC','EROFS','EMFILE','ENFILE']);
export const normalizeError=(error)=>{
  const code=String(error?.code??'');
  if(INFRA_CODES.has(code)||error?.message==='Connection terminated unexpectedly'){
    return Object.assign(new Error('Хранилище временно недоступно'),
      {code:'STORAGE_UNAVAILABLE',statusCode:503,expose:true,cause:error});
  }
  if(!/^[0-9A-Z]{5}$/.test(code)||error.statusCode)return error;const mapped=PG_CODES[error.code]??{code:'STORAGE_ERROR',statusCode:500,message:'Internal server error'};return Object.assign(new Error(mapped.message),mapped)};
export const errorJson=(res,rawError)=>{const error=normalizeError(rawError);
  // A handler that already answered and then threw must not take the process
  // down: writing headers twice throws ERR_HTTP_HEADERS_SENT out of the catch
  // block, where nothing is left to catch it.
  if(res.headersSent){try{res.end()}catch{}return}const status=error.statusCode??(error.code==='FORBIDDEN'?403:400),headers=error.retryAfterSeconds?{'retry-after':String(error.retryAfterSeconds)}:{},hide=status>=500&&!error.expose;json(res,status,{error:{code:error.code??'BAD_REQUEST',message:hide?'Internal server error':error.message}},headers)};
// X-Forwarded-For is set by the client unless something in front of us
// overwrites it. Trusting it unconditionally let a credential spray rotate the
// header and skip the per-address limiter entirely, so the header counts only
// when the deployment says it sits behind a proxy.
export const trustsProxy=(env=process.env)=>env.TRUST_PROXY==='true';
export const clientAddress=(req,env=process.env)=>{
  const direct=String(req.socket?.remoteAddress??'').trim()||null;
  if(!trustsProxy(env))return direct;
  const forwarded=String(req.headers['x-forwarded-for']??'').split(',')[0].trim();
  return forwarded||direct;
};
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
export async function readBuffer(req,limit){if(req.rawBody!==undefined){if(req.rawBody.length>limit)throw Object.assign(new Error('Request too large'),{code:'PAYLOAD_TOO_LARGE',statusCode:413});return req.rawBody}const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>limit)throw Object.assign(new Error('Request too large'),{code:'PAYLOAD_TOO_LARGE',statusCode:413});chunks.push(chunk)}return Buffer.concat(chunks)}
export async function readJson(req){const body=await readBuffer(req,MAX_JSON);if(!body.length)return{};try{return JSON.parse(body.toString('utf8'))}catch{throw Object.assign(new Error('Invalid JSON'),{code:'INVALID_JSON'})}}
export const sha256=(buffer)=>createHash('sha256').update(buffer).digest('hex');
