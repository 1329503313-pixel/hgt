import { X } from "lucide-react";
import { useState } from "react";
import { battleCollectibleEffects, BATTLE_COLLECTIBLE_EFFECT_LABELS, battleCollectibleEffectUnit } from "@hgt/shared";
import type { OnlineCardBattleCard } from "../shared/types";
import { Modal } from "./Modal";

export function BossLineupDetails({ groups, onClose }: { groups: Array<{ name: string; cards: OnlineCardBattleCard[] }>; onClose: () => void }) {
  const [selected, setSelected] = useState(0);
  return <Modal full onClose={onClose}><button className="float-right grid min-h-11 min-w-11 place-items-center rounded-full bg-slate-100 text-ink" onClick={onClose} aria-label="关闭阵容详情"><X size={18} /></button><h2 className="pr-10 text-xl font-black text-ink">本局阵容</h2>
    <div className="my-4 flex flex-wrap gap-2" role="group" aria-label="查看阵营">{groups.map((group, i) => <button key={i} className={`min-h-11 rounded-xl px-3 text-sm font-bold ${selected === i ? "bg-cyan-700 text-white" : "bg-slate-100 text-ink"}`} aria-pressed={selected === i} onClick={() => setSelected(i)}>{group.name}</button>)}</div>
    <div className="space-y-4">{groups[selected]?.cards.map((card, i) => <article key={`${card.id}-${i}`} className="rounded-xl border border-line p-3">
      <div className="flex gap-3"><img src={card.imageUrl} alt={card.name} className="aspect-[5/7] w-20 self-start rounded-lg object-cover" /><div className="min-w-0 flex-1"><h3 className="font-black text-ink">{card.name} · {card.starLevel}★</h3><p className="mt-1 text-xs text-muted">{i < (selected === 0 ? 2 : 1) ? "前排" : "后排"} · 战力 {card.combatPower.toLocaleString()}</p><p className="mt-2 text-sm font-bold text-cyan-700">{card.skillName || "未配置技能"}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-muted">{card.skillDescription || "仅普通攻击"}</p></div></div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">{([
        ["生命", card.stats.maxHp], ["攻击", card.stats.attack], ["防御", card.stats.defense], ["速度", card.stats.speed], ["能量", card.stats.energyRequired],
        ["吸血", `${card.stats.lifestealRate ?? 0}%`], ["暴击率", `${card.stats.critRate}%`], ["暴击伤害", `${card.stats.critDamage}%`], ["反击", `${card.stats.counterRate ?? 0}%`], ["再动", `${card.stats.extraActionRate ?? 0}%`], ["击晕", `${card.stats.stunRate ?? 0}%`], ["闪避率", `${card.stats.dodgeRate ?? 0}%`], ["命中率", `${card.stats.hitRate ?? 0}%`], ["普攻后排", card.stats.canAttackRear ? "允许" : "不允许"],
      ] as const).map(([label, value]) => <div key={label} className="flex justify-between gap-2"><dt className="text-muted">{label}</dt><dd className="font-bold text-ink">{value}</dd></div>)}</dl>
      {card.collectible && <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong>收藏品 · {card.collectible.name}</strong><p className="mt-1 whitespace-pre-wrap">{card.collectible.battleEffectDescription}</p>{battleCollectibleEffects(card.collectible).map((effect, index) => effect.type && <p key={index} className="mt-1">{BATTLE_COLLECTIBLE_EFFECT_LABELS[effect.type]} {effect.value}{battleCollectibleEffectUnit(effect.type)}</p>)}</div>}
    </article>)}</div>{!groups[selected]?.cards.length && <p className="py-10 text-center text-muted">该席位尚未配置卡牌</p>}
  </Modal>;
}
