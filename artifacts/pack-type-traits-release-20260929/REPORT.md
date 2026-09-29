# Web/Server 全量部署记录（2026-09-29）

已按用户要求审阅并提交所有未提交改动，完成 Web/Server 全量部署。本次不更新 APP，不运行测试套件或完整检查。

- 发布源码：`87efa472a41f82567bdb7e386818ea482b68c5d2`。
- 提交说明：`release: ship pack type editing and card trait UI updates`。
- 范围：10 个文件，147 行新增、62 行删除；已有抽卡记录的卡包支持修改类型，卡牌特质展示与筛选，收藏柜详情动画及媒体加载优化，以及相关测试文件。
- 镜像：`hgt:87efa47`。
- 镜像归档 SHA256：`28868a9a0a5e1ccfd3021ac9859c161a54397c2084d3491040c2880553f6b4aa`。
- 运行容器：`8d9f489df8e50f04cbe44fedfba096378373da07b133d36a236c42afde85c0fe`。
- 回滚容器：`hgt-app-rollback-87efa47`。
- 本地 Docker 生产构建成功，部署脚本返回 `DEPLOYMENT=complete`、`PUBLIC_HEALTH=ok`。
- 必要发布保护通过：认证源码契约、269 项公共资源路径与内容、生产认证预检、JWT 哈希、Cookie 配置、既有挂载、预期环境及公网健康和 APP 凭据 CORS。
- 未运行测试套件、完整检查或浏览器业务验收；构建包含服务端 TypeScript 编译。
- 未构建或上传 APK，未修改 APP 版本及更新记录；未推送 GitHub。
- 日志：`.local/web-server-release-20260929.log`。

本次全量部署授权已完成并失效。
