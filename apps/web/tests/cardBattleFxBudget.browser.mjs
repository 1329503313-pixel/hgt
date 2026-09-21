// Deterministic real-component fixture: fourteen cards, nine actual targets.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
const output = resolve('artifacts/card-battle-fx'); mkdirSync(output,{recursive:true});
const css = readdirSync('apps/web/dist/assets').find(f=>f.startsWith('index-')&&f.endsWith('.css'));
const bundle = await build({stdin:{resolveDir:resolve('apps/web'),loader:'tsx',contents:`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{BattleCard}from'./src/components/CardBattleRoomView';
import{CardBattleFxProvider,CardBattleFxQualityControl}from'./src/components/CardBattleFxContext';
import{CardBattleArenaFx}from'./src/components/CardBattleArenaFx';
import{CARD_BATTLE_MOTIONS}from'./src/shared/cardBattleMotion';
import{BOND_FX_FAMILIES}from'./src/shared/cardBattleFx';
import{seekCardBattleAnimations}from'./src/shared/cardBattlePlayback';
const art='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#2d455a"/><stop offset="1" stop-color="#0a1525"/></linearGradient></defs><rect width="200" height="280" rx="12" fill="url(#g)"/><path d="M100 38 156 80 140 196 100 230 60 196 44 80Z" fill="#a8b5ba" opacity=".18"/><path d="M100 60 130 100 110 162 90 162 70 100Z" fill="#d7bd86" opacity=".45"/><path d="M60 210 100 170 140 210" fill="none" stroke="#d7bd86" opacity=".5"/></svg>');
const cards=Array.from({length:14},(_,i)=>({id:'card'+i,name:i<5?'深海守卫':'星辉骑士',imageUrl:art,motionMp4Url:window.fixtureMotion??null,motionPosterUrl:art,motionWebmUrl:window.fixtureMotion??null,rarity:'legend',starLevel:3,battleRole:'tank',stats:{maxHp:1000,energyRequired:30},combatPower:12000}));
const states=cards.map((c,i)=>({instanceId:'unit'+i,seat:i<5?2:1,slot:i+1,alive:true,hp:800,maxHp:1000,energy:20,energyRequired:30,shield:100,statuses:[]}));
let seq=0;
function Harness(){const[config,setConfig]=useState({type:'damage_all',quality:'standard'});const[mounted,setMounted]=useState(true);window.showFx=c=>flushSync(()=>setConfig({...c,sequence:++seq}));window.mountFx=setMounted;
 const type=config.type??'damage_all';const event=config.idle?null:{sequence:config.sequence??1,round:1,kind:config.kind??'skill',visual:config.visual??(type.startsWith('heal')?'heal':type.startsWith('revive')?'revive':type.startsWith('damage')?'damage':'buff'),effectType:config.bond?undefined:type,actorId:'unit0',durationMs:config.duration??1800,skillName:CARD_BATTLE_MOTIONS[type]?.label??'羁绊',lifesteal:config.dense?20:0,bond:config.bond?{ownerId:'unit1',triggerId:'unit0',actionType:config.bond}:undefined,effects:states.slice(5).map((s,i)=>({targetId:s.instanceId,amount:-250,critical:config.critical&&i===0,stunned:config.dense,dodged:config.dodge&&i===1,protection:config.protection&&i===0?config.protection:undefined})),states};
 window.currentEvent=event;window.bondActions=Object.keys(BOND_FX_FAMILIES);
 return mounted&&<CardBattleFxProvider gameId={config.game??'test'} event={event}><main style={{background:'#081525',color:'#d6e7ec',minHeight:'100vh',padding:12}}><header style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><strong>星辉试炼 · 第 8 回合</strong><CardBattleFxQualityControl/></header><div data-battle-arena style={{position:'relative',padding:'36px 5px', '--battle-card-width':'clamp(43px,12vw,105px)'}}><div style={{display:'flex',justifyContent:'center',gap:12,marginBottom:40}}>{cards.slice(0,5).map((c,i)=><BattleCard key={i} card={c} state={states[i]} cardBack={false} seat={2} activeEvent={event} showPower={false}/>)}</div><p style={{position:'relative',zIndex:40,textAlign:'center',fontSize:12,borderBlock:'1px solid #385064',padding:12}}>全体友军 · {event?.skillName??'准备中'}</p><div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginTop:40}}>{[0,1,2].map(team=><div key={team} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:24}}>{cards.slice(5+team*3,8+team*3).map((c,j)=>{let i=5+team*3+j;return <BattleCard key={i} card={c} state={states[i]} cardBack={false} seat={1} activeEvent={event} showPower={false}/>;})}</div>)}</div><CardBattleArenaFx event={event}/></div></main></CardBattleFxProvider>;
}window.seekFx=t=>{let root=document.getElementById('root');seekCardBattleAnimations(root,t);root.getAnimations({subtree:true}).filter(a=>a.animationName?.startsWith('card-battle-')).forEach(a=>a.pause());};createRoot(document.getElementById('root')).render(<Harness/>);
`},bundle:true,write:false,format:'iife',define:{'import.meta.env':'{}'}});
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM==='1'?undefined:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const path=new URL(route.request().url()).pathname;if(path.startsWith('/card-battle-fx/'))return route.fulfill({path:resolve('apps/web/public'+path),contentType:'image/webp'});return route.fulfill({body:'<div id="root"></div>',contentType:'text/html'});});
 await page.goto('http://battle.test/');
 await page.addStyleTag({content:readFileSync(resolve('apps/web/dist/assets',css),'utf8')+'\n'+readFileSync('apps/web/src/cardBattleEffects.css','utf8')});
 await page.addScriptTag({content:bundle.outputFiles[0].text});await expect(page.locator('.card-battle-card')).toHaveCount(14);
 const metrics=[];
 for(const quality of ['standard','economy']){
  await page.getByLabel('战斗特效质量').selectOption(quality);
  for(const type of ['damage_all','heal_all_allies','defense_down_all','revive_all_allies']){
   await page.evaluate(type=>window.showFx({type}),type);await expect(page.locator('[data-fx-wave="shared"]')).toHaveCount(1);
   await page.evaluate(()=>window.seekFx(1100));
   const count=await page.evaluate(()=>({nodes:[...document.querySelectorAll('.card-battle-skill-fx,.card-battle-arena-fx')].reduce((n,e)=>n+1+e.querySelectorAll('*').length,0),particles:document.querySelectorAll('.card-battle-fx-particle').length}));
   assert.ok(count.nodes<=(quality==='standard'?96:48),JSON.stringify({quality,type,...count}));assert.ok(count.particles<=(quality==='standard'?24:8));metrics.push({quality,type,...count});
   await page.screenshot({path:resolve(output,quality+'-'+type+'.png')});
  }
  await page.evaluate(()=>window.showFx({type:'damage_all',dense:true,critical:true}));await page.evaluate(()=>window.seekFx(1100));
  const nodes=await page.evaluate(()=>[...document.querySelectorAll('.card-battle-skill-fx,.card-battle-arena-fx')].reduce((n,e)=>n+1+e.querySelectorAll('*').length,0));assert.ok(nodes<=(quality==='standard'?96:48),'dense '+quality+' '+nodes);metrics.push({quality,type:'damage+stun+lifesteal',nodes});
 }
 await page.getByLabel('战斗特效质量').selectOption('standard');
 for(const bond of await page.evaluate(()=>window.bondActions)){await page.evaluate(bond=>window.showFx({bond}),bond);await expect(page.locator('.is-bond')).toHaveCount(1);await expect(page.locator('[data-pattern="actual"]')).toHaveCount(10);}
 await page.evaluate(()=>window.showFx({type:'damage_all',critical:true,dodge:true}));await expect(page.locator('[data-critical="true"]')).toHaveCount(1);await expect(page.locator('[data-feedback="dodge"]')).toHaveCount(1);
 for(const time of [0,989,990,1100,1700,1800]){await page.evaluate(t=>window.seekFx(t),time);const op=await page.locator('[data-battle-anchor="unit5"] .card-battle-number').evaluate(e=>Number(getComputedStyle(e).opacity));assert.ok(time>=990&&time<1800?op>.5:op===0,'number timing '+time+' '+op);}
 for(const protection of ['invincible','death_protection','resisted']){await page.evaluate(protection=>window.showFx({type:'damage_all',protection}),protection);await expect(page.locator('[data-feedback="'+protection+'"]')).toHaveCount(1);}
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.showFx({type:'revive_all_allies'}));await expect(page.locator('.card-battle-fx-particle')).toHaveCount(0);await expect(page.locator('.card-battle-fx-texture')).toHaveCount(0);await page.evaluate(()=>window.seekFx(1100));await page.screenshot({path:resolve(output,'reduced-motion.png')});
 await page.emulateMedia({reducedMotion:'no-preference'});
 for(const size of [{width:375,height:812},{width:844,height:390},{width:1440,height:1000}]){await page.setViewportSize(size);await page.evaluate(()=>window.showFx({type:'damage_all'}));await page.evaluate(()=>window.seekFx(1100));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(output,'arena-'+size.width+'.png'),fullPage:true});}
 for(let i=0;i<20;i++){await page.evaluate(()=>window.mountFx(false));await expect(page.locator('.card-battle-skill-fx')).toHaveCount(0);await page.evaluate(()=>window.mountFx(true));await expect(page.locator('.card-battle-card')).toHaveCount(14);}
 await page.evaluate(()=>window.showFx({idle:true}));await expect(page.locator('.card-battle-skill-fx')).toHaveCount(0);assert.equal(await page.evaluate(()=>document.getElementById('root').getAnimations({subtree:true}).length),0);
 // Cold context: failed textures cannot accidentally be served from the warm cache.
 const offline=await browser.newPage({viewport:{width:390,height:844}});let failed=0;
 await offline.route('**/*',r=>{if(new URL(r.request().url()).pathname.startsWith('/card-battle-fx/')){failed++;return r.abort();}return r.fulfill({body:'<div id="root"></div>',contentType:'text/html'});});
 await offline.goto('http://battle.test/offline');await offline.addStyleTag({content:readFileSync(resolve('apps/web/dist/assets',css),'utf8')});await offline.addScriptTag({content:bundle.outputFiles[0].text});
 await expect.poll(()=>failed).toBeGreaterThanOrEqual(3);await expect(offline.locator('.card-battle-fx-motif')).toHaveCount(10);await offline.evaluate(()=>window.seekFx(1100));await expect(offline.getByText('-250',{exact:true})).toHaveCount(9);await offline.close();
 await page.evaluate(()=>window.showFx({type:'damage_all',game:'second-game'}));
 // Controlled frame timestamps verify the two-window downgrade and event boundary.
 await page.evaluate(()=>{window.savedRaf=requestAnimationFrame;window.savedCancel=cancelAnimationFrame;window.syntheticTime=0;window.requestAnimationFrame=cb=>setTimeout(()=>cb(window.syntheticTime+=50),1);window.cancelAnimationFrame=clearTimeout;});
 await page.getByLabel('战斗特效质量').selectOption('auto');
 await expect.poll(()=>page.evaluate(()=>window.syntheticTime)).toBeGreaterThan(7100);
 await expect(page.locator('.card-battle-skill-fx').first()).toHaveAttribute('data-quality','standard');
 await page.evaluate(()=>window.showFx({type:'damage_all',game:'second-game'}));
 await expect(page.locator('.card-battle-skill-fx').first()).toHaveAttribute('data-quality','economy');
 await page.evaluate(()=>{window.requestAnimationFrame=window.savedRaf;window.cancelAnimationFrame=window.savedCancel;Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(page.locator('.card-battle-skill-fx')).toHaveCount(0);await expect(page.locator('.card-battle-arena-fx')).toHaveCount(0);
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));window.showFx({type:'damage_all',game:'third-game'});});
 await expect(page.locator('.card-battle-skill-fx')).toHaveCount(10);
 assert.deepEqual(errors,[]);writeFileSync(resolve(output,'budget.json'),JSON.stringify({browser:await browser.version(),metrics},null,2));
 await context.close();console.log('PASS: 14 cards, 9 targets, 20 bonds, both hard budgets, critical/dodge/protection, impact timing, reduced motion, resize, 20 unmounts, idle and resource fallback. '+output);
}finally{await browser.close();}
