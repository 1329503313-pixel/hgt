import assert from "node:assert/strict";
import test from "node:test";
import { promoteCardBattleRankingEntries } from "./cardBattleRanking.js";

const entry = (rank: number, userId: string) => ({
  rank,
  userId,
  lineup: [`${userId}-1`, `${userId}-2`, `${userId}-3`, `${userId}-4`, `${userId}-5`],
  totalPower: rank * 100,
  achievedAt: new Date(`2026-08-${String(Math.min(rank, 28)).padStart(2, "0")}T00:00:00.000Z`),
});

test("未上榜挑战者胜利后占据目标位并让其后所有用户顺延，包括跨过空位", () => {
  const result = promoteCardBattleRankingEntries(
    [entry(1, "first"), entry(3, "third"), entry(7, "seventh")],
    entry(3, "challenger"),
    3,
  );
  assert.deepEqual(result.map(({ rank, userId }) => [rank, userId]), [
    [1, "first"], [3, "challenger"], [4, "third"], [8, "seventh"],
  ]);
});

test("已上榜挑战者先移除旧榜位，再占据更高位置并推动后续名次", () => {
  const result = promoteCardBattleRankingEntries(
    [entry(1, "first"), entry(2, "defender"), entry(3, "third"), entry(5, "challenger"), entry(8, "eighth")],
    entry(2, "challenger"),
    2,
  );
  assert.deepEqual(result.map(({ rank, userId }) => [rank, userId]), [
    [1, "first"], [2, "challenger"], [3, "defender"], [4, "third"], [9, "eighth"],
  ]);
});

test("第一百名顺延后掉出榜单", () => {
  const result = promoteCardBattleRankingEntries(
    [entry(99, "ninety-nine"), entry(100, "hundred")],
    entry(99, "challenger"),
    99,
  );
  assert.deepEqual(result.map(({ rank, userId }) => [rank, userId]), [
    [99, "challenger"], [100, "ninety-nine"],
  ]);
});
