// Captures the *running* local CHATX product with clearly synthetic data.
// Never run this script against a real workspace or upload session state.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run=promisify(execFile);
const target=process.env.CHATX_CAPTURE_URL;
const sha=process.env.CHATX_CAPTURE_SHA;
const kind=process.env.CHATX_CAPTURE_KIND;
if(!target || !sha || kind!=='demo')throw new Error('Requires an exact SHA and explicitly synthetic demo capture');
const origin=new URL(target);
if(!['localhost','127.0.0.1','::1'].includes(origin.hostname))
  throw new Error('Refusing to capture or mutate external deployment data');
const output=resolve(process.env.CHATX_DECISION_CAPTURE_OUTPUT||'presentation-evidence/decision-execution');
await mkdir(output,{recursive:true});

const metadata={
  project:'CHATX',feature:'Decision Execution',environment:'isolated-local-demo',
  sha,source:origin.origin,generatedAt:new Date().toISOString(),
  disclaimer:'Synthetic demonstration data in a real running application, not customer outcomes',
  screenshots:[],videos:[],errors:[],state:'running',
};
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const wait=ms=>new Promise(done=>setTimeout(done,ms));
let browser=null;
try{
  browser=await chromium.launch({headless:true});
  const authContext=await browser.newContext({viewport:{width:1440,height:900}});
  const auth=await authContext.newPage();
  await auth.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await auth.locator('#demo-login').waitFor({state:'visible',timeout:25000});
  await auth.locator('#demo-login').click();
  await auth.locator('#app-view').waitFor({state:'visible'});
  const api=async(method,path,data)=>{
    const response=await auth.request.fetch(origin.origin+path,{
      method,...(data===undefined?{}:{data}),
    });
    if(!response.ok()){
      const payload=await response.json().catch(()=>null);
      throw new Error('Fixture API '+method+' '+path.split('?')[0]+' failed with '+response.status()+
        ' '+(payload?.error?.code||''));
    }
    return response.json();
  };

  // Use existing real demo Tasks. The fixture only creates a canonical
  // calendar meeting/accepted Decision and the audited Decision->Task link.
  const taskList=await api('GET','/api/v1/tasks?scope=all&limit=100');
  const tasks=taskList.items||[];
  const task=tasks.find(item=>/mobile|qa|релиз/i.test(item.title||''))||tasks[0];
  if(!task?.id)throw new Error('No canonical demo Task was seeded');
  const title='DEMO — решение о готовности мобильного релиза';
  const decisionPath='/api/v1/meetings/decisions?q='+encodeURIComponent(title);
  let decisions=(await api('GET',decisionPath)).items||[];
  if(!decisions.some(item=>item.title===title)){
    const now=Date.now();
    const made=await api('POST','/api/v1/calendar-events',{
      kind:'meeting',title:'DEMO — совет по выпуску релиза',
      startAt:new Date(now-3600000).toISOString(),
      endAt:new Date(now).toISOString(),
    });
    if(!made?.event?.id)throw new Error('Demo Calendar event not created');
    await api('PUT','/api/v1/calendar-events/'+made.event.id+'/notes',{
      title:'DEMO — протокол проверки релиза',decisions:[title],actionItems:[],
    });
    decisions=(await api('GET',decisionPath)).items||[];
  }
  const decision=decisions.find(item=>item.title===title);
  if(!decision?.id)throw new Error('Accepted demo Decision not visible');
  const linksPath='/api/v1/meetings/decisions/'+decision.id+'/tasks';
  const links=(await api('GET',linksPath)).items||[];
  if(!links.some(link=>link.id===task.id)){
    await api('POST',linksPath,{taskId:task.id,reason:'Synthetic demo: reviewed release obligation'});
  }
  const snapshot=await api('GET','/api/v1/meetings/decisions/execution?q='+encodeURIComponent(title));
  if(!snapshot.items?.some(item=>item.decision.id===decision.id&&item.execution.visibleCount>0))
    throw new Error('Demo Decision Execution projection not visible');
  const session=await authContext.storageState();
  await authContext.close();

  const errors=[];
  const openCockpit=async page=>{
    page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
    await page.locator('#app-view').waitFor({state:'visible'});
    await page.locator('[data-nav="more"]:visible').first().click();
    await page.locator('[data-action="decision-execution"]').click();
    await page.locator('[data-decision-cockpit-row="'+decision.id+'"]').waitFor({state:'visible',timeout:25000});
  };
  const saveImage=async(page,file,scene)=>{
    const filepath=join(output,file);
    await page.screenshot({path:filepath,animations:'disabled',fullPage:false});
    metadata.screenshots.push({file,scene,viewport:page.viewportSize(),sha256:await hash(filepath)});
  };

  for(const [width,height,label] of [[375,812,'mobile-375'],[768,1024,'tablet-768'],[1440,900,'desktop-1440']]){
    const ctx=await browser.newContext({
      viewport:{width,height},deviceScaleFactor:2,storageState:session,
      ...(width<500?{isMobile:true,hasTouch:true}:{}),
    });
    const page=await ctx.newPage();
    await openCockpit(page);
    await saveImage(page,'decision-cockpit-'+label+'.png','decision-cockpit-'+label);
    if(width===1440){
      await page.locator('[data-decision-cockpit-open="'+decision.id+'"]').click();
      await page.locator('[data-decision-task-open="'+task.id+'"]').waitFor({state:'visible'});
      await saveImage(page,'decision-detail-desktop-1440.png','decision-detail');
      await page.locator('[data-decision-task-open="'+task.id+'"]').click();
      await page.locator('#task-evidence-form').waitFor({state:'visible'});
      await saveImage(page,'decision-evidence-desktop-1440.png','task-evidence');
    }
    await ctx.close();
  }

  const ctx=await browser.newContext({
    viewport:{width:1440,height:900},deviceScaleFactor:1,storageState:session,
    recordVideo:{dir:join(output,'raw-video'),size:{width:1440,height:900}},
  });
  const page=await ctx.newPage();
  await openCockpit(page);
  await wait(6500);
  await page.locator('[data-decision-cockpit-open="'+decision.id+'"]').click();
  await page.locator('[data-decision-task-open="'+task.id+'"]').waitFor({state:'visible'});
  await wait(6500);
  await page.locator('[data-decision-task-open="'+task.id+'"]').click();
  await page.locator('#task-evidence-form').waitFor({state:'visible'});
  await wait(11000);
  const video=page.video();
  await ctx.close();
  if(!video)throw new Error('Playwright did not record decision workflow');
  const webm='decision-execution-source.webm',mp4='chatx-decision-execution-25s.mp4';
  await copyFile(await video.path(),join(output,webm));
  await rm(join(output,'raw-video'),{recursive:true,force:true});
  await run('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',
    '-i',join(output,webm),'-t','25','-an','-c:v','libx264','-preset','fast',
    '-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',join(output,mp4)],
    {timeout:120000});
  const probe=await run('ffprobe',['-v','error','-show_entries','format=duration',
    '-of','default=noprint_wrappers=1:nokey=1',join(output,mp4)],{timeout:15000});
  const duration=Number(probe.stdout.trim());
  if(!Number.isFinite(duration)||duration<20||duration>30)
    throw new Error('Decision video duration outside 20-30 seconds: '+duration);
  metadata.videos.push({file:webm,role:'raw-source',sha256:await hash(join(output,webm))});
  metadata.videos.push({file:mp4,role:'portfolio-ready',durationSeconds:duration,sha256:await hash(join(output,mp4))});
  metadata.errors=errors;
  if(errors.length)throw new Error('Browser errors must be reviewed before media admission');
  metadata.state='captured-awaiting-independent-review';
}catch(error){
  metadata.state='failed';
  metadata.error=String(error?.message||error);
  throw error;
}finally{
  await browser?.close();
  await writeFile(join(output,'decision-evidence-manifest.json'),JSON.stringify(metadata,null,2));
}
console.log(JSON.stringify({state:metadata.state,sha,screenshots:metadata.screenshots.length,
  videos:metadata.videos.length,errors:metadata.errors.length}));
