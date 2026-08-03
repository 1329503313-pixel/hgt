import { User } from "lucide-react";
import type { Evaluation } from "../shared/types";
import { EquippedBadgeIcon } from "./BadgeVisuals";
import { LevelBadge } from "./LevelBadge";

export function EvaluationCard({ evaluation, compact = false }: { evaluation: Evaluation; compact?: boolean }) {
  return (
    <article className={`detail-evaluation-item rounded-xl border border-line bg-slate-50 p-4 ${compact ? "detail-evaluation-item-compact" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          {evaluation.reviewerAvatar ? (
            <img className="h-6 w-6 shrink-0 rounded-full object-cover" src={evaluation.reviewerAvatar} alt={`${evaluation.reviewer}头像`} />
          ) : (
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-100 text-primary"><User size={14} /></span>
          )}
          <strong className="truncate">{evaluation.reviewer}</strong>
          <LevelBadge level={evaluation.reviewerLevel} />
          <EquippedBadgeIcon badge={evaluation.reviewerEquippedBadge} className="h-5 w-5" />
          {evaluation.isCreatorEvaluation ? (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">上传者评价 · 仅展示</span>
          ) : !evaluation.countsTowardScore ? (
            <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600">未计入评分</span>
          ) : null}
        </span>
        <span className="shrink-0 rounded-lg bg-blue-50 px-2 py-1 text-sm font-black text-primary">{evaluation.total}</span>
      </div>
      {evaluation.content && (
        <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 text-ink ${compact ? "line-clamp-3" : ""}`}>
          {evaluation.content}
        </p>
      )}
      <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1.5 text-xs text-muted">
        <span>文笔 {evaluation.writing ?? "-"}</span>
        <span>逻辑 {evaluation.logic ?? "-"}</span>
        <span>分享 {evaluation.share ?? "-"}</span>
        <span>机制 {evaluation.mechanism ?? "-"}</span>
        <span>反转 {evaluation.twist ?? "-"}</span>
        <span>深度 {evaluation.depth ?? "-"}</span>
      </div>
      {!compact && (
        <time className="mt-3 block text-xs text-muted/70">
          {new Date(evaluation.createdAt).toLocaleString("zh-CN", { hour12: false })}
        </time>
      )}
    </article>
  );
}
