// APP and server use different origins. All HTTP and WebSocket traffic stays mocked.
// Run from the repository root: node apps/web/tests/cardBattleBossMedia.browser.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const appOrigin = "https://app.caqis.com";
const apiOrigin = "https://hgt.caqis.com";
const coverPrefix = "/api/online-soup/card-battle-boss/covers/";
const bundle = await build({
  stdin: { resolveDir: resolve("apps/web"), loader: "tsx", contents: `
    import React, { useEffect, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import { api } from './src/api';
    import { connectOnlineSoupSocket } from './src/shared/onlineSoupSocket';
    import { CardBattleRoomView } from './src/components/CardBattleRoomView';
    import { CardBattleBossReplay } from './src/components/CardBattleBossReplay';
    import { DEFAULT_LEGEND_CARD_BATTLE_TIERS } from './src/shared/digitalAssets';

    const makeCard = (id, imageUrl) => ({
      id, cardNo: id, name: id, imageUrl, rarity: 'legend', battleRole: 'damage', starLevel: 3,
      combatPower: 6000, motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null,
      stats: { ...DEFAULT_LEGEND_CARD_BATTLE_TIERS[3] }, skillName: '守卫', skillDescription: '提升防御。'
    });
    const cover = id => '/api/online-soup/card-battle-boss/covers/' + id.repeat(64);
    const bosses = Array.from({ length: 5 }, (_, i) => makeCard('BOSS卡' + i, cover(String(i + 1))));
    const frozen = bosses.map((card, i) => ({ ...card, imageUrl: cover((i + 6).toString(16)) }));
    const owned = Array.from({ length: 3 }, (_, i) => makeCard('玩家卡' + i, '/api/media/assets/cards/player' + i + '/thumbnail'));
    const seats = [1, 2, 3].map(seat => ({ seat, user: { id: 'u' + seat, nickname: '玩家' + seat, avatar: null }, ready: false,
      lineup: owned.map((card, i) => ({ slot: i + 1, card, cardBack: false })) }));
    const lineups = [...seats.map(seat => ({ seat: 1, playerSeat: seat.seat, userId: seat.user.id, nickname: seat.user.nickname, cards: owned })),
      { seat: 2, userId: 'boss:room', nickname: 'BOSS', cards: frozen }];
    const states = lineups.flatMap(player => player.cards.map((card, i) => ({ ...card.stats, seat: player.seat, userId: player.userId,
      slot: i + 1, row: i < (player.seat === 1 ? 1 : 2) ? 'front' : 'rear', instanceId: player.userId + ':' + i,
      hp: 3000, maxHp: 3000, energy: 0, alive: true })));
    const event = { sequence: 1, round: 1, kind: 'round', visual: 'round', actorId: null, skillName: null,
      effects: [], states, durationMs: 500000, text: '第一回合开始' };
    const playback = { completedSequence: 0, totalEvents: 1, complete: false, states, activeEvent: event,
      activeEventStartedAt: new Date().toISOString(), activeEventElapsedMs: 0, serverNow: new Date().toISOString() };
    const battle = { mode: 'boss', phase: 'preparing', seats, rankingChallenge: null, game: null,
      me: { userId: 'u1', seat: 1, eligibleCardCount: 3, collectibleBindings: [] },
      boss: { name: '深海守卫', lineup: bosses, rewardShells: 500, rewardClaimed: false, currentReward: null } };
    const snapshot = { room: { id: 'room', code: '654321', name: '深海守卫', cardBattle: battle },
      me: { isHost: false }, members: seats.map(seat => ({ ...seat.user, role: 'player' })), messages: [] };
    window.playingBattle = { ...battle, phase: 'playing', game: { id: 'game', gameNumber: 1, status: 'playing', lineups, playback, settlement: null } };
    const replay = { name: '深海守卫', gameId: 'game', gameNumber: 1, lineups, result: { winnerSeat: 1, endReason: 'elimination', rounds: 1,
      initialStates: states, finalStates: states, events: [event], players: [] } };
    window.fetch = async url => {
      if (!String(url).startsWith('${apiOrigin}/api/')) throw new Error('API requested the APP origin: ' + url);
      const path = new URL(url).pathname;
      let data;
      if (path.endsWith('/eligible-cards')) data = { cards: owned };
      else if (path.endsWith('/playback')) data = { gameId: 'game', playback };
      else if (path.endsWith('/decks')) data = { decks: [] };
      else if (path.endsWith('/replay')) data = { replay };
      else if (path === '/api/online-soup/rooms/room') data = snapshot;
      else throw new Error('Unexpected API: ' + path);
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    };
    function Harness() {
      const [current, setCurrent] = useState(null);
      const [record, setRecord] = useState(null);
      useEffect(() => {
        void api('/api/online-soup/rooms/room').then(setCurrent);
        return connectOnlineSoupSocket('room', (_, payload) => setCurrent(previous => ({ ...previous,
          room: { ...previous.room, cardBattle: payload.cardBattle } })));
      }, []);
      window.openReplay = () => api('/api/online-soup/admin/card-battle-bosses/room/battles/game/replay').then(data => setRecord(data.replay));
      if (record) return <CardBattleBossReplay replay={record} onClose={() => setRecord(null)} />;
      return current && <CardBattleRoomView roomId="room" snapshot={current} stickerSeries={[]} stickersLoading={false}
        onReload={async () => {}} onReloadMessages={async () => {}} onOpenInvite={() => {}} onOpenMembers={() => {}} showToast={() => {}} />;
    }
    createRoot(document.getElementById('root')).render(<MemoryRouter><Harness /></MemoryRouter>);
  ` },
  bundle: true, write: false, format: "iife",
  define: { "import.meta.env": JSON.stringify({ VITE_HGT_TARGET: "android", VITE_HGT_API_ORIGIN: apiOrigin, VITE_HGT_PUBLIC_SITE_ORIGIN: apiOrigin }) }
});
const cssFile = readdirSync(resolve("apps/web/dist/assets")).find(file => file.startsWith("index-") && file.endsWith(".css"));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? undefined : "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors = [], wrongOrigin = [], loadedCovers = new Set();
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.href === `${appOrigin}/boss-media-test`) {
      await route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
    } else if (url.origin === apiOrigin && (url.pathname.startsWith(coverPrefix) || url.pathname.startsWith("/api/media/"))) {
      if (url.pathname.startsWith(coverPrefix)) loadedCovers.add(url.pathname);
      await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#496583"/></svg>' });
    } else if (url.origin === appOrigin && url.pathname.startsWith("/card-battle-fx/")) {
      await route.fulfill({path:resolve("apps/web/public"+url.pathname),contentType:"image/webp"});
    } else {
      wrongOrigin.push(url.href);
      await route.abort();
    }
  });
  let socket;
  await page.routeWebSocket(`${apiOrigin.replace('https:', 'wss:')}/ws/online-soup?roomId=room`, ws => { socket = ws; });
  await page.goto(`${appOrigin}/boss-media-test`);
  await page.addStyleTag({ content: readFileSync(resolve("apps/web/dist/assets", cssFile), "utf8") });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const bossImages = page.locator('img[alt^="BOSS卡"]');
  async function assertLoaded(count, expectedFirstCover) {
    await expect(bossImages).toHaveCount(count);
    await expect(page.getByAltText("BOSS卡0", { exact: true }).first()).toHaveAttribute("src", `${apiOrigin}${coverPrefix}${expectedFirstCover.repeat(64)}`);
    await expect.poll(() => bossImages.evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
  }
  await assertLoaded(5, "1");
  await page.getByRole("button", { name: "查看阵容", exact: true }).click();
  await assertLoaded(10, "1");
  await page.getByRole("button", { name: "关闭阵容详情", exact: true }).click();
  await expect.poll(() => Boolean(socket)).toBe(true);
  socket.send(JSON.stringify({ event: "online_soup_changed", payload: { roomId: "room", reason: "card_battle", cardBattle: await page.evaluate(() => window.playingBattle) } }));
  await assertLoaded(5, "6");
  await page.evaluate(() => window.openReplay());
  await assertLoaded(5, "6");
  assert.equal(loadedCovers.size, 10, "Preparation and frozen battle covers must all be requested from the API server");
  assert.deepEqual(wrongOrigin, []);
  assert.deepEqual(errors, []);
  console.log("PASS: Android BOSS images decode in preparation, lineup details, WebSocket battle updates, and REST replay; no images requested from the APP origin.");
} finally { await browser.close(); }
