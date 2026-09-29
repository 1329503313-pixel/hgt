import { CARD_BATTLE_ROLE_LABELS } from "./digitalAssets";
import type { OnlineCardBattleCard } from "./types";
import type { CardBattleTrait } from "@hgt/shared";

export type CardBattleRoleFilter = "all" | OnlineCardBattleCard["battleRole"];

export function collectCardBattleTraits<T extends { traits?: CardBattleTrait[] }>(cards: readonly T[]): CardBattleTrait[] {
  const traits = new Map<string, CardBattleTrait>();
  for (const card of cards) for (const trait of card.traits ?? []) {
    if (!traits.has(trait.id)) traits.set(trait.id, trait);
  }
  return [...traits.values()];
}

export function filterCardBattleSelection<T extends Pick<OnlineCardBattleCard, "name" | "cardNo" | "battleRole"> & Partial<Pick<OnlineCardBattleCard, "traits">>>(
  cards: readonly T[],
  query: string,
  role: CardBattleRoleFilter = "all",
  traitId: string | null = null,
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  return cards.filter((card) => (role === "all" || card.battleRole === role)
    && (!traitId || (card.traits ?? []).some((trait) => trait.id === traitId))
    && `${card.name} ${card.cardNo} ${CARD_BATTLE_ROLE_LABELS[card.battleRole]} ${(card.traits ?? []).map((trait) => trait.name).join(" ")}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
}
