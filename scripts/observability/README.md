# 请求链路诊断日志

本目录只提供配置和本地可验证的采集实现。生产操作必须取得当前任务的“全量部署”授权；不应直接覆盖既有 Nginx 站点配置。

## 日志行为

- Server 实时异步追加日志；独立采集容器接收 Nginx 的结构化 syslog，两者写入**同一个宿主机目录、同一小时文件**：`/var/log/hgt/requests/requests-2026-09-18T08.jsonl`。文件名及 Server 时间使用 UTC，该例对应北京时间 16 点。文件按写入时间归档。
- 保留完整的最近 24 小时，每分钟和启动时清理。不等待一小时才写磁盘，不使用 copytruncate。仅在某个小时文件的整个时间段都超过 24 小时后删除；因此最多为当前文件加 24 个已完成小时文件，最旧分片可能多保留不足一小时，避免提前删除最近 24 小时内的数据。只删除精确匹配文件名的普通文件。
- Server 默认记录 ≥500ms 请求、5xx、408/504、中途断开，以及 30 秒未结束的 `response_overdue`。后者仅表示超出观察阈值，**不主动终止请求，也不等同于已经发生网络超时**；最终响应仍会另外记录。
- Nginx 记录同阈值慢请求、408、499、5xx；即便应用容器停止，采集容器仍可记录代理错误。保留全部重试的上游连接、首字节、响应时间（单位秒，可能是逗号/冒号分隔的多个值）。
- 两层使用 Nginx 生成的 32 位十六进制 `X-Request-Id`；直连服务端时自动生成。ID 用于诊断，不作为可信用户身份。
- Server 的 `firstByteMs` 是提交响应头的时间，不是客户端收到数据的时间。Nginx 的 `requestTime` 包含请求接收、代理及响应发送时间。Server `durationMs` 覆盖进入最前置 Express 中间件至响应完成/断开。
- 每秒观察 Node 定时器延迟，超过 200ms 记录 `event_loop_stall` 和 RSS。它提示 Node 调度阻塞，不能单独证明是 CPU、数据库或某个函数导致。
- 已建立 SSE 按首字节时间判断慢请求；Nginx 对 SSE/101 升级连接也按首字节时间判断。正常长连接持续时间和断开不算超时。WebSocket 消息帧不在 HTTP 请求诊断范围内。
- 不采集正文、查询串、Cookie、Authorization、用户资料或完整报错堆栈。原始 Nginx `error_log` 常带完整 URL，故不直接复制；新结构化访问日志已涵盖 499/502/504 和上游时间，并保留连接编号用于必要时查原日志。
- 单条最多 8KiB，写盘队列最多 4MiB。磁盘失败/队列满时丢弃诊断记录，最多每分钟在 stderr 告警一次，避免反向阻塞业务。UDP 在拥塞或采集器退出时也可能丢日志，因此保留原 Nginx 日志。此功能不是审计日志或可靠消息队列。
- 使用 Linux 本地文件系统 bind mount（不支持 NFS 等远程文件系统的并发追加保证），每条记录通过一次 `O_APPEND` 写入。日志为 `0640`，目录为 `0750`；不在 Web 静态目录内。

## 首次接入步骤（取得全量部署授权后）

2026-09-18 已只读核对当前生产拓扑：宿主机 Nginx 1.20.1，`tangwuyu.conf` 和 `wgt.conf` 代理到 `127.0.0.1:4000`。本次首次接入使用 `release:full` 的 `-DeployRequestLogging -BuildImageLocally` 参数；`install-production.sh` 固定核对已审计原配置的 SHA-256，先备份再补充 include，失败回滚，最后验证两种来源写入宿主机。此安装器不适用于未审计的新拓扑或重复安装；后续升级先复核当前配置。

1. 完成本地检查、测试、镜像构建和生产认证不变量核对。标准 `production-deploy.sh` 仅新增 `/var/log/hgt/requests:/app/logs/requests` 和 `REQUEST_LOG_DIR=/app/logs/requests`，逐项保留旧挂载、环境及 JWT/Cookie；遇到冲突目录会中止。候选与最终容器均核对挂载。Compose 主服务也提供同一映射。
2. 将本目录保存到宿主机 `/opt/hgt-observability`；使用本次本地构建、已验证的相同镜像运行独立采集容器。**不要仅更新应用而遗漏此步骤。**

   ```sh
   export HGT_LOG_IMAGE=hgt:<本次已验证提交短号>
   docker compose -f /opt/hgt-observability/docker-compose.yml up -d
   ```

   仅发布到宿主机 `127.0.0.1:15140/udp`，禁止对公网发布。Nginx 若迁入另一个容器，须按实际网络使用受限容器网络和服务名，不能原样使用该 loopback 配置。采集容器没有数据库、JWT 或其他应用环境变量。
3. 检查现有 `nginx -T` 的实际 http/server/location 布局（勿把可能含敏感配置的完整输出写入公开日志）。将 `nginx-http.conf` 在 `http {}` 中加载一次；在 HGT 所有目标域名的 `server {}` 中加载 `nginx-server.conf`；将 `nginx-proxy.conf` 放进每个代理到 HGT 的 location，和现有 `proxy_set_header` 放在同一级。
4. Nginx 的 `access_log`、`add_header`、`proxy_set_header` 均需注意继承覆盖。存在 location 自定义指令时，在同级补充新指令；已有 `X-Request-Id` 时合并为一条。原 access/error 日志若继承自父级，在新增 access_log 的级别显式保留其指令，避免覆盖掉原日志。保持已有 Host/Upgrade/Connection/转发头、TLS、路由、缓存和超时设置。
5. 先 `nginx -t`，通过后才执行必要的 reload。此次接入不修改 JWT/Cookie、数据库、业务超时和 Android APK。
6. 核对采集容器状态、端口、宿主机文件权限和磁盘余量。用安全的本地合成慢请求/超时验证同一个 `requestId` 出现 `source=server` 与 `source=nginx` 两条记录；验证应用不可用时 Nginx 502 仍入文件。真实生产域名通过浏览器/请求响应头取得 ID 再检索。正常快请求没有记录是预期行为。

后续全量部署时，应一起更新独立采集容器的 `HGT_LOG_IMAGE`。首次安装/升级失败时恢复原 Nginx include，再停止新采集容器；应用回滚沿用发布脚本原机制，保留宿主机已有日志以便排查。采集服务停止后无人清理旧文件，需恢复采集服务或执行受控清理，不能承诺停机期间定时清理。

## 参数与排查

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `REQUEST_LOG_DIR` | `logs/requests` | 本地相对于启动目录；生产显式设为 `/app/logs/requests` |
| `REQUEST_LOG_SLOW_MS` | `500` | 两个容器需要设置为相同值 |
| `REQUEST_LOG_OVERDUE_MS` | `30000` | 服务端未结束告警，非强制超时 |

```sh
# 根据响应头定位同一条请求的服务端、Nginx 及跨小时结束记录
grep -h '"requestId":"<32位请求ID>"' /var/log/hgt/requests/requests-*.jsonl
# 查看近期未结束、超时、客户端断开、事件循环卡顿
grep -hE 'response_overdue|proxy_timeout|request_aborted|client_closed|event_loop_stall' /var/log/hgt/requests/requests-*.jsonl
```

上游连接耗时高先查代理至应用的连接与监听；首字节和 Server 耗时都高时检查应用/数据库/外部服务；Nginx 总时间高而 Server 较短时检查上传、响应传输和代理缓冲。两层时间口径不同，不能简单相减后断言是某一段网络延迟。只有 Nginx 记录时也可能是请求未到 Express、客户端慢上传、Node 阻塞或日志丢失，需要结合时间附近的 `event_loop_stall` 和现有 error_log。

官方语义参考：[Nginx access_log](https://nginx.org/en/docs/http/ngx_http_log_module.html)、[syslog](https://nginx.org/en/docs/syslog.html)、[upstream 时间变量](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#var_upstream_connect_time)。

## 本地验证

`npm run test:request-logging -w @hgt/server` 验证中间件、异常、脱敏、轮换和并发追加；已纳入服务端 `pretest`。先 `npm run build -w @hgt/server`，再在有 Nginx 的本地 Linux 环境运行 `node scripts/observability/smoke.mjs`，验证真实 Nginx 配置、慢请求 ID 关联、504/未响应、应用停止后 502、SSE 及合并文件。测试仅使用 loopback 合成请求和临时目录，不加载项目环境配置或连接数据库。
