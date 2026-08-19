import assert from "node:assert/strict";
import test from "node:test";
import { renderSeoHtml } from "./seo.js";

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
    type: "article"
  });

  assert.match(html, /<title>测试汤题｜海龟汤推理解谜<\/title>/);
  assert.match(html, /name="description" content="测试描述"/);
  assert.match(html, /name="keywords" content="海龟汤,解谜,推理,烧脑"/);
  assert.match(html, /rel="canonical" href="https:\/\/example\.com\/soup\/abc"/);
  assert.match(html, /property="og:type" content="article"/);
  assert.match(html, /<main class="seo-fallback" data-seo-fallback>/);
  assert.match(html, /<h1>测试汤题<\/h1>/);
  assert.match(html, /<p>测试描述<\/p>/);
  assert.equal(html.match(/<h1>/g)?.length, 1);
  assert.doesNotMatch(html, /<title>old<\/title>/);
});

test("renderSeoHtml escapes page metadata and JSON-LD script terminators", () => {
  const html = renderSeoHtml(template, {
    title: "<script>alert(1)</script>",
    description: '"unsafe"',
    canonical: "https://example.com/?a=1&b=2",
    robots: "noindex,nofollow",
    jsonLd: { name: "</script><script>alert(1)</script>" }
  });

  assert.doesNotMatch(html, /<title><script>/);
  assert.doesNotMatch(html, /<h1><script>/);
  assert.match(html, /<h1>alert\(1\)<\/h1>/);
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  assert.match(html, /href="https:\/\/example\.com\/\?a=1&amp;b=2"/);
  assert.doesNotMatch(html, /<\/script><script>alert/);
  assert.match(html, /\\u003c\/script>/);
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
