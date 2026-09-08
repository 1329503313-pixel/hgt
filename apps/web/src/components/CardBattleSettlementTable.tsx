import { calculateCardBattleScore } from "@hgt/shared";
import type { OnlineCardBattleState } from "../shared/types";

type Player = NonNullable<NonNullable<OnlineCardBattleState["game"]>["settlement"]>["players"][number];

export function CardBattleSettlementTable({ player, winnerSeat }: { player: Player; winnerSeat: 1 | 2 | null }) {
  const won = winnerSeat === player.seat;
  return <section className={`overflow-hidden rounded-xl border ${won ? "border-amber-300/50 bg-amber-400/10" : "border-white/10 bg-white/5"}`}>
    <h3 className="border-b border-white/10 px-3 py-2.5 text-sm font-black"><span className={won ? "text-amber-200" : "text-slate-300"}>{won ? "胜利" : winnerSeat ? "失败" : `玩家 ${player.seat}`}</span><span className="ml-2 break-words">{player.nickname}</span></h3>
    <div className="overflow-x-auto" role="region" aria-label={`${player.nickname}的结算数据，可横向滚动`} tabIndex={0}>
    <table className="w-full text-[11px] leading-5 sm:text-xs" aria-label={`${player.nickname}的卡牌结算`}>
      <colgroup><col style={{ width: "28%" }} /><col style={{ width: "19%" }} /><col style={{ width: "19%" }} /><col style={{ width: "19%" }} /><col style={{ width: "15%" }} /></colgroup>
      <thead className="bg-slate-950/35 text-slate-200"><tr>{["卡牌", "伤害", "承伤", "辅助", "评分"].map((label, index) => <th key={label} scope="col" className={`px-1 py-2 font-bold ${index === 0 ? "pl-3 text-left" : "text-right last:pr-3"}`}>{label}</th>)}</tr></thead>
      <tbody className="tabular-nums">{[...player.cards].sort((a, b) => a.slot - b.slot).map((card) => <tr key={card.slot} className="border-t border-white/5">
        <th scope="row" className="min-w-[76px] break-words py-2.5 pl-3 pr-1 text-left font-medium text-white"><span className="mr-1 text-slate-400">{card.slot}</span>{card.name}</th>
        <td className="whitespace-nowrap px-1 py-2.5 text-right text-red-300">{card.damageDealt}</td>
        <td className="whitespace-nowrap px-1 py-2.5 text-right text-amber-200">{card.damageTaken}</td>
        <td className="whitespace-nowrap px-1 py-2.5 text-right text-emerald-300">{card.supportDone ?? card.healingDone ?? 0}</td>
        <td className="whitespace-nowrap py-2.5 pl-1 pr-3 text-right font-black text-cyan-200">{(card.score ?? calculateCardBattleScore(card.damageDealt, card.damageTaken, card.supportDone ?? card.healingDone ?? 0)).toFixed(1)}</td>
      </tr>)}</tbody>
    </table>
    </div>
  </section>;
}
