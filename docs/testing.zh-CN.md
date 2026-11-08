# 测试架构

> English: [testing.md](testing.md)

Foundry 使用三层测试。共享 fake 和 fixture 位于 `tests/helpers.ts`（重新导出
`@foundry/control/testing`、`@foundry/db/testing`、`FakeGitHub`、`FakeHarness`）。优先使用这些，
而不是一次性搭建 Postgres 或 GitHub。

| 层级                | 证明什么                                                        | 如何运行                                    | 需要                                          |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| **Unit**            | 纯逻辑、适配器、带 git fixture 的 runner                        | `pnpm test:unit`                            | 无需额外环境                                  |
| **Component / API** | 控制面 + Next 路由处理器，针对一次性数据库                      | `pnpm test:api`                             | `FOUNDRY_TEST_DATABASE_URL`                   |
| **E2E**             | 进程内任务循环（`tests/e2e`）和真实浏览器中的面板（Playwright） | `pnpm test --project e2e` · `pnpm test:e2e` | 任务 e2e 需要数据库；Playwright 需要 Chromium |

`pnpm test` 运行 Vitest 项目（unit + api + 进程内 e2e）。未设置
`FOUNDRY_TEST_DATABASE_URL` 时，数据库用例会**跳过**。Playwright 单独运行，使只需要 Vitest 的任务
保持快速。

## 第 1 层 — unit

与代码同目录的 `*.test.ts`：

- `packages/shared`、`github`、`harness-*`、`os-adapters`、`mcp-foundry`、`playbooks`
- `apps/runner`（git fixture + `FakeHarness` + `RecordingControlPlane`）
- `apps/realtime`

不需要控制面 Postgres。Git 测试设置 `FOUNDRY_GIT_BASE=file://…`。

### GitHub HTTP — undici `MockAgent`

控制面测试保留 `FakeGitHub`（`setGitHub`）。这个替身不会运行 `OctokitGitHubClient`。

使用 undici `MockAgent` 覆盖真实客户端，参见 `packages/github/src/octokit.mock.test.ts`。
`@foundry/github` 为此依赖 `undici`。

- `OctokitGitHubClient` 调用 `globalThis.fetch`。`setGlobalDispatcher(agent)` 让 Node 的 fetch
  命中 mock。保存之前的 dispatcher，并在 `afterAll` 中恢复。
- `agent.disableNetConnect()`，这样忘记 stub 时会失败，而不是调用 `api.github.com`。
- App 认证在本地签 JWT。HTTP 调用是 `POST /app/installations/:id/access_tokens`。用
  `persist()` 拦截它；没有它，安装级方法无法运行。
- 用函数匹配路径，并忽略 `?per_page=100`。响应没有 `Link` header 时分页停止。
- 请求体是异步可迭代对象。在分支前先读取（GraphQL 是一个 `POST /graphql`）。
- 不要把全局 `MockAgent` 指向 `apps/web/src/server/retry-fetch.ts`。该 helper 使用
  `ProxyAgent` dispatcher 调用 `undici.fetch`，会绕过全局 mock。

## 第 2 层 — component / API

- **Component：** `packages/control/src/control.test.ts`、`packages/db/src/db.test.ts`——真实
  schema、`FakeGitHub`、`createTestEnv()`。
- **API：** `tests/api/*.test.ts`——导入 Next `POST` 处理器，用 `setContextForTests` 注入测试
  控制面。Shim：`tests/shims/server-only.ts`、`tests/shims/next-server.ts`（使 `next/server`
  的 `after()` 可等待）。

`FOUNDRY_TEST_DATABASE_URL` 必须是一个可以 `CREATE DATABASE` 的 Postgres。优先使用与 `.env` 相同的
服务器，**不要**使用 `foundry` 应用数据库。

## 第 3 层 — e2e

- **进程内：** `tests/e2e/harness.ts`（`createE2E`、`GitBackedGitHub`、`DirectControlPlane`）
  加上 `tests/e2e/job.test.ts`。在一次性数据库上运行真实 daemon；模型是 `FakeHarness`。更重的任务
  路径（自动合并、ask、portable resume）属于后续工作，不在本套件的冒烟测试中。
- **Playwright：** `tests/playwright/*.spec.ts`。在端口 3456 启动 `next dev`，**不设置**
  `DATABASE_URL`，使 worker 保持关闭；`/signin` 是公开页面。用 `FOUNDRY_E2E_BASE_URL` 指向正在
  运行的面板。浏览器安装一次：`pnpm exec playwright install chromium`。`@playwright/test` 固定
  在 1.48，以便 Chromium 仍能在 macOS 12 上安装。

## 覆盖率报告

```bash
FOUNDRY_TEST_DATABASE_URL=postgres://USER@HOST:PORT/postgres pnpm test:report
```

写入 `coverage/`（gitignored 的 HTML/LCOV）和 `docs/testing-report.md`（提交的覆盖率快照）。
