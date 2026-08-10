---
name: hgt-app
description: 加载 HGT 海龟汤 APP（uni-app x + Vue 3 + UTS + .uvue）的完整技术栈上下文、阶段规则、必读文档清单和工作模板。用于任何涉及 apps/app 目录的实施、修改、审查或调试任务，包括但不限于：新增/修改页面、业务组件、service、store、DTO、原生能力（Cookie/WebSocket/Storage/Canvas/list-view/waterflow）、tabBar 与导航、玩汤房间、圈子聊天、私信、消息中心、消息横幅、未读、未读 @、徽章、等级、贝壳、礼物、抽卡、雷达图、海龟汤分享卡片、表情包键盘。在用户提到「HGT APP」「海龟汤 APP」「uni-app x」「.uvue」「UTS」或要求 apps/app 下做任何改动时立即加载。
---

# HGT APP 工作上下文

你正在 **HGT 海龟汤 APP**（`apps/app`）下工作。这是一个用 uni-app x 重写的 Android/iOS 原生客户端，不复用 React/Tailwind/Chart.js。运行 HBuilderX + 真机调试是验证基准。

## 1. 必读（动手前）

下列文件必须先读完再设计、修改或审查代码：

- `apps/app/CLAUDE.md` — 本目录的硬约束（边界、阶段规则、检查项）
- `docs/uni-app-x_APP技术方案.md` — 架构、目录、依赖方向、分期计划、风险
- `docs/前端交互与展示统一规范.md` — 跨页面交互与展示唯一规则来源（涉及聊天/表情包/圈子/私信/玩汤房间/@用户/未读/消息横幅/徽章/在线状态/等级/贝壳/抽卡/收藏柜/分享卡片时必读）
- 涉及具体阶段的细节：`docs/P0兼容性验证清单.md`、`docs/自动化回归测试.md`、`docs/Android应用内更新说明.md`、`docs/Android本地打包说明.md`
- `AGENTS.md`（项目根）— 永久线上部署禁令 + 生产认证永久规则，任何尝试部署/改 .env/改生产 JWT/Cookie 的动作都禁止

## 2. 当前阶段速查

`apps/app/CLAUDE.md` 已声明 P0–P3 范围。速记：

- **P0 技术 Spike**（保留在 `pages/index`、`pages/platform-probe`，不再叠加业务）
- **P1 第一段**：首页、搜索、分页、详情、图片、启动会话恢复（已交付）
- **P1 第二段**：五栏导航、登录注册、会话联动、我的（玩汤/圈子/消息只占位）
- **P1 第三段**：详情页点赞/收藏 + 我的收藏/我的点赞
- **P2**：账号与内容互动、创建/编辑、通知、上传
- **P3**：消息、圈子、实时、未读、表情键盘、撤回
- **P4**：玩汤大厅/房间、排行、任务、徽章、商城、收藏柜、海报、推送

接到任务时先判断落在哪个阶段，按阶段门禁推进。

## 3. 技术栈速查

| 层 | 选型 |
|---|---|
| UI 框架 | uni-app x + Vue 3（页面/组件用 `.uvue`） |
| 业务语言 | UTS 强类型 |
| 渲染 | Android/iOS 原生（**不是 WebView**） |
| 网络 | `uni.request` / `uni.uploadFile`（在 `services/api-client.uts` 统一包装） |
| 实时 | `uni.connectSocket` + `SocketTask`（在 `services/socket-manager.uts` 统一管理） |
| 存储 | `uni.*Storage*`（敏感凭证禁存；JWT 由 httpOnly Cookie 持有） |
| 长列表 | `list-view`（`scrolltolower` 触底） |
| 瀑布流 | `waterflow`（首页用，不满足时降级双列分组） |
| 图表 | 原生 `canvas` 2D（自绘六维雷达图，不引 Chart.js） |
| 海报 | `takeSnapshot` / canvas（不引 html-to-image） |
| 路由 | `pages.json` + `uni.navigateTo/switchTab` |
| 状态 | Vue 响应式（不用第三方 store 库；`stores/session.uts` 等是手写 reactive） |
| 调试/构建 | HBuilderX + HBuilderX CLI；**真机**为主 |
| 服务端地址 | `config/runtime.uts` 统一读取（模拟器/真机/生产自动分流），页面不得提供生产地址输入框 |

DTO 类型：优先复用 `packages/shared`（P0 已验证）；不能稳定复用时在 `apps/app/domain/dto` 建 UTS 镜像，用服务端 OpenAPI/fixture 防漂移。

## 4. 依赖方向（强制）

```
pages → components → stores/use-cases → services/domain
```

页面**不得**：
- 直接拼请求 URL
- 直接管长期 SocketTask
- 直接读写认证凭证
- 复制跨页面业务规则（统一交互规范里有的，禁止在页面里另写一遍）
- 提供生产地址输入框
- 把登录/注册响应里的 token 写进 Storage

`uni_modules` 插件必须记录用途、Android/iOS 支持情况、降级方案。

## 5. 工作流程

接到任务后按下列顺序：

1. **判断阶段**：属于 P0–P5 哪一段？是否在当前允许范围内？
2. **读文档**：根据第 1 节必读清单执行
3. **查现状**：用 Grep/Glob/Read 看 `pages/`、`components/`、`stores/`、`services/`、`domain/` 已有结构，避免重复造轮子
4. **设计**：先讲清依赖方向、是否新建文件、命名（kebab-case 目录 / PascalCase 类型组件）
5. **实施**：按 `apps/app/CLAUDE.md` 阶段规则和本项目 `AGENTS.md` 永久禁令执行
6. **检查**：HBuilderX Android 编译 + iOS 编译 + `git diff --check` + 真机跑 `docs/P0兼容性验证清单.md` 相关项
7. **汇报**：列出改了什么文件、为什么这么改、未做项与原因

## 6. 提示词模板

不要每次重新写上下文，直接复制 `.claude/HGT-APP-PROMPT.md` 里对应的模板：
- 新建页面 / 新建业务组件 / 新建 service / 新建 store / 修改既有代码 / 修 bug / 评审

## 7. 常见陷阱（一眼看错就翻车）

- 把 React/Tailwind 写法照搬进 `.uvue`（原生 CSS 只支持 Web 子集）
- 用 `localStorage` 类 API 存 JWT / Cookie / 密码
- 把图表用 Chart.js 或 webview 渲染
- 在页面里手写 `EquippedBadgeIcon` 同款徽章名称样式（违反统一规范 §4）
- 表情包键盘做成弹窗/抽屉/fixed 浮层覆盖消息列表（违反统一规范 §3.2）
- 玩汤房间讨论、提问、主持人发言气泡用同一种颜色（违反统一规范 §8.23）
- 在 `apps/app` 下设计/修改时不读 `docs/前端交互与展示统一规范.md`
- 没真机验证就宣布功能完成
- 凭个人偏好另起一套视觉，而不是对齐 H5 移动端（CLAUDE.md 阶段规则明确禁止）