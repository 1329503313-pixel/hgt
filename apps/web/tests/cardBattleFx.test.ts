import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardBattleSkillFx } from "../src/components/CardBattleEffects";
import { CARD_BATTLE_BOND_ACTIONS } from "@hgt/shared";
import { cardBattleEffectCodes } from "../../server/src/cardBattle.js";
import { CARD_BATTLE_MOTIONS } from "../src/shared/cardBattleMotion";
import { BOND_FX_FAMILIES, cardBattleImpactMs, effectFamily, eventFx, fxParticles, targetFeedback } from "../src/shared/cardBattleFx";
import type { OnlineCardBattleEvent } from "../src/shared/types";
import { readableCardBattleEvent, seekCardBattleAnimations } from "../src/shared/cardBattlePlayback";
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
test("普攻跨回合保持斩击与固定火花，节能保留同位置的火花子集", () => {
  const attack = event({kind:"attack",visual:"damage",effects:[{targetId:"target0",amount:-100}]});
  const later = {...attack,sequence:42,round:8};
  assert.equal(eventFx(attack).family,"slash");
  assert.deepEqual(eventFx(later),eventFx(attack));
  assert.deepEqual(eventFx({...attack,effectType:"damage_random",bond:{ownerId:"source",triggerId:"target0",actionType:"skill"}}),eventFx(attack));
  assert.deepEqual(fxParticles(later,"target0","standard"),fxParticles(attack,"target0","standard"));
  assert.deepEqual(fxParticles(attack,"target0","economy"),fxParticles(attack,"target0","standard").slice(0,2));
  assert.notDeepEqual(fxParticles({...attack,kind:"skill"},"target0","standard"),fxParticles({...later,kind:"skill"},"target0","standard"));
});
test("格挡、盾伤、闪避与保护单独反馈，不替换普攻主体也不生成命中火花", () => {
  const outcomes = [
    {effect:{blocked:true},family:"armor",feedback:"blocked"},
    {effect:{shieldDamage:30},family:"shield",feedback:"shield-hit"},
    {effect:{dodged:true},family:"dodge",feedback:"dodge"},
    {effect:{protection:"invincible" as const},family:"immunity",feedback:"invincible"},
    {effect:{protection:"death_protection" as const},family:"life",feedback:"death_protection"},
  ];
  for (const {effect,family,feedback} of outcomes) {
    const attack=event({kind:"attack",visual:"damage",effects:[{targetId:"target0",amount:0,...effect}]});
    const html=renderToStaticMarkup(createElement(CardBattleSkillFx,{event:attack,instanceId:"target0"}));
    assert.match(html,/data-fx-family="slash"/);
    assert.ok(html.includes(`data-fx-family="${family}"`));
    assert.ok(html.includes(`data-feedback="${feedback}"`));
    assert.match(html,/is-outcome/);
    assert.doesNotMatch(html,/card-battle-fx-particle|card-battle-fx-texture/);
  }
});
test("普攻暴击与反击保留斩击，反击标记独立，普通命中不依赖贴图", () => {
  const attack=event({kind:"attack",visual:"damage",counterattack:true,effects:[{targetId:"target0",amount:-100,critical:true}]});
  const target=renderToStaticMarkup(createElement(CardBattleSkillFx,{event:attack,instanceId:"target0"}));
  assert.match(target,/data-fx-family="slash"/);assert.match(target,/card-battle-fx-critical/);assert.doesNotMatch(target,/card-battle-fx-texture/);
  const caster=renderToStaticMarkup(createElement(CardBattleSkillFx,{event:attack,instanceId:"source"}));
  assert.match(caster,/data-fx-family="slash"/);assert.match(caster,/data-fx-family="counter"/);assert.match(caster,/is-outcome/);
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

test("历史回放补足阅读时间，新时长不重复放慢且不修改原记录", () => {
  const old = event({ visual: "damage", durationMs: 1300 });
  assert.equal(readableCardBattleEvent(old).durationMs, 1625);
  assert.equal(old.durationMs, 1300);
  assert.equal(readableCardBattleEvent(event({ kind: "attack", durationMs: 1100 })).durationMs, 1375);
  assert.equal(readableCardBattleEvent(event()).durationMs, 1250);
  const current = event({ durationMs: 1625 });
  assert.equal(readableCardBattleEvent(current), current);
});

test("原生飞行动画与CSS特效共用定位，重复定位不创建新卡面", () => {
  let plays = 0;
  const flight = { id: "card-battle-flight", currentTime: 0, playState: "paused", effect: { getComputedTiming: () => ({ endTime: 1625 }) }, play: () => { plays++; } };
  const unrelated = { ...flight, id: "other-flight", currentTime: 25 };
  const root = { getAnimations: () => [flight, unrelated] } as unknown as HTMLElement;
  seekCardBattleAnimations(root, 894);
  assert.equal(flight.currentTime, 894);
  assert.equal(unrelated.currentTime, 25);
  assert.equal(plays, 1);
  seekCardBattleAnimations(root, 1625);
  assert.equal(plays, 1);
});
