# AGENTS.md

### 2026-09-20 卡牌编辑保存修复 Web/Server 全量部署一次性授权

- 状态：用户在当前任务明确要求“全量部署web server”，本次授权执行中。
- 以生产提交 5d80d4cc2a5cb1ad7e967e9913b3ed969662528c 为基线，仅纳入复制零星技能生成独立 ID、服务端兼容重复技能 ID 及对应回归测试；完整部署 Web/Server，不更新 Android APP。
- 独立快照完成检查、测试和构建，镜像本地构建；生产 JWT 原样继承并显式注入，Cookie、全部既有环境和挂载保持不变。
- 发布后核对两域名实际引用资源与镜像哈希、服务端修复文件及健康/CORS；完成、失败或中止后授权失效，记录最终结果。


### 2026-09-18 卡牌实测修复 Web/Server 全量部署一次性授权

- 状态：执行中。用户明确要求“全量部署一次，确保这个被部署上去”，沿用本任务 Web/Server 范围，不更新 APP。
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
