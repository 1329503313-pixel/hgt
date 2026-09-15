import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_BATTLE_BOND_ACTIONS, CARD_BATTLE_BOND_EVENTS, bondNeedsValue, bondNeedsDuration, type CardBattleBond, type CardBattleBondAction } from '@hgt/shared';
import { cardBattleBondsSchema } from './cardBattleBondSchema.js';
import { createCardBattleBondQueue } from './cardBattleBondQueue.js';
import { simulateCardBattle, type CardBattleDeckCard, type CardBattlePlayerInput, type CardBattleSkillEffect } from './cardBattle.js';
import { cardBattleEffectiveStat, cardBattleEffectiveProc, cardBattleStatuses, type CardBattleBuff } from './cardBattleMath.js';
import { cardBattleEffectiveCritical } from './cardBattleMath.js';
const action = (type:CardBattleBondAction['type']='attack_up', target:CardBattleBondAction['target']='self', value=100, duration=1):CardBattleBondAction => ({type,target,value:bondNeedsValue(type)?value:null,duration:bondNeedsDuration(type)?duration:null});
const bond = (event:CardBattleBond['event'], actions=[action()], cardNos=['A1']):CardBattleBond => ({event,cardNos,actions});
const card = (id:string,slot:number,bonds:CardBattleBond[]=[]):CardBattleDeckCard => ({
  instanceId:id,cardId:id,cardNo:id,name:id,imageUrl:'',rarity:'legend',battleRole:'damage',starLevel:0,slot:slot as 1,
  motionMp4Url:null,motionWebmUrl:null,motionPosterUrl:null,
  tier:{maxHp:10000,attack:100,defense:0,speed:100-slot,energyRequired:1000,critRate:0,critDamage:150,canAttackRear:false,starLevel:0,skillName:'基础技能',skillDescription:'',effects:[],bonds},
});
const players = ():CardBattlePlayerInput[] => ['A','B'].map((prefix,index)=>({userId:prefix,nickname:prefix,seat:(index+1) as 1|2,cards:[1,2,3,4,5].map(slot=>card(`${prefix}${slot}`,slot))}));
const skill = (type:CardBattleSkillEffect['type'],value:number|null,extra:Partial<CardBattleSkillEffect>={}):CardBattleSkillEffect => ({id:'skill',order:0,condition:'energy_full',conditionValue:null,type,value,duration:null,...extra});

test('暴击羁绊按百分点全额叠加、独立到期，暴击伤害可以超过100个百分点',()=>{
  assert.ok(cardBattleBondsSchema.safeParse([bond('attack',[action('crit_damage_up','self',250.25,2)])]).success);
  assert.equal(cardBattleBondsSchema.safeParse([bond('attack',[action('crit_rate_up','self',100.01,2)])]).success,false);
  assert.equal(cardBattleBondsSchema.safeParse([bond('attack',[action('crit_damage_up','self',10000.01,2)])]).success,false);
  const buffs:CardBattleBuff[]=[{stat:'critRate',value:70,expiresAfterRound:1,independent:true},{stat:'critRate',value:40,expiresAfterRound:2,independent:true},
    {stat:'critDamage',value:50.25,expiresAfterRound:1,independent:true},{stat:'critDamage',value:25.5,expiresAfterRound:2,independent:true}];
  assert.deepEqual(cardBattleEffectiveCritical({critRate:0,critDamage:150},buffs),{critRate:100,critDamage:225.75});
  assert.deepEqual(cardBattleEffectiveCritical({critRate:0,critDamage:150},buffs.filter(b=>b.expiresAfterRound>1)),{critRate:40,critDamage:175.5});
  assert.ok(cardBattleStatuses(buffs,1).every(s=>s.multiplier===1));
});

test('暴击羁绊作用于普攻、伤害技能和治疗，回合到期后恢复原值',()=>{
  for(const mode of ['attack','damage','heal'] as const) {
    const input=players(), owner=input[0]!.cards[0]!;
    owner.tier.bonds=[bond('energy_empty',[action('crit_rate_up','self',100,1),action('crit_damage_up','self',50,2)],['A2'])];
    if(mode!=='attack') { owner.tier.energyRequired=10;owner.tier.effects=[skill(mode==='damage'?'damage_all':'heal_all_allies',100)]; }
    const result=simulateCardBattle(input,`critical-bond-${mode}`);
    const events=result.events.filter(e=>e.actorId==='A1'&&e.round===1&&e.visual===(mode==='heal'?'heal':'damage')&&e.effects.length);
    assert.ok(events.length>0,mode);assert.ok(events.every(e=>e.effects.every(h=>h.critical===true)),mode);
    if(mode!=='heal') assert.ok(events.every(e=>e.effects.every(h=>-(h.amount??0)>=196&&-(h.amount??0)<=204)),mode);
    const round2=result.events.find(e=>e.kind==='round'&&e.round===2)!.states.find(c=>c.instanceId==='A1')!;
    assert.equal(round2.critRate,0);assert.equal(round2.critDamage,200);
    const round3=result.events.find(e=>e.kind==='round'&&e.round===3)!.states.find(c=>c.instanceId==='A1')!;
    assert.equal(round3.critRate,0);assert.equal(round3.critDamage,150);
  }
});

test('羁绊护盾、闪避和命中全额叠加且独立到期，护盾能触发其他己方羁绊',()=>{
  const input=players(), owner=input[0]!.cards[0]!, listener=input[0]!.cards[1]!;
  for(const player of input) for(const card of player.cards) card.tier.attack=0;
  owner.tier.bonds=[bond('energy_empty',[
    action('shield','allies',100,1),action('shield','allies',200,2),
    action('dodge_up','allies',20.25,1),action('dodge_up','allies',30.5,2),
    action('hit_up','allies',10.25,1),action('hit_up','allies',15.5,2),
  ])];
  listener.tier.bonds=[bond('shielded',[action('defense_up','self',7,1)])];
  const result=simulateCardBattle(input,'bond-defenses');
  assert.ok(result.events.some(e=>e.bond?.ownerId==='A2'&&e.effectType==='defense_self'));
  const lastOpening=result.events.filter(e=>e.round===1&&e.bond?.ownerId==='A1').at(-1)!;
  assert.ok(lastOpening.states.filter(c=>c.seat===1).every(c=>c.shield===300&&c.dodgeRate===50.75&&c.hitRate===25.75));
  for(const round of [2,3]) {
    const states=result.events.find(e=>e.kind==='round'&&e.round===round)!.states.filter(c=>c.seat===1);
    assert.ok(states.every(c=>c.shield===(round===2?200:0)&&c.dodgeRate===(round===2?30.5:0)&&c.hitRate===(round===2?15.5:0)));
  }
});

test('所有羁绊类型按数值/回合要求校验，旧技能字段不能混入羁绊',()=>{
  for(const type of Object.keys(CARD_BATTLE_BOND_ACTIONS) as CardBattleBondAction['type'][]) {
    const valid=bond('attack',[action(type)]);
    assert.ok(cardBattleBondsSchema.safeParse([valid]).success,type);
    assert.equal(cardBattleBondsSchema.safeParse([{...valid,actions:[{...valid.actions[0],value:bondNeedsValue(type)?null:1}]}]).success,false,type);
    assert.equal(cardBattleBondsSchema.safeParse([{...valid,actions:[{...valid.actions[0],duration:bondNeedsDuration(type)?null:1}]}]).success,false,type);
  }
  assert.equal(Object.keys(CARD_BATTLE_BOND_EVENTS).length,13);
  assert.equal(cardBattleBondsSchema.safeParse([bond('attack',[action('stun_up','self',100.01)])]).success,false);
  assert.equal(cardBattleBondsSchema.safeParse([bond('attack',[action('attack_up','self',1.5)])]).success,false);
  assert.equal(cardBattleBondsSchema.safeParse([{...bond('attack'),cardNos:[]}]).success,false);
  assert.equal(cardBattleBondsSchema.safeParse([{...bond('attack'),condition:'energy_full'}]).success,false);
  assert.deepEqual(cardBattleBondsSchema.parse([bond('attack',undefined,['001','001','002'])])[0]!.cardNos,['001','002']);
});

test('监听同阵营固定序号，实际触发实例被保存，跨玩家有效而敌方无效',()=>{
  const units=[{...card('owner',1,[bond('attack',undefined,['001','002'])]),seat:1,able:true},
    {...card('teammate',2),cardNo:'002',seat:1,able:true},{...card('foe',1),cardNo:'002',seat:2,able:true}];
  const q=createCardBattleBondQueue(()=>units,c=>c.able);
  const hits:string[]=[];
  q.emit('attack',units[2]!,1);q.drain(j=>hits.push(j.trigger.instanceId),()=>false);
  assert.equal(hits.length,0);
  q.emit('attack',units[1]!,2);q.inherit(2,3);q.emit('attack',units[1]!,3);
  q.drain(j=>hits.push(j.trigger.instanceId),()=>false);
  assert.deepEqual(hits,['teammate']);
  q.emit('attack',units[1]!,4);units[0]!.able=false;q.drain(j=>hits.push(j.trigger.instanceId),()=>false);
  units[0]!.able=true;q.drain(j=>hits.push(j.trigger.instanceId),()=>false);
  assert.equal(hits.length,1,'眩晕期间丢弃的任务不补发');
});

test('开局空能量触发，回满立即触发另一条件；不反复轮询持续状态',()=>{
  const input=players();const owner=input[0]!.cards[0]!;
  owner.tier.bonds=[bond('energy_empty',[action('energy','self',1000)]),bond('energy_full',[action('attack_up')])];
  const result=simulateCardBattle(input,'opening-bond');
  const records=result.events.filter(e=>e.bond && e.actorId==='A1');
  assert.equal(records[0]!.visual,'energy');assert.equal(records[1]!.visual,'buff');
  assert.equal(records.filter(e=>e.visual==='buff').length,1);
  assert.ok(result.events.findIndex(e=>e.kind==='attack')>result.events.indexOf(records[1]!));
  assert.deepEqual(result,simulateCardBattle(input,'opening-bond'));
});

test('当前整次技能含附加效果结算完毕后才插队，羁绊增益不计作基础技能释放',()=>{
  const input=players();const caster=input[0]!.cards[0]!;const listener=input[0]!.cards[1]!;
  caster.tier.bonds=[bond('energy_empty',[action('energy','self',1000)])];
  caster.tier.effects=[skill('damage_all',100,{additionalEffects:[{type:'attack_self',value:50,duration:1},{type:'energy_self',value:1000,duration:null}]})];
  listener.tier.bonds=[bond('skill',[action('attack_up')]),bond('skill',[action('defense_up')],['A2'])];
  const result=simulateCardBattle(input,'complete-skill');
  const first=result.events.findIndex(e=>!e.bond && e.kind==='skill');
  assert.deepEqual(result.events.slice(first,first+3).map(e=>e.effectType),['damage_all','attack_self','energy_self']);
  const response=result.events.findIndex((e,i)=>i>first && e.bond?.ownerId==='A2');
  assert.ok(response>=first+3);
  assert.equal(result.events[response]!.effectType,'attack_self');
  assert.equal(result.events.filter(e=>e.bond?.ownerId==='A2' && e.effectType==='defense_self').length,0);
});

test('强制普攻不耗满能量，强制技能无视能量且最后清空，只执行满能量技能组',()=>{
  const input=players();const owner=input[0]!.cards[0]!;const target=input[0]!.cards[1]!;
  owner.tier.bonds=[bond('energy_empty',[action('energy','trigger',1000),action('attack','trigger'),action('skill','trigger')],['A2'])];
  target.tier.effects=[skill('damage_single',333,{additionalEffects:[{type:'energy_self',value:1000,duration:null}]}),skill('attack_self',999,{id:'death',order:1,condition:'self_death',duration:1})];
  const events=simulateCardBattle(input,'forced-bonds').events;
  const attack=events.find(e=>e.bond && e.kind==='attack')!;
  assert.equal(attack.actorId,'A2');assert.equal(attack.states.find(s=>s.instanceId==='A2')!.energy,1000);
  const cleared=events.find(e=>e.bond && e.kind==='skill' && e.text.includes('清空能量'))!;
  assert.equal(cleared.states.find(s=>s.instanceId==='A2')!.energy,0);
  assert.ok(events.find(e=>e.bond && e.effectType==='damage_single'));
  assert.ok(!events.find(e=>e.bond && e.effectType==='attack_self'));
});

test('互相普攻与再动羁绊在同一连锁中每条只触发一次，下一自然行动可以再触发',()=>{
  const input=players();input[0]!.cards[0]!.tier.bonds=[bond('attack',[action('attack')],['A2'])];
  input[0]!.cards[1]!.tier.bonds=[bond('attack',[action('act_again')],['A1'])];
  const events=simulateCardBattle(input,'chain-loop').events;
  const first=events.findIndex(e=>!e.bond && e.kind==='attack');
  const next=events.findIndex((e,i)=>i>first && !e.bond && e.kind==='attack');
  const chain=events.slice(first+1,next).filter(e=>e.bond && e.kind==='attack');
  assert.deepEqual(chain.map(e=>e.actorId),['A2','A1']);
  assert.ok(events.slice(next).some(e=>e.bond && e.kind==='attack'));
});

test('独立Buff全额叠加且分别到期；生命上限到期只截断超出的生命',()=>{
  const input=players();const owner=input[0]!.cards[0]!;
  owner.tier.bonds=[bond('energy_empty',[action('attack_up','self',100,1),action('max_hp_up','self',100,1)]),bond('energy_empty',[action('attack_up','self',200,2),action('max_hp_up','self',200,2)])];
  const events=simulateCardBattle(input,'buff-expiry').events;
  const attacks=events.filter(e=>e.actorId==='A1' && e.kind==='attack');
  assert.equal(attacks[0]!.states.find(s=>s.instanceId==='A1')!.attack,400);
  assert.equal(attacks.find(e=>e.round===2)!.states.find(s=>s.instanceId==='A1')!.attack,300);
  assert.equal(attacks.find(e=>e.round===3)!.states.find(s=>s.instanceId==='A1')!.attack,100);
  assert.equal(events.find(e=>e.round===2)!.states.find(s=>s.instanceId==='A1')!.maxHp,10200);
  assert.equal(events.find(e=>e.round===3)!.states.find(s=>s.instanceId==='A1')!.maxHp,10000);
  assert.ok(events.every(e=>e.states.every(s=>s.hp<=s.maxHp)));
});

test('固定值减速不变成百分比，概率使用百分点，状态提示保留单位',()=>{
  const buffs:CardBattleBuff[]=[{stat:'speed',value:30,expiresAfterRound:2,debuff:true,independent:true,flat:true},
    {stat:'speed',value:20,expiresAfterRound:1,debuff:true,independent:true,flat:true},
    {stat:'stunRate',value:20,expiresAfterRound:1,independent:true},{stat:'stunRate',value:20,expiresAfterRound:2,independent:true}];
  assert.equal(cardBattleEffectiveStat(200,buffs,'speed'),150);
  assert.equal(cardBattleEffectiveProc({stunRate:10},buffs,'stunRate'),50);
  assert.ok(cardBattleStatuses(buffs,1).filter(s=>s.type==='speed_down').every(s=>s.flat && s.multiplier===1));
});

test('随机友军包含自身且不重复，明确前后排没有目标时不跨排替代',()=>{
  const input=players();input[0]!.cards[0]!.tier.bonds=[bond('energy_empty',[action('attack_up','random_4'),action('defense_up','allies_rear'),action('speed_down','enemies_front',30)])];
  const events=simulateCardBattle(input,'bond-random').events.filter(e=>e.bond);
  assert.equal(events[0]!.effects.length,4);assert.equal(new Set(events[0]!.effects.map(e=>e.targetId)).size,4);
  assert.ok(events[0]!.effects.every(e=>e.targetId.startsWith('A')));
  assert.deepEqual(events[1]!.effects.map(e=>e.targetId),['A3','A4','A5']);
  assert.deepEqual(events[2]!.effects.map(e=>e.targetId),['B1','B2']);
  assert.equal(events[2]!.states.find(s=>s.instanceId==='B1')!.speed,69);
});

test('BOSS队友相同固定序号实例触发，羁绊卡只命中实际触发者',()=>{
  const input:CardBattlePlayerInput[]=[{userId:'p1',nickname:'p1',seat:1,cards:[1,2,3].map(i=>card(`A${i}`,i))},
    {userId:'p2',nickname:'p2',seat:1,cards:[1,2,3].map(i=>card(`T${i}`,i))},players()[1]!];
  input[0]!.cards[0]!.tier.bonds=[bond('energy_empty',[action('attack_up','trigger')],['same'])];
  input[1]!.cards[0]!.cardNo='same';input[1]!.cards[1]!.cardNo='same';input[2]!.cards[0]!.cardNo='same';
  const events=simulateCardBattle(input,'boss-bonds','boss').events.filter(e=>e.bond?.ownerId==='A1');
  assert.equal(events[0]!.bond!.triggerId,'T1');assert.deepEqual(events[0]!.effects.map(e=>e.targetId),['T1']);
});

test('无羁绊的历史阵容可运行，不发出羁绊事件',()=>{
  const input=players();for(const player of input)for(const item of player.cards){delete item.cardNo;delete item.tier.bonds;}
  assert.ok(simulateCardBattle(input,'old-lineup').events.every(e=>!e.bond));
});

test('受伤、半血、死亡、被治疗触发到正确监听者，回血后可再次跨越半血阈值',()=>{
  const input=players();const subject=input[0]!.cards[0]!;const listener=input[0]!.cards[2]!;const attacker=input[1]!.cards[0]!;
  subject.tier.maxHp=1000;
  subject.tier.bonds=[bond('hp_half',[action('heal','self',1000)])];
  listener.tier.bonds=['damaged','hp_half','healed','death'].map((event,i)=>bond(event as CardBattleBond['event'],[action('attack_up','self',i+1)]));
  attacker.tier.speed=500;attacker.tier.energyRequired=10;
  attacker.tier.bonds=[bond('energy_empty',[action('energy','self',10)],['B1'])];
  attacker.tier.effects=[skill('damage_all',700)];
  const events=simulateCardBattle(input,'damage-signals').events;
  const reactions=events.filter(e=>e.bond?.ownerId==='A3');
  assert.ok(reactions.some(e=>e.effects[0]?.amount===1));
  assert.ok(reactions.filter(e=>e.effects[0]?.amount===2).length>=2,'生命恢复后再次降低至半血可以触发');
  assert.ok(reactions.some(e=>e.effects[0]?.amount===3));
  subject.tier.bonds=[];
  const deaths=simulateCardBattle(input,'death-signals').events.filter(e=>e.bond?.ownerId==='A3' && e.effects[0]?.amount===4);
  assert.equal(deaths.length,1);
});

test('被眩晕的目标可以收Buff但不执行插队，眩晕的拥有者不触发且解除后不补发',()=>{
  const input=players();const listener=input[0]!.cards[2]!;const attacker=input[1]!.cards[0]!;
  listener.tier.bonds=[bond('stunned',[action('attack','trigger'),action('attack_up','trigger')])];
  input[0]!.cards[1]!.tier.bonds=[bond('stunned',[action('defense_up')])];
  attacker.tier.speed=500;attacker.tier.energyRequired=1000;
  attacker.tier.bonds=[bond('energy_empty',[action('energy','self',1000)],['B2'])];
  attacker.tier.effects=[skill('stun_enemy_front',null,{duration:1})];
  const events=simulateCardBattle(input,'stun-bonds').events;
  assert.equal(events.filter(e=>e.bond?.ownerId==='A3' && e.kind==='extra_action').length,0);
  assert.ok(events.find(e=>e.bond?.ownerId==='A3' && e.effectType==='attack_self' && e.effects[0]?.targetId==='A1'));
  assert.equal(events.filter(e=>e.bond?.ownerId==='A2').length,0);
  assert.equal(events.filter(e=>e.bond?.ownerId==='A3' && e.round>1).length,0);
});

test('吸血、击晕、再动事件能触发羁绊，概率为零时不会凭空触发',()=>{
  const input=players();const actor=input[0]!.cards[0]!;const listener=input[0]!.cards[2]!;
  actor.tier.stunRate=100;actor.tier.lifestealRate=100;actor.tier.extraActionRate=100;
  listener.tier.bonds=['lifesteal','stun','extra_action'].map((event,i)=>bond(event as CardBattleBond['event'],[action('defense_up','self',i+1)]));
  const reactions=simulateCardBattle(input,'proc-bonds').events.filter(e=>e.bond?.ownerId==='A3');
  for(const value of [1,2,3])assert.ok(reactions.find(e=>e.effects[0]?.amount===value));
  actor.tier.stunRate=0;actor.tier.lifestealRate=0;actor.tier.extraActionRate=0;
  assert.equal(simulateCardBattle(input,'proc-bonds').events.filter(e=>e.bond).length,0);
});

test('开局羁绊击败全体敌人时直接判胜，不等待自然行动',()=>{
  const input=players();const owner=input[0]!.cards[0]!;
  owner.tier.bonds=[bond('energy_empty',[action('skill')])];owner.tier.effects=[skill('damage_all',1_000_000)];
  const result=simulateCardBattle(input,'opening-win');
  assert.equal(result.winnerSeat,1);assert.equal(result.endReason,'elimination');
  assert.ok(!result.events.find(e=>e.kind==='attack'));
});
