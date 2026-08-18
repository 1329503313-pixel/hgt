import { useEffect, useState } from "react";
import { VipIcon, VipName } from "./VipVisuals";
import { subscribeServerEvent } from "../shared/serverEvents";
import type { VipLevel } from "../shared/types";

type PresencePayload = {
  userId: string;
  online: boolean;
  nickname?: string;
  vipLevel?: VipLevel;
  vipActive?: boolean;
};

export function VipOnlineBanner() {
  const [current, setCurrent] = useState<PresencePayload | null>(null);
  useEffect(() => {
    const unsubscribe = subscribeServerEvent("presence_changed", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as PresencePayload;
        if (payload.online && payload.vipActive && Number(payload.vipLevel) >= 7 && payload.nickname) setCurrent(payload);
      } catch { /* ignore malformed server events */ }
    });
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => setCurrent(null), 3000);
    return () => window.clearTimeout(timer);
  }, [current]);
  if (!current) return null;
  return (
    <div className="vip-online-banner" role="status" aria-live="polite">
      <VipIcon level={current.vipLevel ?? 0} active animated className="h-6 w-6 shrink-0" />
      <span>尊贵的 <VipName nickname={`VIP${current.vipLevel}用户${current.nickname}`} level={current.vipLevel ?? 0} active className="inline-flex" /> 上线了</span>
    </div>
  );
}
