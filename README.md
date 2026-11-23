# PCB

基于 Oh My Pi（OMP）深度扩展的本地 AI 工作平台。从一句自然语言，到可以检查、可以恢复、可以继续做下去的工作。

不熟悉代码的人，用界面和 OMP 把事情做完。熟悉代码的人，打开本机已有的 VS Code 或 Cursor，用 OMP-ckpt 看 AI 改了什么，需要时退回去。

PCB 没有自己的第二套 Agent，也没有在 OMP 之外再加一层对话。每个会话就是一个本机的 `omp --mode rpc-ui` 子进程。界面做三件事：把 OMP 的过程说成人能看懂的话、在动手前挡住危险操作、把计划变成一次可以点的批准。服务只监听 `127.0.0.1`。

开源 · MIT · [文档](docs/) · [贡献](CONTRIBUTING.md) · [更新记录](CHANGELOG.md) · [网站](https://lab.zhanmingedu.com)

## 一个软件包，两种用法

| | 普通用户 | 开发者 |
| --- | --- | --- |
| PCB 界面 | 有 | 有 |
| OMP（对话、计划、改文件） | 有，装在包里 | 有 |
| 打开本机 VS Code / Cursor | 可选 | 用已安装的桌面版，工作区是当前项目 |
| OMP-ckpt | 可选 | 检查点、差异、选择性恢复 |

是否打开 IDE，由工作习惯决定，不是另一个产品。编辑器不装在包里，也不下载网页版 VS Code。

`omp` 必须在：PCB 自己没有另一套模型。去掉它之后窗口能开，但发不出消息，也执行不了计划。

打开后不是带地址栏的浏览器。页面仍是 `http://127.0.0.1:7777`，窗口只留应用名和最小化、最大化、关闭，不再叠一套 File / Edit / View 菜单（PCB 里已有顶栏）。关窗口时服务可以留在托盘继续跑——定时的任务挂在那个进程上，错过的不补跑。

安装包只有一个：`PCB-<版本>-windows-x64.exe`。里面没有 VS Code。想写代码的人自己安装桌面版 VS Code 或 Cursor，顶栏「IDE」会打开已经装好的那个。见 [window/installer/README.md](window/installer/README.md)。

## 快速开始

```bash
npm install          # 根目录：类型检查用
npm run setup        # web/：React + Vite
npm run build        # 构建界面到 web/dist
npm start            # 打开 http://127.0.0.1:7777
```

校验（类型 + 纯函数回归）：

```bash
npm run check    # 服务端与 web 两个 tsconfig
npm run test     # 策略矩阵、阶段切段、终端审批配对、路径归一
npm run verify   # 两件一起
```

开发模式（服务端热重启 + Vite HMR）：

```bash
npm run dev          # 服务端 :7777，界面 :5173（/api 代理到 7777）
```

前置条件：`omp` 在 PATH 里且已登录（`omp login`）。`omp --version` 应输出 `omp/18.22.0` 或更新。

环境变量：`PCB_PORT`（默认 7777）、`PCB_HOST`（默认 127.0.0.1）、`PCB_OMP`（默认 `omp`）、
`PCB_PROXY`（覆盖系统代理检测，`off` / `none` / 空表示不用代理）、`PCB_CHROME`（指定截图用的浏览器路径）、
`PCB_OMP_CKPT_HOST`（omp-ckpt 宿主文件；不设或文件不存在时不加载，会话照常）、`PCB_VSCODE`（本机 `code` 命令）、
`PCB_CKPT_VSIX`（omp-ckpt 扩展包；不设则「IDE」只打开编辑器）。

## 打开就能说

1. 左侧先选一个项目文件夹（或点「添加项目」，服务用 Windows 文件夹对话框让你挑）。
2. 主区域是空首页：「想做什么？」+ 白色输入卡片（浅灰底，无渐变）。Enter 发送，Shift+Enter 换行。
3. 第一次发送才创建会话（`extensions: false`），立刻把这句话发给 omp，然后进入工作台。
   没选项目时发送按钮不可用。

## 界面外壳

三栏，`1440×900` 下同时可见，整页不滚动（中间列和右栏各自滚动）：

| 区域 | 内容 |
| --- | --- |
| 左栏 256px | PCB 与 omp 版本、New、Search（Ctrl K）、Projects（可展开、当前项高亮）、添加项目、Automations、当前项目的对话列表；左下角齿轮打开「设置」页（版本、更新、模型登录、语言、调试、安装位置、日志）。右上角图标可整栏收起（记在 `localStorage["pcb.leftPanel"]`），收起后中间列占满，顶栏左侧出现展开按钮；宽度 < 768px 时变成抽屉，顶栏左侧按钮打开。 |
| 中间列 | 顶栏 48px（会话名与路径 + 右栏开关/恢复/IDE/刷新图标按钮），下面是对话区；底部是浮在列内的白色输入卡片（`min(720px, 列宽-48px)`，距底 24px）：第一行输入框；第二行左边「上下文 N% · 已花费 $x」，中间是「模型 ▾」控件（点开是模型列表 + 思考档位，改的是当前会话，同时记成下一次新对话的选择），右边「压缩 / 图片 / 规划 / 发送」。窄列时这一行的按钮整体折到下一行，不会挤压。 |
| 右栏 默认 400px | 顶部胶囊分段「文件 / 计划 / 终端 / 浏览器」+ 收起按钮。折叠状态记在 `localStorage["pcb.rightPanel"]`，宽度 < 1024px 默认收起。与中间列之间有一条 6px 拖拽条，可左右拉动改两栏比例（存 `localStorage["pcb.railW"]`，范围 320–600px）。 |

阶段只在下拉里切换，切换只影响下一条消息，不会自动发送；批准仍然只有右栏的「按这个做」。

底部状态行显示 `上下文 N%` 与 `已花费 $x.xxxx`：金额取自 omp 的 `get_session_stats`，
不是界面估算；单位是美元原值。

顶栏的「IDE」按钮（`POST /api/vscode/open`，见 `server/vscode-desktop.ts`）打开**本机桌面版 VS Code**，
没有安装时改开 **Cursor**。工作区是当前会话的目录。不下载安装包，也不起网页版。查找顺序：
`PCB_VSCODE`（可以指向其中任意一个），然后已安装的 VS Code（稳定版，再 Insiders），然后已安装的
Cursor，最后是 PATH 里的 `code` 或 `cursor`。两边都在时用 VS Code，避免 Cursor 自带的 `code` 把它挡住。

omp 仍是 PCB 已经拉起的那个进程。按钮做两件事：若设置了 `PCB_CKPT_VSIX` 且文件存在，把那个 vsix
在这个 PCB 进程里装进该编辑器一次，然后执行
`code <会话目录>` 或 `cursor <会话目录>`。扩展里的对话连回 PCB，审查连 omp 宿主在 `127.0.0.1` 上的服务。
装扩展失败也照样打开窗口。两个都找不到时只回一行「本机没有 VS Code 或 Cursor」。
`/api/sessions/:id/export` 仍在，只是顶栏不再调用它。

左下角的齿轮打开「设置」页：版本、更新、模型登录、语言、调试、安装位置与日志都在那一页。设置页里的调试开关
「显示 omp 原文」（`localStorage["pcb.ompRaw"]`，缺省关）开着时，
中间列底部多一块 180px 的等宽记录，逐行显示**当前会话** omp 子进程的 stdout / stderr 原文：
每行是 `时:分:秒` + 流名 + 原文，单行超 2048 字符截断、大段 base64 / `data:` 换成短占位。
它走自己的一条 SSE（`GET /api/raw`），不进 `/api/events`：第一个窗口连上才开始记，
最后一个断开就把所有会话的缓冲丢掉，每个会话最多 1000 行，打开之前的输出不补。
关着时不建流、不缓冲、不落盘，对话与终端的解析一模一样。


## 右栏四页

| 页 | 数据来源 | 说明 |
| --- | --- | --- |
| 文件 | 两个只读接口（列目录、读文件）+ 会话里的写操作 | 懒加载树、预览、改过的文件；只读 |
| 计划 | 消息里最后一段「阶段：规划」的完整对话 + `get_state.todoPhases` | 用户原话、助手正文、工具调用压成一行，下面是待办与「按这个做」「再改一改」 |
| 终端 | 会话里的 `bash` 工具调用与输出 + 服务端 `tool_policy` 事件 | 时间、命令、输出、成功/失败/运行中、自动放行/等待审批/已批准/已拒绝；只读，不能再跑 |
| 浏览器 | 任何工具结果里的 image 块（omp 既可能走 `browser` 工具，也可能在 `eval` 里调 browser API） | 最近一次截图 + 地址 + 时间 + 产出它的工具；下面列更早的。实测 `get_messages` 会把截图还原成 base64，直接内联渲染；若某条消息只留下 `blob:sha256:` 引用，则由 `GET /api/blob` 读本机缓存 |

浏览器页顶部的地址栏是先查后放：`GET /api/frame/check` 让 curl 走这台机器自己的代理
（win32 读 `HKCU\...\Internet Settings` 的 `ProxyEnable` / `ProxyServer`，`PCB_PROXY` 可覆盖）取一次响应头，
只有站点头允许才进 iframe。站点头拒绝内嵌（`X-Frame-Options` / CSP `frame-ancestors`）但网络能通的，
直接交给系统默认浏览器打开（`POST /api/frame/open`），栏里只留一行「… 不允许内嵌，已在系统浏览器打开。」，
不再给按钮——那是一次顶层加载，内嵌规则管不到；连不上的才给诊断和 `截图看看`（本机 Chrome/Edge，走同一套代理设置）。

审批结果由服务端新事件 `{t:"tool_policy", tool, decision}` 推送（`auto_allow` / `approval_required` / `approved` / `rejected` / `denied`），
终端页按「同一工具的下一条命令」把它们对上；重启服务后旧决策不再重放，只显示命令本身。

文件页的边界：只列项目根目录以内、点一层读一层（懒加载）；跳过 `.git`、`node_modules`、`.venv`、`dist`、`build` 等目录和所有点文件；
单个文件夹最多列 400 项；文件预览上限 256 KB，二进制只显示大小；`..` 与指向项目外的符号链接一律拒绝；整页只读。

所有把 omp 事件翻译成界面数据的地方都在 `web/src/adapters.ts`，四个页面共用，不各自解析原始消息。

## 侧栏

固定顺序：

| 项 | 行为 |
| --- | --- |
| New | 清空当前选择，回到空首页。不创建进程。 |
| Search | 打开命令面板（Ctrl+K 同一个）。可搜项目名、路径、会话名、自动化名称。 |
| Projects | 可展开的文件夹列表；点一项即定为下一条新对话的文件夹，并只列出该文件夹的对话。 |
| 添加项目 | 服务弹 Windows 文件夹对话框（PowerShell STA + FolderBrowserDialog，脚本用 `-EncodedCommand` 传，避免 5.1 按 ANSI 读中文）。取消则什么都不做；对话框打不开时左下角「手动输入路径」可直接粘贴路径。 |
| Automations | 自动化页（不塞进对话流）。 |
| 对话 | 当前项目下的会话；删除只清 PCB 索引并关掉进程，不删项目文件。 |

启动 omp 时比「模式 + cwd + 审批 + 系统提示」只多带一个扩展：`-e <omp-host.ts>`（只在
`PCB_OMP_CKPT_HOST` 指向一个存在的文件时带上）。`--no-extensions` 关的是扩展**发现**，
不挡这条显式路径，所以用户装的其它 omp 扩展照旧不加载。那个宿主的 checkpoint 与 review 服务跑在 omp 进程里，
VS Code 的 omp-ckpt 扩展只是连上来，不另外拉 omp；宿主文件不存在时就不带这个 `-e`，会话照常启动。

## 三个阶段（由壳实现）

omp 的 plan mode 在 RPC 下不可驱动（`/plan` 只有 TUI handler，会被当普通文本发给模型），所以阶段
由壳自己保证，靠的是审批策略而不是提示词。omp 始终以 `--approval-mode always-ask` 启动，凡是
非读操作都会回到壳里：

| 阶段 | 读 | write / edit / ast_edit / apply_patch / notebook_edit / mcp__* | 浏览器 | bash / eval / task / 未知工具 |
| --- | --- | --- | --- | --- |
| 规划 plan | 自动允许 | 拒绝 | 拒绝 | 拒绝 |
| 执行 build | 自动允许 | 自动允许 | 同一条用户消息里第一次弹卡片，允许后这条消息内的后续 browser 自动放行 | 弹卡片问人 |
| 聊天 chat | 自动允许 | 拒绝 | 拒绝 | 拒绝 |

执行阶段的浏览器只记一条「这条消息已经允许过」的进程内记号：不写会话记录、不广播、不进 `state.json`。
用户再发一条消息（含排队的 follow_up）或切阶段就清掉，下一次 browser 重新问；用户点拒绝不记记号；
规划 / 聊天阶段即使记号还在也照旧拒绝。`bash`、`eval`、`task`、未知工具执行阶段仍然每次都问。

聊天只回答问题，不写文件、不跑命令；要动手就切到「执行」。

用户消息一律由 `session.prompt` 按当前阶段加上 `「阶段：规划」` / `「阶段：执行」` / `「阶段：聊天」` 前缀。

批准只有一处：右栏「计划」页的「按这个做」——切到执行阶段并补一句「按上面的计划开始执行。」
「再改一改」只把焦点放回输入框，不发消息。

## 自动化

存在 `~/.pcb/state.json` 的 `automations` 里：`id / name / cwd / phase / prompt / enabled / dailyAt / lastRunAt / lastError`。

- 「现在运行」用该 cwd 新建一条会话并立刻 prompt，阶段用卡片上的 phase；不碰 omp 的 `/loop`。
- 每天定时只在 PCB 服务开着时生效：每分钟检查一次，本地时间 `HH:mm` 相等且今天没跑过就跑；服务没开就跳过，不补跑。
- 运行失败时卡片上显示一句中文原因（`lastError`）。

## 目录

```
server/
  main.ts         入口、端口、优雅关闭、启动定时器
  app.ts          REST + SSE + 静态资源 + 项目目录选择 + 自动化与定时 + 本机请求校验
  session.ts      一会话一进程：生命周期、审批策略、状态/transcript 镜像、首条消息
  policy.ts       工具分级与阶段裁决（唯一决定「能不能动手」的地方）
  policies.ts     ~/.pcb/policies/<id>.jsonl：审批结论，重启后仍能对上终端记录
  project-files.ts  只读的目录列举与文件预览（路径锁死在项目根内）
  vscode-desktop.ts  用本机桌面版 VS Code 或 Cursor 打开会话目录，并装一次 omp-ckpt
  blobs.ts        ~/.omp/agent/blobs 下截图的只读出口
  hub.ts          SSE 广播
  store.ts        ~/.pcb/state.json（项目 / 会话索引 / 自动化，不存对话本体）
  rpc/client.ts   JSONL 客户端：分帧、v2 chunk 重组、id 关联
shared/protocol.ts  服务端↔浏览器契约
test/               node --test：策略矩阵、阶段切段、终端配对、路径归一
web/
  src/App.tsx      三栏布局 + 视图切换 + 命令面板 + 阶段下拉
  src/adapters.ts  omp 事件 → 界面数据（改过的文件、计划切段、终端记录、截图）
  src/state.ts     SSE 事件的状态归约
  src/components/  Sidebar、Topbar、Home、Transcript、Composer、RightRail、
                   FilePage、PlanPage、TerminalPage、BrowserPage、Automations、Dialogs、Palette
```

对话本体由 omp 写在 `~/.omp/agent/sessions/<encoded-cwd>/`；PCB 只记索引，恢复时用
`omp --resume <sessionFile>` 回到原会话。

## 接口

- `POST /api/projects/pick` → `{ cwd }` 或 `{ cancelled: true }`
- `GET /api/projects/listing?cwd=&path=` → `{ path, entries, truncated }`（只读、懒加载）
- `GET /api/projects/file?cwd=&path=` → `{ path, size, kind, text? }`（`kind` 为 `text` / `binary` / `too_large`）
- `GET /api/blob?ref=blob:sha256:<hash>` → 图片字节（只认 64 位十六进制哈希，16 MB 上限，读 `~/.omp/agent/blobs`）
- `POST /api/projects`（添加）、`DELETE /api/projects`（退出项目：body 带 `cwd`，只动清单；该路径记入 `dismissed`，会话索引保留但不再出现，指向它的自动化同时暂停，重新添加同一路径后会话原样回来）
- `GET/POST /api/automations`、`PATCH /api/automations/:id`（启停/改时间）、`DELETE /api/automations/:id`、`POST /api/automations/:id/run`
- 其余沿用 `/api/sessions/...`；新增类型都在 `shared/protocol.ts`，浏览器只走 `web/src/api.ts`
- 所有接口只认本机 Host；写操作（POST/DELETE/PATCH）额外要求同源 `Origin` 和 `X-PCB-Request: 1` 头，防止别的网页驱动这个壳

## 已知限制

- **登录**：界面不接收密钥；首次运行和设置里会打开包内 `omp` 的登录窗口（源码运行时用 PATH 上的 `omp`），密钥只在那个窗口里输入。
- **扩展**：会话固定以 `--no-extensions` 启动，避免扩展往用户目录里写文件。
- **交互式命令**：`--mode rpc-ui` 会关掉 PTY，需要输入密码/TUI 的命令跑不起来。
- **审批选项**：omp 给的是英文标签，壳按标签映射成中文按钮；未知标签原样显示。
- **文件选择器**：只有 Windows 有系统文件夹对话框；其他系统用 `POST /api/projects` 手动加路径。
- **定时任务**：依赖 PCB 进程活着；关机或关掉服务就跳过，不补跑。
- **进程数**：每个打开过的会话常驻一个 omp 子进程，暂无 LRU 上限。
- **文件页**：只读、无搜索、无删除/改名；隐藏文件与常见构建目录不显示。

## 文档

完整文档在 [docs/](docs/)：按「只是用它 / 想接它 / 想改它」三种读者分开。

| 文件 | 内容 |
| --- | --- |
| [docs/install.md](docs/install.md) | 一个软件包里有什么、系统要求、从源码运行、环境变量、卸载 |
| [docs/usage.md](docs/usage.md) | 项目与会话、Chat / Plan / Build、批准、右栏四页、IDE 按钮、托盘 |
| [docs/architecture.md](docs/architecture.md) | 每会话一个 omp 子进程、帧怎么走、政策层、状态存在哪 |
| [docs/api.md](docs/api.md) | 本地接口清单、SSE 事件、curl 例子、请求守卫 |
| [docs/security.md](docs/security.md) | 只听回环、密钥边界、blob 出口、怎么报漏洞 |
| [docs/faq.md](docs/faq.md) | 常见问题 |

## 开源许可

MIT，见 [LICENSE](LICENSE)。

许可只覆盖本仓库的代码（本地壳、界面、测试、`site/`、文档）。**不覆盖**三样东西：
`omp`（用户自己安装、按其自身许可使用，本仓库不分发）、模型与额度（属于用户和签发方）、
编辑器（VS Code / Cursor 由其出版方授权，PCB 只打开你本机已有的那个）。第三方依赖的清单与许可
在 [NOTICE](NOTICE) 里。

`site/` 的站点是零依赖的：只用 Node 标准库和静态文件，页面上不加载任何第三方脚本。

## 验证过的路径

1. 空首页：没选项目时发送不可用；选了项目、写下第一句后进入工作台，omp 收到带 `「阶段：规划」` 的消息。
2. 规划：右栏「计划」页显示用户原话、助手正文、压成一行的工具调用与待办；「再改一改」只聚焦输入框。
3. 点「按这个做」→ 阶段变执行并自动发出执行指令；写文件静默通过，`bash` 弹卡片。
4. 规划 / 聊天阶段尝试 `bash` 或写文件仍被拒绝（`npm test` 逐项覆盖 plan/chat/build × read/write/exec）。
5. 右栏四页：文件树懒加载 + 预览 + 改过的文件；计划切段；终端命令与审批结论（重启后仍在）；example.com 的真实截图。
6. Ctrl+K 能搜到项目、会话、自动化；选中项目回空首页，选中会话打开工作台，选中自动化进自动化页。
7. 自动化「现在运行」新建对应项目的会话并立刻带阶段前缀发送；卡片显示上次运行时间；定时到点自动开一条会话。
8. 恢复会话：历史约十几秒回放完成后自动填入；期间显示「正在载入这段对话…」。回合进行中再发消息会排队而不是报错。
