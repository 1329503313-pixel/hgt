// Real components; all API/media requests are intercepted. No live draws.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const out = resolve(".local/draw-animation-audit");
mkdirSync(out, { recursive: true });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="504"><rect width="360" height="504" fill="#263455"/><circle cx="180" cy="220" r="100" fill="#8262aa"/></svg>';
const card = (n, rarity = "epic") => ({ id: `c${n}`, cardNo: `00${n}`, name: `卡牌${n}`, rarity, imageUrl: `/image/${n}.svg`, thumbnailUrl: `/thumb/${n}.svg`, story: "测试", starAfter: 3, starLevel: 3, motionMp4Url: `/motion/${n}.mp4`, drawIndex: n, firstObtained: true, shellRefund: 0 });
const pack = { id: "pack", name: "测试卡包", packType: "permanent", packTypeLabel: "常驻", description: "抽卡性能回归", coverCard: card(20), cards: [], singlePrice: 10, tenPrice: 100, freeDrawsRemaining: 0, rarityProbabilities: { normal: 70, rare: 20, epic: 9, legend: 1 }, pity: { rare: 0, epic: 0, legend: 0, rareLimit: 10, epicLimit: 40, legendLimit: 100 } };
const order = { id: "draw1", packId: "pack", packName: pack.name, packType: "permanent", drawMode: "ten", shellCost: 100, usedFreeDraw: false, results: [card(1), card(2, "legend"), ...Array.from({ length: 8 }, (_, n) => card(n + 3))], collectibleAwards: [] };
const js = await build({ stdin: { resolveDir: resolve("apps/web"), loader: "tsx", contents: `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter, Routes, Route} from 'react-router-dom'; import Page from './src/pages/AssetPackPage';
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/packs/pack']}><Routes><Route path='/packs/:packId' element={<Page/>}/></Routes></MemoryRouter>);` }, bundle: true, write: false, format: "iife", define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "test-shell", setup(b) {
  b.onResolve({ filter: /\/context\/AppContext$/ }, () => ({ path: "context", namespace: "fixture" }));
  b.onResolve({ filter: /\/components\/PageTopBar$/ }, () => ({ path: "topbar", namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "context" ? `export const useApp=()=>({user:{id:'u',role:'user'},showToast:message=>window.toasts.push(message)});` : "export const PageTopBar=()=>null;", loader: "js" }));
} }] });
const cssFile = readdirSync("apps/web/dist/assets").find(f => /^index-.*\.css$/.test(f));
assert.ok(cssFile, "Build Web first");
const css = readFileSync(resolve("apps/web/dist/assets", cssFile), "utf8");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? undefined : "msedge", headless: true });
const results = [];
try {
  for (const reduced of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: reduced ? "reduce" : "no-preference" });
    let packReads = 0, draws = 0, releaseDraw, failDraw = false;
    const errors = [];
    await context.route("**/*", async route => {
      const p = new URL(route.request().url()).pathname;
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (p.endsWith("/draw")) { draws++; await new Promise(resolve => { releaseDraw = resolve; }); return failDraw ? json({ error: "测试失败" }, 409) : json({ order: { ...order, id: `draw${draws}` }, balance: 900 }); }
      if (p === "/api/asset-store/packs/pack") { packReads++; return json({ pack, balance: 1000 }); }
      if (p.startsWith("/motion/")) return route.fulfill({ status: 200, contentType: "video/mp4", body: Buffer.alloc(0) });
      if (p.startsWith("/thumb/") || p.startsWith("/image/") || p.includes("card-back") || p.includes("new-card")) {
        // The first image deliberately takes longer than the intro.
        if (p === "/thumb/1.svg") await new Promise(resolve => setTimeout(resolve, 700));
        return route.fulfill({ contentType: "image/svg+xml", body: svg });
      }
      if (p.startsWith("/api/")) throw new Error(`Unexpected API ${p}`);
      return route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
    });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("http://127.0.0.1:49991/fixture");
    await page.evaluate(() => { window.toasts = []; window.frames = []; let last = performance.now(); const sample = now => { window.frames.push(now - last); last = now; requestAnimationFrame(sample); }; requestAnimationFrame(sample); });
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js.outputFiles[0].text });
    await expect(page.getByRole("button", { name: "十连 100", exact: true })).toBeVisible();
    if (!reduced) await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.getByRole("button", { name: "十连 100", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("正在抽取");
    assert.equal(await page.locator("section video").count(), 0, "Background videos unmounted while waiting");
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
    await expect.poll(() => draws).toBe(1);
    assert.equal(packReads, 1);
    releaseDraw();
    await expect(page.getByRole("dialog", { name: "抽卡结果" })).toBeVisible();
    if (!reduced) {
      await expect(page.locator(".asset-draw-loading")).toBeVisible();
      assert.equal(await page.locator(".asset-draw-flip-front video").count(), 0);
      await expect(page.locator(".asset-draw-loading")).toHaveCount(0);
      assert.equal(await page.locator(".asset-draw-flip-front img.asset-card-image").evaluate(el => el.complete && el.naturalWidth > 0), true, "Decoded before flip");
      assert.equal(await page.locator(".asset-draw-aura").evaluate(el => getComputedStyle(el, "::before").filter), "none");
    }
    await expect(page.getByText("传说降临 · 点击屏幕继续")).toBeVisible();
    await page.waitForTimeout(1200);
    assert.equal(packReads, 1, "No full pack refresh during reveal");
    await page.screenshot({ path: resolve(out, `legend-${reduced ? "reduced" : "motion"}.png`) });
    await page.getByText("传说降临 · 点击屏幕继续").click();
    await expect(page.getByText("3 / 10", { exact: true })).toBeVisible();
    if (reduced) await expect(page.getByRole("heading", { name: "本次抽卡结果" })).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "自动跳过所有抽卡动画", exact: true }).click();
    await expect(page.getByRole("heading", { name: "本次抽卡结果" })).toBeVisible();
    assert.equal(await page.locator(".asset-result-pop video").count(), 0, "No video startup during result entrance");
    await page.getByRole("button", { name: "收下奖励", exact: true }).click();
    await expect.poll(() => packReads).toBe(2);
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    // Persisted skip, then request failure must restore the page and allow retry.
    await page.getByRole("button", { name: "十连 100", exact: true }).click();
    await expect.poll(() => draws).toBe(2); releaseDraw();
    await expect(page.getByRole("heading", { name: "本次抽卡结果" })).toBeVisible();
    await page.getByRole("button", { name: "再来十连", exact: true }).click();
    await expect.poll(() => draws).toBe(3); failDraw = true; releaseDraw();
    await expect(page.getByRole("button", { name: "十连 100", exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.toasts.includes("测试失败")), true);
    assert.deepEqual(errors, []);
    results.push({ reducedMotion: reduced, cpuThrottle: reduced ? 1 : 4, draws, packReads, errors });
    await context.close();
  }
  writeFileSync(resolve(out, "browser-results.json"), JSON.stringify(results, null, 2));
  console.log("PASS: pending feedback, media pause, delayed decoding, flip/legend progression, result entrance, deferred refresh, persisted skip and draw failure", results);
} finally { await browser.close(); }
