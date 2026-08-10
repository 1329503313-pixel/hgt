# HGT Android

Android 客户端采用 Capacitor 封装 `apps/web` 的用户端手机构建。APK 内不包含 Web 管理后台，也不加载线上网页作为入口。

## 固定身份

- Application ID：`com.caqis.hgt`
- App 本地来源：`https://app.caqis.com`
- 正式 API：`https://hgt.caqis.com`
- 分发方式：OSS HTTPS APK 直链

使用全新签名证书后，旧签名 APK 不能被覆盖升级。首次安装本重建版本前需要卸载旧版；本版本后续必须永久沿用同一签名证书。

## 本地命令

```powershell
npm run app:android:setup-jdk
npm run app:android:setup-sdk
npm run app:android:web
npm run app:android:sync
npm run app:android:brand
npm run app:android:check
npm run app:android:test:native
npm run app:android:debug
npm run app:android:release
npm run app:android:verify
npm run app:android:smoke
```

首次生成正式签名材料：

```powershell
npm run app:android:create-signing
```

必须离线备份 `.local/android-signing/hgt-release.keystore` 与 `.local/android-signing/signing.properties`。仓库只保存证书 SHA-256 指纹，不保存私钥或密码。

正式构建需要显式指定外部签名配置：

```powershell
$env:HGT_ANDROID_SIGNING_PROPERTIES = ".local/android-signing/signing.properties"
npm run app:android:release
npm run app:android:verify
```

所有生成产物写入 `artifacts/android/<versionName>/`，包括 APK、`release-manifest.json` 和 `SHA256SUMS.txt`。Android SDK、JDK、Gradle 缓存、签名文件、密码和 APK 均不得进入 Git。

## Android 平台层

- 系统返回键先关闭最上层 Web 弹窗，再回退路由；首页根节点才退出 APP。
- 前后台切换会通知 Web 用户端恢复实时连接与可见状态。
- 海龟汤海报和玩汤邀请图走 Android 原生分享面板，临时文件只写 APP Cache。
- `target=_blank` 的 HTTPS 外链由 Android 浏览器能力打开。
- `https://hgt.caqis.com` 用户端深链可恢复到 APP 内同一路由；自动验证唤起需单独审批线上 `assetlinks.json`，当前仅提供 Android 系统选择入口。
- APP 使用版本接口检查普通/强制更新；APK 只允许从 `https://zgkc-storage.kjcxchina.com/hgt/apps/` 下载，并交给 Android 系统安装页确认。
- FileProvider 仅暴露 APP Cache 与 APP 私有 Download 目录；不申请相机、麦克风、定位或全盘存储权限。

## 自动化门禁

`app:android:release` 已内置品牌资源生成与哈希校验、源码契约、Android 专用 Web 产物扫描、原生单测和签名构建。独立命令的职责：

- `app:android:check`：应用身份、权限、固定竖屏、更新域名白名单、Web/App 共用 `UserApp`、插件和品牌哈希。
- `app:android:check:dist`：阻止管理后台、后台 API、桌面导航图进入 Android 包。
- `app:android:test:native`：验证原生代码编译和 APK URL 安全策略。
- `app:android:verify`：验证正式包 applicationId、版本、证书、SHA256 和敏感权限。
- `app:android:smoke`：需要且只接受一台 online 真机/模拟器，执行安装、冷启动、前台 Activity 与崩溃日志检查。

当前本地候选版本为 `1.0.0-p0.2 (100002)`；它仍需 Android 真机主链路验收后才能进入 OSS 上传审批。

## 版本控制

- `release/version.json` 是 Android 版本单一真源；每次对外版本同时递增 `versionCode`，并按语义版本更新 `versionName`。
- 功能分支使用 `codex/android-*`；P0、功能冻结、RC、正式候选分别提交，禁止把密钥、缓存或 APK 提交进仓库。
- 推荐标签：`android-v<versionName>`。只有对应提交通过类型检查、服务端测试、Android Release 构建、验签和真机矩阵后才能打标签。
- 旧签名版本与本重建版本不能覆盖安装；从本版本开始，所有升级包必须保持 `applicationId=com.caqis.hgt`、更大的 `versionCode` 和同一证书指纹。

## OSS 分发

OSS 对象使用不可变版本路径：

```text
hgt/apps/<versionName>/<apk-file-name>
```

最终下载地址位于 `https://zgkc-storage.kjcxchina.com/hgt/apps/` 下。上传脚本只接受 `artifacts/android` 内通过验签的 `*-release.apk`，禁止覆盖同名对象：

```powershell
npm run app:android:verify
npm run app:android:upload
```

上传属于显式发布动作，只能在用户明确授权某个已验收版本后执行。上传脚本不会写正式数据库、不会启用更新记录；应用内更新版本记录需走独立审批流程。
