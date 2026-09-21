// Run sequentially; never overlap benchmark runs with builds or other browsers.
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
const out=resolve('artifacts/card-battle-performance-optimization');
const mediaDir=process.env.AUDIT_MEDIA_DIR??resolve(out,'media');
const resultPath=resolve(out,process.env.AUDIT_OUTPUT??'results.json');
mkdirSync(out,{recursive:true});
const sources={
 stress:readFileSync('apps/web/tests/cardBattleFxBudget.browser.mjs','utf8').match(/contents:`([\s\S]*?)`},bundle/)[1],
 live:readFileSync('apps/web/tests/fixtures/cardBattleLive.fixture.tsx','utf8').split('const panel=')[0]
 .replace("motionMp4Url:","motionMp4Url:")
 .replace("imageUrl:picture(prefix==='enemy'?'#383751':'#16506b'),","imageUrl:picture(prefix==='enemy'?'#383751':'#16506b'),motionMp4Url:window.fixtureMotion??null,motionWebmUrl:window.fixtureWebm??null,")
 .replace('events:[1,2,3,4].map','events:Array.from({length:100},(_,i)=>i+1).map')
};
sources.stress=sources.stress.replace('motionWebmUrl:window.fixtureMotion??null','motionWebmUrl:window.fixtureWebm??null');
function readSource(path) { return process.env.AUDIT_BASELINE ? execFileSync('git',['show',(process.env.AUDIT_BASELINE==='1'?'HEAD':process.env.AUDIT_BASELINE)+':'+path.replaceAll('\\','/').replace(resolve('.').replaceAll('\\','/')+'/','')],{encoding:'utf8',stdio:['ignore','pipe','ignore']}) : readFileSync(path,'utf8'); }
const bundles={};
for(const [kind,source] of Object.entries(sources)) {
 const result=await build({stdin:{resolveDir:resolve(kind==='live'?'apps/web/tests/fixtures':'apps/web'),loader:'tsx',contents:source},bundle:true,write:false,format:'iife',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'instrument',setup(b){
 b.onLoad({filter:/[/\\]context[/\\]AppContext.tsx$/},()=>({contents:'export const useApp=()=>({user:{id:"u1"},loadingUser:false,showToast:()=>{},openAuth:()=>{}});',loader:'tsx'}));
 b.onLoad({filter:/CardBattleRoomView\.tsx$/},args=>({contents:readSource(args.path).replace('const rootRef = useRef<HTMLElement | null>(null);','window.__audit.renders++; const rootRef = useRef<HTMLElement | null>(null);'),loader:'tsx'}));
 b.onLoad({filter:/(CardBattleArenaFx|CardBattleBossReplay|CardBattleFxContext|CardTowerRoomPage)\.tsx$/},args=>({contents:readSource(args.path),loader:'tsx'}));
 b.onLoad({filter:/cardBattlePlayback\.ts$/},args=>({contents:readFileSync(args.path,'utf8').replace('for (const animation of root.getAnimations({ subtree: true })) {','window.__audit.seeks++; for (const animation of root.getAnimations({ subtree: true })) { window.__audit.soughtAnimations++;'),loader:'ts'}));
 }}]});bundles[kind]=result.outputFiles[0].text;
}
const cssFile=readdirSync('apps/web/dist/assets').find(f=>/^index-.*\.css$/.test(f));
const css=readFileSync(resolve('apps/web/dist/assets',cssFile),'utf8')+'\n'+readFileSync('apps/web/src/cardBattleEffects.css','utf8');
const files=new Map();
for(const width of [270,1080])for(const ext of ['mp4','webm']) files.set(`/media/${width}.${ext}`,readFileSync(resolve(mediaDir,`${width}${ext==='webm'&&process.env.AUDIT_PROFILE0?'-p0':''}.${ext}`)));
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 let body,type;
 if(files.has(path)){body=files.get(path);type=path.endsWith('.mp4')?'video/mp4':'video/webm';}
 else if(path==='/style.css'){body=Buffer.from(css);type='text/css';}
 else if(path.startsWith('/card-battle-fx/')){try{body=readFileSync(resolve('apps/web/public'+path));type='image/webp';}catch{res.writeHead(404).end();return;}}
 else {body=Buffer.from('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div>');type='text/html';}
 const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/);
 if(range){const start=Number(range[1]),end=Math.min(Number(range[2]||body.length-1),body.length-1);res.writeHead(206,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${body.length}`,'Content-Length':end-start+1});res.end(body.subarray(start,end+1));}
 else{res.writeHead(200,{'Content-Type':type,'Content-Length':body.length,'Accept-Ranges':'bytes'});res.end(body);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.AUDIT_BROWSER==='chromium'?undefined:process.env.AUDIT_BROWSER??'msedge',headless:true,args:process.env.AUDIT_NO_OVERLAYS?['--disable-direct-composition-video-overlays']:[]});
const root=await browser.newBrowserCDPSession();
const gpu=await root.send('SystemInfo.getInfo').then(x=>({devices:x.gpu.devices,featureStatus:x.gpu.featureStatus,renderer:x.gpu.auxAttributes?.glRenderer})).catch(e=>({error:e.message}));
const cases=[
 {id:'blank',kind:'blank'},
 {id:'one-video',kind:'blank',width:270,codec:'h264'},
 {id:'two-videos',kind:'blank',width:270,codec:'h264',count:2},
 {id:'four-videos',kind:'blank',width:270,codec:'h264',count:4},
 {id:'eight-videos',kind:'blank',width:270,codec:'h264',count:8},
 {id:'fourteen-videos',kind:'blank',width:270,codec:'h264',count:14},
 {id:'fourteen-canvas',kind:'blank',width:270,codec:'h264',count:14,canvas:true},
 {id:'fourteen-dom-probe',kind:'blank',width:270,codec:'h264',count:14,probe:true},
 {id:'static-idle',idle:true},
 {id:'static-fx'},
 {id:'1080-vp9-fx',width:1080,codec:'vp9'},
 {id:'1080-vp9-economy',width:1080,codec:'vp9',quality:'economy'},
 {id:'1080-vp9-idle',width:1080,codec:'vp9',idle:true},
 {id:'1080-vp9-paused',width:1080,codec:'vp9',paused:true},
 {id:'270-vp9-fx',width:270,codec:'vp9'},
 {id:'1080-h264-fx',width:1080,codec:'h264'},
 {id:'270-h264-fx',width:270,codec:'h264'},
 {id:'live-static',kind:'live'},
 {id:'replay-static',kind:'live',mode:'replay'},
 {id:'replay-1080-vp9',kind:'live',mode:'replay',width:1080,codec:'vp9'},
 {id:'live-1080-vp9',kind:'live',width:1080,codec:'vp9'},
];
const wanted=(process.env.AUDIT_CASES??'live-static,replay-static,270-h264-fx,1080-h264-fx').split(',');
const results=[];
const report={baseline:process.env.AUDIT_BASELINE??null,createdAt:new Date().toISOString(),browser:await browser.version(),viewport:{width:390,height:844,dpr:3},gpu,notes:['Synthetic same-content clips; not actual user card media.','Desktop headless; not a physical Android acceptance.','Production React build. CSS from existing dist plus current FX stylesheet.','CPU throttle affects renderer and is not a simulation of Android video hardware.'],results};
try {
 for(let repeat=0;repeat<Number(process.env.AUDIT_REPEATS??2);repeat++) for(const c of (repeat%2?[...cases].reverse():cases).filter(c=>!wanted||wanted.includes(c.id))) {
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('LayerTree.enable');await cdp.send('Media.enable');
  const mediaProps=new Map();let layerPeak=0;
  cdp.on('LayerTree.layerTreeDidChange',e=>layerPeak=Math.max(layerPeak,e.layers?.length??0));
  cdp.on('Media.playerPropertiesChanged',e=>{const p=mediaProps.get(e.playerId)??{};for(const x of e.properties)p[x.name]=x.value;mediaProps.set(e.playerId,p);});
  await page.goto(base+'/?mode='+(c.mode??'normal'));
  await page.evaluate(c=>{window.__audit={renders:0,seeks:0,soughtAnimations:0};localStorage.setItem('hgt.battle.fx-quality.v1',c.quality??'standard');if(c.width){window.fixtureMotion=`/media/${c.width}.mp4`;window.fixtureWebm=c.codec==='vp9'?`/media/${c.width}.webm`:null;}},c);
  if(c.kind!=='blank')await page.addScriptTag({content:bundles[c.kind??'stress']});
  else if(c.width)await page.evaluate(c=>{for(let i=0;i<(c.count??1);i++){const v=document.createElement('video');v.src=window.fixtureMotion;v.muted=true;v.loop=true;v.autoplay=true;v.style.cssText='width:90px;display:inline-block';document.body.append(v);}},c);
  if(c.mode==='replay')await page.getByRole('button',{name:'播放',exact:true}).click();
  if(c.width)await page.waitForFunction(()=>document.querySelectorAll('video').length>0&&[...document.querySelectorAll('video')].every(v=>v.readyState>=2),null,{timeout:20000});
  if(c.canvas)await page.evaluate(()=>{const videos=[...document.querySelectorAll('video')];videos.forEach(v=>v.style.display='none');const canvas=document.createElement('canvas');canvas.width=1170;canvas.height=1512;canvas.style.cssText='width:390px;height:504px';document.body.append(canvas);const ctx=canvas.getContext('2d');function draw(){videos.forEach((v,i)=>ctx.drawImage(v,(i%4)*270,Math.floor(i/4)*378,270,378));requestAnimationFrame(draw);}requestAnimationFrame(draw);});
  if(c.probe)await page.evaluate(()=>{const d=document.createElement('div');d.style.cssText='position:fixed;width:1px;height:1px;top:0;left:0;background:red';document.body.append(d);function tick(t){d.style.transform=`translateX(${t%10}px)`;requestAnimationFrame(tick);}requestAnimationFrame(tick);});
  if(c.kind!=='blank'&&c.kind!=='live')await page.evaluate(c=>{const config={type:'damage_all',duration:1625,idle:c.idle??false};window.showFx(config);if(!c.idle)window.__eventTimer=setInterval(()=>window.showFx(config),1625);},c);
  if(c.paused)await page.evaluate(()=>{HTMLMediaElement.prototype.play=function(){return Promise.resolve();};document.querySelectorAll('video').forEach(v=>v.pause());});
  if(process.env.AUDIT_CPU)await cdp.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.AUDIT_CPU)});
  await page.waitForTimeout(Number(process.env.AUDIT_WARMUP??5000));
  const before=(await cdp.send('Performance.getMetrics')).metrics;
  const processesBefore=(await root.send('SystemInfo.getProcessInfo')).processInfo;
  const sample=await page.evaluate(async()=>{
   const videos=[...document.querySelectorAll('video')];const q0=videos.map(v=>v.getVideoPlaybackQuality());
   const audit0={...window.__audit},times=[],tasks=[];const obs=new PerformanceObserver(l=>tasks.push(...l.getEntries().map(e=>e.duration)));obs.observe({type:'longtask'});
   let last=performance.now(),start=last;await new Promise(resolve=>{function tick(now){times.push(now-last);last=now;if(now-start<6000)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});obs.disconnect();
   const wall=performance.now()-start;times.shift();times.sort((a,b)=>a-b);const q=videos.map((v,i)=>{const x=v.getVideoPlaybackQuality(),r=v.getBoundingClientRect();return {total:x.totalVideoFrames-q0[i].totalVideoFrames,dropped:x.droppedVideoFrames-q0[i].droppedVideoFrames,width:v.videoWidth,height:v.videoHeight,paused:v.paused,source:v.currentSrc.split('/').at(-1),visible:r.bottom>0&&r.top<innerHeight,ready:v.readyState};});
   return {wallMs:wall,rafHz:times.length/wall*1000,medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],p99Ms:times[Math.floor(times.length*.99)],over25ms:times.filter(t=>t>25).length,frameCount:times.length,longTasks:tasks.length,longTaskMs:tasks.reduce((a,b)=>a+b,0),videos:q,videoFrames:q.reduce((n,x)=>n+x.total,0),videoDropped:q.reduce((n,x)=>n+x.dropped,0),audit:Object.fromEntries(Object.entries(window.__audit).map(([k,v])=>[k,v-audit0[k]])),canvasVideos:videos.filter(v=>v.style.display==='none'&&v.closest('[data-battle-motion]')).length,nodes:document.querySelectorAll('*').length,animations:document.getAnimations().length};
  });
  const after=(await cdp.send('Performance.getMetrics')).metrics;const delta=n=>(after.find(m=>m.name===n)?.value??0)-(before.find(m=>m.name===n)?.value??0);
  const processCpuMs={};for(const p of (await root.send('SystemInfo.getProcessInfo')).processInfo){const previous=processesBefore.find(x=>x.id===p.id);if(previous)processCpuMs[p.type]=(processCpuMs[p.type]??0)+(p.cpuTime-previous.cpuTime)*1000;}
  const result={id:c.id,repeat,cpu:Number(process.env.AUDIT_CPU??1),...sample,taskMs:delta('TaskDuration')*1000,scriptMs:delta('ScriptDuration')*1000,layoutMs:delta('LayoutDuration')*1000,recalcMs:delta('RecalcStyleDuration')*1000,layoutCount:delta('LayoutCount'),layerPeak,mediaPlayers:[...mediaProps.values()].map(p=>Object.fromEntries(Object.entries(p).filter(([k])=>/decoder|codec|resolution|platform/i.test(k)))),errors};results.push(result);
  result.processCpuMs=processCpuMs;result.vp9Profile=process.env.AUDIT_PROFILE0?'0 yuv420p':'1 gbrp';
  result.disableWindowsVideoOverlays=Boolean(process.env.AUDIT_NO_OVERLAYS);
  writeFileSync(resultPath,JSON.stringify(report,null,2));console.log(JSON.stringify({id:result.id,repeat,cpu:result.cpu,hz:+result.rafHz.toFixed(1),p95:result.p95Ms,dropped:result.videoDropped,total:result.videoFrames,taskMs:Math.round(result.taskMs),seeks:result.audit.seeks,processCpuMs,errors}));await context.close();
 }
} finally {await browser.close();await new Promise(r=>server.close(r));}
