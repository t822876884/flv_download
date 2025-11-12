# 基于 Ubuntu 22.04 (jammy)
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# 安装 Node 18 LTS（NodeSource）与原生编译工具
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
 && apt-get install -y --no-install-recommends nodejs python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先复制依赖清单以利用缓存
COPY package*.json ./
RUN npm ci --omit=dev

# 复制应用代码
COPY . .

# 环境变量与数据卷
ENV PORT=3180
ENV DATA_DIR=/data/videos
ENV DB_PATH=/data/tasks.sqlite3

VOLUME ["/data"]
EXPOSE 3180

CMD ["node", "server.js"]