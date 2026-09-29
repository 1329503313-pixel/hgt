import type { CardBattleTrait } from "@hgt/shared";

export function CardBattleTraitBadges({
  traits,
  dark = false,
}: {
  traits: Pick<CardBattleTrait, "id" | "name" | "description">[];
  dark?: boolean;
}) {
  if (!traits.length) return null;
  return <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" aria-label="卡牌特质">
    {traits.map((trait) => <span key={trait.id} title={trait.description ? `${trait.name}：${trait.description}` : trait.name} className={`block min-w-0 max-w-full flex-1 truncate rounded-full px-1.5 py-0.5 text-center text-[9px] font-bold leading-4 ${dark ? "bg-slate-950/65 text-violet-100" : "bg-violet-50 text-violet-800"}`}>{trait.name}</span>)}
  </span>;
}
