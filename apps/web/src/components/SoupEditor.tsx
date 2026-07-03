import { FormEvent, useState } from "react";
import { ArrowLeft, ImagePlus, Plus, Trash2, X } from "lucide-react";
import type { SoupForm } from "../context/AppContext";
import { soupTypes } from "../context/AppContext";
import { Modal } from "./Modal";
import { CheckRow } from "./FormWidgets";
import { useApp } from "../context/AppContext";
import { api } from "../api";

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
    <div className="fixed inset-0 z-50 flex items-end bg-slate-900/35 p-0 sm:items-center sm:justify-center sm:p-4">
      <div className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-t-lg bg-white p-5 shadow-soft sm:rounded-[20px]">
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
  const { user, soupForm: value, setSoupForm: setValue, editingSoupId, closeSoupEditor, showToast } = useApp();
  const editing = Boolean(editingSoupId);

  const [termsAccepted, setTermsAccepted] = useState(editing);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsError, setTermsError] = useState("");
  const [coverError, setCoverError] = useState("");

  const authorName = user?.nickname || user?.username || "";

  const patch = (next: Partial<SoupForm>) => setValue({ ...value, ...next });

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
    reader.onload = () => patch({ coverImage: String(reader.result) });
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
    if (!termsAccepted) { setTermsError("请先勾选同意用户使用条款"); return; }
    setTermsError("");

    const method = editing ? "PUT" : "POST";
    const path = editing ? `/api/soups/${editingSoupId}` : "/api/soups";
    const payload = {
      ...value,
      supplementalSurfaces: value.supplementalSurfaces.map((s: string) => s.trim()).filter(Boolean),
      supplementalBottoms: value.supplementalBottoms.map((s: string) => s.trim()).filter(Boolean),
      author: value.isOriginal ? value.author : "佚名"
    };

    try {
      const result = await api<{ id?: string }>(path, { method, body: payload });
      closeSoupEditor();
      showToast(editing ? "已更新" : "已发布");
      // Navigate to detail
      const { useNavigate } = await import("react-router-dom");
      window.location.href = `/soup/${editing ? editingSoupId : result.id}`;
    } catch (e) {
      showToast(e instanceof Error ? e.message : "操作失败");
    }
  }

  return (
    <Modal full onClose={closeSoupEditor}>
      <form className="space-y-4 pb-24" onSubmit={handleSubmit}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <button type="button" className="mb-2 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-muted" onClick={closeSoupEditor}>
              <ArrowLeft size={17} /> 返回
            </button>
            <h2 className="text-xl font-black text-ink">{editing ? "编辑海龟汤" : "新建海龟汤"}</h2>
            <p className="mt-1 text-sm text-muted">支持文本内容与 JPG/PNG 封面。</p>
          </div>
        </div>
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
          {value.isOriginal && (
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
                <img className="max-h-56 w-full rounded-lg object-cover" src={value.coverImage} alt="封面预览" />
                <div className="grid grid-cols-2 gap-2">
                  <label className="btn btn-secondary cursor-pointer">
                    更换封面
                    <input className="hidden" type="file" accept="image/jpeg,image/png" onChange={(e) => handleCoverUpload(e.target.files?.[0])} />
                  </label>
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
          <label className="flex items-center gap-2 text-xs leading-5 text-muted">
            <input className="h-4 w-4 shrink-0" type="checkbox" checked={termsAccepted} onChange={(e) => { setTermsAccepted(e.target.checked); if (e.target.checked) setTermsError(""); }} />
            <span className="flex min-h-11 flex-wrap items-center">
              勾选代表同意
              <button className="mx-1 inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline" type="button" onClick={() => setTermsOpen(true)}>用户使用条款</button>
            </span>
          </label>
          {termsError && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{termsError}</div>}
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(17,24,39,0.07)] backdrop-blur">
          <div className="mx-auto max-w-3xl">
            <button className="btn btn-primary w-full">{editing ? "保存修改" : "发布"}</button>
          </div>
        </div>
      </form>
      {termsOpen && <TermsModal onClose={() => setTermsOpen(false)} onAccept={() => { setTermsAccepted(true); setTermsError(""); setTermsOpen(false); }} />}
    </Modal>
  );
}
