import { CARD_BATTLE_DEFENSE_EFFECT_LABELS, CARD_BATTLE_ACCURACY_STATS, cardBattleDefenseNeedsDuration, cardBattleAccuracyStat, isCardBattleTrueDamage, isCardBattleShield } from "@hgt/shared";
import { CARD_BATTLE_CONTROL_LABELS, cardBattleControlNeedsDuration, isCardBattleControlEffect, isCardBattleStun, isCardBattleImmunity, isCardBattleCleanse, isCardBattleAttachedOnly } from "@hgt/shared";
import { useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { CARD_BATTLE_PROC_BUFF_LABELS, CARD_BATTLE_PROC_BUFF_CODES, CARD_BATTLE_PROC_STATS, cardBattleProcStat, isCardBattleDamageEffect } from "@hgt/shared";
import { CARD_BATTLE_DEBUFF_LABELS, isCardBattleDebuff } from "../../shared/cardBattleEffects";
import type { CardBattleCondition, CardBattleEffectType } from "../../shared/digitalAssets";

import { SearchableSkillSelect } from "./SearchableSkillSelect";
import { CardBattleBondsEditor } from "./CardBattleBondsEditor";
import { CardDamageValueEditor } from "./CardDamageValueEditor";
import type { CardBattleActionDraft, CardBattleTierDraft } from "./cardBattleEditorDraft";

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
  ...CARD_BATTLE_DEFENSE_EFFECT_LABELS,
  ...CARD_BATTLE_CONTROL_LABELS,
  ...CARD_BATTLE_PROC_BUFF_LABELS,
  ...CARD_BATTLE_DEBUFF_LABELS,
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

const numericEffects = new Set<string>(Object.keys(effectLabels).filter((key) => !key.startsWith("revive_") && (!isCardBattleControlEffect(key) || isCardBattleCleanse(key))) as CardBattleEffectType[]);
const durationEffects = new Set<string>(["attack_self", "attack_all_allies", "attack_skill_damage_self", "attack_skill_damage_all_allies", "defense_self", "defense_all_allies", "speed_self", "speed_all_allies"]);
for (const type of Object.keys(CARD_BATTLE_DEFENSE_EFFECT_LABELS).filter(cardBattleDefenseNeedsDuration)) durationEffects.add(type);
const thresholdConditions = new Set<string>(["self_hp_below_percent", "self_hp_below_percent_energy_full"]);
for (const type of Object.keys(CARD_BATTLE_DEBUFF_LABELS)) durationEffects.add(type as CardBattleEffectType);
for (const type of CARD_BATTLE_PROC_BUFF_CODES) durationEffects.add(type);
for (const type of Object.keys(CARD_BATTLE_CONTROL_LABELS).filter(cardBattleControlNeedsDuration)) durationEffects.add(type);
const effectMaximum = (type: CardBattleEffectType | "") => isCardBattleDebuff(type) || cardBattleProcStat(type) || cardBattleAccuracyStat(type) ? 100 : 1_000_000_000;
const selfDeathConditions = new Set<string>(["self_death", "self_death_energy_full"]);

const newSkillId = () => crypto.randomUUID?.() ?? `skill-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function numberValue(value: string, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.round(parsed)) : minimum;
}

export function CardBattleConfigEditor({ tiers, activeStar, onActiveStar, onChange, fixedStar = false }: {
  fixedStar?: boolean;
  tiers: CardBattleTierDraft[];
  activeStar: 0 | 1 | 2 | 3;
  onActiveStar: (star: 0 | 1 | 2 | 3) => void;
  onChange: (tiers: CardBattleTierDraft[]) => void;
}) {
  const [copyState, setCopyState] = useState({ star: -1, revision: 0 });
  const tier = tiers.find((item) => item.starLevel === activeStar) ?? tiers[0];
  const zeroStarTier = tiers.find((item) => item.starLevel === 0);
  const updateTier = (changes: Partial<CardBattleTierDraft>) => onChange(tiers.map((item) => item.starLevel === activeStar ? { ...item, ...changes } : item));
  const copyZeroStarSkills = () => {
    if (fixedStar || activeStar === 0 || !zeroStarTier) return;
    updateTier(structuredClone({
      energyRequired: zeroStarTier.energyRequired,
      skillName: zeroStarTier.skillName,
      skillDescription: zeroStarTier.skillDescription,
      effects: zeroStarTier.effects.map((effect) => ({
        ...effect,
        id: newSkillId(),
        ...(effect.additionalEffects ? { additionalEffects: effect.additionalEffects.map((action) => ({ ...action, id: newSkillId() })) } : {}),
      })),
      bonds: zeroStarTier.bonds ?? [],
    }));
    // Remount uncontrolled bond card-number inputs, including on repeated copies.
    setCopyState((current) => ({ star: activeStar, revision: current.revision + 1 }));
  };
  const updateSharedSkillName = (skillName: string) => onChange(tiers.map((item) => ({ ...item, skillName })));
  const updateEffect = (index: number, changes: Partial<CardBattleTierDraft["effects"][number]>) => updateTier({
    effects: tier.effects.map((effect, effectIndex) => effectIndex === index ? { ...effect, ...changes } : effect),
  });
  return <fieldset className="sm:col-span-2 rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
    <div><legend className="text-base font-black text-ink">卡牌对战配置{fixedStar && " · 固定三星"}</legend><p className="mt-1 text-xs leading-5 text-muted">{fixedStar ? "上架前须填写技能名称、描述及至少一条技能效果。" : "0–3 星必须完整配置。技能可留空；"}每一行条件独立触发，主技能与本行附加类型共用该条件。</p></div>
    {!fixedStar && <div className="mt-3 grid grid-cols-4 gap-2" role="tablist" aria-label="选择卡牌星级">
      {([0, 1, 2, 3] as const).map((star) => <button key={star} type="button" role="tab" aria-selected={activeStar === star} className={`min-h-11 rounded-xl text-sm font-black transition ${activeStar === star ? "bg-violet-600 text-white" : "border border-violet-200 bg-white text-violet-800 hover:bg-violet-100"}`} onClick={() => onActiveStar(star)}>{star} 星</button>)}
    </div>}
    {!fixedStar && activeStar > 0 && <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" className="btn btn-secondary min-h-11 shrink-0 px-3 text-xs" disabled={!zeroStarTier} onClick={copyZeroStarSkills}><Copy aria-hidden="true" size={15} />复制零星技能</button>
      <p className="min-w-0 flex-1 text-xs leading-5 text-muted">覆盖当前 {activeStar} 星的能量要求、技能描述、技能条件及附加效果、全部羁绊配置；其他属性不变，保存后生效。</p>
      {copyState.star === activeStar && <p role="status" className="w-full text-xs text-violet-800">已将零星技能和羁绊配置复制到 {activeStar} 星。</p>}
    </div>}
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <label><span className="text-xs font-bold">生命值</span><input aria-label={`${activeStar}星生命值`} type="number" min="1" className="field mt-1" value={tier.maxHp} onChange={(event) => updateTier({ maxHp: numberValue(event.target.value, 1) })} /></label>
      <label><span className="text-xs font-bold">攻击力</span><input aria-label={`${activeStar}星攻击力`} type="number" min="0" className="field mt-1" value={tier.attack} onChange={(event) => updateTier({ attack: numberValue(event.target.value) })} /></label>
      <label><span className="text-xs font-bold">防御力</span><input aria-label={`${activeStar}星防御力`} type="number" min="0" className="field mt-1" value={tier.defense} onChange={(event) => updateTier({ defense: numberValue(event.target.value) })} /></label>
      <label><span className="text-xs font-bold">速度</span><input aria-label={`${activeStar}星速度`} type="number" min="0" className="field mt-1" value={tier.speed} onChange={(event) => updateTier({ speed: numberValue(event.target.value) })} /></label>
      <label><span className="text-xs font-bold">能量要求</span><input aria-label={`${activeStar}星能量要求`} type="number" min="1" className="field mt-1" value={tier.energyRequired} onChange={(event) => updateTier({ energyRequired: numberValue(event.target.value, 1) })} /></label>
      <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-violet-200 bg-white px-3"><input type="checkbox" checked={tier.canAttackRear} onChange={(event) => updateTier({ canAttackRear: event.target.checked })} /><span className="text-xs font-bold">普通攻击可攻击后排</span></label>
    </div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label><span className="text-xs font-bold">暴击率（%）</span><input aria-label={`${activeStar}星暴击率`} type="number" min="0" max="100" step="0.01" className="field mt-1" value={tier.critRate ?? 25} onChange={(event) => updateTier({ critRate: Math.min(100, Math.max(0, Math.round(Number(event.target.value) * 100) / 100 || 0)) })} /></label>
      <label><span className="text-xs font-bold">暴击伤害（%）</span><input aria-label={`${activeStar}星暴击伤害`} type="number" min="100" max="10000" step="0.01" className="field mt-1" value={tier.critDamage ?? 150} onChange={(event) => updateTier({ critDamage: Math.min(10000, Math.max(100, Math.round(Number(event.target.value) * 100) / 100 || 100)) })} /></label>
      <p className="text-xs leading-5 text-muted sm:col-span-2">暴击只对普攻、伤害技能和治疗技能生效，按每个目标独立判定；150% 表示结算为原数值的 1.5 倍。属性增加、复活和回能不暴击。</p>
    </div>
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      {[...CARD_BATTLE_PROC_STATS, ...CARD_BATTLE_ACCURACY_STATS].map(({ key, label }) => <label key={key}><span className="text-xs font-bold">{label}（%）</span><input aria-label={`${activeStar}星${label}`} type="number" min="0" max="100" step="0.01" className="field mt-1 min-h-11" value={tier[key] ?? 0} onChange={(event) => updateTier({ [key]: Math.min(100, Math.max(0, Math.round(Number(event.target.value) * 100) / 100 || 0)) })} /></label>)}
      <p className="text-xs leading-5 text-muted sm:col-span-3">默认均为 0%。吸血按实际扣血与扣盾之和逐目标计算并四舍五入；击晕仅阻止本回合剩余行动；再动立即行动一次，再动及其触发链不再触发再动。反击按每次实际受伤独立判定，立即普攻伤害来源，双方均不因反击回能，反击不连锁反击或再动。闪避率减去对方命中率后，得到最终闪避概率（0%–100%）。</p>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label><span className="text-xs font-bold">{fixedStar ? "技能名称" : "技能名称（四星共用，可空）"}</span><input maxLength={50} className="field mt-1" value={tier.skillName} onChange={(event) => updateSharedSkillName(event.target.value)} />{!fixedStar && <span className="mt-1 block text-[11px] leading-5 text-muted">修改后同步到全部星级；技能描述、条件和效果仍按星级独立配置。</span>}</label>
      <label><span className="text-xs font-bold">{fixedStar ? "技能描述" : "技能描述（可空）"}</span><textarea maxLength={500} className="field mt-1 min-h-20" value={tier.skillDescription} onChange={(event) => updateTier({ skillDescription: event.target.value })} /></label>
    </div>
    <div className="mt-4 flex items-center justify-between gap-3"><div><h4 className="text-sm font-black text-ink">技能条件与效果</h4><p className="text-[11px] text-muted">多行按从上到下顺序独立结算。</p></div><button type="button" className="btn btn-secondary min-h-11 shrink-0 whitespace-nowrap px-3 text-xs" onClick={() => updateTier({ effects: [...tier.effects, { id: newSkillId(), order: tier.effects.length, condition: "energy_full", conditionValue: null, type: "damage_single", value: 1, ignoreDefensePercent: 0, duration: null }] })}><Plus size={15} />新增条件</button></div>
    <p className="mt-2 text-xs leading-5 text-muted">技能条件和类型可输入文字筛选；请点击选项或用方向键、回车确认，未选择的输入会在离开时清空。</p>
    <div className="mt-3 space-y-3">
      {tier.effects.length === 0 ? <p className="rounded-xl border border-dashed border-violet-200 bg-white p-4 text-center text-xs text-muted">未配置技能效果；该星级只会进行普通攻击。</p> : tier.effects.map((effect, index) => <section key={effect.id ?? `${activeStar}-${index}`} className="rounded-xl border border-violet-200 bg-white p-3">
        <div className="mb-3 flex items-center justify-between"><strong className="text-xs text-violet-800">条件 {index + 1}</strong><button type="button" aria-label={`删除条件${index + 1}`} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-red-600 hover:bg-red-50" onClick={() => updateTier({ effects: tier.effects.filter((_, effectIndex) => effectIndex !== index).map((item, order) => ({ ...item, order })) })}><Trash2 size={16} /></button></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SearchableSkillSelect label="技能条件" value={effect.condition}
            options={Object.entries(conditionLabels).map(([value, label]) => ({ value: value as CardBattleCondition, label }))}
            onChange={(condition) => updateEffect(index, condition === "" ? { condition } : {
              condition, conditionValue: thresholdConditions.has(condition) ? (effect.conditionValue ?? 50) : null,
              additionalEffects: effect.additionalEffects?.map((action) => action.type === "revive_self" && !selfDeathConditions.has(condition) ? { ...action, type: "revive_ally_1" } : action),
              ...(effect.type === "revive_self" && !selfDeathConditions.has(condition) ? { type: "revive_ally_1" as const } : {}),
            })} />
          {thresholdConditions.has(effect.condition) && <label><span className="text-xs font-bold">生命值阈值（%）</span><input type="number" min="1" max="100" className="field mt-1" value={effect.conditionValue ?? 50} onChange={(event) => updateEffect(index, { conditionValue: Math.min(100, numberValue(event.target.value, 1)) })} /></label>}
          <SkillActionFields tier={tier} action={effect} onChange={(changes) => updateEffect(index, changes)} condition={effect.condition} fieldPrefix={`${activeStar}星条件${index + 1}`} />

        </div>
        <div className="mt-4 border-t border-violet-100 pt-3">
          <div className="flex items-center justify-between gap-2"><strong className="text-xs text-violet-800">附加类型</strong><button type="button" className="btn btn-secondary min-h-11 shrink-0 px-3 text-xs" onClick={() => updateEffect(index, { additionalEffects: [...effect.additionalEffects ?? [], { id: newSkillId(), type: "", value: null, duration: null }] })}><Plus size={15} />添加附加类型</button></div>
          <p className="mt-1 text-xs leading-5 text-muted">共用本行技能条件，按顺序执行；立刻再次行动在其他效果结算后执行。</p>
          {(effect.additionalEffects ?? []).map((action, addition) => <div key={action.id ?? addition} className="mt-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
            <div className="mb-2 flex items-center justify-between"><strong className="text-xs">附加类型 {addition + 1}</strong><button type="button" aria-label={`删除条件${index + 1}附加类型${addition + 1}`} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-red-600 hover:bg-red-50" onClick={() => updateEffect(index, { additionalEffects: effect.additionalEffects!.filter((_, n) => n !== addition) })}><Trash2 size={16} /></button></div>
            <div className="grid gap-3 sm:grid-cols-2"><SkillActionFields tier={tier} action={action} attached condition={effect.condition} fieldPrefix={`${activeStar}星条件${index + 1}附加类型${addition + 1}`}
              groupHasDamage={[effect, ...effect.additionalEffects ?? []].some((item) => isCardBattleDamageEffect(item.type))}
              onChange={(changes) => updateEffect(index, { additionalEffects: effect.additionalEffects!.map((item, n) => n === addition ? { ...item, ...changes } : item) })} /></div>
          </div>)}
        </div>
      </section>)}
    </div>
    <CardBattleBondsEditor key={`${activeStar}-${copyState.revision}`} bonds={tier.bonds ?? []} onChange={bonds=>updateTier({bonds})}/>
  </fieldset>;
}

function SkillActionFields({ action, tier, onChange, condition, fieldPrefix, attached = false, groupHasDamage = false }: {
  tier: CardBattleTierDraft;
  action: CardBattleActionDraft; onChange: (changes: Partial<CardBattleActionDraft>) => void;
  condition: CardBattleCondition | ""; fieldPrefix: string; attached?: boolean; groupHasDamage?: boolean;
}) {
  return <>
          <SearchableSkillSelect label="技能类型" value={action.type}
            options={Object.entries(effectLabels).filter(([value]) => attached || !isCardBattleAttachedOnly(value)).map(([value, label]) => ({ value: value as CardBattleEffectType, label, disabled: value === "revive_self" && !selfDeathConditions.has(condition) || value === "revival_block_damaged" && !groupHasDamage }))}
            onChange={(type) => onChange(type === "" ? { type } : {
              type, value: numericEffects.has(type) ? Math.min(effectMaximum(type), action.value ?? 1) : null,
              damageType: undefined, damageFormula: undefined,
              ignoreDefensePercent: isCardBattleDamageEffect(type) && !isCardBattleTrueDamage(type) ? (action.ignoreDefensePercent ?? 0) : 0,
              probability: isCardBattleStun(type) ? (action.probability ?? 100) : undefined,
              duration: durationEffects.has(type) ? (action.duration ?? 1) : null,
            })}
            hint={action.type === "revival_block_damaged" ? groupHasDamage ? "仅禁止本技能实际扣血或扣盾的单位复活，包含本次击杀的单位。" : "请先为本技能配置伤害类型，否则无法保存。" : action.type === "act_again" ? "本技能其他效果结算后再行动一次；与概率再动合并，额外行动不再触发再动。" : !selfDeathConditions.has(condition) ? "“复活自己”仅在本卡片死亡条件下可选，避免技能空放并清空能量。" : undefined} />
          {isCardBattleDamageEffect(action.type) && <CardDamageValueEditor action={action} tier={tier} onChange={onChange} fieldPrefix={fieldPrefix} />}
          {numericEffects.has(action.type) && !isCardBattleDamageEffect(action.type) && <label><span className="text-xs font-bold">{isCardBattleCleanse(action.type) ? "清除 debuff 数量" : (cardBattleProcStat(action.type) || cardBattleAccuracyStat(action.type)) ? "属性变化（百分点）" : isCardBattleDebuff(action.type) ? "降低比例（%）" : "技能数值"}</span><input type="number" min="1" max={effectMaximum(action.type)} className="field mt-1" value={action.value ?? 1} onChange={(event) => onChange({ value: Math.min(effectMaximum(action.type), numberValue(event.target.value, 1)) })} />{!isCardBattleDebuff(action.type) && action.type.startsWith("attack_skill_damage_") && <span className="mt-1 block text-[11px] leading-4 text-muted">该数值同时增加普通攻击力与攻击性技能伤害。</span>}{cardBattleProcStat(action.type) ? <span className="mt-1 block text-[11px] leading-4 text-muted">直接增减百分点，例如 20% 降低 10 后为 10%；同属性同方向首层全效、后续半效，首层到期后下一层恢复全效，最终属性限制在 0%–100%。</span> : isCardBattleDebuff(action.type) && <span className="mt-1 block text-[11px] leading-4 text-muted">按包含增益的当前属性降低此百分比；同属性减益首层全效、后续半效，合计最多100%。</span>}</label>}
          {isCardBattleTrueDamage(action.type) && <p className="text-xs leading-5 text-muted sm:col-span-2">真实伤害直接扣除生命值，跳过护盾；仍可被闪避，并正常计算防御、暴击与技能伤害加成。</p>}
          {isCardBattleShield(action.type) && <p className="text-xs leading-5 text-muted sm:col-span-2">护盾全额叠加、独立到期；优先消耗最早到期的一层，到期仅清除该层剩余护盾。</p>}
          {cardBattleAccuracyStat(action.type) && <p className="text-xs leading-5 text-muted sm:col-span-2">按百分点全额叠加，各层独立计算持续回合。</p>}
          {isCardBattleDamageEffect(action.type) && !isCardBattleTrueDamage(action.type) && <label>
            <span className="text-xs font-bold">无视防御比例（%）</span>
            <input aria-label={`${fieldPrefix}无视防御比例`} type="number" min="0" max="100" step="0.01" className="field mt-1 min-h-11" value={action.ignoreDefensePercent ?? 0} onChange={(event) => onChange({ ignoreDefensePercent: Math.min(100, Math.max(0, Math.round(Number(event.target.value) * 100) / 100 || 0)) })} />
            <span className="mt-1 block text-xs leading-5 text-muted">仅本次伤害生效：0% 不忽略防御，100% 完全忽略目标当前防御。</span>
          </label>}
          {isCardBattleStun(action.type) && <label><span className="text-xs font-bold">生效概率（%）</span><input type="number" min="0" max="100" step="0.01" className="field mt-1" value={action.probability ?? 100} onChange={(event) => onChange({ probability: Math.min(100, Math.max(0, Math.round(Number(event.target.value) * 100) / 100 || 0)) })} /></label>}
          {durationEffects.has(action.type) && <label><span className="text-xs font-bold">{isCardBattleImmunity(action.type) ? "生效回合" : "持续回合"}（本回合算 1）</span><input type="number" min="1" step="1" className="field mt-1" value={action.duration ?? 1} onChange={(event) => onChange({ duration: numberValue(event.target.value, 1) })} /></label>}
          {isCardBattleImmunity(action.type) && <p className="text-xs leading-5 text-muted sm:col-span-2">阻止新施加的所有 debuff，包括眩晕和禁止复活；已有 debuff 不会清除，也不影响敌方的吸血和再动。</p>}
          {isCardBattleCleanse(action.type) && <p className="text-xs leading-5 text-muted sm:col-span-2">对每个存活目标分别净化，优先清除最早施加的 debuff；同种状态按层计数。</p>}
  </>;
}
