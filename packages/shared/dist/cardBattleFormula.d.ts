export declare const CARD_BATTLE_FORMULA_SOURCES: {
    readonly 生命值: "hp";
    readonly 攻击力: "attack";
    readonly 防御力: "defense";
    readonly 速度: "speed";
    readonly 当前能量: "energy";
};
export type CardBattleFormulaValues = Record<typeof CARD_BATTLE_FORMULA_SOURCES[keyof typeof CARD_BATTLE_FORMULA_SOURCES], number>;
export type CardBattleFormulaAudit = {
    ok: true;
    value: number;
} | {
    ok: false;
    reason: string;
};
export declare const normalizeCardBattleFormula: (formula: string) => string;
/** A bounded arithmetic parser: never executes JavaScript or accepts property/function access. */
export declare function auditCardBattleFormula(formula: string, values: CardBattleFormulaValues): CardBattleFormulaAudit;
export declare const cardBattleFormulaPreviewValues: (tier: {
    maxHp: number;
    attack: number;
    defense: number;
    speed: number;
    energyRequired: number;
}) => CardBattleFormulaValues;
