import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? "" : process.argv[index + 1] ?? "";
};
const notesPath = valueAfter("--notes");
if (!notesPath) throw new Error("Usage: create-android-release-descriptor.mjs --notes <release-notes.txt>");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const version = readJson(resolve(repoRoot, "apps/app-android/release/version.json"));
const artifactRoot = resolve(repoRoot, "artifacts", "android", version.versionName);
const manifest = readJson(resolve(artifactRoot, "release-manifest.json"));
if (manifest.configuration !== "release") throw new Error("The Android manifest is not a Release build.");
if (manifest.versionCode !== version.versionCode || manifest.versionName !== version.versionName) {
  throw new Error("The Android artifact does not match release/version.json.");
}
if (!manifest.apkUrl) throw new Error("Upload the APK first; release-manifest.json has no apkUrl.");
if (!/^[0-9a-f]{64}$/.test(manifest.sha256)) throw new Error("The Android artifact SHA-256 is invalid.");
const remoteName = decodeURIComponent(new URL(manifest.apkUrl).pathname.split("/").at(-1));
if (remoteName !== manifest.fileName) throw new Error("The uploaded APK URL does not match the verified artifact.");

const releaseNotes = readFileSync(resolve(repoRoot, notesPath), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim().replace(/^[-*]\s+/, ""))
  .filter(Boolean);
if (releaseNotes.length === 0 || releaseNotes.length > 30) throw new Error("Release notes must contain 1-30 non-empty lines.");
if (releaseNotes.some((note) => note.length > 500)) throw new Error("Each release note must be at most 500 characters.");

const publishedAt = new Date();
publishedAt.setMilliseconds(0);

const descriptor = {
  versionCode: version.versionCode,
  versionName: version.versionName,
  minSupportedVersionCode: 0,
  apkUrl: manifest.apkUrl,
  apkSha256: manifest.sha256,
  releaseNotes,
  publishedAt: publishedAt.toISOString(),
  enabled: true
};
const output = resolve(artifactRoot, "android-release.json");
writeFileSync(output, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
process.stdout.write(`ANDROID_RELEASE_DESCRIPTOR=${output}\n`);
