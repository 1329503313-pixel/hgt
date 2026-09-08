export const CARD_BATTLE_RANKINGS_PATH = "/mine/rankings";
export const CARD_BATTLE_RANKINGS_STATE = { tab: "card_battle" } as const;

/** HTTP confirmation and the room-closed socket event must resolve to the same page. */
export function cardBattleRoomExit(rankingChallenge: unknown) {
  return rankingChallenge
    ? { to: CARD_BATTLE_RANKINGS_PATH, options: { replace: true, state: CARD_BATTLE_RANKINGS_STATE } }
    : { to: "/online-soup", options: { replace: true } };
}
