import { chromium } from 'playwright';
import { mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run=promisify(execFile);
const target=process.env.CHATX_CAPTURE_URL;
const kind=process.env.CHATX_CAPTURE_KIND;
const sha=process.env.CHATX_CAPTURE_SHA||process.env.GITHUB_SHA||'unverified';
if(!target)throw new Error('CHATX_CAPTURE_URL must identify a running application');
const parsed=new URL(target);
if(!['http:','https:'].includes(parsed.protocol))throw new Error('Capture URL must be HTTP(S)');
if(!['demo','live'].includes(kind))throw new Error('Capture kind must be demo or live');
const output=resolve(process.env.CHATX_CAPTURE_OUTPUT||'presentation-evidence');
await mkdir(output,{recursive:true});
const manifest={
  project:'CHATX',kind,
  environment:['127.0.0.1','localhost','::1'].includes(parsed.hostname)
    ?'isolated-local-running-app':'external-reviewed-deployment',
  source:parsed.origin+parsed.pathname, // deliberately exclude credentials and tokens
  sha,capturedAt:new Date().toISOString(),
  screenshots:[],videos:[],scenes:[],warnings:[],pageErrors:[],
  validation:{state:'running',expectedVideoSeconds:[20,30],requiredScreens:['home','chats','tasks','projects','project-overview','gantt','calendar','mobile-home','mobile-project-overview','mobile-gantt']},
  disclosures:['Demo data is synthetic. Screenshot is an actual browser capture, not a rendering.',
    'Git commit identifies source code; deployment SHA verification is separate.'],
};
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const browser=await chromium.launch({headless:true});
const pageErrors=[];
const listen=page=>{
  page.on('pageerror',error=>pageErrors.push(String(error)));
};
const screenshot=async(page,name,scene)=>{
  const content=await page.locator('#screen').innerText();
  if(content.trim().length<30)throw new Error('Screen is empty: '+scene);
  const file=name+'.png',path=join(output,file);
  await page.screenshot({path,animations:'disabled',fullPage:false});
  manifest.screenshots.push({file,scene,sha256:await hash(path),viewport:page.viewportSize()});
};
const waitScreen=async page=>{
  await page.locator('#app-view').waitFor({state:'visible',timeout:25000});
  await page.locator('#screen').waitFor({state:'visible',timeout:20000});
};
const nav=async(page,view)=>{
  const buttons=page.locator('[data-nav="'+view+'"]:visible');
  await buttons.first().waitFor({state:'visible',timeout:12000});
  await buttons.first().click();
  await page.waitForTimeout(600);
};
const linger=async(name,ms=3800)=>{
  manifest.scenes.push({scene:name,holdMs:ms});
  await new Promise(done=>setTimeout(done,ms));
};
try{
  // Authenticate in an unrecorded context. No credentials, tokens or cookies
  // are written to an evidence artifact.
  const auth=await browser.newContext({viewport:{width:1440,height:900}});
  const authPage=await auth.newPage();
  listen(authPage);
  const initial=await authPage.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  if(!initial?.ok())throw new Error('App HTTP '+initial?.status());
  if(kind==='demo'){
    await authPage.locator('#demo-login').waitFor({state:'visible',timeout:20000});
    await authPage.locator('#demo-login').click();
  }else if(await authPage.locator('#demo-login').isVisible()){
    throw new Error('Refusing to label demo login as live evidence');
  }
  await waitScreen(authPage);
  const inMemorySession=await auth.storageState();
  await auth.close();

  // Video starts after authentication, so no sign-in flow appears in media.
  const ctx=await browser.newContext({
    viewport:{width:1440,height:900},deviceScaleFactor:2,
    storageState:inMemorySession,
    recordVideo:{dir:join(output,'raw-video'),size:{width:1440,height:900}},
  });
  const page=await ctx.newPage();
  listen(page);
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await waitScreen(page);
  await page.waitForTimeout(650);
  await screenshot(page,'01-home-desktop','home');
  await linger('home');
  await nav(page,'chats');
  // Select a real demo room, rather than recording an empty chat pane.
  // The Chats screen's cards use data-conversation; data-open belongs
  // to the compact Today preview instead. Pick an active seeded channel.
  const conversations=page.locator('.conversation-card[data-conversation]:visible');
  await conversations.first().waitFor({state:'visible',timeout:12000});
  let room=conversations.filter({hasText:'Продукт'}).first();
  if(!await room.count())room=conversations.filter({hasText:'Операции'}).first();
  if(!await room.count())room=conversations.first();
  await room.click();
  await page.waitForTimeout(700);
  await screenshot(page,'02-chats-desktop','chats');
  await linger('chats');
  await nav(page,'tasks');
  await screenshot(page,'03-tasks-desktop','tasks');
  await linger('tasks');
  await nav(page,'projects');
  await page.locator('[data-project-open]').first().waitFor({state:'visible',timeout:18000});
  await screenshot(page,'04-projects-desktop','projects');
  await linger('projects');
  let project=page.locator('[data-project-open]').filter({hasText:'Mobile Launch'}).first();
  if(!await project.count())project=page.locator('[data-project-open]').first();
  const projectId=await project.getAttribute('data-project-open');
  if(!projectId)throw new Error('Project detail not addressable');
  await project.click();
  const gantt=page.locator('.project-roadmap-section .project-roadmap-scroll');
  await gantt.waitFor({state:'visible',timeout:18000});
  await screenshot(page,'04b-project-overview-desktop','project-overview');
  if(kind==='demo' && (await page.locator('.project-roadmap-task').count())<4)
    throw new Error('Demo Gantt missing scheduled canonical Tasks');
  // Project detail may rerender after asynchronous data refresh. Scroll the
  // latest DOM node atomically rather than waiting on a detached locator.
  await page.evaluate(() => {
    const section=document.querySelector('.project-roadmap-section');
    if(section){
      // Keep the Gantt heading and controls below the sticky desktop header.
      section.style.scrollMarginTop='110px';
      section.scrollIntoView({block:'start',behavior:'auto'});
    }
  });
  await page.waitForTimeout(350);
  await screenshot(page,'05-project-gantt-desktop','gantt');
  await linger('gantt',4100);
  await nav(page,'calendar');
  await screenshot(page,'06-calendar-desktop','calendar');
  await linger('calendar',3300);

  const video=page.video();
  await ctx.close();
  if(!video)throw new Error('Playwright did not generate a video');
  const raw=await video.path();
  const webm='chatx-session-source.webm';
  await copyFile(raw,join(output,webm));
  // Avoid uploading the same WebM twice: raw-video is only a capture scratch dir.
  await rm(join(output,'raw-video'),{recursive:true,force:true});
  manifest.videos.push({file:webm,role:'source',sha256:await hash(join(output,webm))});
  const mp4='chatx-product-tour-27s.mp4';
  await run('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',
    '-i',join(output,webm),'-t','27','-an','-c:v','libx264',
    '-preset','fast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',
    join(output,mp4)],{timeout:120000});
  const probe=await run('ffprobe',['-v','error','-show_entries','format=duration',
    '-of','default=noprint_wrappers=1:nokey=1',join(output,mp4)],{timeout:15000});
  const duration=Number(probe.stdout.trim());
  if(!Number.isFinite(duration)||duration<20||duration>30)
    throw new Error('Tour duration outside 20-30 seconds: '+duration);
  manifest.videos.push({file:mp4,role:'portfolio-ready',durationSeconds:duration,
    sha256:await hash(join(output,mp4))});

  // Fresh mobile context, reusing only in-memory demo authorization.
  const mobile=await browser.newContext({
    viewport:{width:390,height:844},deviceScaleFactor:2,
    isMobile:true,hasTouch:true,storageState:inMemorySession,
  });
  const mobilePage=await mobile.newPage();
  listen(mobilePage);
  await mobilePage.goto(target,{waitUntil:'domcontentloaded'});
  await waitScreen(mobilePage);
  await screenshot(mobilePage,'07-home-mobile','mobile-home');
  await mobilePage.goto(parsed.origin+'/#/projects/'+encodeURIComponent(projectId),
    {waitUntil:'domcontentloaded'});
  await waitScreen(mobilePage);
  const mobileGantt=mobilePage.locator('.project-roadmap-section .project-roadmap-scroll');
  await mobileGantt.waitFor({state:'visible',timeout:20000});
  await screenshot(mobilePage,'07b-project-overview-mobile','mobile-project-overview');
  await mobilePage.evaluate(() => {
    const section=document.querySelector('.project-roadmap-section');
    if(section){section.style.scrollMarginTop='100px';section.scrollIntoView({block:'start',behavior:'auto'});}
  });
  await mobilePage.waitForTimeout(350);
  await screenshot(mobilePage,'08-project-gantt-mobile','mobile-gantt');
  await mobile.close();
  manifest.pageErrors=pageErrors;
  if(pageErrors.length)manifest.warnings.push('Browser script errors recorded; reviewer must inspect before publishing');
  const names=new Set(manifest.screenshots.map(s=>s.scene));
  for(const name of manifest.validation.requiredScreens)
    if(!names.has(name))throw new Error('Required scene is missing: '+name);
  manifest.validation.state='captured-awaiting-human-review';
}catch(error){
  manifest.validation.state='failed';
  manifest.validation.error=String(error?.message||error);
  throw error;
}finally{
  await browser.close();
  await writeFile(join(output,'evidence-manifest.json'),JSON.stringify(manifest,null,2));
}
console.log(JSON.stringify({state:manifest.validation.state,sha,
  images:manifest.screenshots.length,videos:manifest.videos.length,
  warnings:manifest.warnings,pageErrors:manifest.pageErrors.length},null,2));
