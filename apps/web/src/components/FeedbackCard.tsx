import { FormEvent, useRef, useState } from "react";
import { ChevronRight, ImagePlus, MessageSquarePlus, X } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Modal } from "./Modal";

type FeedbackType = "bug" | "feature" | "activity";

export function FeedbackCard() {
  const { showToast } = useApp();
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<FeedbackType | "">("");
  const [content, setContent] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotName, setScreenshotName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setTitle("");
    setType("");
    setContent("");
    setScreenshot(null);
    setScreenshotName("");
    if (screenshotInputRef.current) screenshotInputRef.current.value = "";
  }

  function close() {
    if (submitting) return;
    setOpen(false);
    resetForm();
  }

  async function selectScreenshot(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      showToast("截图仅支持 JPG、PNG 或 WebP");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast("截图不能超过 5MB");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("截图读取失败"));
        reader.readAsDataURL(file);
      });
      setScreenshot(dataUrl);
      setScreenshotName(file.name);
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      if (screenshotInputRef.current) screenshotInputRef.current.value = "";
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    const normalizedContent = content.trim();
    if (!normalizedTitle) return showToast("请填写意见标题");
    if (!type) return showToast("请选择意见类型");
    if (!normalizedContent) return showToast("请填写意见内容");

    setSubmitting(true);
    try {
      await api("/api/me/feedback", {
        method: "POST",
        body: { title: normalizedTitle, type, content: normalizedContent, screenshot }
      });
      setOpen(false);
      resetForm();
      showToast("感谢反馈，建议已提交");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button type="button" className="card flex w-full items-center gap-3 p-4 text-left" onClick={() => setOpen(true)}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600">
          <MessageSquarePlus size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black text-ink">建议与意见</span>
          <span className="mt-0.5 block text-xs text-muted">反馈问题或告诉我们你期待的新功能</span>
        </span>
        <ChevronRight className="shrink-0 text-muted" size={19} />
      </button>

      {open && (
        <Modal onClose={close}>
          <form className="space-y-4" onSubmit={submit}>
            <div>
              <h2 className="text-xl font-black text-ink">建议与意见</h2>
              <p className="mt-1 text-sm text-muted">前三项为必填，截图可选填。</p>
            </div>

            <label className="block space-y-2">
              <span className="label">意见标题</span>
              <input
                className="field"
                maxLength={100}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="请简要概括你的意见"
                required
              />
              <span className="block text-right text-xs text-muted">{title.length}/100</span>
            </label>

            <label className="block space-y-2">
              <span className="label">意见类型</span>
              <select className="field" value={type} onChange={(event) => setType(event.target.value as FeedbackType | "")} required>
                <option value="">请选择意见类型</option>
                <option value="bug">BUG反馈</option>
                <option value="feature">功能建议</option>
                <option value="activity">活动建议</option>
              </select>
            </label>

            <label className="block space-y-2">
              <span className="label">意见内容</span>
              <textarea
                className="field min-h-36 resize-y py-3"
                maxLength={5000}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="请详细描述遇到的问题或你的建议"
                required
              />
              <span className="block text-right text-xs text-muted">{content.length}/5000</span>
            </label>

            <div className="space-y-2">
              <span className="label">上传截图（选填）</span>
              {screenshot ? (
                <div className="overflow-hidden rounded-xl border border-line bg-slate-50">
                  <img className="max-h-64 w-full object-contain" src={screenshot} alt="待上传截图预览" />
                  <div className="flex items-center gap-2 border-t border-line px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-muted">{screenshotName}</span>
                    <button type="button" className="inline-flex items-center gap-1 text-xs font-bold text-danger" onClick={() => { setScreenshot(null); setScreenshotName(""); }}>
                      <X size={14} />移除
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn btn-secondary w-full" onClick={() => screenshotInputRef.current?.click()}>
                  <ImagePlus size={17} />选择截图
                </button>
              )}
              <input
                ref={screenshotInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => void selectScreenshot(event.target.files?.[0])}
              />
              <p className="text-xs text-muted">支持 JPG、PNG、WebP，最大 5MB</p>
            </div>

            <button className="btn btn-primary w-full" disabled={submitting}>
              {submitting ? "提交中……" : "提交意见"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
