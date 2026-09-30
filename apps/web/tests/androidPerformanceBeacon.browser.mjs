import assert from "node:assert/strict";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const bundle = await build({
  stdin: {
    resolveDir: resolve("apps/web"),
    loader: "ts",
    contents: `
      import { setupPerformanceMonitoring } from "./src/performance";
      window.beaconUrls = [];
      Object.defineProperty(navigator, "sendBeacon", { configurable: true,
        value: (url) => { window.beaconUrls.push(url); return true; } });
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      setupPerformanceMonitoring();
      document.dispatchEvent(new Event("visibilitychange"));
    `
  },
  bundle: true,
  write: false,
  format: "iife",
  define: {
    "import.meta.env": JSON.stringify({
      PROD: false,
      VITE_HGT_TARGET: "android",
      VITE_HGT_API_ORIGIN: "https://hgt.caqis.com",
      VITE_HGT_PUBLIC_SITE_ORIGIN: "https://hgt.caqis.com"
    })
  }
});

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? undefined : "msedge",
  headless: true
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const urls = await page.evaluate(() => window.beaconUrls);
  assert.equal(urls.length, 3);
  assert.ok(urls.every((url) => url === "https://hgt.caqis.com/api/telemetry/performance"));
  assert.deepEqual(errors, []);
  console.log("PASS: Android performance beacons target the configured API origin.");
} finally {
  await browser.close();
}
