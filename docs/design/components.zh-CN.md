# Foundry — 组件方案设计

> English: [components.md](components.md)

状态：当前实现 · 最后审阅：2026-11-08

本文描述每个运行时组件和工作区包：它负责什么、主要模块、对外或对内接口、状态保存在哪里、如何失败
以及如何测试。请先阅读 [`overall-design.zh-CN.md`](overall-design.zh-CN.md) 了解系统上下文。

---

## 1. 组件地图

| 组件                           | 类型          | 负责                                                                | 运行位置              |
| ------------------------------ | ------------- | ------------------------------------------------------------------- | --------------------- |
| `apps/web`                     | Next.js 应用  | 面板 UI、Auth.js、webhook 接收、runner API、面板 API、进程内 worker | 控制面主机            |
| `apps/realtime`                | Node 服务     | Postgres LISTEN → 按团队 WebSocket 广播                             | 控制面主机            |
| `apps/runner`                  | CLI + daemon  | Join、心跳、领取、worktree、驱动 harness、检查、本地状态            | 团队机器              |
| `packages/control`             | 库            | 控制面业务规则和服务                                                | `apps/web` 内或测试中 |
| `packages/db`                  | 库            | Drizzle schema、迁移、触发器、指标视图                              | 控制面                |
| `packages/shared`              | 库            | Zod 契约、任务状态、调度、门禁、recipe/policy、token、渲染          | 两端                  |
| `packages/github`              | 库            | GitHub App 客户端、webhook 验证、内存 fake                          | 控制面、测试          |
| `packages/harness-core`        | 库            | Harness 适配器接口、事件队列、记录日志、fake                        | Runner、测试          |
| `packages/harness-claude-code` | 库            | Claude Agent SDK 适配器与消息规范化                                 | Runner                |
| `packages/harness-opencode`    | 库            | `opencode serve` 适配器、事件映射、配置生成                         | Runner                |
| `packages/mcp-foundry`         | 库 + CLI 模式 | 单任务 MCP 工具与 runner 桥                                         | Harness 子进程        |
| `packages/os-adapters`         | 库            | OS 服务、密钥、电源、限制、进程树                                   | Runner                |
| `packages/playbooks`           | 库            | 内置 playbook、提示词组装、提醒/验证消息                            | Runner                |
| `deploy/` + `packaging/`       | 配置          | Compose 栈、Caddy、Dockerfile、发布产物                             | 部署                  |

---

## 2. `apps/web` — 控制面

### 2.1 职责

系统的公开入口：面板页面、GitHub OAuth、webhook 接收、runner HTTP API、面板 API、artifact
服务，以及用于补偿遗漏事件的进程内后台 worker。

### 2.2 模块

| 区域       | 文件                                                                                                         | 职责                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 认证       | `src/auth.ts`、`src/server/session.ts`                                                                       | Auth.js GitHub provider、JWT 会话、`requireTeam()` / `requireAdmin()`。          |
| 上下文     | `src/server/context.ts`                                                                                      | 从数据库、GitHub 客户端、通知器和环境变量构建唯一 `ControlContext`；测试可注入。 |
| HTTP 辅助  | `src/server/http.ts`                                                                                         | JSON/错误映射和 `runnerRoute()`：bearer 认证、zod 校验、类型化错误。             |
| 代理       | `src/server/retry-fetch.ts`、`src/instrumentation.node.ts`                                                   | 通过 `FOUNDRY_HTTP_PROXY` 包装全局 fetch 并重试；只启动一次 worker。             |
| 面板页面   | `src/app/(panel)/**`                                                                                         | Inbox、看板、任务详情、任务配置、仓库、runner、指标、设置、团队。                |
| Actions    | `src/app/actions.ts`                                                                                         | 面板按钮的服务端 action（回答、重试、取消、合并、设置）。                        |
| Webhook    | `src/app/api/webhooks/github/route.ts`                                                                       | 验证签名、存储投递、异步处理。                                                   |
| Runner API | `src/app/api/runner/**`                                                                                      | Join、心跳、领取、就绪、git token、artifact、单任务动作。                        |
| 面板 API   | `src/app/api/jobs/[id]/events`、`realtime-token`、`push/subscribe`、`artifacts/[id]`、`github/setup`、`auth` | 实时日志、WebSocket token、push 订阅、签名 artifact 下载、App 安装回调、OAuth。  |
| 安装脚本   | `src/app/install.sh/route.ts`                                                                                | 提供 runner 安装脚本。                                                           |

### 2.3 接口

**Runner API**（通过 `Authorization: Bearer <runnerToken>` 认证）：

| 方法/路径                           | 用途                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `POST /api/runner/join`             | 用签名 join token 换取 runner token；创建或替换 runner 行。                                              |
| `POST /api/runner/heartbeat`        | 上报资源、harness、运行中任务；接收 realtime token、仓库、撤销和单任务限制。                             |
| `POST /api/runner/claim`            | 原子地领取最合适的合格任务。                                                                             |
| `POST /api/runner/readiness`        | 上报当前 recipe SHA 下的仓库就绪状态。                                                                   |
| `POST /api/runner/git-token`        | 用于 fetch/push 的短期安装 token。                                                                       |
| `POST /api/runner/artifacts`        | 原始截图/备注上传（≤ 10 MB）。                                                                           |
| `POST /api/runner/jobs/:id/:action` | `events`、`stage`、`ask`、`evidence`、`confidence`、`plan`、`checkpoint`、`pr`、`onboarding`、`inputs`。 |

面板 API 通过 Auth.js 会话认证，并限定在当前选中的团队。

### 2.4 失败行为

- Webhook 在分发前先返回 `202`；处理失败留在 `webhook_inbox` 中由 worker 重试。
- 缺少 `FOUNDRY_SECRET` 或 `DATABASE_URL` 时禁用 worker，而不是阻塞构建。
- GitHub 和通知失败是“尽力而为”：记录日志，不允许破坏任务状态。
- 未知 runner 动作返回 `404`；非法任务转换返回 `409`。
- 面板通过控制上下文读取，因此与测试走同一套代码路径。

### 2.5 测试

`tests/api/*.test.ts` 导入路由处理器，并通过 `setContextForTests` 注入测试上下文。
`tests/e2e/job.test.ts` 在进程内驱动真实 daemon。`tests/playwright/signin.spec.ts` 检查公开
登录页。组件逻辑由 `packages/control/src/control.test.ts` 覆盖。

---

## 3. `apps/realtime` — 变更广播

### 3.1 职责

把一条 Postgres `LISTEN foundry_changes` 连接转换为按团队隔离的 WebSocket 消息，防止客户端读取
其他团队的事件。

### 3.2 设计

- `startRealtime({ sql, secret, port })` 启动 HTTP 服务器和 `noServer: true` 的 `ws` 服务器。
- 客户端通过 `?token=` 或第二个 WebSocket 子协议（`["foundry", token]`）携带签名 token；claims
  必须包含 `teamId`。
- 连接后发送 `{type:"hello", teamId}`，之后发送
  `{type:"change", table, id, op, columns}`，且只发给同团队。
- 25 秒 ping/pong 循环会断开死亡客户端和 token 已过期的客户端。
- 消息只携带标识符；客户端通过带认证的 API 重新拉取行数据。
- `GET /healthz` 返回 `ok`；其他 HTTP 请求返回 `426 WebSocket only`。

### 3.3 失败行为

- 没有 Postgres URL：服务器仍接受连接，但不广播（用于健康检查和测试）。
- 格式错误的 NOTIFY 负载被忽略。
- WebSocket 错误或关闭会移除客户端；token 过期会迫使客户端用新 token 重连。
- 服务无状态，可以安全重启。

### 3.4 测试

`apps/realtime/src/server.test.ts` 覆盖 token 认证、团队过滤、ping/过期和健康检查。

---

## 4. `apps/runner` — 执行代理

### 4.1 职责

长期运行的 daemon，为本团队领取任务，在隔离的 worktree 中执行并汇报进度。它不允许 Agent 推送代码；
git 操作由 runner 负责。

### 4.2 CLI 接口

`foundry runner join|start|install-service|uninstall-service|status|schedule`，以及
`foundry check`、`foundry doctor`、`foundry open`、`foundry mcp` 和 `--version`。开发时同样命令
以 `bun apps/runner/src/cli.ts …` 运行。Harness 会重新调用当前可执行文件（`process.execPath`）
加 `mcp` 来启动 MCP 服务器。

### 4.3 模块

| 模块             | 职责                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `cli.ts`         | 参数解析、join、服务安装、状态、调度、doctor、MCP 入口。                                                                     |
| `config.ts`      | `~/.foundry/config.json`（或 `--home`）：服务器 URL、runner ID、名称、类型、并发、调度、磁盘下限、Postgres URL、限制、代理。 |
| `daemon.ts`      | 心跳、接受任务门控（draining、磁盘、交流电、空闲、时间窗口）、领取循环、realtime socket、睡眠抑制、每小时 GC。               |
| `job-runner.ts`  | 单任务状态机：初始化、harness 会话、阶段强制、MCP 工具、验证循环、PR/onboarding、检查点、清理。                              |
| `workspace.ts`   | 每仓库 bare mirror、每任务 `git worktree`、detached 就绪 worktree、提交/diff/推送。                                          |
| `git.ts`         | 带代理参数、`http.extraheader` 中的安装 token、瞬时重试、workflow 权限提示地调用 git。                                       |
| `checks.ts`      | 通过 `sh -c`（或 PowerShell）运行命令，独立进程组，超时杀进程树，输出尾部。                                                  |
| `readiness.ts`   | OS/系统依赖预检，然后在 detached worktree 中运行 warm/install/checks；单次检查上限 20 分钟。                                 |
| `services.ts`    | 创建/删除单任务 Postgres 数据库并导出 `DATABASE_URL`。                                                                       |
| `ports.ts`       | 从 41000 起租用 10 个端口块，持久化到 `ports.json`。                                                                         |
| `tool-server.ts` | Unix socket（或回环 TCP）上的本地 HTTP 服务器，按任务发放工具 token。                                                        |
| `state.ts`       | 本地任务记录和 harness 记录路径。                                                                                            |
| `brief.ts`       | 把交接简报推送到 git ref 并读取。                                                                                            |
| `scrub.ts`       | 按已知值和模式脱敏。                                                                                                         |
| `gc.ts`          | 删除已完成/过期的 worktree、端口和本地记录。                                                                                 |
| `smoke.ts`       | `doctor --live` 的最小 harness 会话。                                                                                        |

### 4.4 任务执行契约

1. 解析 harness；如果本机不可用则失败。
2. 创建或复用 worktree（sticky resume 复用本地 worktree），租用端口块。
3. 加载 `.foundry/recipe.yaml` 和 `policy.yaml`；计算有效时间和成本限制。
4. 准备单任务服务并构建任务环境变量（`FOUNDRY_JOB_ID`、`FOUNDRY_PORT`、`FOUNDRY_PORT_END`、
   `FOUNDRY_BRANCH`、代理变量、单任务密钥）。
5. 除非是 sticky resume，否则运行 `install`。
6. 以组装好的 playbook、待处理输入和 stdio `foundry` MCP 服务器启动 harness。
7. 消费事件；usage 到达时执行成本上限。
8. 处理工具：
   - `stage(name)` 按顺序强制进入下一阶段，并在转换时写检查点。
   - `plan(text)` 保存计划。
   - `ask(question, options)` 在宽限期后停放任务。
   - `evidence(...)` 保存备注或上传截图。
   - `run_checks(names)` 运行受信任的 recipe 检查并记录证据。
   - `confidence(...)` 保存自评。
9. 收到 `stage(done)` 后，对确切工作树重新运行检查、提交、计算 diff、要求至少有一个文件变更、
   UI 路径变化时截图、推送，并请求控制面创建 PR。
10. 清理：释放 harness；除非 parked，否则删除 worktree；释放端口；删除服务。

### 4.5 失败行为

- 任何 `FailJob` 都以脱敏原因上报为 `failed`；harness 记录在本地保留完整细节。
- 被撤销的任务（HTTP 409）会停止 harness，状态交给控制面。
- 检查点推送失败只记录日志，不使任务失败。
- 超出预算会停止 harness，并以预算原因失败。
- `SIGINT`/`SIGTERM` 会在检查点后把运行中的任务交还队列。

### 4.6 测试

单元测试与模块同目录（`daemon.test.ts`、`job-runner.test.ts`、`workspace.test.ts`、
`readiness.test.ts`、`git.test.ts`、`checks.test.ts`、`ports.test.ts`、`gc.test.ts`、
`config.test.ts`、`api.test.ts`）。测试使用 `file://` 下的 git fixture、`FakeHarness` 和记录型
控制面。`tests/e2e/job.test.ts` 在进程内运行完整循环。

---

## 5. `packages/shared` — 契约与纯规则

### 5.1 职责

在通信两端共享的唯一词汇定义。它不依赖数据库、网络或进程。

### 5.2 模块

| 模块                | 内容                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `states.ts`         | `JOB_STATUSES`、`RUNNER_STAGES`、转换表、标签、标题、任务类型。                                                       |
| `events.ts`         | 所有任务事件的判别联合（`stage_changed`、`usage`、`question`、`gate` 等）。                                           |
| `api.ts`            | join、heartbeat、claim、stage、ask、evidence、confidence、plan、checkpoint、PR、onboarding、readiness 的 Zod schema。 |
| `recipe.ts`         | `RecipeSchema`（install、checks、dev server、services、env file、system deps、warm、OS、UI 路径）。                   |
| `policy.ts`         | `PolicySchema`（合并模式、CI/AI 审查要求、循环/成本/diff 限制、风险规则、权限）。                                     |
| `gate.ts`           | 实现置信度门禁的 `evaluateGate()`。                                                                                   |
| `risk.ts`           | 路径 glob/regex 风险匹配、UI 变更检测、审查者拆分。                                                                   |
| `diff.ts`           | 统一 diff 和 GitHub 文件 diff 解析、变更行数统计。                                                                    |
| `scheduler.ts`      | 心跳/sticky 常量、资格判断、runner 排序、本地调度评估。                                                               |
| `tokens.ts`         | HMAC 签名/验证、随机 token、SHA-256。                                                                                 |
| `comments.ts`       | 问题/状态/PR 渲染、复选框和回复解析、`/foundry` 命令解析。                                                            |
| `brief.ts`          | 交接简报 schema、ref 命名、Markdown 渲染/解析。                                                                       |
| `notify.ts`         | 外发 webhook 负载构建和单行通知文本。                                                                                 |
| `pricing.ts`        | token 成本回退表。                                                                                                    |
| `proxy.ts`          | 代理解析、localhost 排除、环境变量注入、git 代理参数。                                                                |
| `github-host.ts`    | GitHub.com 与 GHES URL 推导及 env 文件加载。                                                                          |
| `install-script.ts` | `curl                                                                                                                 | sh` 安装脚本模板。 |
| `ticket.ts`         | Issue 分节解析（Goal、Acceptance criteria、Constraints、Out of scope）。                                              |
| `version.ts`        | runner/产品版本字符串。                                                                                               |

### 5.3 测试

纯单元测试覆盖状态转换、门禁规则、policy/recipe 解析、调度排序、token 验证、代理行为、风险匹配、
diff 解析和评论渲染。

---

## 6. `packages/db` — 持久化

### 6.1 职责

Postgres schema、迁移、NOTIFY 触发器和报表视图。它导出 Drizzle 模型和数据库工厂，不包含业务决策。

### 6.2 模块

| 模块                            | 职责                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`                     | 所有表和索引（teams、users、repos、runners、readiness、jobs、events、questions、inputs、evidence、artifacts、webhook inbox、notifications）。 |
| `migrations/`                   | 有序 SQL 迁移，包括 NOTIFY 触发器和 `metrics_*` 视图。                                                                                        |
| `migrate.ts` / `migrate-cli.ts` | 应用迁移；供 `pnpm db:migrate` 和 compose `migrate` 服务使用。                                                                                |
| `index.ts`                      | `getDatabase()` 和导出的行类型。                                                                                                              |
| `testing.ts`                    | API 测试用的一次性数据库辅助工具。                                                                                                            |

### 6.3 重要约束

- 每张表直接或通过 job/repo 归属于团队。
- `webhook_inbox` 有唯一 `(provider, delivery_id)` 键；任务/issue 的唯一性由部分唯一索引保证，
  使一个 issue 最多只有一个活跃任务。
- 事件只追加，并按 `(job_id, id)` 和 `(team_id, ts)` 建索引。
- 时间戳使用 `timestamptz`；应用代码在嵌套 SQL 片段中传 ISO 字符串。
- 报表视图让指标查询远离热路径。

---

## 7. `packages/control` — 控制面业务规则

### 7.1 职责

控制面拥有的全部规则，都针对 `ControlContext` 编写：

```ts
interface ControlContext {
  db: Db;
  sql: Sql;
  gh: GitHubClient;
  notifier: Notifier;
  publicUrl: string;
  realtimeUrl: string;
  secret: string;
  now(): Date;
  log(message: string, extra?: Record<string, unknown>): void;
}
```

### 7.2 模块

| 模块             | 职责                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `ingest.ts`      | 幂等 webhook 存储、按事件类型分发、重试待处理投递。                                                             |
| `jobs.ts`        | 获取/转换任务、从 issue 创建任务、记录事件和 usage、排队人工输入、发送消息、取消、重试、核对带标签 issue。      |
| `claim.ts`       | 调度快照、`SKIP LOCKED` 原子领取、恢复模式选择、花费上限、队列诊断。                                            |
| `runner-api.ts`  | 带认证的单任务动作：events、stage、ask、evidence、confidence、plan、checkpoint、inputs、git token；所有权检查。 |
| `merge-gate.ts`  | 最新证据、门禁评估、自动合并、带审查者的交接、已合并/changes-requested 补偿。                                   |
| `prs.ts`         | 创建或刷新 PR，根据计划/证据/置信度渲染正文，转换到 `pr_ci`，评估门禁。                                         |
| `onboarding.ts`  | 启动/重启 onboarding，通过创建 recipe PR 或失败来完成。                                                         |
| `questions.ts`   | 提问，从面板/复选框/回复回答，更新 GitHub 评论，所有开放问题回答后重新排队。                                    |
| `repos.ts`       | 刷新缓存的 `.foundry/` 文件、解析 recipe/policy、有效合并模式、仓库设置。                                       |
| `teams.ts`       | 用户、团队、成员、邀请、安装关联与解除。                                                                        |
| `runners.ts`     | Join token、runner 认证、心跳、就绪、drain/remove、团队 runner。                                                |
| `github-sync.ts` | 每个任务一条状态评论、恰好一个 `foundry:<stage>` 标签、可选的 Projects 状态。                                   |
| `notify.ts`      | 渠道通知器（webhook/email/push/digest）、收件人、投递日志。                                                     |
| `sweeper.ts`     | 重新排队停止心跳的 runner 上的任务。                                                                            |
| `worker.ts`      | 30 秒循环：webhook 重试、PR/审查/issue 补偿、sweeper 和摘要。                                                   |
| `artifacts.ts`   | 把 artifact 存到磁盘并生成签名 URL。                                                                            |
| `metrics.ts`     | 从报表视图/事件计算团队指标和容量卡片。                                                                         |
| `queries.ts`     | 面板读模型（inbox、看板、任务详情、仓库、runner、指标）。                                                       |
| `context.ts`     | 上下文类型、任务 URL 辅助、尽力而为副作用。                                                                     |
| `testing.ts`     | `createTestEnv`、fake 种子、`TEST_RECIPE`。                                                                     |

### 7.3 失败行为

- GitHub 和通知调用是尽力而为；任务状态先提交。
- `transitionJob` 锁定行、验证边，然后才写事件并同步 GitHub。
- runner 不合格时，`claimJob` 返回 `null` 而不是抛错。
- `ownedJob` 拒绝不再持有该任务的 runner（`409` → runner 停止）。
- Webhook 处理记录错误和尝试次数；worker 会重试。

---

## 8. `packages/github` — GitHub App 客户端

### 8.1 职责

控制面使用的 GitHub REST/GraphQL API 窄接口，以及用于测试的高保真内存 fake。

### 8.2 模块

| 模块          | 职责                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`    | `GitHubClient`、`RepoRef`、issue、PR、审查、安装、CI 状态。                                                                     |
| `octokit.ts`  | `OctokitGitHubClient`：App 认证、缓存安装 Octokit、issue、评论、标签、文件、PR、审查、审查者、合并、CI 状态、Projects v2 状态。 |
| `webhooks.ts` | `verifyWebhookSignature`（HMAC SHA-256）。                                                                                      |
| `fake.ts`     | `FakeGitHub`，带调用记录、合并/CI/审查控制和 webhook 签名辅助。                                                                 |

### 8.3 设计说明

- 在请求时解析 `fetch`，以便使用 web 应用的代理包装。
- 安装 Octokit 缓存 30 分钟；App 级调用在本地签 JWT。
- `combineCi` 合并 check run 和 commit status；必需检查默认视为 pending。
- 对可选资源（标签、文件、分支、评论）的 404 视为“不存在”。
- GHES 通过 `GITHUB_HOST` 推导 `/api/v3` 和 `/api/graphql` 基址。

### 8.4 测试

`github.test.ts` 覆盖 fake；`octokit.mock.test.ts` 使用 undici `MockAgent` 覆盖真实客户端
（全局 dispatcher、禁用网络、持久化安装 token 端点）。

---

## 9. Harness 适配器

### 9.1 `packages/harness-core`

每个 harness 都实现的契约：

```ts
interface HarnessAdapter {
  id: "claude-code" | "opencode";
  detect(): Promise<{ installed: boolean; version?: string; authOk: boolean }>;
  start(opts: StartOpts): Promise<HarnessSession>;
  resume(sessionId: string, message: string, opts: ResumeOpts): Promise<HarnessSession>;
  stop(session: HarnessSession): Promise<void>;
  release?(cwd: string): Promise<void>;
}
```

`StartOpts` 携带 worktree、模型、系统提示、用户提示、环境变量、MCP 服务器、权限、可选 harness
端口、记录路径和脱敏函数。会话暴露原生 ID promise、规范化事件和 `done` 结果。该包还提供
`AsyncQueue`、`deferred`、记录日志和 `FakeHarness`。

### 9.2 `packages/harness-claude-code`

- 在进程内使用 `@anthropic-ai/claude-agent-sdk`。编译版 runner 会通过 `FOUNDRY_CLAUDE_PATH`
  或 PATH 上的 `claude` CLI 指向已安装引擎；源码运行时使用 SDK 自带引擎。
- 只加载项目设置（`settingSources: ["project"]`），但合并 `~/.claude/settings.json` 的 `env`
  块，使 provider key 和 base URL 继续生效。
- 把策略转换为 `disallowedTools` 和 `canUseTool` 处理器；被禁止的 shell 命令会被拒绝并说明原因。
- `normalize.ts` 把 SDK 消息映射为 Foundry 事件：消息、工具调用、子 Agent、usage 和错误。成本来自
  SDK 结果消息。
- Resume 使用 `resume: <sessionId>`；成本按原生会话跟踪。

### 9.3 `packages/harness-opencode`

- 在 worktree 中、任务租用的 harness 端口上启动 `opencode serve`，并通过
  `OPENCODE_CONFIG_CONTENT` 传入由 MCP 服务器、权限和模型生成的配置。
- 就绪判断是 `/config` 返回 2xx，而不仅仅是端口监听（路由器启动更晚）。
- 创建或复用会话，并通过 `session.promptAsync` 发送提示。
- `events.ts` 把 OpenCode 事件流映射为 Foundry 事件，每个文本片段、工具调用和步骤只发一次；记录
  provider 重试，三次后失败。
- 成本优先取 `step-finish` 中的 provider 上报值，否则使用共享价格表。
- 服务器在回合之间保持运行；任务结束时 `release(cwd)` 杀掉它。

### 9.4 测试

`harness-core.test.ts` 覆盖队列/fake。Claude 测试覆盖规范化与策略映射。OpenCode 测试覆盖事件
映射、配置生成，以及在 PATH 上有 `opencode` 时运行真实服务器会话（否则跳过）。

---

## 10. `packages/mcp-foundry` — 单任务 MCP 服务器

### 10.1 职责

为 Agent 提供显式、与 harness 无关的进度 API：

| 工具         | 作用                                             |
| ------------ | ------------------------------------------------ |
| `stage`      | 进入下一个 playbook 阶段；`done` 触发验证和 PR。 |
| `plan`       | 保存实现计划。                                   |
| `ask`        | 向 issue 作者提出一个决策问题并停放任务。        |
| `evidence`   | 附加截图（worktree 内的 PNG/JPEG/WebP）或备注。  |
| `run_checks` | 运行 recipe 检查；结果成为门禁证据。             |
| `confidence` | 报告 high/medium/low 和未决不确定性。            |

### 10.2 设计

- `createFoundryMcpServer(bridge)` 用 MCP SDK 注册工具；每次调用转发给 `ToolBridge`。
- `bridgeFromEnv()` 从 `FOUNDRY_MCP_SOCKET` 或 `FOUNDRY_MCP_URL` 以及 `FOUNDRY_JOB_ID`、
  `FOUNDRY_MCP_TOKEN` 解析 runner 端点。
- runner 的 `ToolServer` 验证单任务 token，防止一个任务替另一个任务汇报。
- `foundry mcp` 是 stdio 入口；开发时从源码运行，发布版由编译后的二进制自我调用。

### 10.3 失败行为

如果 runner 不可达，工具返回 MCP 错误文本；Agent 可以重试或报告低置信度。runner 从不信任声称属于
另一个任务的工具调用。

---

## 11. `packages/os-adapters` — 平台差异

### 11.1 职责

把所有操作系统相关操作放在一个接口之后：

```ts
interface OsAdapter {
  os: "macos" | "linux" | "windows";
  info(): Promise<MachineInfo>;
  diskFreeMb(path: string): Promise<number>;
  onAcPower(): Promise<boolean | null>;
  idleSeconds(): Promise<number | null>;
  inhibitSleep(reason: string): Promise<SleepInhibitor>;
  service(spec: ServiceSpec): ServiceInstall;
  createUserCommands(user: string, home: string): string[][];
  secrets(): Promise<SecretStore>;
  wrapWithLimits(argv: string[], limits: ResourceLimits): Promise<string[]>;
}
```

### 11.2 实现

| 关注点   | macOS                              | Linux                                      | Windows                                        |
| -------- | ---------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| 服务     | 每个 runner 名称一个 launchd plist | 每个 runner 名称一个 systemd 用户/系统单元 | Startup `.cmd`                                 |
| 密钥     | Keychain（自定义 home 用文件存储） | `systemd-creds`（root）或 `0600` 文件      | `0600` 文件                                    |
| 电源     | `pmset -g batt`                    | `/sys/class/power_supply`                  | `Get-CimInstance Win32_Battery`                |
| 空闲     | `ioreg` HID 空闲时间               | `loginctl` 空闲提示                        | 未实现（返回 `null`）                          |
| 睡眠抑制 | `caffeinate -i -w <pid>`           | `systemd-inhibit`                          | 通过 PowerShell 调用 `SetThreadExecutionState` |
| 限制     | `nice`（尽力而为）                 | 可用时 `systemd-run --scope` cgroups       | 无（超时/杀进程）                              |
| 进程树   | 使用进程组的 `killTree`            | 同上                                       | 通过共享 helper 的 `taskkill /T` 行为          |

`exec.ts` 提供 promise 化命令执行、磁盘剩余和 `which` 辅助；`home.ts` 解析 `FOUNDRY_HOME` 和
自定义 home；`service-names.ts` 把名称规范化为服务安全 slug。

### 11.3 测试

`os.test.ts` 和 `windows.test.ts` 覆盖 `pmset`、`ioreg`、`loginctl`、电源供应、launchd/systemd
渲染和 Windows 脚本的单元解析，不触碰宿主机。

---

## 12. `packages/playbooks` — 如何指示 Agent

### 12.1 职责

拥有把 issue 变成分阶段 playbook 的文本，并组装系统提示。

### 12.2 内容

- 内置：`default`（triage → investigate → implement → verify）、`bugfix`、`feature`、
  `onboarding`。
- 仓库覆盖：`.foundry/playbook.md`、`.foundry/playbook.<name>.md`，以及按 harness 的备注
  `.foundry/playbook.<harness>.md`；`.foundry/skills/*.md` 作为仓库知识追加。
- `assemblePrompt()` 构建系统提示和第一条用户消息，包含 issue、验收标准提示、portable resume
  简报和待处理人工输入。
- `resumeMessage()`、`NUDGE_MESSAGE` 和 `verifyFailedMessage()` 统一暂停、提前停止或验证失败后
  Agent 看到的内容。

### 12.3 设计说明

- Markdown 通过 `with { type: "text" }` 导入；Vitest 用 transform 模拟。
- Playbook 是纯 Markdown，仓库无需改代码即可替换。
- runner 独立强制执行阶段顺序；playbook 不能跳过阶段。

---

## 13. `deploy/` 与 `packaging/` — 交付

### 13.1 `deploy/`

- `compose.yaml`：Postgres、一次性迁移、web、realtime、Caddy；数据库、artifact 和 Caddy 状态的
  命名卷；`github-app.pem` bind mount。
- `Caddyfile`：把 `/realtime*` 代理到 realtime，其余代理到 web，启用 gzip。
- `apps/web/Dockerfile`：deps → build → standalone web；另有供一次性任务使用的 `migrate` target。
- `apps/realtime/Dockerfile`：只安装 realtime workspace 并启动。

### 13.2 `packaging/`

- `apps/runner/scripts/build-release.ts` 为 darwin/linux/windows x64/arm64 编译 `foundry`，生成
  tarball、`SHA256SUMS`、`install.sh`、Homebrew formula，以及（存在 `nfpm` 时）`.deb` / `.rpm`。
- `packaging/homebrew/foundry.rb.tmpl` 和 `packaging/linux/postinstall.sh` 提示用户显式 join 并
  安装服务；安装包本身不会自动开始工作。

### 13.3 发布契约

每个平台一个可执行文件，版本来自 `VERSION`；产物可在 CI 中复现，Homebrew/Linux 安装器按 OS 和架构
解析匹配的 tarball。

---

## 14. 跨组件契约

| 契约                    | 拥有者                                        | 使用方                                 |
| ----------------------- | --------------------------------------------- | -------------------------------------- |
| 任务状态和转换          | `packages/shared/states.ts`                   | control、runner、面板、GitHub 标签     |
| 事件联合                | `packages/shared/events.ts`                   | runner、control、面板                  |
| Runner API schema       | `packages/shared/api.ts`                      | runner HTTP 客户端、web 路由、control  |
| Recipe 和 policy schema | `packages/shared/recipe.ts`、`policy.ts`      | runner、control、onboarding、readiness |
| 门禁输入/输出           | `packages/shared/gate.ts`                     | control 合并门禁、测试                 |
| Harness 适配器          | `packages/harness-core`                       | runner、Claude/OpenCode 适配器、测试   |
| MCP 工具面              | `packages/mcp-foundry`                        | Agent、runner 工具服务器               |
| 交接简报                | `packages/shared/brief.ts`                    | runner 检查点/恢复                     |
| Realtime 消息           | `apps/realtime` + `packages/shared/tokens.ts` | 面板、runner daemon                    |

## 15. 如何修改组件

1. 在拥有该规则的最小包中修改；不要把业务逻辑放进路由处理器。
2. 如果跨组件契约变化，先改 `packages/shared`，再改两个使用方。
3. 在模块旁添加单元测试；涉及边界时添加 API/e2e 测试。
4. 当行为或边界变化时，同步更新本文和 `overall-design.zh-CN.md`，两种语言都要更新。
