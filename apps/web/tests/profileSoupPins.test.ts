import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profileViews = readFileSync(new URL("../src/components/ProfileViews.tsx", import.meta.url), "utf8");
const soupLinkList = readFileSync(new URL("../src/components/SoupLinkList.tsx", import.meta.url), "utf8");
const userProfilePage = readFileSync(new URL("../src/pages/UserProfilePage.tsx", import.meta.url), "utf8");
const mySoupsPage = readFileSync(new URL("../src/pages/MySoupsPage.tsx", import.meta.url), "utf8");
const minePage = readFileSync(new URL("../src/pages/MinePage.tsx", import.meta.url), "utf8");

test("海龟汤置顶标识只由用户主页和我的作品显式启用", () => {
  assert.match(profileViews, /showProfilePins = false/);
  assert.match(profileViews, /showProfilePins && soup\.isProfilePinned/);
  assert.match(soupLinkList, /showProfilePins = false/);
  assert.match(soupLinkList, /showProfilePins && soup\.isProfilePinned/);
  assert.match(userProfilePage, /<SoupCoverGrid[^>]+showProfilePins/);
  assert.match(mySoupsPage, /<MyListPage[^>]+showProfilePins/);
  assert.doesNotMatch(minePage, /<SoupCoverGrid[^>]+showProfilePins/);
});

test("我的作品只展示置顶状态，不新增置顶操作或改变排序", () => {
  assert.doesNotMatch(mySoupsPage, /profile-pin/);
  assert.doesNotMatch(mySoupsPage, /sort\s*\(/);
});
