// Reproducible desktop proxy, not a substitute for physical Android profiling.
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import assert from 'node:assert/strict';
const out=resolve('artifacts/card-battle-fx');mkdirSync(out,{recursive:true});
const source=readFileSync('apps/web/tests/cardBattleFxBudget.browser.mjs','utf8').match(/contents:`([\s\S]*?)`},bundle/)[1];
const base=resolve('.local-backups/card-battle-fx-20260917');
const css=readdirSync('apps/web/dist/assets').find(f=>f.startsWith('index-')&&f.endsWith('.css'));
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM==='1'?undefined:'msedge',headless:true});
const results=[];
try{
 for(const mode of ['baseline','standard','economy']){
  if(mode==='baseline'&&!existsSync(resolve(base,'apps/web/src/components/CardBattleEffects.tsx')))continue;
  const bundled=await build({stdin:{resolveDir:resolve('apps/web'),loader:'tsx',contents:mode==='baseline'?source.replace('<CardBattleArenaFx event={event}/>',''):source},bundle:true,write:false,format:'iife',define:{'import.meta.env':'{}'},plugins:mode==='baseline'?[{name:'before',setup(b){b.onLoad({filter:/CardBattle(RoomView|Effects)\.tsx$/},args=>({loader:'tsx',resolveDir:dirname(args.path),contents:readFileSync(resolve(base,'apps/web/src/components',basename(args.path)),'utf8')}));}}]:[]});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.route('**/*',r=>{const path=new URL(r.request().url()).pathname;return path.startsWith('/card-battle-fx/')?r.fulfill({path:resolve('apps/web/public'+path),contentType:'image/webp'}):r.fulfill({body:'<div id="root"></div>',contentType:'text/html'});});
  await page.goto('http://battle.test/performance');
  await page.evaluate(async()=>{
   // The same tiny looping encoded video exercises fourteen media elements.
   const canvas=document.createElement('canvas');canvas.width=96;canvas.height=140;const ctx=canvas.getContext('2d');const stream=canvas.captureStream(20);const chunks=[];const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});const done=new Promise(resolve=>recorder.onstop=resolve);recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();
   for(let i=0;i<12;i++){ctx.fillStyle='#152c43';ctx.fillRect(0,0,96,140);ctx.fillStyle='#9fb6bd';ctx.beginPath();ctx.arc(48,65,20+i/4,0,Math.PI*2);ctx.fill();await new Promise(r=>setTimeout(r,50));}
   recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());window.fixtureMotion=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));
  });
  await page.addStyleTag({content:readFileSync(resolve('apps/web/dist/assets',css),'utf8')+'\n'+readFileSync(mode==='baseline'?resolve(base,'apps/web/src/styles.css'):'apps/web/src/cardBattleEffects.css','utf8')});
  await page.addScriptTag({content:bundled.outputFiles[0].text});await page.getByLabel('战斗特效质量').selectOption(mode==='economy'?'economy':'standard');
  await page.waitForFunction(()=>document.querySelectorAll('video').length===14&&[...document.querySelectorAll('video')].every(v=>v.readyState>=2),null,{timeout:10000}).catch(async e=>{console.log(mode,await page.evaluate(()=>({count:document.querySelectorAll('video').length,imgs:document.querySelectorAll('img').length,src:window.fixtureMotion,video:[...document.querySelectorAll('video')].map(v=>({ready:v.readyState,src:v.currentSrc,error:v.error?.message,rect:v.getBoundingClientRect().toJSON()}))})));throw e;});
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('LayerTree.enable');let layers=[];cdp.on('LayerTree.layerTreeDidChange',e=>{layers=e.layers??[];});
  const before=(await cdp.send('Performance.getMetrics')).metrics;
  const frame=await page.evaluate(async()=>{
   const media=document.querySelector('video'),times=[],tasks=[];const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask',buffered:false});
   window.showFx({type:'damage_all',duration:1000});const timer=setInterval(()=>window.showFx({type:'damage_all',duration:1000}),1000);
   let start=performance.now(),last=start;await new Promise(resolve=>{function tick(now){if(now-start>500)times.push(now-last);last=now;if(now-start<4500)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});clearInterval(timer);observer.disconnect();times.sort((a,b)=>a-b);
   return{medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],maxMs:Math.max(...times),longTasks:tasks.length,longTaskMs:tasks.reduce((a,b)=>a+b,0),mediaStable:media===document.querySelector('video'),playingVideos:[...document.querySelectorAll('video')].filter(v=>!v.paused).length,transientNodes:[...document.querySelectorAll('.card-battle-skill-fx,.card-battle-arena-fx')].reduce((n,e)=>n+1+e.querySelectorAll('*').length,0)};
  });assert.ok(frame.mediaStable);assert.equal(frame.playingVideos,14);
  const after=(await cdp.send('Performance.getMetrics')).metrics;const metric=name=>after.find(m=>m.name===name)?.value;const delta=name=>metric(name)-(before.find(m=>m.name===name)?.value??0);
  results.push({mode,scenario:'14 synthetic looping WebM cards / 9 targets',...frame,layoutCount:delta('LayoutCount'),recalcStyleCount:delta('RecalcStyleCount'),scriptMs:delta('ScriptDuration')*1000,taskMs:delta('TaskDuration')*1000,heapBytes:metric('JSHeapUsedSize'),compositingLayers:layers.length,drawsContentLayers:layers.filter(l=>l.drawsContent).length});
  if(mode==='standard'){
   const frames=[];await page.setViewportSize({width:390,height:844});
   for(const type of ['damage_all','revive_all_allies']){await page.evaluate(type=>window.showFx({type,duration:1800}),type);for(let i=0;i<18;i++){frames.push((await page.screenshot()).toString('base64'));await new Promise(r=>setTimeout(r,70));}}
   const webm=await page.evaluate(async frames=>{const canvas=document.createElement('canvas');canvas.width=390;canvas.height=844;const ctx=canvas.getContext('2d'),stream=canvas.captureStream(10),chunks=[];const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});const done=new Promise(r=>recorder.onstop=r);recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();for(const frame of frames){const image=new Image();image.src='data:image/png;base64,'+frame;await image.decode();ctx.drawImage(image,0,0);await new Promise(r=>setTimeout(r,100));}recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));},frames);writeFileSync(resolve(out,'battle-demo.webm'),Buffer.from(webm));
  }
  // Release the battle subtree repeatedly and compare post-GC heap, not raw growth.
  const heap=[],listeners=[];for(let i=0;i<20;i++){await page.evaluate(()=>window.mountFx(false));await page.waitForFunction(()=>!document.querySelector('.card-battle-card'));await cdp.send('HeapProfiler.collectGarbage');if(i===0||i===19){heap.push((await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize').value);listeners.push((await cdp.send('Runtime.evaluate',{expression:'[window,document].map(target=>Object.fromEntries(Object.entries(getEventListeners(target)).map(([key,value])=>[key,value.length])))',includeCommandLineAPI:true,returnByValue:true})).result.value);}await page.evaluate(()=>window.mountFx(true));await page.waitForFunction(()=>document.querySelectorAll('.card-battle-card').length===14);}results.at(-1).postGcUnmountHeap=heap;results.at(-1).postUnmountListeners=listeners;assert.deepEqual(listeners[0],listeners[1]);assert.ok(heap[1]-heap[0]<1024*1024,"bounded post-GC heap");
  await page.close();console.log('Profiled '+mode);
 }
 writeFileSync(resolve(out,'performance.json'),JSON.stringify({browser:await browser.version(),viewport:'1440x1000',note:'Desktop headless proxy; synthetic 96x140 video. Layer count and RGBA estimates are not GPU memory measurements. Not Android hardware acceptance.',results},null,2));
}finally{await browser.close();}
