# 安装

## 一个软件包

Windows 包装的是同一套 PCB 和同一个 `omp`。不按日常版、编程版分成两个产品。

| | 普通使用 | 继续开发 |
| --- | --- | --- |
| PCB 界面 | 有 | 有 |
| omp（对话、计划、改文件的引擎） | 有，装在包里 | 有 |
| 编辑器 | 不必打开 | 打开本机已有的桌面版 VS Code 或 Cursor，并使用 omp-ckpt |
| 顶栏「IDE」 | 可以不用 | 打开该编辑器，工作区是当前项目 |

`omp` 必须有：PCB 自己没有另一套模型，去掉它之后打开窗口既不能发消息，也不能执行计划。
安装包不附带编辑器，也不下载网页版 VS Code，只打开你已经装好的桌面编辑器。

安装包只有一个，文件名是 `PCB-<版本>-windows-x64.exe`。它不附带 VS Code。想用编辑器的人自己安装桌面版 VS Code 或 Cursor，顶栏「IDE」打开已经装好的那个。打包细节见 [window/installer/README.md](../window/installer/README.md)。

启动后不是带地址栏的浏览器：窗口装的是现在的三栏页面，页面地址仍是 `http://127.0.0.1:7777`，窗口只留应用名和最小化、最大化、关闭，不再叠一套 File / Edit / View 菜单（PCB 内部已经有顶栏）。关掉窗口时服务可以留在托盘里继续跑：托盘常驻是为了每天定时的任务还在同一个进程上，错过不补跑。

## 系统要求

- Windows 10 1809+ / Windows 11，x64
- 安装包自带运行时；源码方式需要 Node.js 22.18+（`server/main.ts` 直接由 Node 执行）
- 一个可用的 `omp` 登录（`omp login`）；密钥只留在本机

## 从源码运行

```bash
git clone https://github.com/renjianfj163/PCB.git
cd PCB
npm install          # 根目录：类型检查用
npm run setup        # web/：React + Vite
npm run build        # 界面构建到 web/dist
npm start            # 打开 http://127.0.0.1:7777
```

开发模式（服务端热重启 + Vite HMR，界面在 :5173，`/api` 代理到 :7777）：

```bash
npm run dev
```

自检：

```bash
npm run verify       # 类型 + 37 条测试
```

## 环境变量

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `PCB_PORT` | `7777` | 本地监听端口 |
| `PCB_HOST` | `127.0.0.1` | 只绑回环，改它等于把这台机器暴露出去 |
| `PCB_OMP` | `omp` | 启动会话用的可执行文件名 |
| `PCB_PROXY` | 自动探测 | 截图与网页预检用的代理；`off` / `none` / 空表示不用 |
| `PCB_CHROME` | 自动找 | 截图用的浏览器路径 |
| `PCB_OMP_CKPT_HOST` | `D:\Developer\zed_omp\host\omp-host.ts` | omp-ckpt 宿主扩展；文件不存在时只是没有审查服务，会话照常 |
| `PCB_VSCODE` | 自动找 | 「IDE」按钮用的桌面版 VS Code 或 Cursor 命令 |
| `PCB_CKPT_VSIX` | `D:\Developer\zed_omp\omp-ckpt-0.1.0.vsix` | 「IDE」按钮装进编辑器的扩展包 |

## 装完先确认这两件事

1. `omp --version` 有输出（README 里写的是 `omp/19.0.1` 这一代）。没有 `omp` 时，界面会明确写出
   「本机没有 omp」，而不是空转。
2. 打开 http://127.0.0.1:7777 ，左下角能看到 PCB 与 omp 的版本号。

## 卸载

- 安装包版本：Windows 设置里卸载 PCB，`%USERPROFILE%\.pcb\` 里是本机的项目索引与审批记录，
  手动删掉即可；对话本体在 omp 自己的会话文件里，按需清理。
- 源码版本：删掉目录即可，没有系统级安装。
