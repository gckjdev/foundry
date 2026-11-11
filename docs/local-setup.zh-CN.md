# 配置、安装与部署

> English: [local-setup.md](local-setup.md)

这是本机上 Foundry 控制面的运行手册，以及如何部署它。密钥只存放在被 gitignore 的 `.env` 和
`github-app.pem` 中——绝不要把那些值复制到 git 里。

## 本地正在运行什么

| 组件               | 方式                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Web 面板           | `http://localhost:3000`（`pnpm dev`）                                                        |
| Realtime WebSocket | `ws://localhost:3001`                                                                        |
| Postgres           | Anaconda PostgreSQL 17，数据目录 `~/pgdata`，端口 **54329**（不是 Docker；登录时不自动启动） |
| GitHub App         | [gckjdevfoundryapp](https://github.com/settings/apps/gckjdevfoundryapp)                      |
| Webhook 隧道       | `pnpm dev:webhooks` → smee.io → `/api/webhooks/github`                                       |
| Runner             | **不**由 `pnpm dev` 启动；先加入团队，再运行 `pnpm dev:runner`                               |

仓库：`git@github.com:gckjdev/foundry.git`。根 `.env` 权限为 600。`apps/web/.env` 和
`apps/realtime/.env` 是指向 `../../.env` 的符号链接。

## 前置条件

- Node 22+、pnpm 10（根 `package.json` 中的 `packageManager`）
- Postgres 16+
- Bun（仅 runner / CLI）
- 一个你管理的 GitHub App，以及它的私钥 `.pem`
- 可选：如果本机无法直接访问 GitHub 或模型 API，设置 `FOUNDRY_HTTP_PROXY`

## 1. GitHub App

打开 **GitHub → Settings → Developer settings → GitHub Apps**（本实例：
[gckjdevfoundryapp](https://github.com/settings/apps/gckjdevfoundryapp)）。

### URL（本地）

在 App 上设置这些值，部署到公网主机后再修改。

| 字段         | 本地值                                                                |
| ------------ | --------------------------------------------------------------------- |
| Homepage URL | `http://localhost:3000`                                               |
| Callback URL | `http://localhost:3000/api/auth/callback/github`                      |
| Setup URL    | `http://localhost:3000/api/github/setup`                              |
| Webhook URL  | 你的 smee 频道，例如 `https://smee.io/<id>`（必须与 `SMEE_URL` 一致） |

“Expire user authorization tokens” 可以保持开启。识别和授权用户（OAuth）使用 App 的
**Client ID** / **Client secret**，即 `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`。

### 权限

仓库：

- **Metadata** — Read
- **Contents** — Read and write
- **Issues** — Read and write
- **Pull requests** — Read and write
- **Checks** — Read（合并门禁需要）
- **Commit statuses** — Read
- **Workflows** — Read and write（推送 `.github/workflows/` 下的变更需要；没有该权限 GitHub 会拒绝
  任务分支）

添加或修改权限后，打开该账号上的 App 安装（本机为
[installation 179251611](https://github.com/settings/installations/179251611)）并**接受新权限**。
在接受之前，token 仍使用旧权限，推送 workflow 文件仍会失败。

账号：

- **Email addresses** — Read（使用 GitHub 登录）

### Webhook 事件

订阅：`installation`、`installation_repositories`、`push`、`issues`、`issue_comment`、
`pull_request`、`pull_request_review`、`check_suite`、`check_run`、`status`。

投递契约——header、签名校验、响应以及 Foundry 会处理的事件：见
[`api.zh-CN.md` §6](api.zh-CN.md#6-github-webhook)。

### 复制到 `.env` 的凭据

从 App 页面：

- **App ID** → `GITHUB_APP_ID`（本 App 为 `5641757`）
- URL 中的 **Slug** → `GITHUB_APP_SLUG`（`gckjdevfoundryapp`）
- **Client ID**（`Iv23…`）→ `AUTH_GITHUB_ID`
- **Client secret** → `AUTH_GITHUB_SECRET`
- **Webhook secret** → `GITHUB_WEBHOOK_SECRET`
- 生成私钥，保存为仓库根目录的 `github-app.pem`（gitignored），把
  `GITHUB_APP_PRIVATE_KEY_PATH` 设为该绝对路径或仓库相对路径

### GitHub Enterprise Server（GHES）

要让 Foundry 指向自托管 GitHub Enterprise Server（GHES 3.12+）而不是 github.com，在 `.env` 中
设置一个 host，其余全部从它推导：

```bash
GITHUB_HOST=https://github.example.com
```

Foundry 随后会推导出 `https://github.example.com/api/v3`（REST）、
`https://github.example.com/api/graphql`（GraphQL/Projects v2）、OAuth authorize/token/userinfo
端点、git remote、App 安装链接以及 issue/PR 链接。github.com 请留空/不设置 `GITHUB_HOST`（它会
保留特例的 `https://api.github.com` REST host）。一个控制面只连接一个 GitHub host。

- 在**该 GHES 实例**上（不是 github.com）创建 GitHub App，并填写与上面相同的 App ID / slug /
  client ID / secret / 私钥 / webhook secret。使用与 github.com 相同的仓库和账号权限；任何变更后
  都要在安装上接受。
- App 的 **Webhook URL** 和 OAuth **Callback URL** 仍然是 Foundry 的 URL
  （`https://<foundry>/api/webhooks/github` 和 `/api/auth/callback/github`）。webhook 路径和签名
  验证不变。
- smee 只有在 GHES 能访问 smee URL 时才可用。如果不能，请使用 GHES 可调用的 webhook 隧道，或
  公开 Foundry host 自己的 `/api/webhooks/github`。
- GHES 必须提供 Node 信任的证书。Foundry **不会**禁用 TLS 验证；请把企业 CA 加入机器信任库，而不是
  设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`。
- 可选覆盖项 `GITHUB_API_URL` 和 `FOUNDRY_GIT_BASE` 在设置时优先于推导值。
- 较旧的 GHES 可能没有 GitHub Projects (v2) 和部分合并 API。项目状态同步在 404 时记录并跳过，不会
  使任务失败。

## 2. 环境变量

```bash
cp .env.example .env
chmod 600 .env
ln -sfn ../../.env apps/web/.env
ln -sfn ../../.env apps/realtime/.env
```

填写文件。本机的非密钥值：

```bash
DATABASE_URL=postgres://postgres@localhost:54329/foundry
FOUNDRY_PUBLIC_URL=http://localhost:3000
FOUNDRY_REALTIME_URL=ws://localhost:3001
GITHUB_APP_ID=5641757
GITHUB_APP_SLUG=gckjdevfoundryapp
GITHUB_APP_PRIVATE_KEY_PATH=/Users/pipi/foundry/github-app.pem
AUTH_URL=http://localhost:3000
AUTH_TRUST_HOST=true
FOUNDRY_HTTP_PROXY=http://127.0.0.1:8118
# AUTH_GITHUB_ID / AUTH_GITHUB_SECRET / AUTH_SECRET / FOUNDRY_SECRET /
# GITHUB_WEBHOOK_SECRET / SMEE_URL / VAPID_*  → 已在 .env 中，不要提交
```

如果从 `.env.example` 开始，请为 `FOUNDRY_SECRET` 和 `AUTH_SECRET` 生成足够长的随机值。

设置 `FOUNDRY_HTTP_PROXY`（例如 `http://127.0.0.1:8118`），让**所有**出站 HTTP 调用——GitHub
OAuth/API、外发 webhook、git fetch/push、OpenCode/Claude 模型 API——都使用该代理。Localhost
（面板、realtime、`opencode serve`）通过 `FOUNDRY_NO_PROXY` 排除。如果未设置，Foundry 仍会遵循
`HTTPS_PROXY`/`HTTP_PROXY`，然后使用 macOS 系统代理。修改后重启 `pnpm dev` 和
`pnpm dev:runner`。Runner 在 join 时还会把 `httpProxy` 存入 `~/.foundry/config.json`
（`--http-proxy` 或该环境变量）。

## 3. 本地安装

### 启动 Postgres

本机没有 Docker，也没有 launchd/Homebrew 服务。Postgres 是 Anaconda 17 构建，集群位于
`~/pgdata`，监听 **54329**，与 `DATABASE_URL` 匹配。它不会在登录时启动。

```bash
/opt/anaconda3/bin/pg_ctl -D "$HOME/pgdata" -l "$HOME/pgdata/server.log" -o "-p 54329" start
/opt/anaconda3/bin/pg_isready -h localhost -p 54329
```

停止：

```bash
/opt/anaconda3/bin/pg_ctl -D "$HOME/pgdata" stop
```

应用角色和数据库（本机已创建）：

```bash
/opt/anaconda3/bin/psql -h localhost -p 54329 -d postgres -c "CREATE ROLE postgres WITH LOGIN SUPERUSER;"
/opt/anaconda3/bin/psql -h localhost -p 54329 -d postgres -c "CREATE DATABASE foundry OWNER postgres;"
```

一旦就位，`CREATE ROLE` / `CREATE DATABASE` 会报 “already exists”，这是正常的。测试需要一个可以
`CREATE DATABASE` 的 URL，且在本服务器上**不是** `foundry` 应用数据库：

```bash
FOUNDRY_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres pnpm test
```

然后安装并启动控制面：

```bash
pnpm install
pnpm db:migrate          # 使用 DATABASE_URL
pnpm dev                 # 仅 web :3000 + realtime :3001
```

在第二个终端中，开发 GitHub webhook 时：

```bash
pnpm dev:webhooks        # 从 .env 读取 SMEE_URL（必须与 GitHub App webhook URL 一致）
```

**不要**期望 `pnpm dev` 启动 runner。在创建团队并加入之前，它会以 `not joined yet` 失败。

### 首次登录

1. 打开 `http://localhost:3000` → **Sign in with GitHub** → 授权。
2. 在 `/setup` 创建团队。
3. 在想要的 org/repo 上安装 App（GitHub 会重定向到
   `/api/github/setup?installation_id=…`）。
4. **Repos** 应列出你授权的仓库。如果仍显示 “No repos yet”，点击 **Sync from GitHub**（列表为空时
   面板也会自动同步）。
5. 在 **Runners** 上创建 join token，然后：

```bash
bun apps/runner/src/cli.ts runner join <token> --server http://localhost:3000
pnpm dev:runner
```

然后 onboarding 仓库，使其可以接受任务：`docs/onboarding.zh-CN.md`。recipe PR 合并后，给 issue
加上 `foundry` 标签即可开始工作。

如果 Authorize 后停留在 GitHub 的 “You are being redirected…” 页面，说明 Node 进程无法访问
`github.com`（常见于浏览器使用系统代理而 Node 没有）。在 `.env` 中设置 `FOUNDRY_HTTP_PROXY` 并
重启 `pnpm dev`。

如果安装 App 后 **Repos** 仍为空，说明 Setup URL 在你拥有团队之前运行了（或安装 cookie 过期）。
刷新 `/repos` 或点击 **Sync from GitHub**——Foundry 会列出 App 的安装并关联尚未关联的仓库。保持
`pnpm dev:webhooks` 运行，以便后续 “add/remove repos” 事件保持同步。

### Harness 与模型

每个任务在一个 harness 上运行。**Claude Code** 使用 Anthropic 的模型 ID；**OpenCode** 可以连接
你本地配置的任意 provider，但模型名必须写成 `provider/model`。一个 harness 的模型名不能直接
拿到另一个 harness 上使用。

在 **Settings → Team → Default harness / Default model** 设置默认值。**Repos** 里的仓库卡片可以
为单个仓库覆盖这两项，issue 标签还可以按任务覆盖：`harness:opencode` 和
`model:deepseek/deepseek-chat`。模型字段留空表示继承上一层的默认值。重试失败的任务时会重新读取
这些设置（issue 上的覆盖标签仍然优先），所以 harness 报错后，改好 Repo 的 harness 或模型，再在任务
上点击 **Retry** 即可。

| Harness     | 模型格式                 | 示例                                                                                                           |
| ----------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Claude Code | Anthropic 模型 ID 或别名 | `claude-sonnet-4-5`, `claude-haiku-4-5`                                                                        |
| OpenCode    | `provider/model`         | `anthropic/claude-sonnet-4-5`, `openai/gpt-5.4`, `deepseek/deepseek-chat`, `openrouter/deepseek/deepseek-chat` |

OpenCode 的 provider 前缀是必需的。像 `deepseek-flash` 这样只写模型名，任务会在启动时失败并报
`Model not found: deepseek-flash/.`——请使用 OpenCode 认识的 provider 和模型 ID，例如
`deepseek/deepseek-chat` 而不是 `deepseek-flash`。该 provider 还必须在 runner 机器上完成认证：
`opencode auth login`，或设置对应的环境变量（`DEEPSEEK_API_KEY`、`OPENAI_API_KEY`、
`ANTHROPIC_API_KEY` 等），runner 会自动检测。

### 一台电脑上的多个 runner

一个已加入的 runner 已经会检测 **Claude Code 和 OpenCode**（安装了哪个就检测哪个）。额外的 daemon
用于**独立身份**，而不是同时使用两种 harness。

| 你想要                                                 | 做法                                       |
| ------------------------------------------------------ | ------------------------------------------ |
| 一个 runner 上跑更多任务                               | 用 `--concurrency N` 重新 join 该 runner   |
| 第二个名称、个人 runner 加 `--shared`，或隔离 worktree | 第二个 daemon：自己的 `--name` 和 `--home` |

用**相同** `--name` 重新 join 会更新该 runner。默认名称是 `<user>-<hostname>`。两个 daemon 需要两个
名称，否则第二次 join 会替换 **Runners** 上的第一行。

每个 daemon 有自己的 home。默认是 `~/.foundry`（`config.json`、join token、MCP socket、端口租约、
worktree、日志）。第二个 daemon 必须使用另一个目录。`--home` 为该命令设置目录。导出
`FOUNDRY_HOME` 仍然有效。不要让两个 daemon 指向同一个 home。

`pnpm dev` 不启动 runner。`pnpm dev:runner` 只使用默认 home。在 **Runners** 上创建一个 join
token——它是团队 token，可以用它加入多个 daemon。

```bash
# 终端 A — 默认 home
bun apps/runner/src/cli.ts runner join <token> --server http://localhost:3000 --name pipi-claude
pnpm dev:runner

# 终端 B — 第二个 home 和名称
bun apps/runner/src/cli.ts runner join <token> --server http://localhost:3000 \
  --name pipi-opencode --home ~/.foundry-opencode
bun apps/runner/src/cli.ts runner start --home ~/.foundry-opencode
```

`foundry runner status` 和 `foundry runner status --home ~/.foundry-opencode` 分别报告自己的名称。
如果某个 home 未加入，错误信息会包含该目录。

在 **Runners** 上，两个名称都会显示 **accepting**。心跳相互独立，领取使用行锁，因此两个 daemon
不会拿到同一个任务。

**服务。** `install-service` 为每个 runner 名称写一个单元，并把 `FOUNDRY_HOME` 放入单元环境，因此
安装第二个不会替换第一个。

```bash
bun apps/runner/src/cli.ts runner install-service
bun apps/runner/src/cli.ts runner install-service --home ~/.foundry-opencode
```

|          | macOS                                                             | Linux（用户 systemd）                                                 |
| -------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| 单元     | `~/Library/LaunchAgents/` 中的 `dev.foundry.runner.<name>`        | `foundry-runner-<name>.service`                                       |
| 停止一个 | `foundry runner uninstall-service --home ~/.foundry-opencode`     | 相同参数                                                              |
| 手动停止 | `launchctl bootout gui/$(id -u)/dev.foundry.runner.pipi-opencode` | `systemctl --user disable --now foundry-runner-pipi-opencode.service` |

单元中的名称会转为小写，其他字符转为 `-`。`KeepAlive`（macOS）和 `Restart=always`（Linux）按单元
生效。系统级单元（`--system`）仍需要 sudo；非 root 时命令会打印文件内容或 bootout 命令。

旧版安装使用单一标签 `dev.foundry.runner` / `foundry-runner.service`。安装命名单元后，请 boot out
旧单元，否则同一个 runner 会运行两份。

`~/.foundry` 的 token 保存在 macOS Keychain（Linux 上为 `~/.config/foundry`）。任何其他 home 把
token 存在 `<home>/secrets`，因此第二次 join 不会使第一次失效。

### Windows runner

Windows 10/11（x64）机器可以作为个人 runner 加入。前置条件：

- **Git for Windows**（`git worktree` 需要；runner 不会重新实现 git）。
- **Node 22+** 和 **Bun** 以源码运行，或使用编译好的 `foundry.exe`
  （发布包中的 `foundry-windows-x64.tar.gz`）。
- **Claude Code** 和/或 **OpenCode** 的 Windows 安装程序，并已登录。

```powershell
foundry.exe runner join <token> --server http://<your-foundry>
foundry.exe runner start
```

Windows 上 runner 通过 PowerShell 运行 recipe 的 `install` / `checks` / `dev_server` / `warm`
命令——优先使用 PATH 上的 `pwsh`（PowerShell 7），否则使用 `powershell.exe`。POSIX 的 `&&` 和
`;` 在 PowerShell 7 中也可用，因此为 macOS/Linux 编写的 recipe 通常无需修改即可运行。为 Windows
专用命令设置 `recipe.os: [windows]`；`os: [macos, linux]` 的仓库**不会**被 Windows runner 领取，
而没有 `os:` 约束的仓库可以。单任务 MCP 桥监听 `127.0.0.1:<port>` 而不是 Unix socket。

`foundry.exe runner install-service` 会在当前用户的 **Startup** 文件夹写入 `.cmd`，使 runner 在
登录时启动（没有等价的 launchd/systemd 可管理）。也可以在前台终端运行
`foundry.exe runner start`。

## 4. 日常命令

| 命令                | 作用                                                                               |
| ------------------- | ---------------------------------------------------------------------------------- |
| `pnpm dev`          | 控制面（web + realtime）                                                           |
| `pnpm dev:webhooks` | 通过 smee 转发 GitHub webhook                                                      |
| `pnpm dev:runner`   | Runner daemon（在 `runner join` 之后）                                             |
| `pnpm db:migrate`   | 应用 Drizzle 迁移                                                                  |
| `pnpm test`         | Vitest unit + API + 进程内 e2e（数据库测试需要 `FOUNDRY_TEST_DATABASE_URL`）       |
| `pnpm test:e2e`     | 针对 `/signin` 的 Playwright（先运行一次 `pnpm exec playwright install chromium`） |
| `pnpm test:report`  | 覆盖率快照 → `docs/testing-report.md`                                              |
| `pnpm typecheck`    | 对整个工作区运行 `tsc`                                                             |

### 查看日志

每个进程每行输出一条 JSON 记录；格式和字段名见 [logging.zh-CN.md](logging.zh-CN.md)。两个变量控制输出：

```bash
FOUNDRY_LOG_LEVEL=debug pnpm dev      # 包含每个阶段的细节
FOUNDRY_LOG_FORMAT=pretty pnpm dev    # 单行易读文本
```

开发时可过滤：`pnpm dev 2>&1 | jq -c 'select(.level == "error")'`。runner 输出在自己的终端；
作为 launchd/systemd 服务运行时写入 `$FOUNDRY_HOME/logs`。

### 重启 `pnpm dev`

在修改 `.env`（包括 `FOUNDRY_HTTP_PROXY`）后、拉取涉及 web 或 realtime 的代码后，或面板看起来卡住时
执行。

`pnpm dev` 是 **web**（`:3000`）和 **realtime**（`:3001`）的一个进程。它**不会**启动或重启
runner。

1. 点击运行 `pnpm dev` 的终端。
2. 按一次 **Ctrl+C**，等待退出。如果卡住，再按一次 **Ctrl+C**。
3. 在仓库根目录：

```bash
cd /Users/pipi/foundry
pnpm dev
```

你应该看到 Next 在 `http://localhost:3000`，realtime 在 `ws://localhost:3001`。如果设置了
`FOUNDRY_HTTP_PROXY`，日志中会出现一条 `"message":"HTTP proxy configured"`，并带有脱敏后的代理地址。

如果 Ctrl+C 没有释放端口：

```bash
lsof -ti tcp:3000,3001 | xargs kill
cd /Users/pipi/foundry
pnpm dev
```

### 重启 `pnpm dev:runner`

在 **runner** 终端（与 `pnpm dev` 不同的进程）：按 **Ctrl+C**，然后在仓库根目录：

```bash
cd /Users/pipi/foundry
pnpm dev:runner
```

Runner 必须已经加入（`foundry runner join`）。修改代理或 git 相关代码后，重启 runner，否则任务会
继续使用旧进程。

## 5. 生产部署（Docker Compose）

当 Docker 可用且有公网主机名时使用。先把 GitHub App URL 更新到该主机。

```bash
# GitHub App（生产）
# Homepage / Callback / Setup:
#   https://<FOUNDRY_DOMAIN>
#   https://<FOUNDRY_DOMAIN>/api/auth/callback/github
#   https://<FOUNDRY_DOMAIN>/api/github/setup
# Webhook URL（不使用 smee）:
#   https://<FOUNDRY_DOMAIN>/api/webhooks/github

export FOUNDRY_DOMAIN=foundry.example.com
# POSTGRES_PASSWORD、FOUNDRY_SECRET 等必须在 .env 中
docker compose -f deploy/compose.yaml up -d
```

Compose 启动 Postgres、迁移、web、realtime 和 Caddy（80/443）。Caddy 把 `/realtime*` 代理到
realtime 服务，其余代理到 web 应用。

`deploy/compose.yaml` 已包含 `github-app.pem` 的 bind mount。在该域名上把 `FOUNDRY_PUBLIC_URL` /
`FOUNDRY_REALTIME_URL` 设为 `https://` 和 `wss://`（compose 会为 web 容器覆盖这些值）。

不使用 Docker 时，像本地一样运行相同进程（`pnpm build` / `pnpm --filter @foundry/web start`、
realtime、Postgres），放在任意 TLS 反向代理后面，并把 GitHub App 指向该源。

## 6. 目录提醒

包布局见根 `README.zh-CN.md`。本设置相关的控制面源码：

- Auth.js GitHub 登录：`apps/web/src/auth.ts`
- App Setup URL：`apps/web/src/app/api/github/setup/route.ts`
- Webhook：`apps/web/src/app/api/webhooks/github/route.ts`
- HTTP 代理（`FOUNDRY_HTTP_PROXY`）：`packages/shared/src/proxy.ts`、
  `apps/web/src/server/retry-fetch.ts`
- Compose 栈：`deploy/compose.yaml`
