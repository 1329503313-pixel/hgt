// Exercise the complete ranked-room transition and refresh, including the real API decoder.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";

const legacyRoute = readFileSync("apps/web/src/UserApp.tsx", "utf8").split("\n").find(line => line.includes('<Route path="rankings"'));
assert.ok(legacyRoute, "The previous rankings URL must remain refreshable");

const bundle = await build({ stdin: { resolveDir: resolve("apps/web"), loader: "tsx", contents: `
import React from'react';import{createRoot}from'react-dom/client';import{MemoryRouter,useLocation,useNavigate,Routes,Route,Navigate}from'react-router-dom';
import OnlineSoupRoomPage from'./src/pages/OnlineSoupRoomPage';import RankingsPage from'./src/pages/RankingsPage';import ErrorBoundary from'./src/components/ErrorBoundary';
import{CARD_BATTLE_RANKINGS_PATH,CARD_BATTLE_RANKINGS_STATE}from'./src/shared/cardBattleNavigation';
import{DEFAULT_LEGEND_CARD_BATTLE_TIERS}from'./src/shared/digitalAssets';
const cards=Array.from({length:5},(_,i)=>({id:'c'+i,cardNo:String(i),name:'卡牌'+i,imageUrl:'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',rarity:'legend',battleRole:'damage',starLevel:3,combatPower:6000,stats:{...DEFAULT_LEGEND_CARD_BATTLE_TIERS[3]},skillName:'',skillDescription:''}));
const seats=(window.bossRoom?[1,2,3]:[1,2]).map(seat=>({seat,user:{id:'u'+seat,nickname:'玩家'+seat,avatar:null},ready:seat===2,lineup:(window.bossRoom?cards.slice(0,3):cards).map((card,i)=>({slot:i+1,card:seat===1?card:null,cardBack:seat===2}))}));
const lineups=window.bossRoom?[...seats.map(seat=>({seat:1,playerSeat:seat.seat,userId:seat.user.id,nickname:seat.user.nickname,cards:cards.slice(0,3)})),{seat:2,userId:'boss:room',nickname:'BOSS',cards}]:seats.map(seat=>({seat:seat.seat,userId:seat.user.id,nickname:seat.user.nickname,cards}));
const states=lineups.flatMap(p=>p.cards.map((card,i)=>({seat:p.seat,userId:p.userId,slot:i+1,instanceId:p.userId+':'+i,hp:100,maxHp:100,energy:0,energyRequired:40,alive:true,statuses:[]})));
const players=lineups.map(p=>({...p,cards:p.cards.map((card,i)=>({slot:i+1,cardId:card.id,name:card.name,damageDealt:100,damageTaken:50,healingDone:0,score:.2}))}));
window.finished=window.initialFinished??false;window.wins=window.initialWins??0;window.winnerSeat=1;window.calls=[];
const playback=()=>({completedSequence:window.finished?1:0,totalEvents:1,complete:window.finished,states,activeEvent:window.finished?null:{sequence:1,round:1,kind:'round',visual:'round',actorId:null,effects:[],states,durationMs:60000,text:'对战中'},activeEventElapsedMs:0,activeEventStartedAt:new Date().toISOString(),serverNow:new Date().toISOString()});
const game=()=>({id:window.gameId??'game',gameNumber:1,status:window.finished?'ended':'playing',lineups,playback:playback(),settlement:window.finished?{winnerSeat:window.winnerSeat,rounds:5,endReason:'elimination',players}:null});
const snapshot=(roomId='room')=>({room:{id:roomId,contentType:'card_battle',status:window.closedRoom?'closed':window.stale?'ended':window.phase??(window.finished?'ended':'playing'),name:roomId==='room'?'打榜挑战':'新房间',code:'123456',cardBattle:{mode:window.bossRoom?'boss':'1v1',boss:window.bossRoom?{available:true,lineup:cards,rewardShells:500,rewardClaimed:false,currentReward:null}:null,seats,me:{userId:'u1',seat:1,eligibleCardCount:5,collectibleBindings:[]},phase:window.stale?'aborted':window.phase??(window.finished?'ended':'playing'),rankingChallenge:window.normalRoom||window.bossRoom?null:{targetRank:2,consecutiveWins:window.wins,status:window.stale?'stale':'active'},game:game()}},me:{isHost:true,role:'player'},members:seats.map(s=>({...s.user,role:'player'})),messages:[]});
window.fetch=async(url,options={})=>{
  const path=String(url);window.calls.push(path);
  if(path.includes('/confirm-win')){window.confirmRequested=true;if(window.holdConfirm)await new Promise(resolve=>window.resolveConfirm=resolve);}
  if(path.includes('/confirm-win')&&window.confirmStale)return new Response(JSON.stringify({error:'对方排名已发生变化，请重新打榜。',code:'RANK_CHANGED'}),{status:409});
  if(path.includes('/acknowledge-change'))return new Response(JSON.stringify(window.ackFails?{error:'暂时无法关闭，请重试'}:{ok:true,roomClosed:true}),{status:window.ackFails?503:200});
  const data=path.includes('/confirm-win')?{ok:true,rank:2,roomClosed:true}
    :path.includes('/playback')?{gameId:window.gameId??'game',playback:playback()}
    :path.includes('eligible-cards')?{cards}
    :path.includes('/rooms/')?snapshot(path.split('/rooms/')[1].split('/')[0])
    :path.includes('card-battle-rankings')?{entries:[{rank:2,occupied:true,user:{id:'u1',nickname:'玩家1',avatar:null},starTotal:15,totalPower:30000}],ownRank:2,limit:10}
    :path.includes('/api/rankings')?Object.fromEntries(['hotSoup','achievement','level','charm','generosity'].flatMap(key=>[[key==='hotSoup'?'hotSoups':key+'Users',[]],[key+'Own',null]]))
    :path.includes('asset-rankings')?{ranking:[],own:null,drawRanking:[],drawOwn:null}
    :path.includes('collectible-rankings')?{ranking:[],own:null}
    :path.includes('unread-counts')?{counts:{system:0,interactions:0,requests:0,notices:0,privateMessages:0,circleMessages:0,circleMentions:0,circleUnclaimedRedPackets:0,circleUnclaimedRedPacketNextExpiryAt:null,total:0}}
    :path.includes('/api/stickers')?{series:[]}:{};
  if((path.endsWith('/rooms/room/state')||path.endsWith('/rooms/room'))&&window.holdState){window.holdState=false;await new Promise(resolve=>window.resolveState=resolve);}
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
window.WebSocket=class extends EventTarget{static OPEN=1;readyState=1;constructor(){super();window.socket=this;queueMicrotask(()=>this.dispatchEvent(new Event('open')))}send(){}close(){this.readyState=3;this.dispatchEvent(new Event('close'))}};
window.EventSource=class extends EventTarget{close(){}};
window.roomEvent=(reason,cause)=>window.socket?.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({event:'online_soup_changed',payload:{roomId:window.currentPath.split('/').pop(),reason,cause}})}));
window.finish=(winner=1)=>{window.finished=true;window.winnerSeat=winner;window.wins=winner===1?2:0;window.roomEvent('changed')};
function Harness(){const location=useLocation();window.navigate=useNavigate();window.currentPath=location.pathname;window.currentState=location.state;return<Routes><Route path="/online-soup/rooms/:roomId" element={<OnlineSoupRoomPage/>}/><Route path="/mine/rankings" element={<RankingsPage/>}/>${legacyRoute}<Route path="/online-soup" element={<p>大厅</p>}/></Routes>}
const app=<MemoryRouter initialEntries={[window.initialPath]}><ErrorBoundary><Harness/></ErrorBoundary></MemoryRouter>;
createRoot(document.getElementById('root')).render(window.strictMode?<React.StrictMode>{app}</React.StrictMode>:app);
` }, bundle: true, write: false, format: "iife", define: { "import.meta.env": "{}" }, plugins: [{name:"fixture-context",setup(builder){
  builder.onLoad({filter:/[/\\]context[/\\]AppContext.tsx$/},()=>({loader:"tsx",contents:`const context={user:{id:'u1',nickname:'玩家1'},loadingUser:false,showToast:message=>window.toasts.push(message),openAuth:()=>{}};export const useApp=()=>context;`}));
  builder.onLoad({filter:/[/\\]context[/\\]OnlineSoupDockContext.tsx$/},()=>({loader:"tsx",contents:`const noop=()=>{};const context={minimizeRoom:noop,showFullRoom:noop,syncRoomBackgroundMusic:noop,toggleBackgroundMusicMuted:noop};export const useOnlineSoupDock=()=>context;`}));
}}] });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? undefined : "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true });
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  page.on("console", message => { if (message.type() === "error") { errors.push(message.text()); console.error(message.text()); } });
  await page.route("**/*", route => route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'}));
  const mount = async (initialPath='/online-soup/rooms/room', stale=false, options={}) => {
    await page.goto('http://hgt.test'+initialPath);
    await page.evaluate(({path,stale,options})=>{window.initialPath=path;window.toasts=[];window.stale=stale;Object.assign(window,options)},{path:initialPath,stale,options});
    const css=readdirSync("apps/web/dist/assets").find(file=>file.startsWith("index-")&&file.endsWith(".css"));
    await page.addStyleTag({content:readFileSync(resolve("apps/web/dist/assets",css),"utf8")});
    await page.addScriptTag({content: bundle.outputFiles[0].text});
  };
  await mount();
  await expect(page.getByText('打榜挑战', {exact:true})).toBeVisible();
  await expect(page.getByText('第一局 · 连胜 0/2',{exact:true})).toBeVisible();
  await page.evaluate(() => { window.wins=1;window.gameId='second-game';window.roomEvent('changed'); });
  await expect(page.getByText('第一局已获胜 · 自动进行第二局 · 连胜 1/2',{exact:true})).toBeVisible();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  mkdirSync('artifacts/card-battle-ranking-streak',{recursive:true});
  await page.screenshot({path:'artifacts/card-battle-ranking-streak/second-game-mobile.png'});
  await expect(page.getByRole('button',{name:/确认两连胜/})).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.evaluate(() => window.finish(1));
  await expect(page.getByRole('button', {name:'确认两连胜并占据第 2 名'})).toBeVisible();
  await page.evaluate(() => window.finish(2));
  await expect(page.getByRole('button', {name:'返回调整卡组并重新准备'})).toBeVisible();
  await page.evaluate(() => window.finish(1));
  await page.getByRole('button', {name:'确认两连胜并占据第 2 名'}).click();
  await expect.poll(() => page.evaluate(() => window.currentPath)).toBe('/mine/rankings');
  await expect(page.getByRole('heading',{name:'卡牌对战榜 · Top 10'})).toBeVisible();
  assert.deepEqual(await page.evaluate(()=>window.currentState),{tab:'card_battle'});
  // The real room-closed callback may run before the confirmation response returns.
  await mount();
  await expect(page.getByText('打榜挑战',{exact:true})).toBeVisible();
  await page.evaluate(()=>{window.holdConfirm=true;window.finish(1)});
  await page.getByRole('button',{name:'确认两连胜并占据第 2 名'}).click();
  await expect.poll(()=>page.evaluate(()=>Boolean(window.resolveConfirm))).toBe(true);
  await page.evaluate(()=>window.roomEvent('room_closed','ranking_win_confirmed'));
  await expect(page.getByRole('heading',{name:'卡牌对战榜 · Top 10'})).toBeVisible();
  await page.evaluate(()=>window.resolveConfirm());
  await expect.poll(()=>page.evaluate(()=>window.toasts.includes('打榜成功，已占据第 2 名'))).toBe(true);
  assert.equal(await page.evaluate(()=>window.currentPath),'/mine/rankings');
  assert.equal(await page.evaluate(()=>window.toasts.includes('主持人已关闭房间')),false);
  // An invalidation event stops the arena immediately, even if an older state
  // response still says active. Dismissal requires a successful acknowledgment.
  await mount();
  await expect(page.getByText('打榜挑战',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.roomEvent('card_battle_ranking_changed'));
  const invalidated = page.getByRole('alertdialog');
  await expect(invalidated).toContainText('对方排名已发生变化，请重新打榜。');
  await expect(page.locator('.card-battle-room')).toHaveCount(0);
  assert.equal(await page.evaluate(()=>window.currentPath),'/online-soup/rooms/room');
  await page.keyboard.press('Escape'); await expect(invalidated).toBeVisible();
  await page.evaluate(()=>{window.ackFails=true;window.roomEvent('changed')});
  await invalidated.getByRole('button',{name:'确认',exact:true}).click();
  await expect(invalidated.getByRole('alert')).toHaveText('暂时无法关闭，请重试');
  assert.equal(await page.evaluate(()=>window.currentPath),'/online-soup/rooms/room');
  await page.evaluate(()=>window.ackFails=false);
  await invalidated.getByRole('button',{name:'确认',exact:true}).click();
  await expect(page.getByRole('heading',{name:'卡牌对战榜 · Top 10'})).toBeVisible();
  // Reopening/refreshing a stale room recovers the same prompt from server state.
  await mount('/online-soup/rooms/room',true);
  await expect(invalidated).toBeVisible();
  await expect(page.locator('.card-battle-room')).toHaveCount(0);
  await invalidated.getByRole('button',{name:'确认',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.currentPath)).toBe('/mine/rankings');
  // A competing confirmation can beat the socket event: the API error must
  // show the identical prompt and wait for acknowledgment instead of navigating.
  await mount();
  await expect(page.getByText('打榜挑战',{exact:true})).toBeVisible();
  await page.evaluate(()=>{window.confirmStale=true;window.finish(1)});
  await page.getByRole('button',{name:'确认两连胜并占据第 2 名'}).click();
  await expect(invalidated).toBeVisible();
  assert.equal(await page.evaluate(()=>window.currentPath),'/online-soup/rooms/room');
  await invalidated.getByRole('button',{name:'确认',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.currentPath)).toBe('/mine/rankings');
  await mount('/online-soup/rooms/room',false,{initialFinished:true,initialWins:2});
  await expect(page.getByRole('button',{name:'确认两连胜并占据第 2 名'})).toBeVisible();
  await page.getByRole('button',{name:'确认两连胜并占据第 2 名'}).click();
  await expect.poll(()=>page.evaluate(()=>window.currentPath)).toBe('/mine/rankings');
  // Entering/refreshing a completed room never opens the saved settlement, even
  // when the room is already preparing for another game.
  for (const options of [{initialFinished:true},{initialFinished:true,normalRoom:true},{initialFinished:true,bossRoom:true},{initialFinished:true,bossRoom:true,phase:'preparing'},{initialFinished:true,normalRoom:true,phase:'preparing',strictMode:true}]) {
    await mount('/online-soup/rooms/room',false,options);
    await expect(page.getByText('打榜挑战',{exact:true})).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await page.evaluate(()=>window.roomEvent('changed'));
    await expect(page.getByRole('table')).toHaveCount(0);
  }
  await mount('/online-soup/rooms/room',false,{bossRoom:true});
  await expect(page.getByText('打榜挑战',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.finish());
  await expect(page.getByRole('heading',{name:'挑战成功',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'关闭结算'}).click();
  await page.evaluate(()=>window.roomEvent('changed'));
  await expect(page.getByRole('table')).toHaveCount(0);
  // A live game still settles, dismissal survives synchronization, and the next
  // game can settle normally. Exercise the same component under StrictMode.
  await mount('/online-soup/rooms/room',false,{normalRoom:true,strictMode:true});
  await expect(page.getByText('打榜挑战',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.finish());
  await expect(page.getByRole('button',{name:'关闭结算'})).toBeVisible();
  await page.getByRole('button',{name:'关闭结算'}).click();
  await page.evaluate(()=>window.roomEvent('changed'));
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.evaluate(()=>{window.finished=false;window.gameId='next-game';window.roomEvent('changed')});
  await expect(page.getByText('第 1 回合',{exact:false}).first()).toBeVisible();
  await page.evaluate(()=>window.finish());
  await expect(page.getByRole('button',{name:'关闭结算'})).toBeVisible();
  // Navigate directly between two room URLs while the old settlement is open.
  // A delayed closed-room reply must neither leak UI nor redirect the new room.
  await page.evaluate(()=>{window.holdState=true;window.closedRoom=true;window.roomEvent('changed')});
  await expect.poll(()=>page.evaluate(()=>Boolean(window.resolveState))).toBe(true);
  await page.evaluate(()=>{window.closedRoom=false;window.phase='preparing';window.navigate('/online-soup/rooms/new-room')});
  await expect(page.getByText('新房间',{exact:true})).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.evaluate(()=>window.resolveState());
  await expect(page.getByText('新房间',{exact:true})).toBeVisible();
  assert.equal(await page.evaluate(()=>window.currentPath),'/online-soup/rooms/new-room');
  // A fresh page load at the old address also reaches the real ranking board.
  await mount('/rankings');
  await expect(page.getByRole('heading',{name:'卡牌对战榜 · Top 10'})).toBeVisible();
  assert.equal(await page.evaluate(()=>window.currentPath),'/mine/rankings');
  assert.deepEqual(await page.evaluate(()=>window.currentState),{tab:'card_battle'});
  assert.deepEqual(errors, []);
  console.log('PASS: first-win automatic second game, two-win confirmation, refresh recovery, live-only settlement, historical/refresh suppression, dismissal, next game, direct room changes and late replies under StrictMode, ranked confirmation/invalidation/closure.');
} finally { await browser.close(); }
