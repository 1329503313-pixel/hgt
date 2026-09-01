import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const userManagement = readFileSync(new URL("../src/components/admin/UserManagement.tsx", import.meta.url), "utf8");

test("后台单人和批量发放贝壳都要求填写正整数领取时限", () => {
  assert.match(userManagement, /const \[shellClaimDays, setShellClaimDays\]/);
  assert.match(userManagement, /const \[bulkShellClaimDays, setBulkShellClaimDays\]/);
  assert.match(userManagement, /领取时限（天）/);
  assert.match(userManagement, /Number\.isSafeInteger\(claimDays\)/);
  assert.match(userManagement, /\{ claimDays \}/);
  assert.match(userManagement, /claimDays: Number\(bulkShellClaimDays\)/);
});

test("后台明确说明在线立即到账、离线登录领取和 N×24 小时过期规则", () => {
  assert.match(userManagement, /在线用户发放后立即到账/);
  assert.match(userManagement, /N×24 小时内登录领取/);
  assert.match(userManagement, /待登录领取/);
});
