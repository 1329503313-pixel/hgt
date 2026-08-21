import { useEffect, useState } from "react";
import { CalendarClock, Trash2 } from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { Modal } from "../Modal";

type CircleRef = { id: string; name: string };
type PendingPacket = { id: string; packetCount: number; totalShells: number; publishAt: string };

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
