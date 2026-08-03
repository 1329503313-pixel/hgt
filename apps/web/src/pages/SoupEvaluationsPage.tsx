import { useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import { useParams } from "react-router-dom";
import { api, type SoupResponse } from "../api";
import { EvaluationCard } from "../components/EvaluationCard";
import { PageTopBar } from "../components/PageTopBar";
import { UnifiedBackButton } from "../components/UnifiedBackButton";
import { useApp } from "../context/AppContext";
import type { SoupDetail } from "../shared/types";

export default function SoupEvaluationsPage() {
  const { id } = useParams<{ id: string }>();
  const { user, openAuth, openEvalEditor, refreshKey, showToast } = useApp();
  const [soup, setSoup] = useState<SoupDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api<SoupResponse>(`/api/soups/${id!}`)
      .then((data) => {
        if (active) setSoup(data.soup);
      })
      .catch((error) => {
        if (active) {
          setSoup(null);
          showToast(error instanceof Error ? error.message : "评价加载失败");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [id, refreshKey, showToast]);

  const ownEvaluation = useMemo(
    () => soup && user ? soup.evaluations.find((evaluation) => evaluation.reviewerId === user.id) ?? null : null,
    [soup, user]
  );

  function handleEvaluate() {
    if (!soup) return;
    if (!user) {
      openAuth();
      return;
    }
    if (!soup.canViewFull) {
      showToast("获得汤底查看权限后才能评价");
      return;
    }
    openEvalEditor(soup.id, ownEvaluation);
  }

  const backTo = `/soup/${id}`;

  return (
    <section className="min-h-screen bg-page pt-[72px] lg:pt-0">
      <PageTopBar title="评价列表" backTo={backTo} />
      <div className="mx-auto max-w-5xl space-y-4 px-4 pb-24 lg:px-0 lg:pt-6">
        <div className="hidden lg:flex">
          <UnifiedBackButton to={backTo} />
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-44 animate-pulse rounded-2xl bg-slate-200/70" />)}
          </div>
        ) : !soup ? (
          <div className="card p-8 text-center text-sm text-muted">海龟汤不存在或暂无查看权限</div>
        ) : (
          <>
            <header className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-black tracking-[0.14em] text-primary">REVIEWS</p>
                <h1 className="mt-1 truncate text-2xl font-black text-ink">《{soup.title}》的玩家评价</h1>
                <p className="mt-2 text-sm text-muted">{soup.evaluations.length} 条评价 · 综合评分 {soup.averageTotal ?? "—"}</p>
              </div>
              <button
                className="btn btn-primary shrink-0"
                disabled={!soup.canViewFull}
                title={!soup.canViewFull ? "获得汤底查看权限后才能评价" : undefined}
                onClick={handleEvaluate}
              >
                <Star size={18} />{ownEvaluation ? "编辑我的评价" : "添加评价"}
              </button>
            </header>

            {soup.evaluations.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {soup.evaluations.map((evaluation) => <EvaluationCard key={evaluation.id} evaluation={evaluation} />)}
              </div>
            ) : (
              <div className="card p-10 text-center">
                <p className="text-sm text-muted">还没有评价，来写下第一条吧。</p>
                <button className="btn btn-primary mt-4" disabled={!soup.canViewFull} onClick={handleEvaluate}>
                  <Star size={18} />添加评价
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
