import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const bundle = await build({ stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{CardBattleConfigEditor}from'./src/components/admin/CardBattleConfigEditor';
import{defaultCardBattleTiersForRarity}from'./src/shared/digitalAssets';
import{BattleCard}from'./src/components/CardBattleRoomView';
const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="210"><rect width="150" height="210" fill="#142c46"/><path d="M75 25 120 70 100 155 50 155 30 70Z" fill="#537899"/></svg>');
function Harness(){const [tiers,setTiers]=useState(defaultCardBattleTiersForRarity('epic'));const [star,setStar]=useState(0);
const [dodged,setDodged]=useState(true);window.setDodge=setDodged;
const card={id:'target',cardNo:'001',name:'护盾守卫',imageUrl:image,rarity:'epic',battleRole:'tank',starLevel:0,combatPower:1000,stats:tiers[0],skillName:'守护',skillDescription:'护盾'};
const states=[1,2].map(seat=>({instanceId:'target'+seat,userId:'u'+seat,seat,slot:1,row:'front',hp:800,maxHp:1000,energy:10,energyRequired:50,attack:100,defense:50,speed:100,alive:true,shield:250,dodgeRate:40,hitRate:10,statuses:[{type:'shield',value:150,remainingRounds:1,multiplier:1},{type:'shield',value:100,remainingRounds:3,multiplier:1},{type:'dodge_up',value:30,remainingRounds:2,multiplier:1}]}));
return <main className="mx-auto max-w-5xl p-3"><section id="arena" aria-label="护盾闪避演示" className="mb-6 flex flex-wrap justify-center gap-12 rounded-2xl bg-slate-950 px-4 py-14">{states.map(state=><div className="w-28" key={state.seat}><BattleCard card={card} state={state} seat={state.seat} showPower={false} cardBack={false} activeEvent={{sequence:dodged?1:2,round:1,kind:'skill',visual:'damage',effectType:'damage_true_single',actorId:'opponent',skillName:'追击',effects:[{targetId:state.instanceId,dodged,amount:dodged?0:-100,shieldDamage:dodged?0:100,hpDamage:0,label:dodged?'闪避':undefined}],states,durationMs:1300,text:'战斗'}}/></div>)}</section>
<CardBattleConfigEditor tiers={tiers} activeStar={star} onActiveStar={setStar} onChange={setTiers}/><output hidden id="data">{JSON.stringify(tiers)}</output></main>}
createRoot(document.getElementById('root')).render(<Harness/>);
` }, bundle: true, write: false, format: 'iife', define: { 'import.meta.env': '{}' } });
const css = readdirSync('apps/web/dist/assets').find(file => file.startsWith('index-') && file.endsWith('.css'));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === '1' ? undefined : 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
  await page.addStyleTag({ content: readFileSync(resolve('apps/web/dist/assets', css), 'utf8') });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(page.getByLabel('0星闪避率', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('0星命中率', { exact: true })).toHaveValue('0');
  await page.getByLabel('0星闪避率', { exact: true }).fill('20.25');
  await page.getByLabel('0星命中率', { exact: true }).fill('10.5');
  await page.getByRole('tab', { name: '3 星', exact: true }).click();
  await expect(page.getByLabel('3星闪避率', { exact: true })).toHaveValue('0');
  await page.getByRole('tab', { name: '0 星', exact: true }).click();
  await expect(page.getByLabel('0星闪避率', { exact: true })).toHaveValue('20.25');
  await page.getByRole('button', { name: '新增条件', exact: true }).click();
  const choose = async name => { await page.getByRole('combobox', { name: '技能类型', exact: true }).fill(name); await page.getByRole('option', { name, exact: true }).click(); };
  const names = ['为自己增加护盾值','为友军前排增加护盾值','为友军后排增加护盾值','为友军全员增加护盾值','造成真实伤害','对1名随机敌人造成真实伤害','对2名随机敌人造成真实伤害','对3名随机敌人造成真实伤害','对全体敌人造成真实伤害','为自己增加闪避率','为友军前排增加闪避率','为友军全员增加闪避率','为自己增加命中率','为友军后排增加命中率','为友军全员增加命中率'];
  for (const name of names) {
    await choose(name);
    const action = JSON.parse(await page.locator('#data').textContent())[0].effects[0];
    assert.equal(action.ignoreDefensePercent, 0);
    assert.ok(action.value > 0);
    assert.equal(action.duration, name.includes('真实伤害') ? null : 1);
    await expect(page.getByLabel('0星条件1无视防御比例', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('spinbutton', { name: '持续回合（本回合算 1）', exact: true })).toHaveCount(name.includes('真实伤害') ? 0 : 1);
  }
  await expect(page.getByText('按百分点全额叠加，各层独立计算持续回合。')).toBeVisible();
  await choose('为自己增加护盾值');
  await page.getByRole('spinbutton', { name: '技能数值', exact: true }).fill('500');
  await page.getByRole('spinbutton', { name: '持续回合（本回合算 1）', exact: true }).fill('3');
  const draft = JSON.parse(await page.locator('#data').textContent())[0];
  assert.equal(draft.effects[0].value, 500); assert.equal(draft.effects[0].duration, 3);
  await expect(page.locator('#arena [data-status-type="shield"]')).toHaveCount(4);
  await expect(page.locator('#arena [data-status-type="shield"]').first()).toHaveAttribute('title', /剩余150点，剩余1回合/);
  await expect(page.locator('#arena [aria-label="护盾值 250"]')).toHaveCount(2);
  await expect(page.locator('#arena').getByText('闪避', { exact: true })).toHaveCount(2);
  await expect(page.locator('#arena .card-battle-hit')).toHaveCount(0);
  await expect(page.locator('#arena [data-skill-effect]')).toHaveCount(0);
  const pauseDodge = () => page.locator('#arena').evaluate(el => { for (const animation of el.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = 620; } });
  await page.locator('#arena').scrollIntoViewIfNeeded();
  await pauseDodge();
  const translate = await page.locator('#arena .card-battle-dodge').evaluateAll(elements => elements.map(el => new DOMMatrix(getComputedStyle(el).transform).m42));
  assert.ok(translate[0] > 0 && translate[1] < 0, '双方均朝各自后方闪避');
  mkdirSync('artifacts/card-battle-defense', { recursive: true });
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport); await pauseDodge();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '无横向溢出');
    assert.ok(await page.locator('#arena [data-battle-instance]').first().evaluate(el => el.querySelector('[aria-label="护盾值 250"]').getBoundingClientRect().top >= el.querySelector('.card-battle-status-rail').getBoundingClientRect().bottom), '护盾数值不被状态图标遮挡');
    await page.locator('#arena').screenshot({ path: `artifacts/card-battle-defense/dodge-${viewport.width}.png` });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.locator('#arena .card-battle-dodge').first().evaluate(el => getComputedStyle(el).animationName);
  assert.equal(reduced, 'card-battle-hit-reduced');
  await expect(page.locator('#arena').getByText('闪避', { exact: true })).toHaveCount(2);
  await page.evaluate(() => window.setDodge(false));
  await expect(page.locator('#arena').getByText('闪避', { exact: true })).toHaveCount(0);
  await expect(page.locator('#arena').getByText('护盾 -100', { exact: true })).toHaveCount(2);
  assert.deepEqual(errors, []);
  console.log('PASS: 15种技能配置、概率默认值和星级隔离、真实伤害字段约束、独立护盾层、双方后撤闪避、减少动态效果及三个屏幕宽度');
} finally { await browser.close(); }
