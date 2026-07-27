export const CURRENCY_TYPES = ["shell", "pearl"] as const;

export type CurrencyType = (typeof CURRENCY_TYPES)[number];

export const CURRENCY_DEFINITIONS: Record<
  CurrencyType,
  { name: string; balanceColumn: "shell_balance" | "pearl_balance"; decimals: 0 }
> = {
  shell: { name: "贝壳", balanceColumn: "shell_balance", decimals: 0 },
  pearl: { name: "明珠", balanceColumn: "pearl_balance", decimals: 0 }
};

export function isCurrencyType(value: unknown): value is CurrencyType {
  return typeof value === "string" && CURRENCY_TYPES.includes(value as CurrencyType);
}
