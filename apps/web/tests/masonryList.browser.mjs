import assert from "node:assert/strict";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const bundle = await build({
  stdin: {
    resolveDir: resolve("apps/web"),
    loader: "tsx",
    contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { MasonryList } from "./src/components/MasonryList";

      const soups = Array.from({ length: 10 }, (_, index) => ({
        id: String(index), title: "测试作品" + index, summary: "简介", type: "本格清汤",
        difficulty: "普通", coverImage: "", enableAiGame: false, isOriginal: false,
        isBottomPublic: false, averageTotal: 0, likeCount: 0, favoriteCount: 0,
        heatValue: 0, creatorName: "", author: "", tags: []
      }));
      function Harness() {
        const [isDesktop, setIsDesktop] = useState(false);
        window.switchLayout = setIsDesktop;
        return <MasonryList soups={soups} isDesktop={isDesktop} onOpen={() => {}}
          hasMore={false} loading={false} onLoadMore={() => {}} />;
      }
      createRoot(document.getElementById("root")).render(<Harness />);
    `
  },
  bundle: true,
  write: false,
  format: "iife",
  loader: { ".webp": "dataurl" },
  define: { "import.meta.env": "{}" }
});

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? undefined : "msedge",
  headless: true
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  await expect(page.locator(".home-mobile-masonry .soup-card")).toHaveCount(10);
  assert.equal(await page.locator(".soup-card").count(), 10);
  await page.evaluate(() => window.switchLayout(true));
  await expect(page.locator(".home-desktop-grid .soup-card")).toHaveCount(10);
  assert.equal(await page.locator(".soup-card").count(), 10);
  await page.evaluate(() => window.switchLayout(false));
  await expect(page.locator(".home-mobile-masonry .soup-card")).toHaveCount(10);
  assert.deepEqual(errors, []);
  console.log("PASS: mobile and desktop layouts keep one set of cards mounted.");
} finally {
  await browser.close();
}
