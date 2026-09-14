import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, History, MessageSquare, Play, Swords, Trophy, X } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../context/AppContext';
import { PageTopBar } from '../components/PageTopBar';
import { MineBackButton } from '../components/MineBackButton';
import { Modal } from '../components/Modal';
import { CardBattleBossReplay } from '../components/CardBattleBossReplay';
import { GameRecordConversation } from '../components/GameRecordConversation';
import { gameRecordOutcome, gameRecordTime, gameRecordType, type GameRecord, type GameRecordDetail } from '../shared/gameRecords';

const categories=[['soup','海龟汤'],['impostor','谁是伪人'],['card_battle','卡牌对战']];
const modes=[['all','全部'],['room','房间对战'],['boss','BOSS对战'],['ranking','排行榜对战']];
export default function GameRecordsPage(){
  const {user}=useApp();
  const [params,setParams]=useSearchParams();
  const kind=categories.some(([key])=>key===params.get('kind'))?params.get('kind')!:'soup';
  const mode=modes.some(([key])=>key===params.get('mode'))?params.get('mode')!:'all';
  const page=Math.max(1,Math.min(1000000,Math.floor(Number(params.get('page'))||1)));
  const recordId=params.get('record'), view=params.get('view');
  const [data,setData]=useState<{records:GameRecord[];total:number}>({records:[],total:0});
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  const [detail,setDetail]=useState<GameRecordDetail|null>(null),[detailError,setDetailError]=useState('');
  const [retry,setRetry]=useState(0);
  useEffect(()=>{let cancelled=false;setData({records:[],total:0});setError('');setLoading(true);
    if(!user){setLoading(false);return;}
    void api<typeof data>(`/api/online-soup/game-records?kind=${kind}&subtype=${mode}&page=${page}`,{bypassCache:true})
      .then(value=>{if(!cancelled)setData(value);}).catch(e=>{if(!cancelled)setError((e as Error).message);}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[user?.id,kind,mode,page,retry]);
  useEffect(()=>{let cancelled=false;setDetail(null);setDetailError('');
    if(!recordId || !user)return;
    void api<GameRecordDetail>(`/api/online-soup/game-records/${encodeURIComponent(recordId)}`,{bypassCache:true})
      .then(value=>{if(!cancelled)setDetail(value);}).catch(e=>{if(!cancelled)setDetailError((e as Error).message);});
    return()=>{cancelled=true;};
  },[recordId,user?.id,retry]);
  function update(changes:Record<string,string|null>,replace=false){
    const preserveScroll=Object.keys(changes).every(key=>key==='record'||key==='view');
    setParams(current=>{const next=new URLSearchParams(current);for(const [key,value] of Object.entries(changes)){if(value==null)next.delete(key);else next.set(key,value);}return next;},{replace,preventScrollReset:preserveScroll,state:{preserveScroll}});
  }
  const close=()=>update({record:null,view:null},true);
  const open=(record:GameRecord,view:string)=>update({record:record.id,view});
  return <section className="space-y-4">
    <PageTopBar title="游戏记录"/><MineBackButton/>
    <div className="hidden items-center gap-3 lg:flex"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-100 text-primary"><History/></span><div><h1 className="text-2xl font-black text-ink">游戏记录</h1><p className="mt-1 text-sm text-muted">回顾每一局的故事、推理与对战</p></div></div>
    <div role="tablist" aria-label="游戏分类" className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">{categories.map(([key,label])=><button role="tab" aria-selected={kind===key} key={key} className={`min-h-12 rounded-xl px-2 text-sm font-black transition-colors ${kind===key?'bg-white text-primary shadow-sm':'text-muted hover:text-ink'}`} onClick={()=>update({kind:key,mode:null,page:null,record:null,view:null})}>{label}</button>)}</div>
    {kind==='card_battle' && <div role="tablist" aria-label="对战类型" className="flex gap-2 overflow-x-auto pb-1">{modes.map(([key,label])=><button key={key} role="tab" aria-selected={mode===key} className={`min-h-11 shrink-0 rounded-full border px-4 text-xs font-bold ${mode===key?'border-primary bg-primary text-white':'border-line bg-white text-muted'}`} onClick={()=>update({mode:key,page:null})}>{label}</button>)}</div>}
    {!user?<p className="card py-12 text-center text-muted">请先登录后查看游戏记录</p>:loading?<p role="status" className="card py-12 text-center text-muted">正在加载游戏记录…</p>:error?<div role="alert" className="card p-6 text-center"><p className="text-red-600">{error}</p><button className="btn btn-secondary mt-3" onClick={()=>setRetry(v=>v+1)}>重试</button></div>:<>
      <p className="text-xs text-muted">共 {data.total} 条记录 · 每页 10 条 · 按结束时间倒序</p>
      <div className="space-y-3">{data.records.map(record=>{
        const outcome=gameRecordOutcome(record,user.id);
        const players=record.subtype==='boss'?record.players?.filter(p=>p.seat===1):[...(record.players ?? [])].sort((a,b)=>Number(b.userId===user.id)-Number(a.userId===user.id));
        return <article key={record.id} className="card p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-bold text-primary">{gameRecordType[record.subtype]}</span><time className="flex items-center gap-1 text-xs text-muted" dateTime={record.endedAt}><Clock size={13}/>{gameRecordTime(record.endedAt)}</time></div>
          {record.kind==='soup'?<button className="flex w-full items-center gap-4 text-left" onClick={()=>open(record,'conversation')}>
            {record.coverUrl?<img src={record.coverUrl} alt="" className="aspect-video w-24 shrink-0 rounded-xl object-cover sm:w-32" loading="lazy"/>:<span className="grid aspect-video w-24 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400 sm:w-32"><MessageSquare size={28}/></span>}
            <span className="min-w-0"><strong className="block break-words text-base text-ink">{record.title}</strong><span className="mt-1 block text-xs text-muted">身份：{record.role==='host'?'主持':'玩家'}</span><span className="mt-2 flex items-center gap-1 text-sm font-bold text-amber-700"><Trophy size={15}/>MVP：{record.honors?.mvp.nickname}</span></span>
          </button>:record.kind==='impostor'?<button className="flex min-h-16 w-full items-center justify-between gap-3 text-left" onClick={()=>open(record,'conversation')}><span><strong className="block text-base">{record.title}</strong><span className="mt-2 block text-sm text-muted">{record.players?.length} 人 · 会话记录与游戏进程</span></span><strong className="shrink-0 text-sm text-primary">{outcome}</strong></button>:<>
            {record.subtype==='boss' && <h2 className="mb-3 font-black">{record.title}</h2>}
            <div className={`grid gap-3 ${record.subtype==='boss'?'grid-cols-3':'grid-cols-2'}`}>{players?.map((player,index)=><div key={player.userId} className="min-w-0 rounded-xl bg-slate-50 p-3"><p className="mb-1 text-[11px] text-muted">{record.subtype==='boss'?`玩家 ${index+1}`:player.userId===user.id?'我方':'对方'}</p><strong className="block break-words text-sm">{player.nickname}</strong><p className="mt-1 text-xs text-muted">战力 <span className="font-bold tabular-nums text-ink">{player.power?.toLocaleString()}</span></p></div>)}</div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div><strong className={outcome==='胜利'?'text-emerald-700':'text-slate-600'}>{outcome}</strong>{record.subtype==='ranking' && <p className="mt-1 text-xs text-muted">最后排名：{record.rankState==='pending'?'待确认':record.rankState==='unknown'?'历史未保存':record.finalRank?`第 ${record.finalRank} 名`:'未上榜'}</p>}</div><div className="flex gap-2"><button className="btn btn-secondary min-h-11 px-3 text-xs" onClick={()=>open(record,'settlement')}><Swords size={15}/>查看结算</button><button className="btn btn-primary min-h-11 px-3 text-xs" onClick={()=>open(record,'replay')}><Play size={15}/>查看回放</button></div></div>
          </>}
        </article>;
      })}</div>
      {!data.records.length && <div className="card py-16 text-center"><History className="mx-auto mb-3 text-slate-300" size={36}/><p className="text-sm text-muted">暂无符合条件的游戏记录</p></div>}
      {data.total>10 && <nav aria-label="游戏记录分页" className="flex items-center justify-center gap-4 py-3"><button className="btn btn-secondary min-h-11" disabled={page<=1} onClick={()=>update({page:String(page-1)})}>上一页</button><span className="text-sm tabular-nums">{page} / {Math.ceil(data.total/10)}</span><button className="btn btn-secondary min-h-11" disabled={page*10>=data.total} onClick={()=>update({page:String(page+1)})}>下一页</button></nav>}
    </>}
    {recordId && user && (detail?.replay?<CardBattleBossReplay key={`${recordId}-${view}`} replay={detail.replay} onClose={close} userReplay settlementOnly={view==='settlement'} viewerId={user.id}/>:<Modal full onClose={close}><div className="sticky top-0 z-10 mb-4 flex items-center justify-between gap-3 bg-white py-2"><h2 className="text-lg font-black">{detail?.record.title ?? '游戏记录'}</h2><button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100" onClick={close} aria-label="关闭游戏记录"><X size={18}/></button></div>{detailError?<div role="alert"><p className="text-red-600">{detailError}</p><button className="btn btn-secondary mt-3" onClick={()=>setRetry(v=>v+1)}>重试</button></div>:detail?<GameRecordConversation key={recordId} detail={detail} userId={user.id}/>:<p role="status" className="py-12 text-center text-muted">正在加载完整记录…</p>}</Modal>)}
  </section>;
}
