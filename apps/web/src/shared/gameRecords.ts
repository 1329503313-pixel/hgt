import type { BossReplay } from './cardBattleBoss';
import type { OnlineSoupAiHonors } from './types';

export type GameRecord = {
  id:string;kind:'soup'|'impostor'|'card_battle';subtype:'human'|'ai'|'voice'|'impostor'|'room'|'boss'|'ranking';
  title:string;endedAt:string;startedAt:string;role:'host'|'player';coverUrl?:string|null;honors?:OnlineSoupAiHonors;
  winner?:'good'|'impostor';winnerSeat?:number|null;endReason?:string;
  finalRank:number|null;rankState:'known'|'pending'|'unknown';
  players?:Array<{userId:string;nickname:string;seat:number;playerSeat?:number;power?:number;role?:string}>;
};
export type RecordedMessage = {
  id:string;sequence:string;type:string;senderId:string|null;senderName:string|null;content:string;createdAt:string;
  recalled:boolean;answer:string|null;questionNumber:number|null;remainingQuestionCountAfter:number|null;progress:number|null;
  replyId:string|null;stickerName:string|null;stickerUrl:string|null;
};
export type ImpostorRecordState = {
  recordAction?:{kind:string;label:string;targets?:string[];content?:string|null;attempt?:number;userId:string;day:number};
  day:number;phase:string;endReason:string|null;successes:number;failures:number;assassinationTargetUserId:string|null;
  players:Array<{userId:string;seat:number;role:string}>;
  nightActions:Record<string,{type:string;targetUserIds:string[]}>;
  investigations:Record<string,{targetUserIds:string[];reportedHasImpostor:boolean}>;
  missionChoices:Record<string,{choice:string;effectiveChoice:string;automatic:boolean}>;
  nomination:{ballots:Record<string,string[]>;attempt:number}|null;
  accusation:{ballots:Record<string,string|null>;attempt:number}|null;
  clues:Record<string,string|null>;readyUserIds:string[];
  history:Array<{day:number;result:string;missionTeamUserIds:string[];nightActions:ImpostorRecordState['nightActions'];missionChoices:ImpostorRecordState['missionChoices']}>;
};
export type GameRecordDetail = {record:GameRecord;messages?:RecordedMessage[];hasMore?:boolean;nextCursor?:string|null;
  replay?:BossReplay;state?:ImpostorRecordState;steps?:Array<{at:string;state:ImpostorRecordState}>;legacy?:boolean};
export const gameRecordType = {human:'文字玩汤',ai:'AI玩汤',voice:'语音玩汤（已下架）',impostor:'谁是伪人',room:'房间对战',boss:'BOSS对战',ranking:'排行榜对战'};
export const gameRecordTime = (value:string) => new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
export function gameRecordOutcome(record:GameRecord,userId:string) {
  if(record.kind==='impostor')return record.winner==='good'?'好人胜利':'伪人胜利';
  if(!record.winnerSeat)return '平局';
  return record.players?.find(p=>p.userId===userId)?.seat===record.winnerSeat?'胜利':'失败';
}
