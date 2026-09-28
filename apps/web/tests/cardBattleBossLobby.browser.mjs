// Real lobby and modal UI with isolated local API/context fixtures.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const bundle = await build({
  stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {MemoryRouter, useLocation} from 'react-router-dom';
    import Lobby from './src/pages/OnlineSoupLobbyPage';
    window.requests=[]; window.bossResponse='success';
    function Harness(){const location=useLocation();return <><Lobby/><output data-location>{location.pathname}</output></>}
    createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/online-soup']}><Harness/></MemoryRouter>);
  ` }, bundle: true, write: false, format: 'iife', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'local-fixtures', setup(build) {
    build.onLoad({ filter: /[\\/]context[\\/]AppContext\.tsx$/ }, () => ({ loader: 'js', contents: `
      const context={user:{id:'u1',nickname:'测试玩家',role:'user'},openAuth(){},showToast(message){window.toast=message}};
      export function useApp(){return context}
    ` }));
    build.onLoad({ filter: /[\\/]components[\\/]PageTopBar\.tsx$/ }, () => ({ loader: 'js', contents: 'export function PageTopBar(){return null}' }));
    build.onLoad({ filter: /[\\/]shared[\\/]onlineSoupSocket\.ts$/ }, () => ({ loader: 'js', contents: 'export function connectOnlineSoupLobbySocket(){return ()=>{}}' }));
    build.onLoad({ filter: /[\\/]api\.ts$/ }, () => ({ loader: 'js', contents: `
      export class ApiError extends Error {}
      export async function api(path, options={}){
        window.requests.push({path,...options});
        if(path==='/api/online-soup/card-battle-bosses'){
          if(window.bossResponse==='error')throw new Error('BOSS 列表加载失败');
          return {bosses:window.bossResponse==='empty'?[]:[{id:'boss-a',name:'深海守卫',rewardShells:500},{id:'boss-b',name:'月光之影',rewardShells:800}]};
        }
        if(options.method==='POST')return {roomId:'new-room'};
        return {rooms:[{id:'room-a',code:'123456',name:'周末组队挑战',type:'public',status:'preparing',contentType:'card_battle',cardBattleMode:'boss',bossName:'深海守卫',bossClearLabel:'cleared',host:{id:'u2',nickname:'房主甲'},participantCount:1,participantCapacity:3,playerCount:1,playerCapacity:3}]};
      }
    ` }));
  } }],
});
const cssFile = readdirSync('apps/web/dist/assets').find(file => file.startsWith('index-') && file.endsWith('.css'));
const output = resolve('.local/boss-player-rooms'); mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === '1' ? undefined : 'msedge', headless: true });
try {
  for (const [width, height] of [[375,812], [812,375], [1280,900]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.route('**/*', route => route.request().url() === 'http://boss-room.test/' ? route.fulfill({contentType:'text/html', body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'}) : route.abort());
    await page.goto('http://boss-room.test/');
    await page.addStyleTag({ content: readFileSync(resolve('apps/web/dist/assets', cssFile), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(page.getByText('深海守卫 · 已通关', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '创建房间', exact: true }).click();
    await page.getByRole('button', { name: '卡牌对战', exact: true }).click();
    await page.getByRole('button', { name: 'BOSS战', exact: true }).click();
    const create = page.getByRole('button', { name: '创建并进入', exact: true });
    const boss = page.getByRole('combobox', { name: /BOSS 战名称/ });
    await expect(create).toBeDisabled();
    await boss.selectOption('boss-a');
    await page.getByRole('button', { name: '已通关', exact: true }).click();
    await expect(create).toBeEnabled();
    await expect(page.getByText('仅作为房间招募标签，不限制任何人加入。')).toBeVisible();
    await page.getByRole('button', { name: '密码房', exact: true }).click();
    await page.getByLabel('4 位房间密码', { exact: true }).fill('1234');
    await create.scrollIntoViewIfNeeded();
    assert.equal(await create.evaluate(element => { const r=element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(output, `create-${width}.png`), animations: "disabled" });
    await create.click();
    await expect(page.locator('[data-location]')).toHaveText('/online-soup/rooms/new-room');
    const request = await page.evaluate(() => window.requests.find(request => request.method === 'POST'));
    assert.equal(request.body.cardBattleMode, 'boss'); assert.equal(request.body.bossTemplateId, 'boss-a');
    assert.equal(request.body.bossClearLabel, 'cleared'); assert.equal(request.body.password, '1234');
    // Refresh gracefully handles removal and network errors; stale choices cannot submit.
    await page.evaluate(() => { window.bossResponse='empty'; });
    await page.getByRole('button', { name: '刷新 BOSS 列表', exact: true }).click();
    await expect(page.getByText('当前没有已上线的 BOSS，暂时无法创建 BOSS 战房间。')).toBeVisible();
    await expect(create).toBeDisabled(); await expect(boss).toHaveValue('');
    await page.evaluate(() => { window.bossResponse='error'; });
    await page.getByRole('button', { name: '刷新 BOSS 列表', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('BOSS 列表加载失败'); await expect(create).toBeDisabled();
    await page.evaluate(() => { window.bossResponse='success'; });
    await page.getByRole('button', { name: '刷新 BOSS 列表', exact: true }).click();
    await boss.selectOption('boss-b'); await expect(create).toBeEnabled();
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`PASS: desktop, 375px phone and landscape BOSS creation, password, labels, empty/error/retry, no overflow. Screenshots: ${output}`);
} finally { await browser.close(); }
