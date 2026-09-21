import { hashPassword, verifyPassword, equalizePasswordTiming, normalizeEmail, createOpaqueToken, hashToken } from '../security.js';
import { Permission, requirePermission } from '../rbac.js';
import { log } from '../obs/log.js';
import { cleanText, clientAddress, trustsProxy, json, noContent, readJson } from './helpers.js';

const invalidCredentials=()=>Object.assign(new Error('Invalid email or password'),{code:'INVALID_CREDENTIALS',statusCode:401});

export async function handleAuth(req,res,ctx,path,method){
  const {store,requireSession,openSession,clearSession,cookieToken,authThrottle}=ctx;
  const address=clientAddress(req);
  if(method==='POST'&&path==='/api/v1/auth/register-company'){
    authThrottle?.guard('register',{address});
    const b=await readJson(req),email=normalizeEmail(b.email),p=hashPassword(b.password);
    const x=await store.createCompany({companyName:cleanText(b.companyName,120),workspaceName:b.workspaceName?cleanText(b.workspaceName,120):undefined,ownerName:cleanText(b.ownerName,120),email,passwordHash:p.hash,passwordSalt:p.salt});
    await openSession(res,req,x.user.id,x.workspace.id,201);return true;
  }
  if(method==='POST'&&path==='/api/v1/invitations/accept'){
    authThrottle?.guard('invitation',{address});
    const b=await readJson(req),p=hashPassword(b.password),x=await store.acceptInvitation({tokenHash:hashToken(cleanText(b.token,200)),displayName:cleanText(b.displayName,120),passwordHash:p.hash,passwordSalt:p.salt});
    await openSession(res,req,x.user.id,x.workspace.id,201);return true;
  }
  if(method==='POST'&&path==='/api/v1/auth/login'){
    const b=await readJson(req),email=normalizeEmail(b.email);
    /**
     * Ночной подбор паролей не оставлял следа.
     *
     * В журнале было девять одинаковых строк «POST /login → 401» без
     * адреса, без почты и без времени: один хост, долбящий один аккаунт,
     * и ботнет по всей организации выглядели одинаково. В журнале аудита
     * при этом не было вообще ни одного события входа — ни удачного, ни
     * провального, — хотя именно за этим к нему и приходят.
     */
    const refuse=async(reason,userId=null,workspaceId=null)=>{
      log('warn','auth.login.failed',{reqId:req.reqId,email,reason,ip:address});
      if(userId&&workspaceId&&store.recordAuthEvent){
        await store.recordAuthEvent({workspaceId,userId,eventType:'auth.login.failed',payload:{reason,ip:address}}).catch(()=>{});
      }
      return invalidCredentials();
    };
    authThrottle?.guard('login',{address,identity:email});
    const a=await store.findAuthByEmail(email);
    // An unknown email must cost the same as a known one, or response time enumerates accounts.
    if(!a){equalizePasswordTiming(String(b.password??''));throw await refuse('unknown_email')}
    if(!verifyPassword(String(b.password??''),a.passwordSalt,a.passwordHash)){
      throw await refuse('bad_password',a.id,a.workspaceId);
    }
    // workspaceId arrives from the client, so membership is verified here rather
    // than being discovered as a null session on the next request.
    const workspaceId=b.workspaceId??a.workspaceId;
    if(!await store.hasMembership(a.id,workspaceId))throw await refuse('not_a_member',a.id,a.workspaceId);
    authThrottle?.succeeded('login',{address,identity:email});
    log('info','auth.login.ok',{reqId:req.reqId,userId:a.id,wsId:workspaceId,ip:address});
    if(store.recordAuthEvent){
      await store.recordAuthEvent({workspaceId,userId:a.id,eventType:'auth.login.succeeded',payload:{ip:address}}).catch(()=>{});
    }
    await openSession(res,req,a.id,workspaceId,200);return true;
  }
  if(method==='POST'&&path==='/api/v1/auth/logout'){const t=cookieToken(req);if(t)await store.revokeSession(hashToken(t));noContent(res,{'set-cookie':clearSession()});return true}
  if(method==='GET'&&path==='/api/v1/me'){const s=await requireSession(req);json(res,200,{...s,permissions:ctx.permissions(s.role)});return true}
  if(method==='GET'&&path==='/api/v1/bootstrap'){const s=await requireSession(req),data=await store.getBootstrap(s);json(res,200,{...data,permissions:ctx.permissions(s.role),storageMode:ctx.mode,push:ctx.push});return true}
  // Recovery has no mail channel, so an administrator issues the link and
  // hands it over. The person who forgot cannot ask for it themselves —
  // asking is a conversation with their administrator, not an endpoint.
  if(method==='POST'&&path==='/api/v1/password-resets'){
    const s=await requireSession(req);requirePermission(s.role,Permission.MEMBER_INVITE);
    if(!store.createPasswordReset)throw Object.assign(new Error('Password recovery requires a database deployment'),{code:'RESET_UNAVAILABLE',statusCode:503,expose:true});
    const b=await readJson(req),token=createOpaqueToken();
    const reset=await store.createPasswordReset(s,{userId:String(b.userId??''),tokenHash:hashToken(token),expiresAt:new Date(Date.now()+86400000).toISOString()});
    const proto=String((trustsProxy()&&req.headers['x-forwarded-proto'])||(req.socket.encrypted?'https':'http')).split(',')[0],host=req.headers.host??'localhost';
    json(res,201,{reset:{...reset,resetUrl:`${proto}://${host}/?reset=${encodeURIComponent(token)}`}});return true;
  }

  if(method==='POST'&&path==='/api/v1/password-resets/redeem'){
    if(!store.redeemPasswordReset)throw Object.assign(new Error('Password recovery requires a database deployment'),{code:'RESET_UNAVAILABLE',statusCode:503,expose:true});
    const b=await readJson(req),p=hashPassword(b.password);
    await store.redeemPasswordReset({tokenHash:hashToken(cleanText(b.token,200)),passwordHash:p.hash,passwordSalt:p.salt});
    // The new password is set but no session is handed out: signing in with
    // it is the proof it arrived where it was meant to.
    noContent(res);return true;
  }

  if(method==='POST'&&path==='/api/v1/invitations'){
    const s=await requireSession(req);requirePermission(s.role,Permission.MEMBER_INVITE);const b=await readJson(req);
    const RANK={guest:0,member:1,manager:2,admin:3,owner:4};
    const wanted=b.role??'member';
    if(!(wanted in RANK)||wanted==='owner')throw Object.assign(new Error('Такой роли для приглашения нет'),{code:'INVALID_INVITE_ROLE',statusCode:400,expose:true});
    if(RANK[wanted]>RANK[s.role??'member'])throw Object.assign(new Error('Нельзя пригласить человека с правами выше своих'),{code:'INVITE_ROLE_TOO_HIGH',statusCode:403,expose:true});
    const token=createOpaqueToken(),i=await store.createInvitation(s,{email:normalizeEmail(b.email),role:wanted,tokenHash:hashToken(token),expiresAt:new Date(Date.now()+7*86400000).toISOString()});
    const proto=String((trustsProxy()&&req.headers['x-forwarded-proto'])||(req.socket.encrypted?'https':'http')).split(',')[0],host=req.headers.host??'localhost';json(res,201,{invitation:{...i,inviteUrl:`${proto}://${host}/?invite=${encodeURIComponent(token)}`}});return true;
  }
  return false;
}
