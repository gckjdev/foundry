# 仓库 onboarding

> English: [onboarding.md](onboarding.md)

Onboarding 是 Foundry 在仓库上运行的第一个任务。Agent 编写 `.foundry/recipe.yaml`、
`.foundry/policy.yaml` 和一个 GitHub issue 表单，在你的 runner 上证明 recipe 命令可用，然后创建
pull request。你审查并合并该 PR。之后，给 issue 加上 `foundry` 标签就会开始真正的工作。

控制面（`pnpm dev`）**不**运行任务。已加入的 runner 才运行任务。

Foundry 从 `.foundry/` 读取的每个文件和字段的参考：`docs/foundry-dot-dir.zh-CN.md`。

## 开始之前

1. 面板位于 `http://localhost:3000`，已用 GitHub 登录，并创建了团队。
2. GitHub App 已安装到仓库，且 **Repos** 中列出了它。如果列表为空，点击 **Sync from GitHub**。
   见 `docs/local-setup.zh-CN.md`。
3. 至少一个 runner 已加入并运行（下一节）。没有它，onboarding 会保持在 **queued**。
4. 默认 harness 是 Claude Code。在 runner 机器上安装并登录它（终端中 `claude` 可用）。如果在仓库上
   设置了 OpenCode，它是另一个选项。

## 1. 加入 runner

打开 **http://localhost:3000/runners**。

1. 在 **Add a runner** 下点击 **Create join token**。复制它（7 天有效；只显示一次）。
2. 在将运行任务的机器上：

```bash
bun apps/runner/src/cli.ts runner join <token> --server http://localhost:3000
pnpm dev:runner
```

只为常在线机器（Mac mini、Linux）添加 `--shared`。笔记本是个人 runner；机器睡眠时任务会暂停。

Runner 应在 **Runners** 上显示为 **accepting**。`foundry doctor`（或
`bun apps/runner/src/cli.ts doctor`）检查 git、磁盘和 harness 登录状态。

要在**这台电脑上运行多个 daemon**（不同名称，或个人加共享 runner），给每个 daemon 自己的
`--name` 和 `--home`。见 `docs/local-setup.zh-CN.md` §3 “一台电脑上的多个 runner”。若只是想让
**同一个 runner** 并行更多任务，用 `--concurrency N` 重新 join 即可。

## 2. 启动 onboarding

打开 **http://localhost:3000/repos**。

1. 找到仓库（例如 `gckjdev/foundry`）。
2. 点击 **Onboard repo**。要切换 harness（例如 OpenCode → Claude Code），先在仓库或团队上保存
   **Default harness**，然后点击 **Retry onboarding**——这会取消当前任务并启动新任务。
3. 状态标签变为 **onboarding…**。Foundry 创建一个标题为 `Set up Foundry for <owner/name>` 的任务。
   查看任务页头部显示的 `claude-code` 或 `opencode`。

可以在 runner 上线前启动 onboarding；任务会在 **queued** 中等待。

## 3. 观察进度

| 位置         | 看到什么                                            |
| ------------ | --------------------------------------------------- |
| **Board**    | 任务在 Queued，然后 Working                         |
| **Job page** | 状态、runner 名称、实时日志、等待原因               |
| **Repos**    | 标签：onboarding… → recipe PR open → accepting jobs |

从看板或 `/jobs/<id>` 打开任务。排队时可能看到 **Waiting: no runners joined** 或
**no runner online**。

健康进度：queued → triage → investigating → implementing → verifying → 一个 pull request。

如果 Agent 不确定，任务会进入 **Needs input**。在任务页回答（或当 GitHub 上出现问题时在 issue 中
回答）。

## 4. 如何判断完成

Onboarding **不是**在标签显示 onboarding… 时完成。那只是表示任务已存在。

| Repos 标签        | 任务                     | 做法                                                                    |
| ----------------- | ------------------------ | ----------------------------------------------------------------------- |
| onboarding…       | queued / working         | 等待，或加入/启动 runner。**Retry onboarding** 会取消此任务并启动新任务 |
| onboarding failed | failed                   | 阅读任务的失败原因；点击 **Retry onboarding**                           |
| recipe PR open    | 有 **Pull request** 链接 | 审查并合并 PR                                                           |
| accepting jobs    | 已合并（在你合并后）     | 给 issue 加 `foundry` 标签                                              |

Agent 不得修改应用代码。PR 应只添加：

- `.foundry/recipe.yaml` — install、checks、可选 dev server
- `.foundry/policy.yaml` — merge off、成本/循环上限、风险规则
- `.github/ISSUE_TEMPLATE/foundry.yml` — 带 `foundry` 标签的 issue 表单
- `.claude/skills/<name>/SKILL.md` 和 `.opencode/skills/<name>/SKILL.md` — 内置 playbook skills
  （目前是 `merge-risk`），任务结束时由 runner 安装

之后要新增或更新 skill，可在仓库根目录运行 `foundry skills install` 并提交结果；见
`docs/foundry-dot-dir.zh-CN.md`。

在 GitHub 上合并。`pnpm dev:webhooks` 运行时，Foundry 会注意到默认分支上的 `.foundry/`，标签变为
**accepting jobs**。如果没有转发 webhook，合并后点击 **Sync from GitHub** 或重新打开 **Repos**；
从 `main` 刷新 recipe 文件才会翻转 `acceptsJobs`。

## 5. Onboarding 之后

创建或打开一个 GitHub issue，添加 **foundry** 标签。Foundry 会在已准备好该仓库的 runner 上排队一个
ticket 任务。

在标签变为 **accepting jobs** 之前不要给 issue 加标签。在默认分支上有有效 recipe 之前，ticket 任务
会以 **repo not onboarded** 等待。

## 故障排查

**卡在 onboarding… / queued。** 没有 runner 加入，或 `pnpm dev:runner` 未运行。在 **Runners** 上
创建 token、join、启动 daemon。确认 runner 为 **accepting**。

**Harness 缺失 / 未登录。** 在 **Runners** 上，harness 行显示红色。在该机器上登录 Claude Code
（或 OpenCode），并保持 runner 进程运行。

**任务失败。** 打开任务，阅读失败文本和实时日志。Runner 还会把完整编码 Agent 记录（发送的每个
提示和返回的每个事件/消息，包括 `opencode serve` 的 stdout/stderr）写到
`~/.foundry/jobs/<job-id>.harness.log`（如果设置了 `$FOUNDRY_HOME` 则为
`$FOUNDRY_HOME/jobs/`）。密钥已脱敏。在 **Repos** 上点击 **Retry onboarding** 会启动新的
onboarding 任务。

**`git fetch` / Empty reply from server。** Git 不使用 macOS 系统代理。在 `.env` 中设置
`FOUNDRY_HTTP_PROXY`（或 `foundry runner join --http-proxy …`）。Runner 会把它应用到 git、控制面
客户端和编码 Agent 进程，并重试瞬时失败。重启 `pnpm dev` 和 `pnpm dev:runner`（分别在每个终端按
Ctrl+C，然后重新启动——见 `docs/local-setup.zh-CN.md` §4）并重试任务。

**Issue 加了 `foundry` 标签但不在看板上。** Foundry 只从 `issues.labeled` webhook（或补偿轮询）
创建任务。重启 `pnpm dev:webhooks`，让它从 `.env` 读取 `SMEE_URL`，然后刷新 **Board**。如果 smee
启动时没有该 URL，GitHub 事件从未到达。

**`git push` 被拒绝：workflows 权限。** 任务修改了 `.github/workflows/`。GitHub App 已请求
**Workflows: Read and write**，但每个安装都必须接受该权限。打开
[安装页](https://github.com/settings/installations/179251611)，接受更新后的权限，然后从
**Implementing** 点击 **Retry** 重试任务（失败的推送没有创建分支，本地 worktree 已被删除）。如果
没有 Review 请求，打开 [App 权限](https://github.com/settings/apps/gckjdevfoundryapp/permissions)，
确认 Workflows 为 Read and write，Save，然后再次接受。

**PR 一直不出现。** Runner 从未到达 verifying，或创建 PR 失败（GitHub App 权限：contents +
pull requests + 如果 diff 涉及 CI 还需要 workflows）。检查任务日志。

**已合并但仍不接受任务。** `main` 上的 `.foundry/recipe.yaml` 缺失或无效，或 Foundry 没有看到
推送。运行 `pnpm dev:webhooks`，确保 `SMEE_URL` 与 GitHub App webhook URL 一致，然后推送一个空
提交或点击 **Sync from GitHub**。
