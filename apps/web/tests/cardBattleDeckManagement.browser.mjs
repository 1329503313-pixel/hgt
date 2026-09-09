// Exercises the real room/ranking lists with mocked HTTP; no database access.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
const android = process.env.HGT_TEST_ANDROID === '1';

const bundle = await build({ stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
import {CardBattleRoomView} from './src/components/CardBattleRoomView';import {CardBattleRankingBoard} from './src/components/CardBattleRankingBoard';
import {closeTopAndroidLayer} from './src/android/backStack';window.androidBack=closeTopAndroidLayer;
const mode=window.testMode;const size=mode==='boss'?3:5;
const cards=Array.from({length:6},(_,i)=>({id:'c'+i,name:'测试卡'+(i+1),cardNo:String(i+1),imageUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="210"><rect width="150" height="210" fill="#ddd6fe"/><text x="75" y="110" text-anchor="middle" font-size="40" fill="#6d28d9">'+(i+1)+'</text></svg>'),starLevel:3,combatPower:6000,battleRole:'damage',rarity:'legend',stats:{maxHp:1000,attack:200,defense:100,speed:120,energyRequired:40},skillName:'测试技能',skillDescription:'对目标造成伤害'}));
const bindings=[{cardId:'c0',collectibleId:'item0'},{cardId:'c1',collectibleId:'item1'}];
window.deck={id:'deck1',name:'原卡组',cardIds:cards.slice(0,size).map(card=>card.id),collectibleBindings:bindings,collectiblesAvailable:true,collectibles:[]};
window.requests=[];window.toasts=[];window.rejectMutation=false;window.holdMutation=false;
window.fetch=async(url,options={})=>{
 const path=String(url),method=options.method||'GET';let data={},status=200;
 if(method==='PATCH'||method==='DELETE'||method==='PUT'){
  const body=options.body?JSON.parse(options.body):undefined;window.requests.push({path,method,body});
  if(window.holdMutation)await new Promise(resolve=>window.releaseMutation=resolve);
  if(window.rejectMutation){status=409;data={error:'操作失败，请重试'}}
  else if(method==='DELETE'){window.deck=null;data={ok:true}}
  else if(method==='PATCH'){window.deck={...window.deck,...body};data={deck:window.deck}}
  else data={ok:true};
 }else if(path.endsWith('/decks'))data={decks:window.deck?[window.deck]:[]};
 else if(path.includes('eligible-cards'))data={cards};
 else if(path.includes('card-battle-rankings'))data={ownRank:null,entries:[{rank:1,occupied:false}],limit:10};
 else if(path.endsWith('/collectibles'))data={collectibles:[]};
 else throw new Error('Unexpected request: '+method+' '+path);
 return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
};
const snapshot={messages:[],members:[{id:'u1',nickname:'玩家'}],me:{isHost:true},room:{id:'r1',name:'卡组管理测试',code:'123456',contentType:'card_battle',status:'preparing',cardBattle:{mode:mode==='boss'?'boss':'1v1',phase:'preparing',me:{userId:'u1',seat:1,collectibleBindings:bindings},game:null,seats:Array.from({length:mode==='boss'?3:2},(_,i)=>({seat:i+1,user:i===0?{id:'u1',nickname:'玩家',avatar:null}:null,ready:false,lineup:Array.from({length:size},(_,slot)=>({slot:slot+1,card:i===0?cards[slot]:null,cardBack:false}))})),boss:mode==='boss'?{available:true,lineup:cards.slice(0,5),rewardShells:100}:null}}};
const noop=()=>{},reload=async()=>{},toast=message=>window.toasts.push(message);
createRoot(document.getElementById('root')).render(<MemoryRouter>{mode==='ranking'?<CardBattleRankingBoard currentUserId="u1" showToast={toast}/>:<CardBattleRoomView roomId="r1" snapshot={snapshot} stickerSeries={[]} stickersLoading={false} onReload={reload} onReloadMessages={reload} onOpenInvite={noop} onOpenMembers={noop} showToast={toast}/>}</MemoryRouter>);
` }, bundle: true, write: false, format: 'iife', define: { 'import.meta.env': JSON.stringify(android ? { VITE_HGT_TARGET: 'android' } : {}) } });
const css = readFileSync(resolve('apps/web/dist/assets', readdirSync('apps/web/dist/assets').find(name => name.startsWith('index-') && name.endsWith('.css'))), 'utf8');
const output = resolve('artifacts/card-battle-decks');mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === '1' ? undefined : 'msedge', headless: true });
try {
  for (const mode of ['normal', 'boss', 'ranking']) for (const [viewportName, width, height] of [['desktop', 1440, 1000], ['mobile', 375, 812], ['landscape', 812, 375]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
    await page.evaluate(mode => window.testMode = mode, mode);await page.addStyleTag({ content: css });await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole('button', { name: mode === 'ranking' ? /空位，点击占据/ : '选择卡组', exact: mode !== 'ranking' }).click();
    await page.getByRole('button', { name: '修改名称', exact: true }).click();
    const rename = page.getByRole('dialog', { name: '修改卡组名称' });
    await rename.getByRole('textbox', { name: /卡组名称/ }).fill('   ');await expect(rename.getByRole('button', { name: '保存名称' })).toBeDisabled();
    await rename.getByRole('textbox', { name: /卡组名称/ }).fill('  已修改卡组  ');
    await page.evaluate(() => { window.rejectMutation = true; window.holdMutation = true; });
    await rename.getByRole('button', { name: '保存名称' }).click();await expect(rename.getByRole('button', { name: '关闭修改卡组名称' })).toBeDisabled();
    if (android) { await page.evaluate(() => window.androidBack()); await expect(rename).toBeVisible(); }
    await expect.poll(() => page.evaluate(() => typeof window.releaseMutation)).toBe('function');
    await page.evaluate(() => window.releaseMutation());await expect(rename.getByRole('alert')).toHaveText('操作失败，请重试');
    await expect(rename.getByRole('textbox', { name: /卡组名称/ })).toHaveValue('  已修改卡组  ');
    await page.evaluate(() => { window.rejectMutation = false; window.holdMutation = false; });
    await rename.getByRole('button', { name: '保存名称' }).click();await expect(rename).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '已修改卡组', exact: true })).toBeVisible();
    await page.screenshot({ path: resolve(output, mode + '-' + viewportName + '-list.png') });
    const before = await page.evaluate(() => window.deck);
    assert.deepEqual(await page.evaluate(() => window.requests.at(-1).body), { name: '已修改卡组' });

    await page.getByRole('button', { name: '编辑卡组', exact: true }).click();
    let editor = page.getByRole('dialog', { name: '编辑卡组' });
    await editor.getByRole('button', { name: '配置前排 1', exact: true }).click();
    await expect(editor.getByRole('button', { name: '选择测试卡2', exact: true })).toBeDisabled();
    await editor.getByRole('button', { name: '选择测试卡6', exact: true }).click();
    await expect(editor.getByRole('button', { name: '配置前排 1', exact: true })).toContainText('测试卡6');
    await expect(editor.getByRole('button', { name: /装配收藏品/ })).toContainText('（1）');
    assert.deepEqual(await page.evaluate(() => window.deck), before);
    await editor.getByRole('button', { name: '关闭编辑卡组' }).click();
    await page.getByRole('button', { name: '编辑卡组', exact: true }).click();editor = page.getByRole('dialog', { name: '编辑卡组' });
    await expect(editor.getByRole('button', { name: '配置前排 1', exact: true })).toContainText('测试卡1');
    await editor.getByRole('button', { name: '选择测试卡6', exact: true }).click();
    await page.evaluate(() => window.rejectMutation = true);await editor.getByRole('button', { name: '保存卡组', exact: true }).click();
    await expect(editor.getByRole('alert')).toHaveText('操作失败，请重试');
    await expect(editor.getByRole('button', { name: '配置前排 1', exact: true })).toContainText('测试卡6');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await editor.getByRole('heading', { name: '编辑卡组' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, mode + '-' + viewportName + '-editor.png') });
    if (android) {
      await page.evaluate(() => window.androidBack());await expect(editor).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '已修改卡组', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '编辑卡组', exact: true }).click();
      await editor.getByRole('button', { name: '选择测试卡6', exact: true }).click();
    }
    await page.evaluate(() => window.rejectMutation = false);await editor.getByRole('button', { name: '保存卡组', exact: true }).click();
    await expect(editor).toHaveCount(0);
    const changed = await page.evaluate(() => window.deck);
    assert.deepEqual(changed.cardIds, ['c5', ...before.cardIds.slice(1)]);
    assert.deepEqual(changed.collectibleBindings, [{ cardId: 'c1', collectibleId: 'item1' }]);
    assert.ok((await page.evaluate(() => window.requests)).every(request => !request.path.endsWith('/lineup')));
    if (viewportName === 'desktop') {
      await page.evaluate(() => window.deck.cardIds[0] = 'missing');
      await page.getByRole('button', { name: mode === 'ranking' ? '关闭卡组选择' : '关闭', exact: true }).click();
      await page.getByRole('button', { name: mode === 'ranking' ? /空位，点击占据/ : '选择卡组', exact: mode !== 'ranking' }).click();
      await page.getByRole('button', { name: '编辑卡组', exact: true }).click();
      const repair = page.getByRole('dialog', { name: '编辑卡组' });
      await expect(repair.getByRole('button', { name: '配置前排 1', exact: true })).toContainText('卡牌不可用');
      await expect(repair.getByRole('button', { name: '保存卡组', exact: true })).toBeDisabled();
      await repair.getByRole('button', { name: '选择测试卡6', exact: true }).click();
      await repair.getByRole('button', { name: '保存卡组', exact: true }).click();await expect(repair).toHaveCount(0);
    }
    await page.getByRole('button', { name: '删除卡组', exact: true }).click();
    const deletion = page.getByRole('dialog', { name: '删除卡组' });
    await deletion.getByRole('button', { name: '取消' }).click();assert.ok(await page.evaluate(() => window.deck));
    await page.getByRole('button', { name: '删除卡组', exact: true }).click();
    await page.evaluate(() => window.rejectMutation = true);await deletion.getByRole('button', { name: '确认删除' }).click();
    await expect(deletion.getByRole('alert')).toHaveText('操作失败，请重试');assert.ok(await page.evaluate(() => window.deck));
    await page.evaluate(() => window.rejectMutation = false);await deletion.getByRole('button', { name: '确认删除' }).click();
    await expect(deletion).toHaveCount(0);await expect(page.getByRole('heading', { name: '已修改卡组', exact: true })).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.deck), null);
    const requests = await page.evaluate(() => window.requests);
    assert.ok(requests.every(request => request.path === (mode === 'ranking' ? '/api/online-soup/card-battle/decks/deck1' : '/api/online-soup/rooms/r1/card-battle/decks/deck1')));
    assert.deepEqual(errors, []);await page.close();
    console.log('PASS: ' + mode + ' ' + viewportName + ' rename/edit/delete, draft cancellation, retry, bindings and API scope');
  }
} finally { await browser.close(); }
