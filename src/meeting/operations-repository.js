import { randomUUID } from 'node:crypto';

const clone=(value)=>value==null?value:structuredClone(value);
const now=()=>new Date().toISOString();
const PRICE_PATH=/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;
const METRIC_NAME=/^[a-z][a-z0-9_]{0,63}$/;
const MONEY_SCALE=18;

function error(code,message,statusCode=400){const value=new Error(message);value.code=code;value.statusCode=statusCode;return value}
function boundedLimit(value,fallback=50,max=200){const parsed=Number(value);return Number.isFinite(parsed)?Math.min(max,Math.max(1,Math.round(parsed))):fallback}
function nestedNumber(value,path){
  let cursor=value;
  for(const part of String(path).split('.')){if(cursor==null||typeof cursor!=='object')return null;cursor=cursor[part]}
  const number=Number(cursor);
  return Number.isFinite(number)&&number>=0?number:null;
}
function plainDecimal(value){
  const text=String(value??'0').trim();
  if(/^[+-]?\d+(?:\.\d+)?$/.test(text))return text;
  const number=Number(text);
  if(!Number.isFinite(number))throw error('INVALID_DECIMAL',`Invalid decimal value: ${text}`);
  return number.toFixed(MONEY_SCALE).replace(/(\.\d*?[1-9])0+$|\.0+$/,'$1');
}
function decimalFraction(value){
  const text=plainDecimal(value);
  const negative=text.startsWith('-');
  const unsigned=text.replace(/^[+-]/,'');
  const [whole='0',fraction='']=unsigned.split('.');
  const denominator=10n**BigInt(fraction.length);
  const numerator=BigInt(`${whole||'0'}${fraction}`||'0')*(negative?-1n:1n);
  return{numerator,denominator};
}
function formatScaled(integer,scale=MONEY_SCALE){
  const negative=integer<0n;
  const value=negative?-integer:integer;
  const raw=value.toString().padStart(scale+1,'0');
  const whole=raw.slice(0,-scale)||'0';
  const fraction=raw.slice(-scale).replace(/0+$/,'');
  return `${negative?'-':''}${whole}${fraction?`.${fraction}`:''}`;
}
function decimalCost(quantity,unitQuantity,unitPrice){
  const q=decimalFraction(quantity),u=decimalFraction(unitQuantity),p=decimalFraction(unitPrice);
  if(q.numerator<0n||u.numerator<=0n||p.numerator<0n)throw error('INVALID_PRICE_CALCULATION','Price calculation requires non-negative usage and positive units');
  const numerator=q.numerator*p.numerator*u.denominator;
  const denominator=q.denominator*p.denominator*u.numerator;
  const factor=10n**BigInt(MONEY_SCALE);
  let scaled=numerator*factor/denominator;
  const remainder=numerator*factor%denominator;
  if(remainder*2n>=denominator)scaled+=1n;
  return formatScaled(scaled);
}
function addDecimalStrings(left,right){
  const a=decimalFraction(left),b=decimalFraction(right);
  const denominator=a.denominator>b.denominator?a.denominator:b.denominator;
  const aScaled=a.numerator*(denominator/a.denominator);
  const bScaled=b.numerator*(denominator/b.denominator);
  const sum=aScaled+bScaled;
  const scale=denominator.toString().length-1;
  return formatScaled(sum,scale);
}
function normalizePriceInput(value){
  const provider=String(value.provider??'').trim().toLowerCase();
  const model=String(value.model??'').trim();
  const kind=String(value.kind??'').trim();
  const currency=String(value.currency??'').trim().toUpperCase();
  const effectiveFrom=new Date(value.effectiveFrom);
  const items=Array.isArray(value.items)?value.items:[];
  if(!provider||!model)throw error('INVALID_PRICE_VERSION','Provider and model are required');
  if(!['transcribe','summarize'].includes(kind))throw error('INVALID_PRICE_VERSION','Kind must be transcribe or summarize');
  if(!/^[A-Z]{3}$/.test(currency))throw error('INVALID_PRICE_VERSION','Currency must be a three-letter ISO-style code');
  if(Number.isNaN(effectiveFrom.getTime()))throw error('INVALID_PRICE_VERSION','effectiveFrom must be a valid timestamp');
  if(!items.length)throw error('INVALID_PRICE_VERSION','At least one price item is required');
  const seenMetrics=new Set(),seenPaths=new Set();
  const normalizedItems=items.map((item)=>{
    const metricName=String(item.metricName??'').trim();
    const usagePath=String(item.usagePath??'').trim();
    const unitQuantity=Number(item.unitQuantity);
    const unitPrice=Number(item.unitPrice);
    if(!METRIC_NAME.test(metricName))throw error('INVALID_PRICE_ITEM',`Invalid metric name: ${metricName||'(empty)'}`);
    if(!PRICE_PATH.test(usagePath))throw error('INVALID_PRICE_ITEM',`Invalid usage path: ${usagePath||'(empty)'}`);
    if(!Number.isFinite(unitQuantity)||unitQuantity<=0)throw error('INVALID_PRICE_ITEM','unitQuantity must be greater than zero');
    if(!Number.isFinite(unitPrice)||unitPrice<0)throw error('INVALID_PRICE_ITEM','unitPrice cannot be negative');
    if(seenMetrics.has(metricName)||seenPaths.has(usagePath))throw error('INVALID_PRICE_ITEM','Metric names and usage paths must be unique within a price version');
    seenMetrics.add(metricName);seenPaths.add(usagePath);
    return{metricName,usagePath,unitQuantity,unitPrice};
  });
  return{
    provider,model,kind,currency,effectiveFrom:effectiveFrom.toISOString(),
    sourceRef:value.sourceRef?String(value.sourceRef).trim().slice(0,1000):null,
    note:value.note?String(value.note).trim().slice(0,2000):null,
    items:normalizedItems,
  };
}

function priceCallMemory(call,versions){
  const matches=versions.filter((version)=>version.provider===call.provider&&version.model===call.model&&version.kind===call.kind&&Date.parse(version.effectiveFrom)<=Date.parse(call.startedAt))
    .sort((a,b)=>Date.parse(b.effectiveFrom)-Date.parse(a.effectiveFrom)||String(b.createdAt).localeCompare(String(a.createdAt)));
  const version=matches[0]??null;
  if(!version)return{...call,pricing:{priced:false,reason:'no_price_version',priceVersionId:null,currency:null,amount:null,matchedMetrics:0,components:[]}};
  let total='0',matched=0;
  const components=version.items.map((item)=>{
    const quantity=nestedNumber(call.usage,item.usagePath);
    const amount=quantity==null?'0':decimalCost(quantity,item.unitQuantity,item.unitPrice);
    if(quantity!=null)matched++;
    total=addDecimalStrings(total,amount);
    return{metricName:item.metricName,usagePath:item.usagePath,quantity,unitQuantity:item.unitQuantity,unitPrice:item.unitPrice,amount};
  });
  return{...call,pricing:{priced:matched>0,reason:matched>0?null:'usage_schema_mismatch',priceVersionId:version.id,currency:version.currency,amount:matched>0?total:null,matchedMetrics:matched,components}};
}

function rollupPricedCalls(calls){
  const currencyMap=new Map(),providerMap=new Map();
  let pricedCalls=0,unpricedCalls=0;
  for(const call of calls){
    if(call.pricing?.priced){
      pricedCalls++;
      const currency=call.pricing.currency;
      currencyMap.set(currency,addDecimalStrings(currencyMap.get(currency)??'0',call.pricing.amount??'0'));
      const key=`${call.provider}\u0000${call.model}\u0000${call.kind}\u0000${currency}`;
      const current=providerMap.get(key)??{provider:call.provider,model:call.model,kind:call.kind,currency,amount:'0',calls:0};
      current.amount=addDecimalStrings(current.amount,call.pricing.amount??'0');current.calls++;providerMap.set(key,current);
    }else unpricedCalls++;
  }
  return{
    pricedCalls,unpricedCalls,totalCalls:calls.length,
    currencies:[...currencyMap].map(([currency,amount])=>({currency,amount})),
    providers:[...providerMap.values()],
  };
}

export class MemoryMeetingOperationsRepository{
  constructor(meeting){this.meeting=meeting;this.priceVersions=[];this.audit=[]}

  async createPriceVersion(session,value){
    const input=normalizePriceInput(value);
    if(this.priceVersions.some((version)=>version.workspaceId===session.workspaceId&&version.provider===input.provider&&version.model===input.model&&version.kind===input.kind&&version.effectiveFrom===input.effectiveFrom)){
      throw error('PRICE_VERSION_EXISTS','A price version already exists for this effective timestamp',409);
    }
    const row={id:randomUUID(),organizationId:session.organizationId,workspaceId:session.workspaceId,createdBy:session.userId,createdAt:now(),...input};
    this.priceVersions.push(row);
    this.audit.push({id:randomUUID(),workspaceId:session.workspaceId,aggregateType:'meeting_price_version',aggregateId:row.id,eventType:'meeting.price_version.created',actorId:session.userId,sequence:1,payload:{provider:row.provider,model:row.model,kind:row.kind,currency:row.currency,effectiveFrom:row.effectiveFrom},createdAt:now()});
    return clone(row);
  }

  async listPriceVersions(session){return clone(this.priceVersions.filter((value)=>value.workspaceId===session.workspaceId).sort((a,b)=>Date.parse(b.effectiveFrom)-Date.parse(a.effectiveFrom)))}

  async costReport(session,{from=null,to=null,limit=200}={}){
    const start=from?Date.parse(from):-Infinity,end=to?Date.parse(to):Infinity;
    const providerCalls=[...(this.meeting.providerCalls?.values?.()??[])].filter((call)=>call.workspaceId===session.workspaceId&&call.status==='succeeded'&&Date.parse(call.startedAt)>=start&&Date.parse(call.startedAt)<=end)
      .sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)).slice(0,boundedLimit(limit,200,1000))
      .map(({providerRequestId,inputMetadata,...call})=>call);
    const priced=providerCalls.map((call)=>priceCallMemory(call,this.priceVersions.filter((version)=>version.workspaceId===session.workspaceId)));
    return{period:{from:from??null,to:to??null},rollup:rollupPricedCalls(priced),calls:priced};
  }

  async listJobs(session,{statuses=['failed','dead_letter'],limit=50}={}){
    const allowed=new Set(statuses);
    const jobs=[...(this.meeting.jobs?.values?.()??[])].filter((job)=>job.workspaceId===session.workspaceId&&allowed.has(job.status))
      .sort((a,b)=>String(b.updatedAt??b.createdAt).localeCompare(String(a.updatedAt??a.createdAt))).slice(0,boundedLimit(limit));
    return clone(jobs.map((job)=>{
      const run=this.meeting.runs?.get?.(job.runId);
      return{id:job.id,runId:job.runId,callId:run?.callId??null,recordingId:run?.recordingId??null,kind:job.kind,status:job.status,attempts:job.attempts,maxAttempts:job.maxAttempts,availableAt:job.availableAt,lastError:job.lastError??null,updatedAt:job.updatedAt??job.createdAt};
    }));
  }

  async retryJob(session,jobId,{reason,extraAttempts=1}={}){
    const text=String(reason??'').trim();if(!text)throw error('RETRY_REASON_REQUIRED','Retry reason is required');
    const job=this.meeting.jobs?.get?.(jobId);
    if(!job||job.workspaceId!==session.workspaceId)throw error('NOT_FOUND','Meeting processing job not found',404);
    if(!['failed','dead_letter'].includes(job.status))throw error('JOB_NOT_RETRYABLE','Only failed or dead-letter jobs can be retried',409);
    const previous={status:job.status,attempts:job.attempts,maxAttempts:job.maxAttempts,lastError:job.lastError??null};
    const extra=Math.min(3,Math.max(1,Math.round(Number(extraAttempts)||1)));
    if(job.status==='dead_letter'||job.attempts>=job.maxAttempts)job.maxAttempts+=extra;
    job.status='pending';job.availableAt=now();job.finishedAt=null;job.lockedAt=null;job.lockToken=null;job.updatedAt=now();
    const run=this.meeting.runs?.get?.(job.runId);if(run){run.status='queued';run.errorCode=null;run.errorMessage=null;run.updatedAt=now()}
    const recording=[...(this.meeting.recordings?.values?.()??[])].find((value)=>value.id===run?.recordingId);
    if(recording){if(job.kind==='transcribe')recording.transcriptStatus='queued';else recording.summaryStatus='queued'}
    const prior=this.audit.filter((item)=>item.workspaceId===session.workspaceId&&item.aggregateType==='meeting_job'&&item.aggregateId===job.id);
    const sequence=prior.reduce((max,item)=>Math.max(max,Number(item.sequence)||0),0)+1;
    this.audit.push({id:randomUUID(),workspaceId:session.workspaceId,aggregateType:'meeting_job',aggregateId:job.id,eventType:'meeting.job.retried',actorId:session.userId,sequence,payload:{reason:text.slice(0,1000),previous,extraAttempts:extra},createdAt:now()});
    return clone({id:job.id,runId:job.runId,kind:job.kind,status:job.status,attempts:job.attempts,maxAttempts:job.maxAttempts,availableAt:job.availableAt,lastError:job.lastError??null});
  }

  async jobAudit(session,jobId,limit=50){
    return clone(this.audit.filter((item)=>item.workspaceId===session.workspaceId&&item.aggregateType==='meeting_job'&&item.aggregateId===jobId)
      .sort((a,b)=>(Number(b.sequence)||0)-(Number(a.sequence)||0)).slice(0,boundedLimit(limit)));
  }
}

export class PostgresMeetingOperationsRepository{
  constructor(pool){this.pool=pool}
  async tx(fn){const client=await this.pool.connect();try{await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value}catch(err){try{await client.query('ROLLBACK')}catch{}throw err}finally{client.release()}}

  async createPriceVersion(session,value){
    const input=normalizePriceInput(value);
    return this.tx(async(client)=>{
      const lockKey=`meeting-price:${session.workspaceId}:${input.provider}:${input.model}:${input.kind}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[lockKey]);
      const duplicate=await client.query(`SELECT 1 FROM meeting_price_versions WHERE workspace_id=$1 AND provider=$2 AND model=$3 AND kind=$4 AND effective_from=$5`,[session.workspaceId,input.provider,input.model,input.kind,input.effectiveFrom]);
      if(duplicate.rowCount)throw error('PRICE_VERSION_EXISTS','A price version already exists for this effective timestamp',409);
      const id=randomUUID();
      const version=(await client.query(`INSERT INTO meeting_price_versions(
        id,organization_id,workspace_id,provider,model,kind,currency,effective_from,source_ref,note,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id,provider,model,kind,currency,effective_from "effectiveFrom",source_ref "sourceRef",note,created_by "createdBy",created_at "createdAt"`,
      [id,session.organizationId,session.workspaceId,input.provider,input.model,input.kind,input.currency,input.effectiveFrom,input.sourceRef,input.note,session.userId])).rows[0];
      const items=[];
      for(const item of input.items){
        items.push((await client.query(`INSERT INTO meeting_price_items(
          organization_id,workspace_id,price_version_id,metric_name,usage_path,unit_quantity,unit_price)
          VALUES($1,$2,$3,$4,$5,$6,$7)
          RETURNING metric_name "metricName",usage_path "usagePath",unit_quantity::text "unitQuantity",unit_price::text "unitPrice"`,
        [session.organizationId,session.workspaceId,id,item.metricName,item.usagePath,item.unitQuantity,item.unitPrice])).rows[0]);
      }
      await client.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
        VALUES($1,$2,'meeting_price_version',$3,'meeting.price_version.created',$4,$5)`,
      [session.organizationId,session.workspaceId,id,session.userId,{provider:input.provider,model:input.model,kind:input.kind,currency:input.currency,effectiveFrom:input.effectiveFrom,itemCount:items.length}]);
      return{...version,items};
    });
  }

  async listPriceVersions(session){
    const {rows}=await this.pool.query(`SELECT v.id,v.provider,v.model,v.kind,v.currency,v.effective_from "effectiveFrom",v.source_ref "sourceRef",v.note,
      v.created_by "createdBy",v.created_at "createdAt",
      COALESCE(jsonb_agg(jsonb_build_object('metricName',i.metric_name,'usagePath',i.usage_path,'unitQuantity',i.unit_quantity::text,'unitPrice',i.unit_price::text)
        ORDER BY i.metric_name) FILTER(WHERE i.metric_name IS NOT NULL),'[]'::jsonb) items
      FROM meeting_price_versions v LEFT JOIN meeting_price_items i ON i.workspace_id=v.workspace_id AND i.price_version_id=v.id
      WHERE v.workspace_id=$1 GROUP BY v.id ORDER BY v.effective_from DESC,v.created_at DESC`,[session.workspaceId]);
    return rows;
  }

  async costReport(session,{from=null,to=null,limit=200}={}){
    const max=boundedLimit(limit,200,1000);
    const {rows}=await this.pool.query(`WITH calls AS (
        SELECT pc.id,pc.kind,pc.provider,pc.model,pc.status,pc.usage,pc.started_at,pc.finished_at,pc.latency_ms
        FROM meeting_provider_calls pc
        WHERE pc.workspace_id=$1 AND pc.status='succeeded'
          AND ($2::timestamptz IS NULL OR pc.started_at >= $2::timestamptz)
          AND ($3::timestamptz IS NULL OR pc.started_at <= $3::timestamptz)
        ORDER BY pc.started_at DESC,pc.id DESC LIMIT $4
      )
      SELECT c.id,c.kind,c.provider,c.model,c.status,c.usage,c.started_at "startedAt",c.finished_at "finishedAt",c.latency_ms "latencyMs",
        v.id "priceVersionId",v.currency,v.effective_from "priceEffectiveFrom",
        i.metric_name "metricName",i.usage_path "usagePath",i.unit_quantity::text "unitQuantity",i.unit_price::text "unitPrice",
        CASE WHEN (c.usage #>> string_to_array(i.usage_path,'.')) ~ '^-?[0-9]+([.][0-9]+)?$'
          THEN (c.usage #>> string_to_array(i.usage_path,'.'))::numeric ELSE NULL END AS quantity,
        CASE WHEN (c.usage #>> string_to_array(i.usage_path,'.')) ~ '^-?[0-9]+([.][0-9]+)?$'
          THEN (((c.usage #>> string_to_array(i.usage_path,'.'))::numeric / i.unit_quantity) * i.unit_price)::text ELSE '0' END AS amount
      FROM calls c
      LEFT JOIN LATERAL (
        SELECT pv.* FROM meeting_price_versions pv
        WHERE pv.workspace_id=$1 AND pv.provider=c.provider AND pv.model=c.model AND pv.kind=c.kind AND pv.effective_from<=c.started_at
        ORDER BY pv.effective_from DESC,pv.created_at DESC LIMIT 1
      ) v ON true
      LEFT JOIN meeting_price_items i ON i.workspace_id=$1 AND i.price_version_id=v.id
      ORDER BY c.started_at DESC,c.id,i.metric_name`,[session.workspaceId,from,to,max]);

    const byCall=new Map();
    for(const row of rows){
      let call=byCall.get(row.id);
      if(!call){
        call={id:row.id,kind:row.kind,provider:row.provider,model:row.model,status:row.status,usage:row.usage,startedAt:row.startedAt,finishedAt:row.finishedAt,latencyMs:Number(row.latencyMs??0),pricing:{priced:false,reason:row.priceVersionId?null:'no_price_version',priceVersionId:row.priceVersionId??null,currency:row.currency??null,amount:null,matchedMetrics:0,components:[]}};
        byCall.set(row.id,call);
      }
      if(row.metricName){
        const quantity=row.quantity==null?null:Number(row.quantity);
        if(quantity!=null)call.pricing.matchedMetrics++;
        call.pricing.components.push({metricName:row.metricName,usagePath:row.usagePath,quantity,unitQuantity:row.unitQuantity,unitPrice:row.unitPrice,amount:row.amount});
        call._amount=addDecimalStrings(call._amount??'0',row.amount??'0');
      }
    }
    const calls=[...byCall.values()].map((call)=>{
      if(call.pricing.priceVersionId&&call.pricing.matchedMetrics>0){call.pricing.priced=true;call.pricing.reason=null;call.pricing.amount=call._amount??'0'}
      else if(call.pricing.priceVersionId){call.pricing.reason='usage_schema_mismatch'}
      delete call._amount;return call;
    });
    return{period:{from:from??null,to:to??null},rollup:rollupPricedCalls(calls),calls};
  }

  async listJobs(session,{statuses=['failed','dead_letter'],limit=50}={}){
    const allowed=[...new Set(statuses)].filter((value)=>['pending','processing','failed','dead_letter','succeeded'].includes(value));
    if(!allowed.length)return[];
    const {rows}=await this.pool.query(`SELECT j.id,j.run_id "runId",r.call_id "callId",r.recording_id "recordingId",j.kind,j.status,j.attempts,
      j.max_attempts "maxAttempts",j.available_at "availableAt",j.last_error "lastError",j.created_at "createdAt",j.updated_at "updatedAt",
      r.status "runStatus",r.error_code "runErrorCode"
      FROM meeting_intelligence_jobs j JOIN meeting_intelligence_runs r ON r.workspace_id=j.workspace_id AND r.id=j.run_id
      WHERE j.workspace_id=$1 AND j.status=ANY($2::text[]) ORDER BY j.updated_at DESC,j.id DESC LIMIT $3`,
    [session.workspaceId,allowed,boundedLimit(limit)]);
    return rows;
  }

  async retryJob(session,jobId,{reason,extraAttempts=1}={}){
    const text=String(reason??'').trim();if(!text)throw error('RETRY_REASON_REQUIRED','Retry reason is required');
    const extra=Math.min(3,Math.max(1,Math.round(Number(extraAttempts)||1)));
    return this.tx(async(client)=>{
      const current=(await client.query(`SELECT j.*,r.call_id,r.recording_id,r.status run_status
        FROM meeting_intelligence_jobs j JOIN meeting_intelligence_runs r ON r.workspace_id=j.workspace_id AND r.id=j.run_id
        WHERE j.workspace_id=$1 AND j.id=$2 FOR UPDATE OF j,r`,[session.workspaceId,jobId])).rows[0];
      if(!current)throw error('NOT_FOUND','Meeting processing job not found',404);
      if(!['failed','dead_letter'].includes(current.status))throw error('JOB_NOT_RETRYABLE','Only failed or dead-letter jobs can be retried',409);
      if(['review_ready','cancelled'].includes(current.run_status))throw error('JOB_NOT_RETRYABLE','Completed or cancelled meeting runs cannot be retried',409);
      const previous={status:current.status,attempts:current.attempts,maxAttempts:current.max_attempts,lastError:current.last_error};
      const extend=current.status==='dead_letter'||current.attempts>=current.max_attempts;
      const job=(await client.query(`UPDATE meeting_intelligence_jobs SET status='pending',available_at=now(),finished_at=NULL,locked_at=NULL,lock_token=NULL,
        max_attempts=CASE WHEN $3 THEN max_attempts+$4 ELSE max_attempts END,updated_at=now()
        WHERE workspace_id=$1 AND id=$2
        RETURNING id,run_id "runId",kind,status,attempts,max_attempts "maxAttempts",available_at "availableAt",last_error "lastError",updated_at "updatedAt"`,
      [session.workspaceId,jobId,extend,extra])).rows[0];
      await client.query(`UPDATE meeting_intelligence_runs SET status='queued',error_code=NULL,error_message=NULL,updated_at=now()
        WHERE workspace_id=$1 AND id=$2`,[session.workspaceId,current.run_id]);
      if(current.kind==='transcribe')await client.query(`UPDATE call_recordings SET transcript_status='queued',updated_at=now() WHERE workspace_id=$1 AND id=$2`,[session.workspaceId,current.recording_id]);
      else await client.query(`UPDATE call_recordings SET summary_status='queued',updated_at=now() WHERE workspace_id=$1 AND id=$2`,[session.workspaceId,current.recording_id]);
      const payload={reason:text.slice(0,1000),previous,extraAttempts:extend?extra:0,kind:current.kind,runId:current.run_id,callId:current.call_id};
      const sequence=Number((await client.query(`SELECT COALESCE(max(sequence),0)+1 AS next_sequence FROM audit_events
        WHERE workspace_id=$1 AND aggregate_type='meeting_job' AND aggregate_id=$2`,[session.workspaceId,jobId])).rows[0].next_sequence);
      await client.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,sequence,payload)
        VALUES($1,$2,'meeting_job',$3,'meeting.job.retried',$4,$5,$6)`,[session.organizationId,session.workspaceId,jobId,session.userId,sequence,payload]);
      await client.query(`INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload)
        VALUES($1,$2,'meeting.job.retried',$3,$4)`,[session.organizationId,session.workspaceId,jobId,payload]);
      return job;
    });
  }

  async jobAudit(session,jobId,limit=50){
    const {rows}=await this.pool.query(`SELECT id,event_type "eventType",actor_id "actorId",payload,created_at "createdAt",sequence
      FROM audit_events WHERE workspace_id=$1 AND aggregate_type='meeting_job' AND aggregate_id=$2
      ORDER BY sequence DESC LIMIT $3`,[session.workspaceId,jobId,boundedLimit(limit)]);
    return rows;
  }
}

export function createMeetingOperationsRepository(meeting,pool=null){return pool?new PostgresMeetingOperationsRepository(pool):new MemoryMeetingOperationsRepository(meeting)}
