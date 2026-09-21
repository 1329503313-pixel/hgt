import assert from "node:assert/strict";
import test from "node:test";
import {
  isServerMediaPath,
  normalizeServerMediaUrls,
  resolveServerMediaUrl
} from "../src/shared/mediaUrls.ts";

const apiOrigin = "https://hgt.caqis.com";
const bossCover = `/api/online-soup/card-battle-boss/covers/${"a".repeat(64)}`;

test("resolves API media and banner paths against the configured API origin", () => {
  assert.equal(
    resolveServerMediaUrl("/api/media/users/u1/avatar", `${apiOrigin}/`),
    `${apiOrigin}/api/media/users/u1/avatar`
  );
  assert.equal(
    resolveServerMediaUrl("/api/banners/banner-1/image?v=1", apiOrigin),
    `${apiOrigin}/api/banners/banner-1/image?v=1`
  );
});

test("resolves built-in and uploaded stickers to the same server in APP payloads", () => {
  const builtIn = {
    id: "tangtang-detective-hello",
    staticUrl: "/stickers/tangtang-detective/hello/TTZT_01_你好呀_V1_static.webp",
    animatedUrl: "/stickers/tangtang-detective/hello/TTZT_01_你好呀_V1_320.webp",
    owned: true
  };
  const uploaded = {
    id: "uploaded-1",
    staticUrl: "/api/media/stickers/uploaded-1/static?v=123",
    animatedUrl: "/api/media/stickers/uploaded-1/animated?v=123",
    owned: true
  };
  const source = { series: [{ id: "tangtang", stickers: [builtIn] }, { id: "custom", stickers: [uploaded] }] };
  const normalized = normalizeServerMediaUrls(source, `${apiOrigin}/`);
  for (const [index, sticker] of [builtIn, uploaded].entries()) {
    assert.deepEqual(normalized.series[index].stickers[0], {
      ...sticker,
      staticUrl: `${apiOrigin}${sticker.staticUrl}`,
      animatedUrl: `${apiOrigin}${sticker.animatedUrl}`
    });
  }
  const encoded = encodeURI(builtIn.animatedUrl) + "?v=2";
  assert.equal(resolveServerMediaUrl(encoded, apiOrigin), `${apiOrigin}${encoded}`);
  assert.equal(resolveServerMediaUrl(`${apiOrigin}${encoded}`, apiOrigin), `${apiOrigin}${encoded}`);
  assert.equal(resolveServerMediaUrl(builtIn.staticUrl, ""), builtIn.staticUrl);
  assert.equal(normalizeServerMediaUrls(source, ""), source);
  assert.equal(source.series[0].stickers[0], builtIn);
  assert.equal(isServerMediaPath("/stickers-other/file.webp"), false);
});

test("does not rewrite navigation, bundled, data, blob, or absolute URLs", () => {
  const preserved = [
    "/mine/store",
    "/badges/publish-rare.webp",
    "/turtle-avatar.png?v=1",
    "data:image/webp;base64,AAAA",
    "blob:https://app.caqis.com/id",
    "https://zgkc-storage.oss-cn-beijing.aliyuncs.com/hgt/file.webp",
    `${apiOrigin}${bossCover}`
  ];
  for (const value of preserved) assert.equal(resolveServerMediaUrl(value, apiOrigin), value);
  assert.equal(isServerMediaPath("/api/soups"), false);
  assert.equal(isServerMediaPath("/api/online-soup/rooms/room-1"), false);
});

test("resolves all five BOSS covers for APP preparation, battle updates, and replay", () => {
  const cards = Array.from({ length: 5 }, (_, index) => ({
    name: `BOSS ${index + 1}`,
    imageUrl: `/api/online-soup/card-battle-boss/covers/${String(index + 1).repeat(64)}`
  }));
  const battle = { boss: { lineup: cards }, game: { lineups: [{ seat: 2, cards }] } };
  const rest = { room: { cardBattle: battle } };
  const socket = { event: "online_soup_changed", payload: { roomId: "room-1", cardBattle: battle } };
  const replay = { replay: { lineups: battle.game.lineups } };
  const expected = cards.map((card) => ({ ...card, imageUrl: `${apiOrigin}${card.imageUrl}` }));

  assert.equal(isServerMediaPath(bossCover), true);
  assert.equal(resolveServerMediaUrl(bossCover, `${apiOrigin}/`), `${apiOrigin}${bossCover}`);
  assert.deepEqual(normalizeServerMediaUrls(rest, apiOrigin).room.cardBattle.boss.lineup, expected);
  assert.deepEqual(normalizeServerMediaUrls(rest, apiOrigin).room.cardBattle.game.lineups[0].cards, expected);
  assert.deepEqual(normalizeServerMediaUrls(socket, apiOrigin).payload.cardBattle.game.lineups[0].cards, expected);
  assert.deepEqual(normalizeServerMediaUrls(replay, apiOrigin).replay.lineups[0].cards, expected);
  assert.equal(normalizeServerMediaUrls(rest, ""), rest);
  assert.equal(resolveServerMediaUrl(bossCover, ""), bossCover);
  assert.equal(rest.room.cardBattle.boss.lineup[0].imageUrl, `/api/online-soup/card-battle-boss/covers/${"1".repeat(64)}`);
});

test("normalizes nested REST, cache, SSE, and WebSocket payload shapes", () => {
  const source = {
    user: { avatar: "/api/media/users/u1/avatar" },
    banners: [{ imageUrl: "/api/banners/b1/image?v=2", linkUrl: "/mine/store" }],
    gift: { iconUrl: "/api/media/gifts/g1/icon", quantity: 9 },
    card: {
      motion: [
        "/api/media/assets/cards/c1/motion/mp4?v=3",
        "https://cdn.example.com/card.webm"
      ]
    }
  };

  const normalized = normalizeServerMediaUrls(source, apiOrigin);
  assert.deepEqual(normalized, {
    user: { avatar: `${apiOrigin}/api/media/users/u1/avatar` },
    banners: [{ imageUrl: `${apiOrigin}/api/banners/b1/image?v=2`, linkUrl: "/mine/store" }],
    gift: { iconUrl: `${apiOrigin}/api/media/gifts/g1/icon`, quantity: 9 },
    card: {
      motion: [
        `${apiOrigin}/api/media/assets/cards/c1/motion/mp4?v=3`,
        "https://cdn.example.com/card.webm"
      ]
    }
  });
  assert.equal(source.user.avatar, "/api/media/users/u1/avatar");
});

test("keeps web payload references untouched when no API origin is configured", () => {
  const source = { avatar: "/api/media/users/u1/avatar" };
  assert.equal(normalizeServerMediaUrls(source, ""), source);
});
