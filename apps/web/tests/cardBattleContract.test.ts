import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("../src/components/CardBattleRoomView.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const lobby = readFileSync(new URL("../src/pages/OnlineSoupLobbyPage.tsx", import.meta.url), "utf8");

test("大厅提供卡牌对战且玩家与观战身份由服务端自动分配", () => {
  assert.match(lobby, /contentType: "card_battle"/);
  assert.match(lobby, /卡牌对战/);
  assert.match(lobby, /join-auto/);
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

test("对战画面遵守前后排、生命色阶、聊天半屏和八秒淡出约定", () => {
  assert.match(view, /row\(\[3, 4, 5\]\).*row\(\[1, 2\]\)/s);
  assert.match(view, /row\(\[1, 2\]\).*row\(\[3, 4, 5\]\)/s);
  assert.match(view, /ratio >= \.75/);
  assert.match(view, /ratio >= \.5/);
  assert.match(view, /ratio >= \.25/);
  assert.match(view, /max-h-\[50%\]/);
  assert.match(view, /< 8000/);
  assert.match(styles, /card-battle-chat-life 8s/);
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
