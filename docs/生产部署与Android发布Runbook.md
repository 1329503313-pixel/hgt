# 生产部署与 Android 发布 Runbook

本文记录 HGT 的完整 Web/Server 全量部署、Android APK 构建上传和应用内更新记录发布流程。目标是让一次正常发布只有一次定稿、一次 APK 构建、一次生产镜像构建和一次线上切换，同时保持登录状态与认证配置不变。

## 1. 授权与不可变安全规则

1. 只有用户在当前任务明确说出“全量部署”，才能执行 SSH/SCP、生产 Docker 变更、APK 上传和更新记录发布；该授权任务结束即失效。
2. 生产 `JWT_SECRET` 永久沿用。禁止生成、轮换、输出、写入命令日志、源码、文档、构建产物或 Git。
3. 新容器必须从当前容器继承完整环境，并额外通过 `-e JWT_SECRET` 显式注入现有值。部署前后只比较 SHA-256，不比较或输出原文。
4. Cookie 必须保持 `hgt_token`；为了不踢掉迁移期用户，同时兼容读取 `hgt_session`。属性保持 `httpOnly=true`、`sameSite=lax`、`secure=false`、`domain=.caqis.com`、`path=/`、30 天有效期。
5. Android 正式包必须保持 `applicationId=com.caqis.hgt` 和既有签名证书。每个公开 APK 的 `versionCode` 必须严格递增；替换 APK 文件或 Git 提交但不递增 `versionCode`，旧客户端不会弹出更新，Android 也不能可靠覆盖安装。
6. `.env`、签名文件、OSS 密钥、管理员凭据和 APK 都不得进入 Git 或生产源码包。

## 2. 标准耗时预算

以下为 2026-08-13 实测基线，不含网络异常：

| 阶段 | 实测/目标 | 说明 |
|---|---:|---|
| 类型检查 | 约 35 秒 | Server + Web + 图片/PWA 契约 |
| 服务端测试（数量以当前测试输出为准） | 约 8–15 秒 | 必须全部通过，不在 Runbook 固定用例数 |
| Web/Server 全量本地构建 | 约 26 秒 | 验证生产编译 |
| Android Release 冷构建 | 约 98–120 秒 | 包含 Android Web、契约、原生单测、签名 |
| 已有同提交 APK 复核 | 数秒 | prepare 脚本自动复用 |
| 生产镜像冷构建 | 约 100 秒 | 有 npm/Docker 缓存时应明显缩短 |
| 优化后本地 Docker 冷/热构建 | 32.1 秒 / 1.6 秒 | BuildKit npm 缓存与分层全命中 |
| 容器候选验证与切换 | 约 30–60 秒 | 失败自动回滚 |

正常热缓存全量部署应控制在 5–8 分钟。超过 10 分钟先判断是网络/依赖缓存失效还是发生了重复构建，不要盲目重跑整条链路。

## 3. 发布前定稿

### 3.1 审计工作区

```powershell
git status --short --branch
git diff --check
git diff --stat
```

- 明确所有受版本控制差异；不得把未跟踪的用户文件带入发布。
- Android Release 的准备脚本和底层构建脚本都会检查包含未跟踪文件在内的完整工作区；任一差异存在时必须中止，不得让工作区外内容进入绑定 Git 提交的 APK。
- APP 业务源是 `apps/web`，Android 套壳是 `apps/app-android`；禁止修改历史目录 `apps/app`。
- 先确定发布说明，再改版本，再提交。不要先构建 APK 后为了版本/文档再提交，否则 APK 文件名中的提交号会过期并导致第二次完整构建。

### 3.2 Android 版本

同时更新：

- `apps/app-android/release/version.json`
- `apps/app-android/package.json`
- `package-lock.json` 中 `apps/app-android` 的版本

`release/version.json` 是打包真源。新 `versionCode` 必须大于线上最高版本。

### 3.3 先提交再构建

```powershell
git add -- <精确文件列表>
git diff --cached --check
git commit -m "release: prepare <version>"
```

APK 和生产镜像都绑定这个提交。授权状态的“已完成并失效”可在全部线上验证后单独提交，不需要重新构建 APK。

一旦生成 Release APK，禁止再提交任何源码、构建脚本或发布脚本后继续上传旧 APK。若 APK 生成后发现流程脚本问题，必须先修复并提交，再重新运行 `release:android:prepare`；上传器会强制校验 `release-manifest.json.gitCommit` 与当前 `HEAD` 完全一致。

## 4. 本地质量门禁

```powershell
npm run check
npm test
npm run build:all
```

全部成功才继续。出现 TypeScript、测试、签名、权限或 Android 契约错误必须停止。

根级 `npm run check` 已包含 `release:check:tooling`，会固定检查总发布入口、必要阶段、APK 与提交绑定、生产认证预检、远程脚本 LF 行尾，以及关键 Android 发布脚本不得重新依赖 `Get-FileHash`。

## 5. 唯一标准全量发布入口

正常的 Web + Server + Android 全量发布只使用这一条命令：

```powershell
npm run release:full -- -ReleaseNotes artifacts/android/<version>/release-notes.txt -ConfirmFullDeployment
```

执行前必须已经完成版本号、更新说明、代码和发布脚本的最终提交，且工作区完全干净。该入口按固定顺序执行：

1. 校验工作区、当前提交、更新说明和线上最高 `versionCode`；
2. 类型/契约检查、服务端测试、Web/Server 全量构建、认证源码契约；
3. Android Release 构建或同提交复用、原生测试、验签；
4. APK 上传，并从公网重新下载校验大小与 SHA-256；
5. 生成 Android 更新描述文件；
6. 运行版本化生产认证预检，再部署 Web/Server；
7. 发布非强制 Android 更新记录，并验证旧版可更新、当前版不更新、版本/URL/更新说明完全一致；
8. 输出统一的提交、Android 版本和强制更新状态摘要。

下文的分步命令用于理解、诊断和失败后的幂等恢复，不作为正常发布时的人工操作清单。不得跳过总入口中的门禁，也不得手工拼接 SSH Bash 片段替代版本化脚本。

## 6. Android APK：只构建一次

### 6.1 构建与验签

```powershell
npm run release:android:prepare
```

该命令要求工作区已提交，默认读取受忽略的 `.local/android-signing/signing.properties`。若 manifest 与当前提交、版本和 APK 完全一致则直接复用并验签，否则只执行一次完整 Release 构建。它验证包名、版本、证书 SHA-256、权限和 APK SHA-256。

所有发布路径统一使用 `scripts/release/file-hash.ps1` 中基于 .NET 的 SHA-256 实现，不依赖 `Get-FileHash` 的模块自动加载状态。Android SDK 的 `.bat` 工具执行前后都必须得到相同结果。

只有确实需要重新产生相同提交的二进制时才用：

```powershell
./scripts/release/prepare-android-release.ps1 -ForceRebuild
```

### 6.2 上传 OSS

```powershell
npm run app:android:upload -- --confirm-upload
```

固定配置：Bucket `zgkc-storage`，Endpoint `https://oss-cn-beijing.aliyuncs.com`，Region `cn-beijing`，对象路径 `hgt/apps/<versionName>/<apk-file-name>`。

凭据按环境变量/`*_FILE` 读取，也可放在受忽略文件：

- `.local/oss-access-key-id.txt`
- `.local/oss-access-key-secret.txt`

上传脚本会再次验签、禁止覆盖同名对象，并把 `apkUrl` 写回 `release-manifest.json`。错误输出经过脱敏，不打印 ali-oss 完整错误对象。

上传前还会强制检查：工作区完全干净、manifest 提交等于当前 `HEAD`、本地 APK 大小和 SHA-256 与 manifest 一致。正常发布不要单独手敲上传命令，由 `release:full` 自动带上 `--confirm-upload`，避免遗漏确认参数。

### 6.3 公网 APK 验证

从 `apkUrl` 下载临时副本并比较 manifest 的 SHA-256，同时检查 HTTP 200 和文件大小；临时副本验证后删除。不要只做 HEAD 请求。

## 7. Web/Server 生产部署

### 7.1 生产白名单包

```powershell
npm run release:production:bundle
```

脚本使用 `git archive` 只包含 Dockerfile 真正使用的 Web/Server 文件，不包含 Android 工程、历史 `apps/app`、设计源文件、文档、`.env`、`.local`、签名材料或构建产物。输出位于 `artifacts/deploy/`。

2026-08-13 的未筛选 tar 约 80MB，主要被 Android 启动画面、历史客户端与设计图片放大；白名单 `tar.gz` 实测约 20.7MB，缩小约 74%。生产镜像不需要这些文件。

### 7.2 一键旁路构建与切换

仅在当次已有“全量部署”授权时执行：

```powershell
npm run release:production:deploy -- -ConfirmFullDeployment
```

流程：

1. 要求包含未跟踪文件在内的完整工作区干净，并运行认证源码契约；
2. 上传版本化 `production-preflight.sh`，只读核验当前容器运行状态、持久化 JWT 与容器 JWT 哈希相同、Cookie 环境正确；预检失败时不上传应用包；
3. 创建并上传白名单 `tar.gz` 到 `/opt/hgt-releases/incoming/`，服务端校验 SHA-256；
4. 锁定当前容器 ID，防止审计后线上状态被其他操作改变；
5. 旁路构建 `hgt:<shortCommit>` 并审计镜像无 `.env`；
6. 从当前容器继承完整环境与全部命名卷/绑定挂载，JWT 原文仅保留在远端进程内，用 `-e JWT_SECRET` 注入；候选与正式容器的规范化挂载清单必须和旧容器完全一致；
7. 在 `127.0.0.1:4001` 以 `RELEASE_CANDIDATE=true` 启动只读候选，不运行迁移、清理、奖励结算、AI 恢复或定时任务，然后验证健康和环境整体哈希；
8. 旧容器改名为 `hgt-app-rollback-<shortCommit>`，新容器接管 4000；
9. 再次验证环境/JWT 哈希与 Cookie；任何一步失败自动恢复旧容器。

生产脚本是仓库中的 LF 文件，不要在 PowerShell 字符串里拼大段 Bash。尤其禁止用双引号 PowerShell 参数传递含 `$()`、`$变量`、`{{ }}` 的远程审计命令；生产预检和部署必须分别使用版本化的 `production-preflight.sh` 与 `production-deploy.sh`。

候选与正式容器启动轮询会静默处理预期内的连接重置；只有达到重试上限才输出容器日志并失败，避免把正常冷启动噪声误判为部署故障。

### 7.3 最终只读检查

必须验证正式首页和健康接口 200、Android CORS 正确、当前镜像/提交正确、日志无致命错误、JWT/环境哈希不变、Cookie 源码契约不变。保留停止状态的上一个容器作为短期回滚点，稳定观察后再单独授权清理。

## 8. 发布 Android 更新记录

### 8.1 更新说明与描述文件

准备受忽略的纯文本文件，每行一条说明：

```powershell
npm run release:android:descriptor -- --notes artifacts/android/<version>/release-notes.txt
```

生成 `android-release.json`，默认最低支持版本 `0`、启用、非强制，APK URL/SHA 来自已上传且验签的 manifest。

### 8.2 幂等发布

仅在当次已有“全量部署”授权时执行：

```powershell
npm run release:android:publish -- -Descriptor artifacts/android/<version>/android-release.json -ConfirmFullDeployment
```

包装脚本把发布器与描述文件临时复制进正式容器，使用容器现有管理员配置登录自身 API；JWT/密码不离开容器，临时文件始终清理。发布器只走现有管理 API；同版本同内容视为幂等成功，同版本不同内容失败；新增前后比较其他全部记录；发布后自动验证旧版本可更新且非强制、当前版本不更新。

更新检查接口的发布信息是顶层字段：`latestVersionCode`、`latestVersionName`、`apkUrl`、`releaseNotes`、`updateAvailable`、`forceUpdate`，不存在 `release.versionCode` 这类嵌套结构。标准发布器会直接校验这些字段并输出摘要，不再另写临时人工解析命令。

不要依赖浏览器会话或本机 `.env` 的管理员初始密码：浏览器可能被本机策略阻止，初始密码也可能早已被修改。

## 9. 踩坑复盘与已固化预防

| 踩坑 | 根因 | 固化措施 |
|---|---|---|
| APK 构建两次 | 第一次构建后才提交，文件名仍是旧提交号 | 先定稿提交；prepare 按提交复用产物 |
| p0.8 新 APK 不弹更新 | APK 变了但 `versionCode` 仍为 100008 | 每个公开 APK 严格递增 versionCode |
| 80MB Git tar 上传慢 | 未筛选归档包含 Android/设计/历史文件 | 白名单 tar.gz，仅含 Docker 上下文 |
| Docker 重装依赖慢 | 两阶段各自 npm ci，缓存失效时约 37 秒 × 2 | BuildKit npm cache；依赖不变命中层缓存 |
| OSS 两次失败 | 凭据来源和北京地域未固化 | 固化 Bucket endpoint/region 与凭据文件位置 |
| OSS 错误输出过多 | ali-oss 错误含签名请求上下文 | 只输出 status/code/requestId |
| SSH 审计/清理失败 | PowerShell 展开、Bash 引号、CRLF | 版本化 LF shell 脚本，通过 SCP 执行 |
| 更新记录发布绕路 | 没有固定发布器 | 容器内幂等 API 发布器 |
| README 指示生成新 JWT | 旧文档与永久规则冲突 | README 引用本 Runbook，禁止生产轮换 JWT |
| Cookie 名称与永久规则不一致 | 迁移代码把 `hgt_session` 设为了新主名 | 新写入回归 `hgt_token`，保留 `hgt_session` 读取兼容，构建门禁固定检查 |
| 旁路候选会写库 | 服务启动即执行迁移、清理和结算任务 | `RELEASE_CANDIDATE=true` 只做 DB 连通与 HTTP/静态资源验证 |
| APK 验签后哈希命令消失 | Android SDK 批处理工具执行后 PowerShell 模块自动加载不可靠，单纯 `Import-Module` 仍可能失效 | 发布构建、复用和验签统一调用基于 .NET 的 `Get-HgtFileSha256` |
| 上传首次漏传确认参数 | 分步人工执行时遗漏 `--confirm-upload` | 正常发布只运行 `release:full`，由总入口固定传参 |
| APK 与最终部署提交不一致 | APK 构建后又修复并提交发布脚本，但上传器未绑定当前 HEAD | 上传前强制验证干净工作区和 `manifest.gitCommit === HEAD`；任何后续提交都必须重新 prepare |
| 生产认证预检命令本地展开 | PowerShell 双引号提前执行了远端 Bash 的 `$()` | 使用版本化 LF `production-preflight.sh`，禁止临时拼接远端 Shell |
| 正常冷启动显示大量连接重置 | 健康轮询把预期失败写到 stderr | 轮询静默重试，达到上限才输出日志并回滚 |
| 人工读取更新接口得到空版本 | 错把顶层响应当作 `release` 嵌套对象 | 发布器固定校验顶层字段并输出版本、URL、说明匹配结果 |

### 9.1 失败恢复边界

| 失败阶段 | 线上影响 | 恢复方式 |
|---|---|---|
| 本地检查 / Android prepare | 无 | 修复并提交后从 `release:full` 重新开始 |
| APK 上传前校验 | 无 | 不得绕过；确保 manifest 与 HEAD 一致后重新 prepare |
| APK 已上传、Web/Server 未部署 | 仅新增不可变 APK 对象，无客户端可见记录 | 修复后复用同提交产物，重跑总入口 |
| Web/Server 候选或切换失败 | 自动回滚旧容器，不发布 Android 记录 | 查看脚本最后错误与容器日志，修复后重跑 |
| Web/Server 成功、Android 记录发布失败 | 新 Web/Server 已在线，APK 已上传，但客户端无新提示 | 不回滚健康服务；修复发布问题后幂等重跑发布步骤或总入口 |
| Android 记录已发布、最终验证失败 | 更新可能已对客户端可见 | 立即停止，不猜测修改记录；先只读核对公开接口，再根据明确授权处理 |

## 10. 进一步优化

1. 使用受信任私有镜像仓库，在 CI 构建后让服务器只 `docker pull`，预计再省 1–2 分钟。
2. 生成 SBOM/镜像签名，把提交、镜像 digest、APK SHA 和证书指纹关联为发布证明。
3. 建立只允许 Android 发布 API 的专用服务账号，凭据使用只读 secret mount。
4. 增加生产 `flock` 发布锁，阻止两个部署并发切换。
5. 自动输出包含各阶段耗时的统一发布摘要。

在没有完成私有镜像仓库信任配置前，不要为了提速把源码或镜像推送到未经确认的第三方目的地。
