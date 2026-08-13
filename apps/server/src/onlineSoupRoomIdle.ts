export const ONLINE_SOUP_SINGLE_USER_IDLE_MINUTES = 15;

type OnlineSoupRoomIdleState = {
  status: string;
  activeUserCount: number;
  lastActionAt: Date;
  lastMemberTransitionAt?: Date | null;
};

export function shouldAutoCloseIdleOnlineSoupRoom(
  state: OnlineSoupRoomIdleState,
  now = new Date(),
) {
  if (state.status !== "preparing" || state.activeUserCount !== 1) return false;
  const latestActivityAt = Math.max(
    state.lastActionAt.getTime(),
    state.lastMemberTransitionAt?.getTime() ?? 0,
  );
  const idleCutoff = now.getTime() - ONLINE_SOUP_SINGLE_USER_IDLE_MINUTES * 60_000;
  return latestActivityAt <= idleCutoff;
}
