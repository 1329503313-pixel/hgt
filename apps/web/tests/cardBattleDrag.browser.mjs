import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const bundle = await build({ stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';
import{HalfArena,CardBattleRoomView}from'./src/components/CardBattleRoomView';import{reorderCardBattleLineup}from'./src/shared/cardBattleLineup';
const cards=['守卫','晨星','月光'].map((name,i)=>({id:'c'+i,name,cardNo:'00'+i,rarity:'epic',battleRole:'tank',starLevel:2,combatPower:3000+i,stats:{maxHp:2000,attack:500,defense:200,speed:100,energyRequired:40,critRate:25,critDamage:150},skillName:'守护',skillDescription:'为全体友军增加防御',imageUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="210"><rect width="150" height="210" fill="'+['#163b58','#584124','#403c65'][i]+'"/><path d="M75 25L120 70L100 155L50 155L30 70Z" fill="#aa925d"/></svg>')}));
const initial=['c0','c1',null,null,null];window.calls=[];window.picks=[];
function Harness(){const[ids,setIds]=useState(initial);const[enabled,setEnabled]=useState(true);const[mode,setMode]=useState('arena');window.setEnabled=setEnabled;window.showPicker=()=>setMode('room');window.reset=()=>{setIds(initial);setEnabled(true);window.calls=[];window.picks=[];window.fail=false};window.ids=ids;
const seat={seat:1,user:{id:'u1',nickname:'测试玩家',avatar:null},ready:!enabled,lineup:ids.map((id,i)=>({slot:i+1,card:cards.find(c=>c.id===id)??null,cardBack:false}))};
const noop=()=>{};window.fetch=async()=>new Response(JSON.stringify({cards}),{headers:{'Content-Type':'application/json'}});
return mode==='room'?<MemoryRouter><CardBattleRoomView roomId="test" snapshot={{room:{id:'test',name:'测试房间',code:'123456',cardBattle:{mode:'1v1',phase:'preparing',game:null,seats:[seat,{...seat,seat:2,user:null,lineup:seat.lineup.map(s=>({...s,card:null}))}],me:{seat:1,userId:'u1',eligibleCardCount:3,collectibleBindings:[]}}},me:{isHost:true},messages:[],members:[]}} stickerSeries={[]} stickersLoading={false} onReload={noop} onReloadMessages={noop} onOpenInvite={noop} onOpenMembers={noop} showToast={noop}/></MemoryRouter>:<main className="flex h-[700px] max-h-[90dvh] bg-slate-950 text-white"><HalfArena seat={1} battleSeat={seat} states={[]} activeEvent={null} showPower isOwn position="bottom" canSelect={enabled} onPick={slot=>window.picks.push(slot)} onReorder={async(from,to)=>{window.calls.push([from,to]);if(window.fail)return false;setIds(current=>reorderCardBattleLineup(current,from,to));return true}}/></main>}
createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);
` }, bundle: true, write: false, format: 'iife', define: { 'import.meta.env': '{}' } });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
  const css = readdirSync('apps/web/dist/assets').find(file => file.startsWith('index-') && file.endsWith('.css'));
  await page.addStyleTag({ content: readFileSync(resolve('apps/web/dist/assets', css), 'utf8') });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const slot = number => page.locator('[data-card-battle-slot="'+number+'"]');
  const center = async number => { const rect = await slot(number).boundingBox(); return { x: rect.x+rect.width/2, y: rect.y+rect.height/2 }; };
  const begin = async (from,to) => { const a=await center(from),b=await center(to);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await expect(page.locator('.card-battle-drag-overlay')).toHaveCount(1);return {a,b}; };
  const settled = async expected => { await expect.poll(()=>page.evaluate(()=>window.ids)).toEqual(expected);await expect(page.locator('.card-battle-drag-overlay')).toHaveCount(0); };
  const reset = async () => { await page.evaluate(()=>window.reset());await settled(['c0','c1',null,null,null]); };
  mkdirSync('artifacts/card-drag',{recursive:true});
  // The card actually follows the pointer; hit targets retain their resting geometry.
  const {a,b}=await begin(1,3);
  const ghost=await page.locator('.card-battle-drag-overlay').boundingBox();
  assert.ok(Math.abs(ghost.x+ghost.width/2-b.x)<2);assert.ok(Math.abs(ghost.y+ghost.height/2-b.y)<2);
  assert.deepEqual(await center(1),a);
  await page.screenshot({path:'artifacts/card-drag/lift-mobile.png'});
  await page.mouse.up();await settled([null,'c1','c0',null,null]);
  assert.deepEqual(await page.evaluate(()=>window.picks),[]);
  await begin(3,2);await page.mouse.up();await expect(page.locator('.card-battle-drag-overlay')).toHaveCount(2);
  await page.screenshot({path:'artifacts/card-drag/swap-mobile.png'});
  await settled([null,'c0','c1',null,null]);assert.deepEqual(await page.evaluate(()=>window.calls),[[1,3],[3,2]]);
  // Failed saves leave the old lineup; out-of-bounds drops and cancellation never save.
  await reset();await page.evaluate(()=>window.fail=true);await begin(1,3);await page.mouse.up();await settled(['c0','c1',null,null,null]);
  await reset();await begin(1,3);await page.mouse.move(2,2);await page.mouse.up();await settled(['c0','c1',null,null,null]);assert.deepEqual(await page.evaluate(()=>window.calls),[]);
  for (const reason of ['escape','blur','capture','disable']) {
    await reset();await begin(1,3);
    if(reason==='escape')await page.keyboard.press('Escape');
    if(reason==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    if(reason==='capture')await slot(1).evaluate(el=>el.releasePointerCapture(1));
    if(reason==='disable')await page.evaluate(()=>window.setEnabled(false));
    await page.mouse.up();await settled(['c0','c1',null,null,null]);assert.deepEqual(await page.evaluate(()=>window.calls),[]);
  }
  await reset();await slot(1).click();assert.deepEqual(await page.evaluate(()=>window.picks),[1]);
  await slot(1).press('Alt+ArrowRight');await settled(['c1','c0',null,null,null]);
  // Real browser touch input, including system cancellation.
  const cdp=await page.context().newCDPSession(page);
  const touch=async(type,point)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:point?[{...point,id:1}]:[]});
  await reset();await touch('touchStart',await center(1));await touch('touchMove',await center(3));await expect(page.locator('.card-battle-drag-overlay')).toHaveCount(1);await touch('touchEnd');await settled([null,'c1','c0',null,null]);
  await reset();await touch('touchStart',await center(1));await touch('touchMove',await center(3));await touch('touchCancel');await settled(['c0','c1',null,null,null]);assert.deepEqual(await page.evaluate(()=>window.calls),[]);
  await page.emulateMedia({reducedMotion:'reduce'});await begin(1,2);await page.mouse.up();await settled(['c1','c0',null,null,null]);await page.emulateMedia({reducedMotion:'no-preference'});
  for(const viewport of [{width:812,height:375},{width:1440,height:1000}]){
    await page.setViewportSize(viewport);await reset();await begin(1,3);await page.mouse.up();await settled([null,'c1','c0',null,null]);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  // Verify the real room's picker and its accessible names only expose five stats.
  await page.setViewportSize({width:375,height:812});await page.evaluate(()=>window.showPicker());await slot(3).click();
  await expect(page.getByRole('heading',{name:'选择第 3 张卡牌'})).toBeVisible();
  const buttons=page.locator('button[aria-label*="，战力"]');await expect(buttons).toHaveCount(3);
  for(const card of await buttons.all()){
    assert.deepEqual(await card.locator('dt').allTextContents(),['生命','攻击','防御','速度','能量']);
    assert.doesNotMatch(await card.getAttribute('aria-label'),/暴击|吸血|击晕|再动|闪避|反击|命中/);
  }
  await page.screenshot({path:'artifacts/card-drag/picker-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: five picker stats; pointer/touch following; empty moves and occupied swaps; failure recovery; cancellations; click/keyboard; reduced motion; mobile/landscape/desktop.');
} finally { await browser.close(); }
