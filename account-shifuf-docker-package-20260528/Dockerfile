ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS frontend-build
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG PRISMA_ENGINES_MIRROR=https://npmmirror.com/mirrors/prisma
ENV npm_config_registry=${NPM_REGISTRY} \
  PRISMA_ENGINES_MIRROR=${PRISMA_ENGINES_MIRROR}
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm config set registry ${NPM_REGISTRY} \
  && npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm ci --registry=${NPM_REGISTRY}
COPY frontend/ ./
RUN npm run build

FROM ${NODE_IMAGE} AS backend-build
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG PRISMA_ENGINES_MIRROR=https://npmmirror.com/mirrors/prisma
ARG DEBIAN_MIRROR=http://mirrors.aliyun.com/debian
ARG DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security
ENV npm_config_registry=${NPM_REGISTRY} \
  PRISMA_ENGINES_MIRROR=${PRISMA_ENGINES_MIRROR}
RUN sed -i "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g; s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package*.json ./
COPY backend/prisma ./prisma
COPY backend/prisma.config.ts ./
RUN npm config set registry ${NPM_REGISTRY} \
  && npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm ci --registry=${NPM_REGISTRY}
COPY backend/ ./
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ARG DEBIAN_MIRROR=http://mirrors.aliyun.com/debian
ARG DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security
ENV NODE_ENV=production \
  PORT=8086 \
  FRONTEND_DIST_DIR=/app/frontend-dist \
  DATABASE_URL=file:/app/data/prod.db
WORKDIR /app/backend
RUN sed -i "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g; s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=backend-build /app/backend ./
COPY --from=frontend-build /app/frontend/dist /app/frontend-dist
RUN mkdir -p /app/data /app/backend/uploads /app/backend/backups
EXPOSE 8086
CMD ["sh", "-c", "npx prisma db push && node dist/main.js"]
