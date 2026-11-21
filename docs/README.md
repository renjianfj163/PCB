# PCB 文档

PCB 是基于 Oh My Pi（OMP）深度扩展的本地 AI 工作平台。你用自己的话说明想做什么，本机的 `omp` 负责对话、计划、改文件；PCB 把这个过程收成能跟着走的界面：翻译 omp 的 RPC 帧、在动手前挡住危险操作、把「计划」变成一句可以点「按这个做」的话。熟悉代码时，可以打开本机的 VS Code 或 Cursor，并用 OMP-ckpt 检查和恢复修改。它跑在你自己的电脑上，默认只听 `127.0.0.1`。

产品演示、社交发布和支付还在规划中，不是现在的能力。

This repository is MIT-licensed (see [LICENSE](../LICENSE) and
[NOTICE](../NOTICE)). PCB is a local workspace built on `omp`; `omp` itself is a
separate engine with its own license. The app never forwards a model key and
never listens on anything but loopback.

## 三种读者，三条路

| 你想做的事 | 从这里开始 |
| --- | --- |
| 只是用它：装好、点几下、让电脑改文件 | [install.md](install.md) → [usage.md](usage.md) → [faq.md](faq.md) |
| 想接它：从别的程序驱动 PCB 的本地接口 | [api.md](api.md) |
| 想改它：看懂进程、帧、政策层再动手 | [architecture.md](architecture.md) → [security.md](security.md) → [../CONTRIBUTING.md](../CONTRIBUTING.md) |

## 全部文档

| 文件 | 内容 |
| --- | --- |
| [install.md](install.md) | 一个软件包里有什么、系统要求、从源码运行、环境变量、卸载 |
| [usage.md](usage.md) | 项目与会话、Chat / Plan / Build、批准、右栏四页、IDE 按钮、托盘 |
| [architecture.md](architecture.md) | 每会话一个 omp 子进程、帧怎么走、政策层在哪决定、状态存哪 |
| [api.md](api.md) | 本地 HTTP 接口清单、SSE 事件、curl 例子、请求守卫 |
| [security.md](security.md) | 只听回环、密钥边界、截图与 blob 出口、报告问题的正确姿势 |
| [faq.md](faq.md) | 常见问题：它会不会联网、能不能撤销、为什么需要 omp |
| [../CHANGELOG.md](../CHANGELOG.md) | 每个版本改了什么 |
| [../NOTICE](../NOTICE) | MIT 覆盖什么、不覆盖什么（omp、编辑器、模型额度） |

## 一分钟版本

```bash
npm install          # 只有源码方式需要
npm run setup        # web/ 的 React + Vite
npm run build        # 构建界面到 web/dist
npm start            # http://127.0.0.1:7777
```

前置条件只有一个：`omp` 在 PATH 里，并且已经 `omp login`。没有它，PCB 能启动，但发不出消息、
也执行不了计划——它会直说这件事，而不是假装在思考。

校验（类型检查 + 纯函数回归）：

```bash
npm run verify       # tsc 两份 tsconfig + 37 条测试
```
