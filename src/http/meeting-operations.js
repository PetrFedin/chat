import { Permission, requirePermission } from '../rbac.js';
import { json, readJson } from './helpers.js';

const UUID='([0-9a-f-]+)';
const allowedStatuses=new Set(['pending','processing','failed','dead_letter','succeeded']);

function parseStatuses(value){
  const input=String(value??'failed,dead_letter').split(',').map((item)=>item.trim()).filter(Boolean);
  return [...new Set(input)].filter((item)=>allowedStatuses.has(item));
}

function optionalTimestamp(value,name){
  if(value==null||value==='')return null;
  const date=new Date(value);
  if(Number.isNaN(date.getTime())){
    const error=new Error(`${name} must be a valid timestamp`);error.code='INVALID_DATE_FILTER';error.statusCode=400;throw error;
  }
  return date.toISOString();
}

export function createMeetingOperationsHandler(){
  return async function handleMeetingOperations(req,res,ctx,url,path,method){
    const {meetingOps,meetingWorker,requireSession}=ctx;
    if(!meetingOps)return false;

    if(path==='/api/v1/admin/meeting-jobs'&&method==='GET'){
      const session=await requireSession(req);
      requirePermission(session.role,Permission.MEETING_OPS_MANAGE);
      const items=await meetingOps.listJobs(session,{
        statuses:parseStatuses(url.searchParams.get('statuses')),
        limit:url.searchParams.get('limit')??50,
      });
      json(res,200,{items,worker:meetingWorker?.status?.()??{configured:false,running:false}});
      return true;
    }

    let match=path.match(new RegExp(`^/api/v1/admin/meeting-jobs/${UUID}/retry$`,'i'));
    if(match&&method==='POST'){
      const session=await requireSession(req);
      requirePermission(session.role,Permission.MEETING_OPS_MANAGE);
      const body=await readJson(req);
      const job=await meetingOps.retryJob(session,match[1],{
        reason:body.reason,
        extraAttempts:body.extraAttempts??1,
      });
      meetingWorker?.kick?.(job.kind);
      json(res,200,{job});
      return true;
    }

    match=path.match(new RegExp(`^/api/v1/admin/meeting-jobs/${UUID}/audit$`,'i'));
    if(match&&method==='GET'){
      const session=await requireSession(req);
      requirePermission(session.role,Permission.AUDIT_READ);
      const items=await meetingOps.jobAudit(session,match[1],url.searchParams.get('limit')??50);
      json(res,200,{items});
      return true;
    }

    if(path==='/api/v1/admin/meeting-prices'&&method==='GET'){
      const session=await requireSession(req);
      requirePermission(session.role,Permission.MEETING_COST_READ);
      json(res,200,{items:await meetingOps.listPriceVersions(session)});
      return true;
    }

    if(path==='/api/v1/admin/meeting-prices'&&method==='POST'){
      const session=await requireSession(req);
      requirePermission(session.role,Permission.MEETING_COST_MANAGE);
      const version=await meetingOps.createPriceVersion(session,await readJson(req));
      json(res,201,{version});
      return true;
    }

    if(path==='/api/v1/admin/meeting-costs'&&method==='GET'){
      const session=await requireSession(req);
      requirePermission(session.role,Permission.MEETING_COST_READ);
      const report=await meetingOps.costReport(session,{
        from:optionalTimestamp(url.searchParams.get('from'),'from'),
        to:optionalTimestamp(url.searchParams.get('to'),'to'),
        limit:url.searchParams.get('limit')??200,
      });
      json(res,200,report);
      return true;
    }

    return false;
  };
}
