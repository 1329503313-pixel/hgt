/** Skill actions share a trigger only when explicitly attached to the same row. */
export const CARD_BATTLE_CONTROL_LABELS = {
    revival_block_all: "禁止所有敌方单位复活",
    revival_block_front: "禁止所有敌方前排单位复活",
    revival_block_rear: "禁止所有敌方后排单位复活",
    revival_block_damaged: "禁止敌方受到本技能伤害的单位复活",
    act_again: "立刻再次行动",
    stun_enemy_single: "令敌方一名单位眩晕",
    stun_enemy_front: "令敌方前排单位眩晕",
    stun_enemy_rear: "令敌方后排单位眩晕",
    stun_enemy_all: "令敌方所有单位眩晕",
    stun_enemy_random: "令敌方随机一名单位眩晕",
    immunity_self: "令自己获得免疫",
    immunity_front: "令己方前排获得免疫",
    immunity_rear: "令己方后排获得免疫",
    immunity_all: "令己方全员获得免疫",
    cleanse_self: "净化自己",
    cleanse_random: "净化随机一名友军",
    cleanse_front: "净化全体前排",
    cleanse_rear: "净化全体后排",
    cleanse_all: "净化全体友军",
};
export const CARD_BATTLE_CONTROL_CODES = Object.keys(CARD_BATTLE_CONTROL_LABELS);
export const isCardBattleControlEffect = (type) => Object.hasOwn(CARD_BATTLE_CONTROL_LABELS, type);
export const isCardBattleStun = (type) => type.startsWith("stun_enemy_");
export const isCardBattleRevivalBlock = (type) => type.startsWith("revival_block_");
export const isCardBattleImmunity = (type) => type.startsWith("immunity_");
export const isCardBattleCleanse = (type) => type.startsWith("cleanse_");
export const isCardBattleAttachedOnly = (type) => type === "act_again" || type === "revival_block_damaged";
export const cardBattleControlNeedsDuration = (type) => isCardBattleStun(type) || isCardBattleRevivalBlock(type) || isCardBattleImmunity(type);
/** Also classifies older frozen snapshots that predate the category field. */
export function cardBattleStatusCategory(type) {
    return type.endsWith("_down") || type === "stunned" || type === "revival_block" ? "debuff" : "buff";
}
