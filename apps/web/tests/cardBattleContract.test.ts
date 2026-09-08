import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cardBattleFormationSize } from "../src/shared/cardBattleLayout.js";

test("阵容按半场空间放大，保持两排和横向安全间距", () => {
  for (const [width, height] of [[892, 260], [375, 300], [1440, 420], [320, 200]]) {
    const layout = cardBattleFormationSize(width!, height!);
    assert.ok(layout.cardWidth >= 48 && layout.cardWidth <= 160);
    assert.ok(layout.cardWidth * 3 + layout.columnGap * 2 <= width! - 32);
    assert.ok(layout.cardWidth * 2.8 + (width! <= 600 ? 64 : 48) <= height!);
    assert.ok(layout.columnGap >= 12);
  }
  assert.ok(cardBattleFormationSize(892, 260).cardWidth >= 75);
  assert.ok(cardBattleFormationSize(375, 300).cardWidth >= 84);
});
import { CARD_BATTLE_MOTIONS } from "../src/shared/cardBattleMotion.js";
import { CARD_BATTLE_DEBUFF_LABELS, CARD_BATTLE_STATUS_ORDER } from "../src/shared/cardBattleEffects.js";
import { cardBattleEffectCodes } from "../../server/src/cardBattle.js";
import { cardBattleStatusOrder } from "../../server/src/cardBattleStatus.js";

test("动画穷举服务端全部技能类型含全部复活与37种减益，状态顺序一致", () => {
  assert.deepEqual(Object.keys(CARD_BATTLE_MOTIONS).sort(), [...cardBattleEffectCodes].sort());
  assert.equal(Object.keys(CARD_BATTLE_DEBUFF_LABELS).length, 37);
  assert.deepEqual(CARD_BATTLE_STATUS_ORDER, cardBattleStatusOrder);
  for (const type of cardBattleEffectCodes) {
    assert.ok(CARD_BATTLE_MOTIONS[type].glyph);
    if (type.startsWith("revive_")) assert.equal(CARD_BATTLE_MOTIONS[type].motion, "summon");
  }
  assert.notEqual(CARD_BATTLE_MOTIONS.damage_single.pattern, CARD_BATTLE_MOTIONS.damage_random.pattern);
  assert.notEqual(CARD_BATTLE_MOTIONS.damage_random.pattern, CARD_BATTLE_MOTIONS.damage_all.pattern);
});
import { reorderCardBattleLineup } from "../src/shared/cardBattleLineup.js";
import { filterCardBattleSelection } from "../src/shared/cardBattleSelection.js";
import { cardBattleEventTiming, seekCardBattleAnimations } from "../src/shared/cardBattlePlayback.js";
import type { OnlineCardBattlePlayback } from "../src/shared/types.js";
import { defaultCardBattleTiersForRarity } from "../src/shared/digitalAssets.js";

const view = readFileSync(new URL("../src/components/CardBattleRoomView.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const lobby = readFileSync(new URL("../src/pages/OnlineSoupLobbyPage.tsx", import.meta.url), "utf8");
const roomPage = readFileSync(new URL("../src/pages/OnlineSoupRoomPage.tsx", import.meta.url), "utf8");
const assetAdmin = readFileSync(new URL("../src/components/admin/DigitalAssetManagement.tsx", import.meta.url), "utf8");
const battleConfigEditor = readFileSync(new URL("../src/components/admin/CardBattleConfigEditor.tsx", import.meta.url), "utf8");
const assetTypes = readFileSync(new URL("../src/shared/digitalAssets.ts", import.meta.url), "utf8");
const rankingPage = readFileSync(new URL("../src/pages/RankingsPage.tsx", import.meta.url), "utf8");
const rankingBoard = readFileSync(new URL("../src/components/CardBattleRankingBoard.tsx", import.meta.url), "utf8");
const cardCabinet = readFileSync(new URL("../src/components/CardCabinetSection.tsx", import.meta.url), "utf8");

test("所有星级预设25%暴击率和150%暴伤，编辑、选卡、详情与战斗反馈贯通", () => {
  for (const rarity of ["epic", "legend"] as const) {
    assert.ok(defaultCardBattleTiersForRarity(rarity).every((tier) => tier.critRate === 25 && tier.critDamage === 150));
  }
  for (const label of ["暴击率", "暴击伤害"]) {
    assert.ok(battleConfigEditor.includes(label));
    assert.ok(view.includes(`<dt>${label}</dt>`));
    assert.ok(cardCabinet.includes(label));
  }
  assert.match(battleConfigEditor, /属性增加、复活和回能不暴击/);
  assert.equal((view.match(/activeEffect.critical \? "暴击 "/g) ?? []).length, 2);
});

test("当前事件只计算剩余展示时间，迟到超过作用点立即应用状态", () => {
  const playback = { activeEvent: { durationMs: 1000 }, activeEventElapsedMs: 500 } as OnlineCardBattlePlayback;
  assert.deepEqual(cardBattleEventTiming(playback), { elapsed: 500, remaining: 500, impactRemaining: 50 });
  assert.deepEqual(cardBattleEventTiming(playback, 100), { elapsed: 600, remaining: 400, impactRemaining: 0 });
  assert.deepEqual(cardBattleEventTiming(playback, 2000), { elapsed: 2500, remaining: 0, impactRemaining: 0 });
  assert.equal(playback.activeEventElapsedMs, 500, "不篡改服务器快照");
});

test("服务器进度直接定位既有战斗动画，结束动画不会从头播放且不触碰无关动画", () => {
  let plays = 0;
  const battle = { animationName: "card-battle-attack-target", currentTime: 0, effect: { getComputedTiming: () => ({ endTime: 1050 }) }, playState: "finished", play: () => { plays++; } };
  const unrelated = { ...battle, animationName: "spinner", currentTime: 77 };
  const root = { getAnimations: () => [battle, unrelated] } as unknown as HTMLElement;
  seekCardBattleAnimations(root, 600);
  assert.equal(battle.currentTime, 600);
  assert.equal(unrelated.currentTime, 77);
  assert.equal(plays, 1);
  seekCardBattleAnimations(root, 1200);
  assert.equal(battle.currentTime, 1200);
  assert.equal(plays, 1);
});

test("大厅提供卡牌对战且玩家与观战身份由服务端自动分配", () => {
  assert.match(lobby, /contentType: "card_battle"/);
  assert.match(lobby, /卡牌对战/);
  assert.match(lobby, /join-auto/);
  assert.match(lobby, /至少五张启用中的史诗或传说卡/);
  assert.match(view, /只展示你拥有且当前启用的史诗或传说卡/);
});

test("管理后台为史诗和传说卡展示配置，并按品质初始化默认值", () => {
  assert.match(assetAdmin, /const isBattleRarity = \(rarity: AssetRarity\).*rarity === "epic" \|\| rarity === "legend"/);
  assert.match(assetAdmin, /freshBattleTiers\(latestCard\.rarity\)/);
  assert.match(assetAdmin, /freshBattleTiers\(rarity\)/);
  assert.match(assetAdmin, /isBattleRarity\(cardForm\.rarity\) && cardForm\.battleTiers/);
  assert.match(assetTypes, /maxHp: 800, attack: 250, defense: 30, speed: 80, energyRequired: 40/);
  assert.match(assetTypes, /maxHp: 1900, attack: 625, defense: 120, speed: 125, energyRequired: 40/);
});

test("管理后台和选卡弹窗展示对战定位并支持数值与技能视角", () => {
  assert.match(assetTypes, /CARD_BATTLE_ROLE_LABELS/);
  assert.match(assetAdmin, />对战定位</);
  assert.match(assetAdmin, /仅参与卡牌对战的史诗与传说卡可配置/);
  assert.match(view, /CARD_BATTLE_ROLE_LABELS\[card\.battleRole\]/);
  assert.doesNotMatch(view, /!selected && <span/);
  assert.match(view, /left-2 top-2[^\n]*CARD_BATTLE_ROLE_LABELS\[card\.battleRole\]/);
  assert.match(view, /selected && <span className="absolute right-2 top-2/);
  assert.match(view, /useState<CardView>\("stats"\)/);
  assert.match(view, /cardView === "skill"/);
  assert.match(view, />数值<\/button>/);
  assert.match(view, />技能<\/button>/);
  for (const label of ["生命", "攻击", "防御", "速度", "能量"]) assert.match(view, new RegExp(`<dt>${label}<\\/dt>`));
  assert.match(view, /card\.skillName \|\| "未配置技能"/);
  assert.match(view, /card\.skillDescription \|\| "暂无技能说明"/);
});

test("战场隐藏星级并使用共享动态媒体播放器", () => {
  const battleCard = view.slice(view.indexOf("export function BattleCard("), view.indexOf("export function CardBattleRoomView("));
  assert.doesNotMatch(battleCard, /card\.starLevel|★/);
  assert.match(view, /card\.motionMp4Url/);
  assert.match(view, /<AssetMotionMedia/);
  assert.match(view, /thumbnailUrl: card\.imageUrl/);
});

test("技能名称在四个星级联动，其他技能配置仍按当前星级编辑", () => {
  assert.match(battleConfigEditor, /updateSharedSkillName = \(skillName: string\) => onChange\(tiers\.map/);
  assert.match(battleConfigEditor, /onChange=\{\(event\) => updateSharedSkillName\(event\.target\.value\)\}/);
  assert.match(battleConfigEditor, /技能描述、条件和效果仍按星级独立配置/);
});

test("管理后台提供攻击力与攻击性技能伤害的自身和全体增益配置", () => {
  assert.match(battleConfigEditor, /attack_skill_damage_self: "增加自己攻击力和技能伤害"/);
  assert.match(battleConfigEditor, /attack_skill_damage_all_allies: "增加全体友军攻击力和技能伤害"/);
  assert.match(battleConfigEditor, /该数值同时增加普通攻击力与攻击性技能伤害/);
  assert.match(battleConfigEditor, /"attack_skill_damage_self", "attack_skill_damage_all_allies"/);
});

test("服务器时间轴驱动动画，恢复焦点直接同步且不依赖本地确认", () => {
  const hook = readFileSync(new URL("../src/shared/useServerCardBattlePlayback.ts", import.meta.url), "utf8");
  assert.match(view, /useServerCardBattlePlayback/);
  assert.doesNotMatch(hook, /playback\/ack|completedSequence\s*\+|visibilityState === "hidden"/);
  assert.match(hook, /visibilityState === "visible"/);
  for (const event of ["focus", "pageshow", "online", "visibilitychange"]) assert.ok(hook.includes(`addEventListener("${event}"`));
  assert.match(hook, /bypassCache: true, dedupe: false/);
  assert.match(view, /seekCardBattleAnimations\(arenaRef.current, animationDelayMs\)/);
  assert.doesNotMatch(view, /(?:skipAnimation|onSkip|跳过动画|跳过战斗)/);
  assert.match(styles, /card-battle-attack-target 1\.05s/);
  assert.match(view, /对局中对战者退出即认输/);
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
  assert.match(view, /const result = await api<\{ id: string \}>/);
  assert.match(view, /enqueueChatBubbles\(\[\{ id: result\.id, senderId: battle\.me\.userId/);
  assert.match(roomPage, /onReloadMessages=\{loadNewMessages\}/);
  assert.match(styles, /card-battle-chat-life 8s/);
});

test("房主开始战斗按钮与准备按钮并列，且双方准备后才启用", () => {
  assert.match(view, /const bothPlayersReady = battle\.seats\.length === 2 && battle\.seats\.every/);
  assert.match(view, /disabled=\{saving \|\| !bothPlayersReady\}/);
  assert.match(view, />开始战斗<\/button>/);
  assert.doesNotMatch(view, /card-battle-menu-item[^\n]*开始游戏/);
});

test("卡牌对战复用房间邀请并提供区分对战席与观战席的成员入口", () => {
  assert.match(view, /aria-label="分享房间"/);
  assert.match(view, /aria-label={`房间成员，共 \$\{snapshot\.members\.length\} 人`}/);
  assert.match(roomPage, /<OnlineSoupInviteModal roomId={roomId}/);
  assert.match(roomPage, /对战席 {occupiedBattleSeats}\/{snapshot\.room\.cardBattle\.seats\.length} · 观战席 {spectatorMembers\.length}/);
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

test("选卡支持搜索、四种排序并在选卡和战场展示战力", () => {
  assert.match(view, /placeholder="搜索卡牌名称、序号或定位"/);
  for (const sort of ["按序号排序", "按品质排序", "按星级排序", "按战力排序"]) assert.match(view, new RegExp(sort));
  assert.match(view, /cardRarityRank\[left\.rarity\] - cardRarityRank\[right\.rarity\]/);
  assert.match(view, /card\.combatPower/);
  assert.match(view, /战力 \{combatPowerFormatter\.format\(card\.combatPower\)\}/);
});

test("卡牌定位默认全部，三类定位筛选与搜索叠加且不改变原始卡牌列表", () => {
  const cards = [
    { name: "火焰", cardNo: "002", battleRole: "damage" as const },
    { name: "守卫", cardNo: "004", battleRole: "tank" as const },
    { name: "治愈", cardNo: "026", battleRole: "support" as const },
  ];
  assert.deepEqual(filterCardBattleSelection(cards, ""), cards);
  for (const role of ["damage", "tank", "support"] as const) {
    assert.deepEqual(filterCardBattleSelection(cards, "", role), cards.filter((card) => card.battleRole === role));
  }
  assert.deepEqual(filterCardBattleSelection(cards, " 004 ", "tank"), [cards[1]]);
  assert.deepEqual(filterCardBattleSelection(cards, "守卫", "damage"), []);
  assert.deepEqual(filterCardBattleSelection(cards, "辅助", "all"), [cards[2]]);
  assert.deepEqual(filterCardBattleSelection([], "", "tank"), []);
  assert.deepEqual(cards.map((card) => card.cardNo), ["002", "004", "026"]);
  assert.match(view, /useState<CardBattleRoleFilter>\("all"\)/);
  assert.match(view, /filterCardBattleSelection\(eligibleCards, cardQuery, cardRoleFilter\)/);
  assert.match(view, />卡牌定位<\/span><select value=\{cardRoleFilter\}/);
  for (const [value, label] of [["all", "全部"], ["damage", "输出"], ["tank", "坦克"], ["support", "辅助"]]) {
    assert.ok(view.includes(`<option value="${value}">${label}</option>`));
  }
});

test("备战支持保存、编辑和按固定位置使用卡组", () => {
  assert.match(view, />选择卡组<\/button>/);
  assert.match(view, /保存当前卡组/);
  assert.match(view, /编辑卡组/);
  assert.match(view, /用当前阵容覆盖卡组/);
  assert.match(view, /card-battle\/decks/);
  assert.match(view, /const next = \[\.\.\.deck\.cardIds\]/);
});

test("卡牌施放技能时在血条上方展示技能名称", () => {
  assert.match(view, /activeEvent\?\.kind === "skill" && isActiveActor && activeEvent\.skillName/);
  assert.match(view, /card-battle-skill-name/);
  assert.match(styles, /@keyframes card-battle-skill-name/);
});

test("收藏卡详情在底部展示当前星级的对战属性", () => {
  assert.match(cardCabinet, /detail\.battleTier && <section/);
  assert.match(cardCabinet, /当前持有的 \{detail\.starLevel\} 星属性/);
  for (const label of ["生命值", "攻击", "防御", "速度", "能量", "技能", "技能描述"]) {
    assert.match(cardCabinet, new RegExp(label));
  }
  assert.match(cardCabinet, /detail\.battleTier\.skillDescription/);
});

test("游戏榜提供固定百名卡牌对战榜、卡组详情和私密打榜入口", () => {
  assert.match(rankingPage, /group: "game"/);
  assert.match(rankingPage, />游戏榜<\/button>/);
  assert.match(rankingPage, /<CardBattleRankingBoard/);
  assert.match(rankingPage, /new URLSearchParams\(location\.search\)\.get\("tab"\)/);
  assert.match(rankingBoard, /查看更多（展示前 100 名）/);
  assert.match(rankingBoard, /空位，点击占据/);
  assert.match(rankingBoard, /空位，点击更新占榜/);
  assert.match(rankingBoard, /listedOwnRank \?\? data\?\.ownRank/);
  assert.doesNotMatch(rankingBoard, /卡组总星级/);
  assert.match(rankingBoard, /卡组总战力/);
  assert.match(rankingBoard, /kind: "replace"/);
  assert.match(rankingBoard, />更换卡组<\/button>/);
  assert.doesNotMatch(rankingBoard, /这是我的榜位/);
  assert.match(rankingBoard, /使用并打榜/);
  assert.match(view, /确认胜利并占据第/);
  assert.match(view, /私密打榜 · 目标第/);
  assert.match(view, /!battle\.rankingChallenge && <button[^\n]+aria-label="分享房间"/);
});

test("确认胜利与房间关闭统一返回已注册的卡牌榜，旧地址可刷新恢复", async () => {
  const { cardBattleRoomExit, CARD_BATTLE_RANKINGS_PATH } = await import("../src/shared/cardBattleNavigation");
  const app = readFileSync(new URL("../src/UserApp.tsx", import.meta.url), "utf8");
  const room = readFileSync(new URL("../src/pages/OnlineSoupRoomPage.tsx", import.meta.url), "utf8");
  assert.ok(app.includes(`path="${CARD_BATTLE_RANKINGS_PATH.slice(1)}"`));
  assert.match(app, /path="rankings" element=\{<Navigate to=\{CARD_BATTLE_RANKINGS_PATH\} state=\{CARD_BATTLE_RANKINGS_STATE\} replace/);
  assert.deepEqual(cardBattleRoomExit({ status: "active" }), { to: "/mine/rankings", options: { replace: true, state: { tab: "card_battle" } } });
  assert.deepEqual(cardBattleRoomExit(null), { to: "/online-soup", options: { replace: true } });
  assert.doesNotMatch(view, /navigate\("\/rankings"/);
  assert.match(room, /payload\.cause === "ranking_win_confirmed"/);
  assert.match(room, /cardBattleRoomExit\(ranking\)/);
});
