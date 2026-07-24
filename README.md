# 海龟汤评价管理系统

## 开发环境

```bash
cp .env.example .env
docker compose up -d mysql
npm install
npm run dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:4000

### 图片资源约束

前端生产构建会先运行 `apps/web/scripts/optimize-images.mjs`：徽章自动生成 256px WebP，并压缩旧客户端使用的 PNG 回退文件；随后校验全部公开图片的尺寸和体积。缺少 WebP 或超过限制时构建会失败，禁止未压缩原图进入发布产物。

```bash
# 主动优化图片
npm run optimize:images -w apps/web

# 只校验，不改文件
npm run check:images -w apps/web
```


## Docker 部署（阿里云）

### 前置条件

1. 阿里云 ECS 安装好 Docker 和 Docker Compose
2. 代码上传到服务器

### 构建与启动

```bash
# 1. 使用服务器上的持久化环境文件校验配置
docker compose --env-file /opt/hgt/.env config --quiet

# 2. 构建镜像并启动
docker compose --env-file /opt/hgt/.env up -d --build

# 3. 查看日志
docker compose logs -f

# 4. 查看服务状态
docker compose ps
```

### 环境变量配置

启动前先修改 docker-compose.yml 中的环境变量：

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | **必填**，JWT 签名密钥（`openssl rand -hex 32`） |
| `ADMIN_DEFAULT_PASSWORD` | 管理员初始密码 |
| `DB_PASSWORD` | MySQL 密码 |
| `WEB_ORIGIN` | 前端域名（替换为实际域名） |
| `PUBLIC_SITE_URL` | SEO canonical、robots 和 sitemap 使用的正式站点地址，例如 `https://hgt.caqis.com/` |
| `RUN_DB_MIGRATIONS` | 启动时自动补齐表和索引，默认 `true`；多实例部署时可先单独执行迁移再设为 `false` |

生产部署必须始终通过同一个服务器绝对路径环境文件启动。不要用手写的
`docker run -e ...` 重建应用容器；手写变量清单容易在新增配置后漏传变量。
Compose 和服务端都会拒绝在邮件必填配置缺失时启动，避免容器表面健康、
实际到绑定邮箱时才返回 503。

### 安全部署数据库迁移

当前仍保持原有的“应用启动时自动迁移”行为，不会改变单实例部署流程。多实例或对启动时间敏感的环境，建议先备份数据库，再只运行一次：

```bash
npm run migrate:prod -w apps/server
```

迁移成功后将应用实例的 `RUN_DB_MIGRATIONS` 设为 `false` 再滚动发布，避免每个实例重复执行结构检查。

### 部署到阿里云

```bash
# 在服务器上
git clone <你的仓库>
cd hgt

# 编辑密码
vim docker-compose.yml

# 启动
docker compose up -d --build
```

服务启动后访问 `http://<服务器IP>:4000`。

如果要配置 HTTPS + 域名，在服务器前面加 Nginx 或 Caddy 反向代理。

### 邮箱验证与找回密码

账号设置支持绑定、换绑和解绑邮箱；登录页支持通过已验证邮箱找回密码。生产环境需配置：

- `EMAIL_VERIFICATION_SECRET`：独立的随机密钥，建议使用 `openssl rand -hex 32` 生成。
- `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`：SMTP 服务地址与连接方式。
- `SMTP_USER`、`SMTP_PASSWORD`：SMTP 账号和授权码。
- `SMTP_FROM`：发件人，例如 `汤汤解谜乐园 <no-reply@hgt.caqis.com>`。
- `SMTP_REPLY_TO`：可选回复地址。
- `PUBLIC_SITE_URL`：公开站点地址，用于生成密码重置链接。

发件域名应按邮件服务商说明配置 SPF、DKIM 和 DMARC。开发环境未配置 SMTP 时，邮箱入口会显示服务尚未开放，后端不会向日志或接口回传验证码。
生产环境中 `SMTP_HOST`、`SMTP_USER`、`SMTP_PASSWORD` 和 `SMTP_FROM` 均为启动必填项；部署前的 `docker compose config --quiet` 会检查它们，服务端启动时会再次校验。
