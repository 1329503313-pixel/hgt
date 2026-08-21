import { CircleSlash2 } from "lucide-react";

export function MutedAvatarIndicator({ size = "md" }: { size?: "sm" | "md" }) {
  const dimensions = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return <span
    className={`absolute -bottom-0.5 -right-0.5 z-10 grid ${dimensions} place-items-center rounded-full bg-red-500 text-white ring-2 ring-white`}
    aria-label="已被禁言"
    title="已被禁言"
  ><CircleSlash2 size={size === "sm" ? 10 : 12} strokeWidth={3} aria-hidden="true" /></span>;
}
