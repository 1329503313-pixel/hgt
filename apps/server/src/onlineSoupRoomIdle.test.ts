import assert from "node:assert/strict";
import test from "node:test";
import {
  ONLINE_SOUP_SINGLE_USER_IDLE_MINUTES,
  shouldAutoCloseIdleOnlineSoupRoom,
} from "./onlineSoupRoomIdle.js";

const now = new Date("2026-08-13T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

test("single-user preparing rooms close only after the idle window", () => {
  assert.equal(ONLINE_SOUP_SINGLE_USER_IDLE_MINUTES, 15);
  assert.equal(shouldAutoCloseIdleOnlineSoupRoom({
    status: "preparing",
    activeUserCount: 1,
    lastActionAt: minutesAgo(16),
  }, now), true);
  assert.equal(shouldAutoCloseIdleOnlineSoupRoom({
    status: "preparing",
    activeUserCount: 1,
    lastActionAt: minutesAgo(15),
  }, now), true);
  assert.equal(shouldAutoCloseIdleOnlineSoupRoom({
    status: "preparing",
    activeUserCount: 1,
    lastActionAt: minutesAgo(14),
  }, now), false);
});

test("playing, ended, closed, and multi-user rooms are retained", () => {
  for (const status of ["playing", "ended", "closed"]) {
    assert.equal(shouldAutoCloseIdleOnlineSoupRoom({
      status,
      activeUserCount: 1,
      lastActionAt: minutesAgo(30),
    }, now), false);
  }
  assert.equal(shouldAutoCloseIdleOnlineSoupRoom({
    status: "preparing",
    activeUserCount: 2,
    lastActionAt: minutesAgo(30),
  }, now), false);
});

test("a recent member transition restarts the idle window", () => {
  assert.equal(shouldAutoCloseIdleOnlineSoupRoom({
    status: "preparing",
    activeUserCount: 1,
    lastActionAt: minutesAgo(30),
    lastMemberTransitionAt: minutesAgo(5),
  }, now), false);
  assert.equal(shouldAutoCloseIdleOnlineSoupRoom({
    status: "preparing",
    activeUserCount: 1,
    lastActionAt: minutesAgo(30),
    lastMemberTransitionAt: minutesAgo(20),
  }, now), true);
});
