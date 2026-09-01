import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const roomPage = readFileSync(new URL("../src/pages/OnlineSoupRoomPage.tsx", import.meta.url), "utf8");

test("game room avatars open profiles without creating private conversations", () => {
  const handlerStart = roomPage.indexOf("function openMemberProfile");
  const handlerEnd = roomPage.indexOf("\n  function ", handlerStart + 1);
  const handler = roomPage.slice(handlerStart, handlerEnd);

  assert.ok(handlerStart >= 0, "expected a shared profile navigation handler");
  assert.match(handler, /navigate\(`\/users\/\$\{userId\}`/);
  assert.match(handler, /onlineSoupRoomId: roomId/);
  assert.match(handler, /onlineSoupMember: true/);
  assert.doesNotMatch(handler, /\/api\/conversations/);
  assert.doesNotMatch(roomPage, /openMemberChat/);
  assert.doesNotMatch(roomPage, /与\$\{displayName\}私聊|打开\$\{displayName\}的会话/);
});
