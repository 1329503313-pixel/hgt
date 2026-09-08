// Real HalfArena/BattleCard layout, without API/database access. Run after build:all.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
const bundle = await build({ stdin: { resolveDir: resolve("apps/web"), loader:"tsx", contents:`
  import React,{useState} from 'react';import{createRoot}from'react-dom/client';
  import{HalfArena}from'./src/components/CardBattleRoomView';
  const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#162b49"/><path d="M50 25 80 60 67 115 33 115 20 60Z" fill="#496583"/><path d="m50 36 18 32-18 32-18-32Z" fill="#9db4bd"/></svg>');
  const names=['星辉骑士','深海使者','烈焰法师','疾风游侠','生命祭司'];
  const makeSeat=(seat)=>({user:{nickname:seat===1?'我的阵容':'对方阵容'},ready:false,lineup:names.map((name,i)=>({slot:i+1,cardBack:seat===2,card:{id:seat+':'+i,name,starLevel:3,imageUrl:image,rarity:'epic',battleRole:'damage',combatPower:6543,stats:{maxHp:1000,energyRequired:30}}}))});
  const states=[1,2].flatMap(seat=>names.map((_,i)=>({seat,slot:i+1,instanceId:seat+':'+i,hp:1000,maxHp:1000,alive:true,energy:0,energyRequired:30,statuses:[{type:'attack_up',value:100,multiplier:1,remainingRounds:2},{type:'attack_up',value:100,multiplier:.5,remainingRounds:3}]})));
  function Harness(){const[playing,setPlaying]=useState(false);const[own,setOwn]=useState(makeSeat(1));
  return <div className="card-battle-room flex h-[100dvh] flex-col overflow-hidden bg-[#071426] text-white"><header className="flex min-h-14 shrink-0 items-center px-3 font-bold">卡牌对战 · 阵容预览</header><main className="relative min-h-0 flex-1 overflow-hidden"><div style={{paddingBottom:playing?68:124}} className={'card-battle-arena-scroll flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden '+(playing?'pb-[68px]':'pb-[124px]')}>
  <HalfArena seat={2} battleSeat={{...makeSeat(2),lineup:makeSeat(2).lineup.map(item=>({...item,cardBack:!playing}))}} states={states} activeEvent={null} showPower={!playing} isOwn={false} position="top" canSelect={false} onPick={()=>{}} onReorder={async()=>false}/>
  <div className="flex h-8 shrink-0 items-center justify-center border-y border-cyan-300/30 bg-slate-950/90 text-[10px] text-cyan-200">前排 2 张 · 后排 3 张</div>
  <HalfArena seat={1} battleSeat={own} states={states} activeEvent={null} showPower={!playing} isOwn={true} position="bottom" canSelect={!playing} onPick={slot=>{window.picked=slot;}} onReorder={async(a,b)=>{window.reordered=[a,b];setOwn(old=>({...old,lineup:old.lineup.map(item=>({...item,slot:item.slot===a?b:item.slot===b?a:item.slot}))}));return true;}}/>
  </div><footer style={{height:playing?68:124}} className="absolute inset-x-0 bottom-0 z-[80] bg-slate-950 p-2"><button className="min-h-11 w-full rounded-xl bg-emerald-500" onClick={()=>setPlaying(v=>!v)}>{playing?'返回准备':'准备 / 开始战斗'}</button>{!playing&&<div className="mt-2 min-h-11 rounded-xl bg-white/10 p-2 text-sm">聊天或发表情…</div>}</footer></main></div>}
  createRoot(document.getElementById('root')).render(<Harness/>);
`}, bundle:true,write:false,format:"iife",define:{"import.meta.env":"{}"} });
const css=readdirSync(resolve("apps/web/dist/assets")).find(file=>file.startsWith("index-")&&file.endsWith(".css"));
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM==='1'?undefined:'msedge',headless:true});
const output=mkdtempSync(resolve(tmpdir(),"hgt-battle-layout-"));
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.abort());
 await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
 await page.addStyleTag({content:readFileSync(resolve('apps/web/dist/assets',css),'utf8')});
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await expect(page.locator('.card-battle-card')).toHaveCount(10);
 for(const viewport of [{width:907,height:732},{width:375,height:812},{width:320,height:568},{width:1440,height:1000},{width:812,height:375}]){
  await page.setViewportSize(viewport);
  await expect.poll(()=>page.locator('.card-battle-half').first().evaluate(el=>el.style.getPropertyValue('--battle-card-width'))).not.toBe('');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const result=await page.evaluate(()=>{
   const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
   return {pageWidth:document.documentElement.scrollWidth,halves:[...document.querySelectorAll('.card-battle-half')].map(half=>({bounds:rect(half),cards:[...half.querySelectorAll('.card-battle-card')].map(rect),rows:[...half.querySelectorAll('[data-battle-row]')].map(row=>row.dataset.battleRow)}))};
  });
  assert.ok(result.pageWidth<=viewport.width);
  for(const half of result.halves){for(const card of half.cards){assert.ok(card.width>=48);assert.ok(card.left>=half.bounds.left&&card.right<=half.bounds.right);assert.ok(card.top>=half.bounds.top+23&&card.bottom<=half.bounds.bottom-3);assert.ok(Math.abs(card.height/card.width-1.4)<.04);} }
  assert.deepEqual(result.halves.map(half=>half.rows),[['rear','front'],['front','rear']]);
  if(viewport.width===907){assert.ok(result.halves[0].cards[0].width>=75);await page.screenshot({path:resolve(output,'desktop-preparing.png')});}
  if(viewport.width===375){assert.ok(result.halves[0].cards[0].width>=84);for(const half of result.halves)assert.ok(half.cards[0].top>=half.bounds.top+39);await page.screenshot({path:resolve(output,'mobile-preparing.png')});}
  if(viewport.height===375){
   const scroller=page.locator('.card-battle-arena-scroll');assert.ok(await scroller.evaluate(el=>el.scrollHeight>el.clientHeight));
   await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight;});
   const last=await page.locator('.card-battle-card').last().boundingBox();const footer=await page.locator('footer').boundingBox();assert.ok(last.y+last.height<=footer.y, JSON.stringify({last,footer,viewport}));
  }
 }
 await page.setViewportSize({width:907,height:732});
 await page.locator('.card-battle-arena-scroll').evaluate(el=>{el.scrollTop=0;});
 const first=page.locator('[data-card-battle-slot="1"]');await first.focus();await page.keyboard.press('Alt+ArrowRight');
 assert.deepEqual(await page.evaluate(()=>window.reordered),[1,2]);
 await first.click();assert.equal(await page.evaluate(()=>window.picked),1);
 await page.getByRole('button',{name:'准备 / 开始战斗'}).click();
 await expect(page.locator('.card-battle-status-rail')).toHaveCount(10);
 await expect(page.getByText('战力 6,543',{exact:true})).toHaveCount(0);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.screenshot({path:resolve(output,'desktop-playing.png')});
 assert.deepEqual(errors,[]);console.log('PASS: larger cards, 5 viewports, row order, no overlap, short-screen scroll, keyboard reorder, click, battle statuses. Screenshots: '+output);
}finally{await browser.close();}
