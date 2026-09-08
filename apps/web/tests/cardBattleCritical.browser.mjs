// Run after build:all from the repository root. No API or database is accessed.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const bundled = await build({
  stdin: { resolveDir: resolve("apps/web"), loader: "tsx", contents: `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { CardBattleConfigEditor } from "./src/components/admin/CardBattleConfigEditor";
    import { defaultCardBattleTiersForRarity } from "./src/shared/digitalAssets";
    function Harness() {
      const [tiers, setTiers] = useState(defaultCardBattleTiersForRarity("epic"));
      const [star, setStar] = useState(0);
      return <form className="p-3"><CardBattleConfigEditor tiers={tiers} activeStar={star} onActiveStar={setStar} onChange={setTiers} /><output id="data" hidden>{JSON.stringify(tiers)}</output></form>;
    }
    createRoot(document.getElementById("root")).render(<Harness />);
  ` }, bundle: true, write: false, format: "iife",
});
const css = readdirSync(resolve("apps/web/dist/assets")).find((file) => file.startsWith("index-") && file.endsWith(".css"));
assert.ok(css, "先执行Web构建");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? undefined : "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
  await page.addStyleTag({ content: readFileSync(resolve("apps/web/dist/assets", css), "utf8") });
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await expect(page.getByLabel("0星暴击率", { exact: true })).toHaveValue("25");
  await expect(page.getByLabel("0星暴击伤害", { exact: true })).toHaveValue("150");
  for (const label of ["吸血比例", "击晕概率", "再动概率"]) {
    await expect(page.getByLabel(`0星${label}`, { exact: true })).toHaveValue("0");
    await page.getByLabel(`0星${label}`, { exact: true }).fill("12.25");
  }
  await page.getByLabel("0星暴击率", { exact: true }).fill("37.5");
  await page.getByLabel("0星暴击伤害", { exact: true }).fill("225.25");
  await page.getByRole("tab", { name: "3 星", exact: true }).click();
  await expect(page.getByLabel("3星暴击率", { exact: true })).toHaveValue("25");
  await expect(page.getByLabel("3星暴击伤害", { exact: true })).toHaveValue("150");
  for (const label of ["吸血比例", "击晕概率", "再动概率"]) await expect(page.getByLabel(`3星${label}`, { exact: true })).toHaveValue("0");
  await page.getByRole("tab", { name: "0 星", exact: true }).click();
  await expect(page.getByLabel("0星暴击率", { exact: true })).toHaveValue("37.5");
  await expect(page.getByLabel("0星暴击伤害", { exact: true })).toHaveValue("225.25");
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "百分比字段不造成横向溢出");
  }
  const saved = JSON.parse(await page.locator("#data").textContent());
  assert.equal(saved[0].critRate, 37.5);
  assert.equal(saved[0].critDamage, 225.25);
  assert.ok(saved.slice(1).every((tier) => tier.critRate === 25 && tier.critDamage === 150));
  await page.getByRole("button", { name: "新增条件" }).click();
  const typeSelect = page.getByLabel("技能类型");
  const debuffs = await typeSelect.locator("option").evaluateAll(options => options.map(option => option.value).filter(value => value.includes("_down_")));
  assert.equal(debuffs.length, 37);
  for (const type of debuffs) {
    await typeSelect.selectOption(type);
    await expect(page.getByLabel(/^(降低比例（%）|属性变化（百分点）)/)).toBeVisible();
    await expect(page.getByLabel("持续回合（本回合算 1）")).toBeVisible();
  }
  await page.getByLabel("降低比例（%）").fill("30");
  await page.getByLabel("持续回合（本回合算 1）").fill("3");
  const debuffData = JSON.parse(await page.locator("#data").textContent())[0].effects[0];
  assert.equal(debuffData.value, 30);
  assert.equal(debuffData.duration, 3);
  for (const key of ["lifestealRate", "stunRate", "extraActionRate"]) {
    assert.equal(saved[0][key], 12.25);
    assert.ok(saved.slice(1).every(tier => tier[key] === 0));
  }
  const procs = await typeSelect.locator("option").evaluateAll(options => options.map(option => option.value).filter(value => /^(lifesteal|stun|extra_action)_/.test(value)));
  assert.equal(procs.length, 18);
  for (const type of procs) {
    await typeSelect.selectOption(type);
    await expect(page.getByLabel(/^属性变化（百分点）/)).toBeVisible();
    await expect(page.getByLabel("持续回合（本回合算 1）")).toBeVisible();
    await page.getByLabel(/^属性变化（百分点）/).fill("25");
    await page.getByLabel("持续回合（本回合算 1）").fill("3");
    const current = JSON.parse(await page.locator("#data").textContent())[0].effects[0];
    assert.equal(current.value, 25); assert.equal(current.duration, 3); assert.equal(current.type, type);
  }
  assert.deepEqual(errors, []);
  console.log("PASS: critical presets, three 0% proc stats, decimal editing, per-star independence, 37 debuffs and all 18 proc skills with required duration, responsive layout and reduced motion");
} finally {
  await browser.close();
}
