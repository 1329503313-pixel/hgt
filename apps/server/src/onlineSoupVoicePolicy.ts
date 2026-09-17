export const VOICE_VERSION = "1";
export const VOICE_TICKET_SECONDS = 60;
export function voicePrivileges(muted: boolean) { return muted ? 11 : 15; }
export function voiceAvailable(config: { enabled: boolean; sdkAppId: number; sdkSecret: string; secretId: string; secretKey: string; advancedPermission: boolean }) {
  return config.enabled && config.advancedPermission && Number.isSafeInteger(config.sdkAppId) && config.sdkAppId > 0
    && Boolean(config.sdkSecret && config.secretId && config.secretKey);
}
/** Keep occupied player positions stable; hosts never occupy a player position. */
export function assignVoiceSeats(members: Array<{ id: string; role: string; seat: number | null }>) {
  const occupied = new Set<number>();
  const reserved = new Set(members.filter(m => m.role === "player" && m.seat != null && m.seat >= 1 && m.seat <= 10).map(m => m.seat));
  return members.map(member => {
    if (member.role !== "player") return { ...member, seat: null };
    let seat = member.seat;
    if (seat == null || seat < 1 || seat > 10 || occupied.has(seat)) {
      seat = Array.from({ length: 10 }, (_, i) => i + 1).find(value => !occupied.has(value) && !reserved.has(value)) ?? null;
    }
    if (seat != null) occupied.add(seat);
    return { ...member, seat };
  });
}
