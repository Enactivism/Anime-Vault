# Anime Vault

> **注意**：这是面向个人或局域网使用的工具，不是经过安全加固的公网生产服务。默认使用普通 HTTP，直接暴露到公网前请先配置 HTTPS、反向代理和额外认证。

Anime Vault 是一个基于 Python 标准库的本地番剧管理与基础观看网页。它把来自网站、Alist、网盘或本地媒体库的番剧入口整理成海报墙，并保存番剧资料、剧集规则、M3U8 分集和播放状态。

项目还支持一个**独立部署的云端 JSON 备份服务**。备份服务不在本仓库内，也不连接本项目的 SQLite；Anime Vault 首页的“备份服务器”面板可以测试连接、上传备份和覆盖式恢复备份。

Anime Vault 项目提供了与 Animeko 配合使用的订阅配置和 Selector 数据源接口，可以将 Anime Vault 中的番剧和剧集接入 Animeko；[Animeko](https://github.com/open-ani/animeko) 负责弹幕等更完整的观看体验。Anime Vault本身具有基本的播放能力，因此即使不是 Animeko 用户，也可以单独使用它管理和观看番剧。

[docs/运行教程文档.md](docs/运行教程文档.md)：启动、访问、页面使用和常见问题。

## 推荐使用方式

最推荐的组合是：

```text
Alist + Anime Vault + Animeko
```

这样的组合避免了看网盘没弹幕，看Animeko某些番剧画质差/中间插广告的缺点。

典型流程如下：

1. 使用 Alist 挂载网盘或其他媒体存储。
2. 在 Alist 网页中找到番剧，并复制文件的下载链接 URL。
3. 将这些 URL 按剧集顺序粘贴到 Anime Vault，通过“URL 列表转 M3U8”自动生成番剧和剧集信息；也可以先整理成 `.m3u8` 文件后导入。
4. 在 Anime Vault 中补充海报、简介、演员等资料，形成统一的番剧海报墙。
5. 在 Animeko 中添加 Anime Vault 的订阅配置，在 Animeko 中搜索并观看番剧，使用 Animeko 的弹幕功能。

`Anime Vault` 也可以直接保存普通网站的播放入口并按规则生成剧集 URL，不依赖 Alist 或 Animeko。

> 说明：项目只负责番剧资料展示、播放地址保存、URL 拼接、播放列表导入和浏览器/播放器跳转，不提供任何视频网站破解、解析或绕过权限的功能。请确保自己有权访问和使用导入的媒体资源。

## 主要功能

- 首页海报墙浏览番剧条目，并按最近播放活动排序
- 标题、副标题、关键词即时搜索筛选
- 番剧详情页展示海报、横版剧照、简介、发行信息、制作公司、演员、关键词和资料来源
- 新增番剧资料
- 编辑已有番剧资料；编辑时 slug 保持不变
- 为每部番剧保存独立的播放地址
- 配置剧集 URL 拼接规则，点击剧集后跳转到最终播放地址
- 上传海报和详情页剧照，支持拖拽选择、本地预览和项目内相对路径
- 上传 UTF-8 编码的 `.m3u8` 播放列表，自动生成剧集
- 逐行粘贴 HTTP/HTTPS 视频 URL，自动生成 M3U8 和剧集
- 为导入的播放列表设置剧集显示偏移
- M3U8 和本地媒体的浏览器内播放、剧集切换与播放状态记录
- 本地媒体库按目录扫描视频，支持生成单集 MPV 播放列表
- 生成 Animeko 可读取的订阅配置和 Selector 数据源接口
- Animeko API 支持在线路由、M3U8 分集以及本地媒体资源
- 可选的独立云端 JSON 备份、连接检测和覆盖式恢复
- 首页设置个人访问密码；无需注册账号和多用户权限系统
- 启动时自动创建数据库并迁移缺失字段
- 内置番剧种子资料会在初始化时写入或更新基础资料，不覆盖用户保存的播放地址、剧集配置和播放记录

## 适用场景

- 把常看的番剧整理成一个本地网页入口
- 为不同番剧保存各自的播放链接
- 按固定 URL 规则快速跳转到指定剧集
- 从 Alist、网盘或其他来源复制视频 URL 后批量生成剧集
- 记录最近看到哪一集和浏览器播放进度
- 在个人电脑、树莓派或局域网设备上长期自用
- 将自己的番剧资源整理后交给 Animeko 搜索和观看

## 技术结构

- 后端：Python 3 标准库
- Web 服务：`http.server.ThreadingHTTPServer`
- 数据库：SQLite
- 前端：原生 `HTML + CSS + JavaScript`
- 模板：简单字符串占位符替换

项目后端只使用 Python 标准库，不需要安装第三方 Python 包。

## 环境要求

- Python：3.10 及以上
- 浏览器：Chrome、Edge、Firefox 或 Safari 的较新版本
- 操作系统：Linux、Windows、macOS 或树莓派系统

## 目录结构

```text
Anime-Vault/
├── app.py
├── README.md
├── anime_vault/
│   ├── __init__.py
│   ├── cli.py
│   ├── config.py
│   ├── media.py
│   ├── playlists.py
│   ├── renderers.py
│   ├── repository.py
│   ├── seed.py
│   └── server.py
├── data/                         # 运行后生成，已被 .gitignore 忽略
│   └── anime.db
├── docs/
│   └── 运行教程文档.md
├── poster/                       # 上传后生成，已被 .gitignore 忽略
├── Stills/                       # 上传后生成，已被 .gitignore 忽略
├── static/
│   ├── app.js
│   ├── backup-client.js
│   └── styles.css
├── tests/
│   ├── backup_client.test.mjs
│   ├── test_backup_connection.py
│   ├── test_m3u8_create.py
│   ├── test_playlists.py
│   └── test_privacy.py
└── templates/
    ├── anime_form.html
    ├── auth.html
    ├── detail.html
    └── index.html
```

### 核心文件职责

- `app.py`：极薄启动入口，保留 `python3 app.py` 的运行方式。
- `anime_vault/cli.py`：解析 `--host`、`--port`、`--init-db` 等命令行参数，初始化数据库并启动 HTTP 服务。
- `anime_vault/config.py`：集中定义项目路径、数据库路径、模板路径、图片目录和媒体格式。
- `anime_vault/media.py`：校验媒体目录是否位于允许的媒体库根目录内、递归查找视频文件、确定视频 MIME 类型，并提供可选的 `ffprobe` 视频流探测函数。
- `anime_vault/server.py`：处理认证、路由、表单、上传、播放、重定向、Animeko 接口和静态文件服务。
- `anime_vault/repository.py`：创建和迁移数据库表，读写番剧数据、播放进度、媒体库根目录、访问密码哈希以及备份 JSON。
- `anime_vault/renderers.py`：加载模板、渲染 HTML 片段、生成剧集 URL 和播放列表剧集编号。
- `anime_vault/playlists.py`：校验并解析用户上传的 M3U8 播放列表，生成 URL 列表对应的 M3U8 内容。
- `anime_vault/seed.py`：内置初始番剧资料。
- `static/app.js`：首页搜索、播放地址编辑、资源类型切换、剧集配置展开、图片和 M3U8 上传预览，以及备份服务器面板的状态和按钮行为。
- `static/backup-client.js`：备份服务器地址解析、连通性与令牌检测、超时控制、上传和刷新请求，以及失败原因的中文提示。不操作 DOM，可单独测试。
- `static/styles.css`：全站视觉样式和响应式布局。
- `templates/auth.html`：设置密码、修改密码和输入密码解锁的认证页面。

## 运行方式

在项目根目录执行：

```bash
python3 app.py
```

默认监听：

```text
0.0.0.0:8000
```

本机访问 `http://127.0.0.1:8000`，同一局域网的其他设备访问 `http://运行设备IP:8000`。

指定端口：

```bash
python3 app.py --port 8080
```

访问：

```text
http://运行设备IP:8080
```

如果只允许本机访问：

```bash
python3 app.py --host 127.0.0.1 --port 8000
```

只初始化数据库、不启动服务：

```bash
python3 app.py --init-db
```

该命令会创建 `data/anime.db`、创建或迁移 `anime` 表和隐私配置表，并写入或更新内置种子资料。

首次启动时，项目会自动创建 `data/` 目录和数据库。之后再次启动会继续使用同一个数据库。

## 运行测试

后端和接口测试使用 Python 标准库的 `unittest`，不需要安装第三方 Python 包：

```bash
python3 -m unittest discover -s tests -v
```

如本机已经安装 `pytest`，也可以运行 `python3 -m pytest tests -q`，但它不是项目的必要依赖。

备份服务器连接判定的测试需要 Node.js：

```bash
node --test tests/backup_client.test.mjs
```

测试会在临时数据库中运行，不会修改 `data/anime.db`。

提交前可以额外执行：

```bash
python3 -m compileall -q anime_vault tests
git diff --check
```

## 常用路由

| 路由 | 方法 | 用途 |
| --- | --- | --- |
| `/` | GET | 首页海报墙 |
| `/anime/new` | GET | 新增番剧表单 |
| `/anime/<slug>` | GET | 番剧详情页 |
| `/anime/<slug>/edit` | GET/POST | 编辑番剧 |
| `/anime/<slug>/episode/<n>` | GET | 在线链接或 M3U8 分集播放 |
| `/anime/<slug>/local-episode/<n>` | GET/HEAD | 本地媒体分集流式播放 |
| `/anime/<slug>/mpv-playlist/<n>` | GET | 下载单集 MPV 播放列表 |
| `/anime/<slug>/download-m3u8` | GET/HEAD | 导出或重定向到 M3U8 |
| `/animeko/subscription` | GET | Animeko 订阅配置 |
| `/animeko/search?keyword=...` | GET | Animeko 搜索接口 |
| `/animeko/anime/<slug>` | GET | Animeko 番剧详情和分集 |
| `/api/backup/export` | GET | 导出当前本地 JSON 备份 |
| `/api/backup/import` | POST | 覆盖导入 JSON 备份 |

`/api/backup/import` 要求 `Content-Type: application/json`。设置网页访问密码后，Animeko 路由需要令牌；网页端的本地备份接口仍由浏览器会话保护。

## 首页和详情页

打开首页后可以看到番剧海报墙，并查看当前馆藏数量。首页支持：

- 点击海报进入详情页
- 在搜索框输入标题、题材或关键词即时筛选
- 点击“新增番剧”打开新增页面
- 按最近播放活动查看条目顺序

详情页展示海报、横版剧照背景、标题、副标题、发行信息、制作公司、简介、播放地址、剧集演员、关键词、资料来源、剧集列表和上一次播放记录。点击“返回海报墙”回到首页，点击“编辑资料”进入编辑页面。

## 新增和编辑番剧

首页点击“新增番剧”进入新增页面；详情页点击“编辑资料”可以修改已有条目。

所有资源类型都必须填写：

- `slug`：番剧的唯一标识。新增时不能与现有条目重复，编辑时不能修改。
- `番剧名`

新增和编辑页支持填写：

- 副标题
- 发行信息
- 制作公司
- 简介
- 剧集演员
- 关键词
- 资料来源，格式为“标签 | URL”
- 海报和详情页剧照的项目内相对路径，或从当前设备上传图片

图片支持点击选择、拖拽上传和浏览器内预览。支持格式：

```text
JPG, JPEG, PNG, GIF, WEBP, BMP, SVG, AVIF
```

上传后的海报保存到 `poster/`，剧照保存到 `Stills/`，文件名会根据 slug 自动生成。重新上传时会覆盖同 slug 对应的上传图片文件。详情页删除番剧时会删除番剧及其播放记录，但磁盘上的图片文件不会自动删除。

## 资源类型和剧集导入

新增或编辑番剧时，可以在“资源”中选择以下方式：

### 播放链接 / 路由

适合普通视频网站或其他在线播放入口。填写播放链接后，可以额外填写总集数和剧集 URL 拼接配置。详情页的播放地址默认只读：

- 点击非空播放地址会在新标签页打开该地址。
- 点击“编辑地址”后可以修改地址。
- 点击“保存地址”后写入 SQLite 数据库。

### M3U8 文件

上传 UTF-8 编码的 `.m3u8` 播放列表。系统会读取 `#EXTINF` 标题和后续的 HTTP/HTTPS 播放地址，并按顺序自动生成剧集；地址中的中文、空格和方括号会在导入时自动编码。

使用 M3U8 资源时可以不提供海报和剧照，页面会自动使用占位海报。导入后详情页会显示播放列表文件名和解析出的集数。

### URL 列表转 M3U8

每行填写一个 HTTP/HTTPS 视频地址，空行会被忽略。

这种方式同样可以不提供海报和剧照；简介、演员、关键词等番剧资料仍需手工填写。选择此资源类型后，播放链接、总集数和 URL 查询配置会自动隐藏，只需填写番剧资料、视频 URL 列表和显示偏移。

两种导入方式都支持“导入集数显示偏移”。例如填写 `3` 后，播放列表的第一条视频仍通过内部第 1 条地址播放，但页面和 Animeko 中显示为“第 4 集”；URL 列表生成的 M3U8 标题也会同步使用偏移后的集数。播放地址和播放进度不会因此改变。

### 本地媒体播放

本地媒体不是新增页中的资源类型，而是在番剧详情页的“剧集 -> 配置”中选择“本地页内播放”。配置时填写本地番剧目录；该目录必须存在，并且必须位于数据库 `media_library_directory` 表配置的媒体库根目录下。

新数据库默认允许的媒体库根目录是 `/mnt/alist`。当前项目没有单独的媒体库设置页面；如果媒体实际位于其他根目录，需要先修改数据库中的媒体库根目录配置，或通过备份 JSON 的 `media_library_paths` 导入配置。番剧目录下会递归扫描以下扩展名，并按相对路径排序生成剧集：

```text
.mp4 .m4v .webm .mkv .mov .avi .flv
```

本地模式提供详情页内播放器、上一集/下一集、音量、倍速、全屏和播放进度保存；也可以从当前集数生成单集 MPV 播放列表。视频不会被转码，浏览器是否能播放取决于视频编码和浏览器支持情况。

## 剧集 URL 规则

对“播放链接 / 路由”资源，详情页的“剧集 -> 配置”会保存以下字段：

- `总集数`：控制生成多少个剧集按钮。
- `根域名`：例如 `https://example.com`。
- `路由`：例如 `/watch`。
- `查询参数前缀`：例如 `?ep=`。
- `集数查询偏移`：控制拼接到 URL 中的起始编号。
- `其他`：补充额外参数，例如 `&source=anime`。

点击第 `N` 集时，最终 URL 按下面的规则拼接：

```text
根域名 + 路由 + 查询参数前缀 + (集数查询偏移 + N - 1) + 其他
```

示例：

```text
总集数 = 25
根域名 = https://example.com
路由 = /watch
查询参数前缀 = ?ep=
集数查询偏移 = 0
其他 = &from=anime
```

点击第 1 集会跳转到：

```text
https://example.com/watch?ep=0&from=anime
```

点击第 25 集会跳转到：

```text
https://example.com/watch?ep=24&from=anime
```

点击剧集后，项目会记录该集为“上一次播放”，并在剧集列表中高亮。在线链接模式只负责跳转到外部地址；M3U8 播放页的播放位置保存在当前浏览器的 `localStorage` 中；本地媒体模式还会将播放位置、时长和完成状态写入 SQLite。

## Animeko 接入

Anime Vault 提供的是 Animeko 可读取的订阅配置和 Selector 数据源接口，不是对 Animeko 内部数据库的直接导入。订阅接口返回 Animeko 要求的 `exportedMediaSourceDataList` 对象，其中包含 `web-selector` 数据源配置；Animeko 通过搜索接口和详情页读取番剧与剧集。

### 直接添加订阅

先启动 Anime Vault，并确认运行 Animeko 的设备可以访问 Anime Vault 所在设备的 IP 地址。在 Animeko 的“设置 -> 数据源管理 -> 添加订阅”中填写：

```text
http://运行设备IP:8000/animeko/subscription
```

如果首页显示“一键复制 Animeko 订阅”，也可以直接复制页面提供的地址。Animeko 会自动读取 Selector 配置并定时更新。

### 手动创建 Selector 规则

如果需要手动配置，在 Animeko 的“设置 -> 数据源管理”中新增 `Selector` 数据源：

1. 搜索地址填写 `http://运行设备IP:8000/animeko/search?keyword={keyword}`。
2. 条目格式选择 `JSON Path Indexed`。
3. `selectLinks` 填写 `$[*]['url','link']`，`selectNames` 填写 `$[*]['title','name']`。
4. 线路格式选择 `No Channel`。
5. 剧集选择器填写 `a.animeko-episode`，名称使用元素文本，链接使用元素的 `href` 属性。
6. 保存后搜索 Anime Vault 中已有番剧，打开详情即可选择剧集播放。

适配接口会为每个剧集输出独立的“第 N 集”文本，保证 Animeko 能识别分集编号。原始 M3U8 标题保存在链接的 `title` 属性中，不会干扰集数解析。

当番剧配置为在线路由或 M3U8 时，Animeko 会直接获得对应播放地址；如果使用本地媒体模式，Animeko 会获得 Anime Vault 的本地视频接口，因此 Animeko 设备必须能够访问同一个服务地址。

### Animeko 与访问密码

Animeko 请求 Anime Vault 时无法使用浏览器会话 Cookie。如果 Anime Vault 已设置访问密码，需要在启动服务时设置只读接口令牌：

```bash
ANIMEKO_API_TOKEN='请替换为随机长字符串' python3 app.py
```

然后在订阅地址中追加令牌：

```text
http://运行设备IP:8000/animeko/subscription?token=令牌
```

手动规则的搜索地址改为：

```text
http://运行设备IP:8000/animeko/search?token=令牌&keyword={keyword}
```

详情页地址会自动携带令牌。令牌也可以通过 `token` 查询参数、`X-Animeko-Token` 请求头或 `Authorization: Bearer 令牌` 传递。令牌只用于 Animeko 只读接口，不会改变网页端访问密码；请不要把令牌提交到公开规则仓库。令牌泄露后重新生成并重启服务即可。

## 数据持久化和备份

数据库文件位于：

```text
data/anime.db
```

数据库会保存：

- 番剧 slug、标题、副标题、发行信息和制作公司
- 简介、演员、关键词和资料来源
- 海报路径和详情页剧照路径
- 播放地址和资源类型
- 本地媒体目录配置
- M3U8 文件名和解析后的分集播放信息
- 剧集总数和剧集 URL 拼接参数
- 集数查询偏移和导入集数显示偏移
- 上一次播放的集数、播放进度、时长和完成状态
- 访问密码的随机盐、哈希和会话签名密钥（不会保存明文密码）

启动时会自动执行数据库初始化和字段补齐。内置种子数据会更新基础资料字段，但不会覆盖用户保存的播放地址、剧集配置和播放记录。

最重要的备份文件是 `data/anime.db`。如果新增或上传了图片，还需要备份 `poster/` 和 `Stills/`。迁移项目时必须连同数据库一起保留，否则播放数据和密码配置也会丢失。

### 云端备份服务

云端备份服务是与本项目分开部署的独立 Python 服务，不属于本仓库。它通过 `Authorization: Bearer <令牌>` 接收和提供 JSON 备份，不连接本项目的 SQLite 数据库。服务端源码应单独部署，并以持久化目录保存备份。

备份服务的最小启动方式如下：

```bash
export BACKUP_TOKEN='请替换为随机生成的长字符串'
python3 server.py --host 0.0.0.0 --port 8787 --data-dir /srv/anime-vault-backups
```

服务端参数：

- `--host`：监听地址，默认 `0.0.0.0`。
- `--port`：监听端口，默认 `8787`。
- `--data-dir`：JSON 备份保存目录，默认 `./data`。
- `--token`：访问令牌；也可以使用环境变量 `BACKUP_TOKEN`。

接口约定：

- `GET /health`：返回 `{"ok": true, "service": "anime-vault-backup"}`。
- `GET /api/backup`：使用令牌下载最近一次备份；没有备份时返回 `404`。
- `PUT /api/backup`：使用令牌上传 JSON；单个备份最大 20 MiB。

生产环境建议将服务放在 Nginx 或 Caddy 后面启用 HTTPS，并确保反向代理保留 `/health` 和 `/api/backup` 路径。备份服务保存每个令牌最近的一份 JSON，不提供版本合并或历史版本管理。

Anime Vault 首页的“备份服务器”面板支持填写服务器 API 地址和访问令牌。地址应填写到 `/api/backup`，例如 `https://backup.example.com/api/backup`；填写局域网 IP 和端口时可以省略 `http://` 和 `/api/backup`，页面会自动补全。点击“测试连接”可以先确认连通性和令牌是否有效，再点击“上传备份”保存当前版本，或点击“一键刷新数据”下载云端版本并覆盖本地馆藏。

面板标题右侧会一直显示连接状态（`未测试` / `检测中` / `已连接` / `已连接（暂无备份）` / `令牌无效` / `无法连接` / `路径有误` 等），收起面板时也能看到；打开首页会自动检测一次。检测和传输都有超时时间，失败时会给出具体原因，不会一直停在“进行中”。

云端 JSON 包含番剧资料、播放地址、剧集配置、M3U8 分集、播放记录、播放进度和媒体库路径，不包含访问密码、会话密钥、海报文件和剧照文件。图片目录仍需单独备份。浏览器会把备份地址和令牌保存到当前浏览器的 `localStorage`，不会写入 Anime Vault 数据库。

“一键刷新数据”是覆盖式恢复：会删除当前本地番剧、播放进度和播放活动，再写入云端版本，不能合并两个版本。执行前请确认云端备份时间和内容；如果误刷新，只能重新上传正确的本地备份。

## 隐私保护

首次打开首页时，点击“添加密码”即可设置访问密码。密码至少需要 6 个字符，设置完成后当前浏览器会话会自动解锁。

之后访问网站时，如果没有有效的解锁会话，首页会显示密码输入页。输入正确密码后才能访问番剧详情、海报、剧照、视频、本地播放和编辑接口。进入首页后：

- 点击“修改密码”更换访问密码。
- 点击“锁定”立即结束当前浏览器会话。

项目不提供账号注册、找回密码或多用户权限。密码只以 PBKDF2 哈希形式写入 `data/anime.db`，浏览器使用带签名的 HttpOnly 会话 Cookie 保持解锁状态。

如果忘记密码，只能先备份数据库，再删除 `privacy_settings` 表中的唯一配置记录：

```bash
python3 -c 'import sqlite3; db=sqlite3.connect("data/anime.db"); db.execute("DELETE FROM privacy_settings"); db.commit(); db.close()'
```

重启服务后，首页会恢复为未设置密码的状态，可以重新点击“添加密码”。这个操作不会删除番剧资料，但仍建议先保留原数据库备份。

## 安全边界

这是个人本地工具，不是面向公网的生产服务。

- 默认监听 `0.0.0.0`，同一局域网的设备可以通过运行设备的 IP 地址访问。
- 仅在受信任的局域网中运行；如需限制为本机访问，使用 `--host 127.0.0.1`。
- 访问密码是个人站点级别的保护，不是账号系统，也不提供多用户权限管理。
- 设置密码后，番剧页面和媒体资源需要解锁；用于加载界面的 `static/styles.css` 和 `static/app.js` 仍可公开读取。
- Animeko 只读接口在设置密码后需要 `ANIMEKO_API_TOKEN`，请妥善保管令牌。
- 当前服务使用普通 HTTP，不提供 HTTPS 加密。通过不受信任的网络访问时，密码和令牌可能被网络监听。
- 不建议直接暴露到公网。需要远程访问时，建议使用 SSH 隧道、VPN 或带 HTTPS 和认证的反向代理。

## 常见问题

### 浏览器无法打开页面

- 确认终端显示了 `Serving on http://...`。
- 确认访问地址和端口正确。
- 如果从其他设备访问，确认没有显式使用 `--host 127.0.0.1`。
- 检查防火墙是否阻止端口。

### 首页要求输入密码

这是正常的隐私保护流程。输入设置时使用的访问密码即可解锁。如果刚刚修改过密码，旧密码和旧浏览器会话都会失效。

### 忘记访问密码

项目不会保存明文密码，也没有账号找回流程。请按照“隐私保护”一节中的命令删除 `privacy_settings` 记录，并先保留数据库备份。

### 图片不显示

- 确认 `poster/` 和 `Stills/` 目录存在。
- 确认数据库中的图片路径是相对项目根目录的路径。
- 确认图片文件名没有被删除或改名。

### 新增番剧提示 slug 已存在

slug 是番剧的唯一标识。换一个未使用过的 slug。

### 点剧集没有正常跳转

- 确认 `总集数` 大于 0。
- 确认 `根域名` 已填写。
- 检查 `路由`、`查询参数前缀`、`集数查询偏移`、`其他` 拼接后是否是目标网站需要的格式。
- 对 M3U8 或 URL 列表资源，确认导入后详情页显示了解析出的剧集和有效的 HTTP/HTTPS 地址。

### 保存后数据没有变化

- 确认表单提交后页面有刷新或跳转。
- 确认 `data/anime.db` 可写。
- 重新启动服务后再检查。

### 需要重置数据库

先备份当前数据库：

```bash
cp data/anime.db data/anime.db.bak
```

如果确定要重新生成数据库，可以删除 `data/anime.db` 后重新启动服务。删除会丢失播放地址、剧集配置、导入的播放列表和播放记录。
