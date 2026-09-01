import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const roomPageSource = readFileSync(
  new URL("../src/pages/OnlineSoupRoomPage.tsx", import.meta.url),
  "utf8"
);

test("online soup discussion uses a real cover only inside the message area", () => {
  const titleIndex = roomPageSource.indexOf("本轮讨论");
  const coverIndex = roomPageSource.indexOf('snapshot.room.contentType === "soup" && snapshot.room.soup?.coverImage');
  const composerIndex = roomPageSource.indexOf("canDiscuss && <div", coverIndex);

  assert.ok(titleIndex >= 0);
  assert.ok(coverIndex > titleIndex, "cover must be rendered below the discussion title");
  assert.ok(composerIndex > coverIndex, "cover must be rendered before the composer sibling");
  assert.match(roomPageSource, /pointer-events-none absolute inset-0 h-full w-full select-none object-cover opacity-20/);
  assert.match(roomPageSource, /aria-hidden="true"/);
  assert.match(roomPageSource, /relative z-10 h-full space-y-3 overflow-y-auto/);
});
