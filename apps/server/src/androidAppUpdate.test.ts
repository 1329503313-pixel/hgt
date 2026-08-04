import assert from "node:assert/strict";
import test from "node:test";
import { mapAndroidReleaseRow, resolveAndroidUpdate, type AndroidReleaseManifest } from "./androidAppUpdate.js";

const release: AndroidReleaseManifest = {
  enabled: true,
  latestVersionCode: 12,
  latestVersionName: "1.2.0",
  minSupportedVersionCode: 10,
  apkUrl: "https://download.example.com/hgt-1.2.0.apk",
  releaseNotes: ["修复消息加载问题"],
  publishedAt: "2026-08-03T00:00:00.000Z"
};

test("Android 旧版本可收到普通更新", () => {
  const result = resolveAndroidUpdate(11, release);
  assert.equal(result.updateAvailable, true);
  assert.equal(result.forceUpdate, false);
});

test("Android 低于最低支持版本时强制更新", () => {
  const result = resolveAndroidUpdate(9, release);
  assert.equal(result.updateAvailable, true);
  assert.equal(result.forceUpdate, true);
});

test("已是最新版或发布关闭时不提示", () => {
  assert.equal(resolveAndroidUpdate(12, release).updateAvailable, false);
  assert.equal(resolveAndroidUpdate(1, { ...release, enabled: false }).updateAvailable, false);
  assert.equal(resolveAndroidUpdate(1, { ...release, apkUrl: "http://insecure.example.com/app.apk" }).updateAvailable, false);
});

test("数据库没有已发布版本时返回关闭状态", () => {
  const result = resolveAndroidUpdate(1, null);
  assert.equal(result.enabled, false);
  assert.equal(result.latestVersionCode, 0);
  assert.equal(result.updateAvailable, false);
});

test("数据库行映射为客户端发布清单", () => {
  const mapped = mapAndroidReleaseRow({
    id: "release-12",
    version_code: 12,
    version_name: "1.2.0",
    min_supported_version_code: 10,
    apk_url: release.apkUrl,
    release_notes: JSON.stringify(release.releaseNotes),
    published_at: new Date("2026-08-03T00:00:00.000Z"),
    enabled: 1,
    created_at: new Date("2026-08-02T00:00:00.000Z"),
    updated_at: new Date("2026-08-03T00:00:00.000Z")
  });
  assert.equal(mapped.latestVersionCode, 12);
  assert.deepEqual(mapped.releaseNotes, release.releaseNotes);
  assert.equal(mapped.enabled, true);
});
