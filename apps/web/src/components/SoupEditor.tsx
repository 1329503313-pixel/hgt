import { FormEvent, useRef, useState } from "react";
import { ImagePlus, Plus, Trash2, X } from "lucide-react";
import type { SoupForm } from "../context/AppContext";
import { soupDifficulties, soupTypes } from "../context/AppContext";
import { Modal } from "./Modal";
import { CheckRow } from "./FormWidgets";
import { useApp } from "../context/AppContext";
import { api } from "../api";
import { useNavigate } from "react-router-dom";
import { refreshMineContentCache } from "../shared/mineContentCache";
import { CoverCropper } from "./CoverCropper";

function SupplementEditor({
  title,
  items,
  onAdd,
  onChange,
  onRemove
}: {
  title: string;
  items: string[];
  onAdd: () => void;
  onChange: (index: number, text: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-line bg-slate-50 p-3">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <span className="text-xs font-bold text-muted">{title}</span>
        <button className="btn btn-secondary px-3" type="button" onClick={onAdd}>
          <Plus size={16} />
          追加
        </button>
      </div>
      {items.map((item, index) => (
        <label className="block space-y-1" key={index}>
          <span className="text-xs font-bold text-muted">{title}{index + 1}</span>
          <div className="space-y-2">
            <textarea
              className="field min-h-32"
              style={{ minHeight: 128 }}
              placeholder={`请输入${title}${index + 1}`}
              value={item}
              onChange={(event) => onChange(index, event.target.value)}
            />
            <button className="btn btn-secondary w-full" type="button" onClick={() => onRemove(index)}>
              <Trash2 size={16} />
              删除{title}{index + 1}
            </button>
          </div>
        </label>
      ))}
      {items.length === 0 && <p className="text-xs leading-5 text-muted">可按需要追加，空白补充项不会保存。</p>}
    </div>
  );
}

function TermsModal({ onClose, onAccept }: { onClose: () => void; onAccept: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/35 px-3 pt-[max(12px,env(safe-area-inset-top))] pb-[max(12px,env(safe-area-inset-bottom))] sm:items-center sm:p-4">
      <div className="max-h-[calc(100dvh-24px)] w-full max-w-lg overflow-auto rounded-2xl bg-white p-5 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-ink">用户使用条款</h3>
            <p className="mt-1 text-sm text-muted">发布海龟汤前，请确认你理解并接受以下承诺。</p>
          </div>
          <button className="btn btn-secondary px-3" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="mt-4 space-y-3 text-sm leading-7 text-ink">
          <p>1. 用户承诺其上传、发布或编辑的海龟汤内容为本人原创，或已取得合法、充分的授权，不存在侵犯他人著作权、改编权、信息网络传播权、署名权等合法权益的情形。</p>
          <p>2. 用户承诺上传内容不存在版权归属争议、抄袭、未经授权转载、未经授权改编等问题。若因内容权利瑕疵产生投诉、纠纷、索赔或法律责任，均由发布用户自行承担。</p>
          <p>3. 用户承诺不会利用本平台发布的海龟汤内容进行未经授权的商业盈利活动，包括但不限于售卖、付费转载、商业演出、课程售卖或其他以该内容直接获利的行为。</p>
          <p>4. 平台仅提供内容记录、展示、评价与授权查看工具，不对用户上传内容的真实性、原创性、合法性作实质审查或担保。</p>
          <p>5. 若平台收到权利人投诉、监管要求或发现明显违规内容，平台有权对相关内容采取隐藏、删除、限制访问或冻结账号等处理措施。</p>
        </div>
        <button className="btn btn-primary mt-5 w-full" onClick={onAccept}>我已了解</button>
      </div>
    </div>
  );
}

export function SoupEditor() {
  const { user, soupForm: value, setSoupForm: setValue, editingSoupId, closeSoupEditor, showToast, triggerRefresh, checkBadgeUnlocks } = useApp();
  const navigate = useNavigate();
  const editing = Boolean(editingSoupId);

  const [termsAccepted, setTermsAccepted] = useState(editing);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsError, setTermsError] = useState("");
  const [coverError, setCoverError] = useState("");
  const [coverCropSource, setCoverCropSource] = useState<string | null>(null);
  const [advSettingsOpen, setAdvSettingsOpen] = useState(false);
  const [reanalyzeConfirmOpen, setReanalyzeConfirmOpen] = useState(false);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const createIdempotencyKeyRef = useRef(
    globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );

  const authorName = user?.nickname || user?.username || "";
  const canEnableAiGame = editing
    ? value.canConfigureAiGame
    : user?.role === "super_admin" || user?.role === "backoffice_admin" || user?.role === "vip";

  const patch = (next: Partial<SoupForm>) => setValue({ ...value, ...next });

  // 高级设置：关键点增/删/改
  function addKeyFact() {
    const nextId = Math.max(0, ...value.keyFacts.map((k) => k.id)) + 1;
    patch({ keyFacts: [...value.keyFacts, { id: nextId, content: "", weight: 10, hintContent: "" }], keyFactsCustomized: true });
  }
  function removeKeyFact(id: number) {
    patch({ keyFacts: value.keyFacts.filter((k) => k.id !== id), keyFactsCustomized: true });
  }
  function updateKeyFact(id: number, field: "content" | "weight" | "hintContent", val: string | number) {
    patch({
      keyFacts: value.keyFacts.map((k) => (k.id === id ? { ...k, [field]: val } : k)),
      keyFactsCustomized: true
    });
  }

  const keyFactsTotalWeight = value.keyFacts.reduce(
    (sum, k) => sum + (Number.isFinite(k.weight) ? k.weight : 0),
    0
  );
  const keyFactsWeightValid = value.keyFacts.length === 0 || keyFactsTotalWeight === 100;
  const emptyKeyFactIndex = value.keyFacts.findIndex((keyFact) => !keyFact.content.trim());
  const invalidKeyFactWeightIndex = value.keyFacts.findIndex(
    (keyFact) => !Number.isInteger(keyFact.weight) || keyFact.weight < 1 || keyFact.weight > 99
  );
  const invalidKeyFactHintIndex = value.keyFacts.findIndex(
    (keyFact) => !(keyFact.hintContent ?? "").trim() || (keyFact.hintContent ?? "").trim().length > 50
  );
  const aiAdvancedSettingsError = !value.enableAiGame || !value.keyFactsCustomized
    ? ""
    : value.keyFacts.length === 0
    ? "AI 主持高级设置：手动管理关键点时至少保留 1 个关键点"
    : emptyKeyFactIndex >= 0
    ? `AI 主持高级设置：第 ${emptyKeyFactIndex + 1} 个关键点未填写`
    : invalidKeyFactWeightIndex >= 0
      ? `AI 主持高级设置：第 ${invalidKeyFactWeightIndex + 1} 个关键点未填写有效进度值（1–99）`
      : invalidKeyFactHintIndex >= 0
        ? `AI 主持高级设置：第 ${invalidKeyFactHintIndex + 1} 个关键点提示内容需填写且不超过 50 个字`
      : !keyFactsWeightValid
        ? `AI 主持高级设置：进度值总和必须为 100，当前为 ${keyFactsTotalWeight}`
        : "";

  // 清除关键点（服务端仍沿用原有重新生成逻辑）
  async function handleReanalyze() {
    if (!editingSoupId) return;
    try {
      await api(`/api/soups/${editingSoupId}/reanalyze-keyfacts`, { method: "POST" });
      patch({ keyFacts: [], keyFactsCustomized: false });
      showToast("关键点和提示内容已清除，稍后刷新查看重新生成结果");
      setReanalyzeConfirmOpen(false);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "操作失败");
    }
  }

  function handleCoverUpload(file: File | undefined) {
    setCoverError("");
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setCoverError("封面仅支持 JPG 或 PNG 图片");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setCoverError("封面图片请控制在 3MB 以内");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCoverCropSource(String(reader.result));
    reader.readAsDataURL(file);
  }

  function updateSupplement(kind: "surface" | "bottom", index: number, text: string) {
    const key = kind === "surface" ? "supplementalSurfaces" : "supplementalBottoms";
    const next = [...value[key]];
    next[index] = text;
    patch({ [key]: next } as Partial<SoupForm>);
  }

  function addSupplement(kind: "surface" | "bottom") {
    const key = kind === "surface" ? "supplementalSurfaces" : "supplementalBottoms";
    patch({ [key]: [...value[key], ""] } as Partial<SoupForm>);
  }

  function removeSupplement(kind: "surface" | "bottom", index: number) {
    const key = kind === "surface" ? "supplementalSurfaces" : "supplementalBottoms";
    patch({ [key]: value[key].filter((_, i) => i !== index) } as Partial<SoupForm>);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!termsAccepted) { setTermsError("请先勾选同意用户使用条款"); return; }
    if (canEnableAiGame && value.enableAiGame && aiAdvancedSettingsError) {
      setAdvSettingsOpen(true);
      showToast(aiAdvancedSettingsError);
      return;
    }
    setTermsError("");
    submittingRef.current = true;
    setSubmitting(true);

    const method = editing ? "PUT" : "POST";
    const path = editing ? `/api/soups/${editingSoupId}` : "/api/soups";
    const { canConfigureAiGame: _canConfigureAiGame, ...formValue } = value;
    const payload = {
      ...formValue,
      enableAiGame: canEnableAiGame ? value.enableAiGame : false,
      keyFacts: canEnableAiGame && value.enableAiGame && value.keyFactsCustomized ? value.keyFacts : [],
      keyFactsCustomized: canEnableAiGame && value.enableAiGame ? value.keyFactsCustomized : false,
      supplementalSurfaces: value.supplementalSurfaces.map((s: string) => s.trim()).filter(Boolean),
      supplementalBottoms: value.supplementalBottoms.map((s: string) => s.trim()).filter(Boolean),
      author: value.isOriginal ? authorName : "佚名"
    };

    try {
      const result = await api<{ id?: string; reviewStatus?: "approved" | "pending" | "rejected" }>(path, {
        method,
        body: payload,
        headers: editing ? undefined : { "Idempotency-Key": createIdempotencyKeyRef.current }
      });
      if (user) void refreshMineContentCache(user.id, "published").catch(() => {});
      if (editing) triggerRefresh();
      closeSoupEditor();
      if (result.reviewStatus === "pending") {
        showToast("您发布的海龟汤可能存在不当言论，目前正在由管理员进行审核");
      } else {
        showToast(editing ? "已更新" : "已发布");
      }
      if (!editing) await checkBadgeUnlocks();
      navigate(`/soup/${editing ? editingSoupId : result.id}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "操作失败");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal
      full
      bare
      onClose={() => { if (!submittingRef.current) closeSoupEditor(); }}
      overlayClassName="bg-slate-950/55 backdrop-blur-sm"
      contentClassName="!max-w-5xl sm:!h-[92vh]"
    >
      <form className="soup-editor-dialog flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-[0_28px_80px_rgba(15,23,42,.28)] sm:rounded-3xl" onSubmit={handleSubmit} aria-busy={submitting}>
        <header className="soup-editor-header flex shrink-0 items-center justify-between gap-4 border-b border-line bg-white px-4 py-4 sm:px-7 sm:py-5">
          <div className="min-w-0">
            <p className="text-[11px] font-black tracking-[0.18em] text-primary">内容创作 · SOUP EDITOR</p>
            <h2 className="mt-1 text-xl font-black text-ink sm:text-2xl">{editing ? "编辑海龟汤" : "发布海龟汤"}</h2>
            <p className="mt-1 hidden text-sm text-muted sm:block">完善汤面、汤底与展示信息，带给玩家完整的推理体验。</p>
          </div>
          <button type="button" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-slate-50 text-muted transition hover:border-primary hover:bg-blue-50 hover:text-primary" disabled={submitting} onClick={closeSoupEditor} aria-label="关闭发布窗口" title="关闭">
            <X size={19} />
          </button>
        </header>
        <div className="soup-editor-body min-h-0 flex-1 overflow-y-auto bg-slate-50/80 px-4 py-5 sm:px-7 sm:py-6">
          <div className="soup-editor-content mx-auto max-w-4xl space-y-4 sm:space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs font-bold text-muted"><span className="text-danger">*</span> 标题</span>
            <input className="field" placeholder="请输入标题" value={value.title} onChange={(e) => patch({ title: e.target.value })} required />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-bold text-muted"><span className="text-danger">*</span> 是否原创</span>
            <select className="field" value={value.isOriginal ? "yes" : "no"} onChange={(e) => { const isOriginal = e.target.value === "yes"; patch({ isOriginal, author: isOriginal ? authorName : "佚名" }); }}>
              <option value="yes">是，原创</option>
              <option value="no">否，非原创</option>
            </select>
          </label>
          {!value.isOriginal && (
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs font-bold text-muted"><span className="text-danger">*</span> 作者</span>
              <input className="field" value={value.author || authorName} readOnly required />
            </label>
          )}
          <label className="space-y-2 md:col-span-2">
            <span className="text-xs font-bold text-muted"><span className="text-danger">*</span> 类型</span>
            <select className="field" value={value.type} onChange={(e) => patch({ type: e.target.value })}>
              {soupTypes.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="space-y-2 md:col-span-2">
            <span className="text-xs font-bold text-muted"><span className="text-danger">*</span> 难度</span>
            <select className="field" value={value.difficulty} onChange={(e) => patch({ difficulty: e.target.value as SoupForm["difficulty"] })} required>
              {soupDifficulties.map((difficulty) => <option key={difficulty}>{difficulty}</option>)}
            </select>
          </label>
        </div>

        <label className="space-y-2">
          <span className="text-xs font-bold text-muted"><span className="text-danger">*</span> 是否涉黄赌毒暴恐</span>
          <select className="field" value={value.isSensitive ? "yes" : "no"} onChange={(e) => patch({ isSensitive: e.target.value === "yes" })} required>
            <option value="no">否</option>
            <option value="yes">是</option>
          </select>
          {value.isSensitive && <p className="text-xs text-muted">请您仔细检查汤面汤底，相关敏感词汇以首字母或同音字代替。</p>}
        </label>

        <label className="space-y-2">
          <span className="text-xs font-bold text-muted">封面</span>
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
            {value.coverImage ? (
              <div className="space-y-3">
                <img className="aspect-video w-full rounded-lg object-cover" src={value.coverImage} alt="封面预览" />
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="btn btn-secondary cursor-pointer">
                    更换封面
                    <input className="hidden" type="file" accept="image/jpeg,image/png" onChange={(e) => handleCoverUpload(e.target.files?.[0])} />
                  </label>
                  <button className="btn btn-secondary" type="button" onClick={() => setCoverCropSource(value.coverImage)}>调整裁剪</button>
                  <button className="btn btn-secondary" type="button" onClick={() => patch({ coverImage: "" })}>移除封面</button>
                </div>
              </div>
            ) : (
              <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg bg-white px-4 py-5 text-center text-sm text-muted">
                <ImagePlus className="mb-2 text-primary" size={24} />
                上传 JPG 或 PNG 封面
                <span className="mt-1 text-xs text-muted">建议小于 3MB</span>
                <input className="hidden" type="file" accept="image/jpeg,image/png" onChange={(e) => handleCoverUpload(e.target.files?.[0])} />
              </label>
            )}
            {coverError && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{coverError}</div>}
          </div>
        </label>

        <label className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted">摘要</span>
          </div>
          <div className="relative">
            <textarea className="field min-h-24 pb-8" style={{ minHeight: 96 }} placeholder="最多 40 个字" maxLength={40} value={value.summary} onChange={(e) => patch({ summary: e.target.value })} />
            <span className="pointer-events-none absolute bottom-2 right-3 text-xs text-muted">{value.summary.length}/40</span>
          </div>
        </label>

        <div className="space-y-2">
          <label className="space-y-2">
            <span className="text-xs font-bold text-muted"><span className="text-danger">*</span> 汤面</span>
            <textarea className="field min-h-56" style={{ minHeight: 224 }} placeholder="请输入汤面" value={value.surface} onChange={(e) => patch({ surface: e.target.value })} required />
          </label>
          <SupplementEditor title="补充汤面" items={value.supplementalSurfaces} onAdd={() => addSupplement("surface")} onChange={(i, t) => updateSupplement("surface", i, t)} onRemove={(i) => removeSupplement("surface", i)} />
        </div>

        <div className="space-y-2">
          <label className="space-y-2">
            <span className="text-xs font-bold text-muted"><span className="text-danger">*</span> 汤底</span>
            <textarea className="field min-h-56" style={{ minHeight: 224 }} placeholder="请输入汤底" value={value.bottom} onChange={(e) => patch({ bottom: e.target.value })} required />
          </label>
          <SupplementEditor title="补充汤底" items={value.supplementalBottoms} onAdd={() => addSupplement("bottom")} onChange={(i, t) => updateSupplement("bottom", i, t)} onRemove={(i) => removeSupplement("bottom", i)} />
        </div>

        <label className="space-y-2">
          <span className="text-xs font-bold text-muted">主持人手册</span>
          <textarea className="field min-h-44" style={{ minHeight: 176 }} placeholder="选填" value={value.manual} onChange={(e) => patch({ manual: e.target.value })} />
        </label>

        <div className="space-y-2 border-t border-line pt-3">
          <CheckRow label="公开汤面" desc="勾选后，其他用户可以在列表和详情中看到这条海龟汤。" checked={value.isSurfacePublic} onChange={(c) => patch({ isSurfacePublic: c })} />
          <CheckRow label="公开汤底和主持人手册" desc="勾选后，其他用户无需申请即可查看完整内容。" checked={value.isBottomPublic} onChange={(c) => patch({ isBottomPublic: c })} />
          {canEnableAiGame && <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CheckRow label="开启 AI 主持" desc="" checked={value.enableAiGame} onChange={(c) => {
                patch({ enableAiGame: c });
                if (!c) setAdvSettingsOpen(false);
              }} />
              {value.enableAiGame && (
                <button
                  type="button"
                  className="shrink-0 text-xs font-semibold text-primary hover:underline"
                  onClick={() => setAdvSettingsOpen(true)}
                >
                  高级设置
                </button>
              )}
            </div>
            {value.enableAiGame && (
              <>
                <p className="pl-7 text-[11px] leading-5 text-muted">
                  仅无任何机制的汤建议开启 AI 主持，开启后用户如通关，可以直接获得汤底。
                </p>
                {aiAdvancedSettingsError && (
                  <button type="button" className="pl-7 text-left text-xs font-bold text-danger" onClick={() => setAdvSettingsOpen(true)}>
                    {aiAdvancedSettingsError}，点击检查
                  </button>
                )}
              </>
            )}
          </div>}
          <label className="flex items-center gap-2 text-xs leading-5 text-muted">
            <input className="h-4 w-4 shrink-0" type="checkbox" checked={termsAccepted} onChange={(e) => { setTermsAccepted(e.target.checked); if (e.target.checked) setTermsError(""); }} />
            <span className="flex min-h-11 flex-wrap items-center">
              勾选代表同意
              <button className="mx-1 inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline" type="button" onClick={() => setTermsOpen(true)}>用户使用条款</button>
            </span>
          </label>
          {termsError && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{termsError}</div>}
        </div>
          </div>
        </div>
        <footer className="soup-editor-footer shrink-0 border-t border-line bg-white px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-7 sm:py-4">
          <div className="mx-auto flex max-w-4xl items-center justify-end gap-3">
            <p className="mr-auto hidden text-xs leading-5 text-muted sm:block">发布前请确认必填内容及公开权限设置。</p>
            <button type="button" className="btn btn-secondary hidden min-w-28 sm:inline-flex" disabled={submitting} onClick={closeSoupEditor}>取消</button>
            <button className="btn btn-primary w-full sm:w-auto sm:min-w-44" disabled={submitting}>
              {submitting ? (editing ? "保存中…" : "发布中…") : (editing ? "保存修改" : "发布海龟汤")}
            </button>
          </div>
        </footer>
      </form>
      {termsOpen && <TermsModal onClose={() => setTermsOpen(false)} onAccept={() => { setTermsAccepted(true); setTermsError(""); setTermsOpen(false); }} />}
      {coverCropSource && (
        <CoverCropper
          source={coverCropSource}
          onCancel={() => setCoverCropSource(null)}
          onConfirm={(croppedDataUrl) => {
            patch({ coverImage: croppedDataUrl });
            setCoverCropSource(null);
            setCoverError("");
          }}
        />
      )}

      {/* 高级设置弹窗 */}
      {advSettingsOpen && (
        <Modal onClose={() => setAdvSettingsOpen(false)}>
          <div className="space-y-5 p-2 max-h-[80vh] overflow-auto">
            <h2 className="text-lg font-black text-ink">AI 高级设置</h2>

            {/* 进度关键点 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-bold text-ink">进度关键点</span>
                  <span className={`ml-2 text-xs font-bold ${keyFactsWeightValid ? "text-green-600" : "text-danger"}`}>
                    权重总和：{keyFactsTotalWeight}/100
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  onClick={addKeyFact}
                  disabled={value.keyFacts.length >= 20}
                >
                  <Plus size={14} className="mr-1" />添加关键点
                </button>
              </div>

              {value.keyFacts.map((kf) => (
                <div key={kf.id} className="flex gap-2 rounded-lg border border-line bg-page p-3">
                  <div className="flex-1 space-y-2">
                    <div>
                      <label className="text-[11px] font-bold text-muted">关键点</label>
                      <p className="text-[10px] text-muted">请以陈述句输入本故事的关键点，即盘到这个关键点则增长进度</p>
                      <input
                        className={`field mt-1 w-full text-sm ${!kf.content.trim() ? "border-red-400" : ""}`}
                        placeholder="如：凶手是父亲"
                        value={kf.content}
                        aria-invalid={!kf.content.trim()}
                        onChange={(e) => updateKeyFact(kf.id, "content", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-muted">提示内容</label>
                      <p className="text-[10px] text-muted">玩家请求 AI 提示时展示，请勿直接写出答案</p>
                      <div className="relative mt-1">
                        <textarea
                          className={`field min-h-20 w-full pb-7 text-base sm:text-sm ${!(kf.hintContent ?? "").trim() ? "border-red-400" : ""}`}
                          placeholder="如：留意人物之间被忽略的关系"
                          maxLength={50}
                          value={kf.hintContent ?? ""}
                          aria-invalid={!(kf.hintContent ?? "").trim()}
                          onChange={(e) => updateKeyFact(kf.id, "hintContent", e.target.value)}
                        />
                        <span className="pointer-events-none absolute bottom-2 right-3 text-xs text-muted">
                          {(kf.hintContent ?? "").length}/50
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-muted">进度值</label>
                      <p className="text-[10px] text-muted">请输入该关键点的进度值，总和应该为 100</p>
                      <input
                        className={`field mt-1 w-24 text-sm ${!Number.isInteger(kf.weight) || kf.weight < 1 || kf.weight > 99 ? "border-red-400" : ""}`}
                        type="number"
                        min={1}
                        max={99}
                        value={Number.isInteger(kf.weight) && kf.weight >= 1 ? kf.weight : ""}
                        aria-invalid={!Number.isInteger(kf.weight) || kf.weight < 1 || kf.weight > 99}
                        onWheel={(event) => event.currentTarget.blur()}
                        onChange={(e) => {
                          const input = e.target.value;
                          updateKeyFact(
                            kf.id,
                            "weight",
                            input === "" ? 0 : Math.max(1, Math.min(99, Number(input)))
                          );
                        }}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted hover:bg-red-50 hover:text-danger"
                    onClick={() => removeKeyFact(kf.id)}
                    aria-label={`删除第 ${value.keyFacts.findIndex((item) => item.id === kf.id) + 1} 个关键点`}
                    title="删除关键点"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}

              {value.keyFacts.length === 0 && (
                <p className={`py-4 text-center text-sm ${value.keyFactsCustomized ? "font-bold text-danger" : "text-muted"}`}>
                  {value.keyFactsCustomized
                    ? "手动管理关键点时至少保留 1 个关键点，当前状态无法保存。"
                    : "暂无自定义关键点，发布或开启 AI 主持后将由 AI 自动拆分关键点并填写提示内容。"}
                </p>
              )}

              {aiAdvancedSettingsError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-danger" role="alert">{aiAdvancedSettingsError}</p>
              )}
            </div>

            {/* 清除关键点 */}
            {value.keyFactsCustomized && editing && (
              <button
                type="button"
                className="btn btn-secondary w-full text-sm"
                onClick={() => setReanalyzeConfirmOpen(true)}
              >
                清除关键点
              </button>
            )}

            <div className="flex gap-2 pt-2">
              <button type="button" className="btn btn-secondary flex-1" onClick={() => setAdvSettingsOpen(false)}>返回</button>
              <button
                type="button"
                className="btn btn-primary flex-1"
                disabled={Boolean(aiAdvancedSettingsError)}
                onClick={() => setAdvSettingsOpen(false)}
              >
                完成
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 清除关键点确认弹窗 */}
      {reanalyzeConfirmOpen && (
        <Modal onClose={() => setReanalyzeConfirmOpen(false)}>
          <div className="space-y-4 p-2">
            <p className="text-sm font-bold text-ink">是否清除已保存的关键点？</p>
            <p className="text-xs text-muted">此操作会清除手动编辑的关键点及其提示内容；服务端随后会重新自动生成。</p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary flex-1" onClick={() => setReanalyzeConfirmOpen(false)}>取消</button>
              <button type="button" className="btn btn-primary flex-1" onClick={handleReanalyze}>确认</button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
