import assert from "node:assert/strict";
import test from "node:test";
import { isAdminRelatedNickname } from "./nickname.js";

test("blocks administrator-related nickname variants", () => {
  for (const nickname of ["管理员", "超级管理员", "管理員", "管理猿", "admin", "Admin", "ADMIN", "ＡＤＭＩＮ", "a_d-m i.n", "admin123"]) {
    assert.equal(isAdminRelatedNickname(nickname), true, nickname);
  }
});

test("allows ordinary nicknames", () => {
  for (const nickname of ["汤汤", "侦探小龟", "Alice", "阿明"]) {
    assert.equal(isAdminRelatedNickname(nickname), false, nickname);
  }
});
