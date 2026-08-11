import assert from "node:assert/strict";
import test from "node:test";
import { getSticker } from "./stickers.js";

test("sticker metadata provides the message preview name", () => {
  assert.equal(getSticker("tangtang-detective-hello")?.name, "你好呀");
  assert.equal(getSticker("tangtang-detective-confused")?.name, "我懵了");
  assert.deepEqual(
    {
      name: getSticker("tangtang-detective-unbelievable")?.name,
      owned: getSticker("tangtang-detective-unbelievable")?.owned,
      price: getSticker("tangtang-detective-unbelievable")?.price
    },
    { name: "真的假的？", owned: true, price: 0 }
  );
  assert.equal(getSticker("tangtang-detective-awesome")?.name, "你太棒了！");
  assert.equal(getSticker("tangtang-detective-give-up")?.name, "我放弃了");
  assert.equal(getSticker("missing-sticker"), null);
});
