# PCB 网站（site/）

PCB 的开源项目门面：一页三块 —— 介绍对话（`#intro`）、下载与版本（`#download`）、报告问题（`#bugs`）。
只做这三件事：介绍、给版本下载、代为建立 GitHub Issue。不注册、不登录、不收集密钥，也不在服务器上跑 omp 或 VS Code。

这是**独立的站点**，和 PCB 本地壳没有代码关系：`server/`、`web/`、`shared/`、`test/` 都不参与，也不需要 Node 之外的东西。

## 启动

```bash
cd site
node server.mjs
# PCB 网站：http://127.0.0.1:8787
```

默认只监听 `127.0.0.1:8787`。要换端口用 `SITE_PORT`（只是本机调试方便，不代表对外部署）。

三块内容都是静态页面 + 三个本机接口，没有构建步骤、没有依赖、不读数据库、不写文件。

## 三个环境变量

| 变量 | 做什么 | 没有它时 |
|---|---|---|
| `INTRO_MODEL_BASE_URL` | OpenAI 兼容接口的根地址（脚本会拼 `/chat/completions`） | 输入框仍在，提交返回「介绍助手还没接上，可以先看上面的说明」（HTTP 200） |
| `INTRO_MODEL_API_KEY` | 调模型的密钥，只在服务端用 | 同上 |
| `INTRO_MODEL_NAME` | 模型名，原样放进请求体的 `model` | 同上 |
| `GITHUB_ISSUES_TOKEN` | 建 Issue 用的令牌（只要 `repo`/`issues` 写权限） | 表单说明「还不能提交：网站这边没有配 GitHub 令牌」 |
| `GITHUB_API_BASE` | 可选，默认 `https://api.github.com`；本机验证失败分支或接 GitHub Enterprise 时用 | 走官方地址 |

三个 `INTRO_MODEL_*` 缺任何一个都算没接上：介绍页的固定说明、三个常见问题、下载、报告表都照常可用。
`GITHUB_ISSUES_TOKEN` 只影响提交，不影响 `/api/releases`（读公开仓库不需要令牌）。

启动脚本会把哪几项接上了打在启动日志里，不打印任何密钥。

```bash
INTRO_MODEL_BASE_URL=http://127.0.0.1:1234/v1 \
INTRO_MODEL_API_KEY=sk-... \
INTRO_MODEL_NAME=some-model \
GITHUB_ISSUES_TOKEN=ghp_... \
node server.mjs
```

密钥只从环境变量读，不写进仓库、不落盘、不回显给页面。

## 接口

### `POST /api/intro`

```json
{ "question": "它能改哪些文件？", "history": [{ "role": "user", "content": "…" }] }
```

- `history` 只取最后 6 条，每条最多 1000 字；`question` 最多 1000 字；超长直接截断。`system` 角色一律忽略。
- 每次都由服务器加上同一条 system（只介绍 PCB、不写代码、不给命令、不碰文件、不索要密钥），`max_tokens` 600。
- 同一 IP 每小时最多 20 次模型请求，超出返回 429 和一句中文；没配模型时不计次。
- 对话不留存：不写数据库、不写文件。

### `GET /api/releases`

读 `https://api.github.com/repos/renjianfj163/PCB/releases`（`User-Agent: pcb-site`），跳过 draft，
优先最新的正式版；只有预发布时才展示一条并标「预发布」。

返回 `{ ok: true, releases: [...] }`；没有任何 release 或 GitHub 取不到时返回 `releases: []` 加一句中文
`reason`（HTTP 仍是 200，页面照常显示「还没有可下载的版本」，不会崩）。

每个 release 里有：`version`、`publishedAt`、`notes`、`prerelease`、`htmlUrl`，以及 `assets` ——
只挑文件名里带 `windows`、`win32` 或 `.exe` 的，带 `name`、`size`、`url`。
`sha256` 只在 asset 的 `digest` 真是 `sha256:<64 hex>` 时才出现，否则页面写「校验和随发布说明给出」。
响应里不含任何密钥或本机路径，已安装的 PCB 也可以直接调这个接口。

### `POST /api/bugs`

```json
{ "version": "v0.1.0", "system": "Windows", "did": "…", "saw": "…", "omp": "omp/18.22.0", "logs": "…" }
```

- 必填：`system`（Windows / macOS / Linux）、`did`、`saw`；`logs` 最多 8000 字。
- 标题是 `[bug] ` 加上「我看到了什么」前 60 个字；正文按字段分行，并注明这是网站表单代开的。
- 用 `GITHUB_ISSUES_TOKEN` 在 `renjianfj163/PCB` 建 Issue，成功返回 `{ ok: true, number, url }`。
- 缺令牌 503、GitHub 报错 502，都带一句「还不能提交：…」的简短原因，不返回堆栈。
- 同一 IP 每小时最多 5 次；不上传文件。

## 页面

浅色、白卡片、无渐变：底色 `#f4f4f5`、卡片 `#ffffff`、边框 `#e6e6e8`、正文 `#1c1c1f`、次要 `#6b6b70`、
主按钮 `#2f6fed`，字体 `-apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui`。

打开页面先给一段固定讲解（不请求模型）和三个可点的问题；下面的输入框才是追问，走 `/api/intro`。
