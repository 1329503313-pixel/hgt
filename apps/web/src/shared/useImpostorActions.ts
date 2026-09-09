import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { OnlineImpostorGame } from "./types";
import { impostorActionKey, impostorActionPaths, pendingImpostorAction, submittedImpostorGame } from "./impostorActions";

type NightAction = NonNullable<OnlineImpostorGame["me"]>["nightActionTypes"][number];
type Draft = { key: string; selectedTargets: string[]; selectedAction: NightAction | null; clue: string };

export function useImpostorActions({ roomId, game, currentUserId, onChanged, showToast }: {
  roomId: string;
  game: OnlineImpostorGame | null | undefined;
  currentUserId: string;
  onChanged: () => void | Promise<void>;
  showToast: (message: string) => void;
}) {
  const key = impostorActionKey(roomId, currentUserId, game);
  const [draft, setDraft] = useState<Draft>({ key, selectedTargets: [], selectedAction: null, clue: "" });
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(false);
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  const [dialogKey, setDialogKey] = useState<string | null>(null);
  const savingRef = useRef(false);
  const submittedKeyRef = useRef<string | null>(null);
  const currentKeyRef = useRef(key);
  currentKeyRef.current = key;
  const effectiveGame = game && submittedKey === key ? submittedImpostorGame(game) : game ?? null;
  const pending = pendingImpostorAction(effectiveGame, currentUserId, now);
  const currentDraft = draft.key === key ? draft : { key, selectedTargets: [], selectedAction: null, clue: "" };
  const dialogOpen = dialogKey === key && Boolean(pending);

  useEffect(() => {
    // Clear secrets across phases, rounds, rooms and accounts; don't restore old drafts.
    setDraft({ key, selectedTargets: [], selectedAction: null, clue: "" });
    setSubmittedKey(null); submittedKeyRef.current = null;
  }, [key]);
  useEffect(() => {
    setNow(Date.now());
    if (!game?.deadlineAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [key, game?.deadlineAt]);
  useEffect(() => {
    if (!pending || dialogKey !== key) setDialogKey(null);
  }, [dialogKey, key, pending]);

  function updateDraft(update: (current: Draft) => Draft) {
    if (savingRef.current || !pendingImpostorAction(effectiveGame, currentUserId, Date.now())) return;
    setDraft((current) => update(current.key === key ? current : { key, selectedTargets: [], selectedAction: null, clue: "" }));
  }
  function setSelectedAction(selectedAction: NightAction) {
    updateDraft((current) => ({ ...current, selectedAction, selectedTargets: [] }));
  }
  function setClue(clue: string) { updateDraft((current) => ({ ...current, clue: Array.from(clue).slice(0, 10).join("") })); }
  function toggleTarget(userId: string, limit: number) {
    if (limit < 1) return;
    updateDraft((current) => ({ ...current, selectedTargets: current.selectedTargets.includes(userId)
      ? current.selectedTargets.filter((id) => id !== userId)
      : current.selectedTargets.length < limit ? [...current.selectedTargets, userId] : [...current.selectedTargets.slice(1), userId] }));
  }
  async function submit(path: string, body?: object) {
    const pending = pendingImpostorAction(effectiveGame, currentUserId, Date.now());
    if (savingRef.current || submittedKeyRef.current === key || !pending || path !== impostorActionPaths[pending]) return;
    savingRef.current = true; setSaving(true);
    try {
      await api(`/api/online-soup/rooms/${roomId}/${path}`, { method: "POST", ...(body === undefined ? {} : { body }) });
      if (currentKeyRef.current !== key) return;
      submittedKeyRef.current = key; setSubmittedKey(key);
      try { await onChanged(); }
      catch { showToast("操作已提交，状态同步暂时失败，请稍后刷新"); }
    } catch (error) {
      if (currentKeyRef.current === key) showToast(error instanceof Error ? error.message : "操作失败，请稍后重试");
    } finally { savingRef.current = false; setSaving(false); }
  }

  function openDialog() { if (!savingRef.current && pending) setDialogKey(key); }
  function closeDialog() { if (!savingRef.current) setDialogKey(null); }
  return { ...currentDraft, game: effectiveGame, key, pending, saving, now, dialogOpen, openDialog, closeDialog, setSelectedAction, setClue, toggleTarget, submit };
}

export type ImpostorActions = ReturnType<typeof useImpostorActions>;
