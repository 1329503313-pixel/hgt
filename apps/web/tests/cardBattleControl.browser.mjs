// Local component/browser coverage; network requests are blocked.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
const bundle = await build({ stdin: { resolveDir: resolve("apps/web"), loader: "tsx", contents: `
  import React, { useState } from "react";
  import { createRoot } from "react-dom/client";
  import { CardBattleConfigEditor } from "./src/components/admin/CardBattleConfigEditor";
  import { cardBattleSelectionError } from "./src/components/admin/cardBattleEditorDraft";
  import { defaultCardBattleTiersForRarity } from "./src/shared/digitalAssets";
  import { CardBattleStatusIcons } from "./src/components/CardBattleEffects";
  function Harness() {
    const [tiers, setTiers] = useState(defaultCardBattleTiersForRarity("epic"));
    const [star, setStar] = useState(0);
    return <main className="p-3"><form><CardBattleConfigEditor tiers={tiers} activeStar={star} onActiveStar={setStar} onChange={setTiers} /></form>
      <output id="data" hidden>{JSON.stringify(tiers)}</output><output id="validation" hidden>{cardBattleSelectionError(tiers)}</output>
      <div id="statuses"><CardBattleStatusIcons statuses={[{type:"immunity",value:1,remainingRounds:365,multiplier:1},
        {type:"revival_block",value:1,remainingRounds:60,multiplier:1},
        {type:"stunned",value:1,remainingRounds:99,multiplier:1}]} /></div></main>;
  }
  createRoot(document.getElementById("root")).render(<Harness />);
` }, bundle: true, write: false, format: "iife" });
const css = readdirSync("apps/web/dist/assets").find((file) => file.startsWith("index-") && file.endsWith(".css"));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? undefined : "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
  await page.addStyleTag({ content: readFileSync(resolve("apps/web/dist/assets", css), "utf8") });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const data = async () => JSON.parse(await page.locator("#data").textContent());
  const choose = async (label, index = 0) => {
    const input = page.getByRole("combobox", { name: "技能类型", exact: true }).nth(index);
    await input.click(); await input.fill(label);
    await page.getByRole("option", { name: label, exact: true }).click();
  };
  await page.getByRole("button", { name: "新增条件", exact: true }).click();
  const main = page.getByRole("combobox", { name: "技能类型", exact: true }).first();
  for (const label of ["立刻再次行动", "禁止敌方受到本技能伤害的单位复活"]) {
    await main.click(); await main.fill(label);
    await expect(page.getByRole("option")).toHaveCount(0);
    await main.press("Tab"); await expect(main).toHaveValue("");
  }
  for (const label of ["令敌方一名单位眩晕", "令敌方前排单位眩晕", "令敌方后排单位眩晕", "令敌方所有单位眩晕", "令敌方随机一名单位眩晕"]) {
    await choose(label);
    await expect(page.getByLabel("生效概率（%）", { exact: true })).toHaveValue("100");
    await expect(page.getByLabel("持续回合（本回合算 1）")).not.toHaveAttribute("max", /.+/);
    await expect(page.getByLabel("技能数值", { exact: true })).toHaveCount(0);
  }
  await page.getByLabel("生效概率（%）", { exact: true }).fill("12.25");
  await page.getByLabel("持续回合（本回合算 1）").fill("5000000000");
  assert.equal((await data())[0].effects[0].duration, 5000000000);
  assert.equal((await data())[0].effects[0].probability, 12.25);
  for (const label of ["令自己获得免疫", "令己方前排获得免疫", "令己方后排获得免疫", "令己方全员获得免疫"]) {
    await choose(label);
    await expect(page.getByLabel("生效回合（本回合算 1）")).toBeVisible();
    await expect(page.getByLabel("生效概率（%）", { exact: true })).toHaveCount(0);
  }
  for (const label of ["净化自己", "净化随机一名友军", "净化全体前排", "净化全体后排", "净化全体友军"]) {
    await choose(label);
    await expect(page.getByLabel("清除 debuff 数量", { exact: true })).toHaveValue("1");
    await expect(page.getByLabel(/回合（本回合算 1）/)).toHaveCount(0);
  }
  for (const label of ["禁止所有敌方单位复活", "禁止所有敌方前排单位复活", "禁止所有敌方后排单位复活"]) {
    await choose(label);
    await expect(page.getByLabel("持续回合（本回合算 1）")).toBeVisible();
  }
  await choose("令自己获得免疫");
  await page.getByRole("button", { name: "添加附加类型", exact: true }).click();
  const child = page.getByRole("combobox", { name: "技能类型", exact: true }).nth(1);
  await child.click(); await child.fill("禁止敌方受到本技能伤害的单位复活");
  await expect(page.getByRole("option", { name: "禁止敌方受到本技能伤害的单位复活", exact: true })).toBeDisabled();
  await child.press("Tab"); await expect(child).toHaveValue("");
  await choose("造成单体伤害");
  await choose("禁止敌方受到本技能伤害的单位复活", 1);
  await page.getByLabel("持续回合（本回合算 1）").fill("60");
  assert.equal((await data())[0].effects[0].additionalEffects[0].duration, 60);
  await expect(page.locator("#validation")).toHaveText("");
  await choose("令自己获得免疫");
  await expect(page.locator("#validation")).toContainText("须配置伤害类型");
  await page.getByRole("tab", { name: "3 星", exact: true }).click();
  await expect(page.locator("#validation")).toContainText("0星条件1");
  await page.getByRole("tab", { name: "0 星", exact: true }).click();
  await choose("造成单体伤害");
  await expect(child).toHaveValue("禁止敌方受到本技能伤害的单位复活");
  await page.getByRole("button", { name: "添加附加类型", exact: true }).click();
  await choose("立刻再次行动", 2);
  await page.getByRole("button", { name: "添加附加类型", exact: true }).click();
  await choose("对全部敌方造成伤害", 3);
  await page.getByLabel("0星条件1附加类型3无视防御比例", { exact: true }).fill("75.25");
  await page.getByRole("button", { name: "添加附加类型", exact: true }).click();
  await choose("令敌方所有单位眩晕", 4);
  await page.getByLabel("生效概率（%）", { exact: true }).fill("50");
  await page.getByLabel("持续回合（本回合算 1）").nth(1).fill("99");
  assert.equal((await data())[0].effects[0].additionalEffects[2].ignoreDefensePercent, 75.25);
  assert.equal((await data())[0].effects[0].additionalEffects[3].probability, 50);
  await expect(page.locator("#validation")).toHaveText("");
  const last = page.getByRole("combobox", { name: "技能类型", exact: true }).nth(4);
  await last.fill("不匹配的内容"); await expect(page.getByRole("option")).toHaveCount(0);
  await last.press("Tab"); await expect(last).toHaveValue("");
  await expect(page.locator("#validation")).toContainText("附加类型4");
  await choose("令敌方所有单位眩晕", 4);
  mkdirSync("artifacts/card-battle-control", { recursive: true });
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "附加类型不横向溢出");
    await page.locator("section").first().screenshot({ path: `artifacts/card-battle-control/editor-${viewport.width}.png` });
  }
  await expect(page.locator('[data-status-type="revival_block"]')).toHaveAttribute("data-status-category", "debuff");
  await expect(page.locator('[data-status-type="immunity"]')).toHaveAttribute("data-status-category", "buff");
  await expect(page.locator('[data-status-type="stunned"]')).toHaveAttribute("title", /剩余99回合/);
  await expect(page.locator('[data-status-type="immunity"]')).toHaveAttribute("title", /剩余365回合/);
  assert.deepEqual(errors, []);
  console.log("PASS: 19 control skills, attached-only and damage prerequisites, search/blur, cross-star validation, probability/cleanse/duration fields, >30 rounds, ignore defense on attached damage, responsive layouts and status categories");
} finally { await browser.close(); }

