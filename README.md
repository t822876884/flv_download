# FLV 下载管理服务器

一个用于拉取 FLV 流并保存到本地的 Node.js 服务，内置前端管理界面，支持任务列表、翻页、播放、取消/删除，并将任务状态持久化到 SQLite。支持本地直接部署与 Docker 部署。

## 功能概览

- 下载任务管理
  - 提交下载：`POST /download`，创建以 `title` 命名的目录，文件名为 `titleYYYYMMDDhhmmss.flv`。
  - 去重：同名任务正在下载时自动跳过。
  - 任务状态持久化：`downloading | completed | cancelled | deleted | error`。
  - 翻页：`GET /tasks?status=...&page=...&pageSize=...`。
- 播放与代理
  - 已完成任务播放：`GET /play/:id`，支持 Range，走本地文件流。
  - 下载中任务播放：前端使用 `/proxy?url=...` 代理远程 FLV。
- 任务操作
  - 取消下载：`POST /cancel {title}`，中断网络、删除半文件、标记 `cancelled`。
  - 删除已完成：`POST /delete {id}`，删除文件并标记 `deleted`。
- 前端页面
  - `public/index.html`：双栏（下载中/已完成）列表、播放/取消/删除、翻页。
  - `public/player.html`：flv.js 播放器，支持远程代理与本地文件。
- 持久化与可配置
  - SQLite：`tasks.sqlite3`（默认在项目根目录）。
  - 可配置目录与端口：`PORT`、`DATA_DIR`（视频根目录）、`DB_PATH`（数据库路径）。

## 目录结构

- `server.js`：Express 服务与接口定义
- `db.js`：SQLite 封装与 CRUD
- `public/`：前端页面与静态资源
- `Dockerfile`、`docker-compose.yml`：容器化部署
- `tasks.sqlite3`：默认数据库文件（可通过 `DB_PATH` 覆盖）

## 数据模型

表 `tasks` 字段：
- `id`: 任务唯一 ID（`title+YYYYMMDDhhmmss`）
- `title`: 任务名
- `url`: 下载的 URL
- `save_dir`: 保存目录（`<DATA_DIR>/<title>` 或工作目录）
- `file_path`: 文件完整路径
- `status`: `downloading | completed | cancelled | deleted | error`
- `created_at`, `updated_at`: ISO 时间戳

## 环境变量

- `PORT`：服务端口（默认 `3180`）
- `DATA_DIR`：视频根目录（默认工作目录 `process.cwd()`）
- `DB_PATH`：SQLite 文件路径（默认 `process.cwd()/tasks.sqlite3`）

> 注：服务从进程环境读取变量（例如 `export` 或 Docker Compose `environment`）；如果使用 `.env` 文件，请在启动前自行加载或在命令行设置变量。

## API

- POST `/download`
  - Body: `{ "title": "小花猫", "url": "http://.../xxx.flv" }`
  - 行为：同名任务正在下载则跳过；否则创建目录并开始下载，写入 DB。

- GET `/tasks`
  - Query:
    - `status`: `downloading` | `completed`
    - `page`: 从 1 开始
    - `pageSize`: 默认 10
  - 返回：`{ ok, items, total, page, pageSize }`

- POST `/cancel`
  - Body: `{ "title": "小花猫" }`
  - 行为：中止下载、删除临时文件、状态 `cancelled`

- POST `/delete`
  - Body: `{ "id": "<任务ID>" }`
  - 行为：删除已完成文件、状态 `deleted`

- GET `/play/:id`
  - 根据任务 ID 播放本地已完成文件，支持 Range 分片

- GET `/proxy?url=<FLV_URL>`
  - 代理远程 FLV 流用于“下载中”的播放

## 前端使用

- 管理页面：`http://localhost:3180/`
  - 顶部表单提交下载
  - 左侧“下载中”：播放（走 `/proxy`）/取消
  - 右侧“已完成”：播放（走 `/play/:id`）/删除
  - 两栏都支持翻页

## 本地部署（macOS）

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

## Docker 部署

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

## 常见问题

- better-sqlite3 构建失败（本地）  
  使用 Node 18+，`npm install` 若出现编译问题，可尝试重装 Xcode Command Line Tools 或切换到预编译平台。

- 无法播放远程 FLV  
  检查源站是否允许被访问；`/proxy` 已设置 `validateStatus` 为 `< 400`，确保 URL 有效且可达。

- 同名任务未重复下载  
  服务按 `title` 去重，仅允许一个同名任务并发下载。如需并发同名不同文件，请在提交时改用不同 `title`。

## License

ISC（默认），可按需调整。