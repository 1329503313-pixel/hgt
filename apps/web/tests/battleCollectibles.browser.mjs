// Isolated real-browser regression; every request is intercepted. No live data is changed.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { applyBattleCollectibleStats } from "@hgt/shared";

const poster = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350"><rect width="250" height="350" fill="#163957"/><circle cx="125" cy="150" r="70" fill="#25899a"/></svg>')}`;
const items = [1, 2].map((n) => ({ id: `r${n}`, collectibleNo: `00${n}`, name: n === 1 ? "智慧水晶" : "守护之心", imageUrl: poster,
  description: "原介绍绝不应显示在装配列表", battleEffectDescription: `对战效果第${n}行\n换行效果说明`, battleEffectType: "attack", battleEffectValue: n * 20 }));
const cards = [1, 2, 3, 4, 5].map((n) => ({ id: `c${n}`, cardNo: `00${n}`, name: `测试卡${n}`, rarity: "epic", battleRole: "damage", starLevel: 0, imageUrl: poster,
  motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null, stats: { maxHp: 1000, attack: 100, defense: 20, speed: 100, energyRequired: 40, critRate: 25, critDamage: 150, canAttackRear: false }, combatPower: 1680, skillName: "", skillDescription: "" }));
let ids = cards.map((c) => c.id), bindings = [], decks = [], ready = false, listFails = false, saveFails = false;
const requests = [];
function snapshot() {
  return { room: { id: "room", name: "收藏品装配测试", code: "123456", status: "preparing", cardBattle: {
    mode: "1v1", phase: "preparing", rankingChallenge: null, game: null,
    me: { userId: "u1", seat: 1, eligibleCardCount: 5, collectibleBindings: bindings },
    seats: [{ seat: 1, user: { id: "u1", nickname: "本人", avatar: null }, ready,
      lineup: ids.map((id, index) => { const base = cards.find((c) => c.id === id); const item = items.find((item) => bindings.some((b) => b.cardId === id && b.collectibleId === item.id));
        return { slot: index + 1, cardBack: false, card: base ? { ...base, collectible: item ?? null, stats: applyBattleCollectibleStats(base.stats, item) } : null }; }) },
      { seat: 2, user: { id: "u2", nickname: "对手", avatar: null }, ready: false, lineup: cards.map((c, i) => ({ slot: i + 1, card: null, cardBack: true })) }],
  } }, me: { isHost: true }, messages: [], members: [] };
}
const bundled = await build({ stdin: { resolveDir: resolve("apps/web"), loader: "tsx", contents: `
  import React, { useCallback, useState } from "react";
  import { createRoot } from "react-dom/client";
  import { MemoryRouter } from "react-router-dom";
  import { CardBattleRoomView } from "./src/components/CardBattleRoomView";
  import { BattleCollectibleFields } from "./src/components/BattleCollectibleFields";
  const noop = async () => {};
  function Harness() {
    const [snapshot, setSnapshot] = useState(window.fixture);
    const [config, setConfig] = useState({ battleEffectDescription: "", battleEffectType: null, battleEffectValue: null });
    const reload = useCallback(async () => { setSnapshot(await fetch('/fixture-state').then(r => r.json())); }, []);
    const toast = useCallback((message) => { window.lastToast = message; }, []);
    return window.fieldsOnly ? <div className="p-4"><BattleCollectibleFields value={config} onChange={setConfig}/><output hidden id="config">{JSON.stringify(config)}</output></div> :
      <MemoryRouter><CardBattleRoomView roomId="room" snapshot={snapshot} stickerSeries={[]} stickersLoading={false} onReload={reload} onReloadMessages={noop} onOpenInvite={noop} onOpenMembers={noop} onLeave={noop} onClose={noop} showToast={toast}/></MemoryRouter>;
  }
  createRoot(document.getElementById("root")).render(<Harness/>);
` }, bundle: true, write: false, format: "iife", define: { "import.meta.env": "{}" } });
const css = readdirSync(resolve("apps/web/dist/assets")).find((file) => file.startsWith("index-") && file.endsWith(".css"));
assert.ok(css, "先执行 build:all");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? undefined : "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  const errors = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/fixture-state") return json(snapshot());
    if (path.endsWith("/eligible-cards")) return json({ cards });
    if (path === "/api/me/collectibles") return listFails ? json({ error: "加载失败" }, 503) : json({ collectibles: items });
    if (path.endsWith("/lineup")) {
      const body = route.request().postDataJSON(); requests.push({ method, path, body });
      if (saveFails) return json({ error: "装配保存失败" }, 409);
      ids = body.cardIds;
      bindings = body.collectibleBindings ?? bindings.filter((b) => ids.includes(b.cardId));
      return json({ ok: true });
    }
    if (path.endsWith("/ready")) { ready = route.request().postDataJSON().ready; return json({ ok: true }); }
    if (path.endsWith("/decks") && method === "GET") return json({ decks });
    if (path.endsWith("/decks") && method === "POST") {
      const body = route.request().postDataJSON();
      const deck = { ...body, id: "d1", collectibles: items, collectiblesAvailable: true, createdAt: null, updatedAt: null }; decks = [deck]; return json({ deck });
    }
    if (path.startsWith("/api/")) throw new Error(`Unexpected API request ${method} ${path}`);
    return route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
  });
  async function open(fieldsOnly = false) {
    const page = await context.newPage(); page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:49879/fixture");
    await page.evaluate(({ fixture, fieldsOnly }) => { window.fixture = fixture; window.fieldsOnly = fieldsOnly; }, { fixture: snapshot(), fieldsOnly });
    await page.addStyleTag({ content: readFileSync(resolve("apps/web/dist/assets", css), "utf8") });
    await page.addScriptTag({ content: bundled.outputFiles[0].text }); return page;
  }
  const page = await open();
  await page.getByRole("button", { name: "装配收藏品", exact: true }).click();
  await expect(page.getByText("对战效果第1行", { exact: false })).toBeVisible();
  await expect(page.getByText("原介绍绝不应显示在装配列表")).toHaveCount(0);
  assert.equal(requests.length, 0);
  await page.getByRole("button", { name: /NO.001 智慧水晶/ }).click();
  await expect(page.getByRole("heading", { name: "选择绑定卡牌" })).toBeVisible();
  assert.equal(requests.length, 0, "仅选择收藏品不得提前保存");
  await page.getByRole("button", { name: /卡位 2 .*测试卡2/ }).click();
  await expect(page.getByText("已绑定：测试卡2")).toBeVisible();
  assert.deepEqual(bindings, [{ cardId: "c2", collectibleId: "r1" }]);
  // Rebinding moves the existing collectible instead of duplicating it.
  await page.getByRole("button", { name: /NO.001 智慧水晶/ }).click();
  await page.getByRole("button", { name: /卡位 1 .*测试卡1/ }).click();
  assert.deepEqual(bindings, [{ cardId: "c1", collectibleId: "r1" }]);
  await page.getByRole("button", { name: "关闭装配收藏品" }).click();
  await expect(page.locator('[title="智慧水晶"]')).toBeVisible();
  await page.getByRole("button", { name: "选择卡组", exact: true }).click();
  await page.getByRole("button", { name: "保存当前卡组", exact: true }).click();
  await page.getByLabel("卡组名称").fill("收藏品队伍");
  await page.getByRole("button", { name: "保存卡组", exact: true }).click();
  assert.deepEqual(decks[0].collectibleBindings, bindings);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "装配收藏品", exact: true }).click();
  await page.getByRole("button", { name: "卸下", exact: true }).click();
  assert.deepEqual(bindings, []);
  await page.getByRole("button", { name: "关闭装配收藏品" }).click();
  await page.getByRole("button", { name: "选择卡组", exact: true }).click();
  await page.getByRole("button", { name: "使用此卡组" }).click();
  assert.deepEqual(bindings, [{ cardId: "c1", collectibleId: "r1" }]);
  await expect(page.locator('[title="智慧水晶"]')).toBeVisible();
  await page.getByRole("button", { name: "准备", exact: true }).click();
  await expect(page.getByRole("button", { name: "装配收藏品", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "取消准备", exact: true }).click();
  const refreshed = await open();
  await expect(refreshed.locator('[title="智慧水晶"]')).toBeVisible();
  await refreshed.close();
  listFails = true;
  await page.getByRole("button", { name: "装配收藏品", exact: true }).click();
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  listFails = false; await page.getByRole("button", { name: "重试" }).click();
  await page.getByRole("button", { name: /NO.002 守护之心/ }).click();
  saveFails = true; await page.getByRole("button", { name: /卡位 1 .*测试卡1/ }).click();
  await expect.poll(() => page.evaluate(() => window.lastToast)).toBe("装配保存失败");
  assert.equal(bindings[0].collectibleId, "r1");
  await expect(page.getByRole("heading", { name: "选择绑定卡牌" })).toBeVisible();
  saveFails = false;
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "装配收藏品" })).toBeVisible();
  mkdirSync(resolve("test-results"), { recursive: true });
  await page.screenshot({ path: resolve("test-results/collectibles-mobile.png") });
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "装配面板无横向溢出");
    const bounds = await page.getByRole("button", { name: "关闭装配收藏品" }).boundingBox();
    assert.ok(bounds.height >= 44 && bounds.width >= 44);
  }
  await page.keyboard.press("Escape");
  await page.screenshot({ path: resolve("test-results/collectibles-battle-desktop.png") });
  const fields = await open(true);
  await fields.getByLabel("卡牌对战效果描述", { exact: true }).fill("多行\n纯文本");
  await fields.getByLabel("卡牌对战效果类型", { exact: true }).selectOption("energy_reduction");
  await fields.getByLabel("卡牌对战效果属性（点）").fill("100");
  await fields.getByLabel("卡牌对战效果类型", { exact: true }).selectOption("crit_rate");
  await fields.getByLabel("卡牌对战效果属性（%）").fill("12.25");
  assert.equal(JSON.parse(await fields.locator("#config").textContent()).battleEffectValue, 12.25);
  await fields.getByLabel("卡牌对战效果类型", { exact: true }).selectOption("invincible");
  await fields.getByLabel("卡牌对战效果属性（回合）").fill("1.5");
  await expect(fields.getByRole("alert")).toHaveText("数值和回合数必须为正整数");
  await fields.getByLabel("卡牌对战效果类型", { exact: true }).selectOption("");
  await expect(fields.getByLabel("卡牌对战效果属性（点）")).toBeDisabled();
  assert.equal(JSON.parse(await fields.locator("#config").textContent()).battleEffectValue, null);
  assert.deepEqual(errors, []);
  console.log("PASS: two-step equip, move, unequip, deck round trip, refresh, ready lock, load/save failure, plain-text description, field units, responsive layout and reduced motion");
} finally { await browser.close(); }
