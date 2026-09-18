// Verifies actual image bytes from a disposable local production image over HTTP.
// The catalog uses the release's DB seed; no login or production writes are performed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createAssetManifest } from "./check-production-assets.mjs";

const root = resolve(import.meta.dirname, "../..");
const option = name => process.argv[process.argv.indexOf(name) + 1];
assert.ok(process.argv.includes("--image") && process.argv.includes("--commit"), "Pass --image and --commit");
const image = option("--image"), commit = option("--commit");
const manifest = createAssetManifest(commit, root);
const db = execFileSync("git", ["show", `${commit}:apps/server/src/db.ts`], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
const stickers = [...db.matchAll(/\['(tangtang-detective-[^']+)', '([^']+)', '([^']+\/TTZT_[^']+)'\]/g)].map(([, id, name, path]) => ({
  id, name, text: name, owned: true,
  staticUrl: `/stickers/tangtang-detective/${path}_static.webp`,
  animatedUrl: `/stickers/tangtang-detective/${path}_320.webp`
}));
assert.equal(stickers.length, 19, "Must exercise every built-in DB seed entry");
const output = resolve(root, "artifacts/sticker-image");
mkdirSync(output, { recursive: true });
const harness = mkdtempSync(resolve(output, "harness-"));
writeFileSync(resolve(harness, "catalog.json"), JSON.stringify({ series: [{ id: "tangtang", name: "汤汤", stickers }] }));
await build({
  stdin: { resolveDir: resolve(root, "apps/web"), loader: "tsx", contents: `
    import React, { useEffect, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { api } from './src/api';
    import { StickerKeyboard } from './src/components/StickerKeyboard';
    function Harness() {
      const [series, setSeries] = useState([]), [sent, setSent] = useState(null);
      useEffect(() => { api('/api/stickers').then(data => setSeries(data.series)); }, []);
      return <main style={{maxWidth: 1000, margin: '20px auto'}}><StickerKeyboard series={series} sending={false} onClose={() => {}} onSend={setSent} />
        {sent && <img data-testid="message" src={sent.animatedUrl} width="128" height="128" alt={sent.name} />}</main>;
    }
    createRoot(document.getElementById('root')).render(<Harness />);
  ` }, bundle: true, outfile: resolve(harness, "harness.js"), format: "iife",
  define: { "import.meta.env": JSON.stringify({ VITE_HGT_TARGET: "web", VITE_HGT_API_ORIGIN: "" }) }
});
const server = `
  const express = require('express'), fs = require('fs');
  const app = express(), dist = '/app/apps/web/dist';
  const css = fs.readdirSync(dist + '/assets').find(p => /^index-.*\\.css$/.test(p));
  const html = '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/' + css + '"><div id="root"></div><script src="/test/harness.js"></script>';
  app.get('/api/stickers', (_, res) => res.sendFile('/test/catalog.json'));
  app.use('/test', express.static('/test'));
  app.use('/stickers', express.static(dist + '/stickers', {index:false, maxAge:'1y', immutable:true}));
  app.use(express.static(dist, {index:false}));
  app.use((_, res) => res.type('html').send(html));
  app.listen(4000, '0.0.0.0');
`;
const container = `hgt-sticker-check-${randomUUID()}`;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
let browser;
try {
  docker("run", "-d", "--rm", "--name", container, "-p", "127.0.0.1::4000", "--mount", `type=bind,source=${harness},target=/test,readonly`, "--entrypoint", "node", image, "-e", server);
  const port = docker("port", container, "4000/tcp").trim().split(":").at(-1);
  const origin = `http://127.0.0.1:${port}`;
  await expect.poll(async () => { try { return (await fetch(origin)).status; } catch { return 0; } }).toBe(200);
  for (const sticker of stickers) {
    for (const path of [sticker.staticUrl, sticker.animatedUrl]) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type") ?? "", /^image\/webp\b/, path);
      const bytes = Buffer.from(await response.arrayBuffer());
      const hash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      assert.equal(hash, manifest.files.find(file => file.path === path.slice(1))?.gitBlob, path);
    }
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? undefined : "msedge", headless: true });
  for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/sticker-test");
    for (let i = 0; i < stickers.length; i++) {
      if (i && i % 8 === 0) await page.getByRole("button", { name: `第 ${i / 8 + 1} 页，共 3 页` }).click();
      const button = page.getByRole("button", { name: stickers[i].name, exact: true });
      await expect(button.locator("img")).toHaveAttribute("src", stickers[i].staticUrl);
      await expect.poll(() => button.locator("img").evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      await button.click();
      await expect(page.getByTestId("message")).toHaveAttribute("src", stickers[i].animatedUrl);
      await expect.poll(() => page.getByTestId("message").evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      if (i === 7) await page.screenshot({ path: resolve(output, `${label}.png`) });
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${label}: all 19 static and animated stickers decoded across 3 pages`);
  }
  writeFileSync(resolve(output, "result.json"), JSON.stringify({ image, commit, variants: 38, viewports: ["desktop", "mobile"], passed: true }, null, 2));
  console.log("38 real HTTP image responses match committed bytes (no image interception)");
} finally {
  await browser?.close();
  docker("rm", "-f", container);
}
