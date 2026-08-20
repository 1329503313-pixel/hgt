import { useState } from "react";
import { Crown, History, Sparkles } from "lucide-react";
import type { VipOverview } from "../shared/types";
import { Modal } from "./Modal";
import { VipIcon } from "./VipVisuals";

const BENEFITS: Array<{ label: string; key?: string; value?: string }> = [
  { label: "每日发布海龟汤数量", value: "无限" },
  { label: "每日自动赠送经验", key: "dailyAutoExperienceGrant" },
  { label: "每日自动赠送贝壳", key: "dailyAutoShellGrant" },
  { label: "每日谜局提问", value: "无限" },
  { label: "每日AI玩汤提问", value: "无限" },
  { label: "每日AI玩汤提示", value: "无限" },
  { label: "每日通过礼物获取贝壳", value: "无限" },
  { label: "每日获取魅力", value: "无限" },
  { label: "每日额外免费抽卡次数", key: "dailyExtraFreeDraws" },
  { label: "昵称颜色变更", value: "1-4级金色 · 5-6级炫彩 · 7-9级动态炫彩" },
  { label: "高级VIP登录全平台播报", value: "VIP7及以上" }
];

function benefitValue(overview: VipOverview, item: (typeof BENEFITS)[number]) {
  if (item.value) return item.value;
  const value = item.key ? overview.benefits[item.key] : null;
  return value == null ? "无限" : Number(value).toLocaleString();
}

function currentLevelLabel(overview: VipOverview) {
  if (overview.active) return `VIP${overview.level}`;
  if (overview.level >= 1 && overview.vipExpired) return `VIP${overview.level}（已失效）`;
  return overview.vipExpired ? "未开通（已失效）" : "未开通";
}

function formatEventDate(event: VipOverview["events"][number]) {
  const dateParts = event.date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateParts) return `${dateParts[1]}/${Number(dateParts[2])}/${Number(dateParts[3])}`;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).format(new Date(event.createdAt));
}

function formatVipExpiryDate(expiresAt: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(expiresAt));
}

export function VipCard({ overview, onOpen, onOpenDetails }: { overview: VipOverview | null; onOpen: () => void; onOpenDetails?: () => void }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [benefitsOpen, setBenefitsOpen] = useState(false);
  if (!overview) return <div className="mine-vip-card min-h-48 animate-pulse" aria-label="VIP加载中" />;
  const progress = Math.max(0, Math.min(100, overview.progressPercent));
  const required = overview.nextThreshold == null ? "已达最高等级" : `升级还需 ${(overview.nextThreshold - overview.growthValue).toLocaleString()} 成长值`;

  return (
    <aside className="mine-vip-card flex min-w-0 flex-col rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-fuchsia-50 p-4 shadow-soft sm:p-5">
      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-amber-300 to-fuchsia-500 text-white"><Crown size={19} /></span><h2 className="text-xl font-black text-ink">VIP</h2></div><button type="button" className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-amber-200 bg-white px-3 text-xs font-black text-amber-700 transition hover:bg-amber-50" onClick={() => { setDetailOpen(true); onOpenDetails?.(); }}><History size={15} />明细</button></div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted">VIP等级</p>
          <p className={`mt-1 flex min-h-9 items-center gap-2 text-3xl font-black ${overview.active ? "text-amber-700" : "text-muted"}`}>
            {overview.active && <VipIcon level={overview.level} active className="h-7 w-7 shrink-0" />}
            <span>{currentLevelLabel(overview)}</span>
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs font-bold text-muted"><span>成长值 {overview.growthValue.toLocaleString()}</span><span>{required}</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-amber-100"><span className="block h-full rounded-full bg-gradient-to-r from-amber-400 via-fuchsia-500 to-cyan-400 transition-[width] duration-300" style={{ width: `${progress}%` }} /></div>
      <div className="mt-1 min-h-4 text-right text-[11px] font-bold text-muted">
        {overview.active && (overview.vipExpiresAt ? `VIP到期时间 ${formatVipExpiryDate(overview.vipExpiresAt)}` : "VIP长期有效")}
      </div>
      <div className="mt-auto grid grid-cols-2 gap-3 pt-5"><button type="button" className="btn btn-primary mine-card-action" onClick={onOpen}><Sparkles size={16} />开通VIP</button><button type="button" className="btn btn-secondary mine-card-action" onClick={() => setBenefitsOpen(true)}>VIP权益</button></div>
      {detailOpen && <Modal hideCloseButton onClose={() => setDetailOpen(false)}><div className="space-y-3"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-black text-ink">VIP等级明细</h2><p className="mt-1 text-sm text-muted">当前成长值 {overview.growthValue.toLocaleString()} · {currentLevelLabel(overview)}</p></div><button type="button" className="btn btn-secondary min-h-10 px-3" onClick={() => setDetailOpen(false)}>关闭</button></div><div className="max-h-[55vh] divide-y divide-line overflow-y-auto">{overview.events.length === 0 ? <p className="py-8 text-center text-sm text-muted">暂无成长值明细</p> : overview.events.map((event) => <div key={event.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-ink">{event.remark}</p><p className="mt-1 text-xs text-muted">{formatEventDate(event)}</p></div><strong className={`shrink-0 text-sm font-black ${event.amount >= 0 ? "text-emerald-600" : "text-red-600"}`}>{event.amount >= 0 ? "+" : ""}{event.amount}</strong></div>)}</div></div></Modal>}
      {benefitsOpen && <Modal hideCloseButton onClose={() => setBenefitsOpen(false)}><div className="space-y-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-black text-ink">VIP权益</h2><p className="mt-1 text-sm text-muted">按当前 VIP 等级计算</p></div><button type="button" className="btn btn-secondary min-h-10 px-3" onClick={() => setBenefitsOpen(false)}>关闭</button></div><div className="divide-y divide-line rounded-xl border border-line bg-slate-50">{BENEFITS.map((item) => <div key={item.label} className="flex items-start justify-between gap-4 px-3 py-3 text-sm"><span className="text-muted">{item.label}</span><strong className="max-w-[58%] text-right text-ink">{benefitValue(overview, item)}</strong></div>)}</div></div></Modal>}
    </aside>
  );
}
