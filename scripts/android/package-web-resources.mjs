import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const distDir = resolve(repoRoot, "apps", "web", "dist-android");
const versionFile = resolve(repoRoot, "apps", "app-android", "release", "version.json");
const artifactDir = resolve(repoRoot, "artifacts", "web-resources");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const version = JSON.parse(readFileSync(versionFile, "utf8").replace(/^﻿/, ""));
const versionName = version.versionName;
const versionCode = version.versionCode;

if (!statSync(distDir).isDirectory()) {
  fail("dist-android directory not found. Run npm run app:android:web first.");
}

const zipName = `dist-android.zip`;
const outDir = resolve(artifactDir, versionName);
mkdirSync(outDir, { recursive: true });
const zipPath = resolve(outDir, zipName);

// Use tar with gzip via archive-tar-ish approach — write a simple archive
// Windows: use PowerShell Compress-Archive for zip
const ps = spawnSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${distDir}\\*' -DestinationPath '${zipPath}' -Force -CompressionLevel Fastest`
  ],
  { stdio: "inherit" }
);
if (ps.status !== 0) fail("ZIP compression failed.");

const zipSize = statSync(zipPath).size;
const zipSha256 = createHash("sha256")
  .update(readFileSync(zipPath))
  .digest("hex")
  .toLowerCase();

const manifest = {
  versionName,
  versionCode,
  fileName: zipName,
  fileSize: zipSize,
  sha256: zipSha256,
  builtAt: new Date().toISOString()
};

const manifestPath = resolve(outDir, "web-resource-manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

console.log(`ZIP: ${zipPath}`);
console.log(`Size: ${zipSize} bytes`);
console.log(`SHA256: ${zipSha256}`);
