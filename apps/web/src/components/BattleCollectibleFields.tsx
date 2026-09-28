import { useId } from "react";
import { BATTLE_COLLECTIBLE_EFFECT_LABELS, battleCollectibleConfigError, battleCollectibleEffects, battleCollectibleEffectTypes, battleCollectibleEffectUnit, battleCollectibleRateTypes, type BattleCollectibleConfig, type BattleCollectibleEffect, type BattleCollectibleEffectType } from "@hgt/shared";

export function BattleCollectibleFields({ value, onChange }: { value: BattleCollectibleConfig; onChange: (value: BattleCollectibleConfig) => void }) {
  const id = useId();
  const effects = battleCollectibleEffects(value);
  const rows = effects.length ? effects : [{ type: null, value: null }];
  function change(next: BattleCollectibleEffect[]) {
    if (!next.length) return;
    onChange({ ...value, battleEffects: next, battleEffectType: next[0].type, battleEffectValue: next[0].value });
  }
  function update(index: number, effect: BattleCollectibleEffect) { change(rows.map((row, i) => i === index ? effect : row)); }
  return <fieldset className="min-w-0 rounded-2xl border border-line p-4 sm:col-span-2">
    <legend className="px-2 font-black text-ink">卡牌对战效果</legend>
    <label className="block"><span className="label">卡牌对战效果描述</span><textarea className="field mt-1 min-h-28" maxLength={10000} aria-describedby={id + "-description"} value={value.battleEffectDescription} onChange={(e) => onChange({ ...value, battleEffectDescription: e.target.value })} /></label>
    <p id={id + "-description"} className="mt-1 text-xs text-muted">多行纯文本，仅用于展示，不参与战斗计算。</p>
    <div className="mt-4 space-y-3">{rows.map((effect, index) => {
      const unit = battleCollectibleEffectUnit(effect.type);
      const error = battleCollectibleConfigError(effect.type, effect.value);
      const rowId = id + "-" + index;
      return <div key={index} className="rounded-xl border border-line p-3" role="group" aria-label={"效果 " + (index + 1)}>
        <div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm font-bold">效果 {index + 1}</span><button type="button" className="btn min-h-11 disabled:cursor-not-allowed disabled:opacity-40" aria-label={"删除效果 " + (index + 1)} disabled={rows.length === 1} onClick={() => change(rows.filter((_, i) => i !== index))}>删除</button></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0"><label htmlFor={rowId + "-type"} className="label">卡牌对战效果类型</label><select id={rowId + "-type"} className="field mt-1 min-h-11 w-full" value={effect.type ?? ""} onChange={(e) => update(index, { type: (e.target.value || null) as BattleCollectibleEffectType | null, value: e.target.value ? 1 : null })}><option value="">无效果</option>{battleCollectibleEffectTypes.map((type) => <option key={type} value={type}>{BATTLE_COLLECTIBLE_EFFECT_LABELS[type]}</option>)}</select></div>
          <div className="min-w-0"><label htmlFor={rowId + "-value"} className="label">卡牌对战效果属性（{unit}）</label><input id={rowId + "-value"} className="field mt-1 min-h-11 w-full" type="number" min={unit === "%" ? .01 : 1} max={unit === "回合" ? 30 : effect.type && battleCollectibleRateTypes.includes(effect.type) ? 100 : 1000000} step={unit === "%" ? .01 : 1} disabled={!effect.type} value={effect.value ?? ""} aria-invalid={Boolean(error)} aria-describedby={error ? rowId + "-error" : undefined} onChange={(e) => update(index, { ...effect, value: e.target.value === "" ? null : Number(e.target.value) })} /></div>
        </div>
        {error && <p id={rowId + "-error"} role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      </div>;
    })}</div>
    <button type="button" className="btn mt-3 min-h-11" onClick={() => change([...rows, { type: null, value: null }])}>添加效果</button>
    <p className="mt-3 text-xs leading-5 text-muted">可添加多种效果，至少保留一项；无需战斗加成时可选择“无效果”。减少能量上限后技能所需能量最低为 10。每回合效果在存活且在场时于回合开始触发，攻击与伤害加成持续累积；单体加成仅作用于单体技能。回合保护从开局开始计时，复活不重置。</p>
  </fieldset>;
}

export function BattleCollectibleDescription({ item }: { item: Partial<BattleCollectibleConfig> }) {
  const effects = battleCollectibleEffects(item).filter((effect) => effect.type);
  if (!item.battleEffectDescription && !effects.length) return null;
  return <section className="mt-4 rounded-xl border border-line bg-slate-50 p-4">
    <h3 className="text-sm font-black text-ink">卡牌对战效果</h3>
    {item.battleEffectDescription && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted">{item.battleEffectDescription}</p>}
    {effects.map((effect, index) => <p key={index} className="mt-2 text-sm font-bold text-primary">{BATTLE_COLLECTIBLE_EFFECT_LABELS[effect.type!]} · {effect.value}{battleCollectibleEffectUnit(effect.type)}</p>)}
  </section>;
}
