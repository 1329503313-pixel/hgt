import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAssetManifest, verifyAssets } from "./check-production-assets.mjs";

test("Git archive preserves Chinese asset paths and bytes; bad artifacts fail the gate", () => {
  const root = mkdtempSync(join(tmpdir(), "hgt-asset-test-"));
  try {
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "--quiet");
    // Reproduce the release host's setting. Archive generation must override it.
    git("config", "core.autocrlf", "true");
    const name = "stickers/汤汤/TTZT_01_你好呀_V1_static.webp";
    mkdirSync(join(root, "apps/web/public/stickers/汤汤"), { recursive: true });
    writeFileSync(join(root, "apps/web/public", name), Buffer.from([82, 73, 70, 70, 0, 255, 87, 69, 66, 80]));
    writeFileSync(join(root, "apps/web/public/manifest.json"), '{"name":"汤汤"}\n');
    git("add", "apps");
    git("-c", "user.name=Asset Test", "-c", "user.email=asset-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture");
    const commit = git("rev-parse", "HEAD").trim();
    const manifest = createAssetManifest(commit, root);
    assert.equal(manifest.files.length, 2);
    assert.ok(manifest.files.some(file => file.path === name));
    const archive = join(root, "assets.tar.gz");
    git("-c", "core.autocrlf=false", "archive", "--format=tar.gz", `--output=${archive}`, commit, "--", "apps/web/public");
    const extracted = join(root, "extracted");
    mkdirSync(extracted);
    const flags = process.platform === "win32" ? ["--options", "hdrcharset=UTF-8"] : [];
    execFileSync("tar", [...flags, "-xzf", archive, "-C", extracted]);
    const publicRoot = join(extracted, "apps/web/public");
    assert.equal(verifyAssets(manifest, publicRoot), 2);
    const image = join(publicRoot, name);
    renameSync(image, image + ".garbled");
    assert.throws(() => verifyAssets(manifest, publicRoot), /missing \(check filename encoding\)/);
    renameSync(image + ".garbled", image);
    writeFileSync(image, "<html>SPA fallback is not an image</html>");
    assert.throws(() => verifyAssets(manifest, publicRoot), /content differs from Git/);
    assert.throws(() => verifyAssets({ ...manifest, files: [] }, publicRoot), /Invalid public asset manifest/);
    assert.throws(() => verifyAssets({ ...manifest, files: [{ ...manifest.files[0], path: "../escape" }] }, publicRoot), /Invalid public asset manifest entry/);
  } finally {
    // root is the absolute, freshly created directory returned by mkdtempSync.
    rmSync(root, { recursive: true, force: true });
  }
});
