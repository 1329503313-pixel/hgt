import { useEffect, useState, type FormEvent } from "react";
import { Plus, Pencil, Swords, History, RefreshCw, Upload, X } from "lucide-react";
import { api } from "../../api";
import { Modal } from "../Modal";
import { AdminPagination } from "./AdminPagination";
import { CardBattleConfigEditor } from "./CardBattleConfigEditor";
import { cardBattleSelectionError, type CardBattleTierDraft } from "./cardBattleEditorDraft";
import { DEFAULT_LEGEND_CARD_BATTLE_TIERS } from "../../shared/digitalAssets";
import { bossDateInput, bossDateIso, bossSlotNames, type BossCard, type BossBattleRecord, type BossReplay, type CardBattleBoss } from "../../shared/cardBattleBoss";
import { CardBattleBossReplay } from "../CardBattleBossReplay";

const base = "/api/online-soup/admin/card-battle-bosses";
const dateText = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
const errorText = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试";
type BossCardDraft = Omit<BossCard, "tier"> & { tier: CardBattleTierDraft };
type Draft = { roomId?: string; revision?: number; name: string; startsAt: string; endsAt: string; enabled: boolean; rewardShells: number; cards: Array<BossCardDraft | null> };
type TraitOption = import("@hgt/shared").CardBattleTrait;

export function BossEditor({ boss, onClose, onSaved, tower }: { boss: CardBattleBoss | null; onClose: () => void; onSaved: () => void; tower?: { id?: string; floorNumber: number } }) {
  const [draft, setDraft] = useState<Draft>(() => boss ? { ...structuredClone(boss), startsAt: bossDateInput(boss.startsAt), endsAt: bossDateInput(boss.endsAt) } : {
    name: "", startsAt: bossDateInput(new Date().toISOString()), endsAt: bossDateInput(new Date(Date.now() + 7 * 86400_000).toISOString()), enabled: false, rewardShells: 0, cards: Array(5).fill(null),
  });
  const [slot, setSlot] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [traitOptions, setTraitOptions] = useState<TraitOption[]>([]);
  useEffect(() => { void api<{ traits: TraitOption[] }>("/api/admin/card-battle/traits", { bypassCache: true }).then((value) => setTraitOptions(value.traits)).catch((failure) => setError(errorText(failure))); }, []);
  const card = draft.cards[slot];
  const setCard = (value: BossCardDraft | null) => setDraft((current) => ({ ...current, cards: current.cards.map((item, i) => i === slot ? value : item) }));
  async function upload(file: File) {
    if (!card) return;
    if (file.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setError("请选择 5MB 以内的 PNG、JPG 或 WebP 封面"); return; }
    setBusy(true); setError("");
    try {
      const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("图片读取失败")); reader.readAsDataURL(file); });
      const result = await api<{ imageUrl: string }>(`${base}/covers`, { method: "POST", body: { image } });
      setCard({ ...card, imageUrl: result.imageUrl });
    } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    for (const [index, candidate] of draft.cards.entries()) {
      const selectionError = candidate && cardBattleSelectionError([candidate.tier]);
      if (selectionError) { setError(`${bossSlotNames[index]}：${selectionError}`); setSlot(index); return; }
    }
    setBusy(true); setError("");
    try {
      if (tower) await api(`/api/online-soup/admin/card-tower/floors${tower.id ? `/${tower.id}` : ""}`, { method: tower.id ? "PUT" : "POST",
        body: { enabled: draft.enabled, rewardShells: draft.rewardShells, cards: draft.cards, ...(draft.revision ? { revision: draft.revision } : {}) } });
      else await api(`${base}${draft.roomId ? `/${draft.roomId}` : ""}`, { method: draft.roomId ? "PUT" : "POST", body: { ...draft, startsAt: bossDateIso(draft.startsAt), endsAt: bossDateIso(draft.endsAt) } });
      onSaved();
    } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  }
  return <Modal full onClose={() => { if (!busy) onClose(); }}><form onSubmit={save}><button type="button" className="float-right grid min-h-11 min-w-11 place-items-center rounded-full bg-slate-100 text-ink" disabled={busy} onClick={onClose} aria-label="关闭 BOSS 编辑"><X size={18} /></button>
    <h2 className="pr-10 text-xl font-black text-ink">{tower ? `${tower.id ? "编辑" : "新增"}卡牌闯关第 ${tower.floorNumber} 层` : boss ? "编辑 BOSS 战" : "创建 BOSS 战"}</h2><p className="mt-2 text-sm leading-6 text-muted">{tower ? "层级自动生成且不可删除，上架后不可下架。编辑只影响之后开始的挑战。" : "上架后，玩家可从大厅创建关联此 BOSS 的房间。"}五张专属卡牌固定三星；上架时须完整配置。</p>
    <fieldset disabled={busy} className="mt-4 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {!tower && <><label className="sm:col-span-2"><span className="text-sm font-bold text-ink">BOSS 战名称</span><input required maxLength={50} className="field mt-1 w-full" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label><span className="text-sm font-bold text-ink">上架时间（北京时间）</span><input required type="datetime-local" className="field mt-1 w-full" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} /></label>
        <label><span className="text-sm font-bold text-ink">下架时间（北京时间）</span><input required type="datetime-local" className="field mt-1 w-full" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} /></label></>}
        {tower && <label><span className="text-sm font-bold text-ink">层级</span><input className="field mt-1 w-full" readOnly value={tower.floorNumber} /></label>}
        <label><span className="text-sm font-bold text-ink">上架状态</span><select disabled={Boolean(tower && boss?.enabled)} className="field mt-1 w-full" value={String(draft.enabled)} onChange={(e) => setDraft({ ...draft, enabled: e.target.value === "true" })}><option value="false">{tower ? "未上架草稿" : "下架"}</option><option value="true">上架</option></select></label>
        <label><span className="text-sm font-bold text-ink">通关贝壳奖励</span><input type="number" required min={0} max={1_000_000_000} step={1} className="field mt-1 w-full" value={draft.rewardShells} onChange={(e) => setDraft({ ...draft, rewardShells: Number(e.target.value) })} /><span className="mt-1 block text-xs text-muted">{tower ? "每个账号首次通关本层时领取一次。" : "每个账号首次通关此 BOSS 仅领取一次，跨房间共享。"}</span></label>
      </div>
      <div><h3 className="font-black text-ink">BOSS 阵容 · 已配置 {draft.cards.filter((item) => item?.name && item.imageUrl && item.tier.skillName && item.tier.skillDescription && item.tier.effects.length).length}/5</h3>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5" role="tablist" aria-label="BOSS 卡位">{bossSlotNames.map((name, i) => <button type="button" role="tab" aria-selected={slot === i} key={name} onClick={() => setSlot(i)} className={`min-h-14 rounded-xl border px-2 py-2 text-left text-xs ${slot === i ? "border-violet-600 bg-violet-100 text-violet-900" : "border-line bg-white text-muted"}`}><strong className="block">{name}</strong><span className="mt-1 block truncate">{draft.cards[i]?.name || "待配置"}</span></button>)}</div>
      </div>
      {!card ? <div className="rounded-xl border border-dashed border-line p-6 text-center"><p className="text-sm text-muted">{bossSlotNames[slot]}尚未配置</p><button type="button" className="btn btn-secondary mt-3" onClick={() => setCard({ name: "", imageUrl: "", traits: [], tier: structuredClone(DEFAULT_LEGEND_CARD_BATTLE_TIERS[3]!) })}><Plus size={16} />配置卡牌</button></div> : <div className="space-y-4">
        <div className="flex flex-wrap items-start gap-4"><div className="w-24 shrink-0">{card.imageUrl ? <img src={card.imageUrl} alt={card.name || "卡牌封面"} className="aspect-[5/7] w-full rounded-lg object-cover" /> : <div className="grid aspect-[5/7] place-items-center rounded-lg bg-slate-100 text-xs text-muted">待上传封面</div>}</div><div className="min-w-0 flex-1 space-y-3"><label className="block"><span className="text-sm font-bold text-ink">卡牌名称</span><input className="field mt-1 w-full" maxLength={100} value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} /></label><label className="block text-sm font-bold text-ink"><span className="flex items-center gap-1"><Upload size={16} />上传卡牌封面</span><input type="file" accept="image/png,image/jpeg,image/webp" className="mt-2 block w-full text-sm" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ""; }} /></label><p className="text-xs text-muted">PNG、JPG 或 WebP，最大 5MB</p></div></div>
        <CardBattleConfigEditor key={slot} fixedStar tiers={[card.tier]} activeStar={3} onActiveStar={() => {}} onChange={(tiers) => setCard({ ...card, tier: tiers[0]! })} />
        <fieldset className="rounded-xl border border-line p-3"><legend className="px-1 text-sm font-bold text-ink">卡牌特质</legend>{traitOptions.length ? <div className="flex flex-wrap gap-2">{traitOptions.map((trait) => { const selected = (card.traits ?? []).some((item) => item.id === trait.id); return <label key={trait.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${selected ? "border-blue-600 bg-blue-100 text-blue-800" : "border-line bg-white text-muted"}`}><input type="checkbox" className="sr-only" checked={selected} onChange={() => setCard({ ...card, traits: selected ? (card.traits ?? []).filter((item) => item.id !== trait.id) : [...(card.traits ?? []), trait] })} />{trait.name}</label>; })}</div> : <p className="text-sm text-muted">暂无可选特质，请先在“卡牌特质”中配置。</p>}</fieldset>
        <button type="button" className="btn btn-secondary text-red-700" onClick={() => setCard(null)}>清空此卡位</button>
      </div>}
    </fieldset>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="sticky -bottom-6 z-10 mt-6 flex justify-end gap-2 border-t border-line bg-white py-4"><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "处理中…" : draft.enabled ? "保存并上架" : "保存"}</button></div>
  </form></Modal>;
}

function BattleRecords({ boss, onClose }: { boss: CardBattleBoss; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ battles: BossBattleRecord[]; total: number }>({ battles: [], total: 0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [replay, setReplay] = useState<BossReplay | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError("");
    void api<typeof data>(`${base}/${boss.roomId}/battles?offset=${(page - 1) * 10}`, { bypassCache: true }).then((value) => { if (!cancelled) setData(value); }).catch((e) => { if (!cancelled) setError(errorText(e)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [boss.roomId, page, refresh]);
  return <Modal full onClose={onClose}><button className="float-right grid min-h-11 min-w-11 place-items-center rounded-full bg-slate-100 text-ink" onClick={onClose} aria-label="关闭对战记录"><X size={18} /></button><h2 className="pr-10 text-xl font-black text-ink">{boss.name} · 对战记录</h2><p className="mt-2 text-sm text-muted">每局独立记录，同一玩家重复挑战按多场统计。</p><button className="btn btn-secondary mt-3" onClick={() => setRefresh((v) => v + 1)} disabled={loading}><RefreshCw size={16} />刷新</button>
    {error && <p role="alert" className="my-3 text-sm text-red-700">{error}</p>}{loading ? <p role="status" className="py-8 text-center text-muted">加载中…</p> : <div className="mt-4 space-y-3">{data.battles.map((game) => <article key={game.id} className="rounded-xl border border-line p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-ink">第 {game.gameNumber} 局 · {{ playing: "进行中", won: "通关成功", lost: "挑战失败", aborted: "已中止" }[game.outcome]}</strong><span className="text-xs text-muted">{dateText(game.startedAt)}</span></div><ul className="my-3 space-y-1 text-sm text-muted">{game.players.map((player) => <li key={player.userId}>{player.nickname} · {player.forfeited ? "主动退出，放弃本局奖励" : player.reward != null ? `已奖励 ${player.reward} 贝壳` : game.outcome === "won" ? "该房间奖励已领取" : "无奖励"}</li>)}</ul><button className="btn btn-secondary" disabled={game.status !== "ended" || replayLoading} onClick={() => { setReplayLoading(true); setError(""); void api<{ replay: BossReplay }>(`${base}/${boss.roomId}/battles/${game.id}/replay`, { bypassCache: true }).then((value) => setReplay(value.replay)).catch((e) => setError(errorText(e))).finally(() => setReplayLoading(false)); }}>查看回放</button></article>)}{!data.battles.length && <p className="py-8 text-center text-muted">暂无对战记录</p>}</div>}
    <AdminPagination page={page} pageSize={10} total={data.total} onPageChange={setPage} />{replay && <CardBattleBossReplay replay={replay} onClose={() => setReplay(null)} />}
  </Modal>;
}

export function CardBattleBossManagement() {
  const [data, setData] = useState<{ bosses: CardBattleBoss[]; total: number }>({ bosses: [], total: 0 });
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<CardBattleBoss | "new" | null>(null);
  const [records, setRecords] = useState<CardBattleBoss | null>(null);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError("");
    void api<typeof data>(`${base}?offset=${(page - 1) * 10}`, { bypassCache: true }).then((value) => { if (!cancelled) setData(value); }).catch((e) => { if (!cancelled) setError(errorText(e)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, refresh]);
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-xl font-black text-ink"><Swords size={22} />BOSS 战</h1><p className="mt-1 text-sm text-muted">上架且在开放时间内的房间将显示在大厅。</p></div><div className="flex gap-2"><button className="btn btn-secondary" disabled={loading} onClick={() => setRefresh((v) => v + 1)} aria-label="刷新 BOSS 列表"><RefreshCw size={17} /></button><button className="btn btn-primary" onClick={() => setEditor("new")}><Plus size={17} />创建</button></div></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading ? <p role="status" className="py-12 text-center text-muted">加载中…</p> : <div className="space-y-3">{data.bosses.map((boss) => <article key={boss.roomId} className="card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-black text-ink">{boss.name}</h2><p className="mt-1 text-xs text-muted">{boss.battleCount ?? 0} 场对战</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${boss.available ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{boss.enabled ? boss.available ? "上架 · 开放中" : "上架 · 非开放时间" : "下架"}</span></div><p className="mt-3 text-sm text-muted">开放时间：{dateText(boss.startsAt)} 至 {dateText(boss.endsAt)}</p><p className="mt-1 text-sm font-bold text-amber-700">首次通关奖励 {boss.rewardShells} 贝壳</p><div className="mt-4 flex flex-wrap gap-2"><button className="btn btn-secondary" onClick={() => setEditor(boss)}><Pencil size={15} />编辑</button><button className="btn btn-secondary" disabled={busy} onClick={() => { setBusy(true); setError(""); void api(`${base}/${boss.roomId}/status`, { method: "PATCH", body: { enabled: !boss.enabled, revision: boss.revision } }).then(() => setRefresh((v) => v + 1)).catch((e) => setError(errorText(e))).finally(() => setBusy(false)); }}>{boss.enabled ? "下架" : "上架"}</button><button className="btn btn-secondary" onClick={() => setRecords(boss)}><History size={15} />对战记录</button></div></article>)}{!data.bosses.length && <p className="card py-12 text-center text-muted">暂无 BOSS 战，点击创建开始配置。</p>}</div>}
    <AdminPagination page={page} pageSize={10} total={data.total} onPageChange={setPage} />
    {editor && <BossEditor boss={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setRefresh((v) => v + 1); }} />}{records && <BattleRecords boss={records} onClose={() => setRecords(null)} />}
  </div>;
}
