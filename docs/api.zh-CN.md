# Foundry API 参考

> English version: [api.md](api.md)

Foundry 有五个网络接口面。控制面拥有其中四个（`apps/web` 提供 runner API、面板 API 和 webhook；
`apps/realtime` 提供 WebSocket）。runner 拥有第五个：单任务 `foundry` MCP 服务器调用的本地工具桥。

| 接口面         | 传输方式                             | 调用方                      | 认证                                              |
| -------------- | ------------------------------------ | --------------------------- | ------------------------------------------------- |
| Runner API     | 控制面 HTTPS `/api/runner/*`         | Runner daemon               | 先 join token，之后 `Authorization: Bearer fdr_…` |
| 面板 API       | 控制面 HTTPS `/api/*`                | 面板浏览器                  | Auth.js 会话 cookie + 当前团队 cookie             |
| Realtime       | WebSocket                            | 面板和 runner               | 签名的 realtime token                             |
| Runner 工具桥  | Unix socket 或 TCP 上的 `POST /tool` | 任务的 `foundry mcp` 子进程 | 单任务工具 token                                  |
| GitHub webhook | HTTPS `POST /api/webhooks/github`    | GitHub                      | HMAC-SHA256 签名（`GITHUB_WEBHOOK_SECRET`）       |

`GET /install.sh` 是公开的 runner 安装脚本。

本文档中的 JSON 契约只在 [`packages/shared/src/api.ts`](../packages/shared/src/api.ts) 中以 zod schema
定义一次（任务事件在 [`events.ts`](../packages/shared/src/events.ts)）。两端都用这些 schema 校验。
本文档描述当前实现，不是带版本号的公开 API：runner 和控制面一起发布。修改契约时，请在同一个 PR 中
同时修改 zod schema、调用方、测试和本文档（见[§7](#7-修改契约)）。

## 目录

1. [约定](#1-约定)
2. [控制面 — Runner API](#2-控制面--runner-api)
3. [控制面 — 面板 API](#3-控制面--面板-api)
4. [控制面 — Realtime WebSocket](#4-控制面--realtime-websocket)
5. [Runner — 本地工具桥](#5-runner--本地工具桥)
6. [GitHub webhook](#6-github-webhook)
7. [修改契约](#7-修改契约)

---

## 1. 约定

**Base URL。** 控制面监听 `FOUNDRY_PUBLIC_URL`（默认 `http://localhost:3000`）。runner 保存
`foundry runner join --server` 指定的服务器 URL，并追加 `/api/runner`。面板调用同源地址。

**编码。** 请求和响应都是 UTF-8 JSON，`content-type: application/json`，以下除外：

- `POST /api/runner/artifacts` — 请求体就是原始文件。
- `GET /api/artifacts/:id` — 响应就是原始文件。
- `GET /install.sh` — `text/x-shellscript`。

**校验。** 每个 JSON body、路径参数和查询参数都在边界用 zod 解析。解析失败返回 `400`：

```json
{
  "error": "invalid request",
  "issues": [
    { "code": "too_small", "path": ["name"], "message": "String must contain at least 1 character(s)" }
  ]
}
```

**错误。** 所有错误响应都是 `{ "error": "<message>" }`；校验失败还会带 `issues`。各接口面的状态码
保持一致：

| 状态码 | 含义                                                                  |
| ------ | --------------------------------------------------------------------- |
| `400`  | body 或参数校验失败（webhook 还包括 JSON 格式错误）                   |
| `401`  | 凭证缺失、未知、过期或 runner 已被移除（join token、runner token 等） |
| `403`  | 已认证但不被允许                                                      |
| `404`  | 资源不存在、runner action 未知，或 artifact token 已过期              |
| `409`  | 冲突：任务不属于该 runner、非法任务转换、仓库不属于该团队             |
| `413`  | artifact 超过 10 MiB                                                  |
| `500`  | 未预期失败。生产环境只返回 `internal error`                           |

**标识符和时间。** ID 是不透明字符串（UUID）——不要解析。时间戳是 ISO-8601 UTC 字符串
（`2026-11-11T09:30:00.000Z`）。时长是整数毫秒。费用是 JSON number，单位 USD。

**租户隔离。** 每个 runner token 属于一个团队；每个面板请求限定在选中的团队内
（`foundry_team` cookie，否则用户第一个团队）。跨团队读写会返回 not found、conflict 或重定向。

---

## 2. 控制面 — Runner API

`/api/runner` 下的接口都由已加入的 runner 调用。例外是 `join`：它用签名 join token 换取 runner
token。其他接口都需要：

```http
Authorization: Bearer fdr_<random>
```

runner token 由 `join` 返回一次，服务端只保存 SHA-256 哈希。被面板移除的 runner 调用任何接口都会
得到 `401`。字段名与 runner 自己的客户端一致
（[`apps/runner/src/api.ts`](../apps/runner/src/api.ts)）。

| 方法   | 路径                           | 用途                                      |
| ------ | ------------------------------ | ----------------------------------------- |
| `POST` | `/api/runner/join`             | 注册机器；用 join token 换取 runner token |
| `POST` | `/api/runner/heartbeat`        | 上报资源和运行中任务；接收配置和撤销信息  |
| `POST` | `/api/runner/claim`            | 原子地领取下一个合格任务                  |
| `POST` | `/api/runner/readiness`        | 上报各仓库的 recipe 就绪状态              |
| `POST` | `/api/runner/git-token`        | 签发短期安装 token 供 git 使用            |
| `POST` | `/api/runner/artifacts`        | 上传截图或其他 artifact                   |
| `POST` | `/api/runner/jobs/:id/:action` | 上报 runner 持有的任务的任何信息          |

### 2.1 `POST /api/runner/join`

用面板中创建的 join token（**Runners → Create join token**）注册 runner。不需要 bearer token。
join token 形如 `fdj_…`，有效期 **7 天**。

| 字段             | 类型                            | 说明                                         |
| ---------------- | ------------------------------- | -------------------------------------------- |
| `joinToken`      | string                          | 签名的、限定团队的 `fdj_…` token             |
| `name`           | string（至少 1 字符）           | 显示名；团队内唯一。同名重新加入会替换原记录 |
| `kind`           | `shared` \| `personal`          | `personal` 归创建 join token 的成员所有      |
| `os`             | `macos` \| `linux` \| `windows` |                                              |
| `arch`           | string                          | 例如 `arm64`、`x64`                          |
| `osVersion`      | string                          | 例如 `15.1`、`24.04`                         |
| `cpu`            | 整数 > 0                        | 核心数                                       |
| `memMb`          | 整数 > 0                        | 总内存，MiB                                  |
| `maxConcurrency` | 整数 > 0                        | 该 daemon 可同时运行的任务数                 |

```json
// 请求
{
  "joinToken": "fdj_eyJraW5kIjoiam9pbiIs...",
  "name": "alice-mbp",
  "kind": "personal",
  "os": "macos",
  "arch": "arm64",
  "osVersion": "15.1",
  "cpu": 10,
  "memMb": 32000,
  "maxConcurrency": 1
}
```

```json
// 200
{
  "runnerId": "4b0f4f0e-9a56-4a5f-8d9f-2e0f6b7c8d90",
  "runnerToken": "fdr_<secret>",
  "teamId": "0e9c2a6c-1f3e-4c5d-9b7a-8f1e2d3c4b5a"
}
```

`401` 表示 join token 无效、已过期，或者不是 join token。

### 2.2 `POST /api/runner/heartbeat`

daemon 运行时按心跳间隔发送。它更新 runner 记录、返回当前团队配置，并告诉 daemon 停止、保留或
上报哪些任务。

请求 body：

| 字段                 | 类型                                  | 说明                                            |
| -------------------- | ------------------------------------- | ----------------------------------------------- |
| `cpu`                | 整数 > 0                              |                                                 |
| `memMb`              | 整数 > 0                              |                                                 |
| `diskFreeMb`         | 整数 ≥ 0                              | runner 数据目录所在磁盘的剩余空间               |
| `onAcPower`          | boolean \| null                       | 系统无法判断时为 `null`                         |
| `accepting`          | boolean                               | daemon 当前是否接受领取                         |
| `notAcceptingReason` | string \| null（可选）                | 例如 `draining`、`low disk`、`outside schedule` |
| `runningJobIds`      | string[]                              | 当前正在执行的任务                              |
| `harnesses`          | `{id, installed, version?, authOk}[]` | 检测到的 harness 及其登录状态                   |
| `maxConcurrency`     | 整数 > 0                              |                                                 |
| `version`            | string                                | runner 版本                                     |

响应 body：

| 字段            | 类型     | 说明                                                                               |
| --------------- | -------- | ---------------------------------------------------------------------------------- |
| `realtimeUrl`   | string   | 要打开的 WebSocket URL                                                             |
| `realtimeToken` | string   | 签名 token，有效期 **1 小时**；claims 为 `{teamId, sub: runnerId, kind: "runner"}` |
| `draining`      | boolean  | 面板要求该 runner 进入 drain；停止领取                                             |
| `revokedJobIds` | string[] | daemon 上报过、但控制面已不再分配给它的任务——停止并释放                            |
| `keepJobIds`    | string[] | 仍属于该 runner 的任务（`needs_input` 或运行中阶段）；继续保留                     |
| `jobLimits`     | object[] | `{jobId, maxJobMinutes, maxCostUsd}`——对运行中任务的实时限制覆盖                   |
| `repos`         | object[] | 团队仓库的 `{id, fullName, defaultBranch, recipeSha, acceptsJobs}`                 |

```json
// 200
{
  "realtimeUrl": "ws://localhost:3001",
  "realtimeToken": "<signed token>",
  "draining": false,
  "revokedJobIds": [],
  "keepJobIds": ["9d1c…"],
  "jobLimits": [{ "jobId": "9d1c…", "maxJobMinutes": 90, "maxCostUsd": 12.5 }],
  "repos": [
    {
      "id": "c1a2…",
      "fullName": "acme/app",
      "defaultBranch": "main",
      "recipeSha": "a1b2c3…",
      "acceptsJobs": true
    }
  ]
}
```

心跳还会把 runner 不再上报的任务重新排队，并在不重启的情况下应用面板变更（drain、限制、仓库就绪）。

### 2.3 `POST /api/runner/claim`

为该 runner 原子地领取最合适的排队任务。请求 body 被忽略；传空对象即可。响应为
`{ "job": ClaimedJob | null }`。

`null` 是正常情况：runner 正在 drain 或已被移除、团队达到每日消费上限、仓库未 onboard、该 runner
上没有就绪的仓库，或者调度器认为其他 runner 更合适。daemon 会在下次心跳时重试。

```json
// 200 — 没有可领取的任务
{ "job": null }
```

```json
// 200 — 已领取
{
  "job": {
    "id": "9d1c…",
    "kind": "ticket",
    "repo": { "id": "c1a2…", "fullName": "acme/app", "defaultBranch": "main" },
    "issueNumber": 84,
    "title": "Add API document",
    "body": "### Goal\n…",
    "author": "gckjdev",
    "harness": "claude-code",
    "model": null,
    "playbook": "default",
    "branch": "foundry/…",
    "resumeStage": "triage",
    "sessionId": null,
    "resumeMode": "fresh",
    "loopCount": 0,
    "costUsd": 0,
    "maxJobMinutes": null,
    "maxCostUsd": null,
    "pendingInputs": [],
    "mergeMode": "off",
    "prReview": null
  }
}
```

| 已领取任务字段  | 含义                                                                       |
| --------------- | -------------------------------------------------------------------------- |
| `kind`          | `ticket` 或 `onboarding`                                                   |
| `resumeStage`   | 开始（或重新开始）的阶段：`triage`、`investigating`…… 或 `pr_review`       |
| `resumeMode`    | `fresh`（新 worktree/会话）、`sticky`（该 runner 的原生会话）或 `portable` |
| `sessionId`     | 可恢复的原生 harness 会话（当该 runner 能恢复时）                          |
| `loopCount`     | 已使用的验证/修复循环次数                                                  |
| `pendingInputs` | 任务挂起期间排队的回答和消息；领取时消费（`pr_review` 领取会留给下一次 implementing 运行） |
| `mergeMode`     | `off` 或 `merge_when_confident`——该仓库的生效策略                          |
| `prReview`      | 仅 `pr_review` 领取时存在：PR head 与需要排查的失败 CI 检查                |

### 2.4 `POST /api/runner/readiness`

上报该机器能否在某个 recipe 版本下运行仓库任务。上报前，daemon 会把默认分支克隆到独立的
worktree，检查 recipe 的 OS 约束和 `system_deps`，然后运行 warm/install/check 步骤（20 分钟预算）。
控制面只保存每个 `(runner, repo)` 的最新结果。

| 字段        | 类型           | 说明                                               |
| ----------- | -------------- | -------------------------------------------------- |
| `repoId`    | string         | 必须属于该 runner 的团队                           |
| `recipeSha` | string \| null | 该结果对应的 recipe 版本                           |
| `ready`     | boolean        |                                                    |
| `reason`    | string \| null | 不可用原因，供面板显示（例如 `missing: node>=22`） |

响应：`200 { "ok": true }`。仓库未知或属于其他团队时返回 `401`。

### 2.5 `POST /api/runner/git-token`

签发短期 GitHub App 安装 token 用于 fetch/push。runner 通过 `http.extraheader` 把它交给 git，
绝不放进 remote URL 或 argv。

| 字段     | 类型   | 说明                         |
| -------- | ------ | ---------------------------- |
| `repoId` | string | 仓库必须属于该 runner 的团队 |

```json
// 200
{ "token": "ghs_…", "expiresAt": "2026-11-11T10:30:00.000Z" }
```

仓库不属于该 runner 团队时返回 `409`。

### 2.6 `POST /api/runner/artifacts`

原始 artifact 上传。请求体就是文件；元数据放在 header 中。最大 **10 MiB**（超出返回 `413`）。

| Header           | 必需 | 说明                                                 |
| ---------------- | ---- | ---------------------------------------------------- |
| `authorization`  | 是   | `Bearer <runnerToken>`                               |
| `x-foundry-job`  | 是   | 任务 ID；任务必须由该 runner 持有                    |
| `x-foundry-name` | 否   | 显示/文件名；默认 `artifact`                         |
| `content-type`   | 否   | 保存的 content type；默认 `application/octet-stream` |

```json
// 200
{
  "artifactId": "77e1…",
  "url": "https://foundry.example.com/api/artifacts/77e1…?t=<signed token>"
}
```

返回的 URL 已签名，有效期 **30 天**，无需面板会话即可读取，因此 PR body 中嵌入的截图对评审者可见。
runner 不再持有的任务返回 `409`。

### 2.7 `POST /api/runner/jobs/:id/:action`

用一个端点处理 runner 对其持有任务的所有上报。`id` 是任务 UUID；`action` 是下表中的名称。任务必须
仍属于该 runner，且处于运行中状态（`triage`、`investigating`、`implementing`、`reviewing`、
`verifying`、`pr_review`）；否则返回 `409 { "error": "job is not held by this runner" }`（任务 ID
不存在时返回 `404`）。未知 action 返回 `404 { "error": "unknown action <name>" }`。

| Action       | 请求 body                                                          | 成功响应                            | 作用                                         |
| ------------ | ------------------------------------------------------------------ | ----------------------------------- | -------------------------------------------- |
| `events`     | `{ events: FoundryEvent[] }`（1–200 条）                           | `{ ok: true }`                      | 追加任务日志事件                             |
| `stage`      | `StageRequest`                                                     | `{ status }`                        | 转换任务状态；非法边返回 `409`               |
| `ask`        | `{ prompt: string, options?: string[] }`（最多 6 个选项）          | `{ questionId }`                    | 挂起任务并向 issue 发问题                    |
| `evidence`   | `EvidenceRequest`                                                  | `{ id }`                            | 记录 gate 证据                               |
| `confidence` | `{ level: "high" \| "medium" \| "low", reasons?, uncertainties? }` | `{ ok: true }`                      | 保存 agent 的自我评估                        |
| `plan`       | `{ plan: string }`                                                 | `{ ok: true }`                      | 保存实现计划                                 |
| `checkpoint` | `{ stage, sessionId, briefRef, headSha }`                          | `{ ok: true }`                      | 保存交接或迁移机器所需的恢复状态             |
| `pr`         | `{ title, summary, headSha, uiChanged, changedLines }`             | `{ prNumber, url }`                 | 创建/更新 PR，然后转换到 `pr_ci` 并评估 gate |
| `pr-review`  | `PrReviewRequest`                                                  | `{ status }`                        | 发布自动 PR 评审结果并推进任务               |
| `onboarding` | `{ ok, reason, headSha, summary }`                                 | `{ pr: { prNumber, url } \| null }` | 完成 onboarding；`ok: false` 使任务失败      |
| `inputs`     | `{ take?: boolean }`（默认 `true`）                                | `{ inputs: PendingInput[] }`        | 返回排队的人类回答/消息；`take` 标记为已投递 |

#### `stage` 请求

| 字段                 | 类型                        | 说明                                                        |
| -------------------- | --------------------------- | ----------------------------------------------------------- |
| `to`                 | JobStatus                   | 目标状态；必须是 `packages/shared/src/states.ts` 中的合法边 |
| `reason`             | string（可选）              | 显示在时间线中，失败时也会使用                              |
| `lastCompletedStage` | RunnerStage \| null（可选） | 交还任务时用于计算 `resumeStage`                            |
| `loopCount`          | integer（可选）             |                                                             |
| `sessionId`          | string \| null（可选）      | 用于恢复的原生 harness 会话                                 |
| `worktreePath`       | string \| null（可选）      | sticky 恢复时复用的本地 worktree                            |
| `portBase`           | integer \| null（可选）     | 任务租用端口段的起始端口                                    |

runner 通常一次前进一个阶段。它也会发送 `queued` 交还任务（调度暂停或关闭——控制面会记录 sticky
窗口和恢复阶段），以及带脱敏原因的 `failed`。`needs_input` 由 `ask` 或面板设置，不由 runner
设置。`done` 只是 MCP 概念：runner 先验证、创建 PR，再通过 `pr` 上报。

#### 自动 PR 评审

当 `.foundry/policy.yaml` 设置 `auto_pr_review: true` 时，PR head 的 CI 检查结束后，处于 `pr_ci`
的任务会以 `resumeStage: "pr_review"` 重新入队（每个 head SHA 只评审一次）。如果 PR 进入
`pr_ci` 后经过两分钟宽限期仍然没有任何检查，worker 会以 `allowNoCi` 启动评审；宽限期避免把
仍在注册中的 check suite 误判为仓库没有 CI。领取响应的
`prReview` 字段携带 PR 信息和失败的检查：`{ prNumber, url, headSha, ciFailures }`，每个失败项包含
`name`、`conclusion`、`summary`、`detailsUrl` 和 `annotations`（`path`、可选 `line`、`message`）。

runner 在独立的只读 worktree 中评审已推送的 head，并通过 `pr-review` 上报：

| 字段       | 类型                                              | 说明                                           |
| ---------- | ------------------------------------------------- | ---------------------------------------------- |
| `verdict`  | `approve` \| `request_changes`                    |                                                |
| `summary`  | string                                            |                                                |
| `findings` | `{ severity, category, file?, line?, message }[]` | `file` + `line` 有效时会成为行内评审评论        |

控制面把结果作为 `COMMENT` 评审发布到 PR（Foundry App 是该 PR 的作者，GitHub 不接受它提交
`APPROVE` 或 `REQUEST_CHANGES`），并记录 `code review` 证据。通过则把任务送回 `pr_ci`，但
**开启 `auto_pr_review` 的任务 gate 永不自动合并**：评审只提供评论，PR 等待人工合并
（`human_review` 规则）。阻塞性问题会变成一条消息，把任务重新入队到 `implementing`，最多
`max_review_loops` 轮；超出后交给 issue 作者处理。

#### `evidence` 请求

| 字段         | 类型                                          | 说明                                                                      |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------------- |
| `kind`       | `check` \| `screenshot` \| `note` \| `review` | `check` 和 `review` 由 runner 记录；agent 工具记录 `screenshot` 和 `note` |
| `name`       | string                                        | 稳定的证据名；gate 读取 `code review`                                     |
| `status`     | `passed` \| `failed` \| `skipped`             |                                                                           |
| `command`    | string \| null                                | 用于 check                                                                |
| `exitCode`   | integer \| null                               | 用于 check                                                                |
| `outputTail` | string \| null（≤ 20,000 字符）               | 脱敏后的输出                                                              |
| `durationMs` | integer \| null                               |                                                                           |
| `artifactId` | string \| null                                | 截图必需                                                                  |

#### `inputs` 响应

`PendingInput` 是问题回答或自由消息：

```json
{
  "inputs": [
    { "kind": "answer", "text": "Use CSV", "by": "alice", "questionPrompt": "CSV or XLSX?" },
    {
      "kind": "message",
      "text": "Please also update the README",
      "by": "bob",
      "attachments": [
        {
          "artifactId": "77e1…",
          "name": "mock.png",
          "contentType": "image/png",
          "url": "https://foundry.example.com/api/artifacts/77e1…?t=…"
        }
      ]
    }
  ]
}
```

`attachments[].url` 是签名的 artifact URL，因此另一台机器上的 runner 也能下载人类在面板中附加的图片。

#### `events` body

任务事件是 [`packages/shared/src/events.ts`](../packages/shared/src/events.ts) 中可辨识联合的成员：

| `kind`             | Payload                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `stage_changed`    | `{from, to, reason?}`                                                  |
| `subagent_started` | `{name}`                                                               |
| `tool_call`        | `{tool, summary?}`                                                     |
| `usage`            | `{model?, tokensIn, tokensOut, costUsd}`                               |
| `message`          | `{role: "agent" \| "human" \| "system", text}`                         |
| `question`         | `{questionId, prompt}`                                                 |
| `answer`           | `{questionId, text, by}`                                               |
| `evidence`         | `{name, status}`                                                       |
| `log`              | `{level, message}`                                                     |
| `resumed`          | `{runnerId, runnerName, mode: "sticky" \| "portable", harnessChanged}` |
| `gate`             | `{pass, failed: [{rule, detail}]}`                                     |
| `checkpoint`       | `{stage, briefRef}`                                                    |
| `error`            | `{message}`                                                            |

runner 每次调用批量发送最多 200 条事件。事件只追加，驱动任务时间线、用量统计和费用上限。

---

## 3. 控制面 — 面板 API

面板接口通过 Auth.js 会话 cookie 认证。它们从 `foundry_team` cookie（否则用户第一个团队）解析当前
团队，并把每次读取限定在该团队内。未认证调用重定向到 `/signin`；没有团队的用户重定向到 `/setup`。
这些是面板使用的浏览器 API，不属于 runner 契约。

| 方法         | 路径                              | 认证           | 用途                                         |
| ------------ | --------------------------------- | -------------- | -------------------------------------------- |
| `GET`        | `/api/jobs/:id/events?after=<id>` | 会话           | 实时日志的增量任务时间线                     |
| `GET`        | `/api/realtime-token`             | 会话           | WebSocket URL 和新的 realtime token          |
| `POST`       | `/api/push/subscribe`             | 会话           | 保存浏览器 push 订阅                         |
| `GET`        | `/api/push/subscribe`             | 公开           | 供 `PushManager.subscribe` 使用的 VAPID 公钥 |
| `GET`        | `/api/artifacts/:id?t=<token>`    | 签名 URL       | 下载 artifact（截图、备注）                  |
| `GET`        | `/api/github/setup`               | 会话（管理员） | GitHub App Setup URL / 登录后安装关联        |
| `GET`/`POST` | `/api/auth/[...nextauth]`         | —              | Auth.js 登录、回调和会话处理器               |
| `GET`        | `/install.sh`                     | 公开           | runner 安装脚本                              |

### 3.1 `GET /api/jobs/:id/events`

返回调用者团队中某个任务 `id > after`（默认 `0`）的事件记录，最多 500 条。任务页在收到 realtime
通知后轮询该接口；realtime 消息本身不携带事件体。`payload` 是 §2.7 中的 `FoundryEvent` 联合。

```json
{
  "events": [
    {
      "id": 412,
      "jobId": "9d1c…",
      "teamId": "0e9c…",
      "ts": "2026-11-11T09:30:00.000Z",
      "kind": "log",
      "stage": "implementing",
      "payload": { "kind": "log", "level": "info", "message": "job claimed" }
    }
  ]
}
```

其他团队的任务返回空列表，而不是跨团队读取。

### 3.2 `GET /api/realtime-token`

```json
{ "url": "ws://localhost:3001", "token": "<signed token>" }
```

token 的 claims 为 `{teamId, sub: userId, kind: "user"}`，有效期 **1 小时**。socket 关闭或 token
过期时，用新 token 重连。

### 3.3 Push 订阅

`POST /api/push/subscribe` 接收浏览器的 `PushSubscription` JSON，保存到用户记录并把通知偏好设为
push：`200 { "ok": true }`。`GET` 返回 `{ "publicKey": "<VAPID public key>" }`（未配置 push 时为
`null`）。

### 3.4 `GET /api/artifacts/:id`

当 `t` 是该 artifact 的有效签名 token 时返回保存的字节（否则 `404`）。响应使用保存的 content
type、`content-disposition: inline` 和 `cache-control: private, max-age=86400`。

### 3.5 `GET /api/github/setup`

GitHub 在 App 安装后重定向到这里（`?installation_id=<id>`），它同时也是登录后的落地页。没有会话
时，它把安装 ID 存入短期 `foundry_install` cookie 并重定向到 `/signin`；登录后，团队管理员把安装
关联到选中的团队，再重定向到 `/repos?installed=1`。已登录的管理员在没有 installation id 时，会
同步未关联的安装并重定向到 `/repos?installed=1`。

### 3.6 `GET /install.sh`

公开安装脚本，用法：
`curl -fsSL <server>/install.sh | sh -s -- <fdj_token>`。脚本会把 runner 加入 `FOUNDRY_PUBLIC_URL`
中的服务器。

---

## 4. 控制面 — Realtime WebSocket

`apps/realtime` 把一条 Postgres `LISTEN foundry_changes` 连接转换成按团队划分的 WebSocket 消息。
它只是唤醒通道：消息携带标识符，客户端通过面板 API 重新获取行数据，或根据心跳响应行动。

**URL。** 控制面公布 `FOUNDRY_REALTIME_URL`。`.env.example` 指向 `ws://localhost:3001`；未设置时
web 应用会推导出 `ws://<public host>/realtime`，compose 栈则由 Caddy 代理 `/realtime`。客户端使用
`/api/realtime-token` 或心跳返回的值。

**认证。** 把 token 放在查询字符串中，或作为第二个 WebSocket 子协议（浏览器无法在 WebSocket 上
设置请求 header）：

```js
new WebSocket(`${url}?token=${token}`);
// 或
new WebSocket(url, ["foundry", token]);
```

缺失、无效或过期的 token 在 HTTP upgrade 阶段被拒绝，返回 `401 Unauthorized`。

**消息。** 连接后服务器发送：

```json
{ "type": "hello", "teamId": "0e9c…" }
```

之后，该团队的每次变更都会发送：

```json
{ "type": "change", "table": "jobs", "id": "9d1c…", "op": "UPDATE", "columns": ["status"] }
```

`columns` 可能省略或为空。只有 `team_id` 与 token 团队匹配的变更才会投递。服务器每 25 秒 ping
一次；未回 pong 或 token 过期的客户端会被终止，必须用新 token 重连。

**健康检查。** `GET /healthz` 返回 `200 ok`。其他非 WebSocket 请求返回 `426 WebSocket only`。

**没有 Postgres 时。** 服务仍接受连接并发送 `hello`，但不广播任何内容（用于健康检查和测试）。

---

## 5. Runner — 本地工具桥

每个任务都有一个专属的 `foundry` MCP 服务器进程（由 harness 启动）。该进程通过 stdio 与 agent
讲 MCP，并把每次工具调用转发给 runner 的本地 HTTP 服务器。这里的内容不会暴露到机器之外。

**传输方式。**

| 环境变量             | 含义                                                    |
| -------------------- | ------------------------------------------------------- |
| `FOUNDRY_MCP_SOCKET` | Unix socket 路径（macOS/Linux）                         |
| `FOUNDRY_MCP_URL`    | 回环 base URL，例如 `http://127.0.0.1:53211`（Windows） |
| `FOUNDRY_JOB_ID`     | 工具所上报的任务                                        |
| `FOUNDRY_MCP_TOKEN`  | 注册任务的工具处理器时签发的单任务 token                |

**请求。** `POST /tool`，JSON：

```json
{
  "jobId": "9d1c…",
  "token": "<FOUNDRY_MCP_TOKEN>",
  "tool": "stage",
  "args": { "name": "investigating", "summary": "找到了路由和对应测试。" }
}
```

如果 `jobId`/`token` 组合未注册——包括一个任务试图上报另一个任务——返回 `403`：

```json
{ "text": "This job is not running on this runner.", "isError": true }
```

处理器崩溃或请求格式错误返回 `500`，body 为 `{ "text": "Runner error: …", "isError": true }`。
普通工具级失败返回 `200` 且 `isError: true`，以便 agent 读取并作出反应。客户端允许每次调用最长
30 分钟，因为 `run_checks` 可能很慢。

**响应。** `{ "text": "<给 agent 的消息>", "isError"?: true }`。MCP 服务器把 `text` 变成一个文本
content block。

### 5.1 工具

| 工具         | 参数                                                                                                             | runner 的行为                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `stage`      | `{ name: "investigating" \| "implementing" \| "reviewing" \| "verifying" \| "done", summary }`                   | 强制阶段顺序；向上游上报 `stage` 并 checkpoint。`done` 触发验证/PR 流程 |
| `plan`       | `{ plan: string }`                                                                                               | 保存计划并发出 message 事件                                             |
| `ask`        | `{ question: string, options?: string[] }`                                                                       | 宽限期后挂起任务并发布问题                                              |
| `evidence`   | `{ kind: "screenshot" \| "note", name, status?, path?, detail? }`                                                | 备注直接记录；截图先上传再作为证据关联                                  |
| `run_checks` | `{ names?: string[] }`                                                                                           | 运行 recipe 中受信任的检查，并逐项记录为 gate 证据                      |
| `confidence` | `{ level: "high" \| "medium" \| "low", reasons?: string[], uncertainties?: string[] }`                           | 保存自我评估；低于 `high` 会把 PR 交给人类                              |
| `review`     | `{ verdict: "approve" \| "request_changes", summary, findings: [{severity, category?, file?, line?, message}] }` | 仅评审者可用：记录一次独立评审                                          |

`review` 只对只读评审者会话可用；实现者的工具服务器会拒绝它。`evidence` 截图必须在 worktree 内，
且为 PNG、JPEG 或 WebP。

---

## 6. GitHub webhook

`POST /api/webhooks/github` 接收所有 GitHub App 投递。只有校验、存储和确认是同步的；处理在响应后
进行，因此 GitHub 的 10 秒投递超时从不是问题。

**Header。**

| Header                | 必需 | 说明                                    |
| --------------------- | ---- | --------------------------------------- |
| `x-github-event`      | 是   | 例如 `issues`、`pull_request`、`push`   |
| `x-github-delivery`   | 是   | 唯一投递 ID；用于幂等                   |
| `x-hub-signature-256` | 是   | `sha256=<原始 body 的 HMAC-SHA256 hex>` |
| `content-type`        | 否   | 无论如何 body 都按 JSON 解析            |

签名使用 `GITHUB_WEBHOOK_SECRET` 校验。GitHub Enterprise Server 使用相同的路径和签名方案——只有
GitHub 主机不同。

**响应。**

| 状态码 | Body                                                                     | 条件                                          |
| ------ | ------------------------------------------------------------------------ | --------------------------------------------- |
| `202`  | `{ "ok": true, "duplicate": false }`                                     | 已接受；已安排处理                            |
| `202`  | `{ "ok": true, "duplicate": true }`                                      | 相同 `x-github-delivery` 已存储；忽略         |
| `400`  | `{ "error": "missing GitHub headers" }` 或 `{ "error": "invalid JSON" }` | 缺少 event/delivery header，或 body 不是 JSON |
| `401`  | `{ "error": "bad signature" }`                                           | 签名与原始 body 不匹配                        |
| `500`  | `{ "error": "GITHUB_WEBHOOK_SECRET is not set" }`                        | 服务端配置错误                                |

**投递语义。** 投递存储在 `webhook_inbox`，以 `(provider, delivery_id)` 为键，因此 GitHub 重试是
无操作。处理失败会记录错误和尝试次数；后台 worker 最多重试未处理的投递 **5 次**。原始 payload 会
保留用于诊断。未处理的事件类型会被存储并忽略。

**Foundry 会处理的事件。**

| 事件                                 | Action                                | 作用                                                                                                                        |
| ------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `issues`                             | `labeled`                             | `foundry` 标签为 issue 创建任务（每个 issue 最多一个存活任务）                                                              |
| `issues`                             | `closed`                              | 取消任务，除非它已在 `pr_ci`                                                                                                |
| `issue_comment`                      | `created`                             | 团队成员的 `/foundry cancel`、`/foundry retry` 或 `/foundry <message>` 作用于任务；其他非 bot 评论则回答 `needs_input` 任务 |
| `issue_comment`                      | `edited`                              | 问题复选框被勾选（人类编辑了 bot 评论）会回答问题                                                                           |
| `pull_request`                       | `closed`                              | 合并则标记任务 merged；未合并关闭则取消；revert 会把原 merged 任务标记为 reverted                                           |
| `pull_request_review`                | `submitted`                           | 人类的 `changes_requested` 评审会重新打开工作；其他评审在 `pr_ci` 时重新评估 gate                                           |
| `check_suite`、`check_run`、`status` | `completed`（`status` 为任意 action） | 对处于 `pr_ci`、SHA 匹配的任务：启用时启动自动 PR 评审，否则重新评估 gate                                                   |
| `push`                               | —                                     | 默认分支上，当 `.foundry/` 变更或尚无 recipe 时刷新仓库配置                                                                 |
| `installation`                       | `deleted`                             | 删除该安装对应的仓库                                                                                                        |
| `installation_repositories`          | `added`/removed                       | 关联或取消关联仓库，并把已知安装关联到其团队                                                                                |
| 其他任何事件                         | —                                     | 存储后忽略                                                                                                                  |

本地开发时，`pnpm dev:webhooks` 把 smee.io 的投递转发到该路径。

---

## 7. 修改契约

共享 schema 是唯一事实来源。契约变更需要同时修改：

| 层                | 位置                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Schema            | `packages/shared/src/api.ts`、`packages/shared/src/events.ts`                                             |
| 控制面路由        | `apps/web/src/app/api/**/route.ts`；错误映射和 `runnerRoute()` 在 `apps/web/src/server/http.ts`           |
| 控制面逻辑        | `packages/control/src/runner-api.ts`、`packages/control/src/runners.ts`、`packages/control/src/ingest.ts` |
| Runner 客户端     | `apps/runner/src/api.ts`（`ControlPlane` 接口是测试使用的接缝）                                           |
| Runner 工具处理器 | `apps/runner/src/job-runner.ts`、`apps/runner/src/tool-server.ts`                                         |
| MCP 工具面        | `packages/mcp-foundry/src/server.ts`、`packages/mcp-foundry/src/bridge.ts`                                |
| 测试              | `tests/api/*.test.ts`、`tests/e2e/*.test.ts`、同目录 `*.test.ts`                                          |
| 本文档            | `docs/api.md` 和 `docs/api.zh-CN.md`                                                                      |

经验规则：

- 在边界校验，而不是在服务深处：路由负责解析，控制函数负责决策。
- 单任务调用必须通过 `ownedJob()` 做所有权检查；失去任务的 runner 必须得到 `409`，以便停止 harness。
- 绝不把安装 token、runner token、join token 或 `FOUNDRY_SECRET` 放进会被记录的 URL。签名 artifact
  URL 是有意的例外（已签名、限定范围、会过期），因为 PR 截图必须无需会话即可渲染。
- 任务状态边定义在 `packages/shared/src/states.ts`；不要在处理器中新增。
