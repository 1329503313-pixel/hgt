import { useEffect, useMemo, useState } from "react";
import { Award, Check, Flame, ShieldCheck, Sparkles, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, type ExcellentAuthorEligibilityResponse } from "../api";
import { Modal } from "../components/Modal";
import { PageTopBar } from "../components/PageTopBar";
import { MineBackButton } from "../components/MineBackButton";
import { useApp } from "../context/AppContext";
import type { SoupSummary } from "../shared/types";

type SelectorMode = "qualification" | "primary" | null;

function applicationStatusLabel(status: "pending" | "approved" | "rejected") {
  if (status === "approved") return "认证已通过";
  if (status === "rejected") return "上次申请未通过，可重新申请";
  return "申请审核中";
}

export default function ExcellentAuthorPage() {
  const { user, loadingUser, showToast } = useApp();
  const navigate = useNavigate();
  const [data, setData] = useState<ExcellentAuthorEligibilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectorMode, setSelectorMode] = useState<SelectorMode>(null);
  const [qualificationIds, setQualificationIds] = useState<string[]>([]);
  const [primarySoupId, setPrimarySoupId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setData(await api<ExcellentAuthorEligibilityResponse>("/api/me/excellent-author-application"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "认证信息加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (loadingUser) return;
    if (!user) {
      navigate("/mine");
      return;
    }
    load().catch(() => {});
  }, [user, loadingUser]);

  const soupsById = useMemo(() => new Map((data?.eligibleSoups ?? []).map((soup) => [soup.id, soup])), [data]);
  const selectedQualificationSoups = qualificationIds.map((id) => soupsById.get(id)).filter((soup): soup is SoupSummary => Boolean(soup));
  const primaryCandidates = selectedQualificationSoups.filter((soup) => (soup.averageTotal ?? 0) >= 3.5);
  const pending = data?.application?.status === "pending";
  const approved = data?.certified || data?.application?.status === "approved";
  const canSubmit = qualificationIds.length === 5 && Boolean(primarySoupId) && !pending && !approved && !submitting;

  function toggleQualification(id: string) {
    setQualificationIds((current) => {
      if (current.includes(id)) {
        if (primarySoupId === id) setPrimarySoupId(null);
        return current.filter((item) => item !== id);
      }
      if (current.length >= 5) return current;
      return [...current, id];
    });
  }

  async function submitApplication() {
    if (!canSubmit || !primarySoupId) return;
    setSubmitting(true);
    try {
      await api("/api/me/excellent-author-application", {
        method: "POST",
        body: { qualificationSoupIds: qualificationIds, primarySoupId }
      });
      showToast("优秀作者认证申请已提交");
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "申请提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-4">
      <PageTopBar title="优秀作者认证" />

      <MineBackButton />

      <div className="card overflow-hidden">
        <div className="bg-gradient-to-br from-amber-50 via-white to-blue-50 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-600"><Award size={26} /></span>
            <div>
              <h1 className="text-xl font-black text-ink">优秀作者认证说明</h1>
              <p className="mt-2 text-sm leading-6 text-muted">
                申请优秀作者认证，认证通过后可获取优秀作者徽章，且后续有权限优先参与平台官方活动、赢取平台分红等。
              </p>
            </div>
          </div>
        </div>
      </div>

      {data?.application && (
        <div className={`rounded-xl border px-4 py-3 text-sm font-bold ${approved ? "border-emerald-200 bg-emerald-50 text-emerald-700" : pending ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-muted"}`}>
          {applicationStatusLabel(data.application.status)}
          <span className="ml-2 text-xs font-medium">提交于 {new Date(data.application.createdAt).toLocaleString()}</span>
        </div>
      )}

      <div className="card space-y-5 p-4">
        <div>
          <h2 className="font-black text-ink">认证规则</h2>
          <p className="mt-1 text-xs text-muted">提交和审批时都会重新校验作品资格。</p>
        </div>

        <RuleBlock number="1" title="选择5篇资格汤" description="原创、热力值不低于3000，综合评分不低于3.2。必须选择5篇，不能多也不能少。">
          <button type="button" className="btn btn-secondary w-full" disabled={pending || approved} onClick={() => setSelectorMode("qualification")}>
            选择海龟汤 <span className="ml-auto text-xs">{qualificationIds.length}/5</span>
          </button>
          {selectedQualificationSoups.length > 0 && <SelectedSoupList soups={selectedQualificationSoups} primarySoupId={primarySoupId} />}
        </RuleBlock>

        <RuleBlock number="2" title="选择1篇认证汤" description="从上述5篇中选择1篇热力值不低于3000、综合评分不低于3.5的作品，由平台进行审核。">
          <button type="button" className="btn btn-secondary w-full" disabled={qualificationIds.length !== 5 || pending || approved} onClick={() => setSelectorMode("primary")}>
            选择海龟汤 <span className="ml-auto text-xs">{primarySoupId ? "1/1" : "0/1"}</span>
          </button>
          {qualificationIds.length === 5 && primaryCandidates.length === 0 && <p className="text-xs font-semibold text-danger">所选资格汤中暂无评分达到3.5的作品，请重新选择资格汤。</p>}
        </RuleBlock>

        <RuleBlock number="3" title="接受平台AI评测" description="所有提交作品均须为非AI汤，平台会对申请作品进行AI评测。" />

        {!loading && (data?.eligibleSoups.length ?? 0) < 5 && (
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            当前只有 {data?.eligibleSoups.length ?? 0} 篇作品满足资格汤条件，达到5篇后即可申请。
          </div>
        )}

        <button className="btn btn-primary w-full" type="button" disabled={!canSubmit} onClick={submitApplication}>
          <ShieldCheck size={18} /> {submitting ? "正在提交…" : approved ? "已获得优秀作者认证" : pending ? "申请审核中" : "提交认证申请"}
        </button>
      </div>

      {selectorMode && (
        <Modal full onClose={() => setSelectorMode(null)}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-ink">{selectorMode === "qualification" ? "选择5篇资格汤" : "选择1篇认证汤"}</h2>
              <p className="mt-1 text-sm text-muted">{selectorMode === "qualification" ? "仅展示满足3000热力值、评分3.2及以上的原创海龟汤。" : "仅展示已选资格汤中评分3.5及以上的作品。"}</p>
            </div>
            <button className="btn btn-secondary px-3" type="button" onClick={() => setSelectorMode(null)}><X size={18} /></button>
          </div>
          <div className="mt-4 space-y-3 pb-20">
            {(selectorMode === "qualification" ? data?.eligibleSoups ?? [] : primaryCandidates).map((soup) => {
              const selected = selectorMode === "qualification" ? qualificationIds.includes(soup.id) : primarySoupId === soup.id;
              return (
                <button key={soup.id} type="button" className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${selected ? "border-primary bg-blue-50 ring-2 ring-blue-100" : "border-line bg-white hover:border-blue-200"}`}
                  onClick={() => selectorMode === "qualification" ? toggleQualification(soup.id) : setPrimarySoupId(soup.id)}>
                  <img className="h-16 w-16 shrink-0 rounded-lg object-cover" src={soup.coverImage ?? "/default-cover.png"} alt="" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-black text-ink">{soup.title}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs font-bold">
                      <span className="inline-flex items-center gap-1 text-red-500"><Flame size={14} className="fill-red-500" />{soup.heatValue.toLocaleString()}</span>
                      <span className="inline-flex items-center gap-1 text-amber-600"><Sparkles size={14} />{soup.averageTotal?.toFixed(1)}分</span>
                    </div>
                  </div>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${selected ? "border-primary bg-primary text-white" : "border-slate-300 text-transparent"}`}><Check size={15} /></span>
                </button>
              );
            })}
            {(selectorMode === "qualification" ? data?.eligibleSoups.length === 0 : primaryCandidates.length === 0) && <p className="py-10 text-center text-sm text-muted">暂无符合条件的海龟汤</p>}
          </div>
          <div className="fixed inset-x-0 bottom-0 border-t border-line bg-white/95 p-4 backdrop-blur sm:absolute">
            <button className="btn btn-primary mx-auto w-full max-w-3xl" type="button"
              disabled={selectorMode === "qualification" ? qualificationIds.length !== 5 : !primarySoupId}
              onClick={() => setSelectorMode(null)}>
              确认选择（{selectorMode === "qualification" ? `${qualificationIds.length}/5` : primarySoupId ? "1/1" : "0/1"}）
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function RuleBlock({ number, title, description, children }: { number: string; title: string; description: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-black text-white">{number}</span>
        <div className="min-w-0 flex-1">
          <h3 className="font-black text-ink">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
          {children && <div className="mt-3 space-y-3">{children}</div>}
        </div>
      </div>
    </div>
  );
}

function SelectedSoupList({ soups, primarySoupId }: { soups: SoupSummary[]; primarySoupId: string | null }) {
  return (
    <div className="space-y-2">
      {soups.map((soup) => (
        <div key={soup.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="min-w-0 truncate font-semibold text-ink">{soup.title}</span>
          <span className="shrink-0 text-xs font-bold text-muted">{primarySoupId === soup.id ? "认证汤 · " : ""}{soup.heatValue.toLocaleString()}热力</span>
        </div>
      ))}
    </div>
  );
}
