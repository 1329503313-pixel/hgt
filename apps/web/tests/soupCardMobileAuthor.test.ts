import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const soupCard = readFileSync(new URL("../src/components/SoupCard.tsx", import.meta.url), "utf8");

test("手机端首页汤卡完整展示作者昵称且不渲染 VIP 和等级身份组件", () => {
  assert.match(soupCard, /className="flex min-w-0 flex-1 items-start lg:hidden"/);
  assert.match(soupCard, /className="min-w-0 flex-1 break-all leading-5"/);
  assert.match(soupCard, /<VipIdentity[\s\S]*className="hidden min-w-0 flex-1 lg:flex"/);
});
