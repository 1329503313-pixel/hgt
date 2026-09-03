import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const roomSource = readFileSync(new URL("./cardBattleRoom.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("./onlineSoup.ts", import.meta.url), "utf8");
const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

test("备战阶段只公开本人新阵容，对手新阵容不会沿用上一局公开状态", () => {
  assert.doesNotMatch(roomSource, /frozenStillSelected/);
  assert.match(roomSource, /const gamePublic = Boolean\(result && String\(currentGame\?\.status\) === "playing"\)/);
  assert.match(roomSource, /const canSee = ownSeat \|\| gamePublic/);
});

test("客户端每次只能取得一个服务端计时的事件并按序确认", () => {
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS online_card_battle_playback_progress/);
  assert.match(roomSource, /activeEvent: !complete[^\n]*result\.events\[completedSequence\]/);
  assert.match(roomSource, /sequence !== expectedSequence \|\| Number\(progress\.active_sequence/);
  assert.match(roomSource, /elapsedMs \+ 25 < event\.durationMs/);
  assert.doesNotMatch(roomSource, /events:\s*result\.events/);
  assert.match(roomSource, /settlement: playback!\.complete && gameStatus !== "aborted"/);
});

test("下一局开始前要求房主和双方玩家播完上一局", () => {
  assert.match(roomSource, /SELECT id, status, result_json FROM online_card_battles[^\n]+FOR UPDATE/);
  assert.match(roomSource, /requiredViewerIds = \[\.\.\.new Set\(\[hostId, \.\.\.seatRows/);
  assert.match(roomSource, /online_card_battle_playback_progress/);
  assert.match(roomSource, /必须完整播放上一局战斗动画后才能开始新对局/);
});

test("阵容、准备和席位切换在房间行锁内重验状态，并让已结束房间回到备战", () => {
  for (const route of ["lineup", "ready", "member-role"]) {
    const start = routesSource.indexOf(`/rooms/:roomId/card-battle/${route}`);
    assert.notEqual(start, -1, `${route} route should exist`);
    const end = routesSource.indexOf("router.", start + 20);
    const body = routesSource.slice(start, end === -1 ? undefined : end);
    assert.match(body, /FOR UPDATE/);
    assert.match(body, /status = IF\(status = 'ended', 'preparing', status\)/);
  }
});
