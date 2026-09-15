import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { digitalAssetRules } from "./digitalAssets.js";
import { GIFT_ICON_SIZE, optimizeGiftIcon } from "./giftImages.js";

const digitalAssetsSource = readFileSync(new URL("./digitalAssets.ts", import.meta.url), "utf8");

test("累计获得数量按1、4、9、19张自动升星", () => {
  assert.deepEqual([1, 3, 4, 8, 9, 18, 19, 20].map(digitalAssetRules.starForTotal), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.equal(digitalAssetRules.duplicateProgress(3, 0), 2);
  assert.equal(digitalAssetRules.duplicateProgress(8, 1), 4);
  assert.equal(digitalAssetRules.duplicateProgress(18, 2), 9);
  assert.equal(digitalAssetRules.duplicateProgress(19, 3), 0);
});

test("收藏值按当前星级计算而非历史累计", () => {
  assert.deepEqual(digitalAssetRules.collectionValues.normal, [1, 2, 5, 15]);
  assert.deepEqual(digitalAssetRules.collectionValues.rare, [2, 5, 12, 35]);
  assert.deepEqual(digitalAssetRules.collectionValues.epic, [5, 12, 30, 100]);
  assert.deepEqual(digitalAssetRules.collectionValues.legend, [15, 40, 120, 360]);
});

test("保底为10、60、150且同时触发时优先最高品质", () => {
  assert.deepEqual(digitalAssetRules.pityLimits, { rare: 10, epic: 60, legend: 150 });
  assert.equal(digitalAssetRules.pityTrigger({ rare_count: 9, epic_count: 58, legend_count: 148 }), "rare");
  assert.equal(digitalAssetRules.pityTrigger({ rare_count: 9, epic_count: 59, legend_count: 148 }), "epic");
  assert.equal(digitalAssetRules.pityTrigger({ rare_count: 9, epic_count: 59, legend_count: 149 }), "legend");
});

test("保底仅在同类型卡包之间共享", () => {
  const permanentScope = digitalAssetRules.pityScopeForPackType("permanent");
  const limitedScope = digitalAssetRules.pityScopeForPackType("limited");
  const collaborationScope = digitalAssetRules.pityScopeForPackType("collaboration");

  assert.equal(permanentScope, digitalAssetRules.pityScopeForPackType("permanent"));
  assert.equal(limitedScope, digitalAssetRules.pityScopeForPackType("limited"));
  assert.equal(collaborationScope, digitalAssetRules.pityScopeForPackType("collaboration"));
  assert.equal(new Set([permanentScope, limitedScope, collaborationScope]).size, 3);
});

test("传说只重置传说与稀有保底，史诗保底继续推进", () => {
  const state = { rare_count: 7, epic_count: 20, legend_count: 40 };
  assert.deepEqual(digitalAssetRules.updatePity(state, "rare"), { rare: 0, epic: 21, legend: 41 });
  assert.deepEqual(digitalAssetRules.updatePity(state, "epic"), { rare: 0, epic: 0, legend: 41 });
  assert.deepEqual(digitalAssetRules.updatePity(state, "legend"), { rare: 0, epic: 21, legend: 0 });
  const due = digitalAssetRules.updatePity({ rare_count:9, epic_count:59, legend_count:149 }, "legend");
  assert.deepEqual(due,{rare:0,epic:60,legend:0});
  assert.equal(digitalAssetRules.pityTrigger({rare_count:due.rare,epic_count:due.epic,legend_count:due.legend}),"epic");
  assert.equal(digitalAssetRules.updatePity({rare_count:0,epic_count:60,legend_count:0},"legend").epic,60);
});

const drawCards = [
  {id:'normal',rarity:'normal'},{id:'rare',rarity:'rare'},
  {id:'a',rarity:'epic'},{id:'b',rarity:'epic'},{id:'c',rarity:'epic'},
  {id:'legend',rarity:'legend'}
] as never as Parameters<typeof digitalAssetRules.resolveEpicUp>[0];
const drawConfig = {enabled:drawCards,rarityProbabilities:{normal:60,rare:30,epic:9,legend:1}} as Parameters<typeof digitalAssetRules.userDrawConfiguration>[0];

test("未满星史诗存在时满星卡排除，所有史诗满星后恢复重复抽取且无UP",()=>{
  const owned=new Map([['a',3],['b',2],['c',3],['legend',3]]);
  const config=digitalAssetRules.userDrawConfiguration(drawConfig,owned);
  assert.deepEqual(config.enabled.map(card=>card.id),['normal','rare','b','legend']);
  const up=digitalAssetRules.resolveEpicUp(drawCards,owned,{cardId:'a',guaranteed:true});
  assert.deepEqual(up,{cardId:'b',guaranteed:true});
  assert.equal(digitalAssetRules.actualCardProbability(config,drawCards[2],up),0);
  assert.equal(digitalAssetRules.actualCardProbability(config,drawCards[3],up),9);
  for(let i=0;i<20;i++) assert.equal(digitalAssetRules.chooseWeighted(config.enabled,{normal:0,rare:0,epic:100,legend:0},null,up).card.id,'b');
  owned.set('b',3);
  const full=digitalAssetRules.userDrawConfiguration(drawConfig,owned);
  assert.equal(full.enabled.length,drawCards.length);
  assert.equal(digitalAssetRules.resolveEpicUp(drawCards,owned,up),null);
  assert.equal(digitalAssetRules.actualCardProbability(full,drawCards[2],null),3);
  assert.doesNotMatch(digitalAssetRules.probabilityDisclosure(full,null),/UP/);
  assert.equal(digitalAssetRules.chooseWeighted(full.enabled,{normal:0,rare:0,epic:100,legend:0},'epic',null).card.rarity,'epic');
});

test("UP按卡包顺序跳过满星并循环，新增未获得史诗可恢复UP",()=>{
  assert.deepEqual(digitalAssetRules.resolveEpicUp(drawCards,new Map([['b',3],['c',3]]),{cardId:'b',guaranteed:true}),{cardId:'a',guaranteed:true});
  assert.deepEqual(digitalAssetRules.resolveEpicUp(drawCards,new Map([['a',3],['b',3]]),null),{cardId:'c',guaranteed:false});
  assert.equal(digitalAssetRules.resolveEpicUp(drawCards.filter(card=>card.rarity!=='epic'),new Map(),null),null);
});

test("所有传说满星后传说保底精确兑换当前UP史诗，并重置两种保底",()=>{
  const configuration={...drawConfig,enabled:[...drawCards,{id:'legend-2',rarity:'legend'}]} as typeof drawConfig;
  const owned=new Map([['legend',3],['legend-2',3],['a',3],['b',2]]);
  for(const guaranteed of [false,true]) {
    const result=digitalAssetRules.chooseUserDraw(configuration,owned,{rare_count:9,epic_count:59,legend_count:149},{cardId:'b',guaranteed});
    assert.equal(result.card.id,'b');
    assert.equal(result.triggeredPity,'legend');
    assert.equal(result.legendPityConvertedToEpic,true);
    assert.equal(result.normalizedProbability,1);
    assert.equal(result.epicUpResult?.hitUp,true);
    assert.equal(result.epicUpResult?.guaranteedNext,false);
    assert.deepEqual(result.nextPity,{rare:0,epic:0,legend:0});
  }
});

test("有未满星或未获得传说时不转换；全部史诗满星或没有史诗时仍出传说",()=>{
  const configuration={...drawConfig,enabled:[...drawCards,{id:'legend-2',rarity:'legend'}]} as typeof drawConfig;
  const due={rare_count:9,epic_count:59,legend_count:149};
  for(const stars of [undefined,0,2]) {
    const owned=new Map([['legend',3]]);
    if(stars!==undefined) owned.set('legend-2',stars);
    const result=digitalAssetRules.chooseUserDraw(configuration,owned,due,{cardId:'a',guaranteed:false});
    assert.equal(result.card.rarity,'legend');
    assert.equal(result.legendPityConvertedToEpic,false);
    assert.deepEqual(result.nextPity,{rare:0,epic:60,legend:0});
  }
  const full=new Map([['legend',3],['legend-2',3],['a',3],['b',3],['c',3]]);
  for(const config of [configuration,{...configuration,enabled:configuration.enabled.filter(c=>c.rarity!=='epic')}]) {
    const result=digitalAssetRules.chooseUserDraw(config,full,due,null);
    assert.equal(result.card.rarity,'legend');
    assert.equal(result.legendPityConvertedToEpic,false);
  }
});

test("普通传说出卡不兑换UP，普通史诗出卡不重置传说保底",()=>{
  const owned=new Map([['legend',3]]);
  const pity={rare_count:0,epic_count:20,legend_count:40};
  const up={cardId:'a',guaranteed:false};
  const legend=digitalAssetRules.chooseUserDraw({...drawConfig,rarityProbabilities:{normal:0,rare:0,epic:0,legend:100}},owned,pity,up);
  assert.equal(legend.card.rarity,'legend');
  assert.equal(legend.legendPityConvertedToEpic,false);
  assert.deepEqual(legend.nextPity,{rare:0,epic:21,legend:0});
  const epic=digitalAssetRules.chooseUserDraw({...drawConfig,rarityProbabilities:{normal:0,rare:0,epic:100,legend:0}},owned,pity,up);
  assert.equal(epic.card.rarity,'epic');
  assert.deepEqual(epic.nextPity,{rare:0,epic:0,legend:41});
});

test("十连中兑换使最后一张史诗满星后立即取消UP，后续抽取恢复普通规则",()=>{
  const owned=new Map([['legend',3],['a',2],['b',3],['c',3]]);
  let up=digitalAssetRules.resolveEpicUp(drawCards,owned,null);
  let pity={rare_count:9,epic_count:59,legend_count:149};
  const configuration={...drawConfig,rarityProbabilities:{normal:0,rare:0,epic:100,legend:0}};
  for(let index=0;index<10;index++) {
    const result=digitalAssetRules.chooseUserDraw(configuration,owned,pity,up);
    assert.equal(result.card.rarity,'epic');
    assert.equal(result.legendPityConvertedToEpic,index===0);
    if(index===0) {
      assert.equal(result.card.id,'a');
      owned.set('a',digitalAssetRules.starForTotal(19));
    } else assert.equal(result.epicUpResult,null);
    up=digitalAssetRules.resolveEpicUp(drawCards,owned,up);
    assert.equal(up,null);
    pity={rare_count:result.nextPity.rare,epic_count:result.nextPity.epic,legend_count:result.nextPity.legend};
  }
  assert.equal(pity.legend_count,9);
});

test("史诗UP按50%命中，歪后下一张史诗必定命中当前UP", () => {
  const cards = [
    { id: "epic-a" },
    { id: "epic-b" },
    { id: "epic-c" }
  ] as never;
  const hit = digitalAssetRules.chooseEpicUpCard(cards, "epic-a", false, () => 0);
  assert.equal(hit.card.id, "epic-a");
  assert.equal(hit.hitUp, true);
  assert.equal(hit.guaranteedNext, false);

  const randomValues = [1, 1];
  const missed = digitalAssetRules.chooseEpicUpCard(cards, "epic-a", false, () => randomValues.shift() ?? 0);
  assert.equal(missed.card.id, "epic-c");
  assert.equal(missed.hitUp, false);
  assert.equal(missed.guaranteedNext, true);

  const guaranteedAfterSwitch = digitalAssetRules.chooseEpicUpCard(cards, "epic-b", missed.guaranteedNext, () => {
    throw new Error("必出UP时不应再随机判定");
  });
  assert.equal(guaranteedAfterSwitch.card.id, "epic-b");
  assert.equal(guaranteedAfterSwitch.hitUp, true);
  assert.equal(guaranteedAfterSwitch.guaranteedNext, false);
});

test("卡包只有一张史诗卡时始终抽中该UP", () => {
  const result = digitalAssetRules.chooseEpicUpCard([{ id: "only-epic" }] as never, "only-epic", false, () => {
    throw new Error("单张史诗卡不应进行随机判定");
  });
  assert.equal(result.card.id, "only-epic");
  assert.equal(result.hitUp, true);
  assert.equal(result.guaranteedNext, false);
});

test("满星重复返还按品质固定", () => {
  assert.deepEqual(digitalAssetRules.fullStarRefunds, { normal: 0, rare: 1, epic: 2, legend: 5 });
});

test("卡包抽取统计将数据库聚合值转换为前端数字", () => {
  assert.deepEqual(digitalAssetRules.packDrawStatistics({ total_draw_count: "128", recent_7d_draw_count: "37" }), {
    totalDrawCount: 128,
    recent7dDrawCount: 37
  });
  assert.deepEqual(digitalAssetRules.packDrawStatistics({ total_draw_count: null, recent_7d_draw_count: undefined }), {
    totalDrawCount: 0,
    recent7dDrawCount: 0
  });
});

test("资产排行榜按实时订阅状态返回 VIP 等级与有效状态", () => {
  const now = new Date("2026-08-21T00:00:00.000Z");
  assert.deepEqual(digitalAssetRules.assetRankingVipIdentity({
    role: "vip",
    vip_growth_value: 800,
    vip_expires_at: "2026-08-22T00:00:00.000Z",
    vip_legacy_active: 0
  } as never, now), { vipLevel: 3, vipActive: true });
  assert.deepEqual(digitalAssetRules.assetRankingVipIdentity({
    role: "vip",
    vip_growth_value: 800,
    vip_expires_at: "2026-08-20T00:00:00.000Z",
    vip_legacy_active: 0
  } as never, now), { vipLevel: 3, vipActive: false });
});

test("卡包封面固定选择卡号最小的传说卡", () => {
  const cards = [
    { card_no: "010", rarity: "legend" },
    { card_no: "2", rarity: "legend" },
    { card_no: "001", rarity: "epic" },
    { card_no: "003", rarity: "legend" }
  ];
  assert.equal(digitalAssetRules.lowestLegendCard(cards)?.card_no, "2");
  assert.equal(digitalAssetRules.lowestLegendCard(cards.filter((card) => card.rarity !== "legend")), null);
});

test("普通、稀有、史诗和传说卡均支持动态卡面", () => {
  assert.deepEqual(
    ["normal", "rare", "epic", "legend"].map(digitalAssetRules.cardRaritySupportsMotion),
    [true, true, true, true]
  );
  assert.equal(digitalAssetRules.cardRaritySupportsMotion("unknown"), false);
});

test("收藏柜按当前持有星级返回卡牌对战属性", () => {
  assert.match(digitalAssetsSource, /LEFT JOIN asset_card_battle_tiers battle_tier/);
  assert.match(digitalAssetsSource, /battle_tier\.card_id = c\.id AND battle_tier\.star_level = uc\.star_level/);
  assert.match(digitalAssetsSource, /battleTier: row\.battle_star_level == null \? null/);
  for (const field of ["maxHp", "attack", "defense", "speed", "energyRequired", "skillName", "skillDescription"]) {
    assert.match(digitalAssetsSource, new RegExp(`${field}:`));
  }
});

test("卡包介绍使用数据库属性，兼容零值和缺失配置且不暴露内部字段", () => {
  const row = {
    rarity: "epic", star_level: "0", max_hp: "800", attack_value: "250", defense_value: "30",
    speed_value: "80", energy_required: "40", crit_rate: "0", crit_damage: "150",
    lifesteal_rate: "12.5", stun_rate: null, extra_action_rate: "0", skill_name: "潮汐",
    skill_description: "第一段\n第二段", card_id: "private-id", internal: "不应返回"
  } as never;
  assert.deepEqual(digitalAssetRules.packCardBattlePreview(row), {
    starLevel: 0, maxHp: 800, attack: 250, defense: 30, speed: 80, energyRequired: 40,
    critRate: 0, critDamage: 150, lifestealRate: 12.5, stunRate: 0, extraActionRate: 0, dodgeRate: 0, hitRate: 0,
    skillName: "潮汐", skillDescription: "第一段\n第二段"
  });
  assert.equal(digitalAssetRules.packCardBattlePreview(undefined), null);
  for (const rarity of ["normal", "rare"]) {
    assert.equal(digitalAssetRules.packCardBattlePreview({ ...row as object, rarity } as never), null);
  }
  const ownedLegend = digitalAssetRules.packCardBattlePreview({ ...row as object, rarity: "legend", star_level: 3, max_hp: 3456 } as never);
  assert.equal(ownedLegend?.starLevel, 3);
  assert.equal(ownedLegend?.maxHp, 3456);
});

test("礼物图标压缩为透明背景正方形 WebP", async () => {
  const source = await sharp({
    create: {
      width: 320,
      height: 160,
      channels: 4,
      background: { r: 255, g: 80, b: 120, alpha: 0.8 }
    }
  }).png().toBuffer();
  const optimized = await optimizeGiftIcon(`data:image/png;base64,${source.toString("base64")}`);
  assert.ok(optimized);
  assert.match(optimized, /^data:image\/webp;base64,/);
  const metadata = await sharp(Buffer.from(optimized.split(",")[1], "base64")).metadata();
  assert.equal(metadata.width, GIFT_ICON_SIZE);
  assert.equal(metadata.height, GIFT_ICON_SIZE);
});
