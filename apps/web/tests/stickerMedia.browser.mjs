// Run from the repository root: node apps/web/tests/stickerMedia.browser.mjs
// Uses real sticker WebP files; all network requests are intercepted locally.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const appOrigin = "https://app.caqis.com";
const apiOrigin = "https://hgt.caqis.com";
const publicDir = resolve("apps/web/public");
const stickerRoot = resolve(publicDir, "stickers/tangtang-detective");
const defaults = readdirSync(stickerRoot, { recursive: true })
  .filter(file => file.endsWith("_static.webp"))
  .sort()
  .map((file, index) => ({
    id: `default-${index}`, name: `默认表情 ${index + 1}`, text: `默认表情 ${index + 1}`,
    staticUrl: `/stickers/tangtang-detective/${file.replaceAll("\\", "/")}`,
    animatedUrl: `/stickers/tangtang-detective/${file.replaceAll("\\", "/").replace("_static.webp", "_320.webp")}`,
    width: 320, height: 320, weight: 1000 - index, price: 0, owned: true
  }));
assert.equal(defaults.length, 19);
const uploaded = { ...defaults[0], id: "uploaded", name: "其他表情", text: "其他表情",
  staticUrl: "/api/media/stickers/uploaded/static?v=123",
  animatedUrl: "/api/media/stickers/uploaded/animated?v=123" };
const payload = { series: [
  { id: "tangtang", name: "汤汤", stickers: defaults },
  { id: "uploaded", name: "其他系列", stickers: [uploaded] }
] };
const css = readdirSync(resolve("apps/web/dist/assets")).find(file => /^index-.*\.css$/.test(file));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? undefined : "msedge", headless: true });
try {
  for (const android of [true, false]) {
    const bundle = await build({
      stdin: { resolveDir: resolve("apps/web"), loader: "tsx", contents: `
        import React, { useEffect, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { api } from './src/api';
        import { StickerKeyboard } from './src/components/StickerKeyboard';
        function Harness() {
          const [series, setSeries] = useState([]);
          const [sent, setSent] = useState(null);
          const load = () => api('/api/stickers', { cacheTtlMs: 1800000 }).then(data => setSeries(data.series));
          useEffect(() => { void load(); }, []);
          return <main><StickerKeyboard series={series} sending={false} onClose={() => {}} onSend={setSent} />
            {sent && <img data-testid="message" src={sent.animatedUrl} alt={sent.name} width="128" height="128" />}
            <button onClick={load}>重新读取</button></main>;
        }
        createRoot(document.getElementById('root')).render(<Harness />);
      ` }, bundle: true, write: false, format: "iife",
      define: { "import.meta.env": JSON.stringify({ VITE_HGT_TARGET: android ? "android" : "web", VITE_HGT_API_ORIGIN: android ? apiOrigin : "" }) }
    });
    const origin = android ? appOrigin : apiOrigin;
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    const errors = [], unexpected = [], loaded = new Set();
    let catalogRequests = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.href === `${origin}/sticker-test`) {
        return route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
      }
      if (url.origin === apiOrigin && url.pathname === "/api/stickers") {
        catalogRequests++;
        return route.fulfill({ json: payload, headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" } });
      }
      if (url.origin === apiOrigin && url.pathname.startsWith("/stickers/")) {
        loaded.add(decodeURI(url.pathname));
        return route.fulfill({ contentType: "image/webp", path: resolve(publicDir, `.${decodeURI(url.pathname)}`) });
      }
      if (url.origin === apiOrigin && url.pathname.startsWith("/api/media/stickers/uploaded/")) {
        loaded.add(url.pathname);
        const source = url.pathname.endsWith("/static") ? defaults[0].staticUrl : defaults[0].animatedUrl;
        return route.fulfill({ contentType: "image/webp", path: resolve(publicDir, `.${source}`) });
      }
      unexpected.push(url.href);
      return route.abort();
    });
    await page.goto(`${origin}/sticker-test`);
    await page.addStyleTag({ content: readFileSync(resolve("apps/web/dist/assets", css), "utf8") });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    async function verifySticker(sticker) {
      const button = page.getByRole("button", { name: sticker.text, exact: true });
      await expect(button).toBeVisible();
      const expectedStatic = android ? apiOrigin + sticker.staticUrl : sticker.staticUrl;
      await expect(button.locator("img")).toHaveAttribute("src", expectedStatic);
      await expect.poll(() => button.locator("img").evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      await button.click();
      const message = page.getByTestId("message");
      await expect(message).toHaveAttribute("src", android ? apiOrigin + sticker.animatedUrl : sticker.animatedUrl);
      await expect.poll(() => message.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    }
    for (let index = 0; index < defaults.length; index++) {
      if (index > 0 && index % 8 === 0) await page.getByRole("button", { name: `第 ${index / 8 + 1} 页，共 3 页`, exact: true }).click();
      await verifySticker(defaults[index]);
    }
    await page.getByRole("tab", { name: "其他系列", exact: true }).click();
    await verifySticker(uploaded);
    await page.getByRole("button", { name: "重新读取", exact: true }).click();
    await page.getByRole("tab", { name: "汤汤", exact: true }).click();
    await page.setViewportSize({ width: 812, height: 375 });
    await verifySticker(defaults[0]);
    assert.equal(catalogRequests, 1, "Cached metadata retains normalized URLs");
    assert.equal(loaded.size, 40, "All 38 default variants and both uploaded variants decode");
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    console.log(`PASS: ${android ? "APP cross-origin" : "Web same-origin"}: all 19 default stickers and uploaded stickers decode in keyboard/messages; pagination, cache and landscape pass.`);
    await page.close();
  }
} finally { await browser.close(); }
