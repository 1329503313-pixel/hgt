import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reorderCardBattleLineup } from "../src/shared/cardBattleLineup.js";

const view = readFileSync(new URL("../src/components/CardBattleRoomView.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const lobby = readFileSync(new URL("../src/pages/OnlineSoupLobbyPage.tsx", import.meta.url), "utf8");
const roomPage = readFileSync(new URL("../src/pages/OnlineSoupRoomPage.tsx", import.meta.url), "utf8");
const assetAdmin = readFileSync(new URL("../src/components/admin/DigitalAssetManagement.tsx", import.meta.url), "utf8");
const battleConfigEditor = readFileSync(new URL("../src/components/admin/CardBattleConfigEditor.tsx", import.meta.url), "utf8");

test("大厅提供卡牌对战且玩家与观战身份由服务端自动分配", () => {
  assert.match(lobby, /contentType: "card_battle"/);
  assert.match(lobby, /卡牌对战/);
  assert.match(lobby, /join-auto/);
  assert.match(lobby, /至少五张启用中的传说卡/);
  assert.doesNotMatch(lobby, /史诗或传说卡/);
  assert.match(view, /只展示你拥有且当前启用的传说卡/);
  assert.doesNotMatch(view, /当前启用的史诗、传说卡/);
});

test("管理后台只为传说卡展示并初始化战斗配置", () => {
  assert.match(assetAdmin, /latestCard\.rarity === "legend" \? freshBattleTiers\(\) : null/);
  assert.match(assetAdmin, /battleTiers: rarity === "legend" \?/);
  assert.match(assetAdmin, /cardForm\.rarity === "legend" && cardForm\.battleTiers/);
  assert.doesNotMatch(assetAdmin, /\["epic", "legend"\]\.includes\([^\n]*(?:battleTiers|cardForm\.rarity)/);
});

test("管理后台提供攻击力与攻击性技能伤害的自身和全体增益配置", () => {
  assert.match(battleConfigEditor, /attack_skill_damage_self: "增加自己攻击力和技能伤害"/);
  assert.match(battleConfigEditor, /attack_skill_damage_all_allies: "增加全体友军攻击力和技能伤害"/);
  assert.match(battleConfigEditor, /该数值同时增加普通攻击力与攻击性技能伤害/);
  assert.match(battleConfigEditor, /"attack_skill_damage_self", "attack_skill_damage_all_allies"/);
});

test("战斗由服务端逐事件确认、页面隐藏时回滚未播完事件，且不存在本地跳过进度", () => {
  assert.match(view, /card-battle\/playback\/ack/);
  assert.match(view, /playback\?\.complete/);
  assert.doesNotMatch(view, /sessionStorage/);
  assert.match(view, /document\.visibilityState === "hidden"/);
  assert.match(view, /setCardStates\(playbackRef\.current\?\.states/);
  assert.match(view, /battle\.game\?\.lineups/);
  assert.doesNotMatch(view, /(?:skipAnimation|onSkip|跳过动画|跳过战斗)/);
  assert.match(styles, /card-battle-attack-target 1\.05s/);
  assert.match(styles, /--card-battle-attack-x/);
});

test("对战画面遵守前后排、生命色阶、聊天自底向上堆叠和八秒淡出约定", () => {
  assert.match(view, /row\(\[3, 4, 5\]\).*row\(\[1, 2\]\)/s);
  assert.match(view, /row\(\[1, 2\]\).*row\(\[3, 4, 5\]\)/s);
  assert.match(view, /ratio >= \.75/);
  assert.match(view, /ratio >= \.5/);
  assert.match(view, /ratio >= \.25/);
  assert.match(view, /setChatBubbles\(\(current\) => \[\.\.\.current, \.\.\.incoming/);
  assert.match(view, /expiresAt = Date\.now\(\) \+ 8000/);
  assert.match(view, /flex h-\[25%\].*flex-col justify-end/s);
  assert.match(view, /chatBubbles\.map/);
  assert.match(view, /seenBubbleIdsRef/);
  assert.match(styles, /card-battle-chat-life 8s/);
});

test("卡牌对战复用房间邀请并提供区分对战席与观战席的成员入口", () => {
  assert.match(view, /aria-label="分享房间"/);
  assert.match(view, /aria-label={`房间成员，共 \$\{snapshot\.members\.length\} 人`}/);
  assert.match(roomPage, /<OnlineSoupInviteModal roomId={roomId}/);
  assert.match(roomPage, /对战席 {occupiedBattleSeats}\/2 · 观战席 {spectatorMembers\.length}/);
  assert.match(roomPage, /号对战席/);
  assert.match(roomPage, /暂无观战成员/);
});

test("治疗复活、属性提升和能量分别使用绿色、黄色和蓝色反馈", () => {
  assert.match(view, /visual === "heal" \|\| activeEvent\?\.visual === "revive"/);
  assert.match(view, /card-battle-fx-green/);
  assert.match(view, /card-battle-fx-yellow/);
  assert.match(view, /card-battle-fx-blue/);
  assert.match(styles, /@keyframes card-battle-green/);
  assert.match(styles, /@keyframes card-battle-yellow/);
  assert.match(styles, /@keyframes card-battle-blue/);
});

test("备战卡牌支持鼠标和触控拖动换位并保留点击选卡", () => {
  assert.deepEqual(
    reorderCardBattleLineup(["a", "b", "c", "d", "e"], 1, 4),
    ["d", "b", "c", "a", "e"],
  );
  assert.deepEqual(
    reorderCardBattleLineup(["a", null, "c"], 1, 2),
    [null, "a", "c", null, null],
  );
  assert.match(view, /setPointerCapture/);
  assert.match(view, /document\.elementFromPoint/);
  assert.match(view, /reorderCardBattleLineup/);
  assert.match(view, /Alt\+ArrowLeft Alt\+ArrowRight/);
  assert.match(view, /拖动换位/);
  assert.match(view, /\? "准备" : `还需选择/);
  assert.doesNotMatch(view, /准备完成/);
});
