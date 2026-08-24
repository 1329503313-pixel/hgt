import { useEffect, useState } from "react";
import { CalendarClock, ChevronDown, ChevronUp, History, Shell, Trash2 } from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { Modal } from "../Modal";

type CircleRef = { id: string; name: string };
type PendingPacket = { id: string; packetCount: number; totalShells: number; publishAt: string };
type RedPacketHistory = {
  id: string;
  source: "one_time" | "periodic";
  packetCount: number;
  totalShells: number;
  claimedCount: number;
  claimedShells: number;
  publishedAt: string;
  expiresAt: string | null;
  claims: Array<{ userId: string; nickname: string; amount: number; claimedAt: string }>;
};

function valid(count: string, total: string) {
  const c = Number(count), t = Number(total);
  return Number.isInteger(c) && c > 0 && c <= 1_000 && Number.isInteger(t) && t >= c && t <= 2_000_000_000;
}

function beijingIso(localDateTime: string) {
  return new Date(`${localDateTime}:00+08:00`).toISOString();
}

function beijingDateTimeInput(value: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function OneTimeRedPacketDialog({ circle, onClose }: { circle: CircleRef; onClose: () => void }) {
  const { showToast } = useApp();
  const [packetCount, setPacketCount] = useState("10");
  const [totalShells, setTotalShells] = useState("100");
  const [mode, setMode] = useState<"now" | "scheduled">("now");
  const [publishAt, setPublishAt] = useState("");
  const [pending, setPending] = useState<PendingPacket[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadPending = () => api<{ packets: PendingPacket[] }>(`/api/admin/circles/${circle.id}/red-packets/pending`, { bypassCache: true, dedupe: false }).then((data) => setPending(data.packets));
  useEffect(() => { void loadPending().catch((error) => showToast((error as Error).message)); }, [circle.id]);

  async function submit() {
    if (!valid(packetCount, totalShells)) return showToast("红包个数须为 1–1000，且不能超过贝壳总数");
    if (mode === "scheduled" && !publishAt) return showToast("请选择定时发布时间");
    if (mode === "now" && !window.confirm("确定立刻发布该系统红包？发布后不可撤回。")) return;
    setSaving(true);
    try {
      const body = { packetCount: Number(packetCount), totalShells: Number(totalShells), ...(mode === "scheduled" ? { publishAt: beijingIso(publishAt) } : {}) };
      if (editingId) await api(`/api/admin/circles/${circle.id}/red-packets/${editingId}`, { method: "PUT", body });
      else await api(`/api/admin/circles/${circle.id}/red-packets`, { method: "POST", body });
      showToast(editingId ? "定时红包已更新" : mode === "now" ? "红包已发布" : "定时红包已创建");
      if (mode === "now") onClose(); else { setEditingId(null); await loadPending(); }
    } catch (error) { showToast((error as Error).message); }
    finally { setSaving(false); }
  }

  async function cancel(packet: PendingPacket) {
    if (!window.confirm("确定取消这个尚未发布的红包？")) return;
    try {
      await api(`/api/admin/circles/${circle.id}/red-packets/${packet.id}`, { method: "DELETE" });
      if (editingId === packet.id) setEditingId(null);
      await loadPending();
      showToast("定时红包已取消");
    } catch (error) { showToast((error as Error).message); }
  }

  return <Modal onClose={() => !saving && onClose()}>
    <div className="space-y-5">
      <div><h2 className="text-xl font-black text-ink">发红包 · {circle.name}</h2><p className="mt-1 text-sm text-muted">系统发放，拼手气随机分配；每份至少 1 贝壳，发布后不可撤回。</p></div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1"><span className="label">红包个数</span><input className="field" type="number" min={1} max={1000} value={packetCount} onChange={(e) => setPacketCount(e.target.value)} /></label>
        <label className="space-y-1"><span className="label">贝壳总数</span><input className="field" type="number" min={1} value={totalShells} onChange={(e) => setTotalShells(e.target.value)} /></label>
      </div>
      <fieldset className="space-y-2"><legend className="label">发布时间</legend><div className="grid grid-cols-2 gap-2">
        <button type="button" className={`min-h-11 rounded-xl border font-bold ${mode === "now" ? "border-primary bg-blue-50 text-primary" : "border-line text-muted"}`} onClick={() => { setMode("now"); setEditingId(null); }}>立刻发布</button>
        <button type="button" className={`min-h-11 rounded-xl border font-bold ${mode === "scheduled" ? "border-primary bg-blue-50 text-primary" : "border-line text-muted"}`} onClick={() => setMode("scheduled")}>定时发布</button>
      </div></fieldset>
      {mode === "scheduled" && <label className="space-y-1"><span className="label">北京时间</span><input className="field" type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} /></label>}
      {pending.length > 0 && <div className="space-y-2"><p className="label">待发布红包</p>{pending.map((packet) => <div key={packet.id} className="flex items-center gap-2 rounded-xl border border-line p-3 text-sm"><CalendarClock className="shrink-0 text-primary" size={18} /><button className="min-h-11 min-w-0 flex-1 text-left" onClick={() => { setEditingId(packet.id); setMode("scheduled"); setPacketCount(String(packet.packetCount)); setTotalShells(String(packet.totalShells)); setPublishAt(beijingDateTimeInput(packet.publishAt)); }}><strong>{packet.packetCount} 个 / {packet.totalShells} 贝壳</strong><span className="block text-xs text-muted">{new Date(packet.publishAt).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}</span></button><button className="grid h-11 w-11 place-items-center rounded-xl text-red-500 hover:bg-red-50" aria-label="取消定时红包" onClick={() => void cancel(packet)}><Trash2 size={17} /></button></div>)}</div>}
      <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary min-h-11" disabled={saving} onClick={onClose}>取消</button><button className="btn btn-primary min-h-11" disabled={saving || !valid(packetCount, totalShells)} onClick={() => void submit()}>{saving ? "处理中…" : editingId ? "保存修改" : mode === "now" ? "确认发布" : "创建定时红包"}</button></div>
    </div>
  </Modal>;
}

export function PeriodicRedPacketDialog({ circle, onClose }: { circle: CircleRef; onClose: () => void }) {
  const { showToast } = useApp();
  const [packetCount, setPacketCount] = useState("10");
  const [totalShells, setTotalShells] = useState("100");
  const [publishTime, setPublishTime] = useState("12:00");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { void api<{ schedule: null | { packetCount: number; totalShells: number; publishTime: string; enabled: boolean } }>(`/api/admin/circles/${circle.id}/red-packet-schedule`, { bypassCache: true, dedupe: false }).then(({ schedule }) => { if (!schedule) return; setPacketCount(String(schedule.packetCount)); setTotalShells(String(schedule.totalShells)); setPublishTime(schedule.publishTime); setEnabled(schedule.enabled); }).catch((error) => showToast((error as Error).message)); }, [circle.id]);
  async function save() {
    if (!valid(packetCount, totalShells)) return showToast("红包个数须为 1–1000，且不能超过贝壳总数");
    setSaving(true);
    try { await api(`/api/admin/circles/${circle.id}/red-packet-schedule`, { method: "PUT", body: { packetCount: Number(packetCount), totalShells: Number(totalShells), publishTime, enabled } }); showToast("周期红包设置已保存"); onClose(); }
    catch (error) { showToast((error as Error).message); }
    finally { setSaving(false); }
  }
  return <Modal onClose={() => !saving && onClose()}><div className="space-y-5">
    <div><h2 className="text-xl font-black text-ink">周期红包 · {circle.name}</h2><p className="mt-1 text-sm text-muted">每天按北京时间自动发布。若保存时已超过当天设定时间，则从次日开始，不补发当天红包；已发布红包不可撤回。新建配置默认禁用。</p></div>
    <div className="grid grid-cols-2 gap-3"><label className="space-y-1"><span className="label">每天发多少个</span><input className="field" type="number" min={1} max={1000} value={packetCount} onChange={(e) => setPacketCount(e.target.value)} /></label><label className="space-y-1"><span className="label">每天共多少贝壳</span><input className="field" type="number" min={1} value={totalShells} onChange={(e) => setTotalShells(e.target.value)} /></label></div>
    <label className="space-y-1"><span className="label">每天发布时间（北京时间）</span><input className="field" type="time" value={publishTime} onChange={(e) => setPublishTime(e.target.value)} /></label>
    <label className="flex min-h-14 cursor-pointer items-center justify-between rounded-xl border border-line px-4"><span><strong className="block text-sm text-ink">启用周期红包</strong><span className="text-xs text-muted">关闭后保留配置，但不会自动发布</span></span><input className="h-5 w-5 accent-blue-600" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /></label>
    <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary min-h-11" disabled={saving} onClick={onClose}>取消</button><button className="btn btn-primary min-h-11" disabled={saving || !valid(packetCount, totalShells) || !publishTime} onClick={() => void save()}>{saving ? "保存中…" : "保存设置"}</button></div>
  </div></Modal>;
}

export function RedPacketHistoryDialog({ circle, onClose }: { circle: CircleRef; onClose: () => void }) {
  const { showToast } = useApp();
  const [packets, setPackets] = useState<RedPacketHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    void api<{ packets: RedPacketHistory[] }>(`/api/admin/circles/${circle.id}/red-packets/history`, { bypassCache: true, dedupe: false })
      .then((data) => setPackets(data.packets))
      .catch((error) => showToast((error as Error).message))
      .finally(() => setLoading(false));
  }, [circle.id]);
  return <Modal onClose={onClose}><div className="space-y-4">
    <div><h2 className="flex items-center gap-2 text-xl font-black text-ink"><History size={20} className="text-primary" />红包发放记录 · {circle.name}</h2><p className="mt-1 text-sm text-muted">展示最近 100 条已发放红包及领取明细。</p></div>
    <div className="max-h-[65vh] space-y-2 overflow-y-auto overscroll-contain pr-1">
      {loading && <p className="py-12 text-center text-sm text-muted">加载中…</p>}
      {!loading && packets.length === 0 && <p className="rounded-xl border border-dashed border-line py-12 text-center text-sm text-muted">暂无红包发放记录</p>}
      {packets.map((packet) => { const expanded = expandedId === packet.id; return <article key={packet.id} className="overflow-hidden rounded-xl border border-line bg-white">
        <button type="button" className="flex min-h-14 w-full items-center gap-3 p-3 text-left transition hover:bg-slate-50" onClick={() => setExpandedId(expanded ? null : packet.id)} aria-expanded={expanded}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-600"><Shell size={20} /></span>
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="text-sm text-ink">{packet.source === "periodic" ? "周期发放" : "单次发放"}</strong><span className="text-xs text-muted">{new Date(packet.publishedAt).toLocaleString("zh-CN", { hour12: false })}</span></span><span className="mt-1 block text-xs text-muted">{packet.packetCount} 个 · {packet.totalShells} 贝壳 · 已领 {packet.claimedCount}/{packet.packetCount}（{packet.claimedShells} 贝壳）</span></span>
          {expanded ? <ChevronUp size={18} className="text-muted" /> : <ChevronDown size={18} className="text-muted" />}
        </button>
        {expanded && <div className="border-t border-line bg-slate-50 px-3 py-2">
          {packet.claims.length === 0 ? <p className="py-4 text-center text-xs text-muted">暂时无人领取</p> : <div className="divide-y divide-line">{packet.claims.map((claim) => <div key={claim.userId} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0 truncate font-bold text-ink">{claim.nickname}</span><span className="shrink-0 text-right"><strong className="text-amber-700">+{claim.amount} 贝壳</strong><time className="ml-2 text-xs text-muted">{new Date(claim.claimedAt).toLocaleString("zh-CN", { hour12: false })}</time></span></div>)}</div>}
        </div>}
      </article>; })}
    </div>
    <button type="button" className="btn btn-secondary w-full min-h-11" onClick={onClose}>关闭</button>
  </div></Modal>;
}
