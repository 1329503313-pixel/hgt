export const CARD_BATTLE_BOND_EVENTS = {
  attack: "普通攻击", skill: "使用技能", death: "死亡", damaged: "受到伤害",
  hp_half: "生命值降低至50%及以下", energy_full: "能量为满", energy_empty: "能量为空",
  extra_action: "触发再动", lifesteal: "触发吸血", stun: "触发击晕", stunned: "被击晕",
  healed: "被治疗", shielded: "被增加护盾",
} as const;
export const CARD_BATTLE_BOND_TARGETS = {
  self: "自己", trigger: "羁绊卡", random_1: "随机一张卡", random_2: "随机两张卡",
  random_3: "随机三张卡", random_4: "随机四张卡", allies: "全体友军",
  allies_rear: "全体友方后排", allies_front: "全体友方前排", enemies_front: "全体敌方前排",
  enemies_rear: "全体敌方后排", enemies: "全体敌方",
} as const;
export const CARD_BATTLE_BOND_ACTIONS = {
  act_again: "立即再次行动", attack: "立即普通攻击", skill: "立即无视能量释放技能并清空能量",
  attack_up: "立即增加攻击力", defense_up: "立即增加防御力", speed_up: "立即增加速度",
  max_hp_up: "立即增加生命值上限", heal: "立即恢复生命值", energy: "立即恢复能量",
  extra_action_up: "立即增加再动率", lifesteal_up: "立即增加吸血率", stun_up: "立即增加击晕率",
  speed_down: "立即降低速度",
} as const;
export type CardBattleBondEvent = keyof typeof CARD_BATTLE_BOND_EVENTS;
export type CardBattleBondTarget = keyof typeof CARD_BATTLE_BOND_TARGETS;
export type CardBattleBondActionType = keyof typeof CARD_BATTLE_BOND_ACTIONS;
export type CardBattleBondAction = { target: CardBattleBondTarget; type: CardBattleBondActionType; value: number | null; duration: number | null };
export type CardBattleBond = { id?: string; cardNos: string[]; event: CardBattleBondEvent; actions: CardBattleBondAction[] };
export const bondNeedsValue = (type: string) => Boolean(type) && !["act_again", "attack", "skill"].includes(type);
export const bondNeedsDuration = (type: string) => bondNeedsValue(type) && !["heal", "energy"].includes(type);
export const bondIsRate = (type: string) => ["extra_action_up", "lifesteal_up", "stun_up"].includes(type);
export const parseBondCardNos = (input: string) => [...new Set(input.trim().split(/\s+/).filter(Boolean))];
