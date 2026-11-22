# 安装包（window/installer/）

只有一个 Windows x64 安装包。里面是 PCB 和 `omp`，不附带 VS Code，也不下载网页版编辑器。

喜欢写代码的人自己安装桌面版 VS Code 或 Cursor。装好之后，顶栏「IDE」会打开它，工作区是当前项目，并装一次 omp-ckpt。没装编辑器时只提示一句，安装包里没有编辑器。

| 文件 | 装进去的东西 |
| --- | --- |
| `PCB-<版本>-windows-x64.exe` | PCB、本机服务、`omp`。不包含 VS Code |

## 打包

```powershell
powershell -ExecutionPolicy Bypass -File window\build.ps1          # 窗口外壳 → window/dist
npm run build                                                      # 界面 → web/dist
powershell -ExecutionPolicy Bypass -File window\stage.ps1          # 程序树 → dist/stage
powershell -ExecutionPolicy Bypass -File window\installer\build-installer.ps1 -Version 0.1.0
```

`stage.ps1` 组装 `dist/stage/`（见下面的「程序树」）：`node.exe` 从 nodejs.org 取并按同目录的
`SHASUMS256.txt` 校验，`omp.exe` 按 `-OmpUrl` + `-OmpSha256` 取。本机已有这两个文件时直接给
`-NodeExe` / `-OmpExe`。缺 omp 时脚本报错退出——不会产出一个"没有引擎"的包。

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

## 发布（自动）

`.github/workflows/release.yml`，先跑 `npm run verify`，再走上面四步打包：

| 触发 | 产物 | 站点下载区 |
| --- | --- | --- |
| push 到 `main` | 预发布 tag `main-build`，每次删掉重建（只留一个，不累积；列表里排在最前） | 进「其他版本」 |
| push `v*` tag | 正式 Release；tag 已存在就直接报错，不覆盖 | 换掉下载卡片 |
| 手动 `workflow_dispatch` | 默认只上传 artifact；`publish=true` 才发 Release | — |

版本号：tag 用去掉 `v` 的 tag；`main` 构建用 `<package.json 的版本>-main.<提交前 7 位>`。
它只写进「应用和功能」里的版本号，界面不显示 PCB 版本。

发布前要先设两个仓库变量（Settings → Secrets and variables → Actions → Variables），否则构建停在
stage 一步：

| 变量 | 值 |
| --- | --- |
| `OMP_ASSET_URL` | `omp` win-x64 的下载地址，例如 `https://github.com/<owner>/<repo>/releases/download/omp-19.1.0/omp-windows-x64.exe` |
| `OMP_SHA256` | 上面那个文件的 sha256（小写十六进制） |

## 发布（手动，应急）

```bash
gh release create v0.2.0 dist/PCB-0.2.0-windows-x64.exe --title "PCB 0.2.0" --notes-file notes.md
```

网站下载区按文件名挑这个 Windows 安装包，SHA256 取 GitHub 给资产算的 `digest`，所以手动发的版本
同样会自动出现在卡片上——站点不需要重新部署。
