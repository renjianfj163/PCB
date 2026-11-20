# 架构

PCB 没有自己的 agent，也没有第二层假对话。**一个会话就是一个 `omp --mode rpc-ui` 子进程**，
PCB 是它的宿主进程和界面。

```
浏览器 / 窗口           PCB 进程                        omp 子进程（每会话一个）
┌──────────────┐   ┌────────────────────────┐   ┌──────────────────────────────┐
│ 三栏界面      │◀─▶│ server/app.ts  HTTP     │◀─▶│ --mode rpc-ui                │
│ (web/dist)   │SSE│ server/session.ts       │std│ --approval-mode always-ask   │
└──────────────┘   │ server/policy.ts 裁决    │in │ -e <omp-ckpt 宿主扩展>        │
                   │ server/hub.ts 广播       │out│ --cwd <项目根>                │
                   └────────────────────────┘   └──────────────────────────────┘
```

## 启动

`npm start` 跑 `server/main.ts`，由 Node 直接执行 TypeScript（不需要先编译服务端）。
它监听 `PCB_HOST:PCB_PORT`（默认 `127.0.0.1:7777`），把 `web/dist` 作为静态站点发出，
并挂上本地的 JSON 接口与一条 SSE 流。

## 一个会话一个子进程

创建会话时（`POST /api/sessions`）`server/omp-args.ts` 组出这条 argv：

- `--mode rpc-ui`：机器可读的帧，而不是它自己的终端界面；
- `--approval-mode always-ask`：每个写文件、跑命令的调用都回到 PCB，由 PCB 用自己的政策层裁决，
  而不是信任 omp 的静态模式；
- `--append-system-prompt <policy>`：把阶段语义（Chat / Plan / Build）写进系统提示；
- `-e <host>`：只加载 omp-ckpt 宿主扩展（审查服务），`--no-extensions` 关掉发现；
- `--cwd <项目根>`，续聊时再加 `--resume <会话文件>`。

服务端只在这个入口 spawn 一次 omp。界面刷新、重开窗口、右栏开关都不会新起进程。

## 帧怎么走

1. omp 往 stdout 写一行一条 JSON 帧；`server/session.ts` 解析并按类型处理：
   `message_*`（助手文本）、`tool_execution_*`（工具卡片）、`extension_ui_request`（要你点头的卡片）、
   `agent_start` / `session_settled`（回合起止）、`get_state` / `get_messages` 的应答。
2. 权威状态（阶段、模型、上下文用量、花费）来自 omp 的 `get_state`，消息来自 `get_messages`；
   PCB 不自己数 token，也不算钱。
3. `server/hub.ts` 把帧广播成 SSE：`GET /api/events` 上是 `{t:"frame"|"state"|"dialog"|"session"}`。
   界面是订阅者；`omp-ckpt` 编辑器扩展是另一个订阅者，但它只听自己会话的帧。
4. 用户输入反向走 HTTP：`prompt` / `abort` / `dialog` / `phase` / `model`。

## 政策层：唯一决定「能不能动手」的地方

`server/policy.ts` 里只有一件事：给定阶段与工具，回答「直接做 / 问 / 拒绝」。

- `chat` 与 `plan` 阶段：任何会改工作区或执行代码的调用都拒绝，并给出人话原因；
- `build` 阶段：写文件按用户选的 `write` 模式静默进行，跑命令仍然问；
- 审批结论追加到 `~/.pcb/policies/<id>.jsonl`，重启后能与终端里那几条记录对上。

界面不自己做决定，也不重写这套裁决——它只负责把「问」变成一张可点的卡片，把「拒绝」变成一行
看得懂的理由。

## 状态存在哪

| 位置 | 内容 |
| --- | --- |
| `~/.pcb/state.json` | 项目列表、会话索引、自动化定义；**不存对话本体** |
| `~/.pcb/policies/*.jsonl` | 审批记录 |
| omp 自己的会话文件 | 对话本体，`--resume` 用它续聊 |
| `~/.omp/agent/blobs` | 截图与附件，PCB 只读引用 |

## 边界

- 只听回环，见 [security.md](security.md)；
- PCB 不含模型、不含 omp：没有 `omp` 时它启动并明确报错；
- 审查（逐块接受 / 还原）由 omp-ckpt 宿主扩展提供，PCB 只连它，不在服务端重算 diff。

## 测试

`npm test` 跑 37 条：会话生命周期、帧翻译、政策矩阵、SSE 广播、桌面编辑器启动、
项目目录的路径锁、会话命名。`npm run verify` 再加上两份 tsconfig 的类型检查。
