import assert from "node:assert/strict";
import test from "node:test";
import { getSticker } from "./stickers.js";

test("sticker metadata provides the message preview name", () => {
  assert.equal(getSticker("tangtang-detective-hello")?.name, "你好呀");
  assert.equal(getSticker("tangtang-detective-confused")?.name, "我懵了");
  assert.equal(getSticker("missing-sticker"), null);
});
