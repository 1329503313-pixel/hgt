import assert from "node:assert/strict";
import test from "node:test";
import {
  isServerMediaPath,
  normalizeServerMediaUrls,
  resolveServerMediaUrl
} from "../src/shared/mediaUrls.ts";

const apiOrigin = "https://hgt.caqis.com";

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

test("does not rewrite navigation, bundled, data, blob, or absolute URLs", () => {
  const preserved = [
    "/mine/store",
    "/badges/publish-rare.webp",
    "/turtle-avatar.png?v=1",
    "data:image/webp;base64,AAAA",
    "blob:https://app.caqis.com/id",
    "https://zgkc-storage.oss-cn-beijing.aliyuncs.com/hgt/file.webp"
  ];
  for (const value of preserved) assert.equal(resolveServerMediaUrl(value, apiOrigin), value);
  assert.equal(isServerMediaPath("/api/soups"), false);
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
