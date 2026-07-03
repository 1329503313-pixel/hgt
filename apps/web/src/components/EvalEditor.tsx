import { FormEvent } from "react";
import type { EvalForm } from "../context/AppContext";
import { Modal } from "./Modal";
import { ScoreInput } from "./FormWidgets";
import { useApp } from "../context/AppContext";
import { api } from "../api";

export function EvalEditor() {
  const { evalForm: value, setEvalForm: setValue, soupIdForEval, closeEvalEditor, showToast } = useApp();

  const patch = (next: Partial<EvalForm>) => setValue({ ...value, ...next });

  const totalScoreGuide = [
    "1分（较差）：有点王八，逻辑不顺，文意不清，汤面汤底不合理",
    "2分（能玩）：不是王八汤，逻辑相对通顺，一般般",
    "3分（推荐）：逻辑通顺合理，有点意思，愿意拿去给别人玩",
    "4分（精品）：逻辑严谨、故事优秀、机制新奇，在玩过的海龟汤中能排进前20%",
    "5分（神作）：逻辑缜密、故事反转或机制很吸引人，汤底反推汤面基本是最优解，有一定深度，在玩过的海龟汤中能排进前5%"
  ];

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/api/soups/${soupIdForEval}/evaluations`, { method: "POST", body: value });
      closeEvalEditor();
      showToast("评价已保存");
      // Reload the detail page
      window.location.href = `/soup/${soupIdForEval}`;
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存失败");
    }
  }

  return (
    <Modal onClose={closeEvalEditor}>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <h2 className="text-xl font-black text-ink">编辑评价</h2>
          <p className="mt-1 text-sm text-muted">总评分必填，六维评分可选。</p>
        </div>
        <ScoreInput label="总评分" value={value.total} onChange={(v) => patch({ total: v })} guide={totalScoreGuide} required />
        <div className="grid gap-3 sm:grid-cols-2">
          <ScoreInput label="文笔" desc="本汤汤面、汤底文笔如何" value={value.writing} onChange={(v) => patch({ writing: v })} />
          <ScoreInput label="逻辑" desc="本汤汤面、汤底逻辑闭环如何" value={value.logic} onChange={(v) => patch({ logic: v })} />
          <ScoreInput label="分享性" desc="你把本汤分享给其他人玩的意愿如何" value={value.share} onChange={(v) => patch({ share: v })} />
          <ScoreInput label="机制" desc="本汤机制的可玩性、好玩性如何（非机制汤为0）" value={value.mechanism} onChange={(v) => patch({ mechanism: v })} />
          <ScoreInput label="反转" desc="本汤汤底对于汤面的反转与震撼程度如何" value={value.twist} onChange={(v) => patch({ twist: v })} />
          <ScoreInput label="深度" desc="本汤故事立意深度如何" value={value.depth} onChange={(v) => patch({ depth: v })} />
        </div>
        <label className="space-y-1">
          <span className="label">评价内容</span>
          <textarea className="field min-h-24" style={{ minHeight: 96 }} placeholder="说说你对这条海龟汤的看法（选填，最多500字）" maxLength={500} value={value.content} onChange={(e) => patch({ content: e.target.value })} />
          <span className="text-xs text-muted">剩余 {500 - value.content.length} 字</span>
        </label>
        <button className="btn btn-primary w-full">保存评价</button>
      </form>
    </Modal>
  );
}
