// Isolated browser regression: mocked room API only, no database or login required.
// Run from the repository root: node apps/web/tests/cardBattlePlayback.browser.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const epoch = Date.parse("2026-09-08T00:00:00Z");
let serverElapsed = 100;
let surrendered = false;
let failRequest = false;
const initialStates = [{ instanceId: "card", hp: 1000, maxHp: 1000, energy: 0 }];
function snapshot() {
  const completedSequence = surrendered ? 1 : Math.min(3, Math.floor(serverElapsed / 1000));
  const complete = surrendered || completedSequence === 3;
  const states = (n) => [{ ...initialStates[0], hp: 1000 - n * 100, energy: n * 10 }];
  return {
    completedSequence, totalEvents: surrendered ? 1 : 3, complete,
    states: complete ? initialStates : states(completedSequence),
    activeEvent: complete ? null : { sequence: completedSequence + 1, actorId: "card", kind: "attack", visual: "damage", durationMs: 1000, states: states(completedSequence + 1), effects: [], text: "测试动作" },
    activeEventElapsedMs: complete ? 0 : serverElapsed % 1000,
    activeEventStartedAt: complete ? null : new Date(epoch + completedSequence * 1000).toISOString(),
    serverNow: new Date(epoch + serverElapsed).toISOString(),
  };
}

const bundled = await build({
  stdin: { resolveDir: resolve("apps/web"), loader: "tsx", contents: `
    import React, { useState, useLayoutEffect, useRef } from "react";
    import { createRoot } from "react-dom/client";
    import { useServerCardBattlePlayback } from "./src/shared/useServerCardBattlePlayback";
    import { seekCardBattleAnimations } from "./src/shared/cardBattlePlayback";
    function Harness() {
      const [game, setGame] = useState(window.initialGame);
      const arena = useRef(null);
      window.setGame = setGame;
      const state = useServerCardBattlePlayback("room", game, async () => { window.reloadCount = (window.reloadCount || 0) + 1; });
      useLayoutEffect(() => { if (arena.current && state.activeEvent) seekCardBattleAnimations(arena.current, state.animationDelayMs); }, [state.activeEvent, state.animationDelayMs]);
      return <><output id="state">{JSON.stringify(state)}</output><div ref={arena}><div id="card" className={state.activeEvent ? "card-battle-card card-battle-attacker-1" : "card-battle-card"}><video id="media" /></div></div></>;
    }
    createRoot(document.getElementById("root")).render(<Harness />);
  ` },
  bundle: true, write: false, format: "iife", define: { "import.meta.env": "{}" },
});
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? undefined : "msedge", headless: true });
try {
  const context = await browser.newContext();
  const errors = [];
  await context.route("**/*", async (route) => {
    if (route.request().url().endsWith("/card-battle/playback")) {
      assert.equal(route.request().method(), "GET", "客户端不发送逐事件确认请求");
      return route.fulfill({ status: failRequest ? 503 : 200, contentType: "application/json", body: JSON.stringify(failRequest ? { error: "offline" } : { gameId: "game", playback: snapshot() }) });
    }
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  const open = async () => {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    // No local timeout can advance while the server keeps moving.
    await page.clock.install();
    await page.clock.pauseAt(Date.now() + 1000);
    await page.goto("http://127.0.0.1:49879/fixture");
    await page.evaluate((playback) => { window.initialGame = { id: "game", playback }; }, snapshot());
    await page.addStyleTag({ content: readFileSync(resolve("apps/web/src/styles.css"), "utf8").replace('@import "./cardBattleEffects.css";', "") + readFileSync(resolve("apps/web/src/cardBattleEffects.css"), "utf8") + ":root{--skill-duration:1050ms}" });
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    await expect(page.locator("#state")).not.toHaveText("");
    return page;
  };
  const read = (page) => page.locator("#state").evaluate((node) => JSON.parse(node.textContent));
  const resume = (page, event = "focus") => page.evaluate((name) => window.dispatchEvent(new Event(name)), event);
  const one = await open();
  const two = await open();
  await expect.poll(async () => (await read(one)).activeEvent?.sequence).toBe(1);
  await one.evaluate(() => { window.originalMedia = document.getElementById("media"); });

  serverElapsed = 1800;
  assert.equal((await read(one)).activeEvent.sequence, 1, "被暂停的本地计时器尚未更新");
  await resume(one);
  await resume(two, "pageshow");
  for (const page of [one, two]) {
    await expect.poll(async () => (await read(page)).activeEvent?.sequence).toBe(2);
    assert.equal((await read(page)).cardStates[0].hp, 800);
    assert.equal((await read(page)).animationDelayMs, 800);
  }
  assert.equal(await one.evaluate(() => window.originalMedia === document.getElementById("media")), true, "同步不得重建卡面媒体");
  assert.ok(await one.locator("#card").evaluate((node) => node.getAnimations()[0].currentTime >= 800), "CSS动画直接定位到服务器动作内位置");

  failRequest = true;
  await resume(one, "online");
  await expect.poll(async () => (await read(one)).syncing).toBe(true);
  assert.equal((await read(one)).activeEvent, null);
  failRequest = false;
  serverElapsed = 2600;
  await one.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => (await read(one)).activeEvent?.sequence).toBe(3);
  assert.equal((await read(one)).cardStates[0].hp, 700);

  surrendered = true;
  serverElapsed = 2800;
  await resume(one);
  await expect.poll(async () => (await read(one)).playback?.complete).toBe(true);
  assert.equal((await read(one)).activeEvent, null);
  assert.equal((await read(one)).cardStates[0].hp, 1000);
  assert.equal(await one.evaluate(() => window.reloadCount), 1);
  const rejoined = await open();
  await expect.poll(async () => (await read(rejoined)).playback?.complete).toBe(true);
  assert.equal((await read(rejoined)).activeEvent, null);
  assert.equal((await read(rejoined)).cardStates[0].hp, 1000);
  assert.deepEqual(errors, []);
  console.log("PASS: frozen timers, two viewers, focus/pageshow/online/visibility resync, CSS seeking without remount, offline recovery, surrender and rejoin");
} finally {
  await browser.close();
}
