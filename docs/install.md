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

装的时候先选目录（默认 `%LOCALAPPDATA%\Programs\PCB`），两个勾默认都开着：创建桌面快捷方式，和把 `pcb` 命令加进用户 PATH。装完在**新开的** cmd 里可以 `pcb` 打开窗口、`omp login` 登录。`Program Files` 装不了——每用户安装没有管理员权限；目标目录非空且不是 PCB 时安装会停下，一个文件都不删。

启动后不是带地址栏的浏览器：窗口装的是现在的三栏页面，页面地址仍是 `http://127.0.0.1:7777`，窗口只留应用名和最小化、最大化、关闭，不再叠一套 File / Edit / View 菜单（PCB 内部已经有顶栏）。关掉窗口时服务可以留在托盘里继续跑：托盘常驻是为了每天定时的任务还在同一个进程上，错过不补跑。

## 系统要求

- Windows 10 1809+ / Windows 11，x64
- 安装包自带运行时；源码方式需要 Node.js 22.18+（`server/main.ts` 直接由 Node 执行）
- 一个可用的 `omp` 登录：首次运行和设置里的「登录模型」会打开包内 omp 的登录窗口，界面本身不接收密钥

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

## 更新

左栏「设置」里是版本、更新、模型登录和安装位置。当前 PCB 版本读安装目录的 `install-meta.txt`，从源码跑时读 `package.json`。

「检查更新」读 GitHub 上的最新正式版（`PCB-<版本>-windows-x64.exe`）。有新版本时先显示版本号与说明，点「下载并安装」才下载；已安装的副本会用 `--silent --dir <原目录> --relaunch` 升级回同一目录并重新打开窗口。不会在后台自动下载或替换安装包。从源码运行、注册表里没有安装位置时，只会打开安装包本身的界面，由你自己选目录。

「登录模型」打开一个看得见的控制台跑包内 `omp login`；密钥只在那个窗口里输入。

## 卸载

- 安装包版本：Windows 设置里卸载 PCB。卸载会删掉开始菜单与桌面快捷方式、用户 PATH 里的 `bin` 和安装目录；`%USERPROFILE%\.pcb\`（项目索引与审批记录）与 omp 自己的会话在安装目录外面，卸载不会动它们，要清理的话手动删。
- 源码版本：删掉目录即可，没有系统级安装。
