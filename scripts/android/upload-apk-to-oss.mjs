import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import OSS from "ali-oss";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const artifactRoot = resolve(repoRoot, "artifacts", "android");
const bucket = "zgkc-storage";
const keyPrefix = "hgt/apps";
const publicBase = "https://zgkc-storage.kjcxchina.com";

function secret(envName, fileEnvName, defaultFile) {
  const file = process.env[fileEnvName] || (existsSync(defaultFile) ? defaultFile : "");
  if (file) return readFileSync(file, "utf8").trim();
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
const version = readJson(resolve(repoRoot, "apps/app-android/release/version.json"));
const manifestPath = resolve(artifactRoot, version.versionName, "release-manifest.json");
const manifest = readJson(manifestPath);
let apkPath;
if (explicitPathIndex >= 0) {
  apkPath = resolve(repoRoot, process.argv[explicitPathIndex + 1] ?? "");
} else {
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

const versionName = version.versionName;
const fileName = apkPath.split(/[\\/]/).at(-1);
if (manifest.fileName !== fileName || manifest.versionName !== version.versionName || manifest.versionCode !== version.versionCode) {
  fail("The APK does not match the current verified release manifest.");
}
const objectKey = `${keyPrefix}/${versionName}/${fileName}`;
const publicUrl = `${publicBase}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
const verifyPublicApk = async () => {
  const response = await fetch(publicUrl, { cache: "no-store" });
  if (!response.ok) fail(`Published APK verification failed: HTTP ${response.status}`);
  const remoteBody = Buffer.from(await response.arrayBuffer());
  if (remoteBody.byteLength !== manifest.fileSize) fail("Published APK verification failed: file size mismatch");
  const remoteHash = createHash("sha256").update(remoteBody).digest("hex");
  if (remoteHash !== manifest.sha256) fail("Published APK verification failed: SHA-256 mismatch");
};
if (manifest.apkUrl === publicUrl) {
  await verifyPublicApk();
  process.stdout.write(`APK_URL=${publicUrl}\nUPLOAD_STATUS=already-uploaded-and-verified\n`);
  process.exit(0);
}

// Bucket zgkc-storage is fixed in cn-beijing. Keeping these values here avoids
// endpoint discovery during every release and prevents accidentally signing a
// request for another region. Credentials remain external and ignored by Git.
const endpoint = "https://oss-cn-beijing.aliyuncs.com";
const region = "cn-beijing";
const accessKeyId = secret(
  "ALIYUN_OSS_ACCESS_KEY_ID",
  "ALIYUN_OSS_ACCESS_KEY_ID_FILE",
  resolve(repoRoot, ".local", "oss-access-key-id.txt")
);
const accessKeySecret = secret(
  "ALIYUN_OSS_ACCESS_KEY_SECRET",
  "ALIYUN_OSS_ACCESS_KEY_SECRET_FILE",
  resolve(repoRoot, ".local", "oss-access-key-secret.txt")
);
if (!accessKeyId || !accessKeySecret) {
  fail("OSS credentials are incomplete; upload was not attempted.");
}
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

try {
  await client.put(objectKey, createReadStream(apkPath), {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "x-oss-object-acl": "public-read",
      "x-oss-forbid-overwrite": "true"
    }
  });
} catch (error) {
  const safe = error && typeof error === "object" ? error : {};
  if (safe.status === 409 || ["FileAlreadyExists", "ObjectAlreadyExists"].includes(safe.code)) {
    await verifyPublicApk();
  } else {
    fail(`OSS upload failed: status=${safe.status ?? "unknown"} code=${safe.code ?? "unknown"} requestId=${safe.requestId ?? "unknown"}`);
  }
}

writeFileSync(manifestPath, `${JSON.stringify({
  ...manifest,
  apkUrl: publicUrl,
  uploadedAt: new Date().toISOString()
}, null, 2)}\n`, "utf8");
process.stdout.write(`APK_URL=${publicUrl}\n`);
