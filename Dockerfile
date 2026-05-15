# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-bookworm-slim AS backend-build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package*.json ./
COPY backend/prisma ./prisma
RUN npm ci
RUN npm run db:generate
COPY backend/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
  PORT=8086 \
  FRONTEND_DIST_DIR=/app/frontend-dist \
  DATABASE_URL=file:/app/data/prod.db
WORKDIR /app/backend
COPY --from=backend-build /app/backend ./
COPY --from=frontend-build /app/frontend/dist /app/frontend-dist
RUN mkdir -p /app/data /app/backend/uploads /app/backend/backups
EXPOSE 8086
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/src/main.js"]
