import type { CardBattleTier } from "./digitalAssets";
import type { OnlineCardBattleCardState, OnlineCardBattleEvent, OnlineCardBattleState } from "./types";

export type BossCard = { name: string; imageUrl: string; tier: CardBattleTier };
export type CardBattleBoss = {
  roomId: string; code: string; name: string; enabled: boolean;
  startsAt: string; endsAt: string; rewardShells: number;
  revision: number; available: boolean; cards: Array<BossCard | null>; battleCount?: number;
};
export type BossBattleRecord = {
  id: string; gameNumber: number; startedAt: string;
  status: "playing" | "ended" | "aborted"; outcome: "playing" | "aborted" | "won" | "lost";
  players: Array<{ userId: string; nickname: string; forfeited: boolean; reward: number | null }>;
};
export type BossReplay = {
  gameId: string; gameNumber: number; name: string;
  lineups: NonNullable<OnlineCardBattleState["game"]>["lineups"];
  result: NonNullable<NonNullable<OnlineCardBattleState["game"]>["settlement"]> & {
    initialStates: OnlineCardBattleCardState[]; finalStates: OnlineCardBattleCardState[];
    events: OnlineCardBattleEvent[]; playbackDurationMs: number;
  };
};
export const bossSlotNames = ["前排卡 1", "前排卡 2", "后排卡 1", "后排卡 2", "后排卡 3"];
export function bossDateInput(iso: string) { return new Date(Date.parse(iso) + 8 * 60 * 60_000).toISOString().slice(0, 16); }
export function bossDateIso(local: string) { return new Date(`${local}:00+08:00`).toISOString(); }
