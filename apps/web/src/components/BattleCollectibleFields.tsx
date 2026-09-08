import { useId } from "react";
import { BATTLE_COLLECTIBLE_EFFECT_LABELS, battleCollectibleConfigError, battleCollectibleEffectTypes, battleCollectibleEffectUnit, type BattleCollectibleConfig, type BattleCollectibleEffectType } from "@hgt/shared";

export function BattleCollectibleFields({ value, onChange }: { value: BattleCollectibleConfig; onChange: (value: BattleCollectibleConfig) => void }) {
  const descriptionId = useId();
  const errorId = useId();
  const typeId = useId();
  const valueId = useId();
  const unit = battleCollectibleEffectUnit(value.battleEffectType);
  const error = battleCollectibleConfigError(value.battleEffectType, value.battleEffectValue);
  return <fieldset className="rounded-2xl border border-line p-4 sm:col-span-2">
    <legend className="px-2 font-black text-ink">卡牌对战效果</legend>
    <label className="block"><span className="label">卡牌对战效果描述</span><textarea className="field mt-1 min-h-28" maxLength={10000} aria-describedby={descriptionId} value={value.battleEffectDescription} onChange={(e) => onChange({ ...value, battleEffectDescription: e.target.value })} /></label>
    <p id={descriptionId} className="mt-1 text-xs text-muted">多行纯文本，仅用于展示，不参与战斗计算。</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <div><label htmlFor={typeId} className="label">卡牌对战效果类型</label><select id={typeId} className="field mt-1 min-h-11" value={value.battleEffectType ?? ""} onChange={(e) => onChange({ ...value, battleEffectType: (e.target.value || null) as BattleCollectibleEffectType | null, battleEffectValue: e.target.value ? 1 : null })}><option value="">无效果</option>{battleCollectibleEffectTypes.map((type) => <option key={type} value={type}>{BATTLE_COLLECTIBLE_EFFECT_LABELS[type]}</option>)}</select></div>
      <div><label htmlFor={valueId} className="label">卡牌对战效果属性（{unit}）</label><input id={valueId} className="field mt-1 min-h-11" type="number" min={unit === "%" ? .01 : 1} max={unit === "回合" ? 30 : value.battleEffectType === "crit_rate" ? 100 : 1000000} step={unit === "%" ? .01 : 1} disabled={!value.battleEffectType} value={value.battleEffectValue ?? ""} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={(e) => onChange({ ...value, battleEffectValue: e.target.value === "" ? null : Number(e.target.value) })} /></div>
    </div>
    {error && <p id={errorId} role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    <p className="mt-3 text-xs leading-5 text-muted">每件收藏品配置一种效果。减少能量后技能所需能量最低为 10；回合保护从开局开始计时，复活不重置。</p>
  </fieldset>;
}

export function BattleCollectibleDescription({ item }: { item: Partial<BattleCollectibleConfig> }) {
  if (!item.battleEffectDescription && !item.battleEffectType) return null;
  return <section className="mt-4 rounded-xl border border-line bg-slate-50 p-4">
    <h3 className="text-sm font-black text-ink">卡牌对战效果</h3>
    {item.battleEffectDescription && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted">{item.battleEffectDescription}</p>}
    {item.battleEffectType && <p className="mt-2 text-sm font-bold text-primary">{BATTLE_COLLECTIBLE_EFFECT_LABELS[item.battleEffectType]} · {item.battleEffectValue}{battleCollectibleEffectUnit(item.battleEffectType)}</p>}
  </section>;
}
