import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CardBattleResult } from "./cardBattle.js";
import { resolveCardBattlePlaybackStates } from "./cardBattlePlayback.js";

const roomSource = readFileSync(new URL("./cardBattleRoom.ts", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("./onlineSoup.ts", import.meta.url), "utf8");
const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const digitalAssetsSource = readFileSync(new URL("./digitalAssets.ts", import.meta.url), "utf8");

test("参战资格和后台战斗配置同时允许史诗与传说卡", () => {
  assert.ok((roomSource.match(/cards\.rarity IN \('epic','legend'\)/g) ?? []).length >= 5);
  assert.doesNotMatch(roomSource, /cards\.rarity = 'legend'/);
  assert.match(routesSource, /至少拥有五张启用中的史诗或传说卡才能进入对战席/);
  assert.match(digitalAssetsSource, /const cardRaritySupportsBattle = \(rarity: string\) => rarity === "epic" \|\| rarity === "legend"/);
  assert.match(digitalAssetsSource, /cardRaritySupportsBattle\(String\(row\.rarity\)\) \? await loadCardBattleTiers/);
  assert.match(digitalAssetsSource, /if \(!cardRaritySupportsBattle\(finalRarity\)\) \{\s*await connection\.query\("DELETE FROM asset_card_battle_tiers/s);
  assert.match(dbSource, /DELETE battle_tiers[\s\S]*WHERE cards\.rarity NOT IN \('epic', 'legend'\)/);
  assert.match(dbSource, /800 AS max_hp, 250 AS attack_value, 30 AS defense_value, 80 AS speed_value[\s\S]*WHERE cards\.rarity = 'epic'/);
  assert.match(dbSource, /defaults\.speed_value, 40, 0[\s\S]*WHERE cards\.rarity = 'epic'/);
  assert.match(dbSource, /WHERE cards\.rarity = 'legend'/);
});

test("用户卡组保存名称、五张卡牌及其固定位置", () => {
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS user_card_battle_decks/);
  assert.match(dbSource, /lineup_json JSON NOT NULL/);
  assert.match(dbSource, /UNIQUE KEY uq_user_card_battle_deck_name \(user_id, name\)/);
  assert.match(routesSource, /card-battle\/decks/);
  assert.match(routesSource, /\.length\(5, "卡组必须包含五张卡牌"\)/);
  assert.match(roomSource, /卡组必须包含五张不同卡牌/);
  assert.match(roomSource, /ORDER BY updated_at DESC/);
});

test("卡牌对战榜使用隐藏临时房间并冻结守榜卡组", () => {
  assert.match(dbSource, /room_scope ENUM\('public','ranking_challenge'\)/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS card_battle_ranking_entries/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS card_battle_ranking_challenges/);
  assert.match(routesSource, /r\.room_scope = 'public'/);
  assert.match(routesSource, /打榜房间不允许邀请其他用户/);
  assert.match(routesSource, /card-battle-rankings\/:rank\/challenge/);
  assert.match(routesSource, /card-battle\/ranking\/confirm-win/);
  assert.match(roomSource, /defender_snapshot_json/);
  assert.match(roomSource, /榜单对手阵容快照不可用/);
});

test("战力由服务端计算并随备战及冻结卡牌统一返回", () => {
  assert.match(roomSource, /calculateCardBattlePower\(stats\)/);
  assert.match(roomSource, /combatPower:/);
});

test("对战定位仅属于可参战卡，历史卡默认输出并随冻结阵容返回", () => {
  assert.match(dbSource, /battle_role ENUM\('damage','tank','support'\) NULL/);
  assert.match(dbSource, /SET battle_role = 'damage' WHERE rarity IN \('epic','legend'\) AND battle_role IS NULL/);
  assert.match(dbSource, /SET battle_role = NULL WHERE rarity NOT IN \('epic','legend'\)/);
  assert.match(digitalAssetsSource, /史诗或传说卡必须选择对战定位/);
  assert.match(digitalAssetsSource, /仅参与卡牌对战的卡牌可选择对战定位/);
  assert.match(roomSource, /battleRole: String\(row\.battle_role \?\? "damage"\)/);
});

test("二星且已配置动态卡面的参战卡才取得战场动态媒体", () => {
  assert.match(roomSource, /const unlocked = starLevel >= 2 && Boolean\(row\.motion_mp4_path\)/);
  assert.match(roomSource, /motionMp4Url: `\/api\/media\/assets\/cards\/\$\{cardId\}\/motion\/mp4\?v=\$\{version\}`/);
  assert.match(roomSource, /\.\.\.battleMotionPayload\(row, starLevel\)/);
});

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

test("对局动画结束或中止后恢复初始卡牌状态但继续保留结算", () => {
  const initialStates = [{ instanceId: "card-1", hp: 1000, energy: 0, alive: true }];
  const damagedStates = [{ instanceId: "card-1", hp: 475, energy: 20, alive: true }];
  const defeatedStates = [{ instanceId: "card-1", hp: 0, energy: 30, alive: false }];
  const result = {
    initialStates,
    events: [{ states: damagedStates }, { states: defeatedStates }],
  } as unknown as CardBattleResult;

  assert.equal(resolveCardBattlePlaybackStates(result, 0, "playing"), initialStates);
  assert.equal(resolveCardBattlePlaybackStates(result, 1, "ended"), damagedStates);
  assert.equal(resolveCardBattlePlaybackStates(result, 2, "ended"), initialStates);
  assert.equal(resolveCardBattlePlaybackStates(result, 0, "aborted"), initialStates);
  assert.equal(resolveCardBattlePlaybackStates(result, 2, "ended")[0]?.hp, 1000);
  assert.equal(resolveCardBattlePlaybackStates(result, 2, "ended")[0]?.energy, 0);
  assert.equal(resolveCardBattlePlaybackStates(result, 2, "ended")[0]?.alive, true);
  assert.match(roomSource, /states: resolveCardBattlePlaybackStates\(result, completedSequence, status\)/);
  assert.match(roomSource, /settlement: playback!\.complete && gameStatus !== "aborted"/);
});

test("下一局开始前普通房要求房主和双方玩家播完，打榜房只要求挑战者播完", () => {
  assert.match(roomSource, /SELECT id, status, result_json FROM online_card_battles[^\n]+FOR UPDATE/);
  assert.match(roomSource, /requiredViewerIds = rankingChallenge/);
  assert.match(roomSource, /\? \[hostId\]/);
  assert.match(roomSource, /: \[\.\.\.new Set\(\[hostId, \.\.\.seatRows/);
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
