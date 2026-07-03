import { Outlet, useLocation } from "react-router-dom";
import { BottomNav } from "../components/BottomNav";

export default function MainLayout() {
  const location = useLocation();
  const path = location.pathname;

  // Hide BottomNav on detail page, but include "soup/" prefix for home tab active state
  const hideBottomNav = path.startsWith("/soup/");

  // home, mine, mine/* 用 PageTopBar 自行渲染 header
  // 这些页面的 header 由各自页面组件内部的 PageTopBar 处理

  return (
    <>
      <main className="mx-auto max-w-6xl px-4 pt-[72px] pb-28">
        <Outlet />
      </main>
      {!hideBottomNav && <BottomNav />}
    </>
  );
}
