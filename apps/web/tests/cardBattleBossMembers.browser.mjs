// Render the complete room page, including the card-room early return and member dialogs.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const bundle = await build({
  stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';
    import Room from './src/pages/OnlineSoupRoomPage';
    const members=['房主甲','队友乙','观众丙'].map((nickname,i)=>({id:'u'+i,nickname,role:i===1?'player':'spectator',isRoomHost:i===0,level:1,vipLevel:0,vipActive:false,avatar:null,mutedUntil:null}));
    const seats=[1,2,3].map(seat=>({seat,user:seat===1?members[1]:null,ready:false,lineup:[1,2,3].map(slot=>({slot,card:null,cardBack:false}))}));
    window.fixture={room:{id:'room',code:'123456',name:'协作挑战',contentType:'card_battle',hostMode:'human',status:'preparing',cardBattle:{mode:'boss',phase:'preparing',seats,me:{userId:'u0',seat:null,eligibleCardCount:0},boss:{name:'深海守卫',clearLabel:'cleared',available:true,rewardShells:500,lineup:[],rewardClaimed:false},game:null}},me:{isHost:true,role:'spectator'},members,messages:[]};
    window.requests=[];
    createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/online-soup/rooms/room']}><Routes><Route path='/online-soup/rooms/:roomId' element={<Room/>}/><Route path='*' element={<p>已返回大厅</p>}/></Routes></MemoryRouter>);
  ` }, bundle: true, write: false, format: 'iife', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'local-room-services', setup(build) {
    build.onLoad({ filter: /[\\/]context[\\/]AppContext\.tsx$/ }, () => ({ loader: 'js', contents: `const context={user:{id:'u0',nickname:'房主甲'},loadingUser:false,showToast(message){window.toast=message},openAuth(){}};export function useApp(){return context}` }));
    build.onLoad({ filter: /[\\/]context[\\/]OnlineSoupDockContext\.tsx$/ }, () => ({ loader: 'js', contents: `const context={minimizeRoom(){},showFullRoom(){},syncRoomBackgroundMusic(){},toggleBackgroundMusicMuted(){}};export function useOnlineSoupDock(){return context}` }));
    build.onLoad({ filter: /[\\/]context[\\/]OnlineSoupVoiceContext\.tsx$/ }, () => ({ loader: 'js', contents: `const context={sync(){},disconnect(){}};export function useOnlineSoupVoice(){return context}` }));
    build.onLoad({ filter: /[\\/]shared[\\/]onlineSoupSocket\.ts$/ }, () => ({ loader: 'js', contents: `export function connectOnlineSoupSocket(id,changed){window.roomChanged=changed;return ()=>{}}` }));
    build.onLoad({ filter: /[\\/]api\.ts$/ }, () => ({ loader: 'js', contents: `
      export class ApiError extends Error{}
      export async function api(path,options={}){
        window.requests.push({path,...options});
        if(path==='/api/stickers')return {series:[]};
        if(options.method==='POST'){
          if(path.endsWith('/kick')){const id=path.split('/').at(-2);window.fixture.members=window.fixture.members.filter(m=>m.id!==id);window.fixture.room.cardBattle.seats=window.fixture.room.cardBattle.seats.map(s=>s.user?.id===id?{...s,user:null}:s)}
          if(path.endsWith('/transfer-host'))window.fixture.me.isHost=false;
          return {ok:true};
        }
        if(path.includes('/eligible-cards'))return {cards:[]};
        if(path.includes('/decks'))return {decks:[]};
        return structuredClone(window.fixture);
      }
    ` }));
  } }],
});
const cssFile = readdirSync('apps/web/dist/assets').find(file => file.startsWith('index-') && file.endsWith('.css'));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === '1' ? undefined : 'msedge', headless: true });
try {
  for (const [width,height] of [[375,812],[1280,900]]) {
    const page = await browser.newPage({ viewport: {width,height} });
    const errors=[];page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.route('**/*', route => route.request().url()==='http://boss-room.test/' ? route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'}) : route.abort());
    await page.goto('http://boss-room.test/');
    await page.addStyleTag({content:readFileSync(resolve('apps/web/dist/assets',cssFile),'utf8')});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await expect(page.getByText('深海守卫 · 已通关（招募标签）')).toBeVisible();
    await page.getByRole('button',{name:'更多操作',exact:true}).click();
    await expect(page.getByRole('button',{name:'退出房间',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'选择玩法',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'更多操作',exact:true}).click();
    await page.getByRole('button',{name:'房间成员，共 3 人'}).click();
    await expect(page.getByText('房主',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'管理队友乙',exact:true}).click();
    await page.evaluate(()=>{window.fixture.room.status='playing';window.roomChanged('host_transferred',{});});
    await expect(page.getByText('对局中的游戏者席位已锁定，不能踢出；请等待本局结束。')).toBeVisible();
    await expect(page.getByRole('button',{name:'踢出房间',exact:true})).toHaveCount(0);
    await page.evaluate(()=>{window.fixture.room.status='preparing';window.roomChanged('host_transferred',{});});
    await page.getByRole('button',{name:'踢出房间',exact:true}).click();
    await page.getByRole('button',{name:'确认踢出',exact:true}).click();
    await expect(page.getByRole('button',{name:'房间成员，共 2 人'})).toBeVisible();
    assert.equal(await page.evaluate(()=>window.requests.some(r=>r.path.endsWith('/members/u1/kick'))),true);
    // A spectator can receive ownership through the same member management dialog.
    await page.getByRole('button',{name:'房间成员，共 2 人'}).click();
    await page.getByRole('button',{name:'管理观众丙',exact:true}).click();
    await page.getByRole('button',{name:'转让房主',exact:true}).click();
    await page.getByRole('button',{name:'确认转让',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.requests.some(r=>r.path.endsWith('/members/u2/transfer-host'))),true);
    await page.getByRole('button',{name:'房间成员，共 2 人'}).click();
    await expect(page.getByRole('button',{name:'管理观众丙',exact:true})).toHaveCount(0);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('PASS: complete BOSS room page on phone/desktop, host exit, kick confirmation/seat refresh, spectator host transfer, permission refresh.');
} finally { await browser.close(); }
