import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { seoSite, setDocumentSeo } from "../shared/seo";
import { siteContentBySlug, type SiteContentSlug } from "../shared/siteContent";

export function SeoManager() {
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === "/") {
      setDocumentSeo({
        title: seoSite.homeTitle,
        description: seoSite.homeDescription,
        index: true,
        path: "/"
      });
      return;
    }

    if (/^\/soup\/[^/]+$/.test(location.pathname)) {
      setDocumentSeo({
        title: `海龟汤详情｜${seoSite.name}`,
        description: seoSite.homeDescription,
        index: true,
        path: location.pathname
      });
      return;
    }

    const siteContentMatch = location.pathname.match(/^\/site\/([^/]+)$/);
    const siteDocument = siteContentMatch
      ? siteContentBySlug.get(siteContentMatch[1] as SiteContentSlug)
      : undefined;
    if (siteDocument) {
      setDocumentSeo({
        title: `${siteDocument.title}｜${seoSite.name}`,
        description: siteDocument.summary,
        index: true,
        path: location.pathname
      });
      return;
    }

    setDocumentSeo({
      title: seoSite.name,
      description: seoSite.homeDescription,
      index: false,
      path: location.pathname
    });
  }, [location.pathname]);

  return null;
}
