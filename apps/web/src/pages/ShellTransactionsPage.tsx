import { Minus, Plus, Shell } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api";
import { MineBackButton } from "../components/MineBackButton";
import { PageTopBar } from "../components/PageTopBar";
import { ListSkeleton } from "../components/Skeletons";
import { useApp } from "../context/AppContext";
import type { ShellTaskCenter, ShellTransactionsResponse } from "../shared/types";

const pageSize = 20;

export default function ShellTransactionsPage() {
  const location = useLocation();
  const shellReturnTo =
    (location.state as { shellReturnTo?: unknown } | null)?.shellReturnTo === "/mine/tasks"
      ? "/mine/tasks"
      : undefined;
  const { user, loadingUser, openAuth, showToast } = useApp();
  const [balance, setBalance] = useState(0);
  const [data, setData] = useState<ShellTransactionsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const offset = (page - 1) * pageSize;
    Promise.all([
      api<ShellTaskCenter>("/api/me/shells", { bypassCache: true }),
      api<ShellTransactionsResponse>(`/api/me/shell-transactions?limit=${pageSize}&offset=${offset}`, { bypassCache: true })
    ])
      .then(([summary, transactions]) => { setBalance(summary.balance); setData(transactions); })
      .catch((error) => showToast(error instanceof Error ? error.message : "贝壳明细加载失败"))
      .finally(() => setLoading(false));
  }, [page, user?.id, showToast]);

  if (loadingUser) return <section className="space-y-3"><PageTopBar title="贝壳明细" /><MineBackButton to={shellReturnTo} /><ListSkeleton rows={8} /></section>;
  if (!user) return (
    <section className="space-y-3"><PageTopBar title="贝壳明细" /><MineBackButton to={shellReturnTo} /><div className="card p-6 text-center"><p className="text-sm text-muted">登录后查看贝壳明细。</p><button className="btn btn-primary mt-4" onClick={openAuth}>登录</button></div></section>
  );

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  return (
    <section className="space-y-3">
      <PageTopBar title="贝壳明细" />
      <MineBackButton to={shellReturnTo} />
      <div className="card flex items-center justify-between p-4">
        <div><p className="text-xs font-bold text-muted">当前余额</p><p className="mt-1 flex items-center gap-2 text-2xl font-black text-primary"><Shell size={23} />{balance.toLocaleString()}</p></div>
        <p className="text-xs text-muted">共 {data?.total ?? 0} 条记录</p>
      </div>

      <div className="card overflow-hidden">
        {loading ? <ListSkeleton rows={8} /> : data?.transactions.length ? (
          <div className="divide-y divide-line">
            {data.transactions.map((item) => {
              const added = item.amount > 0;
              return (
                <article key={item.id} className="flex items-center gap-3 p-4">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${added ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
                    {added ? <Plus size={19} /> : <Minus size={19} />}
                  </span>
                  <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-black text-ink">{item.remark || item.typeLabel}</h3><p className="mt-1 text-xs text-muted">{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</p></div>
                  <div className="shrink-0 text-right"><p className={`font-black ${added ? "text-emerald-600" : "text-red-500"}`}>{added ? "+" : ""}{item.amount}</p><p className="mt-1 text-[11px] text-muted">余额 {item.balanceAfter}</p></div>
                </article>
              );
            })}
          </div>
        ) : <div className="py-16 text-center text-sm text-muted">暂无贝壳变动记录</div>}
      </div>

      {totalPages > 1 && <div className="flex items-center justify-center gap-3 pb-2">
        <button className="btn btn-secondary" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button>
        <span className="text-sm font-bold text-muted">{page}/{totalPages}</span>
        <button className="btn btn-secondary" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button>
      </div>}
    </section>
  );
}
