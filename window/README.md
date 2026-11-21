# PCB 的 Windows 窗口外壳（window/）

一个 WinForms + WebView2 外壳：把 `http://127.0.0.1:7777` 装进一个**没有地址栏、没有标签、没有书签、
没有 File / Edit / View 菜单**的窗口。页面还是现在那三栏，`server/`、`web/`、`shared/` 一行没改。

窗口只做外壳：谁在说话、计划怎么写、文件怎么改，全部由页面和它背后的 node 服务决定。

## 编译

这台机器没有 dotnet SDK，脚本只用系统自带的 .NET Framework 编译器：

```powershell
powershell -ExecutionPolicy Bypass -File window\build.ps1
# 或者，连 SDK 缓存一起重来：
powershell -ExecutionPolicy Bypass -File window\build.ps1 -Clean
```

- 编译器：`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`（C# 5 语法，别写字符串插值）。
- 目标：`.NET Framework 4.8`（`PCBWindow.exe.config` 里声明）、x64、WinForms、`/target:winexe`。
- SDK：`Microsoft.Web.WebView2` 的 nupkg 由脚本从 nuget.org 下载并解到 `window/.build/`，
  不假设机器上有 `nuget.exe` 或 `dotnet`。版本钉在脚本参数 `-SdkVersion`（默认 `1.0.4314.35`）。
- 产物在 `window/dist/`：`PCBWindow.exe`、`Microsoft.Web.WebView2.Core.dll`、
  `Microsoft.Web.WebView2.WinForms.dll`、`WebView2Loader.dll`（x64，必须在 exe 旁边）、
  `PCBWindow.exe.config`。

运行前需要本机有 WebView2 运行库（Edge 自带；本机实测 `157.0.4341.60`）。

## 运行

```powershell
window\dist\PCBWindow.exe            # 打开窗口
window\dist\PCBWindow.exe --quit     # 让正在运行的那一个走完退出流程（安装/卸载脚本用）
```

启动顺序：

1. `Local\PCB.Window.Instance` 互斥量：只有一个窗口程序。再启动一次时，第二个只把第一个的窗口叫到
   前面，然后自己退出。
2. 探 `127.0.0.1:7777`。没人听，就从**仓库根目录**（从 exe 往上找 `server/main.ts` 的那一层）启动
   `node server/main.ts`，环境里带 `PCB_HOST=127.0.0.1`、`PCB_PORT=7777`，最多等 20 秒。
   20 秒还不行，窗口里只写一句话，不打印堆栈。
3. 端口已经有人听（例如你自己 `npm start`）：**不再启动第二个 node**。
4. WebView2 打开 `http://127.0.0.1:7777`，用户数据目录在 `%LOCALAPPDATA%\PCB\webview2`。
   窗口标题是 `PCB`，初始 `1440×900`（按显示器缩放换算成设备像素），只有最小化、最大化、关闭。

托盘图标从启动起就在：菜单两项——「打开」「退出」，双击图标等于「打开」。

## 关闭窗口与托盘退出不一样

| 动作 | 窗口 | 进程 | `7777` | 托盘 |
| --- | --- | --- | --- | --- |
| 点窗口的 × | 隐藏 | 还在 | 还在听 | 还在 |
| 托盘「打开」/ 双击图标 | 再显示，同一个 `7777` | 还在 | 还在听 | 还在 |
| 托盘「退出」/ `--quit` | 结束 | 退出 | 由它启动的会停，别人启动的不动 | 消失 |

关窗口只隐藏，是因为每天的定时任务挂在 node 进程上：窗口藏起来，任务照跑；错过的那次不补跑。

托盘「退出」：如果 node 是这个窗口程序启动的，先给 node 发真正的 Ctrl+C（它收到 SIGINT，走完自己的
关闭，最多约 3 秒），再不行才结束进程；如果 node 不是它启动的，只退出自己，不碰那个已经在听的服务。

关窗口这层还有两个必要的细节：外层的所有控件归本程序所有，异常只写日志
（`%LOCALAPPDATA%\PCB\window.log`）不弹栈；node 被放进一个 job 对象，窗口程序万一崩掉，
node 随之一并结束，不会留下一个占着 `7777` 的孤儿进程。

## 第二个实例会发生什么

窗口程序已经在跑时再启动一个 exe：它拿到互斥量失败，只是向第一个实例发出「显示」信号，
然后以退出码 0 结束——不会多一个窗口、不会多一个 node、不会多一个监听 `7777` 的进程。
第一个实例的窗口会重新出现在最前面。

## 文件

| 文件 | 作用 |
| --- | --- |
| `src/Program.cs` | 入口：`--quit`、单实例互斥量、显示/退出信号、异常进日志 |
| `src/ShellContext.cs` | 窗口 + 托盘 + 服务启动与停止的生命周期 |
| `src/ShellForm.cs` | 无地址栏窗口、WebView2、失败时的一句话、按 DPI 换算尺寸 |
| `src/ServerHost.cs` | 找仓库根、探端口、启动 node、Ctrl+C 优雅停止、兜底 Kill |
| `src/Job.cs` | job 对象（kill-on-close）：外壳崩了不留孤儿 node |
| `src/Native.cs` | 三个 console 调用与图标句柄释放 |
| `src/Diagnostics.cs` | `%LOCALAPPDATA%\PCB\window.log` |
| `build.ps1` | 下载 WebView2 SDK、解包、csc 编译、把四个文件放进 `dist/` |

## 已知边界

- 只做 Windows；`web/` 的页面本身没变，最小窗口 960×600 以下会挤。
- 编辑器仍由页面里的「IDE」按钮打开**本机已装的桌面编辑器**，没有嵌进这个 WebView2；
  以后让编辑器也走同一个外壳，是单独一步，不影响这一版。
- `dist/` 与 `.build/` 是构建产物，不进版本库。
