import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CardBattleRoomView } from '../../src/components/CardBattleRoomView';
import { CardBattleBossReplay } from '../../src/components/CardBattleBossReplay';
import CardTowerRoomPage from '../../src/pages/CardTowerRoomPage';
import { DEFAULT_LEGEND_CARD_BATTLE_TIERS } from '../../src/shared/digitalAssets';

// Real page components and real playback hook; only API data is local.
const mode = new URLSearchParams(location.search).get('mode') ?? 'normal';
const bossMode = mode === 'boss';
const picture = (color: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="${color}"/><path d="M50 20 80 55 65 115 35 115 20 55Z" fill="#cab382"/></svg>`);
const makeCards = (prefix: string) => Array.from({length:5}, (_,i) => ({id:prefix+i,cardNo:prefix+i,name:(prefix==='enemy'?'守卫':'突击者')+(i+1),imageUrl:picture(prefix==='enemy'?'#383751':'#16506b'),rarity:'legend',battleRole:'damage',starLevel:3,combatPower:6000,stats:{...DEFAULT_LEGEND_CARD_BATTLE_TIERS[3],maxHp:3000,energyRequired:30},skillName:'焚天烈焰 · 全体突击',skillDescription:'造成伤害。'}));
const owned=makeCards('own'),enemy=makeCards('enemy');
const actorUser=bossMode?'u3':'u1';
const lineups=[...(bossMode?[1,2,3]:[1]).map(i=>({seat:1,playerSeat:i,userId:'u'+i,nickname:'挑战者'+i,cards:bossMode?owned.slice(0,3):owned})),{seat:2,userId:'enemy',nickname:'守卫',cards:enemy}];
const states=lineups.flatMap(p=>p.cards.map((c,i)=>({...c.stats,instanceId:p.userId+':'+i,userId:p.userId,seat:p.seat,slot:i+1,row:i<2?'front':'rear',hp:3000,maxHp:3000,energy:20,alive:true,statuses:[]})));
const duration=1625,start=performance.now();
let latest:any;
const eventAt=(sequence:number) => {
  const reverse=sequence%4===0,kind=sequence%4===3?'attack':'skill';
  const actorId=reverse?'enemy:0':actorUser+':0';
  const ids=sequence%4===2?states.filter(s=>s.seat===2).map(s=>s.instanceId):[reverse?actorUser+':0':'enemy:0'];
  return {sequence,round:1,kind,visual:'damage',effectType:sequence%4===2?'damage_all':'damage_single',actorId,skillName:kind==='skill'?'焚天烈焰 · 全体突击':null,effects:ids.map(targetId=>({targetId,amount:-180})),states:states.map(s=>({...s,hp:ids.includes(s.instanceId)?2820:3000})),durationMs:duration,text:(reverse?'守卫':'突击者')+' 出手，造成 180 点伤害'};
};
function playback(){const time=performance.now()-start,sequence=Math.floor(time/duration)+1;latest=eventAt(sequence);return {completedSequence:sequence-1,totalEvents:10000,complete:false,states,activeEvent:latest,activeEventElapsedMs:time%duration,activeEventStartedAt:new Date(Date.now()-time%duration).toISOString(),serverNow:new Date().toISOString()};}
const seats=(bossMode?[1,2,3]:[1,2]).map(n=>({seat:n,user:{id:bossMode?'u'+n:n===1?'u1':'enemy',nickname:'挑战者'+n,avatar:null},ready:true,lineup:(bossMode?owned.slice(0,3):n===1?owned:enemy).map((card,i)=>({slot:i+1,card,cardBack:false}))}));
const game=()=>({id:'live-test',gameNumber:1,status:'playing',lineups,playback:playback(),settlement:null,floorNumber:1,totalPower:30000,rewardShells:100});
const boss={name:'浏览器实战验收',available:true,rewardShells:500,rewardClaimed:false,lineup:enemy};
const tower=()=>({room:{id:'local',name:'卡塔连续战斗验收'},formations:[1,2,3].map(()=>({cardIds:owned.map(c=>c.id),collectibleBindings:[]})),revision:1,clearedFloor:0,nextFloor:null,message:null,game:game()});
window.fetch=async(input:any)=>{const url=String(input);let data:any={};if(url.includes('/playback'))data={gameId:'live-test',playback:playback()};else if(url.includes('/card-tower/resources'))data={cards:owned,decks:[],collectibles:[]};else if(url.includes('/card-tower/rooms/'))data=tower();else if(url.includes('/decks'))data={decks:[]};else if(url.includes('eligible-cards'))data={cards:owned};return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});};
const snapshot:any={room:{id:'local',name:'浏览器实战验收',code:'LOCAL',cardBattle:{mode:bossMode?'boss':'normal',boss:bossMode?boss:undefined,seats,me:{userId:actorUser,seat:bossMode?3:1,eligibleCardCount:5,collectibleBindings:[]},phase:'playing',rankingChallenge:null,game:game()}},me:{isHost:false},members:[],messages:[]};
const replay:any={name:'历史回放验收',gameId:'live-test',gameNumber:1,lineups,result:{winnerSeat:1,endReason:'elimination',rounds:1,initialStates:states,finalStates:states,events:[1,2,3,4].map(n=>({...eventAt(n),durationMs:1300})),players:lineups.map(p=>({...p,cards:p.cards.map((c,i)=>({slot:i+1,cardId:c.id,name:c.name,damageDealt:180,damageTaken:0,healingDone:0,score:1}))}))}};
const noop=async()=>{};
function Harness(){const[debug,setDebug]=useState(true);return <><div style={{position:'fixed',right:8,top:8,zIndex:10000}}><button style={{background:'#fff',color:'#000',padding:8}} onClick={()=>{setDebug(!debug);document.querySelector<HTMLElement>('#diagnostics')!.hidden=debug}}>显示／隐藏诊断</button></div>{mode==='tower'?<CardTowerRoomPage/>:mode==='replay'?<CardBattleBossReplay replay={replay} onClose={()=>{}}/>:<CardBattleRoomView roomId="local" snapshot={snapshot} stickerSeries={[]} stickersLoading={false} onReload={noop} onReloadMessages={noop} onOpenInvite={()=>{}} onOpenMembers={()=>{}} showToast={()=>{}}/>}</>;}
createRoot(document.getElementById('root')!).render(<MemoryRouter><Harness/></MemoryRouter>);
const panel=document.createElement('pre');panel.id='diagnostics';panel.style.cssText='position:fixed;right:0;bottom:0;z-index:9999;max-width:100%;background:#fff;color:#000;font:11px monospace;white-space:pre-wrap;pointer-events:none';document.body.append(panel);
let frames=0,frameAt=performance.now(),delta=0;let last=0,maximum=0,minimum=Infinity,returned=false,readable=false,samples:string[]=[];
function measure(){
 delta=performance.now()-frameAt;frameAt=performance.now();frames++;
 if(mode==='replay'){
  const arena=document.querySelector<HTMLElement>('[data-battle-arena]');const animations=arena?.getAnimations({subtree:true}).filter(a=>a.id.startsWith('card-battle-')||(a as CSSAnimation).animationName?.startsWith('card-battle-'))??[];
  const flight=animations.find(a=>a.id==='card-battle-flight');
  panel.textContent='回放：动画 '+animations.length+' 个，全部暂停 '+animations.every(a=>a.playState==='paused'||a.playState==='finished')+'\n飞行动画 '+(flight?Number(flight.currentTime).toFixed(0)+'ms':'无')+'，所有动画进度 '+[...new Set(animations.map(a=>Math.round(Number(a.currentTime))))].join(',');
 }
 const card=document.querySelector<HTMLElement>('.card-battle-attacker');
 if(card&&latest&&mode!=='replay'){
  const source=document.querySelector<HTMLElement>('[data-battle-anchor="'+card.dataset.battleInstance+'"]');
  const target=document.querySelector<HTMLElement>('[data-battle-anchor="'+latest.effects[0].targetId+'"]');
  const animation=card.getAnimations().find(a=>a.id==='card-battle-flight'||(a as CSSAnimation).animationName==='card-battle-attack-target');
  if(source&&target){const center=(e:HTMLElement)=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width};};const a=center(card),s=center(source),t=center(target),travel=Math.hypot(a.x-s.x,a.y-s.y),gap=Math.hypot(a.x-t.x,a.y-t.y),distance=Math.hypot(s.x-t.x,s.y-t.y);const time=Number(animation?.currentTime??0),progress=time/duration;
   if(latest.sequence!==last){if(last)samples.push(`第${last}次 位移${maximum.toFixed(0)}/${distance.toFixed(0)}px 到靶${minimum.toFixed(0)}px 回位${returned?'✓':'×'} 读数${readable?'✓':'×'}`);samples=samples.slice(-4);maximum=0;minimum=Infinity;returned=readable=false;last=latest.sequence;}
   maximum=Math.max(maximum,travel);minimum=Math.min(minimum,gap);if(progress>.82&&progress<.98&&travel<2)returned=true;
   const number=target.querySelector('.card-battle-number'),motif=target.querySelector('.card-battle-fx-motif');if(progress>.82&&progress<.90&&number&&Number(getComputedStyle(number).opacity)>.9&&motif&&Number(getComputedStyle(motif).opacity)>.75)readable=true;
   panel.textContent=`本地真实${mode}页面 · 连续播放\n${samples.join('\n')}\n当前出手 ${last}：位移${travel.toFixed(0)} / ${distance.toFixed(0)}px\n进度${time.toFixed(0)}ms；单次${duration}ms\n可见${!document.hidden} 帧间隔${delta.toFixed(0)}ms 帧数${frames} 动画${animation?.playState} 真实时长${animation?.effect?.getTiming().duration}`;
  }
 }requestAnimationFrame(measure);
}measure();
