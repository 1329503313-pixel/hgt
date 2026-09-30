import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");
const requireMatch = (value, pattern, message) => {
  if (!pattern.test(value)) throw new Error(message);
};
const forbidMatch = (value, pattern, message) => {
  if (pattern.test(value)) throw new Error(message);
};

const packageJson = JSON.parse(read("package.json"));
if (packageJson.scripts?.["release:full"] !== "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release/full-deploy.ps1") {
  throw new Error("package.json must expose the canonical release:full entry point.");
}

const fullDeploy = read("scripts/release/full-deploy.ps1");
for (const requiredStep of [
  "npm run check",
  "npm test",
  "npm run build:all",
  "npm run release:android:prepare",
  "npm run test:application-startup",
  "npm run app:android:upload -- --confirm-upload",
  "deploy-production.ps1",
  "publish-android-release.ps1"
]) {
  if (!fullDeploy.includes(requiredStep)) throw new Error(`release:full is missing required step: ${requiredStep}`);
}
requireMatch(fullDeploy, /ConfirmFullDeployment/, "release:full must require explicit full-deployment confirmation.");

const uploader = read("scripts/android/upload-apk-to-oss.mjs");
requireMatch(uploader, /manifest\.gitCommit !== currentCommit/, "APK upload must bind the artifact manifest to the current Git commit.");
requireMatch(uploader, /completely clean Git worktree/, "APK upload must reject a dirty Git worktree.");
requireMatch(uploader, /localHash !== manifest\.sha256/, "APK upload must verify the local artifact hash against its manifest.");

const deployWrapper = read("scripts/release/deploy-production.ps1");
const productionDeploy = read("scripts/release/production-deploy.sh");
const dockerfile = read("Dockerfile");
const productionBundle = read("scripts/release/create-production-bundle.ps1");
const imageBuilder = read("scripts/release/build-production-image.ps1");
requireMatch(productionBundle, /git -c core\.autocrlf=false @archiveArgs/, "Production archives must preserve committed asset bytes across platforms.");
requireMatch(imageBuilder, /tar --options hdrcharset=UTF-8 -xzf/, "Windows image builds must extract Git filenames as UTF-8.");
requireMatch(imageBuilder, /Guid\]::NewGuid/, "Image builds must use a fresh context on every attempt.");
requireMatch(imageBuilder, /node \$assetChecker verify/, "Extracted public assets must match the release commit.");
requireMatch(imageBuilder, /--entrypoint node \$imageTag \/tmp\/check-assets.mjs verify/, "Final images must verify public asset paths and contents before export.");
for (const path of ["packages/shared/package.json", "packages/shared/tsconfig.json", "packages/shared/src"]) {
  if (!productionBundle.includes(`'${path}'`)) throw new Error(`Production bundle must include shared workspace input: ${path}`);
  if (dockerfile.split(`COPY ${path} `).length !== 3) throw new Error(`Both Docker builders must copy shared workspace input: ${path}`);
}
requireMatch(dockerfile, /COPY --from=server-builder \/app\/packages\/shared\/dist \.\/packages\/shared\/dist/, "Production runtime must preserve the shared workspace symlink target.");
requireMatch(deployWrapper, /production-preflight\.sh/, "Production deployment must run the versioned authentication preflight.");
forbidMatch(deployWrapper, /\$\([^\r\n]*docker inspect/, "Do not embed remote Bash command substitutions in the PowerShell deployment wrapper.");
const persistedOssKeys = [
  "ALIYUN_OSS_ENDPOINT",
  "ALIYUN_OSS_REGION",
  "ALIYUN_OSS_BUCKET",
  "ALIYUN_OSS_KEY_PREFIX",
  "ALIYUN_OSS_ACCESS_KEY_ID",
  "ALIYUN_OSS_ACCESS_KEY_SECRET"
];
requireMatch(productionDeploy, new RegExp(`oss_keys='${persistedOssKeys.join(" ")}'`), "Production deployment must keep the complete persisted OSS key allowlist.");
requireMatch(productionDeploy, /grep "\^\$\{key\}=" \/opt\/hgt\/\.env >> "\$runtime_env"/, "Production deployment must import only allowlisted OSS values from the persisted environment.");
requireMatch(productionDeploy, /test -f \/opt\/hgt\/\.env/, "Production deployment must require the persisted environment file before importing OSS configuration.");

for (const path of [
  "scripts/android/build-android.ps1",
  "scripts/android/verify-android-artifact.ps1",
  "scripts/release/prepare-android-release.ps1"
]) {
  forbidMatch(read(path), /Get-FileHash/, `${path} must use the stable .NET SHA-256 helper instead of Get-FileHash.`);
}

for (const path of ["scripts/release/production-preflight.sh", "scripts/release/production-deploy.sh"]) {
  forbidMatch(read(path), /\r\n/, `${path} must use LF line endings for remote execution.`);
}

process.stdout.write("Release tooling contract passed\n");
