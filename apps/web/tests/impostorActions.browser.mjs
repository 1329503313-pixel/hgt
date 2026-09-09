import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const bundle = await build({ stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {useImpostorActions} from './src/shared/useImpostorActions';import {impostorActionLabels} from './src/shared/impostorActions';
import {ImpostorChatActionCard} from './src/components/ImpostorGamePanel';import {ImpostorActionDialog} from './src/components/ImpostorActionDialog';
import {closeTopAndroidLayer} from './src/android/backStack';import {impostorFixture} from './tests/fixtures/impostorGame';
window.fixture=impostorFixture;window.androidBack=closeTopAndroidLayer;window.requests=[];window.toasts=[];window.fail=false;window.hold=false;window.refreshFail=false;
window.fetch=async(url,options)=>{window.requests.push({url:String(url),method:options.method,body:options.body?JSON.parse(options.body):undefined});
 if(window.hold)await new Promise(resolve=>window.release=resolve);
 return new Response(JSON.stringify(window.fail?{error:'提交失败，请重试'}:{ok:true}),{status:window.fail?409:200,headers:{'Content-Type':'application/json'}});
};
const members=['u1','u2','u3','u4'].map((id,index)=>({id,nickname:'玩家'+(index+1),role:'player'}));
function Harness(){const[game,setGame]=useState(impostorFixture()),[userId,setUser]=useState('u1'),[roomId,setRoom]=useState('r1'),[chatVisible,setChat]=useState(true);
 window.setGame=setGame;window.setUser=setUser;window.setRoom=setRoom;window.setChat=setChat;
 const actions=useImpostorActions({roomId,game,currentUserId:userId,onChanged:async()=>{if(window.refreshFail)throw new Error('refresh');},showToast:message=>window.toasts.push(message)});window.actions=actions;
 return <main className="mx-auto max-w-3xl p-4"><section aria-label="更多操作">{actions.pending&&<button className="btn btn-primary min-h-11" disabled={actions.saving} onClick={actions.openDialog}>{impostorActionLabels[actions.pending]}</button>}</section>
 <section aria-label="聊天栏">{chatVisible&&<ImpostorChatActionCard actions={actions} members={members} currentUserId={userId}/>}</section>
 <ImpostorActionDialog actions={actions} members={members} currentUserId={userId}/></main>;
}createRoot(document.getElementById('root')).render(<Harness/>);
` }, bundle: true, write: false, format: 'iife', define: { 'import.meta.env': '{"VITE_HGT_TARGET":"android"}' } });
const css = readFileSync(resolve('apps/web/dist/assets', readdirSync('apps/web/dist/assets').find(name => name.startsWith('index-') && name.endsWith('.css'))), 'utf8');
const out = resolve('artifacts/impostor-actions');mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === '1' ? undefined : 'msedge', headless: true });
const phases = [
  ['night', '夜间行动', '确认使用调查（2人）', 'night-action', { type: 'investigate', targetUserIds: ['u1', 'u2'] }],
  ['clue', '匿名留言', '提交留言', 'clue', { content: '这是我的线索' }],
  ['day_ready', '准备', '我已准备', 'ready', undefined],
  ['day_vote', '任务投票', '提交投票', 'nomination', { attempt: 1, candidateUserIds: ['u2', 'u3'] }],
  ['mission', '执行任务', '守护', 'mission', { choice: 'protect' }],
  ['assassination', '刺杀目标', '确认刺杀', 'assassinate', { targetUserId: 'u2' }],
  ['accusation', '最终公投', '确认公投', 'accuse', { attempt: 1, targetUserId: 'u2' }],
];
try {
  for (const [name, width, height] of [['desktop', 1365, 900], ['mobile', 375, 812], ['landscape', 812, 375]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });const errors = [];
    page.on('pageerror', error => errors.push(error.message));await page.route('**/*', route => route.abort());
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
    await page.addStyleTag({ content: css });await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const chat = page.getByRole('region', { name: '聊天栏' }), menu = page.getByRole('region', { name: '更多操作' });
    for (const [phase, label, submitLabel, endpoint, payload] of phases) {
      await page.evaluate(phase => { window.setGame(window.fixture(phase));window.requests=[];window.fail=false;window.refreshFail=false; }, phase);
      await expect(menu.getByRole('button', { name: label, exact: true })).toBeVisible();
      if (phase === 'night') { await chat.getByRole('button', { name: '调查', exact: true }).click();await chat.getByRole('button', { name: '1号 玩家1', exact: true }).click(); }
      if (phase === 'clue') await chat.getByRole('textbox').fill('原始线索');
      if (phase === 'day_vote') await chat.getByRole('button', { name: '2号 玩家2', exact: true }).click();
      await menu.getByRole('button', { name: label, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: label, exact: true });await expect(dialog).toBeVisible();
      if (phase === 'night') {
        await expect(dialog.getByRole('button', { name: '调查', exact: true })).toHaveAttribute('aria-pressed','true');
        await expect(dialog.getByRole('button', { name: '1号 玩家1', exact: true })).toHaveAttribute('aria-pressed','true');
        await dialog.getByRole('button', { name: '2号 玩家2', exact: true }).click();
        await expect(chat.getByRole('button', { name: '2号 玩家2', exact: true })).toHaveAttribute('aria-pressed','true');
        const deadline = await dialog.locator('.font-mono').textContent();assert.equal(await chat.locator('.font-mono').textContent(), deadline);
      }
      if (phase === 'clue') { await expect(dialog.getByRole('textbox')).toHaveValue('原始线索');await dialog.getByRole('textbox').fill('这是我的线索');await expect(chat.getByRole('textbox')).toHaveValue('这是我的线索'); }
      if (phase === 'day_vote') { await expect(dialog.getByRole('button', { name: '2号 玩家2', exact: true })).toHaveAttribute('aria-pressed','true');await dialog.getByRole('button', { name: '3号 玩家3', exact: true }).click(); }
      if (phase === 'assassination' || phase === 'accusation') { await expect(dialog.getByRole('button', { name: '1号 玩家1（自己）', exact: true })).toBeDisabled();await dialog.getByRole('button', { name: '2号 玩家2', exact: true }).click(); }
      await page.evaluate(() => window.setChat(false));await page.evaluate(() => window.setChat(true));
      await page.evaluate(() => window.androidBack());await expect(dialog).toHaveCount(0);
      await menu.getByRole('button', { name: label, exact: true }).click();
      if (phase === 'clue') await expect(dialog.getByRole('textbox')).toHaveValue('这是我的线索');
      if (phase === 'night') await expect(dialog.getByRole('button', { name: '2号 玩家2', exact: true })).toHaveAttribute('aria-pressed','true');
      await page.evaluate(() => { window.fail=true;window.hold=true; });
      await dialog.getByRole('button', { name: submitLabel, exact: true }).click();
      await expect(dialog.getByRole('button', { name: '关闭操作弹框' })).toBeDisabled();
      assert.ok(await chat.getByRole('button').evaluateAll(buttons => buttons.every(button => button.disabled)), '聊天中的操作也必须在提交中禁用');
      await page.evaluate(([endpoint,payload]) => { void window.actions.submit('impostor/'+endpoint,payload);window.androidBack(); }, [endpoint,payload]);
      assert.equal(await page.evaluate(() => window.requests.length),1);await expect(dialog).toBeVisible();
      await expect.poll(() => page.evaluate(() => typeof window.release)).toBe('function');await page.evaluate(() => window.release());
      await expect(dialog.getByRole('button', { name: submitLabel, exact: true })).toBeEnabled();
      assert.equal(await page.evaluate(() => window.toasts.at(-1)), '提交失败，请重试');
      if (phase === 'clue') await expect(dialog.getByRole('textbox')).toHaveValue('这是我的线索');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (phase === 'night' || phase === 'day_vote') await page.screenshot({ path: resolve(out, name+'-'+phase+'.png') });
      await page.evaluate(() => { window.fail=false;window.hold=false;window.refreshFail=true; });
      await dialog.getByRole('button', { name: submitLabel, exact: true }).click();
      await expect(dialog).toHaveCount(0);await expect(menu.getByRole('button')).toHaveCount(0);
      await expect(chat.getByRole('button')).toHaveCount(0);
      assert.deepEqual(await page.evaluate(() => window.requests.at(-1)), { url:'/api/online-soup/rooms/r1/impostor/'+endpoint,method:'POST',body:payload });
    }
    // A tied vote is a new action: close the old dialog and clear old targets.
    await page.evaluate(() => window.setGame(window.fixture('day_vote')));await menu.getByRole('button',{name:'任务投票'}).click();
    await page.getByRole('dialog').getByRole('button',{name:'2号 玩家2',exact:true}).click();
    await page.evaluate(() => window.setGame(game=>({...game,nomination:{...game.nomination,attempt:2}})));
    await expect(page.getByRole('dialog')).toHaveCount(0);await menu.getByRole('button',{name:'任务投票'}).click();
    await expect(page.getByRole('dialog').getByRole('button',{name:'2号 玩家2',exact:true})).toHaveAttribute('aria-pressed','false');
    await page.evaluate(() => window.setGame(game=>({...game,deadlineAt:new Date(Date.now()-1000).toISOString()})));
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(menu.getByRole('button')).toHaveCount(0);
    await expect(chat.getByRole('button',{name:'2号 玩家2',exact:true})).toBeDisabled();
    await page.evaluate(() => window.setGame({...window.fixture('night'),me:null}));await expect(menu.getByRole('button')).toHaveCount(0);
    await page.evaluate(() => window.setGame({...window.fixture('mission'),missionTeamUserIds:['u2','u3']}));await expect(menu.getByRole('button')).toHaveCount(0);
    assert.deepEqual(errors,[]);await page.close();console.log('PASS: '+name+' seven phases, shared drafts/clock/submission, errors, timeout, revote, permissions and Android back');
  }
} finally { await browser.close(); }
