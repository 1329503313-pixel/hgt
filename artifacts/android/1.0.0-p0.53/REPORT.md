# Android p0.53 发布记录

2026-09-29，按用户明确授权的“仅更新 APP，作为全量部署规则的一次性例外”，完成 Android 1.0.0-p0.53（100053）非强制更新发布。

- 发布源码：`1656a972cebac29c1e0a8324364080ff6145559d`。
- APP 更新内容：卡牌特质展示与筛选、收藏柜详情动画和媒体加载优化；卡包类型修改及后台特质新增档位沿用配置已由此前 Web/Server 发布提供。
- APK：`hgt-android-1.0.0-p0.53+100053-1656a97-release.apk`。
- APK SHA256：`f72c8653927435c33b417d16b479407a04295adfe041da8d1ebf8b030db99523`。
- 下载：https://zgkc-storage.kjcxchina.com/hgt/apps/1.0.0-p0.53/hgt-android-1.0.0-p0.53%2B100053-1656a97-release.apk
- 发布记录：`rQi763pSBl3wd8F_7LQS9`。
- `minSupportedVersionCode=0`、`forceUpdate=false`；保留原有 50 条更新记录，总计 51 条。
- 100052 客户端有更新提示，100053 客户端无重复更新提示。
- Release 构建、签名证书、包名和版本、权限元数据、公网下载大小与 SHA256、发布记录与更新接口核验通过。
- 按用户要求未运行测试套件、原生单元测试、完整检查或浏览器回归；未连接 Android 真机。使用 `.local/p053-app-release/` 中的临时构建与上传脚本跳过这些检查，正式发布工具源码未修改。
- 未重新部署或重启 Web/Server，容器 ID、镜像和启动时间发布前后相同；未改变生产 JWT/Cookie、环境或挂载。未推送 GitHub。
- 日志：`.local/p053-app-release/build.log`、`upload.log`、`publish.log`。

本次 APP 发布例外授权已完成并失效。
