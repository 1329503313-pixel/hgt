import { useCallback, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import type { OnlineSoupSnapshot } from "../shared/types";
import type { ImpostorActions } from "../shared/useImpostorActions";
import { impostorActionLabels } from "../shared/impostorActions";
import { ImpostorChatActionCard } from "./ImpostorGamePanel";
import { Modal } from "./Modal";

type Props = {
  actions: ImpostorActions;
  members: OnlineSoupSnapshot["members"];
  currentUserId: string;
};
export function ImpostorActionDialog(props: Props) {
  return props.actions.dialogOpen ? <ImpostorActionDialogContent {...props} /> : null;
}
function ImpostorActionDialogContent({ actions, members, currentUserId }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ saving: actions.saving, onClose: actions.closeDialog });
  latest.current = { saving: actions.saving, onClose: actions.closeDialog };
  const close = useCallback(() => { if (!latest.current.saving) latest.current.onClose(); }, []);
  const titleId = useId();
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  const title = actions.pending ? impostorActionLabels[actions.pending] : "本轮操作";
  return <Modal hideCloseButton overlayClassName="!z-[120] bg-slate-900/50" onClose={close}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="outline-none" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "Tab") {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),[tabindex="0"]'));
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="flex items-center justify-between gap-3"><h2 id={titleId} className="text-lg font-black text-ink">{title}</h2><button type="button" className="btn btn-secondary min-h-11 min-w-11" disabled={actions.saving} aria-label="关闭操作弹框" onClick={close}><X size={18} /></button></div>
      <ImpostorChatActionCard actions={actions} members={members} currentUserId={currentUserId} />
    </div>
  </Modal>;
}
