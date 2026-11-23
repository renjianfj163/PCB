# PCB 网站（site/）

PCB 的开源项目门面：一页两语（中文 / English）。一个软件包，不区分日常版和编程版。
已经能用的写成事实：界面、Oh My Pi（OMP）。演示、发布、支付标成规划中。页面不介绍 OMP-ckpt。
只做两件事：介绍、给版本下载；问题入口直接指向 GitHub 的表单。

**公网版本是纯静态页**：只发 `public/` 这一套文件，没有自己的接口、没有密钥、没有服务端进程。

## 公网部署（当前形态）

- 托管：一个独立的静态项目（Vercel），项目里只有 `public/` 的内容，根路径直出 `index.html`。
- 域名：`lab.zhanmingedu.com`。它和 `zhanmingedu.com`、`www` 不是同一个项目——后两者是主站，
  不要把这里的文件部署进那个项目，否则主站会被换掉。
- 页面用到的路径都是根路径（`/app.js`、`/styles.css`、`/i18n/zh.json`、`/shots/app.png`），
  所以项目根目录就是 `public/`。
- 不需要任何环境变量。

### 页面自己做的事

| 位置 | 怎么做 | 失败时 |
| --- | --- | --- |
| 下载区 | 卡片上的版本、文件名、大小、发布日期、SHA256 全部来自浏览器读的 `https://api.github.com/repos/renjianfj163/PCB/releases`（公开接口、可跨域）：只认**正式版**，只认文件名以 `PCB-` 开头的 `.exe`（同一仓库里 `omp-windows-x64.exe` 这类制品不算产品包，整条发布不出现），SHA256 取 GitHub 给资产的 `digest`；其它版本（含 `main-build` 这类预发布）列在「其他版本」里。页面里只有占位符与「版本信息见 GitHub Releases」，没有任何写死的版本号 | 卡片停在提示并链到 Releases；「其他版本」整块隐藏。不编造版本、大小或校验和 |

| 报告问题 | 一条静态链接，指向仓库的 bug_report 表单 | 不适用（不经过本站） |
| 介绍助手 | **已下线**：它需要模型密钥和一组限流接口，静态页没有 | — |

匿名调用 GitHub API 的额度是每 IP 每小时 60 次，页面每次加载只读一次；读不到就保持卡片里的提示，
并让人顺着按钮去 Releases 页。**出新版本不需要重新部署站点**——发 Release 即生效；只有改文案或结构
时才要重发 `public/`。

## 文件

| 文件 | 内容 |
| --- | --- |
| `public/index.html` | 结构与文案骨架；文字挂 `data-i18n` key，正文里放中文原文当兜底 |
| `public/styles.css` | 全部样式；深色，无外部字体 |
| `public/app.js` | 读字典、套用 key、读 GitHub 版本列表并渲染 |
| `public/i18n/zh.json`、`en.json` | 两种语言的字典（key 必须一致） |
| `public/shots/candy.gif` | 首屏动图：第一帧是 Candy Crush in one sentence，后面演示用一句话做出三消。源画面在 `storyboard/` |
| `public/shots/app.png` | 旧的首屏静图，页面不再使用 |
| `server.mjs` | **本机预览用**，公网不部署。见下 |

## 本机预览

`public/` 是纯静态的，任何静态服务器都行：

```bash
cd site/public && python -m http.server 8787
# 或者用下面的 server.mjs（自带同一套静态文件 + 三个本机接口）
cd site && node server.mjs
# PCB 网站：http://127.0.0.1:8787
```

`server.mjs` 默认只监听 `127.0.0.1:8787`，要换端口用 `SITE_PORT`。它保留着
`/api/intro`（介绍助手）、`/api/releases`（代为读 GitHub，成功缓存 5 分钟）、
`/api/bugs`（代为开 Issue）三个接口，**页面不再调用它们**——公网静态版没有这些能力，
留着只是为了在本机调试或以后另做服务端形态时不必重写。

### server.mjs 的环境变量（公网静态版一个都不需要）

| 变量 | 做什么 | 没有它时 |
|---|---|---|
| `INTRO_MODEL_BASE_URL` | OpenAI 兼容接口的根地址（脚本会拼 `/chat/completions`） | `/api/intro` 返回 `degraded:"no_model"` |
| `INTRO_MODEL_API_KEY` | 调模型的密钥，只在服务端用 | 同上 |
| `INTRO_MODEL_NAME` | 模型名，原样放进请求体的 `model` | 同上 |
| `GITHUB_ISSUES_TOKEN` | 建 Issue 用的令牌（只要 `repo`/`issues` 写权限） | `/api/bugs` 返回 `no_token` |
| `GITHUB_API_BASE` | 可选，默认 `https://api.github.com` | 走官方地址 |

密钥只从环境变量读，不写进仓库、不落盘、不回显给页面；公网静态版里根本没有这些变量。

### server.mjs 的接口约定（本机形态）

失败一律是 `{ "ok": false, "code": "...", "detail"?: "..." }`——code 给页面翻译，不是给人看的中文。
限额按**真实访客 IP**：连接本身来自回环（`127.0.0.1` / `::1` / `::ffff:127.0.0.1`）时才读
`X-Forwarded-For` 的第一段，所以放在反代后面仍然是一人一份额度；直连时不认这个头。

`/api/intro` 每小时 20 次、`/api/bugs` 每小时 5 次；`/api/releases` 成功结果在内存里缓存 5 分钟，
失败不缓存。

## 一个软件包

页面按一个 PCB 来写，不再把安装包说成日常版和编程版。改文案前先读 `docs/install.md`：

- 普通用户留在界面里，用自然语言走 Chat / Plan / Build / Review。
- 开发者可以打开本机已安装的桌面版 VS Code 或 Cursor。
- OMP 在首页就写明：每个会话是本机的 OMP RPC 子进程，PCB 没有第二套 Agent。
- 产品演示 Skill、社交推广、支付接口使用「规划中」标记，不写成已经提供。

下载区只给一个 Windows 安装包。已经是 `PCB-<版本>-windows-x64.exe` 时用它；旧发布若还有 Desktop 和 Developer 两个文件，页面只留 Developer 那一个。构建说明见 `window/installer/README.md`。

## 语言

- 优先级：`?lang=` → `localStorage.pcbSiteLang` → `navigator.language` → `zh`。
- 切换语言会带 `?lang=` 重新加载（静态页，最省事也最不会错位），同时记录到 `localStorage`。
- `data-i18n`（文本）、`data-i18n-placeholder`、`data-i18n-alt` 三种 key 由 `applyDom()` 套用；
  `<html lang>`、`<title>`、`<meta name="description">`、`og:title`、`og:description` 也跟着变。
- 字典缺 key 时先用中文兜底，再用 key 本名——宁可露出 key，也不静默丢一句话。
- 两个字典必须同 key 同数量；页面上只剩一处中文固定文本：语言切换里的「中文」。
- 产品旅程里的阶段名：英文页用 `Chat / Plan / Build / Promote / Monetize`，中文页把 `对话 / 规划 / 实现 / 推广 / 变现`
  放在 `journey.*` 里。状态永远是 `可用 / 规划中`（英文 `Available / Coming next`），
  前三个阶段可用，后两个是规划。首屏不再重复这条五阶段轨。

## 页面

深色文档 + 桌面软件的克制风格：底色 `#08090b`、卡片 `#101216`、细边 `rgba(255,255,255,.09)`、
正文 `#edeef0`、次要 `#969ca6`、强调 `#5b8cff`（只用于主按钮、链接、章节眉与编号）；没有第二套浅色主题，
因为产品本身就是深色桌面应用。字体 `-apple-system, "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", system-ui`。

顺序是：Hero → Candy Crush 动图 →
工作方式（Chat / Plan / Build / Review 四步，Review 标为 Build 环节）→
产品旅程（五阶段横向轨，后两段规划中）→ 三项路线图 →
下载 → FAQ → 收起的「报告问题」→ 关于与许可。
顶栏把页内链接和「文档 / GitHub」分成两组。
1280、900 与 390 三个宽度都要看过；`document.documentElement.scrollWidth` 不应超过 `clientWidth`。
