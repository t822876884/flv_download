FROM node:18-slim

# 安装构建原生模块所需工具（better-sqlite3 如需编译）
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 仅复制依赖清单，提升缓存命中率
COPY package*.json ./

# 生产安装依赖（使用 lockfile 保持一致性）
RUN npm ci --omit=dev

# 复制应用代码
COPY . .

# 容器默认的持久化位置（可用 compose 覆盖）
ENV PORT=3180
ENV DATA_DIR=/data/videos
ENV DB_PATH=/data/tasks.sqlite3

# 声明可挂载数据卷
VOLUME ["/data"]

EXPOSE 3180

CMD ["node", "server.js"]