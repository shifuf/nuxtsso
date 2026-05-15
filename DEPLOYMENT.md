# Docker 单容器部署

本项目支持前后端放在同一个 Docker 容器中运行。容器内由 Nest 后端监听 `8086`，同时托管前端构建产物。

## 1. 准备服务器

安装 Docker 和 Docker Compose Plugin。

确认端口 `8086` 可访问，或准备 Nginx/Caddy 反向代理到容器的 `8086`。

## 2. 配置环境变量

在服务器项目根目录复制示例文件：

```bash
cp .env.production.example .env
```

编辑 `.env`，把域名改成你的正式域名：

```env
FRONTEND_URL=https://sso.example.com
OIDC_ISSUER=https://sso.example.com
OAUTH_CALLBACK_BASE_URL=https://sso.example.com
```

如果没有反向代理和 HTTPS，只用服务器 IP 测试，可以临时写：

```env
FRONTEND_URL=http://服务器IP:8086
OIDC_ISSUER=http://服务器IP:8086
OAUTH_CALLBACK_BASE_URL=http://服务器IP:8086
```

聚合平台后台需要授权的回调地址是：

```text
${OAUTH_CALLBACK_BASE_URL}/api/auth/callback
```

## 3. 构建并启动

```bash
docker compose up -d --build
```

查看日志：

```bash
docker compose logs -f sso
```

访问：

```text
http://服务器IP:8086
```

或访问你反向代理后的域名。

## 4. 数据持久化

Compose 会把运行数据保存在项目根目录：

```text
docker-data/data      SQLite 数据库
docker-data/uploads   上传文件
docker-data/backups   备份文件
```

不要删除 `docker-data`，否则数据库和上传文件会丢失。

## 5. 更新部署

拉取新代码后重新构建：

```bash
docker compose up -d --build
```

容器启动时会自动执行：

```bash
prisma db push --skip-generate
```

用于同步 SQLite 表结构。

## 6. 常用命令

停止：

```bash
docker compose down
```

重启：

```bash
docker compose restart sso
```

进入容器：

```bash
docker compose exec sso sh
```

查看健康状态：

```bash
curl http://localhost:8086/
```

## 7. 反向代理注意事项

如果使用 Nginx/Caddy 代理 HTTPS，外部地址必须和 `.env` 一致：

```env
FRONTEND_URL=https://sso.example.com
OIDC_ISSUER=https://sso.example.com
OAUTH_CALLBACK_BASE_URL=https://sso.example.com
```

不要在生产环境继续使用 `localhost`、`127.0.0.1`、`192.168.x.x` 或临时测试域名。
