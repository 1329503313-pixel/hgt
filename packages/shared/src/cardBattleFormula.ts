export const CARD_BATTLE_FORMULA_SOURCES = {
  生命值: "hp", 攻击力: "attack", 防御力: "defense", 速度: "speed", 当前能量: "energy",
} as const;
export type CardBattleFormulaValues = Record<typeof CARD_BATTLE_FORMULA_SOURCES[keyof typeof CARD_BATTLE_FORMULA_SOURCES], number>;
export type CardBattleFormulaAudit = { ok: true; value: number } | { ok: false; reason: string };
export const normalizeCardBattleFormula = (formula: string) => formula.replace(/\s/g, "").replace(/（/g, "(").replace(/）/g, ")");

/** A bounded arithmetic parser: never executes JavaScript or accepts property/function access. */
export function auditCardBattleFormula(formula: string, values: CardBattleFormulaValues): CardBattleFormulaAudit {
  try {
    if (formula.length > 1000) throw new Error("公式过长");
    const source = normalizeCardBattleFormula(formula);
    if (!source) throw new Error("请先配置计算公式");
    if (source.length > 500) throw new Error("公式最多500个字符");
    const tokens = source.match(/生命值|攻击力|防御力|速度|当前能量|(?:\d+(?:\.\d+)?|\.\d+)|[+\-*/()]/g) ?? [];
    if (tokens.join("") !== source) throw new Error("仅支持指定属性、数字、小数和 + - * / ( )");
    if (tokens.length > 128) throw new Error("公式最多128个组成项");
    let cursor = 0;
    let depth = 0;
    const finite = (value: number) => {
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error("计算结果超出安全数值范围");
      return value;
    };
    const atom = (): number => {
      if (++depth > 16) throw new Error("括号或正负号嵌套不能超过16层");
      const token = tokens[cursor++];
      let value: number;
      if (token === "+" || token === "-") value = (token === "-" ? -1 : 1) * atom();
      else if (token === "(") {
        value = expression();
        if (tokens[cursor++] !== ")") throw new Error("缺少右括号");
      } else if (token && Object.hasOwn(CARD_BATTLE_FORMULA_SOURCES, token)) {
        value = values[CARD_BATTLE_FORMULA_SOURCES[token as keyof typeof CARD_BATTLE_FORMULA_SOURCES]];
      } else if (token && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(token)) value = Number(token);
      else throw new Error(token === ")" ? "括号内缺少数值或多余右括号" : "缺少数值或数值来源");
      depth--;
      return finite(value);
    };
    const product = (): number => {
      let value = atom();
      while (tokens[cursor] === "*" || tokens[cursor] === "/") {
        const operator = tokens[cursor++];
        const right = atom();
        if (operator === "/" && right === 0) throw new Error("除数不能为0");
        value = finite(operator === "*" ? value * right : value / right);
      }
      return value;
    };
    const expression = (): number => {
      let value = product();
      while (tokens[cursor] === "+" || tokens[cursor] === "-") {
        const operator = tokens[cursor++];
        const right = product();
        value = finite(operator === "+" ? value + right : value - right);
      }
      return value;
    };
    const value = expression();
    if (cursor !== tokens.length) throw new Error(tokens[cursor] === ")" ? "多余右括号" : "数值或括号之间缺少运算符");
    if (value < 0) throw new Error("计算结果不能为负数");
    if (value > 1_000_000_000) throw new Error("计算结果不能超过1000000000");
    return { ok: true, value: Math.round(value) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "无法计算公式" };
  }
}

export const cardBattleFormulaPreviewValues = (tier: { maxHp: number; attack: number; defense: number; speed: number; energyRequired: number }): CardBattleFormulaValues => ({
  hp: tier.maxHp, attack: tier.attack, defense: tier.defense, speed: tier.speed, energy: tier.energyRequired,
});
