// Actual card displacement, not merely the presence of an animation class.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const bundle = await build({ stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{HalfArena}from'./src/components/CardBattleRoomView';
import{CardBattleFxProvider,CardBattleFxQualityControl}from'./src/components/CardBattleFxContext';
import{CardBattleArenaFx}from'./src/components/CardBattleArenaFx';
import{CARD_BATTLE_MOTIONS}from'./src/shared/cardBattleMotion';
const art='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#234055"/><path d="M50 20 80 55 65 120 35 120 20 55Z" fill="#cab382"/></svg>');
const cards=Array.from({length:10},(_,i)=>({id:'c'+i,name:'卡牌'+i,imageUrl:art,rarity:'epic',starLevel:0,stats:{maxHp:1000,energyRequired:30}}));
const states=cards.map((c,i)=>({instanceId:c.id,seat:i<5?2:1,slot:i%5+1,alive:true,hp:800,maxHp:1000,energy:10,energyRequired:30,statuses:[]}));
window.damageTypes=Object.keys(CARD_BATTLE_MOTIONS).filter(t=>t.startsWith('damage_'));
let sequence=0;
function Harness(){const[c,set]=useState({});window.showFlight=(next)=>flushSync(()=>set({...next,sequence:++sequence}));window.seekFlight=(elapsed)=>flushSync(()=>set(c=>({...c,elapsed})));
const event={sequence:c.sequence??0,kind:c.kind??'skill',visual:c.visual??'damage',effectType:c.type??'damage_single',actorId:c.actor??'c5',durationMs:1300,skillName:'突进测试',effects:(c.targets??['c0']).map(targetId=>({targetId,amount:c.visual==='heal'?100:-100,dodged:c.dodged,blocked:c.blocked})),states,round:1,text:'突进测试',...(c.bond?{bond:{ownerId:'c6',triggerId:'c5',actionType:'skill'}}:{})};
return <CardBattleFxProvider gameId={c.game??'flight'} event={event} elapsedMs={c.elapsed??0} playing={false}><CardBattleFxQualityControl/><div data-battle-arena style={{position:'relative',height:740,display:'flex',flexDirection:'column',background:'#071426',color:'white'}}><CardBattleArenaFx event={event}/>{[2,1].map(seat=><HalfArena key={seat} seat={seat} battleSeat={{seat,user:{id:'u'+seat,nickname:'阵营'+seat},lineup:cards.slice(seat===2?0:5,seat===2?5:10).map((card,i)=>({slot:i+1,card,cardBack:false}))}} states={states} activeEvent={event} showPower={false} isOwn={false} position={seat===2?'top':'bottom'} canSelect={false} onPick={()=>{}} onReorder={async()=>false}/>)}</div></CardBattleFxProvider>;
}createRoot(document.getElementById('root')).render(<Harness/>);
` }, bundle: true, write: false, format: 'iife', define: { 'import.meta.env': '{}' } });
const css = readdirSync('apps/web/dist/assets').find(f => f.startsWith('index-') && f.endsWith('.css'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => r.fulfill({ body: '<div id="root"></div>', contentType: 'text/html' }));
  await page.goto('http://flight.test/');
  await page.addStyleTag({ content: readFileSync(resolve('apps/web/dist/assets', css), 'utf8') });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(page.locator('.card-battle-card')).toHaveCount(10);
  const geometry = (actor, target) => page.evaluate(({actor,target}) => {
    const card=document.querySelector('[data-battle-instance="'+actor+'"]');
    const source=document.querySelector('[data-battle-anchor="'+actor+'"]');
    const dest=document.querySelector('[data-battle-anchor="'+target+'"]');
    const center=el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width};};
    const a=center(card),s=center(source),t=center(dest);
    return {travel:Math.hypot(a.x-s.x,a.y-s.y),gap:Math.hypot(a.x-t.x,a.y-t.y),distance:Math.hypot(s.x-t.x,s.y-t.y),width:s.width,
      animation:card.getAnimations().find(a=>a.id==='card-battle-flight')?.currentTime,
      paused:card.getAnimations().every(a=>a.playState==='paused'||a.playState==='finished')};
  }, {actor,target});
  const show = async config => { await page.evaluate(c=>window.showFlight(c),config); };
  const seek = async time => { await page.evaluate(t=>window.seekFlight(t),time); };
  const check = async (config={}) => {
    const actor=config.actor??'c5',target=(config.targets??['c0']).find(id=>id!==actor&&id!=='missing');
    await show(config); await seek(0);
    assert.ok((await geometry(actor,target)).travel<1,'starts at its own slot');
    await seek(715);
    const hit=await geometry(actor,target);
    assert.ok(hit.travel>hit.distance*.5,JSON.stringify({config,hit}));
    assert.ok(hit.gap<hit.width*.55,'must reach target edge: '+JSON.stringify({config,hit}));
    assert.ok(hit.paused,'replay seeking stays paused');
    await expect(page.locator('.card-battle-fx-link:not(.is-bond):not(.is-blood-return)')).toHaveCount(0);
    await seek(1300);assert.ok((await geometry(actor,target)).travel<1,'returns to original slot');
  };
  for(const quality of ['standard','economy']) {
    await page.getByLabel('战斗特效质量').selectOption(quality);
    for(const type of await page.evaluate(()=>window.damageTypes)) await check({type});
    for(const config of [{kind:'attack',type:null},{kind:'attack',dodged:true},{blocked:true},
      {targets:['c0','c1','c2','c3','c4'],type:'damage_all'},
      {targets:['missing','c5','c2'],type:'damage_all'}, {actor:'c0',targets:['c8'],type:'damage_rear'},
      {bond:true,type:'damage_true_all'},{game:'another-game',type:'damage_random_3'}]) await check(config);
  }
  // Passive spells do not move their caster; healing links remain available.
  await page.getByLabel('战斗特效质量').selectOption('standard');
  for(const [type,visual] of [['heal_all_allies','heal'],['attack_self','buff'],['energy_self','energy'],['revive_ally_1','revive']]) {
    await show({type,visual});await seek(715);assert.ok((await geometry('c5','c0')).travel<1,type);
    await expect(page.locator('.card-battle-attacker')).toHaveCount(0);
  }
  await expect(page.locator('.card-battle-fx-link')).toHaveCount(1);
  mkdirSync('artifacts/card-battle-flight',{recursive:true});
  for(const size of [{width:375,height:812},{width:844,height:390},{width:1440,height:1000}]) {
    await page.setViewportSize(size);await check({type:'damage_all',targets:['c0','c1','c2','c3','c4']});
    await seek(715);await page.screenshot({path:'artifacts/card-battle-flight/impact-'+size.width+'.png',fullPage:true});
  }
  await page.evaluate(()=>{window.savedCard=document.querySelector('[data-battle-instance="c5"]');window.savedArt=window.savedCard.querySelector('img');});
  await check({type:'damage_single'});await check({type:'damage_single'});
  assert.equal(await page.evaluate(()=>window.savedCard===document.querySelector('[data-battle-instance="c5"]')&&window.savedArt===window.savedCard.querySelector('img')),true,'seeking and repeat events preserve card media');
  await page.emulateMedia({reducedMotion:'reduce'});await show({type:'damage_all'});await seek(715);
  await expect.poll(async()=>(await geometry('c5','c0')).travel).toBeLessThan(1);
  assert.deepEqual(errors,[]);
  console.log('PASS: all damage skills physically reach targets and return in standard/economy; normal attacks, dodge/block, self/missing targets, group/bond/true damage, both directions, replay seek, repeat events, responsive and reduced motion.');
} finally { await browser.close(); }
