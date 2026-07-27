import test from "node:test";
import assert from "node:assert/strict";

process.env.ALIYUN_OSS_ENDPOINT = "https://oss-cn-beijing.aliyuncs.com";
process.env.ALIYUN_OSS_REGION = "oss-cn-beijing";
process.env.ALIYUN_OSS_BUCKET = "test-bucket";
process.env.ALIYUN_OSS_KEY_PREFIX = "test-prefix";
process.env.ALIYUN_OSS_ACCESS_KEY_ID = "test-key-id";
process.env.ALIYUN_OSS_ACCESS_KEY_SECRET = "test-key-secret";

const {
  mediaObjectKey,
  ossKeyFromRef,
  ossRef,
  ossRefFromPublicUrl,
  publicOssUrl
} = await import("./ossStorage.js");

test("OSS object key uses stable content hash and normalized path parts", () => {
  const input = {
    category: "assets/cards",
    entityId: "card 1",
    variant: "thumbnail",
    contentType: "image/webp",
    extension: ".webp"
  };
  const first = mediaObjectKey(input, Buffer.from("same-content"));
  const second = mediaObjectKey(input, Buffer.from("same-content"));
  assert.equal(first, second);
  assert.match(first, /^test-prefix\/assets\/cards\/card_201\/thumbnail\/[a-f0-9]{64}\.webp$/);
});

test("OSS refs convert to public bucket URLs and back", () => {
  const reference = ossRef("test-prefix/users/u1/avatar/file.webp");
  assert.equal(ossKeyFromRef(reference), "test-prefix/users/u1/avatar/file.webp");
  const url = publicOssUrl(reference);
  assert.equal(url, "https://test-bucket.oss-cn-beijing.aliyuncs.com/test-prefix/users/u1/avatar/file.webp");
  assert.equal(ossRefFromPublicUrl(url!), reference);
});

test("OSS refs reject a different bucket", () => {
  assert.equal(ossKeyFromRef("oss://other-bucket/test-prefix/a.webp"), null);
});

