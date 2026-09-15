import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
const bundle=await build({stdin:{resolveDir:resolve('apps/web'),loader:'tsx',contents:`
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {CardBattleConfigEditor} from './src/components/admin/CardBattleConfigEditor';
import {cardBattleSelectionError} from './src/components/admin/cardBattleEditorDraft';
import {defaultCardBattleTiersForRarity} from './src/shared/digitalAssets';
import {CardBattleStatusIcons,CardBattleSkillFx} from './src/components/CardBattleEffects';
function Harness(){const [tiers,setTiers]=useState(defaultCardBattleTiersForRarity('epic'));const [star,setStar]=useState(0);
return <main className="mx-auto max-w-5xl p-3"><CardBattleConfigEditor tiers={tiers} activeStar={star} onActiveStar={setStar} onChange={setTiers}/>
<output id="data" hidden>{JSON.stringify(tiers)}</output><output id="validation" hidden>{cardBattleSelectionError(tiers)}</output>
<div id="states"><CardBattleStatusIcons statuses={[{type:'speed_down',category:'debuff',flat:true,value:30,remainingRounds:2,multiplier:1},{type:'attack_up',value:100,remainingRounds:1,multiplier:1},{type:'attack_up',value:200,remainingRounds:2,multiplier:1}]}/></div>
<div id="fx" className="relative h-32 overflow-hidden"><CardBattleSkillFx instanceId="target" event={{sequence:1,round:1,kind:'skill',visual:'buff',effectType:'attack_self',actorId:'owner',skillName:'羁绊技能',bond:{ownerId:'owner',triggerId:'target'},effects:[{targetId:'target',amount:100}],states:[],durationMs:1000,text:'羁绊增加攻击'}}/></div>
</main>;}createRoot(document.getElementById('root')).render(<Harness/>);
`},bundle:true,write:false,format:'iife'});
const css=readdirSync('apps/web/dist/assets').find(file=>file.startsWith('index-')&&file.endsWith('.css'));
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM==='1'?undefined:'msedge',headless:true});
try {
  const page=await browser.newPage({viewport:{width:375,height:812},hasTouch:true,reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
  await page.addStyleTag({content:readFileSync(resolve('apps/web/dist/assets',css),'utf8')});await page.addScriptTag({content:bundle.outputFiles[0].text});
  const data=async()=>JSON.parse(await page.locator('#data').textContent());
  const choose=async(label,value,n=0)=>{const field=page.getByRole('combobox',{name:label,exact:true}).nth(n);await field.fill(value);await page.getByRole('option',{name:value,exact:true}).click();};
  await page.getByRole('button',{name:'新增羁绊条件',exact:true}).click();
  await page.getByLabel('羁绊条件1卡牌序号').fill('001  002 001');
  assert.deepEqual((await data())[0].bonds[0].cardNos,['001','002']);
  await expect(page.getByRole('combobox',{name:'羁绊技能对象',exact:true})).toHaveCount(0);
  await choose('卡牌行动','普通攻击');
  await expect(page.getByRole('combobox',{name:'羁绊技能类型',exact:true})).toHaveCount(0);
  await choose('羁绊技能对象','随机四张卡');await choose('羁绊技能类型','立即增加攻击力');
  await page.getByLabel('羁绊条件1效果1数值').fill('120');await page.getByLabel('羁绊条件1效果1回合').fill('2');
  await page.getByRole('button',{name:'添加羁绊效果',exact:true}).click();
  await choose('羁绊技能对象','羁绊卡',1);await choose('羁绊技能类型','立即无视能量释放技能并清空能量',1);
  await expect(page.getByLabel('羁绊条件1效果2数值')).toHaveCount(0);await expect(page.getByLabel('羁绊条件1效果2回合')).toHaveCount(0);
  await expect(page.locator('#validation')).toHaveText('');
  await choose('羁绊技能类型','立即恢复生命值',1);await page.getByLabel('羁绊条件1效果2数值').fill('333');await expect(page.getByLabel('羁绊条件1效果2回合')).toHaveCount(0);
  await choose('羁绊技能类型','立即增加击晕率',1);await page.getByLabel('羁绊条件1效果2数值').fill('12.25');await page.getByLabel('羁绊条件1效果2回合').fill('3');
  await expect(page.locator('#validation')).toHaveText('');
  await page.getByLabel('羁绊条件1效果2数值').fill('101');await expect(page.locator('#validation')).toContainText('概率不超过100');await page.getByLabel('羁绊条件1效果2数值').fill('12.25');
  await page.getByRole('tab',{name:'3 星',exact:true}).click();await expect(page.getByText('尚未配置羁绊技能')).toBeVisible();
  await page.getByRole('tab',{name:'0 星',exact:true}).click();await expect(page.getByLabel('羁绊条件1卡牌序号')).toHaveValue('001 002');
  assert.equal((await data())[0].bonds[0].actions[1].value,12.25);
  await choose('卡牌行动','被增加护盾');await expect(page.getByText('此条件已预留，将在新增护盾机制后生效。')).toBeVisible();
  await choose('卡牌行动','能量为空');
  await page.getByRole('button',{name:'新增条件',exact:true}).click();
  assert.equal((await data())[0].effects.length,1);assert.equal((await data())[0].bonds.length,1);
  await page.getByRole('button',{name:'新增羁绊条件',exact:true}).click();await page.getByRole('button',{name:'删除羁绊条件2',exact:true}).click();
  await expect(page.locator('#validation')).toHaveText('');
  await expect(page.locator('[data-status-type="speed_down"]')).toHaveAttribute('title',/30点/);
  await expect(page.locator('[data-status-type="attack_up"]')).toHaveCount(2);
  await expect(page.locator('#fx [data-skill-effect="attack_self"]')).toHaveClass(/is-target/);
  mkdirSync('artifacts/card-battle-bonds',{recursive:true});
  for(const viewport of [{width:375,height:812},{width:812,height:375},{width:1440,height:1000}]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'无横向溢出');
    await page.getByRole('region',{name:'羁绊技能配置'}).screenshot({path:`artifacts/card-battle-bonds/editor-${viewport.width}.png`});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: 羁绊编辑、空格序号、渐进字段、附加效果、数值验证、星级隔离、护盾预留、Buff单位、目标动画及三个宽度');
} finally {await browser.close();}
