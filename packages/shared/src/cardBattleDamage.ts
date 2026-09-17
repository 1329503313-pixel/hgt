/** Direct damage effects use this prefix, including future target variants. */
export function isCardBattleDamageEffect(type: string) {
  return type.startsWith("damage_");
}

export type CardBattleDamageOptions = {
  /** Missing fields in old skills mean fixed damage. */
  damageType?: "fixed" | "formula";
  damageFormula?: string;
  /** Internal frozen collection scaling; never accepted from editor input. */
  formulaMultiplier?: number;
  /** 0–100 percent of the target's effective defense ignored for this hit only. Old snapshots default to 0. */
  ignoreDefensePercent?: number;
};
