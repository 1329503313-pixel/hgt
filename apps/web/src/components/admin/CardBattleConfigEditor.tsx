import { Plus, Trash2 } from "lucide-react";
import type { CardBattleCondition, CardBattleEffectType, CardBattleTier } from "../../shared/digitalAssets";

const conditionLabels: Record<CardBattleCondition, string> = {
  energy_full: "能量为满",
  self_death: "本卡片死亡",
  self_hp_below_percent: "本卡片生命值降低至百分比",
  normal_kill: "本卡片的普通攻击击败卡片",
  skill_kill: "本卡片的技能击败卡片",
  ally_death: "有友方卡片阵亡",
  self_death_energy_full: "本卡片死亡且能量为满",
  self_hp_below_percent_energy_full: "本卡片生命值降低至百分比且能量为满",
  normal_kill_energy_full: "本卡片的普通攻击击败卡片且能量为满",
  skill_kill_energy_full: "本卡片的技能击败卡片且能量为满",
  ally_death_energy_full: "有友方卡片阵亡且能量为满",
};

const effectLabels: Record<CardBattleEffectType, string> = {
  damage_single: "造成单体伤害", damage_rear: "对敌方后排造成伤害", damage_random: "对随机敌人造成伤害",
  damage_all_front: "对所有前排造成伤害", damage_all_rear: "对所有后排造成伤害", damage_random_2: "对随机2名敌人造成伤害",
  damage_random_3: "对随机3名敌人造成伤害", damage_random_4: "对随机4名敌人造成伤害", damage_all: "对全部敌方造成伤害",
  heal_self: "恢复自身生命值", heal_lowest_ally: "恢复生命值最低的友军生命值", energy_self: "恢复自身能量",
  energy_lowest_ally: "恢复能量最低的友军能量", heal_all_allies: "恢复全体友军生命值", energy_all_allies: "恢复全体友军能量",
  defense_self: "增加自身防御力", defense_all_allies: "增加全体友军防御力", speed_self: "增加自身速度",
  speed_all_allies: "增加全体友军速度", max_hp_self: "增加自身生命值上限", max_hp_all_allies: "增加全体友军生命值上限",
  attack_self: "增加自己攻击力", attack_all_allies: "增加全体友军攻击力",
  attack_skill_damage_self: "增加自己攻击力和技能伤害", attack_skill_damage_all_allies: "增加全体友军攻击力和技能伤害",
  revive_self: "复活自己", revive_ally_1: "复活一名友军",
  revive_ally_2: "复活两名友军", revive_ally_3: "复活三名友军", revive_ally_4: "复活四名友军", revive_all_allies: "复活所有己方卡牌",
};

const numericEffects = new Set<CardBattleEffectType>(Object.keys(effectLabels).filter((key) => !key.startsWith("revive_")) as CardBattleEffectType[]);
const durationEffects = new Set<CardBattleEffectType>(["attack_self", "attack_all_allies", "attack_skill_damage_self", "attack_skill_damage_all_allies", "defense_self", "defense_all_allies", "speed_self", "speed_all_allies"]);
const thresholdConditions = new Set<CardBattleCondition>(["self_hp_below_percent", "self_hp_below_percent_energy_full"]);
const selfDeathConditions = new Set<CardBattleCondition>(["self_death", "self_death_energy_full"]);

function numberValue(value: string, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.round(parsed)) : minimum;
}

export function CardBattleConfigEditor({ tiers, activeStar, onActiveStar, onChange }: {
  tiers: CardBattleTier[];
  activeStar: 0 | 1 | 2 | 3;
  onActiveStar: (star: 0 | 1 | 2 | 3) => void;
  onChange: (tiers: CardBattleTier[]) => void;
}) {
  const tier = tiers.find((item) => item.starLevel === activeStar) ?? tiers[0];
  const updateTier = (changes: Partial<CardBattleTier>) => onChange(tiers.map((item) => item.starLevel === activeStar ? { ...item, ...changes } : item));
  const updateEffect = (index: number, changes: Partial<CardBattleTier["effects"][number]>) => updateTier({
    effects: tier.effects.map((effect, effectIndex) => effectIndex === index ? { ...effect, ...changes } : effect),
  });
  return <fieldset className="sm:col-span-2 rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
    <div><legend className="text-base font-black text-ink">卡牌对战配置</legend><p className="mt-1 text-xs leading-5 text-muted">0–3 星必须完整配置。技能可留空；每一行条件独立触发，并只绑定本行效果。</p></div>
    <div className="mt-3 grid grid-cols-4 gap-2" role="tablist" aria-label="选择卡牌星级">
      {([0, 1, 2, 3] as const).map((star) => <button key={star} type="button" role="tab" aria-selected={activeStar === star} className={`min-h-11 rounded-xl text-sm font-black transition ${activeStar === star ? "bg-violet-600 text-white" : "border border-violet-200 bg-white text-violet-800 hover:bg-violet-100"}`} onClick={() => onActiveStar(star)}>{star} 星</button>)}
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <label><span className="text-xs font-bold">生命值</span><input aria-label={`${activeStar}星生命值`} type="number" min="1" className="field mt-1" value={tier.maxHp} onChange={(event) => updateTier({ maxHp: numberValue(event.target.value, 1) })} /></label>
      <label><span className="text-xs font-bold">攻击力</span><input aria-label={`${activeStar}星攻击力`} type="number" min="0" className="field mt-1" value={tier.attack} onChange={(event) => updateTier({ attack: numberValue(event.target.value) })} /></label>
      <label><span className="text-xs font-bold">防御力</span><input aria-label={`${activeStar}星防御力`} type="number" min="0" className="field mt-1" value={tier.defense} onChange={(event) => updateTier({ defense: numberValue(event.target.value) })} /></label>
      <label><span className="text-xs font-bold">速度</span><input aria-label={`${activeStar}星速度`} type="number" min="0" className="field mt-1" value={tier.speed} onChange={(event) => updateTier({ speed: numberValue(event.target.value) })} /></label>
      <label><span className="text-xs font-bold">能量要求</span><input aria-label={`${activeStar}星能量要求`} type="number" min="1" className="field mt-1" value={tier.energyRequired} onChange={(event) => updateTier({ energyRequired: numberValue(event.target.value, 1) })} /></label>
      <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-violet-200 bg-white px-3"><input type="checkbox" checked={tier.canAttackRear} onChange={(event) => updateTier({ canAttackRear: event.target.checked })} /><span className="text-xs font-bold">普通攻击可攻击后排</span></label>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label><span className="text-xs font-bold">技能名称（可空）</span><input maxLength={50} className="field mt-1" value={tier.skillName} onChange={(event) => updateTier({ skillName: event.target.value })} /></label>
      <label><span className="text-xs font-bold">技能描述（可空）</span><textarea maxLength={500} className="field mt-1 min-h-20" value={tier.skillDescription} onChange={(event) => updateTier({ skillDescription: event.target.value })} /></label>
    </div>
    <div className="mt-4 flex items-center justify-between gap-3"><div><h4 className="text-sm font-black text-ink">技能条件与效果</h4><p className="text-[11px] text-muted">多行按从上到下顺序独立结算。</p></div><button type="button" className="btn btn-secondary min-h-11 px-3 text-xs" onClick={() => updateTier({ effects: [...tier.effects, { order: tier.effects.length, condition: "energy_full", conditionValue: null, type: "damage_single", value: 1, duration: null }] })}><Plus size={15} />新增条件</button></div>
    <div className="mt-3 space-y-3">
      {tier.effects.length === 0 ? <p className="rounded-xl border border-dashed border-violet-200 bg-white p-4 text-center text-xs text-muted">未配置技能效果；该星级只会进行普通攻击。</p> : tier.effects.map((effect, index) => <section key={effect.id ?? `${activeStar}-${index}`} className="rounded-xl border border-violet-200 bg-white p-3">
        <div className="mb-3 flex items-center justify-between"><strong className="text-xs text-violet-800">条件 {index + 1}</strong><button type="button" aria-label={`删除条件${index + 1}`} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-red-600 hover:bg-red-50" onClick={() => updateTier({ effects: tier.effects.filter((_, effectIndex) => effectIndex !== index).map((item, order) => ({ ...item, order })) })}><Trash2 size={16} /></button></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="text-xs font-bold">技能条件</span><select className="field mt-1" value={effect.condition} onChange={(event) => { const condition = event.target.value as CardBattleCondition; updateEffect(index, { condition, conditionValue: thresholdConditions.has(condition) ? (effect.conditionValue ?? 50) : null, ...(effect.type === "revive_self" && !selfDeathConditions.has(condition) ? { type: "revive_ally_1" as const } : {}) }); }}>{Object.entries(conditionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {thresholdConditions.has(effect.condition) && <label><span className="text-xs font-bold">生命值阈值（%）</span><input type="number" min="1" max="100" className="field mt-1" value={effect.conditionValue ?? 50} onChange={(event) => updateEffect(index, { conditionValue: Math.min(100, numberValue(event.target.value, 1)) })} /></label>}
          <label><span className="text-xs font-bold">技能类型</span><select className="field mt-1" value={effect.type} onChange={(event) => { const type = event.target.value as CardBattleEffectType; updateEffect(index, { type, value: numericEffects.has(type) ? (effect.value ?? 1) : null, duration: durationEffects.has(type) ? (effect.duration ?? 1) : null }); }}>{Object.entries(effectLabels).map(([value, label]) => <option key={value} value={value} disabled={value === "revive_self" && !selfDeathConditions.has(effect.condition)}>{label}</option>)}</select>{!selfDeathConditions.has(effect.condition) && <span className="mt-1 block text-[11px] leading-4 text-muted">“复活自己”仅在本卡片死亡条件下可选，避免技能空放并清空能量。</span>}</label>
          {numericEffects.has(effect.type) && <label><span className="text-xs font-bold">技能数值</span><input type="number" min="1" className="field mt-1" value={effect.value ?? 1} onChange={(event) => updateEffect(index, { value: numberValue(event.target.value, 1) })} />{effect.type.startsWith("attack_skill_damage_") && <span className="mt-1 block text-[11px] leading-4 text-muted">该数值同时增加普通攻击力与攻击性技能伤害。</span>}</label>}
          {durationEffects.has(effect.type) && <label><span className="text-xs font-bold">持续回合（本回合算 1）</span><input type="number" min="1" max="30" className="field mt-1" value={effect.duration ?? 1} onChange={(event) => updateEffect(index, { duration: Math.min(30, numberValue(event.target.value, 1)) })} /></label>}
        </div>
      </section>)}
    </div>
  </fieldset>;
}
