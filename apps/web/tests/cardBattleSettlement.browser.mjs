// Real settlement UI; no API/database access. Run after build:all.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
const bundle = await build({stdin:{resolveDir:resolve("apps/web"),loader:"tsx",contents:`
  import React,{useState}from'react';import{createRoot}from'react-dom/client';import{Settlement}from'./src/components/CardBattleRoomView';
  const cards=Array.from({length:5},(_,index)=>({slot:index+1,cardId:'c'+index,name:index===1?'八字超级治疗使者':'星辉骑士',damageDealt:index===2?1234567890:1500,damageTaken:2000,healingDone:5000,supportDone:8000}));
  const players=[{seat:1,userId:'u1',nickname:'胜利玩家',cards},{seat:2,userId:'u2',nickname:'失败玩家',cards:cards.map(card=>({...card,damageDealt:0,damageTaken:0,healingDone:5000,supportDone:0,score:0}))}];
  function Harness(){const[mode,setMode]=useState('normal');window.setMode=setMode;return<main style={{height:'100dvh',position:'relative',background:'#071426'}}><Settlement battle={{me:{userId:'u1'},rankingChallenge:mode==='ranking'?{targetRank:7}:null,game:{settlement:{winnerSeat:1,rounds:8,endReason:'elimination',players}}}} confirming={mode==='confirming'} onClose={()=>window.closedSettlement=true} onConfirmRankingWin={()=>window.confirmedRanking=true}/></main>};
  createRoot(document.getElementById('root')).render(<Harness/>);
`},bundle:true,write:false,format:"iife",define:{"import.meta.env":"{}"}});
const css=readdirSync(resolve("apps/web/dist/assets")).find(file=>file.startsWith("index-")&&file.endsWith(".css"));
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM==='1'?undefined:'msedge',headless:true});
const output=mkdtempSync(resolve(tmpdir(),"hgt-settlement-"));
try{
 const page=await browser.newPage({reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.abort());await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
 await page.addStyleTag({content:readFileSync(resolve('apps/web/dist/assets',css),'utf8')});await page.addScriptTag({content:bundle.outputFiles[0].text});
 await expect(page.getByRole('table')).toHaveCount(2);
 await expect(page.getByRole('table').first().locator('thead th')).toHaveText(['卡牌','伤害','承伤','辅助','评分']);
 await expect(page.getByRole('table').first().locator('tbody tr').first().locator('td')).toHaveText(['1500','2000','8000','9.9']);
 await expect(page.getByRole('table').last().locator('tbody tr').first().locator('td')).toHaveText(['0','0','0','0.0']);
 for(const viewport of [{width:320,height:568},{width:375,height:812},{width:812,height:375},{width:1440,height:1000}]){
  await page.setViewportSize(viewport);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const fit=await page.getByRole('table').evaluateAll(tables=>tables.every(table=>getComputedStyle(table.parentElement).overflowX==='auto'&&[...table.querySelectorAll('td,th')].every(cell=>cell.scrollWidth<=cell.clientWidth+1)&&[...table.querySelectorAll('td')].every(cell=>getComputedStyle(cell).whiteSpace==='nowrap')));
  assert.ok(fit,'大数值和长卡名不跨列或截断');
  if(viewport.width===375)await page.screenshot({path:resolve(output,'settlement-mobile.png')});
  if(viewport.width===1440)await page.screenshot({path:resolve(output,'settlement-desktop.png')});
 }
 await page.getByRole('button',{name:'关闭结算'}).click();assert.equal(await page.evaluate(()=>window.closedSettlement),true);
 await page.evaluate(()=>window.setMode('ranking'));
 await expect(page.getByRole('button',{name:'关闭结算'})).toHaveCount(0);
 await page.getByRole('button',{name:'确认胜利并占据第 7 名'}).click();assert.equal(await page.evaluate(()=>window.confirmedRanking),true);
 assert.deepEqual(errors,[]);console.log('PASS: four numeric columns, score rounding and trailing zero, large numbers, long names, four viewports, close and ranking flow. Screenshots: '+output);
}finally{await browser.close();}
