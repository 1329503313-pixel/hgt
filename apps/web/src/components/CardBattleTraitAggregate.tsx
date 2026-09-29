import { useState } from "react";
import {
  activeCardBattleTraitEffects,
  CARD_BATTLE_TRAIT_EFFECT_LABELS,
  CARD_BATTLE_TRAIT_TARGET_LABELS,
  type CardBattleTrait,
} from "@hgt/shared";
import { Modal } from "./Modal";

export function CardBattleTraitAggregate({ title, cards, activeIds, activeOnly = false }: {
  title: string;
  cards: Array<{ traits?: CardBattleTrait[] } | null>;
  activeIds?: Set<string>;
  activeOnly?: boolean;
}) {
  const [selectedTraitId, setSelectedTraitId] = useState<string | null>(null);
  const grouped = new Map<string, { trait: CardBattleTrait; count: number }>();
  for (const card of cards) for (const trait of card?.traits ?? []) {
    const entry = grouped.get(trait.id);
    if (entry) entry.count += 1; else grouped.set(trait.id, { trait, count: 1 });
  }
  const entries = [...grouped.values()].flatMap(({ trait, count }) => {
    const effects = activeCardBattleTraitEffects(trait, count);
    const active = activeOnly ? Boolean(activeIds?.has(trait.id)) : effects.length > 0;
    const threshold = effects[0]?.requiredCount ?? (trait.effects.length ? Math.min(...trait.effects.map((effect) => effect.requiredCount)) : null);
    return activeOnly && !active ? [] : [{ trait, count, active, threshold }];
  });
  if (!activeOnly) entries.sort((left, right) => right.count - left.count);
  const selected = entries.find(({ trait }) => trait.id === selectedTraitId);
  const thresholds = selected ? [...new Set(selected.trait.effects.map((effect) => effect.requiredCount))].sort((a, b) => a - b) : [];
  if (!entries.length) return null;

  return <>
    <section className="shrink-0 border-b border-white/10 bg-slate-950/70 px-3 py-2" aria-label={`${title}特质聚合`}>
      <p className="mb-1 text-[10px] font-bold text-slate-400">{title}特质</p>
      <div className="flex flex-wrap gap-1.5">{entries.map(({ trait, count, active, threshold }) => (
        <button key={trait.id} type="button" title={trait.description} aria-label={`查看${trait.name}特质效果，已有${count}张`} aria-haspopup="dialog" onClick={() => setSelectedTraitId(trait.id)} className={`min-h-11 rounded-full border px-2.5 py-1 text-[10px] font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${active ? "border-blue-300/40 bg-blue-500/20 text-blue-200 hover:bg-blue-500/30" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"}`}>
          {trait.name} {threshold === null ? `${count}张` : `${count}/${threshold}`}
        </button>
      ))}</div>
    </section>
    {selected && <Modal onClose={() => setSelectedTraitId(null)}>
      <div role="dialog" aria-modal="true" aria-label={`${selected.trait.name}特质效果`} className="text-ink">
        <h2 className="break-words text-xl font-black">{selected.trait.name}</h2>
        <p className="mt-2 text-sm font-bold text-primary">当前阵容拥有 {selected.count} 张</p>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-body">{selected.trait.description || "暂无特质描述"}</p>
        <div className="mt-4 space-y-3">{thresholds.map((threshold) => {
          const current = selected.active && selected.threshold === threshold;
          const status = current ? "当前档位" : selected.count < threshold ? "未达成" : "已由高档替代";
          return <section key={threshold} className={`rounded-xl border p-3 ${current ? "border-blue-200 bg-blue-50" : "border-line bg-slate-50"}`}>
            <h3 className="flex flex-wrap items-center justify-between gap-2 text-sm font-black"><span>{threshold} 张</span><span className={current ? "text-primary" : "text-muted"}>{status}</span></h3>
            <ul className="mt-2 space-y-2 text-sm leading-6 text-body">{selected.trait.effects.filter((effect) => effect.requiredCount === threshold).map((effect, index) => (
              <li key={index} className="break-words">{CARD_BATTLE_TRAIT_TARGET_LABELS[effect.target]}：{CARD_BATTLE_TRAIT_EFFECT_LABELS[effect.type]} {effect.value}{effect.valueType === "percent" ? "%" : ""}；{effect.cadence === "round" ? `每回合生效，持续 ${effect.durationRounds} 回合` : "固定生效"}</li>
            ))}</ul>
          </section>;
        })}</div>
      </div>
    </Modal>}
  </>;
}
