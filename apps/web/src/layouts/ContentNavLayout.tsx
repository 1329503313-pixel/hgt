import { Outlet, useLocation } from "react-router-dom";
import { DesktopModuleHeader, type DesktopModuleKey } from "../components/DesktopModuleHeader";

function routeMeta(path: string): { active: DesktopModuleKey; title: string; eyebrow: string } {
  if (/^\/soup\/[^/]+$/.test(path)) {
    return { active: "mine", title: "阅读完整故事，发现汤面背后的真相", eyebrow: "海龟汤详情 · STORY" };
  }
  if (/^\/users\/[^/]+\/(following|followers)$/.test(path)) {
    return { active: "mine", title: "查看社区关系与在线伙伴", eyebrow: "用户关系 · CONNECTIONS" };
  }
  return { active: "mine", title: "了解创作者与他的故事收藏", eyebrow: "用户主页 · CREATOR PROFILE" };
}

export default function ContentNavLayout() {
  const location = useLocation();
  const meta = routeMeta(location.pathname);

  return (
    <>
      <DesktopModuleHeader key={location.pathname} {...meta} />
      <main className="desktop-content-route-layout">
        <Outlet />
      </main>
    </>
  );
}
