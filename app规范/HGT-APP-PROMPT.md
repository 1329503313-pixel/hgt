# HGT APP 提示词模板

> 用法：把对应场景的整段 prompt 复制给 Claude（可加自己的具体需求）。模板只保证把项目上下文、约束和工作流注入，不替你写业务需求。

---

## 0. 通用前置（任意任务都先贴这一段）

```
你在 HGT 海龟汤 APP（apps/app）下工作。技术栈：uni-app x + Vue 3 + UTS + .uvue，Android/iOS 原生（不是 WebView）。

必读（动手前）：
- apps/app/CLAUDE.md（硬约束）
- docs/uni-app-x_APP技术方案.md
- docs/前端交互与展示统一规范.md（涉及聊天/表情包/圈子/私信/玩汤/未读/徽章/等级/贝壳/礼物/抽卡/分享卡片时必读）
- AGENTS.md（永久线上部署禁令 + 生产认证永久规则）

依赖方向：pages → components → stores/use-cases → services/domain。页面不得直拼 URL、不直管 SocketTask、不读写凭证、不复制跨页面规则。

类型命名：目录 kebab-case，UTS 类型与组件 PascalCase。DTO 优先 packages/shared，不能稳定复用时在 apps/app/domain/dto 建 UTS 镜像。

完成后必须汇报：改了哪些文件、为什么、未做项与原因。
```

---

## 1. 新建页面

```
[贴 §0 前置]

任务：在 apps/app 新建页面 <route-path>（例：pages/soup-detail/soup-detail）。

需求：
- 功能：<一句话说清这个页面做什么>
- 入口：<从哪里跳过来 / 是否 tabBar 入口>
- 状态：<loading / empty / error 怎么处理>
- 交互：<关键交互点，按统一交互规范引用节号，如"§8.21 提示漂浮"；不要凭偏好另写>

约束：
- pages.json 必须新增页面声明，tabBar 入口要写 list 项
- 页面内不直拼请求，统一走 services/api-client.uts 的 apiGet/apiPost/...
- 页面不直接管 SocketTask
- 必须使用 components/base 或 components/business 已有组件；缺新组件时另起任务
- 必须使用 domain/dto 已有类型，不在页面里临时解析 JSON
- 视觉对齐 H5 移动端（apps/web）对应页面；偏离 H5 时在实施记录里写明原因
- 安全区/软键盘/前后台切换需考虑

验收：
- HBuilderX Android 编译通过
- HBuilderX iOS 编译通过
- 真机跑过 docs/P0兼容性验证清单.md 相关项
- git diff --check 通过
```

---

## 2. 新建业务组件

```
[贴 §0 前置]

任务：在 apps/app/components/business 新建组件 <Name>.uvue（共享业务组件）。

需求：
- 用途：<业务场景>
- 输入 prop：<类型>
- 事件 emit：<类型>
- 视觉：<颜色/尺寸/间距引用 styles/tokens.css token 名，不引 DOM 概念>

约束：
- 不引 React 写法
- 不复用 Tailwind class
- 原生 CSS 子集（Flex + class 选择器 + 显式文字样式）
- 涉及徽章/等级/在线状态时统一引用统一交互规范 §4、§7、§16
- 涉及头像/昵称行时按 §4.3 不可拆分的 shrink-0 单元

验收：
- 真机 Android/iOS 表现一致
- 在引用它的至少一个页面跑通
- 组件卸载释放定时器/请求/SocketTask/canvas/媒体
```

---

## 3. 新建 service

```
[贴 §0 前置]

任务：在 apps/app/services 新建 <name>.uts。

需求：
- 对应服务端接口：<HTTP 路径 / WebSocket 事件>
- 入参：<DTO>
- 出参：<DTO>
- 错误：<枚举>

约束：
- 必须用 services/api-client.uts 已有的 apiGet/apiPost/apiPatch/apiPut 包装，禁止直接调 uni.request
- 401 必须触发 uni.$emit('hgt-session-expired')
- 不在日志里记录密码/token/Cookie/聊天敏感正文（统一交互规范 §8.18）
- WebSocket 走 SocketManager，禁止页面直管 SocketTask
- 错误映射参考已有 services/*.uts 的风格
- 上传/下载走 services/upload.uts，禁止页面层直写上传逻辑
```

---

## 4. 新建 store

```
[贴 §0 前置]

任务：在 apps/app/stores 新建 <name>.uts。

需求：
- 职责：<说明>
- 持久化范围：<哪些字段走 Storage / 仅内存>
- 清理时机：<登出 / 切账号 / 前后台>

约束：
- 用 Vue reactive（不引第三方状态库）
- session/entities/unread/realtime 已有同类时优先合并/扩展
- 缓存必须带版本、userId、过期时间；登出后清理用户级缓存
- 不伪造成功状态；服务端是权限/余额/未读/进度的最终真源
- 回到前台立即执行会话校验、未读对账、活动连接补拉
```

---

## 5. 修改 / 重构既有代码

```
[贴 §0 前置]

任务：<一段话说明改什么 + 为什么>

改动范围：
- 文件：<路径>
- 行为变化：<before → after>

约束：
- 先 Grep/Read 把所有引用点找全
- 不引入新依赖，除非必要且在 §0 提过
- 不破坏现有依赖方向
- 命名规范不变（kebab-case 目录 / PascalCase 类型）
- 涉及跨页面规则时同步更新 docs/前端交互与展示统一规范.md（不创建平行规范）
- 不动生产认证、数据库 schema、.env、CI/CD、线上环境

自测：
- npm run check / 项目对应类型检查命令
- HBuilderX 双端编译通过
- 真机过受影响主链路
- git diff --check
```

---

## 6. 修 bug

```
[贴 §0 前置]

Bug：<一句话描述>

复现步骤：
1.
2.
3.

期望：<一段话>
实际：<一段话>
设备/系统：<Android 版本 / iOS 版本 / 真机型号>
HBuilderX 版本：<必填>

排查思路：
- 是否在统一交互规范相关节？
- 是否在 P0 兼容性验证清单相关项？
- 是否为 uni_modules 插件的平台差异？
- 是否前后台/网络切换/真机弱网相关？

约束：
- 不为修一个 bug 大改架构
- 不为绕过问题引入新依赖
- 修完在 issue/注释里写明根因 + 复现条件
- 必须真机复现 + 真机回归
```

---

## 7. 评审（Review）

```
[贴 §0 前置]

请评审 apps/app 下这次改动：
- diff 范围：<文件清单>
- 预期目的：<一段话>

评审维度（按顺序）：
1. 是否违反 CLAUDE.md 阶段规则
2. 是否违反统一交互规范（涉及聊天/表情/圈子/私信/玩汤/未读/徽章/等级/贝壳/礼物/抽卡/分享卡片时）
3. 是否破坏依赖方向（pages → components → stores/use-cases → services/domain）
4. 是否在页面里手写跨页面规则（统一规范有的话必须复用）
5. 是否引入未声明的新依赖 / uni_modules
6. 是否提供生产地址输入框（违规）
7. 是否有未清理的定时器/SocketTask/canvas/媒体
8. 是否在 H5 移动端基础上做了无依据偏离
9. 是否影响 P0 兼容性验证清单相关项
10. 是否考虑安全区/软键盘/前后台切换/网络切换

输出：每项给出 PASS / FAIL + 证据（文件:行号），FAIL 项给出修复建议。
```

---

## 8. 性能与稳定性自检清单（实施完任何一项后过一遍）

- [ ] 首页/消息/圈子用 list-view 或 waterflow，不一次渲染全量
- [ ] 图片按显示尺寸请求缩略图
- [ ] 动态卡面仅在可见时播放，退后台立即暂停
- [ ] 组件卸载时释放定时器 / 请求 / SocketTask / canvas / 媒体
- [ ] 不预取商城视频、全部表情或历史聊天
- [ ] 聊天历史按游标分页加载，每页不超过既定上限
- [ ] 低端 Android 真机跑过
- [ ] Wi-Fi / 蜂窝 / 断网恢复 / 弱网 / 前后台切换都过

---

## 9. 必读文档路径速查

| 文件 | 何时读 |
|---|---|
| `apps/app/CLAUDE.md` | 任何 apps/app 下任务 |
| `docs/uni-app-x_APP技术方案.md` | 任何架构/目录/分期/选型相关 |
| `docs/前端交互与展示统一规范.md` | 涉及 §1 列出的任一交互/展示场景 |
| `docs/P0兼容性验证清单.md` | 真机验收 |
| `docs/自动化回归测试.md` | 提交自动化用例 |
| `docs/Android应用内更新说明.md` | Android 应用内更新逻辑 |
| `docs/Android本地打包说明.md` | Android 打包脚本/APK 上传 OSS |
| `AGENTS.md`（项目根） | 任何尝试部署/改生产认证/改 .env 的动作（永远禁止） |