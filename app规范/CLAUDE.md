# HGT APP 开发规则

本目录是 HGT 的 uni-app x Android/iOS 客户端。技术方案以 `../../docs/uni-app-x_APP技术方案.md` 为准，跨页面交互以 `../../docs/前端交互与展示统一规范.md` 为唯一规则来源。

## 技术边界

- 使用 uni-app x、Vue 3、UTS 和 `.uvue`。
- 首期只支持 Android 与 iOS，不为 Web、小程序或 HarmonyOS 提前增加分支。
- 复用现有服务端 API 与 WebSocket 语义，不复用 React、JSX、Tailwind、DOM 组件。
- 原生界面只使用 uni-app x App 支持的 CSS 子集：Flex/绝对定位、class 选择器、显式文字样式。
- 页面不得直接拼接业务 API、管理长期 SocketTask、读写认证凭证或复制跨页面业务规则。

## 目录约定

```text
pages/       页面，仅负责组装与页面状态
components/  base、business、chat 共享组件
stores/      session、entities、unread、realtime 状态
services/    HTTP、认证、WebSocket、上传、缓存
domain/      DTO、错误和常量，不依赖 UI
styles/      APP 视觉 token 与全局样式
static/      本地静态资源
tests/       自动化与契约测试
```

- 页面和路由目录使用 kebab-case。
- UTS 类型、类和组件使用 PascalCase。
- 网络、Storage 和 WebSocket 回调必须在 service 中统一封装。
- `uni_modules` 插件必须记录用途、Android/iOS 支持情况和降级方案。
- 普通 Storage 不得保存 JWT、Cookie、密码或其他长期认证凭证。

## 阶段规则

- 所有新开发的正式页面和共享业务组件，动手前必须先检查对应 H5 移动端页面、组件与样式实现。
- APP 与 H5 的视觉对齐至少覆盖信息层级、布局、间距、圆角、颜色、图标、空/加载/错误状态、按压反馈和页面切换后的状态表现。
- 仅当原生能力限制或 APP 产品形态确有差异时允许偏离 H5；偏离项必须在实施记录中写明原因，禁止凭个人偏好另起一套视觉。
- P0 技术 Spike 保留在 `pages/index` 与 `pages/platform-probe`，不继续叠加正式业务。
- 正式业务从 P1 独立页面、组件、store、service 和 DTO 开始，禁止从探针复制临时状态或测试账号。
- P1 第一段已交付只读主链路：首页、搜索、分页、海龟汤详情、图片和启动会话恢复。
- P1 第二段建立正式五栏导航、登录注册、会话联动和“我的”；玩汤、圈子、消息只允许明确占位，不提前实现业务。
- P1 第三段完成详情页点赞/收藏和“我的收藏 / 我的点赞”列表；互动请求必须防重复提交，未登录统一进入账号页。
- 登录/注册表单不得持久化密码或服务端返回的 token；只依赖 httpOnly Cookie，会话成功后立即清空密码字段。
- 首页与详情必须使用共享 `SoupCard`、请求层和 DTO 映射，不得在页面中直接解析任意 JSON。
- 正式页面的服务端地址由统一运行配置提供；本地调试默认 `http://127.0.0.1:4000`，页面不得提供生产地址输入框。
- Android/iOS 必须分别记录编译和真机结果，不得用 Web 结果代替。
- Cookie、WebSocket Cookie、重启恢复、前后台切换和网络切换未真机通过前，状态保持 No-Go。
- 不修改生产认证规则、数据库 schema、`.env`、CI/CD 或线上环境。

## 最低检查

- HBuilderX Android 编译通过。
- HBuilderX iOS 编译通过。
- `git diff --check` 通过。
- 真机执行 `docs/P0兼容性验证清单.md` 并保留结果。

## 技术栈速查（速记）

详细见 `docs/uni-app-x_APP技术方案.md`，跨页面规则见 `docs/前端交互与展示统一规范.md`。本节只列速记要点。

- **栈**：uni-app x + Vue 3 + UTS + `.uvue`，Android/iOS 原生（非 WebView）
- **网络**：`uni.request` 在 `services/api-client.uts` 统一包装；401 → `uni.$emit('hgt-session-expired')`
- **实时**：`uni.connectSocket` + `SocketTask`，由 `services/socket-manager.uts` 统一管理，禁止页面直管
- **存储**：`uni.*Storage*`，敏感凭证禁存；JWT 由 httpOnly Cookie 持有
- **列表**：`list-view`（`scrolltolower`）/ `waterflow`（首页）
- **图表/海报**：原生 `canvas` 2D（不引 Chart.js / html-to-image）
- **路由**：`pages.json` + `uni.navigateTo/switchTab`
- **状态**：Vue 响应式（不引第三方状态库）
- **服务地址**：`config/runtime.uts` 统一读取；页面不得提供生产地址输入框
- **DTO**：优先 `packages/shared`，不能稳定复用时在 `apps/app/domain/dto` 建 UTS 镜像

## 配套工具

- 提示词模板：`apps/app/.claude/HGT-APP-PROMPT.md`（新建页面 / 组件 / service / store / 改既有代码 / 修 bug / 评审 等可直接复制）
- 工作 skill：`apps/app/.claude/skills/hgt-app/SKILL.md`（HGT APP 下任何任务前用 `/hgt-app` 加载完整上下文）
