import { Link, useLocation } from "react-router-dom";
import { siteContentDocuments } from "../shared/siteContent";

export function SiteFooter() {
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}${location.hash}`;

  return (
    <footer className="site-footer">
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
