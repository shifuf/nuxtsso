# 宝塔 Docker 部署文档

部署域名：

```text
https://account.shifuf.com/
```

上传目录：

```text
account-shifuf-docker-package-20260528
```

该目录只包含 Docker 构建和运行必需内容，不包含 `node_modules`、`dist`、数据库、上传文件、备份、Git 数据。

## 1. 部署前准备

服务器需要满足：

```text
已安装宝塔面板
已安装 Docker 和 Docker Compose
域名 account.shifuf.com 已解析到服务器公网 IP
宝塔已为 account.shifuf.com 配置 HTTPS 证书
服务器安全组和防火墙允许 80、443 端口访问
```

容器内部服务端口为：

```text
8086
```

本项目是单容器部署，不会再单独运行一个前端端口。前端会在 Docker 构建阶段打包成静态文件，由 Nest 后端在同一个 `8086` 端口托管：

```text
前端页面：https://account.shifuf.com/
后端接口：https://account.shifuf.com/api/*
OAuth 接口：https://account.shifuf.com/oauth2/*
OIDC 发现：https://account.shifuf.com/.well-known/openid-configuration
```

生产访问统一走：

```text
https://account.shifuf.com/
```

不要把 `8086` 端口直接作为正式访问地址暴露给用户。

## 2. 上传文件

将整个目录上传到服务器，例如：

```text
/www/wwwroot/account-shifuf-sso
```

上传后目录结构应类似：

```text
/www/wwwroot/account-shifuf-sso
├── backend
├── frontend
├── Dockerfile
├── docker-compose.yml
├── .env
├── .dockerignore
├── 宝塔Docker部署文档.md
└── OAuth对接文档.md
```

不要额外上传本地的以下目录：

```text
node_modules
dist
.git
docker-data
backend/backups
backend/uploads
backend/prisma/*.db
```

## 3. 检查生产配置

`.env` 已按当前域名写好：

```env
FRONTEND_URL=https://account.shifuf.com
OIDC_ISSUER=https://account.shifuf.com
OAUTH_CALLBACK_BASE_URL=https://account.shifuf.com
ENABLE_DEBUG_EMAIL_CODE=false
```

`docker-compose.yml` 中已写入稳定 OIDC 密钥和服务加密密钥，用于生产环境 Token 签名和 Client Secret 加密。

注意：不要公开 `docker-compose.yml` 和 `.env`，里面包含生产密钥。

## 4. 中国服务器构建加速

国内服务器构建慢通常卡在四类下载：

```text
Docker Hub 基础镜像
Dockerfile syntax 镜像
Debian apt 软件包
npm / Prisma 依赖
```

本部署包已做以下处理：

```text
已移除 Dockerfile 第一行 # syntax=docker/dockerfile:1，避免额外拉取 docker/dockerfile:1
NODE_IMAGE 默认使用 docker.m.daocloud.io/library/node:22-bookworm-slim
npm 默认使用 https://registry.npmmirror.com
Prisma engine 默认使用 https://npmmirror.com/mirrors/prisma
Debian apt 默认使用阿里云镜像源
```

`.env` 中的加速配置如下：

```env
NODE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim
NPM_REGISTRY=https://registry.npmmirror.com
PRISMA_ENGINES_MIRROR=https://npmmirror.com/mirrors/prisma
DEBIAN_MIRROR=http://mirrors.aliyun.com/debian
DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security
```

如果 `docker.m.daocloud.io` 不可用，可以改回官方镜像：

```env
NODE_IMAGE=node:22-bookworm-slim
```

然后给 Docker daemon 配置云厂商镜像加速。推荐优先使用你服务器厂商提供的专属地址，例如阿里云「容器镜像服务 ACR -> 镜像工具 -> 镜像加速器」里的专属地址。

示例：

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "registry-mirrors": [
    "https://你的专属ID.mirror.aliyuncs.com"
  ],
  "max-concurrent-downloads": 3
}
EOF

sudo systemctl daemon-reload
sudo systemctl restart docker
docker info | grep -A 10 "Registry Mirrors"
```

注意：重启 Docker 会影响当前正在运行的容器，建议在部署窗口操作。

如果当前构建已经卡住，先取消构建，再重新执行：

```bash
cd /www/wwwroot/account-shifuf-sso
docker compose up -d --build
```

## 5. 宝塔面板部署方式

进入宝塔面板后按以下步骤操作：

1. 打开「Docker」。
2. 进入「Compose」或「Compose 项目」。
3. 新建 Compose 项目。
4. 项目目录选择 `/www/wwwroot/account-shifuf-sso`。
5. Compose 文件选择 `docker-compose.yml`。
6. 执行构建并启动。

如果使用 SSH，也可以执行：

```bash
cd /www/wwwroot/account-shifuf-sso
docker compose up -d --build
```

查看运行状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f account-sso
```

停止服务：

```bash
docker compose down
```

重启服务：

```bash
docker compose restart account-sso
```

## 6. 宝塔网站反向代理

在宝塔「网站」中添加站点：

```text
域名：account.shifuf.com
根目录：可任意选择一个空目录
PHP：纯静态或不启用
SSL：开启 HTTPS
```

然后配置反向代理：

```text
目标 URL：http://127.0.0.1:8086
发送域名：$host
```

如果宝塔需要手动 Nginx 配置，可使用：

```nginx
location / {
    proxy_pass http://127.0.0.1:8086;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

保存后访问：

```text
https://account.shifuf.com/
```

## 7. 首次初始化

首次访问会进入初始化页面：

```text
https://account.shifuf.com/setup
```

按页面提示创建第一个管理员账号。

初始化完成后登录后台：

```text
https://account.shifuf.com/login
```

管理员后台常用入口：

```text
应用接入：https://account.shifuf.com/user/applications
系统设置：https://account.shifuf.com/user/system
审计日志：https://account.shifuf.com/user/audit
```

## 8. 数据持久化

运行后会自动生成：

```text
docker-data/data      SQLite 数据库
docker-data/uploads   用户上传文件
docker-data/backups   系统备份文件
```

这些目录是生产数据，不能删除。

后续更新代码时，只替换源码和配置文件，不要删除 `docker-data`。

## 9. 更新部署

上传新版代码后执行：

```bash
cd /www/wwwroot/account-shifuf-sso
docker compose up -d --build
```

容器启动时会自动执行数据库结构同步：

```bash
npx prisma db push
```

## 10. 部署验证

访问首页：

```text
https://account.shifuf.com/
```

健康检查：

```text
https://account.shifuf.com/api/health
```

服务信息：

```text
https://account.shifuf.com/api/service-info
```

OIDC 配置：

```text
https://account.shifuf.com/.well-known/openid-configuration
```

JWKS 公钥：

```text
https://account.shifuf.com/oauth2/jwks
```

正常情况下，健康检查会返回：

```json
{
  "status": "ok",
  "timestamp": "..."
}
```

## 11. 常见问题

访问域名显示 502：

```text
检查容器是否启动，检查宝塔反向代理是否指向 http://127.0.0.1:8086。
```

容器启动失败：

```text
执行 docker compose logs -f account-sso 查看日志。
```

HTTPS 回调异常：

```text
确认 .env 中 FRONTEND_URL、OIDC_ISSUER、OAUTH_CALLBACK_BASE_URL 都是 https://account.shifuf.com。
```

数据库丢失：

```text
检查 docker-data/data 是否被删除或未挂载。
```
