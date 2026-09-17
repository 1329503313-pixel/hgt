// Run after build:all from the repository root. No API or database is accessed.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
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
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true, reducedMotion: "reduce" });
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
  const typeSelect = page.getByRole("combobox", { name: "技能类型", exact: true });
  const conditionSelect = page.getByRole("combobox", { name: "技能条件", exact: true });
  await typeSelect.click();
  const typeOptions = await page.getByRole("listbox").getByRole("option").evaluateAll(options => options.map(option => ({value: option.dataset.value, label: option.textContent})));
  const chooseType = async (type) => {
    const option = typeOptions.find(option => option.value === type);
    assert.ok(option, type);
    await typeSelect.click();
    await typeSelect.fill(option.label);
    await page.getByRole("listbox").getByRole("option", { name: option.label, exact: true }).click();
  };
  await conditionSelect.fill("死亡");
  const deathMatches = await page.getByRole("listbox").getByRole("option").allTextContents();
  assert.ok(deathMatches.length > 0 && deathMatches.every(label => label.includes("死亡")));
  await page.getByRole("listbox").getByRole("option", { name: "本卡片死亡", exact: true }).tap();
  await expect(conditionSelect).toHaveValue("本卡片死亡");
  await chooseType("revive_self");
  await conditionSelect.fill("能量为满");
  await conditionSelect.press("ArrowDown");
  await conditionSelect.press("Enter");
  await expect(conditionSelect).toHaveValue("能量为满");
  await expect(typeSelect).toHaveValue("复活一名友军");
  await typeSelect.fill("复活自己");
  await expect(page.getByRole("listbox").getByRole("option", { name: "复活自己", exact: true })).toBeDisabled();
  await typeSelect.press("ArrowDown");
  await typeSelect.press("Enter");
  await typeSelect.press("Tab");
  await expect(typeSelect).toHaveValue("");
  await chooseType("damage_single");
  for (const field of [conditionSelect, typeSelect]) {
    await field.fill("不存在的内容");
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(0);
    await field.press("Tab");
    await expect(field).toHaveValue("");
  }
  // Exact text still needs a choice; blur never silently commits it.
  await conditionSelect.fill("能量为满");
  await conditionSelect.press("Tab");
  await expect(conditionSelect).toHaveValue("");
  assert.equal(JSON.parse(await page.locator("#data").textContent())[0].effects[0].condition, "");
  await page.getByRole("tab", { name: "3 星", exact: true }).click();
  await page.getByRole("tab", { name: "0 星", exact: true }).click();
  await expect(conditionSelect).toHaveValue("");
  await expect(typeSelect).toHaveValue("");
  await conditionSelect.fill("生命值");
  await conditionSelect.press("ArrowDown");
  await conditionSelect.dispatchEvent("compositionstart");
  await conditionSelect.press("Enter");
  assert.equal(JSON.parse(await page.locator("#data").textContent())[0].effects[0].condition, "", "中文输入法回车不确认选项");
  await conditionSelect.dispatchEvent("compositionend");
  await conditionSelect.press("Enter");
  await expect(page.getByLabel("生命值阈值（%）", { exact: true })).toHaveValue("50");
  await conditionSelect.fill("能量为满");
  await conditionSelect.press("ArrowDown");
  await conditionSelect.press("Enter");
  await expect(page.getByLabel("生命值阈值（%）", { exact: true })).toHaveCount(0);
  await typeSelect.fill("后排");
  const rearMatches = await page.getByRole("listbox").getByRole("option").allTextContents();
  assert.ok(rearMatches.length > 0 && rearMatches.every(label => label.includes("后排")));
  mkdirSync("artifacts/card-battle-skill-search", { recursive: true });
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await typeSelect.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: `artifacts/card-battle-skill-search/matches-${viewport.width}.png` });
  }
  await typeSelect.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(typeSelect).toHaveValue("");
  await chooseType("damage_single");
  const ignoreDefense = page.getByLabel("0星条件1无视防御比例", { exact: true });
  await expect(ignoreDefense).toHaveValue("0");
  await expect(ignoreDefense).toHaveAttribute("min", "0");
  await expect(ignoreDefense).toHaveAttribute("max", "100");
  await expect(ignoreDefense).toHaveAttribute("step", "0.01");
  const damageTypes = typeOptions.map(option => option.value).filter(value => value.startsWith("damage_") && !value.startsWith("damage_true_"));
  assert.ok(damageTypes.length >= 9);
  for (const type of damageTypes) {
    await chooseType(type);
    await expect(ignoreDefense).toBeVisible();
    await ignoreDefense.fill("37.25");
    assert.equal(JSON.parse(await page.locator("#data").textContent())[0].effects[0].ignoreDefensePercent, 37.25);
    await ignoreDefense.focus();
    await expect(ignoreDefense).toBeFocused();
  }
  for (const [input, expected] of [["0", "0"], ["100", "100"], ["-1", "0"], ["101", "100"], ["", "0"]]) {
    await ignoreDefense.fill(input);
    await expect(ignoreDefense).toHaveValue(expected);
  }
  await ignoreDefense.fill("37.25");
  await page.getByRole("tab", { name: "3 星", exact: true }).click();
  await page.getByRole("button", { name: "新增条件" }).click();
  const threeStarIgnore = page.getByLabel("3星条件1无视防御比例", { exact: true });
  await expect(threeStarIgnore).toHaveValue("0");
  await threeStarIgnore.fill("100");
  await page.getByRole("tab", { name: "0 星", exact: true }).click();
  await expect(ignoreDefense).toHaveValue("37.25");
  await page.getByRole("button", { name: "新增条件" }).click();
  const secondRowIgnore = page.getByLabel("0星条件2无视防御比例", { exact: true });
  await expect(secondRowIgnore).toHaveValue("0");
  await secondRowIgnore.fill("50");
  await expect(ignoreDefense).toHaveValue("37.25");
  const damageData = JSON.parse(await page.locator("#data").textContent());
  assert.deepEqual(damageData[0].effects.map(effect => effect.ignoreDefensePercent), [37.25, 50]);
  assert.equal(damageData[3].effects[0].ignoreDefensePercent, 100);
  await page.getByRole("button", { name: "删除条件2", exact: true }).click();
  mkdirSync("artifacts/card-battle-ignore-defense", { recursive: true });
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "忽防字段不造成横向溢出");
    await page.locator("section").first().screenshot({ path: `artifacts/card-battle-ignore-defense/editor-${viewport.width}.png` });
  }
  for (const type of ["heal_self", "energy_self", "attack_skill_damage_self", "revive_ally_1"]) {
    await chooseType(type);
    await expect(ignoreDefense).toHaveCount(0);
    assert.equal(JSON.parse(await page.locator("#data").textContent())[0].effects[0].ignoreDefensePercent, 0);
  }
  await chooseType("damage_single");
  await expect(ignoreDefense).toHaveValue("0");
  const debuffs = typeOptions.map(option => option.value).filter(value => value.includes("_down_"));
  assert.equal(debuffs.length, 38);
  for (const type of debuffs) {
    await chooseType(type);
    await expect(ignoreDefense).toHaveCount(0);
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
  const procs = typeOptions.map(option => option.value).filter(value => /^(lifesteal|stun|extra_action)_/.test(value) && !value.startsWith("stun_enemy_"));
  assert.equal(procs.length, 18);
  for (const type of procs) {
    await chooseType(type);
    await expect(page.getByLabel(/^属性变化（百分点）/)).toBeVisible();
    await expect(page.getByLabel("持续回合（本回合算 1）")).toBeVisible();
    await page.getByLabel(/^属性变化（百分点）/).fill("25");
    await page.getByLabel("持续回合（本回合算 1）").fill("3");
    const current = JSON.parse(await page.locator("#data").textContent())[0].effects[0];
    assert.equal(current.value, 25); assert.equal(current.duration, 3); assert.equal(current.type, type);
  }
  assert.deepEqual(errors, []);
  console.log("PASS: critical/proc presets, all damage skill ignore-defense fields, 0–100% limits, decimal editing, per-row/star independence, type switching, keyboard order, 38 debuffs and 18 proc skills, responsive layout and reduced motion");
} finally {
  await browser.close();
}
