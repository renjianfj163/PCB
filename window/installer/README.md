# 安装包（window/installer/）

两个 Windows x64 安装包，同一套 PCB、同一个 `omp`，唯一差别是 `edition.txt`：

| 文件 | 装进去的东西 |
| --- | --- |
| `PCB-<版本>-Desktop-windows-x64.exe` | PCB Desktop：完整工作环境，没有「IDE」入口 |
| `PCB-<版本>-Developer-windows-x64.exe` | PCB Developer：同一套核心，多一个「IDE」入口（打开本机已装的桌面版 VS Code，找不到就打开 Cursor，并装 omp-ckpt） |

两个包都不附带编辑器，也不下载网页版 VS Code，体积一样。

## 打包

```powershell
# 1. 先准备程序树（见仓库 README 的「打包」一节）
#    dist/stage/desktop/   和   dist/stage/developer/
# 2. 再编译安装包
powershell -ExecutionPolicy Bypass -File window/installer/build-installer.ps1 -Edition Desktop
powershell -ExecutionPolicy Bypass -File window/installer/build-installer.ps1 -Edition Developer
```

产物在 `dist/`。需要的东西都在 Windows 里：`tar.exe` 打 zip，`csc.exe`（.NET Framework 4.8 自带，C# 5）编译。
不需要 dotnet SDK，也不需要 Inno Setup。

## 程序树

`dist/stage/<edition>/` 是**平铺在安装目录根**的一份应用：

```
PCBWindow.exe (+ .exe.config, WebView2 三个 dll)   窗口（WebView2 壳）
node.exe                                            运行时，不带系统 PATH 也能跑
omp.exe                                             AI 运行组件（两包各放一份）
edition.txt                                         desktop / developer
server/  shared/  web/dist/  package.json           PCB 本体与构建好的界面
LICENSE  NOTICE  node-LICENSE.txt
```

`PCBWindow.exe` 从自己所在目录往上找 `server/main.ts`，所以安装目录本身就是"仓库根"，
不需要原来那个工作目录。

## 行为

- 每用户安装，不要管理员：文件进 `%LOCALAPPDATA%\Programs\PCB Desktop|Developer`，
  开始菜单一项，卸载信息写在 `HKCU`。
- `--silent` 静默安装；安装完会检查 WebView2 运行时，缺了就打开微软的下载页，而不是白屏。
- 卸载：安装目录里的 `uninstall.exe`（约 6 KB），会先关掉这个目录里的窗口，再删快捷方式、注册表项和目录。
- 不签名：首次运行会有 SmartScreen 提示。

## 发布

```bash
gh release create v0.1.0 \
  dist/PCB-0.1.0-Desktop-windows-x64.exe \
  dist/PCB-0.1.0-Developer-windows-x64.exe \
  --title "PCB 0.1.0" --notes-file <说明>
```

文件名决定网站分栏：带 `Desktop` 的进 PCB Desktop 一栏，带 `Developer` 的进 PCB Developer 一栏
（`site/public/app.js` 按文件名里是否出现 `desktop` / `developer` 等词分组，两边都沾或都不沾才算「其他发行包」）。
