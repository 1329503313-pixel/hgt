import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { siteContentDocuments } from "../shared/siteContent";

function isFocusedWorkspace(pathname: string) {
  return pathname === "/admin"
    || /^\/messages\/chat\/[^/]+$/.test(pathname)
    || /^\/circles\/[^/]+$/.test(pathname)
    || /^\/online-soup\/rooms\/[^/]+(?:\/select-soup)?$/.test(pathname);
}

export function SiteFooter() {
  const location = useLocation();
  const footerRef = useRef<HTMLElement | null>(null);
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  const hidden = isFocusedWorkspace(location.pathname);

  useEffect(() => {
    const root = document.documentElement;
    if (hidden) {
      root.style.setProperty("--site-footer-obstruction-height", "0px");
      return;
    }
    let frame = 0;
    const updateOverlap = () => {
      frame = 0;
      const rect = footerRef.current?.getBoundingClientRect();
      const obstructionHeight = rect && rect.top < window.innerHeight && rect.bottom > 0
        ? Math.max(0, window.innerHeight - Math.max(0, rect.top))
        : 0;
      root.style.setProperty("--site-footer-obstruction-height", `${Math.round(obstructionHeight)}px`);
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateOverlap);
    };
    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(document.documentElement);
    if (footerRef.current) resizeObserver.observe(footerRef.current);
    document.querySelectorAll("main").forEach((main) => resizeObserver.observe(main));
    const mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(document.querySelector(".app-shell") ?? document.body, { childList: true, subtree: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      root.style.setProperty("--site-footer-obstruction-height", "0px");
    };
  }, [hidden, location.pathname]);

  if (hidden) return null;

  return (
    <footer ref={footerRef} className="site-footer">
      <div className="site-footer-inner">
        <nav className="site-footer-links" aria-label="网站信息">
          {siteContentDocuments.map((document) => (
            <Link
              key={document.slug}
              to={`/site/${document.slug}`}
              state={{ returnTo }}
            >
              {document.title}
            </Link>
          ))}
        </nav>
        <div className="site-footer-rule" aria-hidden="true" />
        <p>汤汤解谜乐园 版权所有</p>
      </div>
    </footer>
  );
}
