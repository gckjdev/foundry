# Foundry

> English: [README.md](README.md)

Foundry 把 GitHub issue 转化为经过验证、已经合并的 pull request。编码 Agent（Claude Code 或
OpenCode）在团队自己的 Mac 和 Linux 机器上运行，按照固定 playbook（triage、investigate、
implement、verify、PR）工作，并由置信度门禁决定变更是自动合并还是交给人工。

产品规格：`software-factory-product-spec.zh-CN.md`（v0.5）。

## 目录结构

| 路径                   | 内容                                                                            |
| ---------------------- | ------------------------------------------------------------------------------- |
| `apps/web`             | 控制面：Next.js 面板、API 路由、webhook 接收、runner API                        |
| `apps/realtime`        | Postgres LISTEN/NOTIFY 到 WebSocket 广播                                        |
| `apps/runner`          | Runner daemon 和 `foundry` CLI（Bun，按平台编译）                               |
| `packages/shared`      | zod schema、状态机、门禁、调度器、GitHub 评论模板                               |
| `packages/db`          | Drizzle schema、SQL 迁移、NOTIFY 触发器                                         |
| `packages/control`     | 控制面服务：ingest、jobs、claiming、questions、gate、sweeper、notifier、metrics |
| `packages/github`      | GitHub App 客户端（以及测试用的内存 fake）                                      |
| `packages/harness-*`   | Harness 适配器接口、Claude Code 和 OpenCode 适配器                              |
| `packages/mcp-foundry` | 单任务 MCP 服务器：`stage`、`ask`、`evidence`、`confidence`、`plan`             |
| `packages/os-adapters` | macOS 和 Linux 适配器（服务、用户、密钥、限制、睡眠、空闲、电源）               |
| `packages/playbooks`   | 默认 playbook 和提示词组装                                                      |
| `deploy/`              | Docker Compose 栈（web、realtime、Postgres、Caddy）                             |

## 开发

```bash
pnpm install
cp .env.example .env            # 填写 GitHub App + OAuth 值
docker compose -f deploy/compose.yaml up -d postgres   # 或任意 Postgres 16+
pnpm db:migrate
pnpm dev                        # web 在 :3000，realtime 在 :3001
pnpm dev:webhooks               # 通过 smee.io 转发 GitHub webhook
```

重启控制面：在该终端按 **Ctrl+C**，然后再次运行 `pnpm dev`。如果 3000/3001 端口仍被占用：
`lsof -ti tcp:3000,3001 | xargs kill`，然后 `pnpm dev`。Runner 是独立进程——在它的终端按
**Ctrl+C**，然后运行 `pnpm dev:runner`。细节见 `docs/local-setup.zh-CN.md` §4。

Runner 是独立进程（先加入团队，再启动）：

```bash
bun apps/runner/src/cli.ts runner join <token> --server http://localhost:3000
pnpm dev:runner
```

在同一个 daemon 上运行多个任务：用 `--concurrency N` 重新 join。同一登录下的第二个 daemon 需要
自己的 `--name` 和 `--home`（`docs/local-setup.zh-CN.md` §3）。

测试：`pnpm test`（unit + API + 进程内 e2e）。设置 `FOUNDRY_TEST_DATABASE_URL` 指向一个可以创建
数据库的 Postgres，否则数据库测试会被跳过。浏览器 e2e：`pnpm test:e2e`。覆盖率：
`pnpm test:report`。见 `docs/testing.zh-CN.md`。

GitHub App URL、`.env`（包括 `FOUNDRY_HTTP_PROXY`）、本地 Postgres 和 Docker Compose 部署见
`docs/local-setup.zh-CN.md`。仓库 onboarding（join token、runner、recipe PR）见
`docs/onboarding.zh-CN.md`。`.foundry/` 下每个文件以及 `recipe.yaml` / `policy.yaml` 每个字段的
参考见 `docs/foundry-dot-dir.zh-CN.md`。

## 文档

所有面向人的文档都有中文版本。

| 文档                         | English                                                              | 中文                                                                             |
| ---------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 产品规格                     | [software-factory-product-spec.md](software-factory-product-spec.md) | [software-factory-product-spec.zh-CN.md](software-factory-product-spec.zh-CN.md) |
| 总体方案设计                 | [docs/design/overall-design.md](docs/design/overall-design.md)       | [docs/design/overall-design.zh-CN.md](docs/design/overall-design.zh-CN.md)       |
| 组件方案设计                 | [docs/design/components.md](docs/design/components.md)               | [docs/design/components.zh-CN.md](docs/design/components.zh-CN.md)               |
| 核心用例与序列图             | [docs/design/use-cases.md](docs/design/use-cases.md)                 | [docs/design/use-cases.zh-CN.md](docs/design/use-cases.zh-CN.md)                 |
| 配置、安装与部署             | [docs/local-setup.md](docs/local-setup.md)                           | [docs/local-setup.zh-CN.md](docs/local-setup.zh-CN.md)                           |
| 仓库 onboarding              | [docs/onboarding.md](docs/onboarding.md)                             | [docs/onboarding.zh-CN.md](docs/onboarding.zh-CN.md)                             |
| `.foundry/` 字段参考         | [docs/foundry-dot-dir.md](docs/foundry-dot-dir.md)                   | [docs/foundry-dot-dir.zh-CN.md](docs/foundry-dot-dir.zh-CN.md)                   |
| 测试架构                     | [docs/testing.md](docs/testing.md)                                   | [docs/testing.zh-CN.md](docs/testing.zh-CN.md)                                   |
| 测试覆盖率快照               | [docs/testing-report.md](docs/testing-report.md)                     | [docs/testing-report.zh-CN.md](docs/testing-report.zh-CN.md)                     |
| ADR 001：Runner 运行时与打包 | [docs/adr/001-runner-runtime.md](docs/adr/001-runner-runtime.md)     | [docs/adr/001-runner-runtime.zh-CN.md](docs/adr/001-runner-runtime.zh-CN.md)     |
| Agent 开发说明               | [AGENTS.md](AGENTS.md)                                               | 不翻译（见工单约束）                                                             |
| Claude Code 说明             | [CLAUDE.md](CLAUDE.md)                                               | 不翻译（见工单约束）                                                             |
