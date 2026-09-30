# AI 玩汤关键点纠正全量部署与 p0.54 APP 更新

## 发布结果

Web/Server 和 Android APP 已于 2026-09-30 完成全量部署。本次发布使用重新授权；授权已消耗。发布提交为 `a01f9f9ef1616377caf0b750751916006a480bbc`，聊天兜底过滤改动先提交为 `c3ec2c4`，所有源码均留在本地，没有推送 GitHub。

候选同时合入 `origin/main` 上缺失的三个提交，保留 AI 快速回答、短信投递和生产 OSS 凭据刷新修复。构建后的服务端保留语音功能退役状态。

## 检查与生产部署

- `npm run check`、服务端 375 项测试及其他测试、`npm run build:all`、Android 页面启动/权限回归通过。
- Android Release APK 使用既有签名，包名 `com.caqis.hgt`，版本 `1.0.0-p0.54`（100054）。验签、权限检查、包内页面启动检查通过；未连接真机。
- 本地生产镜像 `hgt:a01f9f9`，归档 SHA256：`282f816393c23bb1ec85e5eea73cfd32f62e8d58f6da21edd90b7e964be77d48`。281 个公共资源路径和内容校验通过。
- 生产容器：`4871ca909ac2e4107db7900f90046532814b67138cddec3e9b907eafd5175b42`。
- JWT 哈希、Cookie、既有挂载与预期运行环境保持不变；生产认证预检、健康和 CORS 验证通过。

Android p0.54 已发布非强制更新，记录 ID 为 `ACjOrYegOWfpJeAR6UEk_`。APK SHA256：`545575974b8002feb0a68daf38d45d1b047ababa132c89e0c8e6a9d271103c50`。原有 51 条更新记录未变；100053 可非强制更新到 p0.54，100054 不会重复提示。APK 下载地址：

`https://zgkc-storage.kjcxchina.com/hgt/apps/1.0.0-p0.54/hgt-android-1.0.0-p0.54%2B100054-a01f9f9-release.apk`

## 线上关键点批量重拆

此前对线上真实作品进行的人工盲审检查了两个代表样本，发现旧拆分会把身份总结和同一因果关系重复列为关键点。发布后按 v4 逻辑对自动配置作品批量重拆，数量由线上只读聚合查询确认：

- AI 主持作品：107 件。
- 手动配置：12 件；跳过且保持不变。
- 自动配置：95 件；93 件已通过生成和质量审核，写入 v4。
- 剩余 2 件未通过多次质量审核，服务端保留原关键点和失败状态，每小时自动重试。

最后一次只读计数为 `eligible=107, manual=12, automatic=95, pending=2, generation_issues=2`。审核未通过的候选没有写入，也没有覆盖原数据。

对最后两件发起额外即时模型重试时，自动审批以重复生产写入和模型调用缺乏新的用户授权或新依据为由拒绝继续。没有尝试绕过该拒绝。若要立即执行额外的人工处理或重试，需要新的明确授权；线上服务现有每小时自动重试保持运行。

## 最终线上验证

- `https://hgt.caqis.com/api/health` 返回 200。
- 请求 versionCode 100053 返回 p0.54、`updateAvailable=true`、`forceUpdate=false`。
- 请求 versionCode 100054 返回 `updateAvailable=false`。
- 未推送 GitHub。
