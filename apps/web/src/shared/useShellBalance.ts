import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { ShellTaskCenter } from "./types";
import { subscribeServerEvent } from "./serverEvents";

const SHELL_BALANCE_UPDATED_EVENT = "hgt:shell-balance-updated";

type ShellBalanceUpdatedDetail = {
  userId: string;
  balance: number;
};

export function publishShellBalance(userId: string | undefined, balance: number) {
  if (!userId || typeof window === "undefined" || !Number.isFinite(balance)) return;
  window.dispatchEvent(new CustomEvent<ShellBalanceUpdatedDetail>(SHELL_BALANCE_UPDATED_EVENT, {
    detail: { userId, balance }
  }));
}

export function useShellBalance(userId: string | undefined) {
  const [balance, setBalance] = useState<number | null>(null);
  const updateVersionRef = useRef(0);

  useEffect(() => {
    if (!userId) {
      setBalance(null);
      return;
    }

    let active = true;
    setBalance(null);
    const handleBalanceUpdate = (event: Event) => {
      const detail = (event as CustomEvent<ShellBalanceUpdatedDetail>).detail;
      if (!detail || detail.userId !== userId) return;
      updateVersionRef.current += 1;
      setBalance(detail.balance);
    };
    window.addEventListener(SHELL_BALANCE_UPDATED_EVENT, handleBalanceUpdate);
    const loadBalance = () => {
      const version = updateVersionRef.current;
      void api<ShellTaskCenter>("/api/me/shells", { bypassCache: true, dedupe: false })
        .then((data) => {
          if (active && updateVersionRef.current === version) setBalance(data.balance);
        })
        .catch(() => {
          if (active && updateVersionRef.current === version) setBalance(null);
        });
    };
    loadBalance();
    const unsubscribe = subscribeServerEvent("unread_changed", (event) => {
      try {
        const payload = JSON.parse(event.data) as { source?: string };
        if (payload.source === "badge_unlock" || payload.source === "shell_adjustment" || payload.source === "gift_received" || payload.source === "collectible_bid" || payload.source === "collectible_outbid") loadBalance();
      } catch {
        // A later event or remount will reconcile the balance.
      }
    });
    const unsubscribeBalance = subscribeServerEvent("shell_balance_changed", (event) => {
      try {
        const payload = JSON.parse(event.data) as { balance?: unknown };
        const nextBalance = typeof payload.balance === "number" ? payload.balance : Number.NaN;
        if (!Number.isFinite(nextBalance)) return;
        updateVersionRef.current += 1;
        setBalance(nextBalance);
      } catch {
        loadBalance();
      }
    });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeBalance();
      window.removeEventListener(SHELL_BALANCE_UPDATED_EVENT, handleBalanceUpdate);
    };
  }, [userId]);

  return balance;
}
