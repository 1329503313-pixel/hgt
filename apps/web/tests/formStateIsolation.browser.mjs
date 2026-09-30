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
      import { AppProvider, useApp, useSoupForm, useEvalForm } from "./src/context/AppContext";
      window.fetch = async () => new Response(JSON.stringify({ user: null }));
      let globalRenders = 0;
      function GlobalConsumer() {
        const { loadingUser, openSoupEditor, openEvalEditor } = useApp();
        window.openSoupEditor = openSoupEditor;
        window.openEvalEditor = openEvalEditor;
        globalRenders++;
        return <output aria-label="全局渲染">{loadingUser ? "loading" : globalRenders}</output>;
      }
      function FormConsumer() {
        const [soup, setSoup] = useSoupForm();
        const [evaluation, setEvaluation] = useEvalForm();
        window.editSoup = () => setSoup({ ...soup, title: "新标题" });
        window.editEvaluation = () => setEvaluation({ ...evaluation, content: "新评价" });
        return <><output aria-label="作品标题">{soup.title}</output>
          <output aria-label="评价内容">{evaluation.content}</output></>;
      }
      createRoot(document.getElementById("root")).render(
        <AppProvider><GlobalConsumer /><FormConsumer /></AppProvider>
      );
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

  await expect(page.getByLabel("全局渲染")).not.toHaveText("loading");
  const before = await page.getByLabel("全局渲染").textContent();
  await page.evaluate(() => { window.editSoup(); window.editEvaluation(); });
  await expect(page.getByLabel("作品标题")).toHaveText("新标题");
  await expect(page.getByLabel("评价内容")).toHaveText("新评价");
  assert.equal(await page.getByLabel("全局渲染").textContent(), before);
  await page.evaluate(() => { window.openSoupEditor(); window.openEvalEditor("soup-1"); });
  await expect(page.getByLabel("作品标题")).toHaveText("");
  await expect(page.getByLabel("评价内容")).toHaveText("");
  assert.deepEqual(errors, []);
  console.log("PASS: editing form values does not rerender global app consumers.");
} finally {
  await browser.close();
}
