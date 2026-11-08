# ADR 001：Runner 运行时与打包

> English: [001-runner-runtime.md](001-runner-runtime.md)

状态：已接受 · 日期：2026-11-06

## 背景

Runner（`apps/runner`）安装在团队的笔记本和共享机器上，运行 macOS 和 Linux。安装不应要求 Node
工具链，并且每个平台应只有一个文件，供 Homebrew、安装脚本和 deb/rpm 包使用。Runner 内嵌两个
harness：

- Claude Code，通过 `@anthropic-ai/claude-agent-sdk`。SDK 会启动 Claude Code 引擎进程。自 0.3.x
  起，引擎是约 320 MB 的平台原生二进制，作为可选依赖
  （`@anthropic-ai/claude-agent-sdk-<os>-<arch>`）发布。
- OpenCode，通过启动 `opencode serve` 并经由 HTTP 与它通信。

单任务 `foundry` MCP 服务器必须作为 stdio 子进程运行，由 harness 启动。

## 决策

1. **Bun，编译发布。** Runner 是用 Bun 运行的 TypeScript。发布时用
   `bun build src/cli.ts --compile --target bun-<os>-<arch>` 构建为单个 `foundry` 可执行文件
   （darwin-x64 上约 73 MB）。开发时从源码运行（`bun src/cli.ts`）。Vitest 在 Node 下运行测试，
   因此 runner 代码只使用 `node:` API，不导入 `bun:`。唯一的 Bun 专有功能是 playbook `.md` 文件的
   文本导入；Vitest 在 `vitest.config.ts` 中用 transform 模拟它。
2. **二进制本身就是 MCP 服务器。** Harness 启动 `foundry mcp`（`process.execPath mcp`），并通过
   环境变量传入任务的 socket 路径和 token。开发时命令是 `bun <cli.ts> mcp`。
3. **Claude Code 引擎：编译版使用已安装的 CLI。** 不内嵌原生引擎。适配器按以下顺序选择
   `pathToClaudeCodeExecutable`：
   - `FOUNDRY_CLAUDE_PATH`；
   - 在编译版二进制内，PATH 上的 `claude` CLI；
   - 从源码运行时，使用 SDK 自己的引擎。

   每个 Claude Code 用户都会安装 CLI 以登录，因此这没有额外成本。二进制小 4 倍，引擎可以按自己的
   节奏更新。
4. **Provider 配置来自用户的 Claude 设置。** 任务只加载项目设置
   （`settingSources: ["project"]`），因此用户 hooks 和权限不会泄漏到无人值守运行中。
   `~/.claude/settings.json` 的 `env` 块仍会合并到任务环境，使 API key、`ANTHROPIC_BASE_URL`
   和模型别名像交互式使用一样工作。
5. **OpenCode 是外部依赖。** Runner 启动用户的 `opencode` 二进制；缺失时 harness 报告为未安装。

## Spike 结果（darwin-x64，Bun 1.3.14）

| 检查                                                                                                                                   | 结果                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CLI 的 `bun build --compile`                                                                                                           | ✓ 388 个模块，73 MB，约 2 秒                                                                                                                           |
| 从二进制运行 `foundry --version`、`foundry doctor`                                                                                     | ✓                                                                                                                                                      |
| 从二进制运行 `foundry mcp`：MCP 客户端列出 6 个工具，`confidence` 调用到达 runner socket                                               | ✓（`bun scripts/mcp-smoke.ts dist/foundry`）                                                                                                           |
| 从二进制运行 Claude Agent SDK `query()`，启动已安装的 `claude` 并使用用户 provider 环境                                                | ✓ 引擎启动并完成认证。Provider 因账户余额拒绝请求（HTTP 402），因此本机未观察到完整模型回合。                                                          |
| 从二进制运行 OpenCode：在 worktree 中运行 `opencode serve`（1.16.2），使用 `OPENCODE_CONFIG_CONTENT`，SDK 客户端创建会话并流式接收事件 | ✓（`packages/harness-opencode` 中的 live 测试）。配置的 provider（GLM Coding Plan）已过期，因此回合在 3 次重试后以 provider 错误结束，而不是模型回复。 |
| 带 MCP 工具调用的完整回合                                                                                                              | 在凭据可用的机器上运行 `foundry doctor --live`                                                                                                         |

## 影响

- 发布矩阵：`bun-darwin-arm64`、`bun-darwin-x64`、`bun-linux-x64`、`bun-linux-arm64`、
  `bun-windows-x64`，由一个 CI job 交叉编译（`apps/runner/scripts/build-release.ts`）。
  Windows 上 runner 通过 PowerShell（优先 `pwsh`，回退 `powershell.exe`）启动 recipe 和 harness
  命令，并通过 `127.0.0.1:<port>` 而不是 Unix socket 提供单任务 MCP 桥。
- 编译版 runner 没有 `claude` CLI 时，`foundry doctor` 会报告 Claude Code 未安装；解决办法是
  `npm i -g @anthropic-ai/claude-code` 或原生安装器。
- 如果 SDK 与 CLI 版本偏差过大，用 `FOUNDRY_CLAUDE_PATH` 固定引擎。
