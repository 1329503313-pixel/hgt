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


## Docker 部署（阿里云）

### 前置条件

1. 阿里云 ECS 安装好 Docker 和 Docker Compose
2. 代码上传到服务器

### 构建与启动

```bash
# 1. 构建镜像并启动
docker compose up -d --build

# 2. 查看日志
docker compose logs -f

# 3. 查看服务状态
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
