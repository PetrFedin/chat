import { russianMessage } from './ru-errors.js';
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
/**
 * Обязательное текстовое поле.
 *
 * Отказ говорил «Invalid text value» — ни поля, ни того, что не так.
 * Человек, оставивший пустым имя, и человек, вписавший название на
 * двести символов, читали одну и ту же фразу и не знали, что чинить.
 * Третьим доводом идёт название поля: где его передали, там и скажем.
 */
export const cleanText=(value,max=500,field=null)=>{
  // Объект или массив вместо строки превращался в «[object Object]» и сохранялся как данные.
  if(value!==null&&typeof value==='object')throw Object.assign(new Error(field?`«${field}» должно быть текстом`:'Ожидался текст'),{code:'INVALID_TEXT',statusCode:400,expose:true});
  const s=String(value??'').replace(CONTROL,'').trim();
  if(!s)throw Object.assign(new Error(field?`Заполните поле «${field}»`:'Поле не заполнено'),{code:'INVALID_TEXT',statusCode:400,expose:true});
  if(s.length>max)throw Object.assign(new Error(field?`«${field}» длиннее ${max} символов`:`Текст длиннее ${max} символов`),{code:'INVALID_TEXT',statusCode:400,expose:true});
  return s;
};
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
// Чужая cookie с «%» ломала decodeURIComponent и роняла все запросы 400-й ошибкой (на localhost рядом живут другие приложения).
const safeDecode=(v)=>{try{return decodeURIComponent(v)}catch{return v}};
export const cookies=(req)=>Object.fromEntries(String(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return i<0?[x,'']:[x.slice(0,i),safeDecode(x.slice(i+1))]}));
export const json=(res,status,value,headers={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});res.end(JSON.stringify(value))};
export const noContent=(res,headers={})=>{res.writeHead(204,{'cache-control':'no-store',...headers});res.end()};
// A driver error (a 5-digit SQLSTATE, a constraint name) is internal detail:
// it names our tables to anyone who can POST. Map the ones a client can
// legitimately provoke, hide the rest behind a generic 400.
const PG_CODES={'23505':{code:'ALREADY_EXISTS',statusCode:409,message:'A record with these values already exists'},'23503':{code:'REFERENCE_NOT_FOUND',statusCode:400,message:'A referenced record does not exist'},'23514':{code:'INVALID_VALUE',statusCode:400,message:'A value failed a validation rule'},'22P02':{code:'INVALID_VALUE',statusCode:400,message:'A value has the wrong format'},'22021':{code:'INVALID_TEXT',statusCode:400,message:'The text contains characters the database cannot store'},'22008':{code:'INVALID_DATE',statusCode:400,message:'The date is out of range'},'22003':{code:'INVALID_VALUE',statusCode:400,message:'The number is out of range'},'22007':{code:'INVALID_DATE',statusCode:400,message:'The date is out of range'},'2201W':{code:'INVALID_VALUE',statusCode:400,message:'The number is out of range'},'2201X':{code:'INVALID_VALUE',statusCode:400,message:'The number is out of range'}};
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
  if(res.headersSent){try{res.end()}catch{}return}const status=error.statusCode??(error.code==='FORBIDDEN'?403:400),headers={...(error.retryAfterSeconds?{'retry-after':String(error.retryAfterSeconds)}:{}),...(status===413?{connection:'close'}:{})},hide=status>=500&&!error.expose;json(res,status,{error:{code:error.code??'BAD_REQUEST',message:hide?'Internal server error':russianMessage(error.message)}},headers)};
// X-Forwarded-For is set by the client unless something in front of us
// overwrites it. Trusting it unconditionally let a credential spray rotate the
// header and skip the per-address limiter entirely, so the header counts only
// when the deployment says it sits behind a proxy.
/**
 * Адрес стенда для ссылок в письмах (сброс пароля, приглашения, мост Telegram).
 *
 * Раньше он собирался из заголовка Host: анонимный запрос на сброс пароля
 * с чужим Host отправлял жертве письмо с настоящим токеном и ссылкой на сайт
 * атакующего. Теперь, если задан PUBLIC_URL, берётся только он; заголовок
 * остаётся запасным вариантом для локальной разработки.
 */
export const publicOrigin=(req,env=process.env)=>{
  const fixed=String(env.PUBLIC_URL??'').trim().replace(/\/+$/,'');
  // Допускаем и путь («https://example.com/chat»): раньше такой PUBLIC_URL молча отбрасывался, и возвращалась
  // подстановка Host из заголовка.
  if(/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(fixed))return fixed;
  const proto=String((trustsProxy(env)&&req.headers['x-forwarded-proto'])||(req.socket?.encrypted?'https':'http')).split(',')[0];
  return `${proto}://${req.headers.host??'localhost'}`;
};
export const trustsProxy=(env=process.env)=>env.TRUST_PROXY==='true';
export const clientAddress=(req,env=process.env)=>{
  const direct=String(req.socket?.remoteAddress??'').trim()||null;
  if(!trustsProxy(env))return direct;
  // Первый адрес в X-Forwarded-For клиент подставляет сам, поэтому им нельзя обойти лимит входа и
  // подделать журнал. Верим адресу, который дописал наш собственный прокси: счёт с правого края,
  // число прокси — TRUST_PROXY_HOPS (по умолчанию 1).
  const hops=Math.max(1,Number(env.TRUST_PROXY_HOPS??1)||1);
  const chain=String(req.headers['x-forwarded-for']??'').split(',').map((x)=>x.trim()).filter(Boolean);
  const forwarded=chain.length?chain[Math.max(0,chain.length-hops)]:'';
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
/** Склонение по числу: 1 человек, 2 человека, 5 человек. */
export const ruPlural=(n,one,few,many)=>{const a=Math.abs(n)%100,b=a%10;if(a>10&&a<20)return many;if(b>1&&b<5)return few;if(b===1)return one;return many};
/** Часовой пояс из тела запроса: мусорный пояс ломал потом выдачу календаря целиком. */
export const validTimezone=(tz)=>{try{new Intl.DateTimeFormat('en',{timeZone:String(tz)});return true}catch{return false}};
export async function readJson(req){const body=await readBuffer(req,MAX_JSON);if(!body.length)return{};let parsed;try{parsed=JSON.parse(body.toString('utf8'))}catch{throw Object.assign(new Error('Invalid JSON'),{code:'INVALID_JSON',statusCode:400,expose:true})}
  // «null», число или строка вместо объекта: маршруты читают body.поле и падали бы с JS-ошибкой.
  if(parsed===null||typeof parsed!=='object'||Array.isArray(parsed))throw Object.assign(new Error('Invalid JSON'),{code:'INVALID_JSON',statusCode:400,expose:true});
  // Тысячи вложенных скобок укладываются в лимит размера, но обход такого объекта (и JSON.stringify) рекурсивен.
  if(jsonDepth(parsed)>32)throw Object.assign(new Error('Invalid JSON'),{code:'INVALID_JSON',statusCode:400,expose:true});
  return parsed}
/** Глубина вложенности без рекурсии: на злонамеренном вводе рекурсия сама упёрлась бы в стек. */
function jsonDepth(root){
  let max=0;const stack=[[root,1]];
  while(stack.length){
    const[node,depth]=stack.pop();
    if(depth>max)max=depth;
    if(max>32)return max;
    if(node&&typeof node==='object')for(const child of Object.values(node))if(child&&typeof child==='object')stack.push([child,depth+1]);
  }
  return max;
}
export const sha256=(buffer)=>createHash('sha256').update(buffer).digest('hex');
