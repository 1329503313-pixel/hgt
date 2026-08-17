import assert from "node:assert/strict";
import test from "node:test";
import { getRandomOnlineSoupRoomName, ONLINE_SOUP_ROOM_NAMES } from "./onlineSoupRoomNames";

test("online soup room name pool contains 100 unique names", () => {
  assert.equal(ONLINE_SOUP_ROOM_NAMES.length, 100);
  assert.equal(new Set(ONLINE_SOUP_ROOM_NAMES).size, 100);
});

test("random room name can select the first and last entries", () => {
  assert.equal(getRandomOnlineSoupRoomName(() => 0), "汤里有鬼");
  assert.equal(getRandomOnlineSoupRoomName(() => 0.999999), "开锅破案");
});
