import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';
import { chromium, expect } from '@playwright/test';
import { COLLECTIBLE_ACHIEVEMENTS } from '../../../packages/shared/dist/index.js';

const output = resolve('artifacts/collectible-achievements');
mkdirSync(output, { recursive: true });
const bundle = await build({
  stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {MemoryRouter} from 'react-router-dom';
    import MyAchievementsPage, {buildBadgesFromStats} from './src/pages/MyAchievementsPage';
    window.buildBadgesFromStats=buildBadgesFromStats;
    createRoot(document.getElementById('root')).render(<MemoryRouter><main style={{maxWidth:1100,margin:'24px auto'}}><MyAchievementsPage/></main></MemoryRouter>);
  ` },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'isolate-badge-services', setup(build) {
    build.onLoad({filter:/[\\/]components[\\/]PageTopBar\.tsx$/},()=>({loader:'tsx',contents:'export function PageTopBar(){return <h1>我的成就</h1>}'}));
    build.onLoad({filter:/[\\/]components[\\/]MineBackButton\.tsx$/},()=>({loader:'tsx',contents:'export function MineBackButton(){return null}'}));
    build.onLoad({filter:/[\\/]shared[\\/]serverEvents\.ts$/},()=>({loader:'js',contents:'export function subscribeServerEvent(){return ()=>{}}'}));
    build.onLoad({filter:/[\\/]api\.ts$/},()=>({loader:'js',contents:`export async function api(path){return path==='/api/me/stats'?window.stats:window.collection}`}));
  }}],
});
const css = (await postcss([tailwindcss({
  ...loadConfig(resolve('apps/web/tailwind.config.ts')),
  content: [{raw:readFileSync(resolve('apps/web/src/pages/MyAchievementsPage.tsx'),'utf8'),extension:'tsx'}],
})]).process(readFileSync(resolve('apps/web/src/styles.css'),'utf8').replace('@import "./cardBattleEffects.css";',readFileSync('apps/web/src/cardBattleEffects.css','utf8')), {from:undefined})).css;
const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM==='1'?undefined:'msedge',headless:true});
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({viewport:{width,height:900}});
    const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    await page.route('http://badge.local/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith('/badges/')) {
        return route.fulfill({body:readFileSync(resolve('apps/web/public', '.'+pathname)),contentType:pathname.endsWith('.webp')?'image/webp':'image/png'});
      }
      return route.fulfill({body:'<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>',contentType:'text/html'});
    });
    await page.goto('http://badge.local/');
    await page.evaluate(keys => {
      window.stats={epicCollectibleAcquired:1,legendCollectibleAcquired:1,highestCollectibleValue:1000001};
      window.collection={badgeKeys:keys,legendaryBadges:[],timedBadges:[],ownershipRates:{},unlockDates:Object.fromEntries(keys.map(key=>[key,'2026-09-29T00:00:00Z']))};
    }, COLLECTIBLE_ACHIEVEMENTS.map(b=>b.key));
    await page.addStyleTag({content:css});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await expect(page.locator('[title="万宝之主 · 传说 · 已获得"]')).toBeVisible();
    await expect(page.locator('[title="奇珍入藏 · 稀有 · 已获得"]')).toBeVisible();
    await expect(page.locator('[title="传世之藏 · 史诗 · 已获得"]')).toBeVisible();
    const results = await page.evaluate(() => {
      const select = stats => window.buildBadgesFromStats(stats).filter(b=>['epicCollectible','legendCollectible','collectibleValue'].includes(b.series)).map(b=>({label:b.label,earned:b.earned}));
      return {at:select({highestCollectibleValue:50000}),over:select({highestCollectibleValue:50001}),legend:select({legendCollectibleAcquired:1}),permanent:window.buildBadgesFromStats({}, {}, {}, ['collectibleValue:legend']).find(b=>b.label==='万宝之主').earned};
    });
    assert.equal(results.at.some(b=>b.earned),false);
    assert.deepEqual(results.over.filter(b=>b.earned).map(b=>b.label),['小有珍藏']);
    assert.deepEqual(results.legend.filter(b=>b.earned).map(b=>b.label),['传世之藏']);
    assert.equal(results.permanent,true);
    await page.screenshot({path:resolve(output,`page-${width}.png`),fullPage:true});
    await page.locator('[title="奇珍入藏 · 稀有 · 已获得"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('寻得一件奇珍，为我的收藏添上一抹光。');
    await expect(page.getByRole('dialog')).toContainText('获得1件史诗级收藏品');
    await expect(page.getByRole('dialog')).toContainText('稀有');
    await expect.poll(()=>page.getByRole('dialog').evaluate(e=>getComputedStyle(e).opacity)).toBe('1');
    await page.screenshot({path:resolve(output,`detail-${width}.png`)});
    assert.equal(await page.locator('img[src*="epic-collectible"]').first().evaluate(i=>i.complete && i.naturalWidth>0),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole('button',{name:'关闭徽章详情'}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  const review = await browser.newPage({viewport:{width:1200,height:960},deviceScaleFactor:1});
  await review.goto(pathToFileURL(resolve(output,'review.html')).href);
  await expect.poll(()=>review.locator('img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
  await review.screenshot({path:resolve(output,'preview.png'),fullPage:true});
  await review.close();
  console.log('PASS: real achievement page, mobile/desktop, rarity, descriptions, threshold boundaries, independent acquisition, permanent ownership, image loading, modal open/close, no overflow');
} finally { await browser.close(); }
