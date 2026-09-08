import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const bundle = await build({
  stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter, Routes, Route } from 'react-router-dom';
    import AssetPackPage from './src/pages/AssetPackPage';
    const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="210"><rect width="150" height="210" fill="#8bb5be"/><circle cx="75" cy="85" r="45" fill="#e4ecde"/></svg>');
    const cards = ['legend', 'legend', 'epic', 'epic', 'normal', 'rare', 'legend'].map((rarity, index) => ({
      id: 'c' + index, cardNo: String(index + 1).padStart(3, '0'), name: '测试卡' + index,
      rarity, imageUrl: image, thumbnailUrl: image, story: '', status: 'active', battleRole: 'damage',
      owned: index % 2 === 0, ...(index % 2 === 0 ? { starLevel: 2 } : {}),
      battleTier: index === 6 ? null : { starLevel: index % 2 === 0 ? 2 : 0, maxHp: index % 2 === 0 ? 2000 : 800,
        attack: 250, defense: 30, speed: 80, energyRequired: 40, critRate: 0, critDamage: 150,
        lifestealRate: 12.5, stunRate: 0, extraActionRate: 0, skillName: '潮汐' + index,
        skillDescription: '对目标造成伤害。\\n' + '长描述必须完整可读。'.repeat(30) + '末尾完整描述' },
    }));
    window.toasts = []; window.upRequests = []; window.failUp = false; window.holdUp = false;
    const pack = { id: 'p1', name: '测试卡包', description: '', packType: 'permanent', packTypeLabel: '常驻卡包',
      coverCard: cards[0], cards, balance: 1000, singlePrice: 10, tenPrice: 100, freeDrawsRemaining: 0,
      upCardId: 'c2', epicUpGuaranteed: true, rarityProbabilities: {normal: 70, rare: 20, epic: 9, legend: 1},
      pity: {rare: 0, epic: 0, legend: 0, rareLimit: 10, epicLimit: 60, legendLimit: 150} };
    window.fetch = async (url, options = {}) => {
      if (String(url).includes('/up-card')) {
        window.upRequests.push(JSON.parse(options.body).cardId);
        if (window.holdUp) await new Promise(resolve => window.releaseUp = resolve);
        if (window.failUp) return new Response(JSON.stringify({error: 'UP更新失败，请重试'}), {status: 409});
        pack.upCardId = JSON.parse(options.body).cardId;
        return new Response(JSON.stringify({upCardId: pack.upCardId, epicUpGuaranteed: true}));
      }
      return new Response(JSON.stringify({balance: 1000, pack}));
    };
    createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/mine/store/cards/p1']}><Routes><Route path="/mine/store/cards/:packId" element={<AssetPackPage/>}/></Routes></MemoryRouter>);
  ` },
  bundle: true, write: false, format: 'iife', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'isolate-page-context', setup(build) {
    build.onLoad({ filter: /[\\/]context[\\/]AppContext\.tsx$/ }, () => ({ loader: 'js', contents: 'export function useApp(){return {user:{id:"u1"},showToast:message=>window.toasts.push(message)}}' }));
    build.onLoad({ filter: /[\\/]components[\\/]PageTopBar\.tsx$/ }, () => ({ loader: 'js', contents: 'export function PageTopBar(){return null}' }));
  } }],
});

const css = readFileSync(resolve('apps/web/dist/assets', readdirSync('apps/web/dist/assets').find(name => name.startsWith('index-') && name.endsWith('.css'))), 'utf8');
const output = resolve('artifacts/asset-pack-card-details');
mkdirSync(output, {recursive: true});
const browser = await chromium.launch({channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === '1' ? undefined : 'msedge', headless: true});
try {
  for (const [name, width, height] of [['mobile', 375, 812], ['desktop', 1365, 900], ['landscape', 812, 375]]) {
    const page = await browser.newPage({viewport: {width, height}, reducedMotion: 'reduce'});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({content: css});
    await page.addScriptTag({content: bundle.outputFiles[0].text});
    const cards = page.locator('.asset-pack-card');
    const button = index => cards.nth(index).getByRole('button');
    await expect(cards).toHaveCount(7);
    for (const index of [0, 1]) {
      await button(index).click();
      await expect(button(index)).toHaveAttribute('aria-expanded', 'true');
      const details = cards.nth(index).locator('.asset-pack-card-details');
      await expect(details).toContainText(index === 0 ? '2 星属性' : '0 星属性');
      await expect(details).toContainText('潮汐' + index);
      await expect(details).toContainText('末尾完整描述');
      const appearance = await details.evaluate(element => ({background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color, scrollable: element.scrollHeight > element.clientHeight}));
      assert.deepEqual(appearance, {background: 'rgba(0, 0, 0, 0.5)', color: 'rgb(255, 255, 255)', scrollable: true});
      await details.evaluate(element => element.scrollTop = element.scrollHeight);
      await expect(button(index)).toHaveAttribute('aria-expanded', 'true');
      await button(index).press('Enter');
      await expect(button(index)).toHaveAttribute('aria-expanded', 'false');
    }
    assert.deepEqual(await page.evaluate(() => window.upRequests), []);
    for (const index of [4, 5]) {
      await expect(button(index)).toBeDisabled();
      await button(index).evaluate(element => element.click());
      await expect(cards.nth(index).locator('.asset-pack-card-details')).toHaveCount(0);
    }
    // Inspect the current UP without sending a request.
    await button(2).click(); await button(2).click();
    assert.deepEqual(await page.evaluate(() => window.upRequests), []);
    await page.evaluate(() => window.holdUp = true);
    await button(3).click();
    await expect(button(3)).toHaveAttribute('aria-expanded', 'true');
    await expect(button(3)).toHaveAccessibleName(/未获得/);
    await expect(page.getByRole('status', {name: '正在更新UP卡牌'})).toBeVisible();
    await button(3).click();
    await expect(button(3)).toHaveAttribute('aria-expanded', 'false');
    assert.deepEqual(await page.evaluate(() => window.upRequests), ['c3']);
    await page.evaluate(() => { window.holdUp = false; window.releaseUp(); });
    await expect(button(3)).toHaveAttribute('aria-pressed', 'true');
    await expect(button(2)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('下一张史诗卡必定为当前UP，切换UP后状态仍保留。')).toBeVisible();
    await button(3).click(); await button(3).click();
    assert.deepEqual(await page.evaluate(() => window.upRequests), ['c3']);
    // A failed switch must preserve the previous UP while still opening the introduction.
    await page.evaluate(() => window.failUp = true);
    await button(2).click();
    await expect(button(2)).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => page.evaluate(() => window.toasts.at(-1))).toBe('UP更新失败，请重试');
    await expect(button(3)).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => window.failUp = false);
    await button(2).click();
    await expect(button(2)).toHaveAttribute('aria-pressed', 'true');
    await button(6).click();
    await expect(cards.nth(6)).toContainText('暂未配置对战属性与技能');
    await button(6).click();
    await button(0).click(); await button(1).click(); await button(3).click();
    await cards.nth(0).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({path: resolve(output, `${name}.png`)});
    await cards.nth(0).locator('.asset-pack-card-details').evaluate(element => {
      const skill = Array.from(element.children).find(child => child.textContent.startsWith('技能：'));
      element.scrollTop = skill.offsetTop - element.offsetTop;
    });
    await cards.nth(0).screenshot({path: resolve(output, `${name}-skill.png`)});
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: owned/unowned previews, rarity restrictions, keyboard toggle, long descriptions, UP updates/deduplication/failure recovery and responsive layout.');
} finally { await browser.close(); }
