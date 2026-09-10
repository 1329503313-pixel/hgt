import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const bundle = await build({ stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route,useNavigate,useLocation}from'react-router-dom';
import CardTowerRoomPage from './src/pages/CardTowerRoomPage';
import{CardBattleManagement}from'./src/components/admin/CardTowerManagement';
import{CardTowerRankingBoard}from'./src/components/CardTowerRankingBoard';
import{DEFAULT_LEGEND_CARD_BATTLE_TIERS}from'./src/shared/digitalAssets';
import{emptyCardTowerFormations,replaceCardTowerFormation}from'@hgt/shared';
const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#162b49"/><path d="M50 25 80 60 67 115 33 115 20 60Z" fill="#496583"/></svg>');
const makeCard=(id,name)=>({id,cardNo:id,name,imageUrl:image,rarity:'legend',battleRole:'damage',starLevel:3,combatPower:6000,motionMp4Url:null,motionWebmUrl:null,motionPosterUrl:null,stats:{...DEFAULT_LEGEND_CARD_BATTLE_TIERS[3]},skillName:'协作之光',skillDescription:'全体友军获得防御提升。'});
const cards=Array.from({length:15},(_,i)=>makeCard('card'+i,'玩家卡'+i));const bosses=Array.from({length:5},(_,i)=>makeCard('boss'+i,'BOSS卡'+i));
const decks=[0,1,2].map(i=>({id:'deck'+i,name:'快捷卡组'+(i+1),cardIds:cards.slice(i*5,i*5+5).map(c=>c.id),collectibleBindings:[]}));
const floor={id:'floor1',floorNumber:1,enabled:true,rewardShells:50,clearCount:1,revision:1,cards:bosses.map(c=>({name:c.name,imageUrl:'/api/online-soup/card-battle-boss/covers/'+'a'.repeat(64),tier:{...DEFAULT_LEGEND_CARD_BATTLE_TIERS[3]}}))};
window.tower={room:{id:'room',name:'卡牌闯关'},formations:emptyCardTowerFormations(),revision:1,clearedFloor:0,message:null,nextFloor:{id:'floor1',floorNumber:1,rewardShells:50,lineup:bosses},game:null};
window.requests=[];window.fetch=async(url,options={})=>{url=String(url);const body=options.body?JSON.parse(options.body):null;window.requests.push({url,method:options.method,body});let data={ok:true};
if(url.includes('/resources'))data={cards,decks,collectibles:[]};
else if(url.includes('/admin/card-tower/floors/')&&url.includes('/clears'))data={clears:[{userId:'u2',nickname:'挑战者',username:'challenger',clearedAt:'2026-09-10T01:02:03Z'}],total:1};
else if(url.includes('/admin/card-tower/floors'))data={floors:[floor],total:1,canCreate:true};
else if(url.includes('/ranking'))data={entries:[{userId:'u2',nickname:'挑战者',ranking:1,totalPower:90000,floorNumber:12,clearedAt:'2026-09-10T01:02:03Z',vipLevel:0,vipActive:false}],me:null};
else if(url.endsWith('/formation')){window.tower.formations=replaceCardTowerFormation(window.tower.formations,body.index,body.formation);window.tower.revision++;data={formations:window.tower.formations,revision:window.tower.revision};}
else if(url.includes('/collectibles'))data={collectibles:[]};
else if(url.endsWith('/start')){const lineups=window.tower.formations.filter(f=>f.cardIds.some(Boolean)).map((f,i)=>({seat:1,userId:'u1:formation:'+i,nickname:'阵容 '+(i+1),cards:f.cardIds.map(id=>cards.find(c=>c.id===id))}));lineups.push({seat:2,userId:'boss',nickname:'卡牌闯关第 1 层',cards:bosses});const states=[lineups[0],lineups.at(-1)].flatMap(p=>p.cards.map((c,i)=>({...c.stats,instanceId:p.userId+':'+i,userId:p.userId,seat:p.seat,slot:i+1,row:i<2?'front':'rear',hp:3000,maxHp:3000,energy:0,alive:true})));const event={sequence:1,round:1,kind:'round',visual:'round',actorId:null,skillName:null,effects:[],states,durationMs:500000,text:'第一回合开始'};window.tower.game={id:'game',status:'playing',floorNumber:1,totalPower:90000,rewardShells:50,lineups,settlement:null,playback:{completedSequence:0,totalEvents:1,complete:false,states,activeEvent:event,activeEventStartedAt:new Date().toISOString(),activeEventElapsedMs:0,serverNow:new Date().toISOString()}};}
else if(url.includes('/playback'))data={gameId:'game',playback:window.tower.game?.playback};
else if(url.includes('/rooms/'))data=window.tower;
return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});};
function Harness(){const navigate=useNavigate(),location=useLocation();window.go=navigate;window.locationState=location;return <Routes><Route path='/online-soup/tower/:roomId' element={<CardTowerRoomPage/>}/><Route path='/admin/card-battle/*' element={<div className='p-4'><CardBattleManagement/></div>}/><Route path='/rank' element={<CardTowerRankingBoard currentUserId='u1'/>}/><Route path='*' element={<p>目标页面</p>}/></Routes>}
createRoot(document.getElementById('root')).render(<React.StrictMode><MemoryRouter initialEntries={['/online-soup/tower/room']}><Harness/></MemoryRouter></React.StrictMode>);
` }, plugins: [{ name: 'mock-app-context', setup(b) {
  b.onResolve({ filter: /context\/AppContext$/ }, () => ({ path: 'context', namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `const user={id:'u1',nickname:'试炼者',role:'user'};export const useApp=()=>({user,loadingUser:false,showToast:m=>window.toast=m,openAuth:()=>{}});` }));
} }], bundle: true, write: false, format: 'iife', define: { 'import.meta.env': '{}' } });
const css = readdirSync(resolve('apps/web/dist/assets')).find(f => f.startsWith('index-') && f.endsWith('.css'));
const output = mkdtempSync(resolve(tmpdir(), 'hgt-tower-browser-'));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === '1' ? undefined : 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => route.abort());
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
  await page.addStyleTag({ content: readFileSync(resolve('apps/web/dist/assets', css), 'utf8') });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(page.getByRole('button', { name: '开始挑战第 1 层', exact: true })).toBeDisabled();
  const importDeck = async n => { await page.getByRole('button', { name: '调用卡组', exact: true }).click(); await page.getByRole('button', { name: '快捷卡组' + n }).click(); };
  await importDeck(1);
  await expect(page.getByRole('button', { name: '阵容 1 · 5/5', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始挑战第 1 层', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '阵容 2 · 0/5', exact: true }).click(); await importDeck(1);
  await expect(page.getByRole('button', { name: '阵容 1 · 0/5', exact: true })).toBeVisible();
  assert.match(await page.evaluate(() => window.toast), /重复卡牌/);
  await page.getByRole('button', { name: '阵容 1 · 0/5', exact: true }).click(); await importDeck(2);
  await page.getByRole('button', { name: '阵容 3 · 0/5', exact: true }).click(); await importDeck(3);
  await page.getByRole('button', { name: '配置阵容', exact: true }).click();
  await expect(page.getByText('配置阵容 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择玩家卡0', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '选择玩家卡5', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '选择玩家卡10', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '卸下当前卡位', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.tower.formations[2].cardIds[0])).toBe(null);
  await page.getByRole('button', { name: '选择玩家卡10', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.tower.formations[2].cardIds[0])).toBe('card10');
  await page.getByRole('button', { name: '关闭阵容配置', exact: true }).click();
  for (const viewport of [{ width: 375, height: 812 }, { width: 320, height: 568 }, { width: 812, height: 375 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
    assert.ok(size.width <= viewport.width, JSON.stringify({ viewport, size }));
    const start = await page.getByRole('button', { name: '开始挑战第 1 层', exact: true }).boundingBox();
    assert.ok(start.y + start.height <= viewport.height + 1);
    await page.locator('.card-battle-arena-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const last = await page.locator('.card-battle-card').last().boundingBox();
    const footer = await page.locator('footer').boundingBox(); assert.ok(last.y + last.height <= footer.y + 1);
    if (viewport.width === 375) await page.screenshot({ path: resolve(output, 'mobile-preparing.png') });
  }
  await page.evaluate(() => window.go('/rank'));
  await expect(page.getByRole('columnheader', { name: '通关战力' })).toBeVisible();
  await page.getByRole('button', { name: '挑战者' }).click();
  await expect.poll(() => page.evaluate(() => window.locationState.pathname)).toBe('/users/u2');
  assert.equal(await page.evaluate(() => window.locationState.state.returnTo), '/mine/rankings?tab=card_battle&mode=tower');
  await page.evaluate(() => window.go('/online-soup/tower/room'));
  await expect(page.getByRole('button', { name: '阵容 3 · 5/5', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始挑战第 1 层', exact: true }).click();
  await expect(page.getByText('第 1 / 50 回合', { exact: false })).toBeVisible();
  await expect(page.locator('[data-battle-instance]')).toHaveCount(10);
  await expect(page.getByRole('button', { name: '配置阵容', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: resolve(output, 'mobile-playing.png') });
  await page.evaluate(() => window.go('/admin/card-battle/tower'));
  await page.getByRole('button', { name: '通关列表', exact: true }).click();
  await expect(page.getByText('账号：challenger', { exact: true })).toBeVisible();
  await expect(page.getByText('2026/09/10 09:02:03', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
  await expect(page.getByText('层级', { exact: true })).toBeVisible();
  await expect(page.getByLabel('层级', { exact: true })).toHaveAttribute('readonly', '');
  await expect(page.getByRole('combobox', { name: '上架状态', exact: true })).toBeDisabled();
  await page.screenshot({ path: resolve(output, 'mobile-admin.png') });
  assert.deepEqual(errors, []);
  console.log('PASS: tower autosave/import/duplicate movement, remembered formations, four viewports, 50-round playback, profile ranking navigation, admin direct URL and second-precision clears. Screenshots: ' + output);
} finally { await browser.close(); }
