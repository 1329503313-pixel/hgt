import { createReadStream, readFileSync, statSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import OSS from "ali-oss";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const artifactRoot = resolve(repoRoot, "artifacts", "android");
const bucket = "zgkc-storage";
const keyPrefix = "hgt/apps";
const publicBase = "https://zgkc-storage.kjcxchina.com";

function secret(envName, fileEnvName) {
  if (process.env[fileEnvName]) return readFileSync(process.env[fileEnvName], "utf8").trim();
  return process.env[envName]?.trim() ?? "";
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

if (!process.argv.includes("--confirm-upload")) {
  fail("Refusing to upload without --confirm-upload.");
}

const explicitPathIndex = process.argv.indexOf("--apk");
let apkPath;
if (explicitPathIndex >= 0) {
  apkPath = resolve(repoRoot, process.argv[explicitPathIndex + 1] ?? "");
} else {
  const version = readJson(resolve(repoRoot, "apps/app-android/release/version.json"));
  const manifestPath = resolve(artifactRoot, version.versionName, "release-manifest.json");
  const manifest = readJson(manifestPath);
  if (manifest.configuration !== "release") fail("The current release manifest does not describe a Release APK.");
  apkPath = resolve(artifactRoot, version.versionName, manifest.fileName);
}

const relativeApkPath = relative(artifactRoot, apkPath);
if (relativeApkPath.startsWith("..") || relativeApkPath.split(sep).includes("..")) {
  fail("Only APKs under artifacts/android may be uploaded.");
}
if (!apkPath.toLowerCase().endsWith("-release.apk")) fail("Only a signed *-release.apk artifact may be uploaded.");
if (!statSync(apkPath).isFile()) fail(`APK not found: ${apkPath}`);

const verification = spawnSync(
  "powershell",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(repoRoot, "scripts/android/verify-android-artifact.ps1"), "-ApkPath", apkPath],
  { cwd: repoRoot, stdio: "inherit" }
);
if (verification.status !== 0) fail("APK verification failed; upload was not attempted.");

const endpoint = process.env.ALIYUN_OSS_ENDPOINT?.trim() ?? "";
const region = process.env.ALIYUN_OSS_REGION?.trim() ?? "";
const accessKeyId = secret("ALIYUN_OSS_ACCESS_KEY_ID", "ALIYUN_OSS_ACCESS_KEY_ID_FILE");
const accessKeySecret = secret("ALIYUN_OSS_ACCESS_KEY_SECRET", "ALIYUN_OSS_ACCESS_KEY_SECRET_FILE");
if (!endpoint || !region || !accessKeyId || !accessKeySecret) {
  fail("OSS credentials are incomplete; upload was not attempted.");
}

const versionName = readJson(resolve(repoRoot, "apps/app-android/release/version.json")).versionName;
const fileName = apkPath.split(/[\\/]/).at(-1);
const objectKey = `${keyPrefix}/${versionName}/${fileName}`;
const publicUrl = `${publicBase}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
const client = new OSS({
  endpoint,
  region,
  bucket,
  accessKeyId,
  accessKeySecret,
  authorizationV4: true,
  secure: endpoint.startsWith("https://"),
  timeout: 300_000
});

await client.put(objectKey, createReadStream(apkPath), {
  headers: {
    "Content-Type": "application/vnd.android.package-archive",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "x-oss-object-acl": "public-read",
    "x-oss-forbid-overwrite": "true"
  }
});

process.stdout.write(`APK_URL=${publicUrl}\n`);
