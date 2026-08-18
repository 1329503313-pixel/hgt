import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, BookOpenCheck, CheckCircle2, CloudUpload, Code2, Eye, EyeOff, FilePenLine, FilePlus2, ImagePlus, LoaderCircle, RefreshCw, Save, Sparkles, XCircle } from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { MysteryRunAudit } from "./MysteryRunAudit";

type MysteryStorySource = {
  title: string;
  coverUrl: string | null;
  tags: string[];
  storyBackground: string;
  storyContent: string;
  characterDesign: string;
  presetEndings: string;
  coreSettings: string;
  display: {
    hook: string;
    genres: string[];
    era: string;
    region: string;
    perspective: string;
    targetDurationMinutes: number;
    playMode: "single" | "multiplayer_room";
    contentRating: string;
    themes: string[];
    allowedContent: string[];
    forbiddenContent: string[];
  };
  playerRole: {
    actorId: string;
    identity: string;
    physicalProfile: string;
    socialStatus: string;
    skills: string[];
    excludedAbilities: string[];
    initialLocationId: string;
    initialGoals: string[];
    initialKnowledgeIds: string[];
    initialItemInstanceIds: string[];
    initialResources: Record<string, number>;
    initialPhysicalState: string;
    publicIdentity: string;
    hiddenIdentity: string;
    mayLie: boolean;
    mayTakeHighRiskActions: boolean;
  };
  worldRules: {
    worldType: "realistic" | "fantasy" | "mixed";
    technologyLevel: string;
    supernaturalRules: string[];
    lawsAndNorms: string[];
    lifeAndDeathRules: string[];
    medicalRules: string[];
    communicationRules: string[];
    transportRules: string[];
    informationSpeedRules: string[];
    allowsResurrection: boolean;
    allowsTimeTravel: boolean;
    allowsPrecognition: boolean;
    allowsMindReading: boolean;
    absoluteImpossibilities: string[];
  };
  authoringNotes: Record<string, unknown>;
};

type MysteryVersion = {
  id: string;
  versionNumber: number;
  storyPackage: unknown;
  diagnostics: Array<{ severity?: string; code?: string; message?: string }>;
  compiledModel: string;
  customized: boolean;
  reviewStatus: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  createdAt: string;
  publishedAt: string | null;
};

type MysteryListItem = {
  id: string;
  title: string;
  coverUrl: string | null;
  tags: string[];
  publicationStatus: "draft" | "published" | "unpublished";
  reviewStatus: string;
  versionCount: number;
  runCount: number;
  updatedAt: string;
};

type MysteryDetail = MysteryListItem & {
  source: MysteryStorySource;
  publishedVersionId: string | null;
};

type MysteryCompileJob = {
  id: string;
  storyId: string;
  sourceHash: string;
  sourceCurrent: boolean;
  versionNumber: number;
  forceRecompile: boolean;
  status: "queued" | "running" | "succeeded" | "failed";
  attemptCount: number;
  maxAttempts: number;
  versionId: string | null;
  compiledModel: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  availableAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const emptySource: MysteryStorySource = {
  title: "",
  coverUrl: null,
  tags: [],
  storyBackground: "",
  storyContent: "",
  characterDesign: "",
  presetEndings: "",
  coreSettings: "",
  display: {
    hook: "", genres: [], era: "", region: "", perspective: "第二人称",
    targetDurationMinutes: 90, playMode: "multiplayer_room", contentRating: "",
    themes: [], allowedContent: [], forbiddenContent: [],
  },
  playerRole: {
    actorId: "PLAYER_1", identity: "", physicalProfile: "", socialStatus: "", skills: [], excludedAbilities: [],
    initialLocationId: "LOC_START", initialGoals: [], initialKnowledgeIds: [], initialItemInstanceIds: [], initialResources: {},
    initialPhysicalState: "正常", publicIdentity: "", hiddenIdentity: "", mayLie: true, mayTakeHighRiskActions: true,
  },
  worldRules: {
    worldType: "realistic", technologyLevel: "", supernaturalRules: [], lawsAndNorms: [], lifeAndDeathRules: [],
    medicalRules: [], communicationRules: [], transportRules: [], informationSpeedRules: [], allowsResurrection: false,
    allowsTimeTravel: false, allowsPrecognition: false, allowsMindReading: false, absoluteImpossibilities: [],
  },
  authoringNotes: {},
};

const listText = (values: string[]) => values.join("\n");
const parseList = (value: string) => [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))];

function StatusBadge({ status }: { status: string }) {
  const styles = status === "published" || status === "approved"
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : status === "rejected"
      ? "bg-red-50 text-red-700 ring-red-200"
      : "bg-amber-50 text-amber-700 ring-amber-200";
  const labels: Record<string, string> = { published: "已上架", unpublished: "已下架", draft: "草稿", approved: "已审核", rejected: "已驳回", compiled: "待审核", not_compiled: "未编译", pending: "待审核" };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${styles}`}>{labels[status] ?? status}</span>;
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block">
    <span className="mb-1.5 block text-sm font-bold text-ink">{label}{required && <span className="ml-1 text-red-600">*</span>}</span>
    {children}
    {hint && <span className="mt-1.5 block text-xs leading-5 text-muted">{hint}</span>}
  </label>;
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <fieldset className="rounded-2xl border border-line bg-white p-4 sm:p-5">
    <legend className="px-1 text-base font-black text-ink">{title}</legend>
    <p className="mb-4 text-sm leading-6 text-muted">{description}</p>
    <div className="space-y-4">{children}</div>
  </fieldset>;
}

export function MysteryManagement() {
  const { showToast } = useApp();
  const [items, setItems] = useState<MysteryListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [source, setSource] = useState<MysteryStorySource>(structuredClone(emptySource));
  const [detail, setDetail] = useState<MysteryDetail | null>(null);
  const [versions, setVersions] = useState<MysteryVersion[]>([]);
  const [compileJob, setCompileJob] = useState<MysteryCompileJob | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [packageText, setPackageText] = useState("");
  const [coverData, setCoverData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [compilePollError, setCompilePollError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"source" | "package" | "audit">("source");
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedVersion = versions.find((version) => version.id === selectedVersionId) ?? versions[0] ?? null;

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ mysteries: MysteryListItem[] }>("/api/admin/mysteries", { bypassCache: true, dedupe: false });
      setItems(data.mysteries);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "谜局列表加载失败");
    } finally { setLoading(false); }
  }, [showToast]);

  const loadDetail = useCallback(async (id: string) => {
    setBusy("load");
    try {
      const data = await api<{ mystery: MysteryDetail; versions: MysteryVersion[]; compileJob: MysteryCompileJob | null }>(`/api/admin/mysteries/${id}`, { bypassCache: true, dedupe: false });
      setDetail(data.mystery);
      setSource(data.mystery.source);
      setVersions(data.versions);
      setCompileJob(data.compileJob);
      setSelectedVersionId(data.versions[0]?.id ?? null);
      setPackageText(data.versions[0] ? JSON.stringify(data.versions[0].storyPackage, null, 2) : "");
      setCoverData(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "谜局详情加载失败");
    } finally { setBusy(null); }
  }, [showToast]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => {
    setCompileJob(null);
    setCompilePollError(null);
    if (selectedId) void loadDetail(selectedId);
  }, [loadDetail, selectedId]);
  useEffect(() => {
    if (!selectedVersion) { setPackageText(""); return; }
    setPackageText(JSON.stringify(selectedVersion.storyPackage, null, 2));
  }, [selectedVersionId]);
  useEffect(() => {
    if (!selectedId || !compileJob || !["queued", "running"].includes(compileJob.status)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;
    let connectionToastShown = false;
    const jobId = compileJob.id;
    const poll = async () => {
      try {
        const data = await api<{ job: MysteryCompileJob }>(`/api/admin/mysteries/${selectedId}/compile-jobs/${jobId}`, { bypassCache: true, dedupe: false });
        if (cancelled) return;
        consecutiveFailures = 0;
        connectionToastShown = false;
        setCompilePollError(null);
        setCompileJob(data.job);
        if (data.job.status === "succeeded") {
          const refreshed = await api<{ mystery: MysteryDetail; versions: MysteryVersion[]; compileJob: MysteryCompileJob | null }>(`/api/admin/mysteries/${selectedId}`, { bypassCache: true, dedupe: false });
          if (cancelled) return;
          setDetail(refreshed.mystery);
          setVersions(refreshed.versions);
          setSelectedVersionId(data.job.versionId ?? refreshed.versions[0]?.id ?? null);
          setEditorMode("package");
          void loadList();
          showToast(data.job.sourceCurrent ? "故事编译完成，请人工审阅 Story Package" : "旧素材快照已编译完成；当前素材已有修改，请重新编译");
          return;
        }
        if (data.job.status === "failed") {
          showToast(data.job.errorMessage || "故事编译失败，请检查配置后重试");
          return;
        }
        timer = setTimeout(poll, 3_000);
      } catch (error) {
        if (cancelled) return;
        consecutiveFailures += 1;
        const message = "本地 API 服务连接中断；编译任务已持久化，服务恢复后会自动继续。";
        setCompilePollError(message);
        if (!connectionToastShown && consecutiveFailures >= 2) {
          connectionToastShown = true;
          showToast(message);
        }
        timer = setTimeout(poll, Math.min(30_000, 5_000 * (2 ** Math.min(consecutiveFailures - 1, 3))));
      }
    };
    timer = setTimeout(poll, 1_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [compileJob?.id, loadList, selectedId, showToast]);

  const patchSource = <K extends keyof MysteryStorySource>(key: K, value: MysteryStorySource[K]) => setSource((current) => ({ ...current, [key]: value }));
  const patchDisplay = <K extends keyof MysteryStorySource["display"]>(key: K, value: MysteryStorySource["display"][K]) => setSource((current) => ({ ...current, display: { ...current.display, [key]: value } }));
  const patchPlayer = <K extends keyof MysteryStorySource["playerRole"]>(key: K, value: MysteryStorySource["playerRole"][K]) => setSource((current) => ({ ...current, playerRole: { ...current.playerRole, [key]: value } }));
  const patchWorld = <K extends keyof MysteryStorySource["worldRules"]>(key: K, value: MysteryStorySource["worldRules"][K]) => setSource((current) => ({ ...current, worldRules: { ...current.worldRules, [key]: value } }));

  const previewCover = coverData ?? source.coverUrl;
  const sourceValid = useMemo(() => Boolean(
    source.title.trim() && source.storyBackground.trim() && source.storyContent.trim() && source.characterDesign.trim()
    && source.presetEndings.trim() && source.coreSettings.trim() && source.playerRole.identity.trim()
    && source.playerRole.initialLocationId.trim() && source.playerRole.initialGoals.length,
  ), [source]);

  function newMystery() {
    setSelectedId(null);
    setDetail(null);
    setVersions([]);
    setCompileJob(null);
    setCompilePollError(null);
    setSelectedVersionId(null);
    setSource(structuredClone(emptySource));
    setCoverData(null);
    setEditorMode("source");
  }

  function chooseCover(file: File | undefined) {
    if (!file) return;
    if (!file.type.match(/^image\/(png|jpeg|webp)$/) || file.size > 8 * 1024 * 1024) {
      showToast("封面仅支持 8MB 以内的 JPG、PNG 或 WebP");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCoverData(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  async function saveSource() {
    if (!sourceValid || busy) { showToast("请先补全所有必填故事设定和玩家初始目标"); return; }
    setBusy("save");
    try {
      const body = { source, coverData };
      if (selectedId) {
        await api(`/api/admin/mysteries/${selectedId}`, { method: "PUT", body });
        await Promise.all([loadList(), loadDetail(selectedId)]);
      } else {
        const created = await api<{ id: string }>("/api/admin/mysteries", { method: "POST", body });
        await loadList();
        setSelectedId(created.id);
      }
      showToast("谜局草稿已保存");
    } catch (error) { showToast(error instanceof Error ? error.message : "谜局保存失败"); }
    finally { setBusy(null); }
  }

  async function compileStory() {
    if (!selectedId || busy) return;
    setBusy("compile");
    try {
      const data = await api<{ job: MysteryCompileJob }>(`/api/admin/mysteries/${selectedId}/compile`, { method: "POST", body: { force: true } });
      setCompilePollError(null);
      setCompileJob(data.job);
      setEditorMode("package");
      if (data.job.status === "succeeded") {
        await Promise.all([loadList(), loadDetail(selectedId)]);
        showToast("已复用相同素材的编译版本");
      } else {
        showToast(data.job.status === "running" ? "故事正在后台编译" : "故事已加入后台编译队列");
      }
    } catch (error) { showToast(error instanceof Error ? error.message : "故事编译失败，请检查配置后重试"); }
    finally { setBusy(null); }
  }

  async function savePackage() {
    if (!selectedId || !selectedVersion || busy) return;
    let storyPackage: unknown;
    try { storyPackage = JSON.parse(packageText); }
    catch { showToast("Story Package 不是有效 JSON"); return; }
    setBusy("package");
    try {
      await api(`/api/admin/mysteries/${selectedId}/versions/${selectedVersion.id}/package`, { method: "PUT", body: { storyPackage } });
      await loadDetail(selectedId);
      showToast("Story Package 已保存，需重新审核");
    } catch (error) { showToast(error instanceof Error ? error.message : "Story Package 保存失败"); }
    finally { setBusy(null); }
  }

  async function review(decision: "approved" | "rejected") {
    if (!selectedId || !selectedVersion || busy) return;
    const note = decision === "rejected" ? (window.prompt("请填写驳回原因") ?? "") : "";
    if (decision === "rejected" && !note.trim()) return;
    setBusy("review");
    try {
      await api(`/api/admin/mysteries/${selectedId}/versions/${selectedVersion.id}/review`, { method: "POST", body: { decision, note } });
      await Promise.all([loadList(), loadDetail(selectedId)]);
      showToast(decision === "approved" ? "版本已审核通过" : "版本已驳回");
    } catch (error) { showToast(error instanceof Error ? error.message : "审核操作失败"); }
    finally { setBusy(null); }
  }

  async function togglePublication() {
    if (!selectedId || !detail || busy) return;
    const publishing = detail.publicationStatus !== "published";
    if (publishing && selectedVersion?.reviewStatus !== "approved") { showToast("请先选择并审核通过一个版本"); return; }
    if (!publishing && !window.confirm("下架后新玩家不可进入，但已开始的局仍固定使用原版本继续。确认下架？")) return;
    setBusy("publish");
    try {
      await api(`/api/admin/mysteries/${selectedId}/${publishing ? "publish" : "unpublish"}`, {
        method: "POST", body: publishing ? { versionId: selectedVersion!.id } : {},
      });
      await Promise.all([loadList(), loadDetail(selectedId)]);
      showToast(publishing ? "谜局已上架" : "谜局已下架");
    } catch (error) { showToast(error instanceof Error ? error.message : "上下架操作失败"); }
    finally { setBusy(null); }
  }

  return <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
    <aside className="rounded-2xl border border-line bg-white p-3 xl:sticky xl:top-[82px] xl:max-h-[calc(100dvh-98px)] xl:overflow-y-auto">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div><h2 className="font-black text-ink">谜局</h2><p className="text-xs text-muted">草稿、版本和发布</p></div>
        <button type="button" className="btn btn-primary min-h-11 px-3" onClick={newMystery}><FilePlus2 size={16} />新建</button>
      </div>
      {loading ? <div className="space-y-2" aria-label="谜局列表加载中">{[1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}</div>
        : items.length ? <div className="space-y-2">{items.map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full cursor-pointer rounded-xl border p-3 text-left transition ${selectedId === item.id ? "border-primary bg-blue-50 ring-2 ring-blue-100" : "border-line hover:border-blue-300 hover:bg-slate-50"}`}>
          <div className="flex items-start justify-between gap-2"><strong className="line-clamp-2 text-sm text-ink">{item.title}</strong><StatusBadge status={item.publicationStatus} /></div>
          <p className="mt-2 text-xs text-muted">{item.versionCount} 个版本 · {item.runCount} 局</p>
        </button>)}</div>
        : <div className="rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-muted"><BookOpenCheck className="mx-auto mb-2 text-slate-300" />还没有谜局，先创建第一份草稿。</div>}
    </aside>

    <main className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-3 sm:p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-black text-ink">{selectedId ? source.title || "未命名谜局" : "新建谜局"}</h2>{detail && <><StatusBadge status={detail.publicationStatus} /><StatusBadge status={detail.reviewStatus} /></>}</div>
          <p className="mt-1 text-sm text-muted">发布流程：保存素材 → AI 编译 → 人工审阅/修正 → 审核通过 → 上架</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedId && <div className="flex flex-wrap rounded-xl bg-slate-100 p-1" role="tablist" aria-label="谜局管理视图">
            <button type="button" role="tab" aria-selected={editorMode === "source"} className={`flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-bold transition ${editorMode === "source" ? "bg-white text-primary shadow-sm" : "text-muted hover:text-ink"}`} onClick={() => setEditorMode("source")}><FilePenLine size={16} />故事素材</button>
            <button type="button" role="tab" aria-selected={editorMode === "package"} className={`flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-bold transition ${editorMode === "package" ? "bg-white text-primary shadow-sm" : "text-muted hover:text-ink"}`} onClick={() => setEditorMode("package")}><Code2 size={16} />结构包</button>
            <button type="button" role="tab" aria-selected={editorMode === "audit"} className={`flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-bold transition ${editorMode === "audit" ? "bg-white text-primary shadow-sm" : "text-muted hover:text-ink"}`} onClick={() => setEditorMode("audit")}><Activity size={16} />运行审计</button>
          </div>}
          {selectedId && <button type="button" className="btn btn-secondary min-h-11" disabled={Boolean(busy) || compileJob?.status === "queued" || compileJob?.status === "running"} onClick={() => void compileStory()}>{busy === "compile" || compileJob?.status === "queued" || compileJob?.status === "running" ? <LoaderCircle className="animate-spin" size={16} /> : <Sparkles size={16} />}{compileJob?.status === "queued" ? "等待编译" : compileJob?.status === "running" ? "正在编译" : "编译新版本"}</button>}
          {detail && <button type="button" className={`btn min-h-11 ${detail.publicationStatus === "published" ? "btn-secondary text-red-700" : "btn-primary"}`} disabled={Boolean(busy)} onClick={() => void togglePublication()}>{detail.publicationStatus === "published" ? <><EyeOff size={16} />下架</> : <><Eye size={16} />上架</>}</button>}
        </div>
      </div>

      {compileJob && <section className={`rounded-2xl border p-4 ${compileJob.status === "failed" ? "border-red-200 bg-red-50" : compileJob.status === "succeeded" ? "border-emerald-200 bg-emerald-50" : "border-blue-200 bg-blue-50"}`} aria-live="polite">
        <div className="flex items-start gap-3">
          {compileJob.status === "queued" || compileJob.status === "running" ? <LoaderCircle className="mt-0.5 shrink-0 animate-spin text-primary" size={20} /> : compileJob.status === "succeeded" ? <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-700" size={20} /> : <XCircle className="mt-0.5 shrink-0 text-red-700" size={20} />}
          <div className="min-w-0">
            <h3 className="font-black text-ink">{compileJob.status === "queued" ? `Story Package v${compileJob.versionNumber} 等待编译` : compileJob.status === "running" ? `Story Package v${compileJob.versionNumber} 正在编译` : compileJob.status === "succeeded" ? `Story Package v${compileJob.versionNumber} 编译完成` : `Story Package v${compileJob.versionNumber} 编译失败`}</h3>
            <p className="mt-1 text-sm leading-6 text-muted">{compileJob.status === "queued" ? compileJob.attemptCount > 0 ? `临时错误后等待自动重试（${compileJob.attemptCount}/${compileJob.maxAttempts}）` : "任务已持久化，可以离开页面；重新进入后仍会显示进度。" : compileJob.status === "running" ? `后台正在分析六类故事图谱（尝试 ${compileJob.attemptCount}/${compileJob.maxAttempts}）。` : compileJob.status === "succeeded" ? compileJob.sourceCurrent ? "结构化版本已生成，下一步需要人工检查、修正并审核。" : "该结果来自旧素材快照，当前草稿已变化；结果保留，但应重新编译当前素材。" : compileJob.errorMessage || "任务未生成版本，可以重新发起编译。"}</p>
            {compileJob.status === "failed" && compileJob.errorCode && <p className="mt-2 font-mono text-xs font-bold text-red-700">错误码：{compileJob.errorCode}</p>}
            {compilePollError && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900" role="alert">{compilePollError}</p>}
          </div>
        </div>
      </section>}

      {editorMode === "source" ? <>
        <Section title="前台展示" description="标题、封面、标签只用于首页和选局展示，不会进入玩家可见的隐藏剧情。">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="标题" required><input className="field min-h-11 w-full" value={source.title} onChange={(event) => patchSource("title", event.target.value)} maxLength={120} /></Field>
            <Field label="标签" hint="用逗号分隔，最多 12 个"><input className="field min-h-11 w-full" value={source.tags.join("，")} onChange={(event) => patchSource("tags", parseList(event.target.value).slice(0, 12))} /></Field>
          </div>
          <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
            <div className="aspect-video overflow-hidden rounded-xl border border-dashed border-line bg-slate-50">{previewCover ? <img src={previewCover} alt="谜局封面预览" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-muted">暂无封面</div>}</div>
            <div className="flex items-center"><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => chooseCover(event.target.files?.[0])} /><button type="button" className="btn btn-secondary min-h-11" onClick={() => fileInput.current?.click()}><ImagePlus size={16} />上传 16:9 封面</button></div>
          </div>
        </Section>

        <Section title="故事原始素材" description="这些内容仅供编译、裁决和审核使用。玩家房间只显示标题与背景介绍。">
          {([[
            "storyBackground", "故事背景 / 玩家介绍", "仅此字段会在谜局房间展示，避免包含核心秘密。"
          ], ["storyContent", "故事内容", "写清既定过去、核心冲突、故事走向、场景和世界自行推进的事件。"], ["characterDesign", "人物塑造", "写清每个人物的身份、目标、知识、误解、计划、底线、能力与反应规则。"], ["presetEndings", "预设结局", "配置主结局家族以及偏航、旁观、失败、死亡、超时等兜底结局。"], ["coreSettings", "核心设定", "写清不可变事实、世界法则、唯一物品、时间窗口和绝不允许发生的事情。"]] as const).map(([key, label, hint]) => <Field key={key} label={label} hint={hint} required><textarea className="field min-h-40 w-full resize-y leading-6" value={source[key]} onChange={(event) => patchSource(key, event.target.value)} /></Field>)}
        </Section>

        <Section title="故事基础与内容边界" description="帮助编译器建立稳定的叙事风格、目标时长和安全边界。">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="一句话钩子"><input className="field min-h-11 w-full" value={source.display.hook} onChange={(event) => patchDisplay("hook", event.target.value)} /></Field>
            <Field label="类型" hint="用逗号分隔，最多 12 项，每项最多 120 个字符"><input className="field min-h-11 w-full" value={source.display.genres.join("，")} onChange={(event) => patchDisplay("genres", parseList(event.target.value).slice(0, 12))} /></Field>
            <Field label="时代"><input className="field min-h-11 w-full" value={source.display.era} onChange={(event) => patchDisplay("era", event.target.value)} /></Field>
            <Field label="地域"><input className="field min-h-11 w-full" value={source.display.region} onChange={(event) => patchDisplay("region", event.target.value)} /></Field>
            <Field label="叙事视角"><input className="field min-h-11 w-full" value={source.display.perspective} onChange={(event) => patchDisplay("perspective", event.target.value)} /></Field>
            <Field label="目标时长（分钟）"><input type="number" min={5} max={2400} className="field min-h-11 w-full" value={source.display.targetDurationMinutes} onChange={(event) => patchDisplay("targetDurationMinutes", Number(event.target.value) || 90)} /></Field>
            <Field label="内容分级"><input className="field min-h-11 w-full" value={source.display.contentRating} onChange={(event) => patchDisplay("contentRating", event.target.value)} /></Field>
            <Field label="核心主题"><input className="field min-h-11 w-full" value={source.display.themes.join("，")} onChange={(event) => patchDisplay("themes", parseList(event.target.value))} /></Field>
          </div>
          <Field label="允许出现的内容"><textarea className="field min-h-24 w-full" value={listText(source.display.allowedContent)} onChange={(event) => patchDisplay("allowedContent", parseList(event.target.value))} /></Field>
          <Field label="禁止出现的内容"><textarea className="field min-h-24 w-full" value={listText(source.display.forbiddenContent)} onChange={(event) => patchDisplay("forbiddenContent", parseList(event.target.value))} /></Field>
        </Section>

        <Section title="玩家角色边界" description="能力、初始位置、知识、物品和资源必须明确，玩家输入不能凭空创建这些事实。">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="玩家身份" required><input className="field min-h-11 w-full" value={source.playerRole.identity} onChange={(event) => patchPlayer("identity", event.target.value)} /></Field>
            <Field label="初始地点 ID" required><input className="field min-h-11 w-full font-mono" value={source.playerRole.initialLocationId} onChange={(event) => patchPlayer("initialLocationId", event.target.value)} /></Field>
            <Field label="身体条件"><input className="field min-h-11 w-full" value={source.playerRole.physicalProfile} onChange={(event) => patchPlayer("physicalProfile", event.target.value)} /></Field>
            <Field label="社会地位"><input className="field min-h-11 w-full" value={source.playerRole.socialStatus} onChange={(event) => patchPlayer("socialStatus", event.target.value)} /></Field>
            <Field label="已掌握技能"><textarea className="field min-h-24 w-full" value={listText(source.playerRole.skills)} onChange={(event) => patchPlayer("skills", parseList(event.target.value))} /></Field>
            <Field label="明确不具备的能力"><textarea className="field min-h-24 w-full" value={listText(source.playerRole.excludedAbilities)} onChange={(event) => patchPlayer("excludedAbilities", parseList(event.target.value))} /></Field>
          </div>
          <Field label="初始目标" required><textarea className="field min-h-24 w-full" value={listText(source.playerRole.initialGoals)} onChange={(event) => patchPlayer("initialGoals", parseList(event.target.value))} /></Field>
          <div className="flex flex-wrap gap-4"><label className="flex min-h-11 items-center gap-2 text-sm font-bold text-ink"><input type="checkbox" checked={source.playerRole.mayLie} onChange={(event) => patchPlayer("mayLie", event.target.checked)} />允许说谎</label><label className="flex min-h-11 items-center gap-2 text-sm font-bold text-ink"><input type="checkbox" checked={source.playerRole.mayTakeHighRiskActions} onChange={(event) => patchPlayer("mayTakeHighRiskActions", event.target.checked)} />允许犯罪或高风险行动</label></div>
        </Section>

        <Section title="世界法则" description="程序和裁决器都将这些规则视为高优先级约束。">
          <div className="grid gap-4 md:grid-cols-2"><Field label="世界类型"><select className="field min-h-11 w-full" value={source.worldRules.worldType} onChange={(event) => patchWorld("worldType", event.target.value as MysteryStorySource["worldRules"]["worldType"])}><option value="realistic">现实世界</option><option value="fantasy">魔法世界</option><option value="mixed">混合世界</option></select></Field><Field label="科技水平"><input className="field min-h-11 w-full" value={source.worldRules.technologyLevel} onChange={(event) => patchWorld("technologyLevel", event.target.value)} /></Field></div>
          <Field label="绝对不可能发生"><textarea className="field min-h-28 w-full" value={listText(source.worldRules.absoluteImpossibilities)} onChange={(event) => patchWorld("absoluteImpossibilities", parseList(event.target.value))} /></Field>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{([ ["allowsResurrection", "允许复活"], ["allowsTimeTravel", "允许时间倒流"], ["allowsPrecognition", "允许预知"], ["allowsMindReading", "允许读心"] ] as const).map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm font-bold text-ink"><input type="checkbox" checked={source.worldRules[key]} onChange={(event) => patchWorld(key, event.target.checked)} />{label}</label>)}</div>
        </Section>

        <div className="sticky bottom-3 z-10 flex justify-end rounded-2xl border border-line bg-white/95 p-3 shadow-lg backdrop-blur"><button type="button" className="btn btn-primary min-h-11 min-w-36" disabled={Boolean(busy) || !sourceValid} onClick={() => void saveSource()}>{busy === "save" ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}{selectedId ? "保存故事素材" : "创建谜局草稿"}</button></div>
      </> : editorMode === "package" ? <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="space-y-2">{versions.length ? versions.map((version) => <button key={version.id} type="button" onClick={() => setSelectedVersionId(version.id)} className={`w-full rounded-xl border p-3 text-left ${selectedVersion?.id === version.id ? "border-primary bg-blue-50 ring-2 ring-blue-100" : "border-line bg-white"}`}><div className="flex items-center justify-between gap-2"><strong>版本 {version.versionNumber}</strong><StatusBadge status={version.reviewStatus} /></div><p className="mt-2 text-xs text-muted">{version.compiledModel}{version.customized ? " · 人工修正" : ""}</p></button>) : <div className="card p-6 text-center text-sm text-muted">还没有编译版本。</div>}</aside>
        <section className="min-w-0 space-y-4">
          {selectedVersion ? <>
            <div className="rounded-2xl border border-line bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-black text-ink">Story Package v{selectedVersion.versionNumber}</h3><p className="mt-1 text-sm text-muted">六类图的结构化结果。发布后锁定，旧存档始终使用开局版本。</p></div><div className="flex flex-wrap gap-2"><button className="btn btn-secondary min-h-11" disabled={Boolean(busy) || Boolean(selectedVersion.publishedAt)} onClick={() => void savePackage()}><CloudUpload size={16} />保存修正</button><button className="btn btn-secondary min-h-11 text-red-700" disabled={Boolean(busy)} onClick={() => void review("rejected")}><XCircle size={16} />驳回</button><button className="btn btn-primary min-h-11" disabled={Boolean(busy)} onClick={() => void review("approved")}><CheckCircle2 size={16} />审核通过</button></div></div></div>
            {selectedVersion.diagnostics?.length > 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-black text-amber-900">编译诊断</h3><ul className="mt-2 space-y-2 text-sm text-amber-900">{selectedVersion.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`} className="rounded-lg bg-white/70 px-3 py-2"><strong>{diagnostic.severity ?? "info"} · {diagnostic.code ?? "CHECK"}</strong><span className="ml-2">{diagnostic.message}</span></li>)}</ul></div>}
            <Field label="结构化 Story Package JSON" hint="保存前由服务端执行完整 Schema 校验；已发布版本不可覆盖，只能重新编译新版本。"><textarea spellCheck={false} className="field min-h-[65dvh] w-full resize-y font-mono text-xs leading-5" value={packageText} onChange={(event) => setPackageText(event.target.value)} readOnly={Boolean(selectedVersion.publishedAt)} /></Field>
          </> : <div className="card py-16 text-center text-muted"><RefreshCw className="mx-auto mb-3" />保存故事素材后编译第一个版本。</div>}
        </section>
      </div> : selectedId ? <MysteryRunAudit storyId={selectedId} /> : null}
      {busy === "load" && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" role="status" aria-live="polite"><div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 font-bold text-ink shadow-xl"><LoaderCircle className="animate-spin text-primary" />正在加载谜局配置</div></div>}
    </main>
  </div>;
}
