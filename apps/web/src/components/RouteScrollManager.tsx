import { useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

function scrollWindowToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  // 兼容部分旧版 iOS/微信 WebView 未正确响应 window.scrollTo 的情况。
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

export function RouteScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();

  useLayoutEffect(() => {
    // POP 交给浏览器恢复历史位置；新进入或替换的页面统一从顶部展示。
    if (navigationType === "POP") return;
    scrollWindowToTop();
    const frame = window.requestAnimationFrame(scrollWindowToTop);
    return () => window.cancelAnimationFrame(frame);
  }, [location.key, navigationType]);

  return null;
}
