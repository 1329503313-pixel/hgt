import assert from "node:assert/strict";
import test from "node:test";
import { CARD_BATTLE_EVENT_CONDITION_CODES, type CardBattleBond, type CardBattleBondAction, type CardBattleEventCondition } from "@hgt/shared";
import { simulateCardBattle, type CardBattleDeckCard, type CardBattlePlayerInput, type CardBattleSkillEffect, type CardBattleTier } from "./cardBattle.js";
import { cardBattleEffectSchema, cardBattleTiersSchema, defaultCardBattleTiers, saveCardBattleTiers, loadCardBattleTiers } from "./cardBattleConfig.js";
import { cardBattleBondsSchema } from "./cardBattleBondSchema.js";
import type { PoolConnection } from "mysql2/promise";

const skill = (condition: CardBattleSkillEffect["condition"], type: CardBattleSkillEffect["type"] = "defense_self", value = 7): CardBattleSkillEffect => ({
  id: `${condition}-${type}`, order: 0, condition, conditionValue: null, type, value, duration: type === "defense_self" ? 1 : null,
});
const action = (type: CardBattleBondAction["type"], target: CardBattleBondAction["target"] = "self"): CardBattleBondAction => ({
  type, target, value: type === "energy" ? 10 : type === "speed_up" ? 9 : null, duration: type === "speed_up" ? 1 : null,
});
const bond = (event: CardBattleBond["event"], actions = [action("speed_up")], cardNos = ["A1"]): CardBattleBond => ({ event, cardNos, actions });
const side = (prefix: string): CardBattleDeckCard[] => [1, 2, 3, 4, 5].map(slot => ({
  instanceId: `${prefix}${slot}`, cardId: `${prefix}${slot}`, cardNo: `${prefix}${slot}`, name: `${prefix}${slot}`, slot: slot as 1,
  imageUrl: "", rarity: "epic", battleRole: "damage", starLevel: 0,
  motionMp4Url: null, motionWebmUrl: null, motionPosterUrl: null,
  tier: { maxHp: 100000, attack: 100, defense: 0, speed: 100 - slot, energyRequired: 1000,
    critRate: 0, critDamage: 150, lifestealRate: 0, stunRate: 0, extraActionRate: 0, counterRate: 0,
    dodgeRate: 0, hitRate: 0, canAttackRear: false, starLevel: 0, skillName: "事件技能", skillDescription: "", effects: [] },
}));
function setup(condition: CardBattleEventCondition, stats: Partial<CardBattleTier> = {}) {
  const a = side("A"), b = side("B");
  Object.assign(a[0]!.tier, stats, { effects: [skill(condition)] });
  a[4]!.tier.bonds = [bond(condition)];
  const players: CardBattlePlayerInput[] = [{ userId: "a", nickname: "a", seat: 1, cards: a }, { userId: "b", nickname: "b", seat: 2, cards: b }];
  return { a, b, run: () => simulateCardBattle(players, `event-${condition}`) };
}
const reactions = (result: ReturnType<typeof simulateCardBattle>, actorId = "A1") => result.events.filter(e => e.actorId === actorId && e.effectType === "defense_self");

test("四种事件条件可校验、保存、读取；羁绊共用同名事件且无需阈值", async () => {
  const tables: Record<string, Record<string, unknown>[]> = { asset_card_battle_tiers: [], asset_card_battle_effects: [] };
  const db = { query: async (sql: string, args: unknown[] = []) => {
    const insert = sql.match(/INSERT INTO (asset_card_battle_tiers|asset_card_battle_effects)\s*\(([^)]+)\)/);
    if (insert) tables[insert[1]!]!.push(Object.fromEntries(insert[2]!.split(",").map((column, index) => [column.trim(), args[index]])));
    if (sql.startsWith("SELECT * FROM asset_card_battle_tiers")) return [tables.asset_card_battle_tiers];
    if (sql.startsWith("SELECT * FROM asset_card_battle_effects")) return [tables.asset_card_battle_effects];
    return [[]];
  } } as unknown as PoolConnection;
  const tiers = defaultCardBattleTiers().map(tier => ({ ...tier,
    effects: CARD_BATTLE_EVENT_CONDITION_CODES.map((condition, order) => ({ ...skill(condition), id: `${tier.starLevel}-${condition}`, order })),
    bonds: CARD_BATTLE_EVENT_CONDITION_CODES.map(condition => bond(condition)),
  }));
  for (const condition of CARD_BATTLE_EVENT_CONDITION_CODES) {
    assert.ok(cardBattleEffectSchema.safeParse(skill(condition)).success);
    assert.ok(cardBattleBondsSchema.safeParse([bond(condition)]).success);
  }
  const parsed = cardBattleTiersSchema.parse(tiers);
  await saveCardBattleTiers("card", parsed, db);
  const loaded = await loadCardBattleTiers("card", db);
  for (const tier of loaded) {
    assert.deepEqual(tier.effects.map(effect => effect.condition), [...CARD_BATTLE_EVENT_CONDITION_CODES]);
    assert.deepEqual(tier.bonds?.map(bond => bond.event), [...CARD_BATTLE_EVENT_CONDITION_CODES]);
  }
});

test("普通攻击、群体伤害和真实伤害暴击触发自身技能与己方羁绊，同一施放只触发一次", () => {
  for (const type of [null, "damage_all", "damage_true_all"] as const) {
    const { a, run } = setup("critical", { critRate: 100 });
    if (type) {
      a[0]!.tier.effects.unshift(skill("energy_full", type, 100));
      a[0]!.tier.energyRequired = 10;
      a[0]!.tier.bonds = [bond("energy_empty", [action("energy")])];
    }
    const result = run();
    const firstHit = result.events.find(e => e.actorId === "A1" && e.visual === "damage")!;
    assert.ok(firstHit.effects.some(e => e.critical));
    assert.equal(reactions(result).filter(e => e.round === 1).length, 1);
    assert.equal(result.events.filter(e => e.round === 1 && e.bond?.ownerId === "A5" && e.effectType === "speed_self").length, 1);
    assert.ok(reactions(result)[0]!.sequence > firstHit.sequence);
  }
  const result = setup("critical", { critRate: 0 }).run();
  assert.equal(reactions(result).length, 0);
  assert.ok(!result.events.some(e => e.bond?.ownerId === "A5"));
});

test("治疗暴击不触发攻击暴击条件，伤害被闪避也不会产生暴击条件", () => {
  const healing = setup("critical", { critRate: 100, speed: 1, energyRequired: 10 });
  healing.a[0]!.tier.effects.unshift(skill("energy_full", "heal_all_allies", 10));
  healing.a[0]!.tier.bonds = [bond("energy_empty", [action("energy")])];
  const result = healing.run();
  assert.ok(result.events.some(e => e.actorId === "A1" && e.visual === "heal" && e.effects.some(v => v.critical)));
  assert.equal(reactions(result).length, 0);
  assert.ok(!result.events.some(e => e.bond?.ownerId === "A5"));
  const dodged = setup("critical", { critRate: 100 });
  for (const card of dodged.b) card.tier.dodgeRate = 100;
  // The opening buff keeps final dodge at 100% after the critical hit bonus.
  dodged.b[0]!.tier.bonds = [bond("energy_empty", [{ type: "dodge_up", target: "allies", value: 50, duration: 30 }], ["B1"])];
  assert.equal(reactions(dodged.run()).length, 0);
});

test("普通攻击或技能被闪避时，条件归闪避方；群体闪避逐卡触发，羁绊按同一连锁去重", () => {
  for (const group of [false, true]) {
    const { a, b, run } = setup("dodge");
    for (const card of a) { card.tier.dodgeRate = 100; card.tier.effects = [skill("dodge")]; }
    a[4]!.tier.bonds = [bond("dodge", undefined, a.map(card => card.cardNo!))];
    if (group) {
      b[0]!.tier.energyRequired = 10;
      b[0]!.tier.effects = [skill("energy_full", "damage_all", 100)];
      b[0]!.tier.bonds = [bond("energy_empty", [action("energy")], ["B1"])];
    }
    const result = run();
    assert.ok(result.events.some(e => e.effects.some(v => v.dodged)));
    assert.ok(result.events.some(e => e.effectType === "defense_self"));
    assert.ok(result.events.filter(e => e.effectType === "defense_self").every(e => e.actorId?.startsWith("A")));
    const triggered = result.events.filter(e => e.bond?.ownerId === "A5");
    assert.ok(triggered.length > 0);
    assert.ok(triggered.every(e => e.bond!.triggerId.startsWith("A")));
    if (group) {
      const first = result.events.find(e => e.actorId === "B1" && e.effectType === "damage_all")!;
      const next = result.events.find(e => e.sequence > first.sequence && e.actorId?.startsWith("B") && !e.bond)!;
      assert.equal(result.events.filter(e => e.sequence > first.sequence && e.sequence < next.sequence && e.effectType === "defense_self").length, 5);
    }
  }
  assert.equal(reactions(setup("dodge", { dodgeRate: 0 }).run()).length, 0);
});

test("成功击晕按施加者触发，概率失败与抵抗不触发", () => {
  for (const explicit of [false, true]) {
    for (const resisted of [false, true]) {
      const { a, b, run } = setup("stun", { stunRate: explicit ? 0 : 100 });
      if (explicit) {
        a[0]!.tier.energyRequired = 10;
        a[0]!.tier.effects.unshift({ ...skill("energy_full", "stun_enemy_all", 1), value: null, duration: 1, probability: 100 });
        a[0]!.tier.bonds = [bond("energy_empty", [action("energy")])];
      }
      if (resisted) for (const card of b) card.collectible = { id: card.cardId, collectibleNo: "001", name: "抗性", imageUrl: "", battleEffectDescription: "", battleEffectType: "debuff_resistance", battleEffectValue: 30 };
      const result = run();
      assert.equal(reactions(result).length > 0, !resisted);
      assert.equal(result.events.some(e => e.bond?.ownerId === "A5"), !resisted);
      if (!resisted) assert.equal(reactions(result).filter(e => e.round === 1).length, 1);
    }
  }
  assert.equal(reactions(setup("stun", { stunRate: 0 }).run()).length, 0);
});

test("自身概率再动与羁绊再动可触发条件，强制普攻或技能不冒充再动", () => {
  const natural = setup("extra_action", { extraActionRate: 100 }).run();
  assert.ok(reactions(natural).length > 0);
  assert.equal(reactions(natural).filter(e => e.round === 1).length, 1);
  assert.ok(natural.events.some(e => e.bond?.ownerId === "A5"));
  for (const type of ["act_again", "attack", "skill"] as const) {
    const { a, run } = setup("extra_action");
    a[1]!.tier.bonds = [bond("attack", [action(type, "trigger")])];
    const result = run();
    assert.equal(reactions(result).length > 0, type === "act_again", type);
    assert.equal(result.events.some(e => e.bond?.ownerId === "A5"), type === "act_again", type);
  }
});

test("暴击触发的伤害再次暴击不会自循环；新自然行动仍可触发", () => {
  const { a, run } = setup("critical", { critRate: 100 });
  a[0]!.tier.effects = [skill("critical", "damage_all", 1)];
  a[4]!.tier.bonds = [];
  const result = run();
  const triggered = result.events.filter(e => e.actorId === "A1" && e.effectType === "damage_all");
  assert.ok(triggered.length >= 2);
  for (const round of new Set(triggered.map(e => e.round))) assert.equal(triggered.filter(e => e.round === round).length, 1);
  assert.notEqual(result.endReason, "safety_limit");
});

test("暴击后被反击击杀或击晕时不执行存活条件技能，反击本身仍支持暴击条件", () => {
  for (const lethal of [false, true]) {
    const { a, b, run } = setup("critical", { critRate: 100, speed: 1000, maxHp: lethal ? 1 : 100000 });
    for (const card of b) { card.tier.counterRate = 100; card.tier.stunRate = lethal ? 0 : 100; }
    const result = run();
    const first = result.events.find(e => e.actorId === "A1" && e.kind === "attack")!;
    const nextRound = result.events.find(e => e.round > first.round)?.sequence ?? Infinity;
    assert.ok(result.events.some(e => e.counterattack));
    assert.ok(!reactions(result).some(e => e.sequence > first.sequence && e.sequence < nextRound));
  }
  const { a, run } = setup("critical", { critRate: 100, counterRate: 100 });
  a[0]!.tier.canAttackRear = true;
  const result = run();
  assert.ok(result.events.some(e => e.actorId === "A1" && e.counterattack && e.effects.some(v => v.critical)));
  assert.ok(reactions(result).length > 0);
});
