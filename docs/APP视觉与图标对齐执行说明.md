# HGT 原生 APP 视觉、图标与头像对齐执行说明

> 历史快照提示：本文保留 2026-08-05 的四张真机截图审计结论，不再作为完整重建计划。新的用户端范围、Web→Android 全量功能/状态矩阵、阶段门禁和验收标准统一见 `docs/APP_Web用户端100%复刻对照矩阵与重建计划.md`。本文仍可用于追溯旧 App 的已知视觉问题，但不得用它缩减新矩阵范围。

## 1. 文档定位

这是一份可直接交给执行 Agent 的代码审计与实施清单，不是新的设计规范。跨页面规则仍以 `docs/前端交互与展示统一规范.md` 为唯一来源；基础尺寸与颜色参考 `mobile_ui_design_guide.md`，两者冲突时前者优先。

本说明基于 2026-08-05 的 Web 与 `apps/app` 源码，并针对四张真机截图中暴露的问题建立 Web 基准、App 偏差、修改位置和验收条件。不得部署或发布到线上；只允许本地修改、检查、构建和真机验证。

## 2. 执行结论

### 2.1 新 Android 壳的当前结论（2026-08-10）

新的 `apps/app-android` 不再复用本节所审计的旧 uni-app 页面，而是直接打包 Web 手机用户端的共享 `UserApp`。Launcher 图标从既有侦探海龟品牌图机械生成，启动页复用既有“汤汤解谜乐园”画面；Android 各密度资源及来源 SHA256 已纳入门禁。Lucide、头像、等级、徽章、底部导航和全部业务页面因此继续以 Web 实现为唯一真源，不再维护第二套近似组件。

本节后续关于旧 `apps/app` 的问题仍作为历史反例和真机验收索引；不得再把其中“新增旧 App 组件”的建议应用到新壳。

当前 App 的主要问题不是单个图标画错，而是缺少共享视觉层：

- Web 使用 `lucide-react@^0.475.0`；App 同时混用了自绘 PNG、文本符号、Emoji 和汉字占位。
- Web 的用户身份统一由真实头像、`LevelBadge`、`EquippedBadgeIcon` 组合；App 在不同页面分别手写，颜色、尺寸、回退策略不一致。
- 首页 `SoupCard.uvue` 已收到 `creatorAvatar`，但完全没有渲染它；详情页却能正常渲染同一作者头像，因此截图中同一用户首页显示“L”、详情显示真人头像。
- App 首页宣称可搜索“海龟汤或用户昵称”，实际只请求 `/api/soups`，没有调用 Web 已使用的 `/api/users/search`。
- App 评价编辑器使用原生 `slider`，真机截图中轨道和滑块不可见，只剩大段空白；Web 基准是共享 `ScoreInput` 数字输入。
- App 系统消息通过 `notificationSymbol()` 返回“盾、评、♥、★”文字，直接造成截图中的汉字圆标与字体差异。
- App TabBar 是“首页/玩汤/圈子/消息/我的”并另加悬浮创作按钮；Web 移动端基准是“首页/玩汤/创作/圈子/我的”，消息从顶部 `Bell` 进入。若产品决定保留原生消息 Tab，必须作为明确的 APP 例外记录，不能默认为视觉基准。

## 3. 规范与代码真源

| 内容 | 真源文件 | 执行要求 |
|---|---|---|
| 跨页面交互和展示 | `docs/前端交互与展示统一规范.md` | 必须完整阅读，优先级最高 |
| Web 色彩 token | `apps/web/tailwind.config.ts` | APP 颜色按同名语义复制，不另创色板 |
| Web 基础样式 | `apps/web/src/styles.css` | 卡片、返回、等级、徽章、头像间距的当前实现 |
| Web 图标依赖 | `apps/web/package.json` | `lucide-react@^0.475.0` |
| 移动底部导航 | `apps/web/src/components/BottomNav.tsx` | 导航语义、选中态和未读提示基准 |
| 移动顶部栏 | `apps/web/src/components/PageTopBar.tsx` | 用户头像、消息、后台入口基准 |
| PC 全宽导航 | `apps/web/src/components/DesktopModuleHeader.tsx` | 品牌、账户菜单和桌面图标语义 |
| 返回按钮 | `apps/web/src/components/UnifiedBackButton.tsx` | `ArrowLeft`、40px 高、移动端圆形 |
| 首页卡片 | `apps/web/src/components/SoupCard.tsx` | 封面、作者身份、标签和指标图标基准 |
| 详情页 | `apps/web/src/pages/DetailPage.tsx` | 作者头像、四项统计和交互按钮基准 |
| 评价卡 | `apps/web/src/components/EvaluationCard.tsx` | 评价者头像、等级、徽章、评分基准 |
| 评价编辑 | `apps/web/src/components/EvalEditor.tsx`、`FormWidgets.tsx` | 评分字段、范围、说明和提交状态基准 |
| 等级胶囊 | `apps/web/src/components/LevelBadge.tsx`、`styles.css` | Lv0–40 的全部颜色和动效 |
| 徽章 | `apps/web/src/components/BadgeVisuals.tsx` | 图片 URL、稀有度名称颜色、传说动效 |
| 消息分类和通知 | `apps/web/src/pages/MessagesPage.tsx`、`components/Lists.tsx` | 分类图标、通知图标和未读样式 |
| 聊天操作 | `apps/web/src/components/ChatComposerIconButton.tsx` | 44×44 点击区、tone、禁用和按压态 |
| 头像服务端处理 | `apps/server/src/index.ts` 的 `/api/me/avatar` | 256×256、cover、WebP quality 78 |
| App URL 解析 | `apps/app/config/runtime.uts` 的 `absoluteApiUrl()` | 所有非空相对头像/徽章 URL 必须先解析 |

## 4. 视觉 token 基准

### 4.1 颜色

| 语义 | 色值 |
|---|---|
| 页面背景 `page` | `#F5F7FA` |
| 卡片 `card` | `#FFFFFF` |
| 主色 `primary` | `#2563EB` |
| 辅助青色 `accent` | `#14B8A6` |
| 警告橙 `warning` | `#F97316` |
| 危险红 `danger` | `#DC2626` |
| 标题 `ink` | `#111827` |
| 正文 `body` | `#374151` |
| 次级 `muted` | `#6B7280` |
| 弱提示 `weak` | `#9CA3AF` |
| 边框 `line` | `#E5E7EB` |
| 柔和阴影 `shadow-soft` | `0 8px 24px rgba(17,24,39,0.06)` |

App 中出现的 `#121826`、`#344054`、`#667085`、`#98A2B3` 是近似色。P0 页面应优先收敛到上表，不再继续扩散近似 token。

### 4.2 尺寸与形态

- 页面左右间距：16px；普通页面顶栏后首块内容间距：12px。
- 普通点击区不得小于 44×44px；纯图标视觉尺寸通常为 18–24px。
- 普通按钮高度 44px，圆角 12px；大卡片圆角 16px；输入框高度 44px，圆角 12px。
- 海龟汤封面固定 16:9、裁切填充；当前 App `SoupCard` 用固定 92px 高度，应改为按卡片宽度计算 16:9。
- 用户头像为圆形并裁切填充；圈子头像为圆角方形；礼物、表情和需要保留完整主体的资源使用完整等比显示。
- 用户身份区域顺序：昵称 → 等级 → 徽章图标＋徽章名称。

## 5. 核心图标语义表

以下名称均为 Lucide 组件名，也是 App 静态资源应采用的语义名。Web 示例：

```tsx
import { Search, SlidersHorizontal, Flame, Sparkles, ThumbsUp, Star } from "lucide-react";

<Search size={20} />
<SlidersHorizontal size={19} />
<Flame size={14} className="fill-red-500" />
<Sparkles size={14} />
<ThumbsUp size={17} className={active ? "fill-current" : ""} />
<Star size={17} className={active ? "fill-current" : ""} />
```

App 不导入 React。应从相同 Lucide 图形导出资源，在一个共享组件/注册表中使用，例如：

```vue
<AppIcon name="search" :size="20" color="#2563EB" />
<AppIcon name="flame" :size="14" color="#EF4444" />
```

`AppIcon` 的内部实现可以使用集中维护的 PNG/SVG 路径，但业务页面不得再次写 `♥`、`♡`、`★`、`☆`、`✣`、`◉`、`▤`、`✎`、`⌕`、`☷`、`盾`、`评`、`信` 作为功能图标。

| 业务语义 | Lucide 名称 | Web 位置 | App 目标位置 |
|---|---|---|---|
| 首页 | `Home` | `BottomNav.tsx`、`DesktopModuleHeader.tsx` | TabBar 首页 |
| 玩汤 | `MessageCircleQuestion` | `BottomNav.tsx`、桌面导航、玩汤大厅 | TabBar/玩汤入口；替换 gamepad |
| 创作 | `Plus` | `BottomNav.tsx` 中心 26px | 中心创作入口 |
| 圈子 | `CircleEllipsis` | `BottomNav.tsx`、桌面导航 | TabBar；替换 Users 图形 |
| 我的 | `User` | `BottomNav.tsx` | TabBar 我的 |
| 消息 | `Bell` | `PageTopBar.tsx`、桌面导航 | 顶部消息入口、平台通知 |
| 搜索 | `Search` | `HomePage.tsx` 20px | `home.uvue`，替换 `⌕` |
| 筛选 | `SlidersHorizontal` | `HomePage.tsx` 19px | `home.uvue`，替换 `☷` |
| 返回 | `ArrowLeft` | `UnifiedBackButton.tsx` 18px | `AppBackButton.uvue` |
| 浏览 | `Eye` | `DetailPage.tsx` 17px | `soup-detail.uvue`，替换 `◉` |
| 热力 | `Flame` | `SoupCard.tsx`、详情、排行 | 卡片、详情、我的；替换心形 |
| 卡片评分 | `Sparkles` | `SoupCard.tsx`、分享卡 | 卡片；替换 `✣` |
| 详情评分 | `Star` | `DetailPage.tsx` 四项统计 | 详情统计；替换 `✣` |
| 点赞 | `ThumbsUp` | 卡片、详情、分享卡 | 卡片和详情；替换心形 |
| 收藏 | `Star` | 卡片、详情、分享卡 | 卡片和详情；替换文本星号 |
| 评价/评论 | `MessageSquare` | 详情统计和交互 | 详情；替换 `▤`/“评” |
| 编辑 | `Pencil` | 详情页 | 编辑按钮；替换 `✎` |
| 分享 | `Share2` | 详情、分享弹窗 | 详情分享入口 |
| 系统消息 | `ShieldCheck` | `MessagesPage.tsx`、`Lists.tsx` | 分类与通知行；替换“盾” |
| 互动消息 | `Heart` | `MessagesPage.tsx` | 消息分类 |
| 申请 | `FileClock` | `MessagesPage.tsx`、顶部横幅 | 消息分类和申请横幅 |
| 平台通知 | `Bell` | `MessagesPage.tsx`、`NoticesPage.tsx` | 消息分类 |
| 全部已读 | `CheckCheck` | `NotificationsPage.tsx` | 替换 `✓✓` |
| 私信 | `MessageCircle` | 消息页、横幅、用户主页 | 私信入口和空状态 |
| @ | `AtSign` | 圈子聊天、顶部横幅 | 圈子未读与候选 |
| 礼物 | `Gift` | 私信、主页、通知 | 私信输入和送礼入口 |
| 表情 | `Smile` | 三类聊天输入栏 | 聊天输入栏 |
| 发送 | `Send` | 三类聊天输入栏 | 聊天输入栏 |
| 回复 | `Reply` | 圈子、玩汤 | 消息操作 |
| 展开/收起 | `ChevronDown`/`ChevronUp` | 详情、聊天、玩汤 | 对应折叠入口 |
| 在线/断线 | `Wifi`/`WifiOff` | 圈子、玩汤 | 连接状态 |
| 贝壳 | `Shell` | 顶部、我的、任务、商城 | 禁止硬币图标替代 |
| 成就 | `Award` | 成就、优秀作者、通知 | 对应入口 |
| 排行 | `Trophy`/`Medal` | 导航、排行、我的 | 按 Web 对应场景使用 |
| 收藏柜 | `GalleryVerticalEnd` | 桌面导航、我的、商城 | 对应入口 |
| 商城 | `ShoppingBag` | 桌面导航、我的 | 对应入口 |
| 任务 | `ListChecks` | 桌面导航、我的、玩汤 | 对应入口 |
| 关闭 | `X` | 所有普通弹窗 | 可见关闭按钮 |
| 删除 | `Trash2` | 编辑器、后台 | 危险操作 |
| 刷新 | `RefreshCw` | 大厅、房间、后台 | 重试/刷新 |

### 5.1 消息通知的逐类型映射

严格复制 `apps/web/src/components/Lists.tsx` 的 `notificationVisual()`：

| `notification.type` | 图标 | 圆底与图标色 |
|---|---|---|
| `badge_unlock` | `Award` | `#FEF3C7` / `#D97706` |
| `daily_task_gift_reward` | `Gift` | 淡紫 / `#9333EA` |
| `ranking_reward` | `Award` | 淡黄 / `#A16207` |
| `soup_like` | `Heart` | 淡红 / `#F43F5E` |
| `soup_favorite` | `Star` | 淡橙 / `#F97316` |
| `soup_evaluation` | `MessageSquare` | 淡绿 / `#059669` |
| 其他系统类型 | `ShieldCheck` | `#DBEAFE` / `#2563EB` |

禁止 `notificationSymbol()` 继续返回汉字或字体符号。

## 6. 头像、等级与徽章数据契约

### 6.1 头像字段必须端到端消费

| 场景 | 接口字段 | 当前 App 状态 | 正确处理 |
|---|---|---|---|
| 首页汤卡作者 | `SoupSummary.creatorAvatar` | DTO 有字段，`SoupCard.uvue` 未使用 | `absoluteApiUrl()` 后优先渲染真实头像 |
| 详情作者 | `SoupDetail.creatorAvatar` | 已正确使用 | 抽入共享头像组件 |
| 评价者 | `Evaluation.reviewerAvatar` | App DTO 缺失、页面未显示 | 补 DTO，并渲染 24px 头像 |
| 当前用户 | `AccountUser.avatar` | 我的页使用，首页顶部未使用 | 顶栏优先显示真实头像 |
| 私信对象 | `otherUser.avatar` | 已使用 | 保留 URL 转换、圆形裁切和在线点 |
| 圈子/房间成员 | `member.avatar` | 多处单独实现 | 统一复用头像组件 |
| 关注/粉丝 | `SocialUser.avatar` | 已使用 | 统一复用头像组件 |

建议创建 `apps/app/components/business/UserAvatar.uvue`，最少支持：`src`、`nickname`、`size`、`online`、`unread`、`roundedSquare`。规则：非空 URL 必须显示图片；加载失败或空值才回退昵称首字；用户圆形、圈子圆角方形；图片使用 `aspectFill`。

### 6.2 等级

当前 App 在 `SoupCard.uvue`、`soup-detail.uvue`、`messages.uvue`、`MineDashboard.uvue` 等处把所有等级写成固定黄色。这只偶然适配 Lv4–6，其他等级全部错误。

必须创建 `apps/app/components/business/LevelBadge.uvue`，复刻 Web `styles.css` 中 `.level-badge--0` 至 `.level-badge--40`：

- Lv0 灰；Lv1–3 浅黄；Lv4–6 暖黄；Lv7–9 橙。
- Lv10–18 分三档渐变；Lv19–27 分三档紫色并带闪星。
- Lv28–40 按深蓝、炫彩蓝、炫彩黄、炫彩红、七色流光分档。
- 所有页面都使用同一组件，不允许页面参数关闭等级品质动效；系统开启减少动态效果时只停动画，不改变配色。

### 6.3 徽章

App 当前普遍把徽章名称固定为紫色，并在各页自行拼接图片和名称。必须创建 `apps/app/components/business/EquippedBadgeIcon.uvue`，复制 Web 规则：

- 默认同时展示图标和名称；只有明确纯图标场景可关闭名称。
- 普通蓝 `#2563EB`、稀有紫、史诗金、传说渐变。
- 名称 11px、最粗字重、不换行；图标与名称为不可拆分单元。
- 使用 `absoluteApiUrl(badge.iconUrl)`；`.png`/`.webp` 由接口返回与现有资源规则决定，不在页面手写路径。
- 正常身份行固定为“昵称 + 等级 + 徽章”，不可把徽章移到下一行。

App `EvaluationSummary` 还必须补齐服务端已经返回的 `reviewerAvatar`、`reviewerEquippedBadge`、`isCreatorEvaluation`、`countsTowardScore`，否则评价卡无法与 Web 对齐。

## 7. 四张截图对应问题与修改点

### 7.1 首页截图

| 截图问题 | 根因 | 修改文件 | 验收 |
|---|---|---|---|
| 顶部只显示蓝底“Ls” | `home.uvue` 只渲染 `sessionLabel`，不消费 `sessionState.user.avatar` | `apps/app/pages/home/home.uvue` | 有头像显示头像；无头像才显示昵称首字 |
| 卡片作者全部显示首字 | `SoupCard.uvue:12` 无条件写首字 | `apps/app/components/business/SoupCard.uvue` | 与详情页同一作者头像完全一致 |
| 热力使用红心 | `SoupCard.uvue:8` 写死 `♥` | 同上 | 使用 `Flame`，不再与点赞混淆 |
| 评分使用 `✣` | `SoupCard.uvue:24` | 同上 | 使用 `Sparkles` |
| 点赞/收藏使用 `♡/☆` | `SoupCard.uvue:25-26` | 同上 | 使用 `ThumbsUp/Star`，选中态填充 |
| 搜索/筛选是 `⌕/☷` | `home.uvue:10,13` | `home.uvue` | 使用 `Search/SlidersHorizontal` |
| 玩汤是游戏手柄、圈子是多人 | App TabBar 自绘资源语义与 Web 不一致 | `pages.json`、`static/tabbar/*` | 使用 `MessageCircleQuestion/CircleEllipsis` |
| 搜索用户无结果 | App 只调用 `/api/soups` | `services/soups.uts`、`home.uvue`，新增用户搜索 DTO/service | 与 Web 一样调用 `/api/users/search` 并展示头像、昵称、等级、徽章 |

### 7.2 详情截图

| 截图问题 | 根因 | 修改文件 | 验收 |
|---|---|---|---|
| 浏览/热力/评分/评价为字体符号 | `soup-detail.uvue:32-35` | `soup-detail.uvue` | 顺序和语义为 `Eye/Flame/Star/MessageSquare` |
| 点赞是心形 | `soup-detail.uvue:41` | 同上 | 使用 `ThumbsUp`；心形只保留在“互动消息/获赞”语义 |
| 收藏是文本星号 | `soup-detail.uvue:52` | 同上 | 使用 Lucide `Star`，选中时填充 |
| 评价和编辑为 `▤/✎` | `soup-detail.uvue:61,67` | 同上 | 使用 `MessageSquare/Pencil` |
| Lv 和徽章名写死黄色/紫色 | 页面内 `.level/.badge` | 同上＋共享组件 | 各等级、各稀有度按 Web 显示 |
| 评价者缺头像和徽章 | App DTO 与模板未消费服务端字段 | `domain/dto/soup.uts`、详情评价列表 | 与 `EvaluationCard.tsx` 一致 |

### 7.3 评价编辑截图

真机只显示字段名和分值，slider 轨道不可见，造成每项之间出现巨大空白。直接改为与 Web `ScoreInput` 对齐的数字输入或原生端稳定的半分步进选择器：

- 总评分必填，1–5，步进 0.5。
- 六维可空；填写时遵守服务端 0–5、步进 0.5 的实际校验，显示说明不得与服务端矛盾。
- 不使用不可见 slider 占位；每个字段应在同一块内完整显示标签、说明、控件和当前值。
- 评价内容最多 500 字，保留剩余字数；保存期间禁用重复提交；失败保留全部输入。
- 修改位置：`apps/app/pages/evaluation-editor/evaluation-editor.uvue`。

### 7.4 系统消息截图

`apps/app/pages/message-category/message-category.uvue` 的 `notificationSymbol()` 是直接根因。删除文本符号分支，按第 5.1 节逐类型返回共享图标名与颜色。行高、44px 圆底、未读红点、日期和单行摘要可保留；标题和摘要都必须截断，不能因长文本挤压日期。

## 8. App 文件级实施清单

### P0：先修截图和跨页不一致

1. 新增共享 `AppIcon.uvue`、`UserAvatar.uvue`、`LevelBadge.uvue`、`EquippedBadgeIcon.uvue`。
2. `SoupCard.uvue`：真实头像、16:9 封面、等级/徽章共享组件、四个指标 Lucide 化。
3. `home.uvue`：真实账户头像、搜索/筛选图标、用户搜索结果；确认 TabBar 是否按 Web 改为中心创作。
4. `soup-detail.uvue`：统计、点赞、收藏、评价、编辑图标全部替换；评价者身份补全。
5. `evaluation-editor.uvue`：替换真机不可见 slider。
6. `message-category.uvue`：删除 `notificationSymbol()`；消息类型映射与 Web 一致。
7. `pages.json` 与 `static/tabbar/*`：更换玩汤、圈子图形；未获产品批准时按 Web 五栏结构执行。

### P1：清理所有同类重复实现

全局搜索并逐项消除：

```text
♥  ♡  ★  ☆  ✣  ◉  ▤  ✎  ⌕  ☷  盾  评  信  ✓✓
```

重点文件：

- `components/business/MineDashboard.uvue`
- `pages/messages/messages.uvue`
- `pages/my-interactions/my-interactions.uvue`
- `pages/private-chat/private-chat.uvue`
- `pages/circle-chat/circle-chat.uvue`
- `pages/online-soup-room/online-soup-room.uvue`
- `pages/user-profile/user-profile.uvue`
- `pages/user-follows/user-follows.uvue`
- `pages/rankings/rankings.uvue`
- `pages/shell-tasks/shell-tasks.uvue`

逐页删除本地 `.level`、`.badge-name`、头像 placeholder 重复样式，改用共享组件。装饰性 `✦` 只有在明确作为星光特效时可以保留。

### P2：状态与无障碍

- 所有图片增加合理的加载失败回退；不能显示破图。
- 所有纯图标入口提供语义标签；44×44 点击区与视觉图标分离。
- 加载、空、错误、禁用和按压状态在同一组件内统一。
- 在线点、未读点、未读数字同时出现时不得重叠。
- iOS/Android 分别验证状态栏、安全区、字体基线和图片裁切。

## 9. 验收清单

- 同一用户在首页卡片、详情、消息、聊天、关注列表显示同一真实头像；无头像才回退昵称首字。
- App 源码中不存在用文本符号替代搜索、筛选、浏览、热力、评分、点赞、收藏、评价、编辑、系统消息和全部已读的实现。
- 首页热力为 `Flame`，点赞为 `ThumbsUp`，收藏为 `Star`，三者任何页面都不串义。
- 首页搜索用户昵称能返回用户结果，且结果包含头像、昵称、等级、徽章。
- Lv0、Lv6、Lv10、Lv19、Lv28、Lv40 截图颜色与 Web 对应等级一致；减少动态效果时颜色保留、动画停止。
- 普通、稀有、史诗、传说四类徽章名称颜色正确，传说名称与图标效果一致；密集列表不丢名称。
- 评价编辑真机可见所有输入控件，可选择半分，滚动无大段空白，失败后输入不丢失。
- 系统消息不再显示“盾”；每种通知类型的图标与颜色匹配第 5.1 节。
- 用户头像为圆形裁切、圈子头像为圆角方形、封面为 16:9、礼物与表情不裁切。
- 运行 `git diff --check`；完成 App 代码修改后按 `apps/app/CLAUDE.md` 执行 Android/iOS 编译与真机验证。不得执行线上部署或发布。

## 10. Web 当前 Lucide 导入位置完整索引

下面按源码实际 `import { ... } from "lucide-react"` 汇总，供执行 Agent 查找同语义的现成实现。此表是 2026-08-05 的代码快照；图标的最终语义仍以第 5 节和统一规范为准。

### 10.1 全局、导航与用户端页面

| 文件（位于 `apps/web/src/`） | 当前导入的 Lucide 图标 |
|---|---|
| `App.tsx` | `X` |
| `components/BottomNav.tsx` | `Home`, `MessageCircleQuestion`, `Plus`, `User`, `CircleEllipsis` |
| `components/DesktopModuleHeader.tsx` | `Award`, `Bell`, `CircleEllipsis`, `GalleryVerticalEnd`, `Home`, `ListChecks`, `LogOut`, `MessageCircleQuestion`, `Plus`, `Settings`, `Shield`, `Shell`, `ShoppingBag`, `Trophy`, `UserRound` |
| `components/PageTopBar.tsx` | `Bell`, `LogOut`, `Shield` |
| `components/UnifiedBackButton.tsx` | `ArrowLeft` |
| `pages/HomePage.tsx` | `Award`, `Bell`, `ChevronDown`, `ChevronLeft`, `ChevronRight`, `ChevronUp`, `CircleEllipsis`, `FileText`, `GalleryVerticalEnd`, `Home`, `ListChecks`, `LogOut`, `MessageCircleQuestion`, `Plus`, `RotateCcw`, `Search`, `Settings`, `Shell`, `Shield`, `ShoppingBag`, `SlidersHorizontal`, `Trophy`, `UserRound` |
| `pages/DetailPage.tsx` | `Bell`, `Download`, `Eye`, `Flame`, `Lock`, `Pencil`, `Shield`, `Star`, `ThumbsUp`, `MessageSquare`, `Trash2`, `User`, `ChevronDown`, `ChevronUp`, `DoorOpen`, `Share2`, `LogOut` |
| `pages/MinePage.tsx` | `ArrowLeft`, `ArrowRight`, `Award`, `Check`, `ChevronLeft`, `ChevronRight`, `GalleryVerticalEnd`, `ListChecks`, `Medal`, `Plus`, `Settings2`, `Shell`, `ShoppingBag`, `Trophy` |
| `pages/AccountSettingsPage.tsx` | `ChevronRight`, `KeyRound`, `TicketCheck` |
| `pages/UserProfilePage.tsx` | `Gift`, `MessageCircle`, `UserCheck`, `UserPlus` |
| `pages/MyInteractionsPage.tsx` | `MessageSquare`, `Star`, `ThumbsUp`, `X` |
| `pages/ExcellentAuthorPage.tsx` | `Award`, `Check`, `Flame`, `ShieldCheck`, `Sparkles`, `X` |
| `pages/RankingsPage.tsx` | `Crown`, `Dices`, `Flame`, `GalleryVerticalEnd`, `Gift`, `Heart`, `Medal`, `Sparkles`, `TrendingUp`, `Trophy` |
| `pages/RankingRewardDetailPage.tsx` | `Award`, `CalendarDays`, `Gift`, `Shell`, `Sparkles` |
| `pages/ShellTaskCenterPage.tsx` | `BookOpenCheck`, `Bot`, `BookmarkCheck`, `CalendarCheck2`, `Camera`, `CheckCircle2`, `ChevronRight`, `CircleGauge`, `Crown`, `Dices`, `Gift`, `Heart`, `HeartHandshake`, `ListChecks`, `MailCheck`, `Medal`, `MessageSquareHeart`, `MessageCircleMore`, `UserRoundCheck`, `Shell`, `Sparkles`, `Star`, `Trophy`, `Wallpaper`, `UsersRound` |
| `pages/ShellTransactionsPage.tsx` | `Minus`, `Plus`, `Shell` |
| `pages/AssetStorePage.tsx` | `BookOpen`, `Clock3`, `GalleryVerticalEnd`, `History`, `Shell`, `Sparkles`, `Trophy` |
| `pages/AssetPackPage.tsx` | `BookOpen`, `ShieldCheck`, `Shell` |
| `pages/AssetDrawHistoryPage.tsx` | `Shell` |

### 10.2 内容、聊天、圈子、消息与玩汤

| 文件（位于 `apps/web/src/`） | 当前导入的 Lucide 图标 |
|---|---|
| `components/SoupCard.tsx` | `Flame`, `Star`, `User`, `ThumbsUp`, `Sparkles` |
| `components/SoupLinkList.tsx` | `Eye`, `ChevronRight`, `ThumbsUp`, `Star`, `Sparkles`, `FileText`, `Flame` |
| `components/SoupShareCard.tsx` | `Flame`, `Sparkles`, `Star`, `ThumbsUp` |
| `components/SoupShareModal.tsx` | `CircleEllipsis`, `MessageCircle`, `Share2`, `Users` |
| `components/SoupEditor.tsx` | `ImagePlus`, `Plus`, `Trash2`, `X` |
| `components/SoupExportButton.tsx` | `FileText` |
| `components/EvaluationCard.tsx` | `User` |
| `pages/SoupEvaluationsPage.tsx` | `Star` |
| `pages/MessagesPage.tsx` | `Bell`, `ChevronRight`, `FileClock`, `Heart`, `MessageCircle`, `ShieldCheck` |
| `pages/NotificationsPage.tsx` | `CheckCheck` |
| `pages/NoticesPage.tsx` | `Bell`, `ChevronRight` |
| `components/Lists.tsx` | `Award`, `ChevronRight`, `Eye`, `Gift`, `Heart`, `MessageSquare`, `ShieldCheck`, `Star` |
| `components/IncomingMessageBanner.tsx` | `AtSign`, `FileClock`, `MessageCircle` |
| `components/GlobalNoticeModal.tsx` | `Bell` |
| `pages/ChatPage.tsx` | `ArrowLeft`, `ChevronDown`, `Gift`, `Send`, `Smile`, `UserRound` |
| `pages/CirclesPage.tsx` | `ArrowUpRight`, `Compass`, `MessageCircle`, `Radio`, `Users` |
| `pages/CircleChatPage.tsx` | `ArrowLeft`, `AtSign`, `ChevronDown`, `Reply`, `Send`, `Smile`, `Users`, `Wifi`, `WifiOff`, `X` |
| `pages/MyInvitationsPage.tsx` | `CheckCircle2`, `Copy`, `Mail`, `MailX` |
| `pages/OnlineSoupLobbyPage.tsx` | `DoorOpen`, `LockKeyhole`, `MessageCircleQuestion`, `Plus`, `RefreshCw`, `Search`, `Users` |
| `pages/OnlineSoupSelectPage.tsx` | `Check`, `Search`, `Soup` |
| `pages/OnlineSoupRoomPage.tsx` | `ArrowRightLeft`, `ArrowUp`, `BookOpen`, `Check`, `ChevronDown`, `ChevronUp`, `Clapperboard`, `Crown`, `Eye`, `Lightbulb`, `ListChecks`, `LogOut`, `Menu`, `MessageCircle`, `Minimize2`, `Play`, `Plus`, `RefreshCw`, `Reply`, `Send`, `Smile`, `Soup`, `Users`, `Wifi`, `WifiOff`, `X` |
| `context/OnlineSoupDockContext.tsx` | `LogOut`, `Maximize2`, `MessageCircle`, `Minimize2`, `Send`, `Wifi`, `WifiOff` |
| `components/GameModal.tsx` | `ArrowLeft`, `Bot`, `Send`, `Lightbulb`, `Sparkles`, `ChevronDown`, `ChevronUp`, `RotateCcw`, `Menu` |
| `components/OnlineSoupInviteModal.tsx` | `CircleEllipsis`, `MessageCircle`, `Share2`, `Users` |
| `components/OnlineSoupRoomInviteCard.tsx` | `DoorOpen`, `Hash`, `Soup`, `Users` |
| `components/StickerKeyboard.tsx` | `ChevronDown` |
| `components/GiftDrawer.tsx` | `Minus`, `Shell`, `X` |
| `components/GiftMessageCard.tsx` | `Heart`, `Shell` |
| `components/RecentGiftsSection.tsx` | `Gift` |

### 10.3 资产、资料与通用组件

| 文件（位于 `apps/web/src/`） | 当前导入的 Lucide 图标 |
|---|---|
| `components/AssetDrawOverlay.tsx` | `FastForward`, `Shell`, `Sparkles`, `X` |
| `components/AssetPackStoryModal.tsx` | `X` |
| `components/AssetCardVisual.tsx` | `Star` |
| `components/CardCabinetSection.tsx` | `ArrowDown01`, `ChevronLeft`, `ChevronRight`, `GalleryVerticalEnd`, `Gem`, `Layers3`, `Star`, `X` |
| `components/ProfileViews.tsx` | `Flame`, `Gift`, `Heart` |
| `components/ProfileBackgroundEditor.tsx` | `Check`, `ChevronLeft`, `ChevronRight`, `Image`, `SlidersHorizontal`, `X` |
| `components/EmailBindingCard.tsx` | `Mail`, `ShieldCheck`, `Unlink` |
| `components/FeedbackCard.tsx` | `ChevronRight`, `ImagePlus`, `MessageSquarePlus`, `X` |
| `components/AuthModal.tsx` | `X` |
| `components/Modal.tsx` | `X` |
| `components/CoverCropper.tsx` | `Crop`, `X` |

### 10.4 管理后台

| 文件（位于 `apps/web/src/components/admin/`） | 当前导入的 Lucide 图标 |
|---|---|
| `AdminTopBar.tsx` | `ArrowLeft`, `Award`, `BarChart3`, `Bell`, `CircleEllipsis`, `ClipboardCheck`, `Images`, `MessageSquare`, `MessageSquareText`, `PackageOpen`, `Gift`, `Radio`, `RefreshCw`, `Soup`, `Users` |
| `AdminDashboard.tsx` | `Activity`, `AlertCircle`, `BarChart3`, `CalendarDays`, `MessageSquare`, `RefreshCw`, `Soup`, `TrendingDown`, `TrendingUp`, `Users` |
| `AdminPagination.tsx` | `ChevronLeft`, `ChevronRight` |
| `ActivityConditionsEditor.tsx` | `Plus`, `Trash2` |
| `ApprovalManagement.tsx` | `Check`, `ExternalLink`, `Flame`, `Search`, `X` |
| `BadgeManagement.tsx` | `Award`, `CalendarClock`, `Eye`, `RotateCcw`, `Search`, `ShieldPlus`, `Users`, `X` |
| `BannerManagement.tsx` | `Edit3`, `ExternalLink`, `ImagePlus`, `LockKeyhole`, `Plus`, `Trash2` |
| `BannerImageCropper.tsx` | `Check`, `X` |
| `CircleManagement.tsx` | `Edit3`, `Eye`, `ImagePlus`, `MessageCircle`, `Plus`, `RotateCcw`, `Trash2`, `Users`, `X` |
| `ColumnSelector.tsx` | `Columns3` |
| `DigitalAssetManagement.tsx` | `Check`, `ImagePlus`, `Plus`, `Save`, `Search`, `Shell`, `Sparkles`, `Trash2`, `Video`, `X` |
| `EvaluationManagement.tsx` | `Pencil`, `Search`, `Star`, `Trash2` |
| `FeedbackManagement.tsx` | `ChevronLeft`, `ChevronRight`, `Eye`, `Search` |
| `GiftManagement.tsx` | `Edit3`, `Gift`, `ImagePlus`, `Plus`, `Power`, `Search`, `Trash2` |
| `NoticeManagement.tsx` | `Bold`, `Edit3`, `Eye`, `ImagePlus`, `Italic`, `List`, `ListOrdered`, `Plus`, `Search`, `Trash2`, `Underline`, `Users`, `X` |
| `OnlineSoupRoomManagement.tsx` | `Eye`, `LockKeyhole`, `RefreshCw`, `Radio`, `Users` |
| `PackStoryEditor.tsx` | `Bold`, `Italic`, `List`, `ListOrdered`, `Underline` |
| `SoupManagement.tsx` | `Search`, `Trash2`, `ThumbsUp`, `Star`, `ExternalLink`, `ArrowUpDown`, `Flame` |
| `UserManagement.tsx` | `ArrowUpDown`, `Gem`, `Heart`, `KeyRound`, `Search`, `Shell`, `Sparkles`, `Trash2`, `X` |

## 11. 可直接交给执行 Agent 的任务描述

> 请先完整阅读 `docs/前端交互与展示统一规范.md`、`docs/APP视觉与图标对齐执行说明.md`、`apps/app/CLAUDE.md`。以 Web 当前源码为视觉与语义真源，在 `apps/app` 内按 P0→P1→P2 顺序完成对齐。先建立共享 `AppIcon/UserAvatar/LevelBadge/EquippedBadgeIcon`，再替换页面手写实现；不得用 Emoji、Unicode 或汉字替代功能图标，不得更改服务端、生产认证配置或执行线上部署。完成后提供逐文件修改清单、Android/iOS 验证结果，以及 Lv0/Lv6/Lv10/Lv19/Lv28/Lv40、四类徽章、首页/详情/评价编辑/系统消息的验收截图。
