// Real pages, replay engine and CSS; all APIs are isolated and no game is submitted.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';
import { chromium, expect } from '@playwright/test';

const simulation = await build({stdin:{resolveDir:resolve('apps/server'),loader:'ts',contents:`
  import {simulateCardBattle} from './src/cardBattle';
  export const lineups=[1,2].map(seat=>({userId:'u'+seat,nickname:seat===1?'我方昵称':'对方昵称',seat,cards:Array.from({length:5},(_,i)=>({cardId:seat+'-'+i,instanceId:seat+'-'+i,slot:i+1,name:'星辉骑士',rarity:'epic',starLevel:0,imageUrl:'',tier:{starLevel:0,maxHp:500,attack:200,defense:10,speed:seat===1?100:50,energyRequired:100,canAttackRear:false,critRate:0,critDamage:150,skillName:'技能',skillDescription:'',effects:[]}}))}));
  export const result=simulateCardBattle(lineups,'record-browser');
`},bundle:true,write:false,format:'esm',platform:'node'});
const {lineups,result}=await import('data:text/javascript;base64,'+Buffer.from(simulation.outputFiles[0].text).toString('base64'));
const replay={gameId:'b',gameNumber:1,name:'测试对战',lineups:lineups.map(p=>({...p,cards:p.cards.map(c=>({...c,id:c.cardId,stats:c.tier,battleRole:'damage',combatPower:1000}))})),result};
const endedAt='2026-09-01T11:28:00Z',startedAt='2026-09-01T10:00:00Z';
const honors={version:1,mvp:{userId:'u1',nickname:'我方昵称',avatar:null,progressContribution:80},bestQuestion:{messageId:'m0',questionNumber:1,userId:'u1',nickname:'我方昵称',avatar:null,question:'这是最佳提问吗',answer:'yes',progressDelta:20}};
const soups=Array.from({length:13},(_,i)=>({id:'soup:'+i,kind:'soup',subtype:i%2?'ai':'human',title:'测试汤 '+i,role:i%2?'player':'host',endedAt,startedAt,honors}));
const cardPlayers=lineups.map(p=>({userId:p.userId,nickname:p.nickname,seat:p.seat,power:12345}));
const cards=['room','boss','ranking'].map((subtype,i)=>({id:'card_battle:'+i,kind:'card_battle',subtype,title:subtype==='boss'?'黑夜BOSS':'测试对战',endedAt,startedAt,players:subtype==='boss'?[...cardPlayers.map((p,i)=>({...p,seat:1,playerSeat:i+1})),{userId:'u3',nickname:'第三位队友',seat:1,playerSeat:3,power:12000}]:cardPlayers,winnerSeat:1,rankState:'known',finalRank:6}));
const impostor={id:'impostor:1',kind:'impostor',subtype:'impostor',title:'谁是伪人测试房',winner:'good',endedAt,startedAt,players:[{userId:'u1',nickname:'我方昵称',seat:1,role:'detective'},{userId:'u2',nickname:'伪人玩家',seat:2,role:'impostor'},{userId:'u3',nickname:'平民玩家',seat:3,role:'civilian'}]};
const state={day:2,phase:'ended',endReason:'成功指认伪人',successes:1,failures:1,history:[],nightActions:{},investigations:{},missionChoices:{},clues:{},nomination:null,accusation:null,players:impostor.players};
const messages=Array.from({length:105},(_,i)=>({id:'m'+i,sequence:String(i+1),type:i===104?'ai_honor':i===0?'question':'discussion',senderId:'u1',senderName:'我方昵称',content:i===0?'这是最佳提问吗':i===104?JSON.stringify(honors):'会话消息 '+i,createdAt:startedAt,questionNumber:i===0?1:null,answer:i===0?'yes':null}));
const bundle=await build({stdin:{resolveDir:resolve('apps/web'),loader:'tsx',contents:`
  import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route,useLocation,useNavigate}from'react-router-dom';
  import GameRecordsPage from './src/pages/GameRecordsPage';import MinePage from './src/pages/MinePage';import {RouteScrollManager} from './src/components/RouteScrollManager';import MainLayout from './src/layouts/MainLayout';
  function Shell(){const location=useLocation();window.currentRoute=location.pathname+location.search;window.go=useNavigate();return <div style={{minHeight:'200vh'}}><RouteScrollManager/><Routes><Route element={<MainLayout/>}><Route path="/mine" element={<MinePage/>}/><Route path="/mine/game-records" element={<GameRecordsPage/>}/></Route></Routes></div>}
  const root=createRoot(document.getElementById('root'));let mount=0;window.mountRecords=(entry='/mine')=>root.render(<MemoryRouter key={++mount} initialEntries={[entry]}><Shell/></MemoryRouter>);window.mountRecords();
`},bundle:true,write:false,metafile:true,format:'iife',loader:{'.webp':'dataurl'},define:{'import.meta.env':'{}'},plugins:[{name:'isolate-services',setup(builder){
  builder.onLoad({filter:/[\\/]context[\\/]AppContext\.tsx$/},()=>({loader:'js',contents:`const context={user:{id:'u1',nickname:'我方昵称',role:'user'},loadingUser:false,showToast:()=>{},openAuth:()=>{},setUser:()=>{},triggerRefresh:()=>{}};export function useApp(){return context}export const formatViews=String,soupDifficulties=[],soupTypes=[];`}));
  builder.onLoad({filter:/[\\/]shared[\\/]useMessageUnread\.ts$/},()=>({loader:'js',contents:'export function useMessageUnread(){return 0}export function useMessageUnreadCounts(){return {total:0,circleUnclaimedRedPackets:0,circleMentions:0}}'}));
  builder.onLoad({filter:/[\\/]shared[\\/]useShellBalance\.ts$/},()=>({loader:'js',contents:'export function useShellBalance(){return 0}export function publishShellBalance(){}'}));
  builder.onLoad({filter:/[\\/]api\.ts$/},()=>({loader:'js',contents:'export class ApiError extends Error{};export const api=(...args)=>window.fixtureApi(...args);export const prefetchApi=async()=>{};export function invalidateApiCache(){}'}));
}}]});
const content=Object.keys(bundle.metafile.inputs).filter(path=>path.startsWith('apps/web/src/')&&/\.[tj]sx?$/.test(path)).map(path=>readFileSync(path,'utf8')).join('\n');
const css=(await postcss([tailwindcss({...loadConfig(resolve('apps/web/tailwind.config.ts')),content:[{raw:content,extension:'tsx'}]})]).process(readFileSync('apps/web/src/styles.css','utf8').replace('@import "./cardBattleEffects.css";',readFileSync('apps/web/src/cardBattleEffects.css','utf8')),{from:undefined})).css;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM==='1'?undefined:'msedge',headless:true});
const output=mkdtempSync(resolve(tmpdir(),'hgt-game-records-'));
try {
  for(const [width,height] of [[320,568],[375,812],[1024,900],[1440,1000],[812,375]]) {
    const page=await browser.newPage({viewport:{width,height},hasTouch:width<1000});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>',contentType:'text/html'}):route.abort());
    await page.goto('http://game-records.test');
    await page.evaluate(({soups,cards,impostor,state,messages,replay})=>{
      window.calls=[];window.fixtureApi=async(path,options)=>{window.calls.push({path,method:options?.method??'GET'});const url=new URL(path,location.origin);
        if(url.pathname==='/api/online-soup/game-records') {const kind=url.searchParams.get('kind'),mode=url.searchParams.get('subtype'),page=Number(url.searchParams.get('page'));const records=kind==='soup'?soups:kind==='impostor'?[impostor]:cards.filter(r=>mode==='all'||r.subtype===mode);return {records:records.slice((page-1)*10,page*10),total:records.length};}
        if(url.pathname.startsWith('/api/online-soup/game-records/')) {const id=decodeURIComponent(url.pathname.split('/').at(-1));const record=[...soups,...cards,impostor].find(r=>r.id===id);if(record.kind==='card_battle')return{record,replay};const after=Number(url.searchParams.get('after')??0),all=messages.filter(m=>Number(m.sequence)>after),batch=all.slice(0,100);return {record,messages:batch,hasMore:all.length>100,nextCursor:batch.at(-1)?.sequence,...(record.kind==='impostor'?{state,steps:[{state:{...state,recordAction:{kind:'nomination',label:'任务投票',userId:'u3',day:1,attempt:2,targets:['u2']}}}],legacy:true}:{})};}
        if(path.includes('/profile'))return{profile:{id:'u1',nickname:'我方昵称',level:1,receivedLikeCount:0,followingCount:0,followerCount:0}};
        if(path.includes('content-counts'))return{published:0,favorites:0,likes:0};
        if(path.includes('/soups'))return{soups:[],total:0,hasMore:false};
        if(path.includes('/vip/')||path.includes('/shells'))throw new Error('isolated');
        return{};
      };
    },{soups,cards,impostor,state,messages,replay});
    await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
    const panel=page.locator(width>=1024?'.mine-feature-panel-desktop':'.mine-feature-panel-mobile');
    const features=panel.locator('.mine-feature-card:visible');
    await expect(features).toHaveCount(width>=1024?4:7);
    const labels=await features.locator('.mine-feature-copy > span:first-child').allTextContents();
    assert.deepEqual(labels,width>=1024?['收藏','成就','游戏记录','优秀作者']:['商城','收藏','成就','排行','游戏记录','优秀作者','任务中心']);
    if(width<1024){const boxes=await features.evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y})));assert.equal(boxes[0].y,boxes[3].y);assert.equal(boxes[4].y,boxes[6].y);assert.ok(boxes[4].y>boxes[3].y);assert.equal(boxes[0].x,boxes[4].x);}
    await features.filter({hasText:'游戏记录'}).click();await expect(page.locator('main article')).toHaveCount(10);
    await expect(page.locator('.desktop-module-hero')).toHaveCount(1);
    if(width>=1024){
      await expect(page.getByRole('navigation',{name:'主导航',exact:true})).toBeVisible();
      await expect(page.locator('.main-layout-desktop-secondary')).toBeVisible();
      await expect(page.locator('.main-layout .top-nav-shell')).toBeHidden();
      await expect(page.locator('.main-layout + nav')).toBeHidden();
      await expect(page.locator('.desktop-secondary-back-row')).toBeVisible();
    }else{
      await expect(page.locator('.desktop-module-hero')).toBeHidden();
      await expect(page.locator('.main-layout .top-nav-shell')).toBeVisible();
      await expect(page.locator('.main-layout + nav')).toBeVisible();
    }
    await page.screenshot({path:resolve(output,`entry-${width}.png`)});
    await expect(page.getByText('2026/09/01 19:28',{exact:true}).first()).toBeVisible();
    await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.locator('main article')).toHaveCount(3);
    await page.evaluate(()=>window.scrollTo(0,80));
    await page.getByRole('button',{name:/测试汤 10/}).scrollIntoViewIfNeeded();const savedScroll=await page.evaluate(()=>window.scrollY);
    await page.getByRole('button',{name:/测试汤 10/}).click();await expect(page.getByText('主持人回答：是',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'加载后续会话'}).click();await expect(page.getByText('游戏结束 · 2026/09/01 19:28',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'关闭游戏记录'}).click();await expect(page.getByRole('button',{name:'关闭游戏记录'})).toHaveCount(0);assert.match(await page.evaluate(()=>window.currentRoute),/page=2/);await expect(page.locator('main article')).toHaveCount(3);assert.equal(await page.evaluate(()=>window.scrollY),savedScroll);
    await page.getByRole('tab',{name:'谁是伪人',exact:true}).click();await page.getByRole('button',{name:/谁是伪人测试房/}).click();await page.getByRole('tab',{name:'游戏进程',exact:true}).click();
    await expect(page.getByText('侦探',{exact:true})).toBeVisible();await expect(page.getByText('伪人',{exact:true})).toBeVisible();await expect(page.getByText('3号 平民玩家：任务投票（第2轮） 2号 伪人玩家',{exact:false})).toBeVisible();
    await page.getByRole('button',{name:'关闭游戏记录'}).click();await page.getByRole('tab',{name:'卡牌对战',exact:true}).click();await expect(page.locator('main article')).toHaveCount(3);
    await page.getByRole('tab',{name:'BOSS对战',exact:true}).click();await expect(page.locator('main article')).toHaveCount(1);await expect(page.getByText('第三位队友',{exact:true})).toBeVisible();
    await page.getByRole('tab',{name:'排行榜对战',exact:true}).click();await expect(page.getByText('最后排名：第 6 名',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'查看结算',exact:true}).click();await expect(page.getByRole('table')).toHaveCount(2);await expect(page.getByRole('button',{name:'跳过动画'})).toHaveCount(0);await page.getByRole('button',{name:'关闭回放'}).click();
    await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
    await page.getByRole('button',{name:'查看回放',exact:true}).click();await expect(page.getByRole('button',{name:'跳过动画'})).toBeInViewport();await expect(page.getByRole('table')).toHaveCount(0);
    await page.clock.runFor(2500);
    assert.ok(await page.locator('.card-battle-half').evaluateAll(halves=>halves.every(half=>{const bounds=half.getBoundingClientRect();return [...half.querySelectorAll('[data-battle-row]')].every(row=>row.getBoundingClientRect().right<=bounds.right+1);})), 'Formation fits its half');
    await page.screenshot({path:resolve(output,`replay-${width}.png`)});
    await page.getByRole('button',{name:'跳过动画'}).click();await expect(page.getByRole('table')).toHaveCount(2);await page.getByRole('button',{name:'关闭回放'}).click();
    assert.match(await page.evaluate(()=>window.currentRoute),/mode=ranking/);await expect(page.locator('main article')).toHaveCount(1);
    await page.getByRole('button',{name:'查看回放',exact:true}).click();await expect(page.getByRole('button',{name:'跳过动画'})).toBeVisible();await page.clock.fastForward(result.playbackDurationMs+2000);await expect(page.getByRole('table')).toHaveCount(2);await page.getByRole('button',{name:'关闭回放'}).click();await expect(page.getByRole('button',{name:'关闭回放'})).toHaveCount(0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.ok(await page.evaluate(()=>window.calls.every(call=>call.method==='GET')));
    await page.evaluate(()=>window.mountRecords('/mine/game-records?kind=soup&page=2'));
    await expect(page.locator('main article')).toHaveCount(3);
    await expect(page.locator('.main-layout-desktop-secondary')).toHaveCount(1);
    if(width>=1024)await expect(page.getByRole('navigation',{name:'主导航',exact:true})).toBeVisible();
    const back=page.locator(width>=1024?'.desktop-secondary-back-row button':'.mine-back-button');
    await back.click();await expect(features).toHaveCount(width>=1024?4:7);
    assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${width}x${height}: real layout, entry/direct route/back, 10/page, conversation, filters, settlement and replay`);
  }
  console.log('Screenshots: '+output);
}finally{await browser.close();}
