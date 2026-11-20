# 贡献

感谢你愿意动这个项目。PCB 是本地壳，改动要保住三条不变量：

1. **只听回环**：不引入任何对外监听、外发遥测或云端依赖。
2. **一个会话一个 omp 子进程**：界面和编辑器扩展都是客户端，不新起第二个 agent、不在前端拼一份假对话。
3. **政策只在 `server/policy.ts`**：界面负责显示，不负责决定能不能动手。

## 本地跑起来

```bash
npm install
npm run setup        # web/ 的依赖
npm run build        # 构建界面
npm start            # http://127.0.0.1:7777
npm run dev          # 或者：服务端热重启 + Vite HMR
```

## 提交之前

```bash
npm run verify       # 两份 tsconfig 的类型检查 + 37 条测试
```

新行为请配一条能失败的测试：政策矩阵、帧翻译、SSE 广播、路径锁、编辑器启动，这几处都有现成的
测试文件可照着写。纯样式与文案改动不需要新测试，但要在两种宽度（1280 / 375）下自己看过一眼。

## 提交信息

一句话说清「改了什么」，正文说「为什么」和「代价」。沿用仓库现有风格：

```
feat: the IDE button opens desktop VS Code, not a web server
fix: a session that exits still reports its last frame
```

- `feat` / `fix` / `refactor` / `docs` / `test` / `chore` 开头；
- 一个提交只做一件事，删掉的东西在正文里点名；
- 不写「若干优化」「体验提升」这类无法核对的话。

## 文档

改了行为就改 [docs/](docs/)：架构、接口、安装、使用四篇里至少有一篇会过时。文档里不写「以后会」，
做不到的事就写做不到。

## 许可

提交即同意以 [MIT](../LICENSE) 授权你的贡献。请只提交你有权提交的代码；引入第三方代码时在
[NOTICE](../NOTICE) 里补一行（包名、许可、用途）。
