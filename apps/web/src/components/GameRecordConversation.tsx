import { useState } from 'react';
import { api } from '../api';
import { OnlineSoupHonorCard } from './OnlineSoupHonorCard';
import { GiftMessageCard } from './GiftMessageCard';
import { sanitizeHtml } from '../sanitizeHtml';
import type { GiftMessage } from '../shared/types';
import { gameRecordTime, type GameRecordDetail, type ImpostorRecordState } from '../shared/gameRecords';

const phases:Record<string,string>={night:'夜间行动',clue:'发布线索',day_ready:'白天准备',day_vote:'任务投票',mission:'执行任务',accusation:'最终指认',assassination:'刺杀',ended:'游戏结束'};
const roles:Record<string,string>={detective:'侦探',civilian:'平民',impostor:'伪人'};
const actions:Record<string,string>={chaos:'混乱',isolate:'隔离',guard:'守护',investigate:'查验',skip:'跳过',protect:'守护',sabotage:'破坏'};
const answers:Record<string,string>={yes:'是',no:'不是',both:'是也不是',unknown:'不知道',irrelevant:'不重要'};

function Process({detail}:{detail:GameRecordDetail}) {
  const state=detail.state!;
  const name=(id:string)=>{const player=detail.record.players?.find(p=>p.userId===id);return player?`${player.seat}号 ${player.nickname}`:'未知玩家';};
  const lines:Array<{key:string;day:number;text:string}>=[];
  let previous:ImpostorRecordState|undefined;
  for(const [index,step] of (detail.steps ?? []).entries()) {
    const next=step.state;
    const action=next.recordAction;
    const add=(text:string)=>lines.push({key:`${index}-${lines.length}`,day:next.day,text});
    if(action) lines.push({key:`action-${index}`,day:action.day,text:`${name(action.userId)}：${actions[action.label] ?? action.label}${action.attempt?`（第${action.attempt}轮）`:''}${action.targets?` ${action.targets.length?action.targets.map(name).join('、'):'弃权'}`:''}${action.kind==='clues'?`：${action.content ?? '跳过'}`:''}`});
    if(!previous || next.phase!==previous.phase || next.day!==previous.day)add(phases[next.phase] ?? next.phase);
    const changed=(field:'nightActions'|'investigations'|'missionChoices'|'clues')=>Object.entries(next[field] ?? {}).filter(([id,value])=>!(action?.kind===field && action.userId===id) && (next.day!==previous?.day || JSON.stringify(value)!==JSON.stringify(previous?.[field]?.[id])));
    for(const [id,value] of changed('nightActions')){const v=value as ImpostorRecordState['nightActions'][string];add(`${name(id)}：${actions[v.type]} ${v.targetUserIds.map(name).join('、')}`);}
    for(const [id,value] of changed('investigations')){const v=value as ImpostorRecordState['investigations'][string];add(`${name(id)}查验 ${v.targetUserIds.map(name).join('、')}，收到结果：${v.reportedHasImpostor?'有伪人':'无伪人'}`);}
    for(const [id,value] of changed('missionChoices')){const v=value as ImpostorRecordState['missionChoices'][string];add(`${name(id)}选择${actions[v.choice]}${v.automatic?'（超时自动）':''}，实际为${actions[v.effectiveChoice]}`);}
    for(const [id,value] of changed('clues'))add(`${name(id)}提交线索：${value ?? '跳过'}`);
    for(const field of ['nomination','accusation'] as const)for(const [id,choice] of Object.entries(next[field]?.ballots ?? {})) {
      if(action?.kind===field && action.userId===id)continue;
      if(next.day===previous?.day && next[field]?.attempt===previous?.[field]?.attempt && JSON.stringify(choice)===JSON.stringify(previous?.[field]?.ballots[id]))continue;
      add(`${name(id)}${field==='nomination'?'任务投票':'最终指认'}：${Array.isArray(choice)?choice.map(name).join('、'):choice?name(choice):'弃权'}`);
    }
    if(!action && next.assassinationTargetUserId && next.assassinationTargetUserId!==previous?.assassinationTargetUserId)add(`刺杀目标：${name(next.assassinationTargetUserId)}`);
    previous=next;
  }
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{detail.record.players?.map(p=><div key={p.userId} className="rounded-xl bg-slate-50 p-3 text-sm"><strong>{p.seat}号 {p.nickname}</strong><p className="mt-1 text-muted">{roles[p.role ?? '']}</p></div>)}</div>
    <p className="text-sm font-bold">任务成功 {state.successes} 次 · 任务失败 {state.failures} 次</p>
    {detail.legacy && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">早期对局仅保留原系统已有的进程；未保存的逐次投票和行动无法恢复。</p>}
    {state.history.map(day=><section key={day.day} className="rounded-xl border border-line p-4 text-sm"><h3 className="font-black">第 {day.day} 天 · {day.result==='success'?'任务成功':'任务失败'}</h3><p className="my-2">任务成员：{day.missionTeamUserIds.map(name).join('、')}</p>{Object.entries(day.nightActions).map(([id,action])=><p key={id} className="my-1 text-muted">{name(id)}：{actions[action.type]} {action.targetUserIds.map(name).join('、')}</p>)}{Object.entries(day.missionChoices).map(([id,choice])=><p key={id} className="my-1">{name(id)}：选择{actions[choice.choice]} → 实际{actions[choice.effectiveChoice]}{choice.automatic?'（超时自动）':''}</p>)}</section>)}
    {lines.length>0 && <section><h3 className="mb-3 font-black">完整行动时间线</h3><ol className="space-y-2 border-l-2 border-blue-100 pl-4">{lines.map(line=><li key={line.key} className="text-sm leading-6"><span className="mr-2 text-xs text-muted">第{line.day}天</span>{line.text}</li>)}</ol></section>}
    <p className="rounded-xl bg-blue-50 p-3 font-bold text-primary">{state.endReason}</p>
  </div>;
}

export function GameRecordConversation({detail,userId}:{detail:GameRecordDetail;userId:string}) {
  const [tab,setTab]=useState('messages');
  const [messages,setMessages]=useState(detail.messages ?? []);
  const [hasMore,setHasMore]=useState(Boolean(detail.hasMore));
  const [cursor,setCursor]=useState(detail.nextCursor);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  async function loadMore(){setLoading(true);setError('');try{const next=await api<GameRecordDetail>(`/api/online-soup/game-records/${encodeURIComponent(detail.record.id)}?after=${cursor}`,{bypassCache:true});setMessages(current=>[...current,...(next.messages ?? [])]);setCursor(next.nextCursor);setHasMore(Boolean(next.hasMore));}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
  return <div className="space-y-4">
    {detail.state && <div className="flex gap-2" role="tablist" aria-label="记录内容">{[['messages','会话记录'],['process','游戏进程']].map(([key,label])=><button key={key} role="tab" aria-selected={tab===key} className={`min-h-11 rounded-full px-4 text-sm font-bold ${tab===key?'bg-primary text-white':'bg-slate-100 text-ink'}`} onClick={()=>setTab(key)}>{label}</button>)}</div>}
    {tab==='process' && detail.state ? <Process detail={detail}/> : <>
      <p className="text-center text-xs text-muted">游戏开始 · {gameRecordTime(detail.record.startedAt)}</p>
      {messages.map(message=>{
        let content:React.ReactNode=message.content;
        if(!message.recalled && ['surface','supplemental_surface','bottom','manual'].includes(message.type))content=<div className="content-block" dangerouslySetInnerHTML={{__html:sanitizeHtml(message.content)}}/>;
        if(!message.recalled && message.type==='ai_honor' && detail.record.honors)content=<OnlineSoupHonorCard honors={detail.record.honors}/>;
        else if(!message.recalled && message.type==='gift'){try{content=<GiftMessageCard gift={JSON.parse(message.content) as GiftMessage}/>;}catch{/* Preserve readable historical text. */}}
        else if(!message.recalled && message.type==='sticker')content=message.stickerUrl?<img src={message.stickerUrl} alt={message.stickerName ?? '表情'} className="h-24 w-24 object-contain"/>:(message.stickerName ?? '表情已下架');
        const own=message.senderId===userId;
        return <article key={message.id} id={`record-message-${message.id}`} className={`flex flex-col ${own?'items-end':'items-start'}`}>
          <p className="mb-1 text-xs text-muted">{message.senderName ?? '系统'} · {gameRecordTime(message.createdAt)}</p>
          <div className={`max-w-full whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-[85%] ${message.type==='question'?'bg-violet-50':own?'bg-blue-50':'bg-slate-50'}`}>
            {message.replyId && (messages.some(m=>m.id===message.replyId)?<button className="mb-2 block min-h-11 text-xs text-primary" onClick={()=>document.getElementById(`record-message-${message.replyId}`)?.scrollIntoView({block:'center'})}>查看引用消息</button>:<p className="mb-2 text-xs text-muted">引用了本局之外的消息</p>)}
            {message.questionNumber && <p className="mb-1 font-black text-violet-700">正式提问 #{message.questionNumber}</p>}
            {content}
            {message.answer && <p className="mt-2 font-bold text-amber-700">主持人回答：{answers[message.answer] ?? message.answer}</p>}
            {message.remainingQuestionCountAfter!=null && <p className="text-xs text-muted">剩余提问次数：{message.remainingQuestionCountAfter}</p>}
          </div>
        </article>;
      })}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {hasMore?<button className="btn btn-secondary w-full" disabled={loading} onClick={()=>void loadMore()}>{loading?'加载中…':'加载后续会话'}</button>:<p className="text-center text-xs text-muted">游戏结束 · {gameRecordTime(detail.record.endedAt)}</p>}
    </>}
  </div>;
}
