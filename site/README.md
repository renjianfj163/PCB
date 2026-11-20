# PCB 网站（site/）

PCB 的开源项目门面：一页两语（中文 / English），七块内容——概览、窗口、Chat · Plan · Build、
产品定位（一个工作空间 / 完整工作流 / 本地优先 / 两个版本）、下载、常见问题与介绍助手、报告问题。只做三件事：介绍、给版本下载、代为建立 GitHub Issue。
不注册、不登录、不收集密钥，也不在服务器上跑 omp 或编辑器。

这是**独立的站点**，和 PCB 本地壳没有代码关系：`server/`、`web/`、`shared/`、`test/` 都不参与，
也不需要 Node 之外的东西。

## 启动

```bash
cd site
node server.mjs
# PCB 网站：http://127.0.0.1:8787
```

默认只监听 `127.0.0.1:8787`。要换端口用 `SITE_PORT`（只是本机调试方便，不代表对外部署）。

静态页面 + 三个本机接口，没有构建步骤、没有依赖、不读数据库、不写文件。

## 文件

| 文件 | 内容 |
| --- | --- |
| `public/index.html` | 结构与文案骨架；文字挂 `data-i18n` key，正文里放中文原文当兜底 |
| `public/styles.css` | 全部样式；浅色为默认，跟随系统深色；无外部字体 |
| `public/app.js` | 读字典、套用 key、渲染版本列表、介绍对话、报告表单 |
| `public/i18n/zh.json`、`en.json` | 两种语言的字典（178 个 key，两边必须一致） |
| `public/shots/app.png` | 首屏截图：1440×900 的 PCB 实拍，页面只裁掉底部一小条渲染重叠 |
| `server.mjs` | `node:http` 服务：静态文件 + `/api/intro`、`/api/releases`、`/api/bugs` |

## 两个版本

页面按产品语言写：**PCB Desktop**（日常工作版）与 **PCB Developer**（开发者版）。两者的说明是产品事实，改文案前先读 `docs/install.md`：

- **PCB Desktop**：完整工作环境 + 内置 AI 运行组件；没有编辑器，不显示「IDE」入口。
- **PCB Developer**：同一套核心，另加本地集成式编辑器与更完整的开发工作流。
- 两个版本共用同一个 PCB 核心、同一个运行组件、同一套项目目录；切换不需要迁移项目。

首页把「omp」写成 **AI 运行组件**，只在 FAQ 里出现一次；「日常版 / 编程版」只在下载区的文件名分组里保留兼容匹配。

## 语言

- 优先级：`?lang=` → `localStorage.pcbSiteLang` → `navigator.language` → `zh`。
- 切换语言会带 `?lang=` 重新加载（静态页，最省事也最不会错位），同时记录到 `localStorage`。
- `data-i18n`（文本）、`data-i18n-placeholder`、`data-i18n-alt` 三种 key 由 `applyDom()` 套用；
  `<html lang>`、`<title>`、`<meta name="description">` 也跟着变。
- 字典缺 key 时先用中文兜底，再用 key 本名——宁可露出 key，也不静默丢一句话。
- 页面上只剩一处中文固定文本：语言切换里的「中文」。

## 五个环境变量

| 变量 | 做什么 | 没有它时 |
|---|---|---|
| `INTRO_MODEL_BASE_URL` | OpenAI 兼容接口的根地址（脚本会拼 `/chat/completions`） | 输入框仍在，回答是一句固定的「介绍助手还没接上」 |
| `INTRO_MODEL_API_KEY` | 调模型的密钥，只在服务端用 | 同上 |
| `INTRO_MODEL_NAME` | 模型名，原样放进请求体的 `model` | 同上 |
| `GITHUB_ISSUES_TOKEN` | 建 Issue 用的令牌（只要 `repo`/`issues` 写权限） | 表单说「还不能提交：网站这边没有配 GitHub 令牌」 |
| `GITHUB_API_BASE` | 可选，默认 `https://api.github.com` | 走官方地址 |

```bash
INTRO_MODEL_BASE_URL=http://127.0.0.1:1234/v1 \
INTRO_MODEL_API_KEY=sk-... \
INTRO_MODEL_NAME=some-model \
GITHUB_ISSUES_TOKEN=ghp_... \
node server.mjs
```

密钥只从环境变量读，不写进仓库、不落盘、不回显给页面。

## 接口

失败一律是 `{ "ok": false, "code": "...", "detail"?: "..." }`——**code 是给页面翻译的，不是给人看的中文**。
页面按 `err.<code>` 查字典；`rate_limited` 按表单区分文案（`ask.rate` / `bugs.rate`）。

限额按**真实访客 IP**：连接本身来自回环（`127.0.0.1` / `::1` / `::ffff:127.0.0.1`）时才读
`X-Forwarded-For` 的第一段，所以放在 Caddy / nginx 后面仍然是一人一份额度；直连时不认这个头
（否则谁都能自己写一行 header 绕过限额）。

### `POST /api/intro`

```json
{ "question": "它能改哪些文件？", "lang": "zh", "history": [{ "role": "user", "content": "…" }] }
```

- `lang` 决定 system 说明与回答语言；`history` 只取最后 6 条，每条最多 1000 字；超长截断。
- 没配模型：`200 {ok:true, degraded:"no_model"}`，**不发模型请求、不计次**。
- 成功：`200 {ok:true, reply, lang}`。
- `429 rate_limited`：同一 IP 每小时最多 20 次；`502 model_failed` 带 `detail`。
- 对话不留存：不写数据库、不写文件。

### `GET /api/releases`

读 `https://api.github.com/repos/renjianfj163/PCB/releases`（`User-Agent: pcb-site`），跳过 draft，
优先最新的正式版；只有预发布时才展示一条并标「预发布」。

成功的结果在进程内存里缓存 **5 分钟**（匿名额度 60 次/小时，问不起每个访客一次）；失败不缓存。

返回 `{ ok: true, releases: [...] }`；没有 release 或取不到时返回 `releases: []` 外加
`reason: { code, detail? }`（HTTP 仍是 200，页面显示「还没有可下载的版本」+ PCB Desktop / PCB Developer 两行「即将发布」）。

每个 release：`version`、`tag`、`publishedAt`、`notes`、`prerelease`、`htmlUrl`、`assets`——
只挑文件名里带 `windows`、`win32` 或 `.exe` 的，带 `name`、`size`、`url`、以及可选的 `sha256`
（只有 asset 的 `digest` 真是 `sha256:<64 hex>` 时才出现）。

页面按文件名分两堆：带「desktop / 日常 / daily / basic / home」算 PCB Desktop，带「developer / 编程 / coding / code / pro」
算 PCB Developer；都不沾或同时沾上的列进「其他发行包」。不补文件名、不猜下载地址、不编校验和。

### `POST /api/bugs`

```json
{ "version": "v0.1.0", "system": "Windows", "did": "…", "saw": "…", "omp": "omp/19.0.1", "logs": "…", "lang": "zh" }
```

- 必填：`system`（Windows / macOS / Linux）、`did`、`saw`；`logs` 最多 8000 字。
- 标题是 `[bug] ` 加上「我看到了什么」前 60 个字；正文按字段分行，注明这是网站表单代开的，并记下页面语言。
- `code`：`bad_json`、`too_large`、`bad_system`、`missing_fields`、`no_token`（503）、
  `rate_limited`（429）、`github_failed`（502，带 `detail`）。
- 同一 IP 每小时最多 5 次；不上传文件。

## 页面

深色文档 + 桌面软件的克制风格：底色 `#08090b`、卡片 `#101216`、细边 `rgba(255,255,255,.09)`、
正文 `#edeef0`、次要 `#969ca6`、强调 `#5b8cff`（只用于主按钮、链接、章节眉与编号）；没有第二套浅色主题，
因为产品本身就是深色桌面应用。字体 `-apple-system, "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", system-ui`。

顺序是：定位（LOCAL AI WORKSPACE + 一句主张 + 三个硬指标 + 两个入口）→ 本机窗口里的真实截图 →
Chat / Plan / Build 三张编号卡 → 五条工作流事实 → 五条安全边界 → 两个版本 → 统一入口的收束段 →
下载 → FAQ 与介绍助手 → 收起的「报告问题」→ 关于与许可。1280 与 390 两个宽度都验过。
