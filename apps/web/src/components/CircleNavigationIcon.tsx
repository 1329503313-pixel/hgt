import { CircleEllipsis } from "lucide-react";

export type CircleNavigationStatus = "red_packet" | "mention" | "unread" | null;

export function circleNavigationStatus({
  hasUnclaimedRedPacket,
  hasUnreadMention,
  hasUnreadMessage = false
}: {
  hasUnclaimedRedPacket: boolean;
  hasUnreadMention: boolean;
  hasUnreadMessage?: boolean;
}): CircleNavigationStatus {
  if (hasUnclaimedRedPacket) return "red_packet";
  if (hasUnreadMention) return "mention";
  if (hasUnreadMessage) return "unread";
  return null;
}

function RedPacketOutline({ size }: { size: number }) {
  return <svg
    width={size}
    height={size}
    viewBox="0 0 12 12"
    fill="none"
    aria-hidden="true"
    style={{ color: "#ef4444", filter: "none", transform: "none", transition: "none" }}
  >
    <rect x="1.25" y="0.75" width="9.5" height="10.5" rx="2" fill="white" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2 3.75 5 5.7a1.8 1.8 0 0 0 2 0l3-1.95" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="6" cy="5.65" r="1.05" fill="white" stroke="currentColor" strokeWidth="1.2" />
  </svg>;
}

export function CircleNavigationIcon({
  status,
  size = 20
}: {
  status: CircleNavigationStatus;
  size?: number;
}) {
  const markSize = Math.max(10, Math.round(size * 0.52));
  return <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
    <CircleEllipsis size={size} />
    {status === "red_packet" ? (
      <span className="absolute -right-[3px] -top-[3px] grid place-items-center text-red-500" aria-hidden="true">
        <RedPacketOutline size={markSize} />
      </span>
    ) : status === "mention" ? (
      <span className="absolute -right-[3px] -top-[3px] grid h-[11px] min-w-[11px] place-items-center text-[11px] font-black leading-none text-red-500" aria-hidden="true">@</span>
    ) : status === "unread" ? (
      <span className="absolute -right-[3px] -top-[2px] h-2.5 w-2.5 rounded-full border border-white bg-red-500" aria-hidden="true" />
    ) : null}
  </span>;
}
