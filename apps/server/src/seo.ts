import type express from "express";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { readFileSync } from "node:fs";

const SITE_NAME = "汤物语丨汤汤解谜乐园";
const HOME_TITLE = "汤物语丨汤汤解谜乐园｜游戏大厅、AI海龟汤与原创谜题社区";
const HOME_DESCRIPTION = "汤物语丨汤汤解谜乐园是海龟汤与情境推理社区，游戏大厅提供 AI 主持、多人推理房间、原创谜题、作品评价与玩家交流。";
const KEYWORDS = "汤物语,汤汤解谜乐园,海龟汤,AI海龟汤,在线海龟汤,多人海龟汤,情境推理,推理解谜";

type SeoRouteDependencies = {
  frontendIndexPath: string;
  pool: Pool;
  siteUrl: string;
};

type SeoPage = {
  title: string;
  description: string;
  heading?: string;
  canonical: string;
  robots: "index,follow" | "noindex,nofollow";
  type?: "website" | "article";
  jsonLd?: unknown;
  sections?: SeoSection[];
};

type SeoLink = {
  href: string;
  label: string;
  description?: string;
  metadata?: string;
};

type SeoSection = {
  heading: string;
  paragraphs?: string[];
  links?: SeoLink[];
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

function headingFrom(value: unknown) {
  const text = plainText(value) || SITE_NAME;
  return text.slice(0, 150);
}

function normalizedSiteUrl(siteUrl: string) {
  return siteUrl.trim().replace(/\/+$/, "");
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function renderSeoSections(sections: SeoSection[] = []) {
  return sections.map((section) => {
    const paragraphs = (section.paragraphs ?? [])
      .map((paragraph) => `<p>${escapeHtml(plainText(paragraph))}</p>`)
      .join("");
    const links = section.links?.length
      ? `<ul>${section.links.map((link) => [
        "<li>",
        `<a href="${escapeHtml(link.href)}">${escapeHtml(headingFrom(link.label))}</a>`,
        link.metadata ? `<span>${escapeHtml(plainText(link.metadata))}</span>` : "",
        link.description ? `<p>${escapeHtml(descriptionFrom(link.description))}</p>` : "",
        "</li>"
      ].join("")).join("")}</ul>`
      : "";
    return `<section><h2>${escapeHtml(headingFrom(section.heading))}</h2>${paragraphs}${links}</section>`;
  }).join("");
}

function soupSeoLinks(rows: RowDataPacket[], siteUrl: string): SeoLink[] {
  return rows.map((row) => ({
    href: `${siteUrl}/soup/${encodeURIComponent(String(row.id))}`,
    label: plainText(row.title),
    description: descriptionFrom(row.summary, row.surface),
    metadata: [plainText(row.type), plainText(row.difficulty), `作者：${plainText(row.author || "社区用户")}`]
      .filter(Boolean)
      .join(" · ")
  }));
}

export function buildSeoSitemapXml(siteUrl: string, soupRows: RowDataPacket[]) {
  const urls = [
    `  <url><loc>${escapeXml(`${siteUrl}/`)}</loc><priority>1.0</priority><changefreq>daily</changefreq></url>`,
    ...soupRows.map((row) => {
      const lastmod = row.updated_at ? `<lastmod>${new Date(row.updated_at).toISOString()}</lastmod>` : "";
      return `  <url><loc>${escapeXml(`${siteUrl}/soup/${encodeURIComponent(String(row.id))}`)}</loc>${lastmod}<priority>0.8</priority><changefreq>weekly</changefreq></url>`;
    })
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export function renderSeoHtml(template: string, page: SeoPage) {
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  const heading = escapeHtml(headingFrom(page.heading ?? page.title));
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
  const fallback = `<div id="root"><main class="seo-fallback" data-seo-fallback><h1>${heading}</h1><p>${description}</p>${renderSeoSections(page.sections)}</main></div>`;

  return template
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`)
    .replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${description}" />`)
    .replace(/<meta\s+name=["']keywords["'][^>]*>/i, `<meta name="keywords" content="${escapeHtml(KEYWORDS)}" />`)
    .replace(/<meta\s+name=["']robots["'][^>]*>/i, `<meta name="robots" content="${page.robots}" />`)
    .replace("</head>", `    ${additions}\n  </head>`)
    .replace(/<div\s+id=["']root["'][^>]*>[\s\S]*?<\/div>/i, fallback);
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
    const [soupRows] = await dependencies.pool.query<RowDataPacket[]>(
      `SELECT id, updated_at
       FROM soups
       WHERE is_surface_public = TRUE AND review_status = 'approved'
       ORDER BY updated_at DESC
       LIMIT 49999`
    );
    res.type("application/xml").setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.send(buildSeoSitemapXml(siteUrl, soupRows));
  });

  app.get("/", async (_req, res) => {
    const canonical = `${siteUrl}/`;
    const [latestResult, popularResult] = await Promise.all([
      dependencies.pool.query<RowDataPacket[]>(
        `SELECT id, title, author, type, difficulty, summary, surface
         FROM soups
         WHERE is_surface_public = TRUE AND review_status = 'approved'
         ORDER BY created_at DESC
         LIMIT 12`
      ),
      dependencies.pool.query<RowDataPacket[]>(
        `SELECT id, title, author, type, difficulty, summary, surface
         FROM soups
         WHERE is_surface_public = TRUE AND review_status = 'approved'
         ORDER BY view_count DESC, created_at DESC
         LIMIT 24`
      )
    ]);
    const latestRows = latestResult[0];
    const latestIds = new Set(latestRows.map((row) => String(row.id)));
    const popularRows = popularResult[0].filter((row) => !latestIds.has(String(row.id))).slice(0, 12);
    const latestLinks = soupSeoLinks(latestRows, siteUrl);
    const popularLinks = soupSeoLinks(popularRows, siteUrl);
    const allLinks = [...latestLinks, ...popularLinks];
    res.type("html").setHeader("Cache-Control", "no-cache");
    res.send(renderSeoHtml(template, {
      title: HOME_TITLE,
      heading: SITE_NAME,
      description: HOME_DESCRIPTION,
      canonical,
      robots: "index,follow",
      sections: [
        {
          heading: "在线玩海龟汤与情境推理",
          paragraphs: [
            "阅读离奇的汤面，通过可以回答是、不是或无关的问题逐步还原汤底。你可以邀请朋友进入多人房间，也可以由 AI 主持人陪你独自推理。",
            "社区收录原创与经典题型，覆盖本格、变格、清汤、红汤等不同风格；公开汤面均可直接浏览，并由玩家评价、收藏和交流。"
          ]
        },
        ...(latestLinks.length ? [{ heading: "最新公开海龟汤", links: latestLinks }] : []),
        ...(popularLinks.length ? [{ heading: "热门海龟汤", links: popularLinks }] : [])
      ],
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", name: SITE_NAME, alternateName: "汤物语", url: canonical, inLanguage: "zh-CN" },
          { "@type": "Organization", name: SITE_NAME, url: canonical },
          ...(allLinks.length ? [{
            "@type": "ItemList",
            name: "汤物语公开海龟汤",
            itemListElement: allLinks.map((link, index) => ({
              "@type": "ListItem", position: index + 1, name: link.label, url: link.href
            }))
          }] : [])
        ]
      }
    }));
  });

  app.get("/soup/:id", async (req, res) => {
    const [rows] = await dependencies.pool.query<RowDataPacket[]>(
      `SELECT s.id, s.title, s.author, s.type, s.difficulty, s.summary, s.surface,
         s.is_original, s.created_at, s.updated_at,
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
        heading: "海龟汤详情",
        description: HOME_DESCRIPTION,
        canonical,
        robots: "noindex,nofollow"
      }));
    }

    const description = descriptionFrom(soup.summary, soup.surface);
    const [relatedRows] = await dependencies.pool.query<RowDataPacket[]>(
      `SELECT id, title, author, type, difficulty, summary, surface
       FROM soups
       WHERE id <> ? AND type = ? AND is_surface_public = TRUE AND review_status = 'approved'
       ORDER BY created_at DESC
       LIMIT 6`,
      [soup.id, soup.type]
    );
    const relatedLinks = soupSeoLinks(relatedRows, siteUrl);
    const ratingCount = Number(soup.evaluation_count ?? 0);
    const averageRating = Number(soup.average_total ?? 0);
    const creativeWork: Record<string, unknown> = {
      "@type": "CreativeWork",
      name: String(soup.title),
      description,
      url: canonical,
      datePublished: new Date(soup.created_at).toISOString(),
      dateModified: new Date(soup.updated_at ?? soup.created_at).toISOString(),
      inLanguage: "zh-CN",
      genre: String(soup.type || "海龟汤"),
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
      title: `${plainText(soup.title)}｜海龟汤题目｜${SITE_NAME}`,
      heading: plainText(soup.title),
      description,
      canonical,
      robots: "index,follow",
      type: "article",
      sections: [
        { heading: "汤面", paragraphs: [plainText(soup.surface)] },
        {
          heading: "题目信息",
          paragraphs: [[
            `类型：${plainText(soup.type || "海龟汤")}`,
            `难度：${plainText(soup.difficulty || "普通")}`,
            `作者：${plainText(soup.author || "社区用户")}`,
            soup.is_original ? "原创作品" : "非原创作品"
          ].join("；")]
        },
        {
          heading: "继续挑战海龟汤",
          paragraphs: ["围绕人物、时间、地点、物品和动机提出可判断的问题，逐步排除错误假设，再尝试还原完整汤底。"],
          links: [
            ...relatedLinks,
            { href: `${siteUrl}/`, label: `返回${SITE_NAME}`, description: "浏览更多公开海龟汤与情境推理题。" }
          ]
        }
      ],
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [
          creativeWork,
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${siteUrl}/` },
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
