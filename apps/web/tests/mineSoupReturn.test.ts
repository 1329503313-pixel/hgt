import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profileViews = readFileSync(new URL("../src/components/ProfileViews.tsx", import.meta.url), "utf8");
const soupLinkList = readFileSync(new URL("../src/components/SoupLinkList.tsx", import.meta.url), "utf8");
const minePage = readFileSync(new URL("../src/pages/MinePage.tsx", import.meta.url), "utf8");
const detailPage = readFileSync(new URL("../src/pages/DetailPage.tsx", import.meta.url), "utf8");

test("从我的页面打开海龟汤后通过历史记录返回来源页面", () => {
  assert.match(minePage, /<SoupCoverGrid[^>]+returnTo="\/mine"/);
  assert.match(profileViews, /soupReturnTo: returnTo, soupReturnHistory: true/);
  assert.match(detailPage, /navigationOrigin\?\.soupReturnHistory && navigationOrigin\.soupReturnTo/);
  assert.match(detailPage, /navigate\(-1\)/);
});

test("我的子列表也携带当前路径作为详情返回来源", () => {
  assert.match(soupLinkList, /soupReturnTo: `\$\{location\.pathname\}\$\{location\.search\}`/);
  assert.match(soupLinkList, /soupReturnHistory: true/);
});
