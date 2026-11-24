# 本地接口

PCB 的界面就是这个接口的一个客户端；`omp-ckpt` 编辑器扩展是另一个。地址固定是
`http://127.0.0.1:7777`（`PCB_PORT` 可改）。

## 请求守卫

两件都必须满足，否则返回 403：

1. 带 `x-pcb-request: 1`——外部网页的表单跨域发不出这个自定义头；
2. 带 `Origin` 时，它的 host 必须等于请求的 host（见 `server/app.ts` 的 `#guard`）。

最小可用调用：

```bash
curl -s -H 'x-pcb-request: 1' http://127.0.0.1:7777/api/sessions | head -c 400
```

## 接口清单

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/boot` | 启动信息：版本、项目、当前会话摘要 |
| GET | `/api/events` | SSE 流，见下 |
| GET / POST | `/api/shell` | 没有会话时的模型与思考档位。GET：跑一次 `omp --no-session` 取模型列表、默认模型与档位（进程内缓存，并发合并；cwd 用 `lastCwd`，失败也回 200，只带已有选择），再用 `~/.pcb/state.json` 的 `choice` 盖上。POST：`{model?: {provider, id}, thinking?}`，`thinking` 必须属于 `THINKING_LEVELS`，只写 choice 并返回盖过后的同一结构，不启动 omp |
| GET / POST / DELETE | `/api/projects` | 列出项目 / 添加项目 / 退出项目（body 带 `cwd`，不动磁盘）。退出后该路径记入 `state.json` 的 `dismissed`：会话索引保留但不再出现在清单、Ctrl+K 与 `/api/sessions` 里，指向它的自动化同时暂停；重新添加同一路径（大小写、分隔符不同也算同一个路径）会话就回来。三个写接口都返回 `{projects, sessions}` |
| GET | `/api/projects/listing?cwd=&path=` | 目录列举：`{path, entries, truncated}`，只读、懒加载 |
| GET | `/api/projects/file?cwd=&path=` | 文件预览：`{path, size, kind, text?}`，`kind` 为 `text` / `binary` / `too_large` |
| POST | `/api/projects/pick` | 打开 Windows 文件夹对话框：`{cwd}` 或 `{cancelled: true}` |
| GET / POST | `/api/automations` | 列出 / 新建自动化 |
| PATCH / DELETE | `/api/automations/:id` | 启停、改时间 / 删除 |
| POST | `/api/automations/:id/run` | 立刻按该卡片跑一次（新建会话并带阶段前缀发送） |
| POST | `/api/sessions` | 新建会话并 spawn 一个 omp：`{cwd, name?, phase?, initialPrompt?, extensions?, resumeSessionFile?}` |
| GET | `/api/sessions` | 全部会话摘要（`id`、`cwd`、`status`、`updatedAt`…） |
| DELETE | `/api/sessions/:id` | 结束会话并移出列表 |
| POST | `/api/sessions/:id/resume` | 用 omp 的会话文件重新 spawn |
| POST | `/api/sessions/:id/prompt` | `{text}`：发一句；回合中由 PCB 排队 |
| POST | `/api/sessions/:id/abort` | 中止当前回合 |
| POST | `/api/sessions/:id/rewind` | `{entryId}`：把当前路径退到这条用户消息之前（只动会话树的叶子，不动文件、不带 summarize），回 `{cancelled, editorText?}`；`session_busy` / `entry_not_found` 等拒绝是 409 + `{error, code}` |
| POST | `/api/sessions/:id/phase` | `{phase}`：`plan` / `deepplan` / `build` / `chat`，只影响下一条消息；其它值回 400 |
| POST | `/api/sessions/:id/dialog` | `{id, answer}`：回答一张等你点的卡片 |
| POST | `/api/sessions/:id/model` | `{provider, modelId}` |
| GET | `/api/sessions/:id/models` | 可选模型与当前选择 |
| GET | `/api/sessions/:id/policies` | 审批记录（对得上终端里那几条） |
| GET | `/api/sessions/:id/messages` | `{messages}`：omp 的权威消息数组（`role` + `content` 块） |
| GET | `/api/sessions/:id/state` | `{state}`：阶段、模型、上下文用量、花费 |
| POST | `/api/sessions/:id/export` | 导出这一会话的 HTML，返回 `{path}` |
| POST | `/api/sessions/:id/refresh` | 主动同步 `state` 与 `messages` |
| POST | `/api/vscode/open` | `{cwd}`：打开本机桌面版 VS Code 或 Cursor 并装一次 omp-ckpt，`{ok, reason?}`。不启动网页版 |
| POST | `/api/exec` | 在项目根里跑一条命令（终端页） |
| GET | `/api/blob?ref=blob:sha256:<hash>` | 读 `~/.omp/agent/blobs` 里的附件与截图（只认 64 位十六进制哈希，16 MB 上限） |
| GET | `/api/raw` / POST `/api/raw/clear` | omp 原文调试行（界面里的「显示 omp 原文」） |
| GET | `/api/frame/check`、POST `/api/frame/open`、GET `/api/frame/shot` | 网页预检、打开、截图 |

## SSE：`GET /api/events`

`content-type: text/event-stream`，每条 `data:` 是一行 JSON：

| `t` | 含义 |
| --- | --- |
| `hello` | 连接建立，带当前会话列表 |
| `frame` | `{sessionId, frame}`：omp 的一帧原文，界面自己翻译 |
| `state` | `{sessionId, state}`：`streaming`、阶段、花费等 |
| `dialog` / `dialog_closed` | 一张要你点的卡片出现 / 消失 |
| `session` / `session_removed` | 会话增删 |
| `projects` | `{projects, sessions}`：项目清单变化（添加或退出），会话快照随之更新 |

只订阅自己会话的 `sessionId`，是客户端的事——服务端把所有人的帧都广播在这一条流上。

## 一次完整回合（curl）

```bash
H='-H x-pcb-request:1 -H content-type:application/json'
B=http://127.0.0.1:7777

# 1. 开一个会话（这一步才会 spawn omp）
curl -s $H -X POST $B/api/sessions \
  -d '{"cwd":"D:\\Developer\\demo","name":"demo","phase":"plan"}'

# 2. 说一句（把上一步的 id 填进来）
curl -s $H -X POST $B/api/sessions/<id>/prompt -d '{"text":"看看这个项目，给个计划"}'

# 3. 看这一回合的帧
curl -sN -H 'accept: text/event-stream' -H 'x-pcb-request: 1' $B/api/events

# 4. 改阶段，然后让它动手
curl -s $H -X POST $B/api/sessions/<id>/phase -d '{"phase":"build"}'
```

## 错误形状

失败一律是 JSON：`{"error":"人话原因"}`（会话接口）或 `{"ok":false,"reason":"…"}`（编辑器开关）。
没有堆栈，也没有把本机路径拼进提示的习惯。
