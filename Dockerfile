# ============================================
# 阶段 1: 构建前端 (Vite)
# ============================================
FROM node:24-alpine AS web-builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/web/vite.config.ts apps/web/
COPY apps/web/postcss.config.js apps/web/
COPY apps/web/tailwind.config.ts apps/web/
COPY apps/web/index.html apps/web/
RUN npm ci --legacy-peer-deps
COPY apps/web/src apps/web/src
COPY apps/web/public apps/web/public
# Vite build 时不要指定 --outDir，用 vite.config.ts 的默认值
RUN cd apps/web && npx vite build

# ============================================
# 阶段 2: 构建后端 (TypeScript)
# ============================================
FROM node:24-alpine AS server-builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/server/tsconfig.json apps/server/
RUN npm ci --legacy-peer-deps
COPY apps/server/src apps/server/src
RUN npx tsc -p apps/server/tsconfig.json

# ============================================
# 阶段 3: 运行阶段
# ============================================
FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache vips-dev ffmpeg

# 复制后端构建产物和依赖
COPY --from=server-builder /app/apps/server/dist ./server/dist
COPY --from=server-builder /app/node_modules ./node_modules
COPY --from=server-builder /app/package.json ./

# 复制前端构建产物
COPY --from=web-builder /app/apps/web/dist ./apps/web/dist

EXPOSE 4000
CMD ["node", "server/dist/index.js"]
