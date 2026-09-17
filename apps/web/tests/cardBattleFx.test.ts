import test from "node:test";
import assert from "node:assert/strict";
import { CARD_BATTLE_BOND_ACTIONS } from "@hgt/shared";
import { cardBattleEffectCodes } from "../../server/src/cardBattle.js";
import { CARD_BATTLE_MOTIONS } from "../src/shared/cardBattleMotion";
import { BOND_FX_FAMILIES, cardBattleImpactMs, effectFamily, eventFx, fxParticles, targetFeedback } from "../src/shared/cardBattleFx";
import type { OnlineCardBattleEvent } from "../src/shared/types";
const event = (overrides: Partial<OnlineCardBattleEvent> = {}): OnlineCardBattleEvent => ({ sequence:1, round:1, kind:"skill", visual:"buff", actorId:"source", skillName:null, effects:Array.from({length:9},(_,i)=>({targetId:"target"+i})), states:[], durationMs:1000, text:"", ...overrides });
test("独立权威清单中的全部技能和羁绊均有明确配方", () => {
  assert.deepEqual(Object.keys(CARD_BATTLE_MOTIONS).sort(),[...cardBattleEffectCodes].sort());
  for (const type of cardBattleEffectCodes) assert.notEqual(effectFamily(type,CARD_BATTLE_MOTIONS[type]),"neutral",type);
  assert.deepEqual(Object.keys(BOND_FX_FAMILIES).sort(),Object.keys(CARD_BATTLE_BOND_ACTIONS).sort());
  assert.notEqual(BOND_FX_FAMILIES.skill_damage_up,BOND_FX_FAMILIES.attack_skill_damage_up);
  assert.notEqual(BOND_FX_FAMILIES.crit_rate_up,BOND_FX_FAMILIES.hit_up);
});
test("九友军与源卡共用有界、可重放的粒子分配", () => {
  for (const quality of ["standard","economy"] as const) for(const count of [1,5,9,14,40]) {
    const e=event({effects:Array.from({length:count},(_,i)=>({targetId:"target"+i}))});
    const particles=["source",...e.effects.map(e=>e.targetId)].map(id=>fxParticles(e,id,quality));
    assert.ok(particles.every(p=>p.length<=(quality==="standard"?6:2)));
    assert.ok(particles.reduce((sum,p)=>sum+p.length,0)<=(quality==="standard"?24:8));
    assert.deepEqual(fxParticles(e,"target0",quality),fxParticles(structuredClone(e),"target0",quality));
  }
});
test("旧增益事件中性兼容，羁绊使用动作元数据，已有技能语义优先", () => {
  assert.equal(eventFx(event()).family,"neutral");
  assert.equal(eventFx(event({bond:{ownerId:"source",triggerId:"target0",actionType:"crit_damage_up"}})).family,"critical");
  assert.equal(eventFx(event({effectType:"heal_all_allies",bond:{ownerId:"source",triggerId:"target0",actionType:"skill"}})).family,"heal");
});
test("闪避、保护、盾吸收和真实破盾不误判，抵抗击晕仍允许伤害反馈", () => {
  const e=event({visual:"damage",effects:[{targetId:"t",dodged:true,amount:0}]});assert.equal(targetFeedback(e,"t"),"dodge");
  for(const protection of ["invincible","death_protection","resisted"] as const) assert.equal(targetFeedback({...e,effects:[{targetId:"t",protection}]},"t"),protection);
  assert.equal(targetFeedback({...e,effects:[{targetId:"t",shieldDamage:20,hpDamage:0}],states:[{instanceId:"t",shield:0} as never]},"t"),"shield-break");
  assert.equal(targetFeedback({...e,effects:[{targetId:"t",shieldDamage:20}],states:[{instanceId:"t",shield:50} as never]},"t"),"shield-hit");
  assert.equal(targetFeedback({...e,effects:[{targetId:"t",stunResisted:true,amount:-50}]},"t"),null);
});
test("长短事件均保留既定55%生效点与120ms下限", () => {
  for(const duration of [100,300,650,1000,1100,1800]) assert.equal(cardBattleImpactMs(duration),Math.max(120,Math.round(duration*.55)));
});
