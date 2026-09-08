import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const bundle = await build({stdin:{resolveDir:resolve('apps/web'),loader:'tsx',contents:`
import React from'react';import{createRoot}from'react-dom/client';import{MemoryRouter,useLocation}from'react-router-dom';
import{CardBattleRankingBoard}from'./src/components/CardBattleRankingBoard';import ErrorBoundary from'./src/components/ErrorBoundary';
const cards=Array.from({length:6},(_,i)=>({id:'c'+i,name:'测试卡'+(i+1),cardNo:String(i+1),imageUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="210"><rect width="150" height="210" fill="#ddd6fe"/><text x="75" y="110" text-anchor="middle" font-size="40" fill="#6d28d9">'+(i+1)+'</text></svg>'),starLevel:3,combatPower:6000,battleRole:'damage',rarity:'legend',stats:{maxHp:1000,attack:200,defense:100,speed:120,energyRequired:40},skillName:'测试技能',skillDescription:'对目标造成伤害'}));
window.claimed=false;window.saved=[];window.toasts=[];window.rejectSave=true;
window.fetch=async(url,options={})=>{const path=String(url);let status=200;let data={};
  if(path.endsWith('/decks')&&options.method==='POST'){const body=JSON.parse(options.body);if(window.rejectSave){status=409;data={error:'卡组保存失败，请重试'}}else{window.saved.push(body);data={deck:{...body,id:'deck1',collectibles:[]}}}}
  else if(path.endsWith('/decks'))data={decks:[]};else if(path.includes('eligible-cards'))data={cards};
  else if(path.endsWith('/claim')){window.claimed=true;data={entry:{rank:2}}}
  else if(path.includes('card-battle-rankings'))data={ownRank:window.claimed?2:null,limit:10,entries:[{rank:1,occupied:true,user:{id:'defender',nickname:'守榜玩家'},starTotal:15,totalPower:30000},window.claimed?{rank:2,occupied:true,user:{id:'u1',nickname:'首次玩家'},starTotal:15,totalPower:30000}:{rank:2,occupied:false}]};
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
};
function Harness(){const location=useLocation();window.currentPath=location.pathname;return<CardBattleRankingBoard currentUserId="u1" showToast={message=>window.toasts.push(message)}/>}
createRoot(document.getElementById('root')).render(<MemoryRouter><ErrorBoundary><Harness/></ErrorBoundary></MemoryRouter>);
`},bundle:true,write:false,format:'iife',define:{'import.meta.env':'{}'}});
const css = readFileSync(resolve('apps/web/dist/assets',readdirSync('apps/web/dist/assets').find(name=>name.startsWith('index-')&&name.endsWith('.css'))),'utf8');
mkdirSync('artifacts/bugfix-ranking-shell',{recursive:true});
const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM==='1'?undefined:'msedge',headless:true});
try {
  for (const [name,width,height] of [['desktop',1365,900],['mobile',375,812]]) {
    const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.abort());
    await page.setContent('<div id="root"></div>');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.getByRole('button',{name:/空位，点击占据/}).click();
    const save=page.getByRole('button',{name:'保存默认卡组并占榜'});
    await expect(save).toBeDisabled();
    for(let i=1;i<=5;i++)await page.getByRole('button',{name:'选择测试卡'+i,exact:true}).click();
    await expect(page.getByRole('button',{name:'选择测试卡1',exact:true})).toBeDisabled();
    await expect(save).toBeEnabled();
    await save.click();await expect(page.getByRole('alert')).toHaveText('卡组保存失败，请重试');
    await expect(page.getByRole('status')).toContainText('已选 5/5 张');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.screenshot({path:resolve('artifacts/bugfix-ranking-shell',`default-deck-${name}.png`)});
    await page.getByRole('heading',{name:'占据第 2 名'}).scrollIntoViewIfNeeded();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.screenshot({path:resolve('artifacts/bugfix-ranking-shell',`default-deck-${name}-top.png`)});
    await page.evaluate(()=>window.rejectSave=false);await save.click();
    await expect(page.getByRole('button',{name:/首次玩家/})).toBeVisible();
    assert.deepEqual(await page.evaluate(()=>window.saved),[{name:'默认卡组',cardIds:['c0','c1','c2','c3','c4'],collectibleBindings:[]}]);
    assert.deepEqual(await page.evaluate(()=>window.toasts),['已占据卡牌对战榜第 2 名']);
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS: desktop/mobile default deck configuration, distinct slots, save validation/retry and immediate occupancy.');
} finally {await browser.close()}
