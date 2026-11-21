# 更新记录

## 0.1.0 — 尚未发布

第一个公开版本，还没有 Windows 安装包；从源码运行（见 [docs/install.md](docs/install.md)）。

- 本地壳：每个会话一个 `omp --mode rpc-ui` 子进程，界面三栏（项目 / 对话 / 右栏四页），
  整页不滚动，只听 `127.0.0.1`。
- 三个阶段：Chat 只回答、Plan 只读并给计划、Build 才写文件；跑命令前一律问，
  唯一强门是右栏计划页的「按这个做」。裁决集中在 `server/policy.ts`。
- 审查：omp-ckpt 宿主扩展在回合前后留检查点，改动可以逐块接受或还原；
  PCB 只连它的本地服务，不重算 diff。
- 顶栏「IDE」：打开本机已安装的桌面版 VS Code 或 Cursor，工作区是当前项目，并使用 omp-ckpt。
  找不到时只说一句。安装包不附带 VS Code，也不下载网页版编辑器。
- Windows 安装包只有一个：`PCB-<版本>-windows-x64.exe`。
- 项目网站（`site/`）：一页中文/英文。一个软件包，OMP 与 OMP-ckpt 按现有能力来写，演示 / 发布 / 支付标为规划中；版本下载、报告问题；
  零依赖，密钥只在服务端环境变量里。品牌改为「本地 AI 产品创造平台」，口号「从对话到产品，从创意到价值」；
  五阶段 Chat / Plan / Build / Promote / Monetize，后两段标为规划中；下载区写死 v0.1.0 的真实文件名、大小与完整 SHA256。
- 开源：MIT（见 [LICENSE](LICENSE)），`omp` 与编辑器不在许可范围内（见 [NOTICE](NOTICE)）。
