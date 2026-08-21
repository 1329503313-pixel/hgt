import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const bannerStyles = styles.match(/\.vip-online-banner\s*\{([\s\S]*?)\}/)?.[1] ?? "";

test("VIP7 以上登录提醒使用白色容器而非彩色渐变", () => {
  assert.match(bannerStyles, /background:\s*#fff;/);
  assert.match(bannerStyles, /color:\s*#172033;/);
  assert.doesNotMatch(bannerStyles, /linear-gradient/);
});
