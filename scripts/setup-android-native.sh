#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_ROOT="$REPO_ROOT/.local"
SDK_ROOT="$LOCAL_ROOT/android-sdk"
NATIVE_PROJECT="$SDK_ROOT/uniappxnativepackage"
CACHE_DIR="$LOCAL_ROOT/cache"
ARCHIVE="$CACHE_DIR/android-uni-app-x-sdk-5.15.zip"
DOWNLOAD_URL='https://web-ext-storage.dcloud.net.cn/uni-app-x/sdk/Android/Android-uni-app-x-SDK%4014915-5.15.zip'
GRADLE_WRAPPER_URL='https://raw.githubusercontent.com/gradle/gradle/v8.14.3/gradle/wrapper/gradle-wrapper.jar'
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}"

fail() {
  printf '错误：%s\n' "$1" >&2
  exit 1
}

[[ -d "$ANDROID_SDK_ROOT" ]] || fail "未找到 Android SDK：$ANDROID_SDK_ROOT"
command -v curl >/dev/null 2>&1 || fail '缺少 curl'
command -v unzip >/dev/null 2>&1 || fail '缺少 unzip'

mkdir -p "$CACHE_DIR" "$LOCAL_ROOT"
if [[ ! -f "$ARCHIVE" ]]; then
  printf '下载 DCloud uni-app x Android SDK 5.15（约 78MB）...\n'
  curl -fL --retry 3 --connect-timeout 20 -o "$ARCHIVE" "$DOWNLOAD_URL"
fi

if [[ ! -x "$NATIVE_PROJECT/gradlew" ]]; then
  STAGING_DIR="$LOCAL_ROOT/android-sdk-staging"
  mkdir -p "$STAGING_DIR"
  unzip -q -o "$ARCHIVE" -d "$STAGING_DIR"
  EXTRACTED_ROOT="$STAGING_DIR/Android-uni-app-x-SDK@14915-5.15"
  [[ -x "$EXTRACTED_ROOT/uniappxnativepackage/gradlew" ]] || fail 'SDK 解压后缺少官方 Gradle 宿主工程'
  mkdir -p "$SDK_ROOT"
  rsync -a "$EXTRACTED_ROOT/" "$SDK_ROOT/"
fi

PRISTINE_SDK_ROOT="$LOCAL_ROOT/android-sdk-staging/Android-uni-app-x-SDK@14915-5.15"
if [[ ! -f "$PRISTINE_SDK_ROOT/uniappxnativepackage/app/build.gradle" ]]; then
  mkdir -p "$LOCAL_ROOT/android-sdk-staging"
  unzip -q -o "$ARCHIVE" -d "$LOCAL_ROOT/android-sdk-staging"
fi

# 每次从官方原始配置开始生成，避免重复执行脚本时机械修改叠加。
cp "$PRISTINE_SDK_ROOT/uniappxnativepackage/app/build.gradle" "$NATIVE_PROJECT/app/build.gradle"
cp "$PRISTINE_SDK_ROOT/uniappxnativepackage/uniappx/build.gradle" "$NATIVE_PROJECT/uniappx/build.gradle"

preserve_sample_source_dir() {
  local source_dir="$1"
  local preserved_dir="$2"

  if [[ -d "$source_dir" && ! -e "$preserved_dir" ]]; then
    mv "$source_dir" "$preserved_dir"
    mkdir -p "$source_dir"
  fi
}

# 官方宿主包内自带演示源码。保留备份，但不让它与当前项目导出的 Kotlin 一起编译。
preserve_sample_source_dir \
  "$NATIVE_PROJECT/app/src/main/java" \
  "$NATIVE_PROJECT/app/src/main/java-sdk-sample"
preserve_sample_source_dir \
  "$NATIVE_PROJECT/uniappx/src/main/java" \
  "$NATIVE_PROJECT/uniappx/src/main/java-sdk-sample"

# DCloud 5.15 SDK 未附带 wrapper jar，但 gradlew 启动必须依赖它。
GRADLE_WRAPPER_JAR="$NATIVE_PROJECT/gradle/wrapper/gradle-wrapper.jar"
if [[ ! -f "$GRADLE_WRAPPER_JAR" ]]; then
  printf '补齐 Gradle 8.14.3 wrapper...\n'
  curl -fL --retry 3 --connect-timeout 20 -o "$GRADLE_WRAPPER_JAR" "$GRADLE_WRAPPER_URL"
fi

cp "$SCRIPT_DIR/android-native/AndroidManifest.xml" "$NATIVE_PROJECT/app/src/main/AndroidManifest.xml"
cp "$SCRIPT_DIR/android-native/strings.xml" "$NATIVE_PROJECT/app/src/main/res/values/strings.xml"
cp "$SCRIPT_DIR/android-native/proguard-rules.pro" "$NATIVE_PROJECT/app/proguard-rules.pro"
cp "$SCRIPT_DIR/android-native/release-signing.gradle" "$NATIVE_PROJECT/hgt-release-signing.gradle"

APP_BUILD="$NATIVE_PROJECT/app/build.gradle"
sed -i.bak \
  -e "s/namespace 'com\.example\.uniappx_native_package'/namespace 'com.caqis.hgt'/" \
  -e 's/applicationId "com\.example\.uniappx_native_package"/applicationId "com.caqis.hgt"/' \
  -e 's/versionName "1\.0"/versionName "0.1.0"/' \
  "$APP_BUILD"
if ! grep -q 'manifestPlaceholders' "$APP_BUILD"; then
  sed -i.bak '/defaultConfig {/a\
        manifestPlaceholders = [WX_APPID: "unused", PUSH_APPID: "unused", GETUI_APPID: "unused", GY_APP_ID: "unused"]' \
    "$APP_BUILD"
fi

# LeakCanary 是官方示例的内存泄漏调试器，会额外生成名为 “Leaks” 的桌面图标。
# 本项目本地安装包不携带该调试器，确保桌面只有一个业务 App 入口。
for module_build in \
  "$NATIVE_PROJECT/app/build.gradle" \
  "$NATIVE_PROJECT/uniappx/build.gradle"; do
  sed -i.bak '/com\.squareup\.leakcanary:leakcanary-android/d' "$module_build"
  for sample_module in \
    native-button native-time-picker test-invoke-network-api uni-getbatteryinfo \
    uni-openLocation uni-stat uni-usercapturescreen uts-button uts-get-native-view \
    uts-openSchema uts-progressNotification uts-worker; do
    sed -i.bak "/implementation project(':$sample_module')/d" "$module_build"
  done
done

for module_build in "$APP_BUILD" "$NATIVE_PROJECT/uniappx/build.gradle"; do
  for unused_dependency in \
    'com.huawei.hms:ads-lite' 'com.tencent.map:' 'com.tencent.map.geolocation:' \
    'com.getui:' 'androidx.camera:' 'com.google.android.exoplayer:' \
    'com.alipay.sdk:' 'com.tencent.mm.opensdk:' 'com.google.mlkit:' \
    'com.qiniu:' 'com.amap.api:' 'androidx.media3:' 'com.google.net.cronet:' \
    'org.chromium.net:'; do
    sed -i.bak "/${unused_dependency//./\\.}/d" "$module_build"
  done
done

# 被裁掉的分享、文档和扫码模块原本注册了启动 Hook；同步清空，避免启动时反射缺类。
HOOKS_TMP="$APP_BUILD.hooks.tmp"
awk '
  /buildConfigField '\''String\[\]'\'', '\''UTSHooksClassArray'\''/ {
    print "        buildConfigField '\''String[]'\'', '\''UTSHooksClassArray'\'', '\''{}'\''"
    skipping = 1
    next
  }
  skipping && /buildConfigField '\''String'\'', '\''UTSEasyCom'\''/ { skipping = 0 }
  !skipping { print }
' "$APP_BUILD" > "$HOOKS_TMP"
mv "$HOOKS_TMP" "$APP_BUILD"

# 官方示例默认导入 SDK/libs 下全部 AAR/JAR，会把广告、地图、人脸、推送等未使用 SDK 一并打包。
# 保留运行时核心和本项目实际调用的 uni API；uniappx 模块仍以 compileOnly 全量库完成源码编译。
CORE_SDK_LIBS="['app-common-release.aar', 'app-runtime-release.aar', 'breakpad-build-release.aar', 'dcloud-layout-release.aar', 'framework-release.aar', 'nativeobj-preview-release.aar', 'uts-runtime-release.aar', 'uni-actionSheet-release.aar', 'uni-arrayBufferToBase64-release.aar', 'uni-base64ToArrayBuffer-release.aar', 'uni-canvas-component-release.aar', 'uni-canvas-release.aar', 'uni-chooseMedia-release.aar', 'uni-fileSystemManager-release.aar', 'uni-getAppBaseInfo-release.aar', 'uni-getDeviceInfo-release.aar', 'uni-getNetworkType-release.aar', 'uni-getSystemInfo-release.aar', 'uni-getSystemSetting-release.aar', 'uni-installApk-release.aar', 'uni-keyboard-release.aar', 'uni-loading-release.aar', 'uni-media-release.aar', 'uni-memory-release.aar', 'uni-modal-release.aar', 'uni-network-release.aar', 'uni-previewImage-release.aar', 'uni-prompt-release.aar', 'uni-rpx2px-release.aar', 'uni-showLoading-release.aar', 'uni-storage-release.aar', 'uni-theme-release.aar', 'uni-websocket-release.aar']"
sed -i.bak \
  "s/include: \['\*\.aar', '\*\.jar'\]/include: $CORE_SDK_LIBS/" \
  "$APP_BUILD"

if ! grep -q 'hgtAbi' "$APP_BUILD"; then
  sed -i.bak '/defaultConfig {/a\
        def hgtAbi = project.findProperty("hgtAbi") ?: "arm64-v8a"\
        ndk { abiFilters.addAll(hgtAbi.split(",")) }' "$APP_BUILD"
fi

# uni-app x 页面类通过反射注册。DCloud 5.15 离线宿主没有完整的 R8 keep
# 清单，开启压缩会导致正式包 Activity 正常但页面白屏，因此保持关闭。

printf '\napply from: "$rootDir/hgt-release-signing.gradle"\n' >> "$APP_BUILD"

printf 'sdk.dir=%s\n' "$ANDROID_SDK_ROOT" > "$NATIVE_PROJECT/local.properties"
chmod +x "$NATIVE_PROJECT/gradlew"
printf 'Android 原生宿主工程准备完成：%s\n' "$NATIVE_PROJECT"
