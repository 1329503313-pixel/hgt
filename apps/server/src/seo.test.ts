import assert from "node:assert/strict";
import test from "node:test";
import { buildBaiduIndexableUrls } from "./baiduPush.js";
import { buildSeoSitemapXml, renderSeoHtml } from "./seo.js";

const template = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta name="description" content="old" />
    <meta name="keywords" content="old" />
    <meta name="robots" content="index,follow" />
    <title>old</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

test("renderSeoHtml replaces metadata and adds crawlable page content", () => {
  const html = renderSeoHtml(template, {
    title: "测试汤题｜海龟汤推理解谜",
    heading: "测试汤题",
    description: "测试描述",
    canonical: "https://example.com/soup/abc",
    robots: "index,follow",
    type: "article",
    sections: [{
      heading: "汤面",
      paragraphs: ["一扇门从里面锁住了。"],
      links: [{
        href: "https://example.com/soup/next",
        label: "下一题",
        metadata: "本格 · 普通",
        description: "继续挑战另一道题。"
      }]
    }]
  });

  assert.match(html, /<title>测试汤题｜海龟汤推理解谜<\/title>/);
  assert.match(html, /name="description" content="测试描述"/);
  assert.match(html, /name="keywords" content="汤物语,汤汤解谜乐园,海龟汤,AI海龟汤,在线海龟汤,多人海龟汤,情境推理,推理解谜"/);
  assert.match(html, /rel="canonical" href="https:\/\/example\.com\/soup\/abc"/);
  assert.match(html, /property="og:type" content="article"/);
  assert.match(html, /<main class="seo-fallback" data-seo-fallback>/);
  assert.match(html, /<h1>测试汤题<\/h1>/);
  assert.match(html, /<p>测试描述<\/p>/);
  assert.match(html, /<h2>汤面<\/h2>/);
  assert.match(html, /<p>一扇门从里面锁住了。<\/p>/);
  assert.match(html, /<a href="https:\/\/example\.com\/soup\/next">下一题<\/a>/);
  assert.match(html, /<span>本格 · 普通<\/span>/);
  assert.equal(html.match(/<h1>/g)?.length, 1);
  assert.doesNotMatch(html, /<title>old<\/title>/);
});

test("renderSeoHtml escapes page metadata and JSON-LD script terminators", () => {
  const html = renderSeoHtml(template, {
    title: "<script>alert(1)</script>",
    description: '"unsafe"',
    canonical: "https://example.com/?a=1&b=2",
    robots: "noindex,nofollow",
    jsonLd: { name: "</script><script>alert(1)</script>" },
    sections: [{
      heading: "<script>section</script>",
      links: [{ href: "https://example.com/?a=1&b=2", label: "<img src=x onerror=alert(1)>" }]
    }]
  });

  assert.doesNotMatch(html, /<title><script>/);
  assert.doesNotMatch(html, /<h1><script>/);
  assert.match(html, /<h1>alert\(1\)<\/h1>/);
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  assert.match(html, /href="https:\/\/example\.com\/\?a=1&amp;b=2"/);
  assert.doesNotMatch(html, /<\/script><script>alert/);
  assert.match(html, /\\u003c\/script>/);
  assert.doesNotMatch(html, /<h2><script>/);
  assert.doesNotMatch(html, /<a[^>]*><img/);
});

test("renderSeoHtml limits the visible h1 to 150 characters", () => {
  const heading = "海".repeat(180);
  const html = renderSeoHtml(template, {
    title: "长标题",
    heading,
    description: "测试描述",
    canonical: "https://example.com/long",
    robots: "index,follow"
  });
  const renderedHeading = html.match(/<h1>(.*?)<\/h1>/)?.[1] ?? "";
  assert.equal(renderedHeading.length, 150);
});

test("sitemap 只包含首页和可索引汤详情", () => {
  const xml = buildSeoSitemapXml("https://example.com", [
    { id: "soup_1", updated_at: new Date("2026-08-20T01:00:00.000Z") },
    { id: "soup/a", updated_at: new Date("2026-08-19T01:00:00.000Z") }
  ] as never);

  assert.match(xml, /<loc>https:\/\/example\.com\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/example\.com\/soup\/soup_1<\/loc>/);
  assert.match(xml, /<loc>https:\/\/example\.com\/soup\/soup%2Fa<\/loc>/);
  assert.match(xml, /<lastmod>2026-08-20T01:00:00\.000Z<\/lastmod>/);
  assert.doesNotMatch(xml, /\/users\/|\/mine\/|rankings|excellent-author/);
});

test("百度主动推送与 sitemap 使用相同的可索引 URL 边界", () => {
  const urls = buildBaiduIndexableUrls("https://example.com/", ["soup_1", "soup/a"]);
  assert.deepEqual(urls, [
    "https://example.com/",
    "https://example.com/soup/soup_1",
    "https://example.com/soup/soup%2Fa"
  ]);
  assert.ok(urls.every((url) => !url.includes("/users/") && !url.includes("/mine/")));
});
