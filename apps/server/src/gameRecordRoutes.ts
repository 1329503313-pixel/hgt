import type { Router } from "express";
import type mysql from "mysql2/promise";
import { pool } from "./db.js";
import { recordJson } from "./gameRecords.js";
import { publicFrozenCard } from "./cardBattleRoom.js";
import { resolveCardBattleSettlementPlayers } from "./cardBattleSettlement.js";
import type { CardBattlePlayerInput, CardBattleResult } from "./cardBattle.js";

const recordView = (row: mysql.RowDataPacket) => ({...recordJson<object>(row.summary_json),
  id:String(row.id),kind:String(row.kind),subtype:String(row.subtype),endedAt:new Date(row.ended_at).toISOString(),
  role:String(row.role),finalRank:row.final_rank==null?null:Number(row.final_rank),rankState:String(row.rank_state)});

export function registerGameRecordRoutes(router: Router, db: mysql.Pool = pool) {
  router.get('/game-records', async(req,res)=>{
    const user = (req as any).user as {id:string}|null;
    if(!user){res.status(401).json({error:'请先登录'});return;}
    const kind=String(req.query.kind ?? 'soup'), subtype=String(req.query.subtype ?? 'all');
    if(!['soup','impostor','card_battle'].includes(kind) || !['all','room','boss','ranking'].includes(subtype)) {
      res.status(400).json({error:'游戏分类不正确'});return;
    }
    const page=Math.max(1,Math.min(1000000,Math.floor(Number(req.query.page)||1)));
    const filter="owners.user_id=? AND records.kind=?"+(kind==='card_battle' && subtype!=='all'?' AND records.subtype=?':'');
    const params=[user.id,kind,...(kind==='card_battle' && subtype!=='all'?[subtype]:[])];
    const [[total]] = await db.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS total FROM game_records records
      JOIN game_record_users owners ON owners.record_id=records.id WHERE ${filter}`,params);
    const [rows] = await db.query<mysql.RowDataPacket[]>(`SELECT records.id,records.kind,records.subtype,records.ended_at,
      records.summary_json,owners.role,owners.final_rank,owners.rank_state FROM game_records records
      JOIN game_record_users owners ON owners.record_id=records.id WHERE ${filter}
      ORDER BY records.ended_at DESC,records.id DESC LIMIT 10 OFFSET ?`,[...params,(page-1)*10]);
    res.set('Cache-Control','no-store').json({records:rows.map(recordView),total:Number(total.total),page,pageSize:10});
  });
  router.get('/game-records/:id',async(req,res)=>{
    const user=(req as any).user as {id:string}|null;
    if(!user){res.status(401).json({error:'请先登录'});return;}
    const [[row]]=await db.query<mysql.RowDataPacket[]>(`SELECT records.*,owners.role,owners.final_rank,owners.rank_state
      FROM game_records records JOIN game_record_users owners ON owners.record_id=records.id
      WHERE records.id=? AND owners.user_id=?`,[req.params.id,user.id]);
    if(!row){res.status(404).json({error:'游戏记录不存在或无权查看'});return;}
    const detail=recordJson<{messages?:Array<{id:string;sequence:string}>;lineups?:CardBattlePlayerInput[];result?:CardBattleResult;state?:unknown;steps?:unknown;legacy?:boolean}>(row.detail_json);
    res.set('Cache-Control','no-store');
    if(row.kind==='card_battle') {
      const result=detail.result!;
      res.json({record:recordView(row),replay:{gameId:row.source_id,gameNumber:recordJson<any>(row.summary_json).gameNumber,
        name:recordJson<any>(row.summary_json).title,
        lineups:detail.lineups!.map(p=>({userId:p.userId,nickname:p.nickname,seat:p.seat,playerSeat:p.playerSeat,cards:p.cards.map(publicFrozenCard)})),
        result:{...result,players:resolveCardBattleSettlementPlayers(result)}}});
      return;
    }
    const after=String(req.query.after ?? '0');
    if(!/^\d{1,20}$/.test(after)){res.status(400).json({error:'会话游标不正确'});return;}
    const all=(detail.messages ?? []).filter(m=>BigInt(m.sequence)>BigInt(after));
    const messages=all.slice(0,100);
    if(messages.length) {
      // Also covers a recall committing concurrently with archive creation.
      const [recalled]=await db.query<mysql.RowDataPacket[]>(`SELECT id FROM online_soup_messages
        WHERE id IN (${messages.map(()=>'?').join(',')}) AND recalled_at IS NOT NULL`,messages.map(m=>m.id));
      for(const message of messages)if(recalled.some(m=>String(m.id)===message.id))Object.assign(message,{content:'消息已撤回',recalled:true,answer:null,stickerUrl:null});
    }
    res.json({record:recordView(row),messages,hasMore:all.length>100,nextCursor:messages.at(-1)?.sequence ?? null,
      ...(after==='0'?{state:detail.state,steps:detail.steps,legacy:detail.legacy}:{})});
  });
}
