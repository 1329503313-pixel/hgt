import type express from "express";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { readFileSync } from "node:fs";

const SITE_NAME = "烧脑海龟汤社区 海量经典海龟汤";
const HOME_TITLE = "烧脑海龟汤社区｜海量经典海龟汤、推理解谜与烧脑游戏";
const HOME_DESCRIPTION = "烧脑海龟汤社区收录海量经典海龟汤、原创情境推理题和烧脑解谜内容，支持在线玩汤、作品评价、收藏和玩家交流。";
const KEYWORDS = "海龟汤,解谜,推理,烧脑";

type SeoRouteDependencies = {
  frontendIndexPath: string;
  pool: Pool;
  siteUrl: string;
};

type SeoPage = {
  title: string;
  description: string;
  canonical: string;
  robots: "index,follow" | "noindex,nofollow";
  type?: "website" | "article";
  jsonLd?: unknown;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeXml(value: string) {
  return escapeHtml(value);
}

function plainText(value: unknown) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function descriptionFrom(...values: unknown[]) {
  const text = values.map(plainText).find(Boolean) ?? HOME_DESCRIPTION;
  return text.length > 150 ? `${text.slice(0, 147)}…` : text;
}

function normalizedSiteUrl(siteUrl: string) {
  return siteUrl.trim().replace(/\/+$/, "");
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function renderSeoHtml(template: string, page: SeoPage) {
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  const canonical = escapeHtml(page.canonical);
  const type = page.type ?? "website";
  const additions = [
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta name="twitter:card" content="summary" />`,
    page.jsonLd ? `<script type="application/ld+json">${safeJson(page.jsonLd)}</script>` : ""
  ].filter(Boolean).join("\n    ");

  return template
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`)
    .replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${description}" />`)
    .replace(/<meta\s+name=["']keywords["'][^>]*>/i, `<meta name="keywords" content="${escapeHtml(KEYWORDS)}" />`)
    .replace(/<meta\s+name=["']robots["'][^>]*>/i, `<meta name="robots" content="${page.robots}" />`)
    .replace("</head>", `    ${additions}\n  </head>`);
}

export function registerSeoRoutes(app: express.Express, dependencies: SeoRouteDependencies) {
  const template = readFileSync(dependencies.frontendIndexPath, "utf8");
  const siteUrl = normalizedSiteUrl(dependencies.siteUrl);

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").setHeader("Cache-Control", "public, max-age=3600");
    res.send([
      "User-agent: *",
      "Allow: /$",
      "Allow: /soup/",
      "Disallow: /api/",
      "Disallow: /admin",
      "Disallow: /messages",
      "Disallow: /mine",
      "Disallow: /online-soup",
      "Disallow: /circles",
      `Sitemap: ${siteUrl}/sitemap.xml`,
      ""
    ].join("\n"));
  });

  app.get("/sitemap.xml", async (_req, res) => {
    const [soupRows, userRows] = await Promise.all([
      dependencies.pool.query<RowDataPacket[]>(
        `SELECT id, created_at
         FROM soups
         WHERE is_surface_public = TRUE AND review_status = 'approved'
         ORDER BY created_at DESC
         LIMIT 49995`
      ),
      dependencies.pool.query<RowDataPacket[]>(
        `SELECT id, GREATEST(created_at, COALESCE(profile_background_updated_at, created_at)) AS updated_at
         FROM users
         WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 MONTH)
         ORDER BY created_at DESC
         LIMIT 5000`
      )
    ]);
    const urls = [
      `  <url><loc>${escapeXml(`${siteUrl}/`)}</loc><priority>1.0</priority><changefreq>daily</changefreq></url>`,
      `  <url><loc>${escapeXml(`${siteUrl}/mine/rankings`)}</loc><priority>0.8</priority><changefreq>daily</changefreq></url>`,
      `  <url><loc>${escapeXml(`${siteUrl}/mine/excellent-author`)}</loc><priority>0.8</priority><changefreq>weekly</changefreq></url>`,
      ...soupRows[0].map((row) => {
        const lastmod = row.created_at ? `<lastmod>${new Date(row.created_at).toISOString()}</lastmod>` : "";
        return `  <url><loc>${escapeXml(`${siteUrl}/soup/${encodeURIComponent(String(row.id))}`)}</loc>${lastmod}<priority>0.8</priority></url>`;
      }),
      ...userRows[0].map((row) => {
        const lastmod = row.updated_at ? `<lastmod>${new Date(row.updated_at).toISOString()}</lastmod>` : "";
        return `  <url><loc>${escapeXml(`${siteUrl}/users/${encodeURIComponent(String(row.id))}`)}</loc>${lastmod}<priority>0.5</priority></url>`;
      })
    ];
    res.type("application/xml").setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`);
  });

  app.get("/", (_req, res) => {
    const canonical = `${siteUrl}/`;
    res.type("html").setHeader("Cache-Control", "no-cache");
    res.send(renderSeoHtml(template, {
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
      canonical,
      robots: "index,follow",
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", name: SITE_NAME, url: canonical, inLanguage: "zh-CN" },
          { "@type": "Organization", name: SITE_NAME, url: canonical }
        ]
      }
    }));
  });

  app.get("/soup/:id", async (req, res) => {
    const [rows] = await dependencies.pool.query<RowDataPacket[]>(
      `SELECT s.id, s.title, s.author, s.summary, s.surface, s.created_at,
         COUNT(e.id) AS evaluation_count, AVG(e.total) AS average_total
       FROM soups s
       LEFT JOIN evaluations e ON e.soup_id = s.id
       WHERE s.id = ? AND s.is_surface_public = TRUE AND s.review_status = 'approved'
       GROUP BY s.id
       LIMIT 1`,
      [req.params.id]
    );
    const soup = rows[0];
    const canonical = `${siteUrl}/soup/${encodeURIComponent(req.params.id)}`;
    if (!soup) {
      res.type("html").setHeader("Cache-Control", "no-cache");
      return res.send(renderSeoHtml(template, {
        title: `海龟汤详情｜${SITE_NAME}`,
        description: HOME_DESCRIPTION,
        canonical,
        robots: "noindex,nofollow"
      }));
    }

    const description = descriptionFrom(soup.summary, soup.surface);
    const ratingCount = Number(soup.evaluation_count ?? 0);
    const averageRating = Number(soup.average_total ?? 0);
    const creativeWork: Record<string, unknown> = {
      "@type": "CreativeWork",
      name: String(soup.title),
      description,
      url: canonical,
      datePublished: new Date(soup.created_at).toISOString(),
      inLanguage: "zh-CN",
      author: { "@type": "Person", name: String(soup.author || "社区用户") }
    };
    if (ratingCount > 0 && averageRating > 0) {
      creativeWork.aggregateRating = {
        "@type": "AggregateRating",
        ratingValue: averageRating.toFixed(1),
        ratingCount,
        bestRating: 5,
        worstRating: 1
      };
    }

    res.type("html").setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    return res.send(renderSeoHtml(template, {
      title: `${plainText(soup.title)}｜海龟汤推理解谜`,
      description,
      canonical,
      robots: "index,follow",
      type: "article",
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [
          creativeWork,
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "首页", item: `${siteUrl}/` },
              { "@type": "ListItem", position: 2, name: plainText(soup.title), item: canonical }
            ]
          }
        ]
      }
    }));
  });

  return {
    sendNoIndexAppHtml(req: express.Request, res: express.Response) {
      const canonical = `${siteUrl}${req.path}`;
      res.type("html").setHeader("Cache-Control", "no-cache");
      res.send(renderSeoHtml(template, {
        title: SITE_NAME,
        description: HOME_DESCRIPTION,
        canonical,
        robots: "noindex,nofollow"
      }));
    }
  };
}

