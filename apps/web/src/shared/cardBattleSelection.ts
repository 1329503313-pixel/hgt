import { CARD_BATTLE_ROLE_LABELS } from "./digitalAssets";
import type { OnlineCardBattleCard } from "./types";

export type CardBattleRoleFilter = "all" | OnlineCardBattleCard["battleRole"];

export function filterCardBattleSelection<T extends Pick<OnlineCardBattleCard, "name" | "cardNo" | "battleRole">>(
  cards: readonly T[],
  query: string,
  role: CardBattleRoleFilter = "all",
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  return cards.filter((card) => (role === "all" || card.battleRole === role)
    && `${card.name} ${card.cardNo} ${CARD_BATTLE_ROLE_LABELS[card.battleRole]}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
}
