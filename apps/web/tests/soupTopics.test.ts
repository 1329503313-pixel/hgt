import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const soupManagement = readFileSync(new URL("../src/components/admin/SoupManagement.tsx", import.meta.url), "utf8");
const soupEditor = readFileSync(new URL("../src/components/SoupEditor.tsx", import.meta.url), "utf8");

test("汤品后台只向超级管理员展示话题子栏目", () => {
  assert.match(soupManagement, /\{isSuperAdmin && \([\s\S]*?>\s*话题\s*<\/button>/);
  assert.match(soupManagement, /section === "topics" && isSuperAdmin/);
});

test("汤品表单只加载上架话题并允许不绑定", () => {
  assert.match(soupEditor, /api<\{ topics: SoupTopicOption\[\] \}>\("\/api\/soup-topics"/);
  assert.match(soupEditor, /<option value="">不绑定话题<\/option>/);
  assert.match(soupEditor, /\{value\.topicId && !topics\.some/);
  assert.match(soupEditor, /保存时会保留；改选后不能再次选择该话题/);
});
