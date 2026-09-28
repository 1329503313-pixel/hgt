import { useEffect, useState } from "react";
import { Pencil, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { api } from "../../api";
import { Modal } from "../Modal";
import {
  CARD_BATTLE_TRAIT_EFFECTS, CARD_BATTLE_TRAIT_EFFECT_LABELS, CARD_BATTLE_TRAIT_TARGETS,
  CARD_BATTLE_TRAIT_TARGET_LABELS, cardBattleTraitEffectError, type CardBattleTrait, type CardBattleTraitEffect,
} from "@hgt/shared";

const newEffect = (): CardBattleTraitEffect => ({ requiredCount: 1, type: "attack", target: "trait_allies", valueType: "flat", value: 1, cadence: "fixed", durationRounds: null });
const effectText = (effect: CardBattleTraitEffect) => `${CARD_BATTLE_TRAIT_EFFECT_LABELS[effect.type]} ${effect.valueType === "percent" ? `${effect.value}%` : effect.value}${effect.cadence === "round" ? ` · 每回合，持续${effect.durationRounds}回合` : " · 固定"}`;

export function CardBattleTraitManagement() {
  const [traits, setTraits] = useState<CardBattleTrait[]>([]);
  const [editing, setEditing] = useState<CardBattleTrait | "new" | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "", effects: [newEffect()] as CardBattleTraitEffect[] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = async () => { setLoading(true); setError(""); try { setTraits((await api<{ traits: CardBattleTrait[] }>("/api/admin/card-battle/traits", { bypassCache: true })).traits); } catch (reason) { setError((reason as Error).message); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const open = (trait?: CardBattleTrait) => { setError(""); setNotice(""); setEditing(trait ?? "new"); setDraft(trait ? structuredClone({ name: trait.name, description: trait.description, effects: trait.effects }) : { name: "", description: "", effects: [newEffect()] }); };
  const update = (index: number, changes: Partial<CardBattleTraitEffect>) => setDraft((current) => ({ ...current, effects: current.effects.map((effect, i) => i === index ? { ...effect, ...changes } : effect) }));
  const save = async () => {
    if (!draft.name.trim()) { setError("请填写特质名称"); return; }
    if (draft.effects.length < 1 || draft.effects.length > 5) { setError("特质效果须为1-5条"); return; }
    const invalid = draft.effects.map(cardBattleTraitEffectError).find(Boolean);
    if (invalid) { setError(invalid); return; }
    setSaving(true); setError("");
    try { await api(editing !== "new" && editing ? `/api/admin/card-battle/traits/${editing.id}` : "/api/admin/card-battle/traits", { method: editing !== "new" && editing ? "PATCH" : "POST", body: draft }); setEditing(null); setNotice("特质已保存，已绑定卡牌将同步更新。"); await load(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setSaving(false); }
  };
  const remove = async (trait: CardBattleTrait) => {
    if (!window.confirm(`删除“${trait.name}”？所有已绑定卡牌将解除该特质，现有战斗记录保留快照。`)) return;
    setError(""); try { const result = await api<{ detachedCards: number }>(`/api/admin/card-battle/traits/${trait.id}`, { method: "DELETE" }); setNotice(`特质已删除，已从 ${result.detachedCards} 张卡牌解除绑定。`); await load(); } catch (reason) { setError((reason as Error).message); }
  };
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-black">卡牌特质</h2><p className="mt-1 text-sm text-muted">相同要求张数的效果组成一档；达到更高要求后，低档不再生效。</p></div><div className="flex gap-2"><button type="button" className="btn btn-secondary min-h-11" onClick={() => void load()} aria-label="刷新特质"><RefreshCw size={16} /></button><button type="button" className="btn btn-primary min-h-11" onClick={() => open()}><Plus size={16} />新增特质</button></div></div>
    {error && !editing && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {loading ? <p className="py-8 text-center text-muted">加载中…</p> : traits.length ? <div className="grid gap-3 lg:grid-cols-2">{traits.map((trait) => <article key={trait.id} className="card space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-black text-ink">{trait.name}</h3><p className="mt-1 whitespace-pre-wrap text-sm text-muted">{trait.description || "暂无描述"}</p></div><div className="flex shrink-0 gap-1"><button type="button" className="grid h-10 w-10 place-items-center rounded-xl hover:bg-slate-100" aria-label={`编辑${trait.name}`} onClick={() => open(trait)}><Pencil size={16} /></button><button type="button" className="grid h-10 w-10 place-items-center rounded-xl text-red-600 hover:bg-red-50" aria-label={`删除${trait.name}`} onClick={() => void remove(trait)}><Trash2 size={16} /></button></div></div><ol className="space-y-1 border-t border-line pt-3 text-sm">{trait.effects.map((effect, index) => <li key={index} className="flex flex-wrap items-center gap-x-2"><span className="font-bold text-blue-800">{effect.requiredCount}张档</span><span>{effectText(effect)}</span><span className="text-muted">{CARD_BATTLE_TRAIT_TARGET_LABELS[effect.target]}</span></li>)}</ol></article>)}</div> : <div className="card py-12 text-center text-sm text-muted">暂无卡牌特质</div>}
    {editing && <Modal full onClose={() => !saving && setEditing(null)}><div className="flex items-center justify-between gap-3"><div><h3 className="text-xl font-black">{editing === "new" ? "新增特质" : "编辑特质"}</h3><p className="mt-1 text-sm text-muted">最多5条效果；相同张数的效果同时生效。</p></div><button type="button" className="grid h-10 w-10 place-items-center rounded-full bg-slate-100" onClick={() => setEditing(null)} aria-label="关闭"><X size={18} /></button></div>
      <div className="mt-5 grid gap-3"><label><span className="text-sm font-bold">特质名称</span><input className="field mt-1" maxLength={80} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label><label><span className="text-sm font-bold">特质描述</span><textarea className="field mt-1 min-h-24" maxLength={2000} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
      <div className="flex items-center justify-between"><h4 className="font-black">特质效果</h4><button type="button" className="btn btn-secondary min-h-10 px-3" disabled={draft.effects.length >= 5} onClick={() => setDraft((current) => ({ ...current, effects: [...current.effects, newEffect()] }))}><Plus size={15} />添加效果</button></div>
      {draft.effects.map((effect, index) => <fieldset key={index} className="grid gap-3 rounded-2xl border border-line bg-slate-50 p-3 sm:grid-cols-2"><legend className="px-1 text-xs font-bold text-muted">效果 {index + 1}</legend><label><span className="text-xs font-bold">要求上场张数</span><input className="field mt-1" type="number" min={1} max={5} step={1} value={effect.requiredCount} onChange={(event) => update(index, { requiredCount: Number(event.target.value) })} /></label>
        <label><span className="text-xs font-bold">特质效果</span><select className="field mt-1" value={effect.type} onChange={(event) => { const type = event.target.value as CardBattleTraitEffect["type"]; const percentOnly = ["lifesteal_rate", "stun_rate", "extra_action_rate", "dodge_rate", "hit_rate", "counter_rate", "crit_rate", "crit_damage"].includes(type); update(index, { type, valueType: percentOnly ? "percent" : type === "energy" ? "flat" : effect.valueType, cadence: type === "heal" ? "round" : effect.cadence, durationRounds: type === "heal" ? effect.durationRounds ?? 1 : effect.durationRounds }); }}>{CARD_BATTLE_TRAIT_EFFECTS.map((type) => <option key={type} value={type}>{CARD_BATTLE_TRAIT_EFFECT_LABELS[type]}</option>)}</select></label>
        <label><span className="text-xs font-bold">特质对象</span><select className="field mt-1" value={effect.target} onChange={(event) => update(index, { target: event.target.value as CardBattleTraitEffect["target"] })}>{CARD_BATTLE_TRAIT_TARGETS.map((target) => <option key={target} value={target}>{CARD_BATTLE_TRAIT_TARGET_LABELS[target]}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2"><label><span className="text-xs font-bold">数值类型</span><select className="field mt-1" value={effect.valueType} disabled={["lifesteal_rate", "stun_rate", "extra_action_rate", "dodge_rate", "hit_rate", "counter_rate", "crit_rate", "crit_damage", "energy"].includes(effect.type)} onChange={(event) => update(index, { valueType: event.target.value as CardBattleTraitEffect["valueType"] })}><option value="flat">数值</option><option value="percent">百分比</option></select></label><label><span className="text-xs font-bold">效果数值</span><input className="field mt-1" type="number" min="0.01" max="1000000" step="0.01" value={effect.value} onChange={(event) => update(index, { value: Number(event.target.value) })} /></label></div>
        <label><span className="text-xs font-bold">特质类型</span><select className="field mt-1" value={effect.cadence} disabled={effect.type === "heal"} onChange={(event) => update(index, { cadence: event.target.value as CardBattleTraitEffect["cadence"], durationRounds: event.target.value === "fixed" ? null : effect.durationRounds ?? 1 })}><option value="fixed">固定数值特质</option><option value="round">每回合生效特质</option></select></label>
        {effect.cadence === "round" && <label><span className="text-xs font-bold">持续回合（1-30）</span><input className="field mt-1" type="number" min={1} max={30} step={1} value={effect.durationRounds ?? 1} onChange={(event) => update(index, { durationRounds: Number(event.target.value) })} /></label>}
        <div className="flex items-end justify-between gap-2 sm:col-span-2"><p className="text-xs leading-5 text-muted">{effect.cadence === "round" ? "每回合开始触发；本场仅有一次持续窗口。" : "随档位激活，失效时移除。"}</p><button type="button" className="btn btn-secondary min-h-10 px-3 text-red-700" disabled={draft.effects.length <= 1} onClick={() => setDraft((current) => ({ ...current, effects: current.effects.filter((_, i) => i !== index) }))}><Trash2 size={14} />删除</button></div>
      </fieldset>)}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<button type="button" className="btn btn-primary min-h-11" disabled={saving} onClick={() => void save()}><Save size={16} />{saving ? "保存中…" : "保存特质"}</button></div>
    </Modal>}
  </section>;
}
