import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profileViews = readFileSync(new URL("../src/components/ProfileViews.tsx", import.meta.url), "utf8");
const userProfilePage = readFileSync(new URL("../src/pages/UserProfilePage.tsx", import.meta.url), "utf8");
const minePage = readFileSync(new URL("../src/pages/MinePage.tsx", import.meta.url), "utf8");

test("海龟汤置顶标识只由用户主页显式启用", () => {
  assert.match(profileViews, /showProfilePins = false/);
  assert.match(profileViews, /showProfilePins && soup\.isProfilePinned/);
  assert.match(userProfilePage, /<SoupCoverGrid[^>]+showProfilePins/);
  assert.doesNotMatch(minePage, /<SoupCoverGrid[^>]+showProfilePins/);
});
