# FLV 下载管理服务器

一个用于拉取 FLV 流并保存到本地的 Node.js 服务，内置前端管理界面与认证机制，支持探索平台、收藏/屏蔽频道、下载任务管理、播放、同步与配置。所有状态持久化到 SQLite，并支持使用 PM2 进行无停机更新。

## 功能说明

- 认证与安全
  - 管理员登录与退出：`/auth/login`、`/auth/logout`
  - 首次登录或默认密码强制修改：`/auth/change_password`
  - 未登录访问自动跳转到登录页：守卫中间件（`routes/auth.js:24-35`）
- 探索与同步
  - 平台列表从数据库读取：`GET /platforms`（按 `id` 升序展示）
  - 手动同步平台数据：`POST /platforms/sync`（清空并拉取 `json.txt`）
  - 实时探索平台与频道：`GET /explore/platforms`、`GET /explore/channel?address=...`
- 收藏与屏蔽
  - 平台收藏/屏蔽：`POST /platform/:address/favorite`、`POST /platform/:address/blocked`
  - 频道收藏/屏蔽：`POST /channel/favorite`、`POST /channel/blocked`
  - 收藏/屏蔽清单：`GET /channels/favorites`、`GET /channels/blocked`
- 下载任务
  - 提交下载：`POST /download`
  - 文本解析提交：`POST /download/parse`
  - 列表查询与分页：`GET /tasks?status=...&page=...&pageSize=...`
  - 取消与删除：`POST /cancel`、`POST /delete`
- 播放
  - 本地文件播放（支持 Range）：`GET /play/:id`
  - 下载中代理播放：`GET /proxy?url=...`
- 配置与调度
  - 探索基础地址：`GET/POST /config/explore_base_url`
  - 收藏频道地址轮询间隔：`GET/POST /config/poll_interval_minutes`
  - 收藏频道地址同步调度器：`lib/scheduler.js:47-54`
- 无停机更新
  - PM2 reload 新旧进程无缝切换，旧进程优雅排空后退出
  - 应用内排空控制：`server.js:35-54`（停止接收新连接、拒绝新下载、等待进行中下载完成或超时）

## 目录结构说明

- `server.js`：服务入口与主要接口（监听、优雅排空、下载、播放、频道/平台操作、任务列表）
- `routes/auth.js`：认证路由与守卫（登录、退出、修改密码、未登录跳转）
- `routes/explore.js`：平台探索与同步（列表、手动同步、按平台拉取频道）
- `routes/config.js`：配置项读写（基础地址、轮询间隔）
- `lib/utils.js`：工具函数（URL 规范化、密码哈希校验、基础地址与间隔校验等）
- `lib/scheduler.js`：收藏频道地址同步调度器
- `lib/logger.js`：简易日志封装与请求日志中间件
- `db.js`：SQLite 表结构与操作封装（任务、设置、平台、频道）
- `public/`：前端页面与脚本（`index.html`、`login.html`、`app.js` 等）
- `Dockerfile`、`.dockerignore`：容器化构建与忽略规则
- `package.json`：脚本与依赖管理（包含 PM2 脚本）

## 数据模型（SQLite）

表 `tasks`（下载任务）：
- `id` TEXT 主键
- `title` TEXT 非空
- `url` TEXT 非空
- `save_dir` TEXT 非空
- `file_path` TEXT 可空
- `status` TEXT 非空（`downloading | completed | cancelled | deleted | error`）
- `created_at`、`updated_at` TEXT 非空

表 `settings`（配置键值）：
- `key` TEXT 主键
- `value` TEXT 非空
- `updated_at` TEXT 非空

表 `platform`（平台）：
- `id` INTEGER 主键自增
- `address` TEXT 唯一非空
- `title`、`xinimg`、`number`
- `favorite`、`blocked` INTEGER（0/1）
- `created_at`、`updated_at` TEXT 非空

表 `channel`（频道）：
- `id` INTEGER 主键自增
- `title` TEXT 唯一非空
- `address` TEXT 可空
- `favorite`、`blocked` INTEGER（0/1）
- `created_at`、`updated_at` TEXT 非空

## 环境变量配置说明

- `PORT`：服务端口，默认 `3180`
- `DATA_DIR`：视频根目录，默认工作目录
- `DB_PATH`：SQLite 文件路径，默认 `./tasks.sqlite3`
- `GRACEFUL_TIMEOUT_MS`：优雅排空最大等待时长（毫秒）。旧进程在收到退出信号后，拒绝新下载、等待进行中的下载完成或到达该上限再退出。默认 `600000`（10 分钟）。参见 `server.js:35-54`。

PM2 相关（通过脚本传参）：
- `--wait-ready`：等待应用发送 `process.send('ready')` 后再认为就绪（`server.js:649-651`）。
- `--kill-timeout <ms>`：旧进程最大等待时长，超过后 PM2 强制结束旧进程。建议不小于 `GRACEFUL_TIMEOUT_MS`。脚本示例设为 `3600000`（1 小时），参见 `package.json:8`。

## API 接口规范与示例

认证
- `POST /auth/login`
  - Body：`{ "username": "flvAdmin", "password": "..." }`
  - 返回：`{ ok: true, require_change: 0|1 }`
- `POST /auth/logout`
  - 返回：`{ ok: true }`
- `POST /auth/change_password`
  - Body：`{ "old_password": "...", "new_password": "至少8位" }`
  - 返回：`{ ok: true }`
- 登录页：`GET /login`（未登录 GET/HEAD 自动 302 到此页，`routes/auth.js:31-34`）

探索与平台
- `GET /platforms`
  - 返回平台列表（过滤屏蔽），并返回收藏/屏蔽平台清单：`{ ok, items, favorites, blocks }`
- `POST /platforms/sync`
  - 清空平台表，从基础地址拉取 `json.txt` 写入，保留收藏/屏蔽标记，返回计数：`{ ok, count }`
- `GET /explore/platforms`
  - 直接拉取远端平台并入库，返回平台列表与收藏/屏蔽清单
- `GET /explore/channel?address=<platformAddress>`
  - 拉取该平台下频道列表，合并本地收藏/屏蔽状态，返回：`{ ok, platform_address, platform_title, items, favorites, blocks }`

平台/频道操作
- `POST /platform/:address/favorite`
  - Body：`{ "favorite": 0|1 }`，返回：`{ ok, address, favorite }`
- `POST /platform/:address/blocked`
  - Body：`{ "blocked": 0|1 }`，返回：`{ ok, address, blocked }`
- `POST /channel/favorite`
  - Body：`{ "title": "...", "address": "可选", "favorite": 0|1 }`，返回：`{ ok, title, address, favorite }`
- `POST /channel/blocked`
  - Body：`{ "title": "...", "blocked": 0|1 }`，返回：`{ ok, title, blocked }`
- `GET /channels/favorites`、`GET /channels/blocked`
  - 返回收藏/屏蔽频道清单：`{ ok, items }`

下载与任务
- `POST /download`
  - Body：`{ "title": "小花猫", "url": "http://.../xxx.flv" }`
  - 返回：`{ ok, message, task }`（同名任务正在下载时返回跳过信息）
- `POST /download/parse`
  - Body：纯文本，自动解析 URL 与标题，返回：`{ ok, message, task }`
- `GET /tasks?status=downloading|completed&page=1&pageSize=10`
  - 返回：`{ ok, items, total, page, pageSize }`
- `POST /cancel`
  - Body：`{ "id": "<任务ID>" }` 或 `{ "title": "小花猫" }`
  - 行为：中止下载、删除半文件、状态设为 `cancelled`
- `POST /delete`
  - Body：`{ "id": "<任务ID>" }`
  - 行为：删除已完成文件、状态设为 `deleted`

播放
- `GET /play/:id`：播放本地已完成文件，支持 Range
- `GET /proxy?url=<FLV_URL>`：代理远程 FLV（下载中播放）

配置
- `GET/POST /config/explore_base_url`：探索基础地址（默认 `http://api.hclyz.com:81/mf/`）
- `GET/POST /config/poll_interval_minutes`：收藏频道地址轮询间隔（1-60 分钟）

## 前端页面说明

- 管理页面：`http://localhost:3180/`
  - 顶部表单提交下载
  - 左侧“下载中”：播放（走 `/proxy`）/取消
  - 右侧“已完成”：播放（走 `/play/:id`）/删除
  - 两栏都支持翻页

## 部署方案

本地（macOS）

1) 安装依赖

```bash
npm install
```

2)（可选）设置存储与端口

```bash
export DATA_DIR=./data/videos
```

3)（可选）设置数据库路径

```bash
export DB_PATH=./data/tasks.sqlite3
```

4) 启动服务

```bash
node server.js
```

5) 打开页面

```bash
open http://localhost:3180
```

6) 发起下载示例

```bash
curl -X POST http://localhost:3180/download \
  -H "Content-Type: application/json" \
  -d '{"url":"http://01lawylahydi.wljzml.top/live/cx_375809.flv","title":"小花猫"}'
```

### 数据持久化位置（默认）

- 视频：工作目录下的 `<title>/<titleYYYYMMDDhhmmss>.flv`
- 数据库：`./tasks.sqlite3`

> 建议在生产环境将 `DATA_DIR` 与 `DB_PATH` 指向更明确的持久化目录（如外置磁盘或 NAS 挂载点）。

Docker 部署

1) 构建镜像

```bash
docker compose build
```

2) 后台启动（包含持久化挂载）

```bash
docker compose up -d
```

3) 停止并清理容器（保留数据卷）

```bash
docker compose down
```

- 默认挂载：主机 `./data:/data`
- 容器内：
  - 视频目录：`/data/videos`
  - 数据库：`/data/tasks.sqlite3`
- 修改持久化路径：将 `docker-compose.yml` 的 `volumes` 改为你的主机目录，例如：
  - `"/Volumes/ExternalDrive/flv_data:/data"`

## 无停机更新方案（PM2）

- 初次启动（包含等待就绪与较大的旧进程宽限期）：

```bash
npm run pm2:start
```

- 无停机更新：

```bash
npm run pm2:reload
```

- 说明：
  - 新进程启动后发送 `ready`（`server.js:649-651`），PM2 才切流到新进程
  - 旧进程收到信号进入排空：停止接收新连接（`server.js:39-46`）、拒绝新下载（`server.js:171-183, 245-250`），等待进行中的下载完成或超时（`GRACEFUL_TIMEOUT_MS`）再退出
  - 建议设置 `--kill-timeout >= GRACEFUL_TIMEOUT_MS`，避免 PM2 提前强杀旧进程

## 常见问题

- better-sqlite3 构建失败（本地）  
  使用 Node 18+，`npm install` 若出现编译问题，可尝试重装 Xcode Command Line Tools 或切换到预编译平台。

- 无法播放远程 FLV  
  检查源站是否允许被访问；`/proxy` 已设置 `validateStatus` 为 `< 400`，确保 URL 有效且可达。

- 同名任务未重复下载  
  服务按 `title` 去重，仅允许一个同名任务并发下载。如需并发同名不同文件，请在提交时改用不同 `title`。

## License

ISC（默认），可按需调整。