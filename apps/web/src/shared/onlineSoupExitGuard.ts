import { useCallback, useEffect, useRef } from "react";

type GuardPage = "room" | "detail" | "selector";

export function useOnlineSoupExitGuard(roomId: string, enabled: boolean, page: GuardPage) {
  const disarmedRef = useRef(false);
  const unloadingRef = useRef(false);
  const pendingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const markUnloading = () => { unloadingRef.current = true; };
    window.addEventListener("beforeunload", markUnloading);
    return () => window.removeEventListener("beforeunload", markUnloading);
  }, []);

  useEffect(() => {
    if (pendingTimerRef.current != null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    return () => {
      pendingTimerRef.current = window.setTimeout(() => {
        pendingTimerRef.current = null;
        if (!enabled || !roomId || disarmedRef.current || unloadingRef.current) return;
        const roomPath = `/online-soup/rooms/${roomId}`;
        const pathname = window.location.pathname.replace(/\/+$/, "");
        const returnsToRoom = pathname === roomPath;
        const remainsInRoomFlow = page === "room"
          && (pathname === `${roomPath}/select-soup` || pathname.startsWith("/soup/") || pathname.startsWith("/users/"));
        if (returnsToRoom || remainsInRoomFlow) return;
        void fetch(`/api/online-soup/rooms/${encodeURIComponent(roomId)}/leave`, {
          method: "POST",
          credentials: "include",
          keepalive: true
        });
      }, 0);
    };
  }, [enabled, page, roomId]);

  return useCallback(() => {
    disarmedRef.current = true;
  }, []);
}
