import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profileViews = readFileSync(new URL("../src/components/ProfileViews.tsx", import.meta.url), "utf8");
const soupLinkList = readFileSync(new URL("../src/components/SoupLinkList.tsx", import.meta.url), "utf8");
const userProfilePage = readFileSync(new URL("../src/pages/UserProfilePage.tsx", import.meta.url), "utf8");
const mySoupsPage = readFileSync(new URL("../src/pages/MySoupsPage.tsx", import.meta.url), "utf8");
const minePage = readFileSync(new URL("../src/pages/MinePage.tsx", import.meta.url), "utf8");

test("海龟汤置顶标识在用户主页、我的发布栏和我的作品显式启用", () => {
  assert.match(profileViews, /showProfilePins = false/);
  assert.match(profileViews, /showProfilePins && soup\.isProfilePinned/);
  assert.match(soupLinkList, /showProfilePins = false/);
  assert.match(soupLinkList, /showProfilePins && soup\.isProfilePinned/);
  assert.match(userProfilePage, /<SoupCoverGrid[^>]+showProfilePins/);
  assert.match(mySoupsPage, /<MyListPage[^>]+showProfilePins/);
  assert.match(minePage, /<SoupCoverGrid[^>]+showProfilePins=\{activeTab === "published"\}/);
});

test("我的收藏和点赞栏不展示其他作者的主页置顶标识", () => {
  assert.doesNotMatch(minePage, /showProfilePins=\{true\}/);
  assert.match(minePage, /showProfilePins=\{activeTab === "published"\}/);
});

test("我的作品只展示置顶状态，置顶操作仍集中在作品详情", () => {
  assert.doesNotMatch(mySoupsPage, /profile-pin/);
  assert.doesNotMatch(mySoupsPage, /sort\s*\(/);
});

test("详情页置顶后刷新我的发布缓存", () => {
  assert.match(
    readFileSync(new URL("../src/pages/DetailPage.tsx", import.meta.url), "utf8"),
    /refreshMineContentCache\(user\.id, "published"\)/,
  );
});
