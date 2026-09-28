# AGENTS.md

### 2026-09-28 p0.52 全量部署与 APP 更新一次性授权

- 状态：已完成并失效。用户明确要求“全量部署并更新 APP”，并要求审计此前改动范围、提交所有未提交改动。发布前审计 118 个文件（92 个已跟踪文件修改、17 个新增文件及版本/发布说明调整），一并纳入本地发布提交；未推送 GitHub。
- 发布提交 `61a9a3e8135da893352843a4bea21d97b40b2a48`，提交说明 `release: ship complete web and Android p0.52 updates`。范围包含卡牌特质/羁绊、普通战斗/BOSS/闯关/打榜、抽卡与十连记录、手机号验证、收藏品和相关修复等此前全部工作区改动。
- 全量门禁、类型与契约检查、服务端测试、Web/Server 构建、安卓启动浏览器检查、账号迁移/十连记录/BOSS MySQL 回归、卡牌战斗浏览器回归，以及 Android 原生测试、Release APK 构建和验签均通过。服务端 359 项、卡牌战斗 223 项测试通过。
- Web/Server 已全量部署：镜像 `hgt:61a9a3e`，镜像归档 SHA256 `e6d5063d2c303baa8d407e0226333d2224698f97a002809896d7e8a465ee7096`；运行容器 `6726a0baf448d0244b9e8c2a03a4438b85a3f4f666ad61d95dda50c1fdb851d6`，旧容器保留为 `hgt-app-rollback-61a9a3e`。生产 JWT/Cookie 与既有挂载经发布门禁核对不变，健康和 APP 凭据 CORS 正常。
- Android `1.0.0-p0.52`（100052）已发布非强制更新，记录 ID `nSuT4SScnW2mnsvE0_UzB`，APK SHA256 `5be25b43b096a60601bc292cfad584f92892c55e17e08f78a3a092c553236438`；OSS 上传及公网下载校验通过。历史 49 条更新记录保持不变，`minSupportedVersionCode=0`，`forceUpdate=false`。
- 双域名健康和 APP 更新接口均返回 200；100051 客户端可更新到 p0.52，100052 客户端无重复更新提示。两域名实际提供 p0.52 主入口、后台特质包（含特质 UI 文案），后台包请求返回 200；269 项公共静态资源在发布包中核验。完整报告 `artifacts/p052-release/REPORT.md`。未连接 Android 真机；未推送 GitHub。

### 2026-09-23 商城十连记录 Web/Server 全量部署一次性授权（不更新 APP）

- 状态：已完成并失效。用户明确要求“全量部署web server”。从已上线手机号绑定版本建立独立快照，仅发布商城记录页的全部记录/十连记录切换、十连订单汇总和八种排序；主工作区其他改动未纳入。
- 发布提交 `d7d7bece230e9c9ba4ae6d688aeacab11bb907fd`，镜像 `hgt:d7d7bec`，生产容器 `a4acdb97cf98cfd82694769ee1717e27036c5775c6887e30b772ad2402e4acf5`；原容器保留为 `hgt-app-rollback-d7d7bec`。镜像归档 SHA256 `dd7bc35403d63743943ab39b83be22d9d83ab3db662e04a32499c851ac7e4f97`。
- 独立快照的 MySQL 回归、完整检查及 Web/Server 构建通过；JWT、Cookie、既有环境与挂载未变。双域名健康与管理后台脚本哈希一致，新增接口保持管理员认证保护。
- 未更新 APP，p0.51 更新规则保持不变；未推送 GitHub。报告 `artifacts/ten-draw-release-20260923/REPORT.md`，日志 `.local/release-ten-draw-20260923/.local/ten-draw-deploy.log`。本次授权不得沿用。

### 2026-09-23 手机号绑定提示 Web/Server 部署一次性授权（不更新 APP）

- 状态：已完成并失效。用户明确要求“部署web server，不更新APP，不做检查”。仅部署未绑手机号弹框、“稍后”及设置页绑定入口、原始账号可先进入和已登录绑定服务端路径；以已上线 p0.51 提交 `a797b2b72de0f8e40d43a36143244ff8f6632daf` 建立独立发布快照，其他工作区改动未纳入。
- 发布源码 `46cc87fd1d7a40d01da3ec1fe3f4a2a88668e2bd`，生产镜像 `hgt:46cc87f`，容器 `52e80e54bbe8222b50b5864ba48f2d429c39cc92865c00760a4e5cfc9e781927`；原容器保留为 `hgt-app-rollback-46cc87f`。镜像归档 SHA256 `e4453f23b2f9003489ce2b9ad47a7fda5ccc79848f83fcc363fba566c5475f65`。
- 按要求未重跑业务测试或完整检查；完成生产镜像构建，执行发布脚本自带的认证、产物、环境和服务启动保护。JWT 哈希、Cookie 配置及既有挂载保持不变，公网健康与 APP 凭据 CORS 正常。
- 未构建、上传或发布新 APK，未修改 APP 更新记录。现有 p0.51 APP 仍使用包内旧页面，不含本次弹框；服务端允许未绑定历史用户先登录，因此旧 APP 不会显示本次绑定提醒。未推送 GitHub。发布记录 `artifacts/phone-binding-release-20260923/REPORT.md`。

### 2026-09-23 p0.51 Web/Server 全量部署与 APP 强制更新一次性授权

- 状态：已完成并失效。用户明确要求“全量部署web server 更新APP并强制更新，隐藏本次更新APP的跳过按钮”；未推送 GitHub。
- 发布提交 `a797b2b72de0f8e40d43a36143244ff8f6632daf`，镜像 `hgt:a797b2b`，容器 `90bb31bf147fe44e345f20a1245392c158c04c2ea0f55d38a96f5f924787d789`；回滚容器 `hgt-app-rollback-a797b2b` 保留。Android p0.51（100051）已发布强制更新，旧版清单 `forceUpdate=true`，APK SHA256 `4da637f4011476e224f77bb556e1ee79c588cc2d0934425bd11bfab2799e0776`。
- 生产 `hgt` 库完整备份 SHA256 `34f26a54d8ba0d06070db8452a30d7d9ef5f3459633d19169ceb9d2896159675`，包含 157 张表；迁移前后 352 名用户、2 名超级管理员和 12 条身份绑定摘要完全一致。16 个旧卡包返还保持 `0/1/2/5`。短信本地和正式 API 投递均由用户确认收到；JWT/Cookie/既有环境和挂载不变，双域名资源、服务健康和 APP CORS 通过。
- 检查、完整测试、Web/Server 构建、MySQL 回归、Android 原生构建与测试、APK 验签及包内启动通过；未连接真机。报告 `artifacts/p051-release/REPORT.md`。本次授权不得沿用。

### 2026-09-22 p0.50 全量部署与 APP 更新一次性授权

- 状态：已于 2026-09-22 完成 Web/Server 全量部署及 APP p0.50 更新发布，本次授权已使用并失效。用户明确要求“全量部署并更新 APP，不重复检查”。
- 以已发布 BOSS 回合衰减提交 34634b7f01985b0d9889bc9e584a09f15f5d6269 及发布记录 09c9ed7897ba511d19b8a005201d849b2674fe1a 为基线，完整部署 Web/Server，并发布 Android 1.0.0-p0.50（100050）非强制更新。APP 包含已上线收藏品多效果、抽卡优化、BOSS 玩家房间、单次暴击额外 50 个百分点命中和 BOSS 每回合初始属性累计降低 0.5%；短信导入保留本地。
- 按用户要求复用已通过的业务检查和测试，不重复运行完整检查、业务测试或原生单元测试；执行构建、一次最终 APK 签名及包内启动核验、产物哈希、生产认证保护和必要发布核验。生产镜像本地构建。
- 原样继承生产 JWT 并以 -e JWT_SECRET 显式注入；Cookie、既有环境、挂载和 Nginx 保持不变，保留回滚容器；历史 APK 和更新记录保持不变，p0.44 继续停用。不修改 apps/app，不推送 GitHub。
- 完成、失败或中止后本次授权失效，记录最终结果。
- 发布提交 `a82094116f4df247896e9ce2fde763690eb60361`，镜像 `hgt:a820941`，容器 `7a0453a48ea34e9c0db41ccbc9be9c8eec656797f5de1dcd18981db99afc6d11`；镜像归档 SHA256 `1dc7c2938eee6512ab11b8d520f7be8ee97522116f1380c018a0d3f6b6a0720e`。回滚容器 `hgt-app-rollback-a820941` 保留。
- Android p0.50（100050）已发布非强制更新，APK SHA256 `f18340827c3b9c3b897d82bc4654c073c066fb226b66bbb4a972f33c77544f6c`，公网回下载一致。原有 47 条更新记录哈希未变，p0.44 继续停用；p0.49 提示非强制升级，p0.50 不重复提示。
- JWT 哈希、Cookie、环境、挂载和 Nginx 保持一致；双域名入口 JS/CSS 及 5 个服务端/共享文件与本地镜像哈希一致，健康及 APP 凭据 CORS 正常。
- 按要求未重复运行完整检查、业务测试或 Android 单元测试。Android/Web/Server 构建、新 APK 签名及包内启动核验、产物和更新接口核验通过；未连接 Android 真机。报告 `artifacts/p050-release/REPORT.md`，日志 `.local/release-p050/.local/`；未推送 GitHub。



### 2026-09-22 BOSS 回合衰减 Web/Server 全量部署一次性授权（不更新 APP）

- 状态：已于 2026-09-22 完成 BOSS 回合衰减 Web/Server 全量部署和最终验收，本次授权已使用并失效。用户明确要求“全量部署web server”。
- 以已发布暴击临时命中版本 bb20a41976cc464a1a4d1ae2c4dcb485d41b0640 及发布记录 f0ee123455143d03e6d50a1e0e3f63ac7158c26d 为基线，仅纳入 BOSS 战和卡牌闯关敌方每过完整回合按初始值累计降低 0.5% 攻击、防御、速度、技能伤害及技能治疗量、回合提示与对应测试；换队、复活和净化不重置，玩家属性不受影响。保留已上线暴击命中规则及其他功能，短信导入保留本地。
- 复用本次已通过的 215 项战斗测试、服务端类型检查及构建；独立快照在本地完整构建 Web/Server 生产镜像，核对实际发布范围、生产认证不变量、产物和服务健康。
- 原样继承生产 JWT 并用 -e JWT_SECRET 显式注入；Cookie、全部既有环境、挂载和 Nginx 保持不变，保留回滚容器。不构建、上传或更新 APP，不修改 APP 更新记录，不推送 GitHub。
- 本次 BOSS 回合衰减授权在完成、失败或中止后失效，并记录结果。
- 发布提交 `34634b7f01985b0d9889bc9e584a09f15f5d6269`，镜像 `hgt:34634b7`，容器 `9613161ce07d390254fef5ac8a0e527f152c9413420416c755bdc9731d934240`；镜像归档 SHA256 `04f2814987a74733888b34a3064c0e012bdaccef7298313b81377c3716d1bf65`。原容器保留为 `hgt-app-rollback-34634b7`。
- JWT 哈希、Cookie、全部环境和挂载、Nginx 配置前后一致；双域名入口 JS/CSS 及 5 个服务端/共享文件与本地镜像哈希一致，健康和 APP 凭据 CORS 通过，BOSS 回合衰减及原有暴击命中规则均在实际发布代码中。
- APP 仍为 p0.49，全部 47 条更新记录哈希未变，p0.44 继续停用；未构建、上传或发布 APP。复用本次已通过的 215 项战斗测试及服务端类型检查和构建，独立快照本地完整构建 Web/Server 生产镜像成功。
- 发布报告 `artifacts/boss-decay-release-20260922/REPORT.md`，日志 `.local/release-boss-decay-20260922/.local/deploy.log`。源码及记录保存在独立本地发布分支，未推送 GitHub。



### 2026-09-22 暴击临时命中 Web/Server 全量部署一次性授权（不更新 APP）

- 状态：已于 2026-09-22 完成 Web/Server 全量部署和必要验收，本次授权已使用并失效。用户明确要求“全量部署 Web/Server，不更新 APP，不重复检查”。
- 以已发布 BOSS 版本及发布记录 396f103 为基线，仅纳入普攻、反击及伤害技能每次暴击临时增加 50 个百分点命中及回归测试；群攻逐目标、多段逐段判定，不修改面板、不生成增益。短信导入保留本地，不纳入本次发布。
- 复用已通过的 210 项战斗测试、服务端类型检查及共享构建，不重复运行检查与测试；独立快照在本地完整构建 Web/Server 生产镜像，仅执行必要的认证、产物及线上健康核验。
- 原样继承生产 JWT 并用 -e JWT_SECRET 显式注入；Cookie、既有环境、挂载和 Nginx 保持不变，保留回滚容器。不构建、上传或更新 APP，不修改 APP 更新记录，不推送 GitHub。
- 完成、失败或中止后本次授权失效，并记录结果。
- 发布提交 `bb20a41976cc464a1a4d1ae2c4dcb485d41b0640`，镜像 `hgt:bb20a41`，容器 `58a6b61c9efd730f887cdd96675ca9fb7ecbcfe75f6acecf2090640a9be5d8d5`；镜像归档 SHA256 `37bbd3b0a7ef052f6ab96df8c8be7a7e5f5b4b0c5e1cd99e8e3109efe9b3914f`。原容器保留为 `hgt-app-rollback-bb20a41`。
- JWT 哈希、Cookie、全部环境和挂载、Nginx 配置前后一致；双域名入口 JS/CSS 及 5 个服务端/共享文件与本地镜像哈希一致，健康和 APP 凭据 CORS 通过。
- APP 仍为 p0.49，47 条更新记录整体哈希未变，p0.44 继续停用；未构建、上传或发布 APP。按用户要求复用 210 项战斗测试、类型检查及共享构建结果，未重复运行测试；本次已完整构建 Web/Server 生产镜像。
- 记录 `artifacts/critical-hit-release-20260922/REPORT.md`，日志 `.local/release-critical-hit-20260922/.local/deploy.log`。源码及记录保存在独立本地发布分支，未推送 GitHub。



### 2026-09-22 BOSS 玩家房间及全部待更新 Web/Server 全量部署一次性授权（不更新 APP）

- 状态：已于 2026-09-22 完成 Web/Server 全量部署与最终验证，本次线上授权已使用并失效。用户明确要求“全量部署web server，检查所有没更新的都更新，不更新APP”。
- 以最新已发布抽卡优化版本及记录 4832348e24f288bcd6997f307c479ff81d44ef8b 为基线，审计当前全部未提交/未跟踪业务文件，纳入 BOSS 玩家房间、系统固定房间退役、首通记录跨房间兼容、房主管理和退出/离线清理、回归测试，以及尚未发布的卡包说明文案调整；保持已发布收藏品多效果、抽卡优化及此前修复。
- 独立发布快照先完成检查、完整测试、Web/Server 构建及 BOSS MySQL/浏览器回归，生产镜像本地构建。不构建、上传或发布 APP，不修改 APP 更新记录。
- 生产 JWT 原样继承并用 -e JWT_SECRET 显式注入；Cookie、既有环境、挂载和 Nginx 保持不变，保留回滚容器。校验双域名实际资源及服务端文件、健康/CORS、APP 更新记录和 BOSS 历史/奖励数据保留。
- 完成、失败或中止后本次线上授权失效并记录结果；本次未要求 GitHub 推送。
- 发布提交 `37992830b25a07f1a5e595243fc79cd85c3827d9`，镜像 `hgt:3799283`，容器 `8f2a0ed7df313bae510ad9428d91a6f7b143837777ec002a2bcc919557a21bad`；镜像归档 SHA256 `940f27b85a8c2ad8c9229b613bab2a16b6de6833ea84f02480728ae130260e25`。原容器保留为 `hgt-app-rollback-3799283`。
- JWT 哈希、Cookie、全部环境和挂载、Nginx 配置保持一致；双域名各 135 项 JS/CSS 与 12 个服务端/共享文件哈希一致，健康、APP 凭据 CORS、桌面/手机页面启动通过。
- BOSS 房间字段迁移成功，固定系统房间已从大厅退役；部署前 2 个 BOSS 配置、87 场历史战斗快照、17 条首通奖励记录逐条哈希均保留。
- 89 项检查、600 项完整测试、BOSS 真实 MySQL 回归、创建/管理/战斗浏览器回归和 Web/Server 构建通过。APP 仍为 p0.49，全部 47 条更新记录哈希未变，p0.44 继续停用；未构建、上传或发布 APP。
- 发布报告 `artifacts/boss-release-20260922/REPORT.md`，日志 `.local/release-boss-rooms-20260922/deploy.log`。源码及记录保存在独立本地发布分支，未推送 GitHub。


### 2026-09-22 抽卡等待与翻牌优化 Web/Server 全量部署一次性授权（不更新 APP）

- 状态：已于 2026-09-22 完成 Web/Server 全量部署与最终验证，本次授权已使用并失效。用户明确要求“全量部署web server，不更新APP”；未构建或更新 APP。
- 基于已发布收藏品多效果版本及其发布记录 387d01a3d5479b0e34b80388422c9bce0ca199e1，仅纳入本次抽卡事务查询去重、排除图片大字段、响应计时、等待反馈、翻牌图片预解码、暂停背景媒体、延迟页面刷新和光效优化及对应测试。其他任务 BOSS/大厅改动保留在原工作区。
- 使用独立发布快照，完成本地检查、测试、构建与浏览器/MySQL 回归，生产镜像在本机构建；完整部署 Web/Server，不构建/上传 APK、不修改 Android 版本或更新记录。
- 原样继承生产 JWT 并通过 -e JWT_SECRET 显式注入；Cookie、全部既有环境、挂载及 Nginx 配置保持不变。保留回滚容器；核对双域名实际资源、服务端文件、健康/CORS 和全部 APP 更新记录哈希。
- 完成、失败或中止后授权失效，须记录最终结果；本次未要求 GitHub 推送。
- 发布提交 `df9ee48aa42d9d646c375c16048b7769ffed55e7`，镜像 `hgt:df9ee48`，容器 `f49561372a259d80240aac31f8cc884e11197a9d5772e574006aa0a2034419d5`；镜像归档 SHA256 `d6604dafe1ab6b2128e364a9ee06af0176da89c45fa564447737ac295502917a`。原容器保留为 `hgt-app-rollback-df9ee48`。
- JWT 哈希、Cookie、全部环境和挂载、Nginx 配置保持一致；双域名各 135 项 JS/CSS 与 7 个服务端/共享文件哈希核对通过，抽卡等待反馈、翻牌优化和事务去重均包含在实际发布资源中。健康、APP 凭据 CORS、桌面/手机页面启动通过。
- APP 可见版本仍为 p0.49，全部 47 条更新记录哈希未变，p0.44 保持停用。89 项检查、600 项完整测试、真实 MySQL 十连/幂等回归、抽卡浏览器回归及完整构建通过；未进行手机实机帧率验收。
- 验证归档 `artifacts/draw-release-20260922/REPORT.md`，发布日志 `.local/release-draw-performance-20260922/deploy.log`。源码与记录保存在独立本地发布分支，未推送 GitHub。


### 2026-09-22 收藏品多效果 Web/Server 全量部署一次性授权（不更新 APP）

- 状态：已于 2026-09-22 完成 Web/Server 全量部署与最终验证，本次线上授权已使用并失效。用户明确要求“全量部署web server不更新APP”；未构建或更新 Android APP。
- 以已发布 p0.49 源码和发布记录 c0e989683536d3d18df5ae8e1c0d7505a723e10c 为基线，仅纳入本次收藏品新增 12 种技能效果、动态增删效果（至少一项）、多效果存储与旧数据兼容、能量上限文案、战斗计算及排行榜和详情展示。其他任务 BOSS/大厅待提交改动留在原工作区。
- 使用独立发布快照，完成本地检查、测试、构建与浏览器验证，生产镜像在本机构建；完整部署 Web/Server，不构建/上传 APK、不修改 Android 版本或更新记录。
- 生产 JWT 原样继承并以 -e JWT_SECRET 显式注入；Cookie、既有环境、挂载及 Nginx 日志配置保持不变。保留回滚容器，验证两个域名实际资源、服务器文件、健康/CORS 与 APP 更新记录哈希。
- 完成、失败或中止后授权失效，记录最终结果。本次未要求 GitHub 推送。
- 发布提交 `775254c498d5eeeba12c90bee0842a483530cbd0`，镜像 `hgt:775254c`，容器 `65f3ce6a5b0ea449c1a22598e221e766f8f11abf7343210450ab3e3e70693a4a`。JWT 哈希、Cookie、全部既有环境和挂载、Nginx 配置保持一致；原容器保留为 `hgt-app-rollback-775254c`。镜像归档 SHA256 `c76b673f90de1ea4812a807efca6e69623ae2119c1c8f2bc8967369542342b67`。
- 收藏品多效果 JSON 字段已正常建立；两个正式域名各 135 项 JS/CSS 和 8 个服务端/共享文件与本地镜像 SHA256 一致，新增 12 种效果、动态增删和能量上限文案均在实际发布资源中。健康、APP 凭据 CORS 及桌面/手机页面启动通过。
- Android 可见版本仍为 p0.49，全部 47 条更新记录哈希未变，p0.44 保持停用。本地 89 项检查、600 项完整测试、MySQL 收藏品回归、Web/Server 构建与收藏品/页面启动浏览器验收通过。
- 验证归档 `artifacts/collectibles-release-20260922/REPORT.md`，发布日志 `.local/release-collectibles-20260922/deploy.log`。发布源码及记录保存在独立本地发布快照，未推送 GitHub；原工作区其他任务改动保留。


### 2026-09-21 p0.49 全量部署与 APP 更新一次性授权

- 状态：已于 2026-09-21 完成 Web/Server、APP 更新发布及最终验证，本次线上授权已使用并失效。用户在本任务明确要求“全量部署并更新APP”。
- 范围：卡牌播放性能优化、灵光乍现系列关键点统计及可追溯历史补录，并纳入当前已审计的组队退出准备状态和送礼弹框遮挡修复；完整部署 Web/Server，发布 Android `1.0.0-p0.49`（100049）非强制更新。
- 发布前完成本地检查、测试、Web/Server 和 Android 构建、签名与最终包内页面启动检查；生产镜像本地构建。原样继承生产 JWT 并显式注入，保持 Cookie、既有环境、挂载和 Nginx 日志配置，保留回滚容器。p0.44 继续停用，不覆盖历史 APK。
- 本次不含 GitHub 推送要求。完成、失败或中止后线上授权失效，记录最终结果。
- 发布提交 `ebb20b45633a394e2adb04ee5473b55b1eec447b`，镜像 `hgt:ebb20b4`，容器 `0637cdb9a1f053115e37061b94b66f0c11d6c145c4bd267021190ccd8f65dd26`。JWT 哈希、Cookie、既有环境与挂载保持一致，旧容器保留为 `hgt-app-rollback-ebb20b4`；镜像归档 SHA256 `827e62159d163457fbe1d8e1ecb30ce6a5c402b5569112b435b653524b178d58`。
- Android p0.49（100049）已发布非强制更新，记录 `LZPlC5lk1bcoB3igl1_3G`，APK SHA256 `fc686008a8beb83d98c6202b85aac62aa30a6863be4e8c3d23f59bcabfd32406`，公网回下载一致。原有 46 条更新记录哈希未变，p0.44 仍停用；p0.43–p0.48 提示非强制升级，p0.49 不重复提示。
- 关键点历史命中实际由 588 条增至 624 条，36 条可追溯漏记全部补回，可补录遗漏及已达标未解锁的灵光乍现系列徽章均为 0。两个正式域名各 135 项 JS/CSS 与镜像 SHA256 一致，8 个服务端修复文件哈希一致；健康、APP 凭据 CORS、桌面/手机页面启动通过。
- 本地检查（89 项）、完整测试（595 项）、Web/Server 构建、组队 MySQL 回归、九种视口送礼回归、Android 原生测试及签名和最终包内页面启动检查通过；未连接 Android 真机。验证归档 `artifacts/p049-release/REPORT.md`，发布日志 `.local/p049-full-deploy.log`。源码和发布记录已本地提交，未推送 GitHub。

### 2026-09-21 p0.48 更新凭据后重新全量部署授权

- 状态：已于 2026-09-21 完成 Web/Server、APP 更新发布、Nginx 日志接入及最终验证，本次线上授权已使用并失效。用户明确要求“重新授权全量部署并更新 APP，完成后推送 GitHub”。这是独立于此前 OSS 上传失败的新授权；GitHub 源码同步继续按独立推送要求执行。
- 发布范围沿用已经审计并完整验证的 `ed14b78ac0b97587dd9580f2d66fe4c251b008db`：Web/Server、Android `1.0.0-p0.48`（100048）非强制更新、Nginx 请求日志接入；成功验收后将所有代码及发布记录推送 GitHub。
- 已确认本机 OSS 凭据文件已更新。使用干净候选 `.local/release-p048` 复用同提交签名 APK 和本地镜像，从上传门禁继续；保留 JWT/Cookie、既有环境与挂载及回滚容器，线上认证和发布验收仍必须执行。
- 完成、失败或中止后本次线上授权失效，须记录最终结果。
- 实际发布提交 `ed14b78ac0b97587dd9580f2d66fe4c251b008db`、镜像 `hgt:ed14b78`、容器 `94fb0408083e0081f5c3bf278de042ae1d683336b145450cdca52fc579a915c0`。JWT 哈希、Cookie、既有环境与挂载保持一致，旧应用容器保留为 `hgt-app-rollback-ed14b78`；最终镜像归档 SHA256 `707391fa0fa9863c864019f14db9cbd8059efde9561f48e5062684d0da1e31ce`。
- Android p0.48（100048）已上传、回下载校验并发布非强制更新，更新记录 `4kDS46QYmXAXBLKyiqHLS`，APK SHA256 `5e156f98ad424fb8abcbe85902bc775e2e20947349bbc4f7b9e75ccf7aa32ea1`；原有 45 条更新记录未改变，p0.44 仍停用。p0.43–p0.47 均提示非强制升级，p0.48 不重复提示。
- Nginx 配置语法、双来源慢请求日志实际写入及应用认证复核均通过；配置备份在 `/opt/hgt-observability/backup-ed14b78`，日志目录 `/var/log/hgt/requests`。两个正式域名各 135 个 JS/CSS 资源与镜像 SHA256 完全一致，服务端战斗、配置和新增条件文件哈希一致；健康和 APP 凭据 CORS 通过。镜像内 269 项公共资源已校验。
- 验证记录：`.local/p048-resume.log`、`.local/p048-public-verification.log`、`.local/p048-proof/public-proof.json`。本次复用已通过本地检查、测试、原生测试、签名及包内页面浏览器验收的同提交 APK；未连接 Android 真机。源码与本条发布记录均纳入 GitHub main 的同步范围。

### 2026-09-21 p0.48 全量部署与 GitHub 同步一次性授权

- 状态：2026-09-21 APK 上传返回 `403 InvalidAccessKeyId`，发布流水线停止，本次线上授权因失败已失效。尚未切换生产 Web/Server、安装 Nginx 采集或发布 APP 更新记录。用户明确要求“全量部署web server并更新APP，检查之前没做的提交，全部都提交上去，部署完成后推到github”。
- 范围：整合所有已审计的待提交业务源码、共享模块、测试和发布工具，保留生产 `ccb85cd573e245909db57b9d4d830d2fdbe65ef5` 与 GitHub `66d7b8842fb211c4292a6d32a7318b0670623043` 既有修复；完整部署 Web/Server，发布 Android `1.0.0-p0.48`（100048）非强制更新，并补齐此前回滚的 Nginx 请求日志接入。完成后推送既有 GitHub 仓库。
- 发布前完成本地检查、测试、Web/Server 和 Android 构建、签名与浏览器启动验收，生产镜像本地构建。生产 JWT 原样继承并显式注入，Cookie、既有环境和挂载保持不变；Nginx 按已审计哈希备份、校验、接入，失败回滚配置。
- 不修改历史 `apps/app`；临时预览、凭据和构建产物不进入 Git。p0.44 保持停用，p0.47 的历史 APK 不覆盖；发布后核对两域名真实资源、服务健康、认证不变量、APP 下载哈希与更新接口。
- 完成、失败或中止后本次线上授权失效，须记录最终结果；GitHub 推送按用户本次独立要求完成。
- 发布候选提交 `ed14b78ac0b97587dd9580f2d66fe4c251b008db` 已整合全部业务改动，保留当前生产与远端提交历史；本地完整检查、服务端测试、Web/Server 构建、卡牌条件/特效/飞行和表情浏览器回归、Android 原生测试、签名和最终包内页面启动验收通过。补齐了旧特效测试的固定卡位定位与后段读数验收。
- Android `1.0.0-p0.48`（100048）APK 已构建，SHA256 `5e156f98ad424fb8abcbe85902bc775e2e20947349bbc4f7b9e75ccf7aa32ea1`；未上传成功。读取的是 `.local/oss-access-key-id.txt` 和 `.local/oss-access-key-secret.txt`，未被环境变量覆盖；需要用户更新有效凭据并重新授权全量部署。
- 本地镜像 `hgt:ed14b78` 已构建，269 个公共资源路径及内容校验通过，归档 SHA256 `bd148d8ae2418a0ef2604995f9a1e7f13583c384961651235ef33d79d822baa6`。日志在 `.local/p048-full-deploy.log`、`.local/p048-local-image.log`；APK 位于 `artifacts/android/1.0.0-p0.48/`。这些同提交产物可供核验后复用。
- 生产仍为 `hgt:ccb85cd`，用户可见 APP 仍为 p0.46。本次尚未推送 GitHub，遵循用户“部署完成后推到github”的顺序；后续完成部署后再同步全部提交。不得把本次失败记录当作新线上授权。

### 2026-09-21 Web/Server 仅重启一次性授权

- 状态：已于 2026-09-21 使用并完成一次重启与验证，现已失效。用户明确授权“授权本次全量部署，仅重启 Web/Server 应用服务，不发布代码”。
- 范围仅为重启既有 `hgt-app` 容器一次；不发布源码或镜像、不重建容器、不重启宿主机或数据库、不更新 APP。复用当前已验证的 `hgt:ccb85cd` 产物，无新构建。
- 重启前已验证生产 JWT 与持久化配置一致、Cookie 运行时约定符合要求；重启前后比较容器 ID、镜像、全部容器配置及挂载的哈希，验证本机健康和两个正式域名。完成、失败或中止后授权失效。
- 应用容器 `6d27c436d9558058a53f93155d54c1697817c7531e987a03e7bf5af3b741610f` 于北京时间 10:30:11 重启，镜像仍为 `hgt:ccb85cd`。容器 ID、镜像、Config、HostConfig、挂载的综合 SHA256 前后一致；重启后 JWT/Cookie 核验通过，本机健康及两个正式域名首页、健康接口均为 200。未发布本地改动。
- 日志：`.local/restart-web-server-20260921.log` 和 `.local/restart-web-server-20260921-auth.log`。本次授权已完成并失效，不得沿用。

### 2026-09-20 卡牌编辑保存修复 Web/Server 全量部署一次性授权

- 状态：已于 2026-09-20 使用并完成 Web/Server 全量部署与验证，现已失效。用户明确要求“全量部署web server”，本次未更新 Android APP。
- 以生产提交 5d80d4cc2a5cb1ad7e967e9913b3ed969662528c 为基线，仅纳入复制零星技能生成独立 ID、服务端兼容重复技能 ID 及对应回归测试；完整部署 Web/Server，不更新 Android APP。
- 独立快照完成检查、测试和构建，镜像本地构建；生产 JWT 原样继承并显式注入，Cookie、全部既有环境和挂载保持不变。
- 发布后核对两域名实际引用资源与镜像哈希、服务端修复文件及健康/CORS；完成、失败或中止后授权失效，记录最终结果。
- 发布提交 `ccb85cd573e245909db57b9d4d830d2fdbe65ef5`，生产镜像 `hgt:ccb85cd`，容器 `6d27c436d9558058a53f93155d54c1697817c7531e987a03e7bf5af3b741610f`。完整检查、582 项服务端测试、Web/Server 构建、复制技能及网页启动浏览器验证、269 个静态资源校验通过。
- 两个正式域名实际引用的入口、样式及 `AdminPage-M6TXUjwo.js` 均与镜像 SHA256 一致；运行容器的 `cardBattleConfig.js` 与镜像一致且包含重复 ID 修复。JWT 哈希、Cookie、环境及既有挂载保持不变，健康与 APP 凭据 CORS 通过，APP 可见版本仍为 p0.46。原容器保留为 `hgt-app-rollback-ccb85cd`。未修改线上卡牌数据进行保存验收。
- 验证记录：`.local/release-card-copy-20260920/artifacts/card-copy-release/public-proof.json`；部署日志：同目录 `deploy.log`。本次授权已完成并失效，不得沿用。


### 2026-09-18 卡牌实测修复 Web/Server 全量部署一次性授权

- 状态：已于 2026-09-18 使用并完成 Web/Server 全量部署与验证，现已失效。用户明确要求“全量部署一次，确保这个被部署上去”，沿用本任务 Web/Server 范围，未更新 APP。
- 最终发布快照 `5d80d4cc2a5cb1ad7e967e9913b3ed969662528c`，生产镜像 `hgt:5d80d4c`，容器 `cd6606b93be30cbccf1a7b04abcbb34f34617ec2078f1eb5f41aa39880804604`。两个正式域名实际入口、卡牌脚本与样式 SHA256 均与镜像一致；服务端卡牌文件 SHA256 也与镜像一致。JWT、Cookie、环境及既有挂载未变，健康与 APP 凭据 CORS 通过。
- 候选检查、191 项服务端卡牌测试、完整构建及 269 项公共资源路径/内容核验通过。使用生产镜像原始页面和本地 API 战斗数据在浏览器验收，普通/BOSS/卡塔均连续飞向目标并回位，后段读数保持可见；该验收未创建线上账号对局，也未更新或验收 Android 实机。
- 发布范围：以当前生产 `41b675ff8ab6a3312db42c993bc59a203e64bdb8` 为基线，将本次卡牌实测修复逐文件纳入独立快照：原生坐标飞行、稳定卡位上的数值/命中特效、固定技能名与延后淡出、最终 1.25 倍基线节奏及旧回放阅读时长。保留已发布的日志、语音和中文静态资源修复。
- 发布前在候选快照完成检查、卡牌测试、完整构建，并核对源码与构建包确实含 `card-battle-flight` 和 `card-battle-event-notice`。镜像在本地构建，生产 JWT 原样继承并显式注入，Cookie、既有环境及挂载保持不变。
- 发布后比对两个正式域名实际引用的新卡牌脚本及样式哈希，并用实际发布资源验证飞行动作；不以健康接口成功代替修复已上线的验证。
- 本次完成、失败或中止后授权失效，记录最终结果，不得沿用。

### 2026-09-18 汤汤表情资源 Web/Server 全量部署一次性授权

- 状态：已于 2026-09-18 使用并完成 Web/Server 部署与验证，现已失效。用户明确要求“全量部署 Web/Server”。本次未构建或发布 APP，未安装 Nginx 日志采集。
- 发布范围：基于 `66d7b8842fb211c4292a6d32a7318b0670623043` 的独立快照，修复 Windows 解压中文静态资源文件名乱码，增加解压目录和最终镜像资源路径及内容校验。Web/Server 业务源码与当前生产 `3d89d12` 保持一致；原工作区的其他改动保留。
- 先完成本地检查、构建、镜像和 38 个表情真实 HTTP/浏览器验证；生产 JWT 原样继承并显式注入，Cookie、环境及挂载保持不变。保留原容器回滚。
- 完成、失败或中止后本次授权失效，记录最终结果，不得沿用。
- 发布提交 `41b675ff8ab6a3312db42c993bc59a203e64bdb8`，生产镜像 `hgt:41b675f`，镜像归档 SHA256 `36f0e12363bcb1e95427d8e90c0ba064acc1e5d157981618ff7cbcd6381fd17c`。本地检查、完整构建、真实页面启动、269 个静态资源及桌面/手机表情浏览器验证通过。
- `tangwuyu.com` 与 `hgt.caqis.com` 的全部 38 个汤汤静态/动态图均返回 200、WebP 类型且内容与提交一致；在正式圈子页面同源环境中 38 张图片均成功解码。JWT 哈希、Cookie、全部环境和挂载前后一致；Nginx 三份配置哈希未变，APP 可见版本仍为 p0.46。新容器 `530ecd3272538724164c4fe76d961b4eb6a2be2d633af82a300a7bcde56a5aed` 正常运行，原 `hgt:3d89d12` 容器保留为 `hgt-app-rollback-41b675f`。验证报告在 `.local/sticker-encoding/public-verification.json`，部署日志在 `.local/release-sticker-utf8/artifacts/sticker-release/deploy.log`。

### 2026-09-18 请求链路日志 p0.47 全量部署与 GitHub 推送一次性授权

- 状态：Web/Server 已部署；Nginx 日志验收失败后配置已回滚，APP 更新记录未发布。本次线上授权因失败已失效；后续线上重试需要重新明确授权全量部署。GitHub 源码同步继续按用户独立的推送要求处理。
- 发布范围：以当前生产快照 `7305d30b12316743376819254357c74cd36c070b` 为基线，在独立发布工作区纳入慢请求、未响应和断开诊断、宿主机小时日志及最近 24 小时保留、独立 Nginx 采集；完整构建 Web/Server 和 Android `1.0.0-p0.47`（100047），发布非强制更新，并将发布代码推送到既有 GitHub 仓库。保留原工作区未发布修改。
- 生产镜像本地构建；JWT 原样继承并显式注入，Cookie、既有环境和挂载保持不变，仅新增日志目录及配置。先执行本地门禁和生产认证核对，再切换；Nginx 配置先备份、校验、reload，失败恢复。
- 完成本次全部发布、验证和推送后记录最终结果并失效，不得沿用。
- 实际生产提交 `3d89d127a527b7a571e0b678e86ba1ff7e0f4a1d`、镜像 `hgt:3d89d12`，JWT/Cookie/既有挂载不变，新增日志挂载与目录环境变量，公网健康及 APP CORS 通过。原容器保留供回滚。
- p0.47 APK 已构建、验签、通过内置页面启动检查并上传，SHA256 `124d4a2c8daa02a0956f8d1196ef5cf3cd7545da20d7f3985dd2dc7b1cb48fd7`，公网回下载一致；由于日志验收未通过，未发布 APP 更新记录，当前可见版本仍为 p0.46。
- Nginx 配置通过语法检查，但原 curl 小请求限速探针未取得两层慢请求记录，安装器自动恢复原配置、移除采集容器；两个站点配置 SHA256 与安装前一致。日志目录可写且无写盘错误。已在线下改为分块定时发送并通过真实 Nginx 端到端验证，未再次操作线上部署。
- GitHub `main` 和 `codex/request-logging-p047` 已同步至修复提交 `66d7b8842fb211c4292a6d32a7318b0670623043`，远端引用已核对。对应本地镜像 `hgt:66d7b88` 与重新绑定提交的 p0.47 APK 均已构建、验签和启动检查通过，APK SHA256 与上述包相同；候选工作区 `.local/release-p047` 保持干净。修复候选尚未上传或部署，等待新的全量部署授权。
- 后续网页汤汤裂图排查确认：Windows tar 默认代码页损坏了旧镜像的中文资源文件名；上述旧镜像归档不得直接复用。主工作区已修复 UTF-8 解压及静态资源校验，并在 `artifacts/deploy` 本地重建同源码镜像，归档 SHA256 `ac8d79f1fb4a16e5766e5b198369da3d8cbcd7554783e5972f2d587a77129cbb`；269 个静态资源及 38 个表情 HTTP/桌面/手机浏览器验证通过，旧镜像负向验证正确失败。`.local/release-p047` 中旧脚本及旧归档未更新，后续发布必须纳入本次脚本修复并重新准备对应提交产物；本次未部署、未推送，不产生新的线上授权。

### 2026-09-18 卡牌伤害突进 Web/Server 全量部署一次性授权（不更新 APP）

- 状态：已于 2026-09-18 使用并完成 Web/Server 部署，现已失效。用户明确要求“全量部署web server，不更新APP，不做检查”。
- 发布范围：本次已验证的伤害技能卡牌突进、命中回位及移除伤害引导线；基于既有生产版本创建独立发布快照，完整部署 Web/Server。
- 复用本次已通过的本地检查与构建，不重跑测试；仅执行发布所必需的认证不变量、产物和服务健康核对。生产镜像在本地构建，JWT_SECRET 原样继承并显式注入，Cookie、环境及挂载保持不变。
- 不构建或上传 APK，不修改 APP 版本和更新记录。本次完成、失败或中止后授权失效，须记录最终结果。
- 发布快照 `7305d30b12316743376819254357c74cd36c070b`，生产镜像 `hgt:7305d30`；原工作区保留。按要求未重跑测试，部署认证保护确认 JWT 哈希、Cookie、全部环境及挂载前后一致，公网健康和 APP 凭据 CORS 正常；保留旧容器用于回滚。本次授权已完成并失效。

### 2026-09-17 卡牌特效升级 p0.46 全量部署一次性授权

- 状态：已于 2026-09-17 使用并完成 Web/Server 部署、APK 上传、非强制更新记录发布及验证，现已失效。用户在本次任务明确要求“全量部署并更新APP”。
- 发布范围：已完成本地验证的卡牌战斗特效升级、自动/标准/节能画质、群体技能与回放优化及对应服务端展示元数据；使用独立发布快照，完整构建 Web、Server 与 Android `1.0.0-p0.46`（`versionCode=100046`），发布非强制更新。
- 生产镜像在本地构建；JWT_SECRET 原样继承并显式注入，Cookie、RTC、其他环境及挂载保持不变，切换前后验证认证不变量；p0.44 保持停用。
- 发布快照 `e97d8b7088be0bc1013b119268653eb005633871`，生产镜像 `hgt:e97d8b7`，更新记录 `Ft1UbOWIT7YvFn2BKznL3`；保留线上既有语音心跳修复与百度验证文件。APK SHA256 为 `eef4bdf8c29eeaa7d84a5f112190d9a85eebd5e88045902432b6ad81783d429e`，公网回下载一致。
- 类型检查、完整自动化测试、Web/Server 构建、Android 原生测试及签名校验、最终 APK 内页面启动检查全部通过。JWT 哈希、Cookie、运行环境和挂载前后一致；公网健康、APP 凭据 CORS、页面启动/刷新/麦克风与三张特效贴图哈希通过。p0.43–p0.45 返回非强制更新，p0.46 不重复提示，其他更新记录未变且 p0.44 仍停用。
- 首次流水线在上传前被 Capacitor 生成的六处依赖路径变动拦截，确认全部解析到相同依赖后恢复并复用同提交签名包，从上传门禁继续完成同次发布。未连接 Android 真机；微信 UA 检查不等于微信真机验收。
- 本次完成、失败或中止后授权失效，记录最终结果，不得沿用。

### 2026-09-17 p0.45 修复版全量部署一次性授权

- 状态：已于 2026-09-17 使用并完成 Web/Server 部署、APK 上传、非强制更新记录发布及验证，现已失效。用户在本次任务明确要求“全量部署并更新APP”。
- 发布范围：已完成本地验证的提交 `45ba874de48c0c8ad3d8d56f07840a091fa9c1bc`，Web/Server 与 Android `1.0.0-p0.45`（`versionCode=100045`），修复 APP 白屏及同源麦克风权限策略，发布非强制更新；p0.44 继续保持停用。
- 复用同提交签名 APK，生产镜像在本地构建。生产 JWT/Cookie、RTC 和其他环境原样继承，切换前后核对认证不变量，不输出密钥原文。
- 实际镜像 `hgt:45ba874`，更新记录 `KEEdUeR5ms279SWwdKtD7`。JWT 哈希、Cookie、环境和挂载均保持一致；公网健康、APP 凭据 CORS、真实网页权限策略下的麦克风采集/释放均通过。p0.43/p0.44 返回非强制升级至 p0.45，p0.45 不重复提示；只读确认 p0.44 仍停用。
- 首次本地流水线被生成文件 CRLF/LF 差异拦截，尚未上传或切换；核对无内容差异并刷新索引后，从原产物门禁继续同次发布，全部门禁通过。微信 User-Agent 验证不等于微信真机通话验收。
- 本次完成、失败或中止后授权失效，记录最终结果，不得沿用。

### 2026-09-17 p0.44 更新隐藏紧急操作记录

- 用户明确要求先隐藏出现白屏的当前 APP 更新。本次仅通过既有管理 API 停用 Android `1.0.0-p0.44`（`versionCode=100044`），已完成；其他更新记录未变。
- 公网接口确认 p0.43 用户收到 `updateAvailable=false`、`forceUpdate=false`，当前可见版本回到 p0.43。
- 本次隐藏授权已使用并失效，不包含重新部署、上传或发布修复版。p0.45 修复和验证先在线下完成，正式发布仍需当前任务明确的“全量部署”授权。

海龟汤 (HGT) 评价管理系统 — 全栈 monorepo

## APP 开发目录永久规则（最高优先级）

- `apps/app` 是已停用、仅供历史参考的 uni-app x / uniapp 客户端。从本规则写入后的后续任务开始，任何功能开发、缺陷修复、交互调整、视觉修改、类型同步或构建适配均禁止修改该目录；本规则不要求撤回写入前已经存在的改动。
- 用户提到“APP”“Android APP”“手机 APP”“更新 APP”或类似表述时，统一指 `apps/web` 的手机端响应式页面及其 `apps/app-android` Capacitor Web 套壳。业务功能和界面以 `apps/web` 为唯一实现源；只有套壳原生能力、Android 工程配置或打包事项才修改 `apps/app-android`。
- 不得因文档中仍存在“原生 APP”“uni-app x”或 HBuilderX 等历史表述而推断需要同步 `apps/app`，也不得把 HBuilderX / uni-app 编译作为当前 APP 功能的验收要求。
- 只有用户明确要求修改或删除本节永久规则后，才允许在后续任务中重新启用或修改 `apps/app`。

## 线上操作授权门槛（永久、最高优先级）

- 原“线上部署永久禁令”已由用户于 2026-08-13 明确撤销，改为本节授权门槛。
- 只有用户在当前任务中明确要求执行“全量部署”，才允许对线上环境执行部署、发布、同步、生产服务器 SSH/SCP/rsync、Docker 容器变更或服务重启，以及该次全量部署明确包含的 Android APP 构建、APK 上传和更新记录发布。
- “完成”“上线”“发布”“更新 APP”“部署某个修复”等其他表述均不构成全量部署授权；无法确认时必须停在线下验证状态并请用户明确说出要执行全量部署。
- 每次“全量部署”授权仅对用户当次明确要求的任务生效，完成、失败、中止或任务结束后自动失效，不得沿用到后续任务，也不得扩展到与本次发布无关的线上操作。
- 获得全量部署授权后仍必须先完成本地检查和构建，核对实际发布范围，并在变更线上状态前验证生产认证不变量；任一安全门槛不满足必须中止。
- 生产 `JWT_SECRET` 必须从线上既有持久化配置或当前容器原样继承，并在容器启动时用 `-e JWT_SECRET` 显式注入；禁止生成、更换、清空、输出或记录原文，禁止写入源码、构建产物或版本库。部署前后只允许用不可逆哈希比较。
- 必须保持生产 Cookie 名称、`httpOnly`、`sameSite`、`secure`、`domain`、`path` 与 30 天有效期完全不变，确保现有 JWT 和用户登录状态继续有效；任何不一致都必须中止，不得先部署后修复。

### 2026-08-13 全量部署与 Android APP p0.8 一次性授权

- 状态：已于 2026-08-13 使用并完成部署、APK 更新记录发布与验证，现已失效。
- 用户已明确要求执行一次全量部署，并明确允许构建、上传和发布 Android APP `1.0.0-p0.8`（`versionCode=100008`）。
- 本次允许发布当前本地工作区经审计和验证后的完整 Web、Server 与 Android 候选版本，执行必要的生产容器替换/重启，以及通过现有管理 API 新增并启用本版本的非强制 Android 更新记录。
- 本次不得更换或泄露 `JWT_SECRET`，必须通过 `-e JWT_SECRET` 从线上既有值注入；不得改变上述生产 Cookie 属性，不得造成现有用户掉登录。
- 完成全部线上验证后，必须将状态更新为“已于 2026-08-13 使用并完成部署与验证，现已失效”；若失败或中止，必须记录结果，且不得将本次授权沿用到后续任务。

### 2026-08-13 全量部署与 Android APP p0.9 一次性授权

- 状态：已于 2026-08-13 使用并完成部署、APK 更新记录发布与验证，现已失效。
- 用户已明确要求执行一次全量部署，并明确允许构建、上传和发布 Android APP `1.0.0-p0.9`（`versionCode=100009`）。
- 本次允许发布当前本地工作区经审计和验证后的完整 Web、Server 与 Android 候选版本，执行必要的生产容器替换/重启，以及通过现有管理 API 新增并启用本版本的非强制 Android 更新记录。
- 本次不得更换或泄露 `JWT_SECRET`，必须通过 `-e JWT_SECRET` 从线上既有值注入；不得改变生产 Cookie 属性，不得造成现有用户掉登录。
- 完成全部线上验证后，必须将状态更新为“已于 2026-08-13 使用并完成部署、APK 更新记录发布与验证，现已失效”；若失败或中止，必须记录结果，且不得将本次授权沿用到后续任务。

### Android APK 上传 OSS 例外

- 经用户明确授权，允许将本地构建成功的 Android APK 上传到 OSS Bucket `zgkc-storage` 的 `hgt/apps/` 路径。
- 仅允许上传 APK 构建产物；不得借此上传源码、配置、密钥、数据库文件或其他内容。
- 允许在 Android 本地打包脚本中于构建成功后执行该上传，并返回 `https://zgkc-storage.kjcxchina.com/hgt/apps/` 下的下载链接。
- 该例外不授权生产服务器登录、服务部署、容器变更、数据库写入或其他线上状态修改。

### 正式数据库只读导出例外

- 经用户明确授权，允许为本地开发数据同步，以只读方式连接正式环境并导出 MySQL 数据。
- 该例外仅允许执行不会改变正式环境状态的查询和 `mysqldump`；禁止在正式数据库执行 DDL、DML、迁移、锁表写入或账号权限变更。
- 导出文件只能导入本地 Docker Compose 数据库，不得反向同步到正式环境。
- 除上述只读数据库导出及 Android APK 上传 OSS 例外外，线上部署、发布、文件同步、容器变更和服务重启禁令继续有效。

### Android APP p0.5 更新记录一次性发布例外（2026-08-12）

- 状态：已被后续全量部署授权门槛取代，现已失效；后续不得引用本例外。
- 经用户明确授权，允许在正式环境仅新增并启用一条 Android APP 更新记录：版本 `1.0.0-p0.5`、版本号 `100005`、非强制更新，APK 地址固定为 `https://zgkc-storage.kjcxchina.com/hgt/apps/1.0.0-p0.5/hgt-android-1.0.0-p0.5%2B100005-9b33cf7-release.apk`，更新说明固定为“修复 APP 首页 Banner 跳转表情包商城白屏问题”。
- 仅允许通过现有正式管理 API 新增并启用上述记录；不得修改、删除或停用其他更新记录，不得执行其他正式数据库 DDL、DML、迁移、导入导出或账号权限变更。
- 不得登录生产服务器、部署或同步代码、重启或重建服务、修改容器、Nginx、环境变量、认证配置或其他线上状态；不得上传 APK 之外的文件。
- 最低支持版本必须设置为不高于当前既有最低支持版本的安全值，确保本次更新为非强制更新；若无法只读确认现有配置，必须中止，不得猜测。
- 发布后仅允许只读验证：旧版本号请求返回 `updateAvailable=true`、`forceUpdate=false` 且版本、APK 地址和更新说明准确；`versionCode=100005` 请求返回 `updateAvailable=false`。验证完成后必须将本节状态更新为“已于 2026-08-12 使用并完成发布与验证，现已失效”。

### Android APP CORS 修复一次性部署例外（2026-08-10）

- 状态：已于 2026-08-10 使用并完成部署与验证，现已失效；后续线上操作不得继续引用本例外。
- 经用户明确授权，允许将“正式 API 允许 Android APP 本地来源 `https://app.caqis.com` 以凭据模式跨域访问”的服务端 CORS 修复部署一次。
- 本例外仅允许发布 `APP_ORIGIN=https://app.caqis.com` 配置、服务端对该 Origin 的白名单支持，以及完成该修复所严格必需的容器重建、替换和重启；禁止夹带其他服务端功能、前端、Android APK、Nginx、数据库、依赖或其他配置变更。
- 部署必须从干净、隔离的临时工作区或等价的精确补丁构建，不得将当前工作区的其他未提交修改带入部署产物；发布前必须逐文件审计实际差异，若包含任何无关变更必须中止。
- 部署前必须只读提取当前线上容器认证配置：`JWT_SECRET` 仅做不可逆哈希比较，Cookie 名称、`httpOnly`、`sameSite`、`secure`、`domain`、`path` 和 30 天有效期逐项核对；任一项不一致必须中止。
- 新容器必须完整继承当前线上 `JWT_SECRET`、`COOKIE_DOMAIN`、`COOKIE_SECURE` 及现有运行所需环境变量、挂载、网络和端口，仅允许新增或确认 `APP_ORIGIN=https://app.caqis.com`；不得生成、替换、输出或记录任何密钥原文。
- 禁止手工执行数据库迁移、DDL、DML、数据导入导出、Nginx 修改、APK 上传或其他无关线上操作；不得借本例外主动触发后台任务或数据写入。
- 部署后仅允许只读验证：健康检查和正式站返回 `200`，带 `Origin: https://app.caqis.com` 的汤列表请求及登录预检请求返回 `Access-Control-Allow-Origin: https://app.caqis.com` 与 `Access-Control-Allow-Credentials: true`，原有 `https://hgt.caqis.com` 跨域行为保持正常，且认证配置的不可逆哈希和 Cookie 属性与部署前完全一致。
- 上述验证完成后必须将本节状态更新为“已使用并失效”；除本节明示授权的一次性操作外，线上部署禁令继续完全有效。

### Bing SEO 301 修复一次性部署例外（2026-08-10）

- 状态：已于 2026-08-10 使用并完成部署，现已失效；后续线上操作不得继续引用本例外。
- 经用户明确授权，允许将本地已验证的“旧公网地址 `http://47.239.5.69:4000/` 按原路径 301 重定向到 `https://hgt.caqis.com/`”服务端修复部署一次。
- 本例外仅允许同步并发布实现该 301 重定向所必需的服务端代码；禁止夹带其他功能、前端、数据库、配置或依赖变更。
- 部署前必须只读提取当前线上容器认证配置：`JWT_SECRET` 仅做不可逆哈希比较，Cookie 名称、`httpOnly`、`sameSite`、`secure`、`domain`、`path` 和 30 天有效期逐项核对；任一项不一致必须中止。
- 新容器必须继承当前线上 `JWT_SECRET`、`COOKIE_DOMAIN`、`COOKIE_SECURE` 以及现有运行所需环境变量和挂载，不得生成、替换、输出或记录密钥原文。
- 禁止手工执行数据库迁移、数据库写入、生产数据导出、Nginx 改动或其他无关线上状态变更；仅允许新容器按现有程序行为启动时附带的例行初始化与后台任务，不得借本例外新增或主动触发数据操作。
- 部署后仅允许验证健康检查、正式域名仍返回 200、旧 IP 首页及深层路径返回保留路径的 301；完成后本例外自动失效，线上部署禁令恢复为完全生效。

### BingSiteAuth.xml 单文件上传一次性例外（2026-08-10）

- 经用户明确授权，允许将本地 `apps/web/public/BingSiteAuth.xml` 单文件上传到当前线上容器的 `/app/apps/web/dist/BingSiteAuth.xml`，使 `https://hgt.caqis.com/BingSiteAuth.xml` 可用于 Bing 站点所有权验证。
- 仅允许上传该 XML 文件及上传所必需的临时副本；禁止上传、修改或发布任何其他代码、配置、密钥、数据库文件或构建产物。
- 禁止停止、重启、重建、替换或重命名容器，禁止修改镜像、Nginx、数据库、环境变量、挂载、网络或认证配置。
- 上传前后必须比较容器 ID、启动时间、环境变量整体哈希和实际生效 `JWT_SECRET` 的不可逆哈希；任一项变化必须立即停止并报告。
- 上传后仅允许只读验证该 URL 返回 `200`、XML 内容与本地文件一致且正式站健康检查仍为 `200`。
- 状态：已于 2026-08-10 使用并完成上传与验证，现已失效；后续线上操作不得继续引用本例外。

## 前端交互与展示规范（强制）

项目的跨页面交互与展示规范统一维护在：

- `docs/前端交互与展示统一规范.md`

后续任务涉及聊天、表情包、圈子、私信、玩汤房间、`@用户`、未读提示、消息横幅、底部导航提示、用户头像、在线状态、昵称旁徽章图标或徽章名称时，必须在设计、修改或审查代码前完整阅读该文档。

新增跨页面规则或改变既有规则时，必须同步更新该统一规范；禁止创建内容重叠的独立规范文档。

## 管理后台路由规则（强制）

- 管理后台模块路由统一维护在 `apps/web/src/components/admin/adminRouteManifest.ts`，页面图标和渲染映射统一维护在同目录 `adminRoutes.tsx`。
- 后续新增、改名或移除任一管理后台页面时，必须同步维护路由清单；禁止重新使用 `activeTab` 等页面本地状态实现无 URL 的后台模块切换。
- 后台侧栏、权限过滤和 `/admin/<path>` 页面路由必须继续由上述清单生成，确保页面支持直达、刷新及浏览器前进/后退。
- `apps/web/tests/adminRoutes.test.ts` 是后台路由完整性门禁，必须保留在 Web `check` 流程中。

## 项目概览

面向海龟汤（情境谜题）爱好者的轻量化内容管理与评价平台。用户可以创建/分享海龟汤（汤面+汤底+主持人手册），对作品进行六维评价（总评、文笔、逻辑、分享性、机制、反转、深度），以雷达图直观展示作品得分。

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS + react-router-dom v7 |
| 后端 | Express 5 + TypeScript + mysql2 (裸 SQL，无 ORM) |
| 数据库 | MySQL 8 + InnoDB |
| 认证 | JWT (httpOnly cookie, 30天)，bypass session store |
| 图片 | sharp (缩略图生成) |
| 部署 | Docker 多阶段构建 → SCP 上传 → 阿里云 47.239.5.69 |
| 构建 | npm workspaces |

## 目录结构

```
hgt/
├── apps/
│   ├── server/src/       # Express API (端口 4000)
│   │   ├── index.ts      # 全部路由 (~1200行，单文件架构)
│   │   ├── db.ts         # 数据库初始化 + 表迁移 + admin seed
│   │   ├── config.ts     # 环境变量配置
│   │   ├── game.ts       # AI 玩汤：DeepSeek 推理游戏 API
│   │   └── types.ts      # PublicUser 等共享类型
│   └── web/src/          # Vite + React SPA
│       ├── App.tsx        # 路由定义 + 全局 Toast/Modal
│       ├── main.tsx       # Vite 入口
│       ├── api.ts         # fetch 封装 (自动 JSON, credentials: include)
│       ├── context/
│       │   └── AppContext.tsx  # 全局状态 (user, toast, 表单, 导出预览)
│       ├── components/
│       │   ├── AuthModal.tsx       # 登录/注册弹窗 + 导出预览
│       │   ├── SoupEditor.tsx      # 创建/编辑海龟汤表单
│       │   ├── EvalEditor.tsx      # 评价编辑器
│       │   ├── SoupCard.tsx        # 瀑布流卡片组件
│       │   ├── MasonryList.tsx     # Masonry 布局 + 无限滚动
│       │   ├── ContentCard.tsx     # 富文本 / 补充内容卡片
│       │   ├── FormWidgets.tsx     # 表单小组件
│       │   ├── Modal.tsx           # 通用模态框
│       │   ├── Lists.tsx           # 列表组件
│       │   ├── SoupLinkList.tsx    # 汤面链接列表
│       │   ├── PageTopBar.tsx      # 页面顶栏（标题+头像+通知红点）
│       │   ├── BottomNav.tsx       # 底部导航栏 (首页/我的)
│       │   ├── GameModal.tsx       # AI 玩汤：聊天式推理游戏界面
│       │   └── admin/              # 管理后台组件
│       │       ├── AdminTopBar.tsx
│       │       ├── UserManagement.tsx
│       │       ├── SoupManagement.tsx
│       │       └── EvaluationManagement.tsx
│       ├── pages/
│       │   ├── HomePage.tsx         # 首页：搜索+筛选+瀑布流+浮动导出按钮
│       │   ├── DetailPage.tsx       # 海龟汤详情：汤面/汤底/手册/雷达图/评价
│       │   ├── MinePage.tsx         # 「我的」个人中心
│       │   ├── MySoupsPage.tsx      # 我的作品
│       │   ├── MyFavoritesPage.tsx  # 我的收藏
│       │   ├── MyEvaluationsPage.tsx# 我的评价
│       │   ├── MyLikesPage.tsx      # 我的点赞
│       │   ├── MessagesPage.tsx     # 消息中心
│       │   ├── NotificationsPage.tsx# 通知列表
│       │   ├── RequestsPage.tsx     # 查看申请处理
│       │   └── AdminPage.tsx        # 管理后台
│       ├── layouts/
│       │   └── MainLayout.tsx       # 主布局（含 BottomNav）
│       ├── shared/
│       │   └── types.ts             # 前端共享类型定义
│       └── RadarChart.tsx           # Chart.js 六维雷达图组件
├── packages/
│   └── shared/src/index.ts         # 共享类型 (SoupSummary, Evaluation 等)
├── Dockerfile                       # 多阶段构建
├── docker-compose.yml               # MySQL 本地开发容器
├── .env.example
└── PRD_海龟汤评价管理系统.md        # 产品需求文档
```

## 启动与开发

```bash
# 首次启动
cp .env.example .env
docker compose up -d mysql    # 启动 MySQL
npm install
npm run dev                   # concurrently: server:4000 + web:5173

# 其他命令
npm run build:all             # 全量构建 (shared → server → web)
npm run check                 # TypeScript 类型检查
```

## 数据库

### 核心表

| 表 | 说明 |
|---|------|
| `users` | 用户 (username/password/nickname/avatar/role) |
| `soups` | 海龟汤 (含 surface/bottom/manual + JSON supplemental字段) |
| `evaluations` | 评价 (total + 六维评分 + content) |
| `soup_favorites` | 收藏 (soup_id + user_id 唯一) |
| `soup_likes` | 点赞 (soup_id + user_id 唯一) |
| `soup_views` | 浏览记录 (去重，60s 内不重复计数) |
| `view_requests` | 汤底查看申请 (pending/approved/rejected) |
| `soup_access_grants` | 已授权的汤底访问 |
| `notifications` | 通知 (user_id + type + is_read) |
| `game_sessions` | AI 游戏存档 (soup_id + user_id 唯一) |
| `android_app_releases` | Android APP 发布版本（版本号、APK、更新说明、启停状态） |

### 迁移策略

所有 DDL 在 `db.ts:initDatabase()` 中通过 `CREATE TABLE IF NOT EXISTS` 和 `ensureColumn()` 自动执行，无独立迁移工具。

## API 路由一览

### 认证 (`/api/auth/`)
- `POST /register` — 注册 (自动登录)
- `POST /login` — 登录 (返回 JWT cookie)
- `POST /logout` — 登出
- `GET /me` — 获取当前用户
- `PATCH /me/nickname` — 改昵称 (同步更新 soups.author/creator_name + evaluations.reviewer)
- `PATCH /me/avatar` — 改头像
- `POST /password` — 改密码

### 海龟汤 (`/api/soups`)
- `GET /` — 列表 (分页/搜索/筛选/排序)，非公开汤面过滤
- `POST /` — 创建
- `GET /:id` — 详情 (含评价列表 + 权限校验)
- `PUT /:id` — 编辑 (仅创建者或 admin)
- `DELETE /:id` — 删除 (级联)
- `POST /:id/like` — 点赞/取消 (toggle)
- `POST /:id/favorite` — 收藏/取消 (toggle)
- `POST /:id/evaluations` — 添加/覆盖评价 (每人每汤一条，通过 UNIQUE 约束 upsert)
- `POST /:id/access-requests` — 申请查看汤底

### 评价 (`/api/evaluations`)
- `DELETE /:id` — 删除评价 (仅评价者或 admin)

### 我的 (`/api/me/`)
- `GET /soups` — 我的作品
- `GET /stats` — 统计 (作品/收藏/评价/点赞 数量)
- `GET /favorites` — 我的收藏
- `GET /evaluations` — 我评价过的汤
- `GET /likes` — 我点赞过的汤

### 通知 (`/api/notifications`)
- `GET /` — 列表 (最多 50 条)
- `PATCH /read-all` — 全部已读
- `PATCH /:id/read` — 标记单条已读

### 查看申请 (`/api/access-requests`)
- `GET /` — 列表 (普通用户只看自己的，admin 看全部)
- `POST /:id/decision` — 审批 (approved/rejected)

### Admin (`/api/admin/`)
- `GET /users` — 用户列表 (含统计)
- `PATCH /users/:id` — 编辑用户 (昵称+角色)
- `DELETE /users/:id` — 删除用户
- `POST /users/:id/reset-password` — 重置密码
- `GET /evaluations` — 评价列表 (分页+搜索)

### AI 玩汤 (`/api/game/`) — DeepSeek Chat API
- `POST /:soupId/start` — 开始或继续游戏，返回对话历史
- `POST /:soupId/ask` — 发送推理提问，AI 主持人返回 JSON `{answer, progress, revealedKeys, hint}`
- `POST /:soupId/hint` — 请求方向性提示
- `GET /:soupId/status` — 查看当前进度和存档

## 认证模型

- JWT 存储在 httpOnly cookie (`hgt_token`)，secure=false (HTTP)
- 双重认证：cookie (`req.cookies.hgt_token`) 或 Authorization header (`Bearer xxx`)
- JWT 仅含 `{id, username, nickname, role, createdAt}`，不含 avatar (缩小体积)
- `/api/auth/me` 从 DB 补全 avatar 字段
- 生产环境通过环境变量 `JWT_SECRET` 注入，不写入代码仓库（部署命令中指定）

### 生产认证配置永久不变规则（最高优先级）

1. 生产环境现有 `JWT_SECRET` 必须永久沿用。任何开发、部署、容器重建、迁移、故障修复或安全加固都禁止自动生成、替换、清空、回退或轮换该值。
2. 禁止把生产 `JWT_SECRET` 的原文写入代码、文档、日志、命令输出或版本库。部署时只能从服务器持久化环境文件或当前线上容器继承；需要比较时只比较不可逆哈希。
3. 生产认证 Cookie 配置必须永久保持：
   - 名称：`hgt_token`
   - `httpOnly=true`
   - `sameSite=lax`
   - `secure=false`
   - `domain=.caqis.com`
   - `path=/`
   - 有效期：30 天
4. 所有生产部署必须显式传递并保留 `JWT_SECRET`、`COOKIE_DOMAIN` 和 `COOKIE_SECURE`。禁止使用可能覆盖线上认证配置的旧 `.env`、默认值或手写的不完整 `docker run -e ...` 参数列表。
5. 容器切换前必须将新配置与当前线上容器对比：`JWT_SECRET` 使用哈希比较，Cookie 配置逐项比较。任一项不一致时立即中止部署，不得先上线后修复。
6. 任何会使现有 JWT 失效、改变 Cookie 作用域或导致用户重新登录的操作均禁止执行。即使检测到密钥强度告警，也不得自行轮换。
7. 只有用户明确撤销本永久规则，并明确授权认证迁移方案、维护窗口和全量用户重新登录影响后，才允许改变上述配置。

## 前端架构关键点

- **路由**: react-router-dom v7，`MainLayout` 包裹首页/我的等带 BottomNav 的页面
- **状态管理**: `AppContext` 提供全局 user、toast、表单开关、导出预览、refreshKey
- **API 调用**: `api<T>(path)` 封装 fetch，自动 credentials:include 和 JSON 序列化
- **无限滚动**: 首页用 `MasonryList` 组件实现 Masonry 布局 + IntersectionObserver 触底加载
- **导出功能**: 首页浮动按钮导出前 10 条 → html-to-image 生成 PNG → ExportPreview 浮层预览/下载
- **样式**: Tailwind CSS + 自定义设计 token (card/field/btn/ink/muted/primary/shadow-soft)
- **手机适配**: 响应式设计，<420px 单列布局

## 权限模型

| 操作 | 未登录 | 普通用户 | 管理员 |
|------|--------|---------|--------|
| 浏览公开汤 | ✅ | ✅ | ✅ |
| 创建汤 | ❌ | ✅ | ✅ |
| 编辑/删除汤 | ❌ | 仅自己的 | 全部 |
| 评价 | ❌ | ✅ | ✅ |
| 删除评价 | ❌ | 仅自己的 | 全部 |
| 管理用户 | ❌ | ❌ | ✅ |
| 查看隐藏汤面 | ❌ | 自己的+被授权 | 全部 |
| 查看汤底 | ❌ | 公开/自己的/被授权 | 全部 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NODE_ENV` | development | production 时 serve 前端静态文件 |
| `PORT` | 4000 | API 端口 |
| `WEB_ORIGIN` | http://localhost:5173 | CORS origin |
| `PUBLIC_SITE_URL` | http://localhost:5173 | SEO canonical、robots 和 sitemap 使用的正式站点地址 |
| `JWT_SECRET` | dev fallback | 生产必须设置 |
| `DB_HOST/PORT/USER/PASSWORD/NAME` | 本地 MySQL | 数据库连接 |
| `ADMIN_DEFAULT_PASSWORD` | — | 首次启动时创建 admin 用户 |
| `DEEPSEEK_API_KEY` | — | DeepSeek API 密钥，用于 AI 玩汤功能 |

### 2026-09-15 全量部署与 Android APP p0.43 一次性授权

- 状态：已于 2026-09-15 使用并完成 Web/Server 部署、APK 上传、非强制更新记录发布与验证，现已失效。
- 用户明确要求“全量部署并更新APP”。
- 发布范围：基于已发布 p0.42，完整构建和部署 Web、Server 与 Android 1.0.0-p0.43（versionCode=100043），包含本次 APP 下载与安装流程修复，发布非强制更新记录。
- 生产 JWT_SECRET 原样继承并显式注入，Cookie 属性、登录有效期及现有会话保持不变；本地与线上门禁通过后方可切换。
- 本次完成、失败或中止后授权失效，记录最终结果，不得沿用。

### 2026-09-16 Web/Server 全量部署一次性授权（不更新 APP）

- 状态：已于 2026-09-16 使用并完成 Web/Server 部署及必要运行验证，现已失效。
- 用户明确要求“全量部署web server但不更新APP，不做检查”。复用此前已通过的 Web 检查及构建，不重跑测试；补齐 Shared/Server 构建并执行部署认证保护与健康确认。
- 发布范围：当前 Web/Server 和共享源码，包含卡牌编辑复制零星技能（含能量要求、技能及羁绊）以及工作区已有的统一战力计算、排行榜改动。未构建、上传 APK 或发布 APP 更新记录。
- 隔离发布快照：`ed403b549df322c6b8bc2f0e46ecfb59ee5b2572`，生产镜像：`hgt:ed403b5`；原工作区保留。
- 生产 JWT_SECRET 原样继承并显式注入，部署前后哈希一致；Cookie 配置、运行环境及挂载保持不变，公网健康与 APP 凭据跨域验证通过。
- 本次授权已完成并失效，不得沿用到后续线上操作。

### 2026-09-17 全量部署与 Android APP p0.44 一次性授权

- 状态：已于 2026-09-17 完成 Web/Server 部署、RTC 配置启用、Android APK 上传、非强制更新记录发布与验证，现已失效。
- 用户明确要求“全量部署并更新APP”。
- 发布范围：当前已审计的 Web、Server、共享模块和 Android 1.0.0-p0.44（versionCode=100044），包含语音玩汤、新增羁绊技能类型及工作区现有卡牌改动；使用独立发布快照，保留原工作区。
- RTC 凭据仅通过受限临时配置传输到服务端，开启语音入口；不写入源码、镜像、APK、日志或版本库。
- 生产 JWT_SECRET 原样继承并显式注入；Cookie 属性和登录有效期保持不变；发布非强制 APP 更新。

### 2026-09-17 百度验证文件单文件上传一次性例外

- 状态：已于 2026-09-17 使用并完成单文件上传与验证，现已失效。公网验证文件返回 200 且 SHA256 与原文件一致；首页及健康接口均为 200，容器 ID、启动时间、镜像、环境变量及认证哈希前后相同；未部署代码或重启服务。
- 用户明确授权“允许本次仅上传百度验证文件，不部署代码、不重启服务”。
- 仅允许将 `apps/web/public/baidu_verify_codeva-pzlt9i8WC9.html` 原样上传至 `tangwuyu.com` 的现有 Web 静态根目录；可执行必要的只读 SSH 检查与验证，不允许发布其他文件、改动配置、部署代码或重启服务。
- 上传前后核对容器 ID、启动时间、环境变量整体哈希及 JWT_SECRET 哈希；不得输出任何密钥原文。验证公网文件内容与本地一致且站点健康正常后，本次例外失效。
- 最终发布快照：`fb7a01c9823c1e1702e45814867d8bb4b941b14a`；生产镜像：`hgt:fb7a01c`；Android 版本号 100044。
- 发布前已通过 11 客户端同时收发模拟音频及踢人权限测试；生产语音字段、TRTC 连通、健康及 APP 更新结果验证通过。真实手机听感、弱网与后台切换仍需实机体验确认。
- 远端并行编译期间发生接口及 SSH 超时，终止构建后原服务恢复，未切换或重建原数据库容器；最终改用本机编译并校验镜像后加载到生产。JWT 哈希、Cookie 和挂载部署前后一致，保留旧容器用于回滚。

### 2026-09-17 语音心跳修复 Web/Server 全量部署一次性授权（不更新 APP）

- 状态：已于 2026-09-17 完成语音修复 Web/Server 全量部署与验证，现已失效。未更新 APP。
- 用户明确要求“全量部署，不更新 APP”。
- 实际发布范围：以生产 p0.45 快照 `45ba874de48c0c8ad3d8d56f07840a091fa9c1bc` 为基线，完整构建和部署 Web/Server，仅纳入语音心跳、成员列表及会话清理的跨排序规则关联查询修复和对应 MySQL 回归测试。不构建或上传 APK、不修改 APP 更新记录。
- 使用独立发布工作区，生产 JWT_SECRET 原样继承并显式注入，Cookie 配置、运行环境与挂载保持不变；通过本地检查、构建及生产认证门禁后才切换。
- 完成、失败或中止后授权失效，并记录结果。
- 发布提交：`d88e550e18e44333d516a08da3e42d0ff82d6e1a`，镜像 `hgt:d88e550`，容器 `5dbd96a3cd5532a22b4fbaef95124ef7c321d3458521f6d3f01f0bd0277aa538`。生产 JWT 哈希、Cookie、环境及挂载保持一致，所有 APP 更新记录哈希与发布前一致，p0.45 不提示升级。
- 本地检查、完整测试、全量构建和网页启动/权限门禁通过。部署后的独立验证进程使用连接私有临时表复制线上真实结构，建立会话 200、连续心跳三次 200、退出 200、撤销后心跳 403；未改持久业务数据。两个公网域名页面、健康、语音开关和 APP CORS 通过；新容器未再出现排序规则冲突日志。真实手机通话听感仍须用户重连体验。
- 附带检查发现百度验证文件在 p0.45 及其回滚容器已缺失；本地已准备包含该既有文件的候选 `1aa36902fe06c59267b390b77d8c713a29ac55f7`，但追加部署被自动审批拒绝，理由为前一次全量部署已完成、授权失效。该候选未发布，不得绕过或沿用本次授权，需用户再次明确授权全量部署。
