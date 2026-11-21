# 安装包（window/installer/）

只有一个 Windows x64 安装包。里面是 PCB 和 `omp`，不附带 VS Code，也不下载网页版编辑器。

喜欢写代码的人自己安装桌面版 VS Code 或 Cursor。装好之后，顶栏「IDE」会打开它，工作区是当前项目，并装一次 omp-ckpt。没装编辑器时只提示一句，安装包里没有编辑器。

| 文件 | 装进去的东西 |
| --- | --- |
| `PCB-<版本>-windows-x64.exe` | PCB、本机服务、`omp`。不包含 VS Code |

## 打包

```powershell
# 1. 先准备程序树（见下面的「程序树」）
#    dist/stage/
# 2. 再编译安装包
powershell -ExecutionPolicy Bypass -File window/installer/build-installer.ps1
```

产物是 `dist/PCB-<版本>-windows-x64.exe`。需要的东西都在 Windows 里：`tar.exe` 打 zip，`csc.exe`（.NET Framework 4.8 自带，C# 5）编译。不需要 dotnet SDK，也不需要 Inno Setup。

## 程序树

`dist/stage/` 是**平铺在安装目录根**的一份应用：

```
PCBWindow.exe (+ .exe.config, WebView2 三个 dll)   窗口（WebView2 壳）
node.exe                                            运行时，不带系统 PATH 也能跑
omp.exe                                             AI 引擎
server/  shared/  web/dist/  package.json           PCB 本体与构建好的界面
LICENSE  NOTICE  node-LICENSE.txt
```

`PCBWindow.exe` 从自己所在目录往上找 `server/main.ts`，所以安装目录本身就是"仓库根"，不需要原来那个工作目录。

## 行为

- 每用户安装，不要管理员：文件进 `%LOCALAPPDATA%\Programs\PCB`，开始菜单一项，卸载信息写在 `HKCU`。
- `--silent` 静默安装；安装完会检查 WebView2 运行时，缺了就打开微软的下载页，而不是白屏。
- 卸载：安装目录里的 `uninstall.exe`（约 6 KB），会先关掉这个目录里的窗口，再删快捷方式、注册表项和目录。
- 不签名：首次运行会有 SmartScreen 提示。

## 发布

```bash
gh release create v0.1.0 \
  dist/PCB-0.1.0-windows-x64.exe \
  --title "PCB 0.1.0" --notes-file <说明>
```

网站下载区按文件名列出这个 Windows 安装包（`site/public/app.js`）。
