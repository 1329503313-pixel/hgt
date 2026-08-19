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
requireMatch(deployWrapper, /production-preflight\.sh/, "Production deployment must run the versioned authentication preflight.");
forbidMatch(deployWrapper, /\$\([^\r\n]*docker inspect/, "Do not embed remote Bash command substitutions in the PowerShell deployment wrapper.");

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
