import { ArrowLeft, Bell, LogOut, Shield } from "lucide-react";
import type { PublicUser } from "../shared/types";
import { useApp } from "../context/AppContext";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export function PageTopBar({ title, unread = 0, backTo }: { title: string; unread?: number; backTo?: string }) {
  const { user } = useApp();
  const navigate = useNavigate();

  return (
    <div className="top-nav-shell">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2.5">
        <button className="min-h-10 min-w-0 shrink-0 text-left" type="button" onClick={() => navigate("/")}>
          <h1 className="truncate text-[22px] font-black leading-none text-ink sm:text-[24px]">{title}</h1>
        </button>
        <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
          {user ? (
            <>
              <UserMenuDropdown user={user} />
              {backTo ? (
                <button className="grid h-10 w-10 place-items-center rounded-full bg-white text-ink shadow-soft" onClick={() => navigate(backTo)} aria-label="返回">
                  <ArrowLeft size={20} />
                </button>
              ) : (
                <button className="relative grid h-10 w-10 place-items-center rounded-full bg-white text-ink shadow-soft" onClick={() => navigate("/messages")} aria-label="消息">
                  <Bell size={20} />
                  {unread > 0 && (
                    <span className="absolute right-1.5 top-0 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </button>
              )}
              {user.role === "admin" && (
                <button className="hidden h-10 w-10 place-items-center rounded-full bg-white text-primary shadow-soft sm:grid" onClick={() => navigate("/admin")} aria-label="后台">
                  <Shield size={19} />
                </button>
              )}
            </>
          ) : (
            <LoginButton />
          )}
        </div>
      </div>
    </div>
  );
}

function UserMenuDropdown({ user }: { user: PublicUser }) {
  const { setUser, showToast, triggerRefresh } = useApp();
  const navigate = useNavigate();

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    showToast("已退出登录");
    triggerRefresh();
    navigate("/");
  }

  return (
    <details className="user-menu">
      <summary className="avatar-name-gap flex min-h-10 min-w-0 cursor-pointer list-none items-center rounded-full bg-white px-2 shadow-soft sm:px-2.5 sm:py-1.5">
        {user.avatar ? (
          <img className="h-7 w-7 shrink-0 rounded-full object-cover" src={user.avatar} alt="" />
        ) : (
          <div className="hidden h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-100 text-sm font-black text-primary sm:grid">
            {(user.nickname || user.username).slice(0, 1)}
          </div>
        )}
        <span className="max-w-[52px] truncate text-[13px] font-semibold text-ink sm:max-w-24 sm:text-sm">
          {(user.nickname || user.username).slice(0, 8)}
        </span>
      </summary>
      <div className="user-menu-panel left-0 top-[calc(100%+8px)] sm:left-auto sm:right-0">
        <button className="user-menu-item" onClick={logout}>
          <LogOut size={17} />
          退出登录
        </button>
      </div>
    </details>
  );
}

function LoginButton() {
  const { openAuth } = useApp();
  return (
    <button className="btn btn-primary rounded-full px-5" onClick={openAuth}>
      登录
    </button>
  );
}
