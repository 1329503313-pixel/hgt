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
const assetTypes = readFileSync(new URL("../src/shared/digitalAssets.ts", import.meta.url), "utf8");
const rankingPage = readFileSync(new URL("../src/pages/RankingsPage.tsx", import.meta.url), "utf8");
const rankingBoard = readFileSync(new URL("../src/components/CardBattleRankingBoard.tsx", import.meta.url), "utf8");
const cardCabinet = readFileSync(new URL("../src/components/CardCabinetSection.tsx", import.meta.url), "utf8");

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
  assert.match(view, /!selected && <span/);
  assert.match(view, /useState<CardView>\("stats"\)/);
  assert.match(view, /cardView === "skill"/);
  assert.match(view, />数值<\/button>/);
  assert.match(view, />技能<\/button>/);
  for (const label of ["生命", "攻击", "防御", "速度", "能量"]) assert.match(view, new RegExp(`<dt>${label}<\\/dt>`));
  assert.match(view, /card\.skillName \|\| "未配置技能"/);
  assert.match(view, /card\.skillDescription \|\| "暂无技能说明"/);
});

test("战场保留星级并使用共享动态媒体播放器", () => {
  assert.match(view, /card\.name} · \{card\.starLevel}★/);
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

test("选卡支持搜索、四种排序并在选卡和战场展示战力", () => {
  assert.match(view, /placeholder="搜索卡牌名称、序号或定位"/);
  for (const sort of ["按序号排序", "按品质排序", "按星级排序", "按战力排序"]) assert.match(view, new RegExp(sort));
  assert.match(view, /cardRarityRank\[left\.rarity\] - cardRarityRank\[right\.rarity\]/);
  assert.match(view, /card\.combatPower/);
  assert.match(view, /战力 \{combatPowerFormatter\.format\(card\.combatPower\)\}/);
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
  assert.match(rankingBoard, /查看更多（展示前 100 名）/);
  assert.match(rankingBoard, /空位，点击占据/);
  assert.match(rankingBoard, /空位，点击更新占榜/);
  assert.match(rankingBoard, /entry\.rank >= data\.ownRank/);
  assert.match(rankingBoard, /卡组总星级/);
  assert.match(rankingBoard, /卡组总战力/);
  assert.match(rankingBoard, /使用并打榜/);
  assert.match(view, /确认胜利并占据第/);
  assert.match(view, /私密打榜 · 目标第/);
  assert.match(view, /!battle\.rankingChallenge && <button[^\n]+aria-label="分享房间"/);
});
