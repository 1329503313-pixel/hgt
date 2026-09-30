import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_FALLBACK_INSULT_WORDS,
  CHAT_FALLBACK_LEADER_NAMES,
  isChatTextBlocked
} from "./chatFallbackWords.js";

test("兜底词命中时拦截辱骂词和现任最高层完整姓名", () => {
  for (const word of [...CHAT_FALLBACK_INSULT_WORDS, ...CHAT_FALLBACK_LEADER_NAMES]) {
    assert.equal(isChatTextBlocked(`你好，${word}！`), true, word);
  }
  assert.equal(isChatTextBlocked("你是傻ｂ"), true);
  assert.equal(isChatTextBlocked("NMSL"), true);
});

test("移除的词、诈骗词及单独姓氏不触发兜底拦截", () => {
  for (const content of [
    "死全家", "全家死光", "断子绝孙", "你真垃圾", "杂种", "野种", "王八蛋",
    "去死吧", "你去死", "你怎么不去死", "你不如去死",
    "刷单返佣", "转入安全账户", "习", "李", "今天圈子聊得很开心"
  ]) {
    assert.equal(isChatTextBlocked(content), false, content);
  }
});
