import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const requireDist = process.argv.includes("--dist");
const failures = [];
const pathOf = (path) => resolve(repoRoot, path);
const read = (path) => readFile(pathOf(path), "utf8");
const expect = (condition, message) => { if (!condition) failures.push(message); };

async function sha256(path) {
  return createHash("sha256").update(await readFile(pathOf(path))).digest("hex");
}

const [manifest, config, launchTheme, launchSplash, mainActivity, plugin, policy, wechatSharePlugin, paths, userApp, webApp, androidApp, version, packageJson, brandManifest] = await Promise.all([
  read("apps/app-android/android/app/src/main/AndroidManifest.xml"),
  read("apps/app-android/capacitor.config.ts"),
  read("apps/app-android/android/app/src/main/res/values/styles.xml"),
  read("apps/app-android/android/app/src/main/res/layout/launch_splash.xml"),
  read("apps/app-android/android/app/src/main/java/com/caqis/hgt/MainActivity.java"),
  read("apps/app-android/android/app/src/main/java/com/caqis/hgt/AndroidUpdatePlugin.java"),
  read("apps/app-android/android/app/src/main/java/com/caqis/hgt/AndroidUpdatePolicy.java"),
  read("apps/app-android/android/app/src/main/java/com/caqis/hgt/WechatSharePlugin.java"),
  read("apps/app-android/android/app/src/main/res/xml/file_paths.xml"),
  read("apps/web/src/UserApp.tsx"),
  read("apps/web/src/App.tsx"),
  read("apps/web/src/AndroidApp.tsx"),
  read("apps/app-android/release/version.json").then(JSON.parse),
  read("apps/app-android/package.json").then(JSON.parse),
  read("apps/app-android/release/brand-assets.json").then(JSON.parse)
]);

expect(manifest.includes('android:allowBackup="false"'), "Android backup must stay disabled.");
expect(manifest.includes('android:screenOrientation="portrait"'), "Android must remain portrait-only.");
expect(manifest.includes('android.permission.INTERNET'), "INTERNET permission is required.");
expect(manifest.includes('android.permission.REQUEST_INSTALL_PACKAGES'), "APK update install permission is required.");
expect(manifest.includes('android:scheme="https" android:host="hgt.caqis.com"'), "Official HTTPS app-link entry is missing.");
for (const permission of ["CAMERA", "RECORD_AUDIO", "ACCESS_FINE_LOCATION", "READ_CONTACTS", "MANAGE_EXTERNAL_STORAGE"]) {
  expect(!manifest.includes(`android.permission.${permission}`), `Unexpected sensitive permission: ${permission}.`);
}
expect(paths.includes('<cache-path name="shared_cache" path="."'), "Only app cache may be exposed for native sharing.");
expect(paths.includes('<external-files-path name="app_downloads" path="Download/"'), "APK installs must use app-scoped downloads.");
expect(!paths.includes("<external-path"), "Broad external-path FileProvider access is forbidden.");
expect(config.includes('appId: "com.caqis.hgt"'), "Capacitor appId changed.");
expect(!config.includes("server: { url:"), "Release shell must never load a remote web entry URL.");
expect(config.includes("cleartext: localProfile"), "Cleartext traffic must be local-profile-only.");
expect(config.includes('androidScaleType: "CENTER_CROP"'), "Android splash image must preserve its aspect ratio with CENTER_CROP.");
expect(config.includes('layoutName: "launch_splash"'), "Android splash must use the aspect-ratio-safe launch layout.");
expect(launchTheme.includes('<item name="android:background">@color/brand_splash_background</item>'), "Launch window background must not stretch the splash bitmap.");
expect(launchSplash.includes('android:scaleType="centerCrop"'), "Launch splash layout must preserve the bitmap aspect ratio.");
expect(mainActivity.includes("registerPlugin(AndroidUpdatePlugin.class)"), "Android update plugin is not registered.");
expect(mainActivity.includes("registerPlugin(WechatSharePlugin.class)"), "WeChat share plugin is not registered.");
expect(manifest.includes('<package android:name="com.tencent.mm"'), "WeChat package visibility declaration is missing.");
expect(wechatSharePlugin.includes('setPackage(WECHAT_PACKAGE)'), "WeChat image sharing must target the WeChat package.");
expect(wechatSharePlugin.includes("getCacheDir().getCanonicalFile()"), "WeChat sharing must only expose files from app cache.");
expect(plugin.includes("AndroidUpdatePolicy.requireAllowedApkUrl"), "Update plugin must validate APK URLs.");
expect(policy.includes('ALLOWED_HOST = "zgkc-storage.kjcxchina.com"'), "Official OSS host allowlist changed.");
expect(policy.includes('ALLOWED_PATH_PREFIX = "/hgt/apps/"'), "Official OSS path allowlist changed.");
expect(!userApp.includes("AdminPage"), "UserApp must not depend on the admin app.");
expect(webApp.includes('import UserApp from "./UserApp"'), "Web user routes must use shared UserApp.");
expect(androidApp.includes('import UserApp from "./UserApp"'), "Android routes must use shared UserApp.");
expect(androidApp.includes("<GlobalToast />"), "Android app must render global feedback messages.");
expect(packageJson.version === version.versionName, "Android package version and release versionName differ.");
for (const name of ["@capacitor/app", "@capacitor/share", "@capacitor/filesystem", "@capacitor/browser", "@capacitor/splash-screen"]) {
  expect(Boolean(packageJson.dependencies[name]), `Missing official plugin dependency: ${name}.`);
}

for (const [path, expectedHash] of Object.entries({ ...brandManifest.sources, ...brandManifest.outputs })) {
  try {
    expect(await sha256(path) === expectedHash, `Brand asset drift detected: ${path}. Run npm run app:android:brand.`);
  } catch {
    failures.push(`Brand asset missing: ${path}.`);
  }
}

if (requireDist) {
  const walk = async (directory) => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(async (entry) => {
    const full = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(full) : full;
  }))).flat();
  try {
    const files = await walk(pathOf("apps/web/dist-android"));
    expect(files.length > 0, "Android web output is empty.");
    expect(!files.some((path) => /desktop-navigation-banner|AdminPage|Management/i.test(path)), "Android output contains desktop/admin assets.");
    const textFiles = files.filter((path) => /\.(?:js|css|html)$/.test(path));
    const combined = (await Promise.all(textFiles.map((path) => readFile(path, "utf8")))).join("\n");
    expect(!combined.includes("/api/admin/"), "Android output contains admin API code.");
    expect(!combined.includes("desktop-navigation-banner.webp"), "Android output contains desktop-only banner code.");
  } catch (error) {
    failures.push(`Android dist check failed: ${error instanceof Error ? error.message : error}`);
  }
}

if (failures.length) {
  console.error(`Android contract gate failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Android contract gate passed${requireDist ? " (source + dist)" : " (source)"}.`);
