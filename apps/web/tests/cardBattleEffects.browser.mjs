// Run after build:all. Real battle card and effects, without API/database access.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const bundled = await build({
  stdin: { resolveDir: resolve("apps/web"), loader: "tsx", contents: `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { BattleCard } from "./src/components/CardBattleRoomView";
    import { CARD_BATTLE_MOTIONS } from "./src/shared/cardBattleMotion";
    import { CARD_BATTLE_STATUS_ORDER } from "./src/shared/cardBattleEffects";
    import { seekCardBattleAnimations } from "./src/shared/cardBattlePlayback";
    const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#1e293b"/><path d="M50 40 75 60 65 105 35 105 25 60Z" fill="#475569"/></svg>');
    const card = { id:"target",cardNo:"001",name:"星辉骑士",starLevel:3,rarity:"epic",battleRole:"tank",combatPower:12345,imageUrl:image,motionMp4Url:null,stats:{maxHp:1000,energyRequired:30},skillName:"示例技能" };
    const statuses = [{type:"attack_up",value:100,multiplier:1,remainingRounds:1},{type:"attack_up",value:100,multiplier:.5,remainingRounds:3},...CARD_BATTLE_STATUS_ORDER.slice(1).map((type,i)=>({type,value:25,multiplier:1,remainingRounds:i+2}))];
    const state = { instanceId:"target",seat:2,slot:1,hp:800,maxHp:1000,energy:20,energyRequired:30,alive:true,statuses:[...statuses].reverse() };
    window.skillTypes=Object.keys(CARD_BATTLE_MOTIONS);
    window.seekFx=(time)=>{seekCardBattleAnimations(document.getElementById("root"),time);document.getElementById("root").getAnimations({subtree:true}).forEach(a=>a.pause());};
    function Harness(){
      const [type,setType]=useState("damage_single");const [prepare,setPrepare]=useState(false);const [proc,setProc]=useState(null);
      window.showEffect=setType;
      window.showProc=setProc;
      const spec=CARD_BATTLE_MOTIONS[type];
      const visual=type.startsWith("revive")?"revive":type.startsWith("heal_")?"heal":type.startsWith("damage")?"damage":type.includes("_down_")?"debuff":type.startsWith("energy")?"energy":"buff";
      const event=proc ? {sequence:100,kind:proc==="hit"||proc==="resist"?"attack":proc,visual:proc==="hit"||proc==="resist"?"damage":proc,actorId:"target",durationMs:1800,lifesteal:proc==="hit"?30:0,effects:[{targetId:"target",amount:-300,stunned:proc==="hit",stunResisted:proc==="resist",label:proc==="extra_action"?"再动":proc==="stun"?"眩晕，跳过行动":undefined}],states:[]} : {sequence:window.skillTypes.indexOf(type)+1,kind:"skill",effectType:type,visual,actorId:"caster",skillName:spec.label,durationMs:1800,effects:[{targetId:"target",amount:25}],states:[]};
      return <main style={{padding:32,color:"white",background:"#0f172a",minHeight:"100vh"}}><button onClick={()=>setPrepare(v=>!v)}>切换准备阶段</button><h1 style={{margin:"24px 0"}}>{spec.label}</h1><div style={{display:"flex",justifyContent:"center",gap:60,padding:"40px 0"}}><BattleCard key={type+prepare} card={card} state={state} cardBack={false} seat={2} activeEvent={prepare?null:event} showPower={prepare}/></div><p>同类独立 · 剩余回合 · 按类型排序</p></main>;
    }
    createRoot(document.getElementById("root")).render(<Harness/>);
  ` }, bundle: true, write: false, format: "iife", define: { "import.meta.env": "{}" },
});
const css = readdirSync(resolve("apps/web/dist/assets")).find((file) => file.startsWith("index-") && file.endsWith(".css"));
assert.ok(css, "先执行Web构建");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? undefined : "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
  await page.addStyleTag({ content: readFileSync(resolve("apps/web/dist/assets", css), "utf8") });
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await expect(page.locator("[data-status-type]")).toHaveCount(21);
  await expect(page.locator('[data-status-type="attack_up"] small')).toHaveText(["3", "1"]);
  await expect(page.getByText("战力 12,345", { exact:true })).toHaveCount(0);
  const types = await page.evaluate(()=>window.skillTypes);
  assert.equal(types.length,74);
  for (const type of types) {
    await page.evaluate(type=>window.showEffect(type),type);
    await expect(page.locator(`[data-skill-effect="${type}"]`)).toHaveCount(1);
    const names = await page.evaluate(()=>{window.seekFx(720);return document.querySelector(".card-battle-skill-fx").getAnimations({subtree:true}).map(a=>({name:a.animationName,time:a.currentTime}));});
    assert.ok(names.length>=6, type);
    assert.ok(names.every(a=>a.name.startsWith("card-battle-")&&a.time===720),type+" 服务器进度定位");
  }
  const rail = page.locator(".card-battle-status-rail");
  assert.ok(await rail.evaluate(el=>el.scrollWidth>el.clientWidth), "多层在卡内横向滚动");
  for (const viewport of [{width:375,height:812},{width:812,height:375},{width:1440,height:1000}]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"页面不横向溢出");
    const boxes=await page.evaluate(()=>{const rail=document.querySelector('.card-battle-status-rail').getBoundingClientRect();const hp=document.querySelector('[aria-label^="生命比例"]').getBoundingClientRect();return{rail:rail.top,hp:hp.bottom};});
    assert.ok(boxes.rail>=boxes.hp,"状态位于生命条下方");
  }
  await page.getByRole("button",{name:"切换准备阶段"}).click();
  await expect(page.getByText("战力 12,345",{exact:true})).toBeVisible();
  await expect(rail).toHaveCount(0);
  await page.getByRole("button",{name:"切换准备阶段"}).click();
  await page.evaluate(()=>window.showEffect("revive_all_allies"));
  await expect(page.locator('[data-motion="summon"]')).toHaveCount(1);
  await page.emulateMedia({reducedMotion:"reduce"});
  assert.ok(await page.evaluate(()=>{window.seekFx(720);return document.querySelector('.card-battle-skill-symbol').getAnimations().every(a=>a.animationName==="card-battle-skill-reduced");}));
  await page.emulateMedia({reducedMotion:"no-preference"});
  await page.setViewportSize({width:375,height:812});
  await page.evaluate(()=>window.seekFx(720));
  const output=mkdtempSync(resolve(tmpdir(),"hgt-card-battle-effects-"));
  await page.screenshot({path:resolve(output,"revive-mobile.png")});
  await page.evaluate(()=>window.showEffect("defense_down_single"));
  await expect(page.locator('[data-skill-effect="defense_down_single"]')).toHaveCount(1);
  await page.evaluate(()=>window.seekFx(1050));
  await page.screenshot({path:resolve(output,"shield-break-mobile.png")});
  for (const [proc, motions] of [["hit", ["lifesteal","stun"]], ["extra_action", ["extra_action"]], ["stun", ["stun"]], ["resist", []]]) {
    await page.evaluate(proc=>window.showProc(proc), proc);
    await expect(page.locator(".card-battle-skill-fx")).toHaveCount(motions.length);
    for (const motion of motions) await expect(page.locator(`[data-skill-effect="${motion}"]`)).toHaveCount(1);
    if (proc === "hit") {
      await expect(page.getByText("吸血 +30", {exact:true})).toBeVisible();
      await expect(page.getByText("眩晕·本回合", {exact:true})).toBeVisible();
    }
    if (proc === "resist") await expect(page.getByText("抵抗击晕", {exact:true})).toBeVisible();
    if (["extra_action", "stun"].includes(proc)) await expect(page.locator(".card-battle-hit")).toHaveCount(0);
    assert.ok(await page.evaluate(()=>{window.seekFx(720);return [...document.querySelectorAll('.card-battle-skill-fx')].flatMap(el=>el.getAnimations({subtree:true})).every(a=>a.currentTime===720);}), proc+" 触发动画按服务器进度定位");
    await page.screenshot({path:resolve(output,`proc-${proc}-mobile.png`)});
    await page.emulateMedia({reducedMotion:"reduce"});
    assert.ok(await page.evaluate(()=>{window.seekFx(720);return [...document.querySelectorAll('.card-battle-skill-symbol')].flatMap(el=>el.getAnimations()).every(a=>a.animationName==="card-battle-skill-reduced");}),proc+" 减少动态效果");
    await page.emulateMedia({reducedMotion:"no-preference"});
  }
  assert.deepEqual(errors,[]);
  console.log("PASS: all 74 skill animations, lifesteal/stun/extra-action proc feedback, 21 independent status layers, server seek, preparation-only power, mobile/landscape/desktop and reduced motion");
  console.log("Screenshots: " + output);
} finally { await browser.close(); }
