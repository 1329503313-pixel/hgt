import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const bundle = await build({ stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{CardBattleConfigEditor}from'./src/components/admin/CardBattleConfigEditor';
import{defaultCardBattleTiersForRarity}from'./src/shared/digitalAssets';
import{cardBattleSelectionError}from'./src/components/admin/cardBattleEditorDraft';
function Harness(){const[tiers,setTiers]=useState(defaultCardBattleTiersForRarity('epic'));const[star,setStar]=useState(0);
return <main className="mx-auto max-w-5xl p-3"><CardBattleConfigEditor tiers={tiers} activeStar={star} onActiveStar={setStar} onChange={setTiers}/><output hidden id="data">{JSON.stringify(tiers)}</output><output hidden id="error">{cardBattleSelectionError(tiers)}</output></main>}
createRoot(document.getElementById('root')).render(<Harness/>);` }, bundle: true, write: false, format: 'iife', define: { 'import.meta.env': '{}' } });
const oldCwd = process.cwd(); process.chdir(resolve('apps/web'));
const css = await postcss([tailwind(), autoprefixer()]).process(readFileSync('src/styles.css', 'utf8').replace('@import "./cardBattleEffects.css";',readFileSync('src/cardBattleEffects.css','utf8')), { from: resolve('src/styles.css') });
process.chdir(oldCwd);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
  await page.addStyleTag({ content: css.css }); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(page.getByLabel('0星反击率', { exact: true })).toHaveValue('0');
  await page.getByLabel('0星反击率', { exact: true }).fill('12.25');
  await page.getByLabel('0星攻击力', { exact: true }).fill('1000');
  await page.getByLabel('0星速度', { exact: true }).fill('100');
  await page.getByRole('button', { name: '新增条件', exact: true }).click();
  await expect(page.getByLabel('0星条件1伤害类型', { exact: true })).toHaveValue('fixed');
  await page.getByLabel('0星条件1技能数值', { exact: true }).fill('1234');
  await page.getByRole('button', { name: '审计', exact: true }).click();
  await expect(page.getByText('计算结果：1234', { exact: true })).toBeVisible();
  await page.getByLabel('0星条件1伤害类型', { exact: true }).selectOption('formula');
  const field = page.getByLabel('0星条件1计算数值', { exact: true });
  assert.equal(await field.getAttribute('readonly'), '');
  const source = name => page.getByRole('group', { name: '0星条件1数值来源', exact: true }).getByRole('button', { name, exact: true }).click();
  const op = name => page.getByRole('button', { name: `插入${name}`, exact: true }).click();
  const number = async value => { await page.getByLabel('0星条件1具体数字', { exact: true }).fill(value); await page.getByRole('button', { name: '插入数字', exact: true }).click(); };
  await op('('); await source('攻击力'); await op('*'); await number('1.1'); await op(')'); await op('+'); await source('速度'); await op('*'); await number('5');
  await expect(field).toHaveValue('(攻击力*1.1)+速度*5');
  await page.getByRole('button', { name: '审计', exact: true }).click();
  await expect(page.getByText('计算结果：1600', { exact: true })).toBeVisible();
  await expect(page.locator('#error')).toHaveText('');
  await op('/'); await number('0');
  await page.getByRole('button', { name: '审计', exact: true }).click();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('计算公式不正确：除数不能为0', { exact: true })).toBeVisible();
  await expect(page.locator('#error')).toContainText('计算公式不正确');
  const border = await field.evaluate(el => getComputedStyle(el).borderColor);
  assert.match(border, /239, 68, 68/);
  await page.getByRole('button', { name: '退格', exact: true }).click();
  await page.getByRole('button', { name: '退格', exact: true }).click();
  await expect(field).toHaveValue('(攻击力*1.1)+速度*5');
  await page.getByRole('button', { name: '审计', exact: true }).click();
  await expect(page.getByText('计算结果：1600', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加附加类型', exact: true }).click();
  await page.getByRole('combobox', { name: '技能类型', exact: true }).nth(1).fill('造成真实伤害');
  await page.getByRole('option', { name: '造成真实伤害', exact: true }).click();
  await page.getByLabel('0星条件1附加类型1伤害类型', { exact: true }).selectOption('formula');
  await page.getByRole('group', { name: '0星条件1附加类型1数值来源', exact: true }).getByRole('button', { name: '当前能量', exact: true }).click();
  await page.getByRole('tab', { name: '2 星', exact: true }).click();
  await page.getByRole('button', { name: '复制零星技能', exact: true }).click();
  const draft = JSON.parse(await page.locator('#data').textContent());
  assert.equal(draft[2].counterRate, 0, '复制技能不覆盖属性');
  assert.equal(draft[2].energyRequired, draft[0].energyRequired);
  assert.equal(draft[2].effects[0].damageFormula, '(攻击力*1.1)+速度*5');
  assert.equal(draft[2].effects[0].additionalEffects[0].damageFormula, '当前能量');
  assert.notEqual(draft[2].effects[0].id, draft[0].effects[0].id, '跨星级复制生成新的技能主键');
  assert.notEqual(draft[2].effects[0].additionalEffects[0].id, draft[0].effects[0].additionalEffects[0].id, '附加效果也使用独立ID');
  await page.getByRole('button', { name: '复制零星技能', exact: true }).click();
  const recopied = JSON.parse(await page.locator('#data').textContent());
  assert.notEqual(recopied[2].effects[0].id, draft[2].effects[0].id, '重复复制生成新的技能ID');
  for (const star of [1, 3]) {
    await page.getByRole('tab', { name: `${star} 星`, exact: true }).click();
    await page.getByRole('button', { name: '复制零星技能', exact: true }).click();
  }
  const allCopied = JSON.parse(await page.locator('#data').textContent());
  const effectIds = allCopied.flatMap(tier => tier.effects.map(effect => effect.id));
  assert.equal(new Set(effectIds).size, effectIds.length, '四个星级的技能ID全部唯一');
  await page.getByRole('tab', { name: '2 星', exact: true }).click();
  await page.getByLabel('2星条件1伤害类型', { exact: true }).selectOption('fixed');
  await page.getByLabel('2星条件1技能数值', { exact: true }).fill('999');
  await page.getByRole('tab', { name: '0 星', exact: true }).click();
  await expect(page.getByLabel('0星条件1计算数值', { exact: true })).toHaveValue('(攻击力*1.1)+速度*5');
  const choose = async name => { await page.getByRole('combobox', { name: '技能类型', exact: true }).first().fill(name); await page.getByRole('option', { name, exact: true }).click(); };
  for (const name of ['增加自身反击率', '增加全体友军反击率', '降低全体敌军反击率']) {
    await choose(name); await expect(page.getByLabel('0星条件1伤害类型', { exact: true })).toHaveCount(0);
  }
  await choose('造成单体伤害');
  await page.getByLabel('0星条件1伤害类型', { exact: true }).selectOption('formula');
  await source('攻击力');
  mkdirSync('artifacts/card-battle-counter-formula', { recursive: true });
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `无横向溢出 ${viewport.width}`);
    await page.screenshot({ path: `artifacts/card-battle-counter-formula/editor-${viewport.width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: 公式点选、1600审计、除零红框及保存拦截、附加公式、跨星级复制隔离、三种反击技能和三个屏幕宽度');
} finally { await browser.close(); }
