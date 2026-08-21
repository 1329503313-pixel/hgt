import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_MUSIC_MAX_BYTES, isBackgroundMusicMimeType } from "./backgroundMusic.js";

test("背景音乐上传接受跨端兼容的 MP3、M4A 和 WAV MIME", () => {
  for (const contentType of ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav"]) {
    assert.equal(isBackgroundMusicMimeType(contentType), true);
  }
  assert.equal(isBackgroundMusicMimeType("audio/ogg"), false);
  assert.equal(isBackgroundMusicMimeType("video/mp4"), false);
});

test("背景音乐原始上传上限固定为 50MB", () => {
  assert.equal(BACKGROUND_MUSIC_MAX_BYTES, 50 * 1024 * 1024);
});
