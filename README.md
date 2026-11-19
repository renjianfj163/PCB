# PCB

给不写代码的人用的本地壳。对话、计划和改文件都由本机的 `omp` 子进程做，界面只做三件事：把 omp
的 RPC 帧翻译成人能看懂的样子、在动手前挡住危险操作、把「计划」变成一句可以点「按这个做」的话。

没有第二层假对话，也没有自己实现的 agent：每个会话就是一个 `omp --mode rpc-ui` 子进程。服务只监听
`127.0.0.1`。

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
`PCB_OMP_CKPT_HOST`（替换默认的 omp-ckpt 宿主扩展路径，见下）、`PCB_VSCODE_SERVER_FILE` /
`PCB_VSCODE_SERVER_URL`（VS Code 网页端压缩包的自备来源，见下）。

## 打开就能说

1. 左侧先选一个项目文件夹（或点「添加项目」，服务用 Windows 文件夹对话框让你挑）。
2. 主区域是空首页：「想做什么？」+ 白色输入卡片（浅灰底，无渐变）。Enter 发送，Shift+Enter 换行。
3. 第一次发送才创建会话（`extensions: false`），立刻把这句话发给 omp，然后进入工作台。
   没选项目时发送按钮不可用。

## 界面外壳

三栏，`1440×900` 下同时可见，整页不滚动（中间列和右栏各自滚动）：

| 区域 | 内容 |
| --- | --- |
| 左栏 256px | PCB 与 omp 版本、New、Search（Ctrl K）、Projects（可展开、当前项高亮）、添加项目、Automations、当前项目的对话列表。右上角图标可整栏收起（记在 `localStorage["pcb.leftPanel"]`），收起后中间列占满，顶栏左侧出现展开按钮；宽度 < 768px 时变成抽屉，顶栏左侧按钮打开。 |
| 中间列 | 顶栏 48px（会话名 + 模型下拉 + 右栏开关/恢复/IDE/刷新图标按钮），下面是对话区；底部是浮在列内的白色输入卡片（`min(720px, 列宽-48px)`，距底 24px），卡片左下角一行小字显示上下文与花费，右下角是「规划 / 执行 / 聊天」下拉和发送/停止。 |
| 右栏 默认 400px | 顶部胶囊分段「文件 / 计划 / 终端 / 浏览器」+ 收起按钮。折叠状态记在 `localStorage["pcb.rightPanel"]`，宽度 < 1024px 默认收起。与中间列之间有一条 6px 拖拽条，可左右拉动改两栏比例（存 `localStorage["pcb.railW"]`，范围 320–600px）。 |

阶段只在下拉里切换，切换只影响下一条消息，不会自动发送；批准仍然只有右栏的「按这个做」。

底部状态行显示 `上下文 N%` 与 `已花费 $x.xxxx`：金额取自 omp 的 `get_session_stats`，
不是界面估算；单位是美元原值。

顶栏的「IDE」按钮（`POST /api/vscode/open`，见 `server/vscode-web.ts`）给这台机器开一个 **VS Code 网页**：
只绑 `127.0.0.1`，工作区设为当前会话的目录，用系统浏览器打开——编辑器在窗口里，不在三栏里。
可执行文件按 `PCB_VSCODE_WEB` → `openvscode-server` → 能响应 `serve-web` 的 `code`（PATH，再退到
`%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd`）查找；启动参数固定带 `--host 127.0.0.1`、
`--port 0`（让服务自己挑端口）和 `--accept-server-license-terms`。
`openvscode-server` 用 `--default-folder` 指工作区；没有这个参数的构建（如 `code serve-web`）就把文件夹
拼进它打印出来的本机地址（`&folder=…`）。omp-ckpt 的 vsix（`PCB_CKPT_VSIX`，默认
`D:\Developer\zed_omp\omp-ckpt-0.1.0.vsix`）在一个 PCB 进程里只装一次；同一个服务也只起一次，再次点击只是
重开那个地址。三个候选都没有时只回一行「本机没有 VS Code 网页服务」，不下载、不安装、也不去开桌面版。
服务要用网络下载自己的网页端，而 Node 不读 WinINET，所以启动前对系统代理的 `host:port` 打一次短探测
（SOCKS5 问候 `05 01 00`，回 `05` 的是 SOCKS，回状态行的是 HTTP，800 ms 无回应就算不知道）。
`code-tunnel` 只认 `HTTP_PROXY`/`HTTPS_PROXY`，二进制里没有 `socks5` 字样，把 SOCKS 地址冒充成
`http://` 它就会连上然后一声不响——所以**探测到 SOCKS 时不再把 SOCKS 地址交给子进程**：PCB 在
`127.0.0.1` 上起一个只给这次用的 HTTP `CONNECT` 代理（`server/socks-bridge.ts`），由它转上游 SOCKS5，
子进程拿到的是 `HTTP_PROXY`/`HTTPS_PROXY=http://127.0.0.1:<这个端口>`，`ALL_PROXY`/`all_proxy` 一律不带，
`NO_PROXY` 仍是 `127.0.0.1,localhost`。确认是 HTTP 代理时仍是 `HTTP_PROXY`/`HTTPS_PROXY=http://…`，不起桥；
探测不出来就不给这个进程带代理，绝不猜成 `http://`。

那个包约 250 MB（这台机器 ~260 KB/s，顺利时约 16 分钟），第一次点「IDE」要下它，下载页面是 PCB 自己给的（`/ide/wait`，带进度条和已等待秒数，
并轮询 `/api/vscode/status`），好了一律自动跳进编辑器。进度条有真实百分比：`code-tunnel` 整包缓存在内存里、
目录到最后一刻都是 0 字节，所以在 Windows 上读它 `\Process(code-tunnel*)\IO Data Bytes/sec` 的速率并积分成字节数，
除以 `update.code.visualstudio.com` 那个 zip 的 `content-length`（见 `server/download-progress.ts`，实测 244–261 KB/s）。
量不出来（没有计数器、问不到大小）就退回不确定态的滚动条，不编造数字。**下不下来时不要再等**：把它放到本机，
让 PCB 直接解到 `%USERPROFILE%\.vscode\cli\serve-web\<commit>\`（就是 CLI 自己要填的那个目录），
它就不下载了：

| 变量 | 含义 |
|---|---|
| `PCB_VSCODE_SERVER_FILE` | 已经下好的 Server 压缩包（`.zip`）路径，不做网络访问 |
| `PCB_VSCODE_SERVER_URL` | 这台机器能访问到的压缩包地址（自有镜像），经系统代理用 curl 取 |
| `PCB_VSCODE_CLI_DIR` | 覆盖 `~/.vscode/cli`（CLI 数据目录不在默认位置时用） |

`<commit>` 不猜：它取自 CLI 自己留下的 `serve-web/<commit>.staging`（`code --version` 给的是客户端提交，
不是「最新 Server」的提交）。所以顺序是——先点一次让它建出 `.staging`、把包放好、设上面两个变量之一、
再点一次。压缩包按 CLI 自己的方式原样解进 `<commit>/`，不拍平目录。等过 30 分钟还没好，
等待页会把这一行原因写出来，而不是一直停在 downloading。
`server/proxy.ts` 的返回值不变，截图与网页预检照旧用那个字符串。
`/api/sessions/:id/export` 仍在，只是顶栏不再调用它。

左下角配置卡里还有一个调试开关「显示 omp 原文」（`localStorage["pcb.ompRaw"]`，缺省关）。开着时，
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

启动 omp 时比「模式 + cwd + 审批 + 系统提示」只多带一个扩展：`-e <omp-host.ts>`（默认
`D:\Developer\zed_omp\host\omp-host.ts`，`PCB_OMP_CKPT_HOST` 可换）。`--no-extensions` 关的是扩展**发现**，
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
- `POST /api/projects`、`DELETE /api/projects`（body 带 `cwd`，只动清单）
- `GET/POST /api/automations`、`PATCH /api/automations/:id`（启停/改时间）、`DELETE /api/automations/:id`、`POST /api/automations/:id/run`
- 其余沿用 `/api/sessions/...`；新增类型都在 `shared/protocol.ts`，浏览器只走 `web/src/api.ts`
- 所有接口只认本机 Host；写操作（POST/DELETE/PATCH）额外要求同源 `Origin` 和 `X-PCB-Request: 1` 头，防止别的网页驱动这个壳

## 已知限制

- **登录**：密钥类输入 omp 不接受 RPC 提交，需要终端 `omp login`。壳只显示哪些 provider 已登录。
- **扩展**：会话固定以 `--no-extensions` 启动，避免扩展往用户目录里写文件。
- **交互式命令**：`--mode rpc-ui` 会关掉 PTY，需要输入密码/TUI 的命令跑不起来。
- **审批选项**：omp 给的是英文标签，壳按标签映射成中文按钮；未知标签原样显示。
- **文件选择器**：只有 Windows 有系统文件夹对话框；其他系统用 `POST /api/projects` 手动加路径。
- **定时任务**：依赖 PCB 进程活着；关机或关掉服务就跳过，不补跑。
- **进程数**：每个打开过的会话常驻一个 omp 子进程，暂无 LRU 上限。
- **文件页**：只读、无搜索、无删除/改名；隐藏文件与常见构建目录不显示。

## 验证过的路径

1. 空首页：没选项目时发送不可用；选了项目、写下第一句后进入工作台，omp 收到带 `「阶段：规划」` 的消息。
2. 规划：右栏「计划」页显示用户原话、助手正文、压成一行的工具调用与待办；「再改一改」只聚焦输入框。
3. 点「按这个做」→ 阶段变执行并自动发出执行指令；写文件静默通过，`bash` 弹卡片。
4. 规划 / 聊天阶段尝试 `bash` 或写文件仍被拒绝（`npm test` 逐项覆盖 plan/chat/build × read/write/exec）。
5. 右栏四页：文件树懒加载 + 预览 + 改过的文件；计划切段；终端命令与审批结论（重启后仍在）；example.com 的真实截图。
6. Ctrl+K 能搜到项目、会话、自动化；选中项目回空首页，选中会话打开工作台，选中自动化进自动化页。
7. 自动化「现在运行」新建对应项目的会话并立刻带阶段前缀发送；卡片显示上次运行时间；定时到点自动开一条会话。
8. 恢复会话：历史约十几秒回放完成后自动填入；期间显示「正在载入这段对话…」。回合进行中再发消息会排队而不是报错。
