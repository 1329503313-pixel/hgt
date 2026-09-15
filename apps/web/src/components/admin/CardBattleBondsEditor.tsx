import { Plus, Trash2 } from "lucide-react";
import { CARD_BATTLE_BOND_EVENTS, CARD_BATTLE_BOND_TARGETS, CARD_BATTLE_BOND_ACTIONS, bondNeedsValue, bondNeedsDuration, bondIsRate, bondValueMaximum, parseBondCardNos } from "@hgt/shared";
import { SearchableSkillSelect } from "./SearchableSkillSelect";
import { cardBattleBondError, type CardBattleBondDraft, type CardBattleBondActionDraft } from "./cardBattleEditorDraft";
const options = <T extends Record<string,string>>(labels:T) => Object.entries(labels).map(([value,label]) => ({value:value as keyof T & string,label}));
const emptyAction = (): CardBattleBondActionDraft => ({target:"",type:"",value:null,duration:null});
export function CardBattleBondsEditor({bonds, onChange}: {bonds:CardBattleBondDraft[];onChange:(bonds:CardBattleBondDraft[])=>void}) {
  const update = (index:number, change:Partial<CardBattleBondDraft>) => onChange(bonds.map((bond,i) => i === index ? {...bond,...change} : bond));
  return <section className="mt-6 border-t border-violet-200 pt-5" aria-label="羁绊技能配置">
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="text-sm font-black text-ink">羁绊技能条件</h4>
      <button type="button" className="btn btn-secondary min-h-11 px-3 text-xs" disabled={bonds.length >= 50}
        onClick={() => onChange([...bonds,{id:crypto.randomUUID?.() ?? `bond-${Date.now()}-${Math.random().toString(36).slice(2)}`,cardNos:[],event:"",actions:[emptyAction()]}])}><Plus size={15}/>新增羁绊条件</button></div>
    <p className="mt-2 text-xs leading-5 text-muted">与基础技能独立。仅监听己方指定序号的卡牌，BOSS 战包含队友；当前技能全部结算后立即插队。眩晕时跳过且不补发，每条条件在同一连锁中最多触发一次。</p>
    {!bonds.length && <p className="mt-3 rounded-xl border border-dashed border-violet-200 p-4 text-center text-xs text-muted">尚未配置羁绊技能</p>}
    {bonds.map((bond,index) => <section key={bond.id ?? index} className="mt-3 rounded-xl border border-violet-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2"><strong className="text-xs text-violet-800">羁绊条件 {index+1}</strong><button type="button" aria-label={`删除羁绊条件${index+1}`} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-red-600 hover:bg-red-50" onClick={()=>onChange(bonds.filter((_,i)=>i!==index))}><Trash2 size={16}/></button></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="text-xs font-bold">卡牌序号</span><input aria-label={`羁绊条件${index+1}卡牌序号`} className="field mt-1" defaultValue={bond.cardNos.join(" ")} placeholder="例如：001 002 003" maxLength={6500}
          onChange={event=>update(index,{cardNos:parseBondCardNos(event.target.value)})}/><span className="mt-1 block text-xs text-muted">填写固定序号，用空格分隔；任意一张触发即可。</span></label>
        <SearchableSkillSelect label="卡牌行动" value={bond.event} options={options(CARD_BATTLE_BOND_EVENTS)} onChange={event=>update(index,{event})}/>
      </div>
      {bond.event === "shielded" && <p className="mt-2 text-xs text-muted">己方指定卡牌实际获得护盾时触发；多张卡牌分别判定。</p>}
      {bond.event && <div className="mt-4 space-y-3 border-t border-violet-100 pt-3">
        {bond.actions.map((action,actionIndex)=>{
          const change=(patch:Partial<CardBattleBondActionDraft>)=>update(index,{actions:bond.actions.map((item,i)=>i===actionIndex?{...item,...patch}:item)});
          return <div key={actionIndex} className="rounded-lg bg-violet-50/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2"><strong className="text-xs">羁绊效果 {actionIndex+1}</strong><button type="button" aria-label={`删除羁绊条件${index+1}效果${actionIndex+1}`} disabled={bond.actions.length===1} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-red-600 disabled:opacity-30" onClick={()=>update(index,{actions:bond.actions.filter((_,i)=>i!==actionIndex)})}><Trash2 size={15}/></button></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SearchableSkillSelect label="羁绊技能对象" value={action.target} options={options(CARD_BATTLE_BOND_TARGETS)} onChange={target=>change({target})}/>
              {action.target && <SearchableSkillSelect label="羁绊技能类型" value={action.type} options={options(CARD_BATTLE_BOND_ACTIONS)} onChange={type=>change({type,value:bondNeedsValue(type)?action.value??1:null,duration:bondNeedsDuration(type)?action.duration??1:null})}/>}
              {action.target && bondNeedsValue(action.type) && <label><span className="text-xs font-bold">羁绊技能数值（{bondIsRate(action.type)?"百分点":"固定数值"}）</span><input aria-label={`羁绊条件${index+1}效果${actionIndex+1}数值`} type="number" className="field mt-1" min={bondIsRate(action.type)?.01:1} max={bondValueMaximum(action.type)} step={bondIsRate(action.type)?.01:1} value={action.value??""} onChange={event=>change({value:event.target.value===""?null:Number(event.target.value)})}/></label>}
              {action.type === "shield" && <p className="text-xs text-muted">护盾按固定数值全额叠加、独立到期；实际获得护盾会触发对应羁绊。</p>}
              {(action.type === "dodge_up" || action.type === "hit_up") && <p className="text-xs text-muted">按百分点全额叠加、独立到期；实际闪避概率为闪避率减去对方命中率，限制在 0%–100%。</p>}
              {action.type === "crit_damage_up" && <p className="text-xs text-muted">按百分点增加，例如 150% 增加 50 后为 200%；各层全额叠加、独立到期。</p>}
              {action.type === "crit_rate_up" && <p className="text-xs text-muted">按百分点增加，各层全额叠加、独立到期；实际暴击率最高 100%。</p>}
              {action.target && bondNeedsDuration(action.type) && <label><span className="text-xs font-bold">羁绊技能回合</span><input aria-label={`羁绊条件${index+1}效果${actionIndex+1}回合`} type="number" min="1" step="1" className="field mt-1" value={action.duration??""} onChange={event=>change({duration:event.target.value===""?null:Number(event.target.value)})}/></label>}
            </div>
          </div>;
        })}
        <button type="button" disabled={bond.actions.length>=50} className="btn btn-secondary min-h-11 px-3 text-xs" onClick={()=>update(index,{actions:[...bond.actions,emptyAction()]})}><Plus size={15}/>添加羁绊效果</button>
        <p className="text-xs leading-5 text-muted">羁绊卡指本次触发的卡。随机目标为友军，包含自己且不重复。效果按顺序执行；Buff 独立叠加，1 回合表示本回合结束失效。</p>
      </div>}
      {cardBattleBondError(bond) && <p role="status" className="mt-2 text-xs text-amber-700">{cardBattleBondError(bond)}</p>}
    </section>)}
  </section>;
}
