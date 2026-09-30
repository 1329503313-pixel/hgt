import assert from "node:assert/strict";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const bundle = await build({
  stdin: {
    resolveDir: resolve("apps/web"),
    loader: "tsx",
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { useMessageUnreadCounts } from "./src/shared/useMessageUnread";
      window.requestCount = 0;
      window.serverUnread = 1;
      window.fetch = async () => {
        window.requestCount++;
        return new Response(JSON.stringify({ counts: {
          system: 0, interactions: 0, requests: 0, notices: 0,
          privateMessages: 0, circleMessages: 0, circleMentions: 0,
          circleUnclaimedRedPackets: 0, circleUnclaimedRedPacketNextExpiryAt: null,
          total: window.serverUnread
        } }));
      };
      window.EventSource = class extends EventTarget { close() {} };
      function Count({ name }) {
        const counts = useMessageUnreadCounts("u1");
        return <output aria-label={name}>{counts.total}</output>;
      }
      createRoot(document.getElementById("root")).render(<><Count name="首页" /><Count name="导航" /></>);
    `
  },
  bundle: true,
  write: false,
  format: "iife",
  define: { "import.meta.env": "{}" }
});

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? undefined : "msedge",
  headless: true
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  await expect(page.getByLabel("首页")).toHaveText("1");
  await expect(page.getByLabel("导航")).toHaveText("1");
  assert.equal(await page.evaluate(() => window.requestCount), 1);

  await page.evaluate(() => {
    window.serverUnread = 2;
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByLabel("首页")).toHaveText("2");
  assert.equal(await page.evaluate(() => window.requestCount), 2);

  await page.waitForTimeout(550);
  await page.evaluate(() => {
    window.serverUnread = 3;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByLabel("导航")).toHaveText("3");
  assert.equal(await page.evaluate(() => window.requestCount), 3);
  assert.deepEqual(errors, []);
  console.log("PASS: shared unread count refreshes once per foreground transition.");
} finally {
  await browser.close();
}
