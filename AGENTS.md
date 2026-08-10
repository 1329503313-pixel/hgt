# AGENTS.md

海龟汤 (HGT) 评价管理系统 — 全栈 monorepo

## 线上部署禁令（永久）

- 禁止将本项目或任何修改部署、发布、同步到线上环境。
- 禁止执行生产服务器的 SCP、SSH、rsync、Docker 发布、云平台部署、线上数据库迁移、服务重启或其他会改变线上状态的操作。
- 仅允许在本地工作区进行代码修改、类型检查、测试、本地构建和本地预览。
- 即使任务要求“完成”“上线”或“发布”，也必须停在本地验证完成的状态，不得执行线上部署。
- 只有用户明确要求修改或删除本节永久禁令后，才可改变这一约束。

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
