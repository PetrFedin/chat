import { hashPassword, verifyPassword, equalizePasswordTiming, normalizeEmail, createOpaqueToken, hashToken } from '../security.js';
import { Permission, requirePermission } from '../rbac.js';
import { cleanText, clientAddress, json, noContent, readJson } from './helpers.js';

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
    authThrottle?.guard('login',{address,identity:email});
    const a=await store.findAuthByEmail(email);
    // An unknown email must cost the same as a known one, or response time enumerates accounts.
    if(!a){equalizePasswordTiming(String(b.password??''));throw invalidCredentials()}
    if(!verifyPassword(String(b.password??''),a.passwordSalt,a.passwordHash))throw invalidCredentials();
    // workspaceId arrives from the client, so membership is verified here rather
    // than being discovered as a null session on the next request.
    const workspaceId=b.workspaceId??a.workspaceId;
    if(!await store.hasMembership(a.id,workspaceId))throw invalidCredentials();
    authThrottle?.succeeded('login',{address,identity:email});
    await openSession(res,req,a.id,workspaceId,200);return true;
  }
  if(method==='POST'&&path==='/api/v1/auth/logout'){const t=cookieToken(req);if(t)await store.revokeSession(hashToken(t));noContent(res,{'set-cookie':clearSession()});return true}
  if(method==='GET'&&path==='/api/v1/me'){const s=await requireSession(req);json(res,200,{...s,permissions:ctx.permissions(s.role)});return true}
  if(method==='GET'&&path==='/api/v1/bootstrap'){const s=await requireSession(req),data=await store.getBootstrap(s);json(res,200,{...data,permissions:ctx.permissions(s.role),storageMode:ctx.mode,push:ctx.push});return true}
  if(method==='POST'&&path==='/api/v1/invitations'){
    const s=await requireSession(req);requirePermission(s.role,Permission.MEMBER_INVITE);const b=await readJson(req),token=createOpaqueToken(),i=await store.createInvitation(s,{email:normalizeEmail(b.email),role:b.role??'member',tokenHash:hashToken(token),expiresAt:new Date(Date.now()+7*86400000).toISOString()});
    const proto=String(req.headers['x-forwarded-proto']??(req.socket.encrypted?'https':'http')).split(',')[0],host=req.headers.host??'localhost';json(res,201,{invitation:{...i,inviteUrl:`${proto}://${host}/?invite=${encodeURIComponent(token)}`}});return true;
  }
  return false;
}
