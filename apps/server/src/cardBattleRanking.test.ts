import assert from "node:assert/strict";
import test from "node:test";
import { cardBattleRankDefeatedNotificationContent, canClaimEmptyCardBattleRank, promoteCardBattleRankingEntries } from "./cardBattleRanking.js";
import { compactCardBattleRankingEntries } from "./cardBattleRankingState.js";

const entry = (rank: number, userId: string) => ({
  rank,
  userId,
  lineup: [`${userId}-1`, `${userId}-2`, `${userId}-3`, `${userId}-4`, `${userId}-5`],
  totalPower: rank * 100,
  achievedAt: new Date(`2026-08-${String(Math.min(rank, 28)).padStart(2, "0")}T00:00:00.000Z`),
});

test("自动收拢 1、2、3、5、8 为 1、2、3、4、5，保留卡组和达成时间", () => {
  const entries = [1, 2, 3, 5, 8].map((rank) => entry(rank, `user${rank}`));
  const compacted = compactCardBattleRankingEntries(entries);
  assert.deepEqual(compacted.map((item) => [item.rank, item.userId]), [[1,"user1"],[2,"user2"],[3,"user3"],[4,"user5"],[5,"user8"]]);
  assert.equal(compacted[4].achievedAt, entries[4].achievedAt);
  assert.deepEqual(compacted[4].lineup, entries[4].lineup);
  assert.deepEqual(entries.map((item) => item.rank), [1,2,3,5,8]);
  assert.deepEqual(compactCardBattleRankingEntries(compacted), compacted);
  assert.deepEqual(compactCardBattleRankingEntries([]), []);
});

test("未上榜挑战者胜利后插入守榜者之前，并收拢空位", () => {
  const result = promoteCardBattleRankingEntries(
    [entry(1, "first"), entry(3, "third"), entry(7, "seventh")],
    entry(3, "challenger"),
    3,
  );
  assert.deepEqual(result.map(({ rank, userId }) => [rank, userId]), [
    [1, "first"], [2, "challenger"], [3, "third"], [4, "seventh"],
  ]);
});

test("已上榜挑战者先移除旧榜位，再占据更高位置并推动后续名次", () => {
  const result = promoteCardBattleRankingEntries(
    [entry(1, "first"), entry(2, "defender"), entry(3, "third"), entry(5, "challenger"), entry(8, "eighth")],
    entry(2, "challenger"),
    2,
  );
  assert.deepEqual(result.map(({ rank, userId }) => [rank, userId]), [
    [1, "first"], [2, "challenger"], [3, "defender"], [4, "third"], [5, "eighth"],
  ]);
});

test("第一百名顺延后掉出榜单", () => {
  const result = promoteCardBattleRankingEntries(
    Array.from({length:100}, (_,index) => entry(index+1, `user${index+1}`)),
    entry(99, "challenger"),
    99,
  );
  assert.equal(result.length,100);
  assert.deepEqual(result.slice(-2).map(({ rank, userId }) => [rank, userId]), [
    [99, "challenger"], [100, "user99"],
  ]);
});

test("已上榜用户只能迁移到比当前排名更靠前的空位", () => {
  assert.equal(canClaimEmptyCardBattleRank(null, 80), true);
  assert.equal(canClaimEmptyCardBattleRank(80, 20), true);
  assert.equal(canClaimEmptyCardBattleRank(80, 80), false);
  assert.equal(canClaimEmptyCardBattleRank(20, 80), false);
});

test("被攻榜用户收到挑战者昵称和最新排名，掉出百名时明确提示未上榜", () => {
  assert.equal(cardBattleRankDefeatedNotificationContent("海底玩家", 8), "海底玩家在卡牌对战榜中战胜了您，您当前的排名是第8名");
  assert.equal(cardBattleRankDefeatedNotificationContent("海底玩家", null), "海底玩家在卡牌对战榜中战胜了您，您当前暂未上榜");
});
