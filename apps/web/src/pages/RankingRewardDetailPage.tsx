import { Award, CalendarDays, Gift, Shell, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { PageTopBar } from "../components/PageTopBar";
import { DetailSkeleton } from "../components/Skeletons";
import { useApp } from "../context/AppContext";
import type { RankingRewardSettlementDetail } from "../shared/types";

function rewardText(grant: RankingRewardSettlementDetail["grants"][number]) {
  if (grant.reward.type === "currency") {
    return `经验 +${grant.reward.experience}、贝壳 +${grant.reward.shell}`;
  }
  const credited = grant.reward.creditedQuantity > 0
    ? `${grant.reward.giftName} ×${grant.reward.creditedQuantity}`
    : "";
  const overflow = grant.reward.overflowQuantity > 0
    ? `${grant.reward.overflowQuantity} 个溢出折算为 ${grant.reward.overflowShell} 贝壳`
    : "";
  return [credited, overflow].filter(Boolean).join("；") || `${grant.reward.giftName} ×${grant.reward.quantity}`;
}

export default function RankingRewardDetailPage() {
  const { settlementId = "" } = useParams();
  const { user, loadingUser, showToast } = useApp();
  const [settlement, setSettlement] = useState<RankingRewardSettlementDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (loadingUser || !user || !settlementId) return;
    setLoading(true);
    api<{ settlement: RankingRewardSettlementDetail }>(`/api/ranking-rewards/${settlementId}`)
      .then((data) => setSettlement(data.settlement))
      .catch((error) => {
        setSettlement(null);
        showToast((error as Error).message);
      })
      .finally(() => setLoading(false));
  }, [loadingUser, settlementId, showToast, user]);

  const totals = useMemo(() => settlement?.grants.reduce((current, grant) => {
    if (grant.reward.type === "currency") {
      current.experience += grant.reward.experience;
      current.shell += grant.reward.shell;
    } else {
      current.gifts += grant.reward.creditedQuantity;
      current.shell += grant.reward.overflowShell;
    }
    return current;
  }, { experience: 0, shell: 0, gifts: 0 }), [settlement]);

  return (
    <section className="min-h-screen bg-page">
      <PageTopBar title="排行榜奖励详情" backTo="/messages/system" />
      <div className="mx-auto max-w-4xl px-4 pb-10">
        {loading ? <DetailSkeleton /> : settlement ? (
          <div className="space-y-4">
            <header className="overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 p-5 text-white shadow-soft sm:p-7">
              <div className="flex items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20"><Award size={27} /></span>
                <div className="min-w-0">
                  <p className="text-xs font-black tracking-[0.14em] text-amber-100">RANKING REWARDS</p>
                  <h1 className="mt-1 text-2xl font-black">{settlement.periodLabel}结算奖励</h1>
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-amber-50">
                    <CalendarDays size={15} />
                    {new Date(settlement.periodStart).toLocaleDateString("zh-CN")}—{new Date(settlement.periodEnd).toLocaleDateString("zh-CN")}
                  </p>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl bg-white/15 p-3 text-center backdrop-blur-sm">
                <div><strong className="block text-xl">{totals?.experience ?? 0}</strong><span className="text-xs text-amber-50">经验</span></div>
                <div><strong className="block text-xl">{totals?.shell ?? 0}</strong><span className="text-xs text-amber-50">贝壳</span></div>
                <div><strong className="block text-xl">{totals?.gifts ?? 0}</strong><span className="text-xs text-amber-50">入库礼物</span></div>
              </div>
            </header>

            <div className="space-y-3">
              {settlement.grants.map((grant) => (
                <article key={grant.board} className="rounded-2xl bg-white p-4 shadow-soft sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><Sparkles size={20} /></span>
                      <div className="min-w-0">
                        <h2 className="font-black text-ink">{grant.boardLabel}</h2>
                        <p className="mt-0.5 text-xs text-muted">本次结算值：{grant.metricValue.toLocaleString()}</p>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-sm font-black text-white">第 {grant.rank} 名</span>
                  </div>
                  <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-3 text-sm font-bold text-ink">
                    {grant.reward.type === "gift" ? <Gift className="shrink-0 text-fuchsia-600" size={18} /> : <><Shell className="shrink-0 text-blue-600" size={18} /></>}
                    <span>{rewardText(grant)}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : <p className="py-16 text-center text-sm text-muted">奖励结算不存在或无权查看</p>}
      </div>
    </section>
  );
}
