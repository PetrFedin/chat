import { chromium } from 'playwright';
import { mkdir, copyFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const target=process.env.CHATX_CAPTURE_URL;
if(!target||!/^https?:\/\//.test(target))throw new Error('CHATX_CAPTURE_URL must be an explicitly verified deployment or isolated demo URL');
const kind=process.env.CHATX_CAPTURE_KIND;
if(!['demo','live'].includes(kind))throw new Error('CHATX_CAPTURE_KIND must be demo or live; never infer production');
const output=resolve(process.env.CHATX_CAPTURE_OUTPUT||'presentation-evidence');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const manifest={project:'CHATX',kind,source:target,sha:process.env.GITHUB_SHA||'unverified',capturedAt:new Date().toISOString(),screenshots:[],videos:[],warnings:[]};
const shot=async(page,label)=>{
  const filename=label+'.png';
  await page.screenshot({path:join(output,filename),fullPage:false,animations:'disabled'});
  manifest.screenshots.push(filename);
};
try{
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,recordVideo:{dir:join(output,'raw-video'),size:{width:1440,height:900}}});
  const page=await context.newPage();
  page.on('pageerror',e=>manifest.warnings.push(String(e)));
  const response=await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  if(!response?.ok())throw new Error('Capture URL HTTP status '+response?.status());
  const demo=page.locator('#demo-login');
  if(kind==='demo'){
    await demo.waitFor({state:'visible',timeout:15000});
    await demo.click();
    await page.locator('#app-view').waitFor({state:'visible',timeout:20000});
  }else{
    if(await demo.isVisible())throw new Error('Live capture landed on demo login; refusing to mislabel');
    if(!await page.locator('#app-view').isVisible())throw new Error('Live capture requires preauthenticated app viewport');
  }
  await shot(page,'01-dashboard-desktop');
  const scenes=[
    {name:'chats',selector:'[data-nav="chats"]'},
    {name:'tasks',selector:'[data-nav="tasks"]'},
    {name:'projects',selector:'[data-nav="projects"]'},
    {name:'calendar',selector:'[data-nav="calendar"]'},
  ];
  // Exactly five 5-second windows (25 seconds), recorded by browser video.
  for(let i=0;i<5;i++){
    if(i>0){
      const scene=scenes[i-1];
      const nav=page.locator(scene.selector+':visible').first();
      if(await nav.count()){await nav.click();await page.waitForTimeout(650);await shot(page,'0'+(i+1)+'-'+scene.name+'-desktop');}
      else manifest.warnings.push('Navigation not visible: '+scene.name);
    }
    await page.waitForTimeout(5000);
  }
  const video=page.video();
  await context.close();
  if(video){
    const videoPath=await video.path();
    await copyFile(videoPath,join(output,'chatx-walkthrough-25s.webm'));
    manifest.videos.push('chatx-walkthrough-25s.webm');
  }
  const mobile=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const mobilePage=await mobile.newPage();
  await mobilePage.goto(target,{waitUntil:'domcontentloaded'});
  if(kind==='demo'){await mobilePage.locator('#demo-login').click();await mobilePage.locator('#app-view').waitFor({state:'visible'});}
  await shot(mobilePage,'06-dashboard-mobile');
  await mobile.close();
}finally{await browser.close();}
await writeFile(join(output,'evidence-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({kind,sha:manifest.sha,images:manifest.screenshots.length,videos:manifest.videos.length,warnings:manifest.warnings},null,2));
