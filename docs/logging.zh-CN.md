# 日志

> English version: [logging.md](logging.md)

Foundry 每次输出**一行结构化记录**。控制面（`apps/web`：面板、webhook worker）、realtime 服务和
runner 使用相同的格式，并共用 `@foundry/shared` 中的同一个 logger，因此一条查询即可跨进程检索。

```json
{
  "ts": "2026-11-10T20:31:05.123Z",
  "level": "info",
  "service": "control",
  "message": "job claimed",
  "jobId": "aa9d6b37",
  "runner": "alice-laptop",
  "resumeMode": "sticky",
  "stage": "implementing"
}
```

## 记录结构

| 字段      | 含义                                                                     |
| --------- | ------------------------------------------------------------------------ |
| `ts`      | ISO-8601 UTC 时间戳，由 logger 生成                                      |
| `level`   | `debug`、`info`、`warn` 或 `error`                                       |
| `service` | 写日志的进程：`control`、`webhook`、`web`、`realtime`、`runner`、`proxy` |
| `message` | 简短、稳定的句子。**动态值放在字段里，不要拼进 message**                 |
| _字段_    | 上下文：`jobId`、`runner`、`repo`、`delivery`、`error`、计数、耗时等     |

`ts`、`level`、`service`、`message` 属于 logger；同名字段会被丢弃，不能覆盖记录本身。

## 级别

按“运维人员看到后应该做什么”来选择级别：

- **debug** — 跟踪单个 job 或 webhook 时使用的高频细节：阶段变化、webhook 处理完成、harness
  日志路径。默认关闭。
- **info** — 值得告警或做看板的生命周期节点：job 创建 / 被领取 / 合并、PR 打开、提问与回答、
  服务启动、webhook 接收。
- **warn** — 已恢复的降级，或尽力而为的副作用失败：GitHub 同步或通知失败、readiness 失败、
  `.foundry/recipe.yaml` 无效、webhook 被拒绝、checkpoint push 失败。
- **error** — 操作失败且需要处理：请求返回 500、heartbeat/claim 失败、worker tick 失败、
  webhook 处理失败、job 失败。

## 字段约定

| 字段                     | 类型   | 示例                                      |
| ------------------------ | ------ | ----------------------------------------- |
| `jobId`                  | string | `"aa9d6b37-411c-..."`                     |
| `repo`                   | string | `"acme/app"`                              |
| `issue`、`pr`            | number | `42`                                      |
| `runner`                 | string | `"alice-laptop"`                          |
| `stage`                  | string | `"verifying"`                             |
| `check`                  | string | `"lint"`                                  |
| `status`                 | string | `"passed"`、`"failed"`、`"skipped"`       |
| `exitCode`、`durationMs` | number | `1`、`2431`                               |
| `delivery`、`event`      | string | GitHub delivery id 与事件名               |
| `by`、`via`              | string | `"alice"`、`"panel"` / `"gh_reply"`       |
| `error`                  | string | `errorFields(err)` 得到的 `error.message` |
| `count`                  | number | `3`                                       |

请使用 `errorFields(err)`，不要把错误对象直接塞进字段或拼进 message。它保证 `error` 是字符串，
也避免误把带有 token 的对象写进日志。

## 使用方式

```ts
import { createLogger, errorFields } from "@foundry/shared";

const log = createLogger({ service: "control" });
log.info("job claimed", { jobId, runner: runner.name });
log.error("webhook processing failed", { delivery, event, ...errorFields(err) });

// 绑定一次上下文，之后每条记录都会携带它。
const jobLog = log.child({ jobId });
jobLog.warn("check failed", { check: "lint", exitCode: 1 });
```

- `ControlContext.log` 是一个 `Logger`，控制面代码通过它记录日志。
- `JobRunnerDeps.logger` 是 daemon logger，已经绑定了 `jobId`。
- `DaemonOptions.logger` 默认是 `createLogger({ service: "runner" })`。
- 测试使用 `noopLogger`；需要断言输出时使用
  `createLogger({ service: "test", sink: (line) => lines.push(line) })`。

`console.log` 只用于 **CLI 输出**（`foundry status`、`foundry doctor`、脚本），不用于运行日志。
业务代码不应直接使用 `console.*`。

## 规则

1. 保持 `message` 稳定：它是 grep、看板和告警的依据。id 和数值放进字段。
2. 记录决策，而不是每个循环。每次 claim、阶段、check、gate 各一行即可；详细过程在 harness
   转录文件中。
3. 绝不能记录密钥、访问令牌、代理用户名密码、请求体或 `.env` 值。runner 会在写入前脱敏；
   控制面则必须从源头避免传入。
4. 每条消息保持单行。JSON 编码会转义换行，不要依赖多行日志。
5. 日志不能影响业务：logger 同步写入，字段无法序列化时也不会抛错。

## 配置

| 变量                 | 取值             | 默认   | 作用范围                 |
| -------------------- | ---------------- | ------ | ------------------------ |
| `FOUNDRY_LOG_LEVEL`  | `debug`…`error`  | `info` | 控制面、realtime、runner |
| `FOUNDRY_LOG_FORMAT` | `json`、`pretty` | `json` | 控制面、realtime、runner |

控制面在 `.env` 中设置（`pnpm dev` 读取）；runner 在 shell 或服务环境中设置。
`FOUNDRY_LOG_FORMAT=pretty` 输出单行易读文本：

```text
2026-11-10T20:31:05.123Z INFO  control job claimed jobId=aa9d6b37 runner=alice-laptop
```

## 跟踪一件事

```bash
# 开发时的错误
pnpm dev 2>&1 | jq -c 'select(.level == "error")'

# 某个 job 的全部日志（控制面与 runner）
jq -c 'select(.jobId == "aa9d6b37-411c-49bb-88f9-e4a1d5ffc070")' web.log runner.log

# 被拒绝的 webhook
jq -c 'select(.service == "webhook" and (.message | startswith("webhook rejected")))' web.log
```

## 各进程输出位置

- **控制面**（`pnpm dev`）：Next.js stdout，服务名 `control`、`webhook`、`web`。
- **Realtime**（`apps/realtime`）：stdout，服务名 `realtime`。
- **Runner**（`foundry runner start` / `pnpm dev:runner`）：stdout；作为 launchd/systemd 服务运行时，
  stdout 写入 `$FOUNDRY_HOME/logs`（见 `docs/local-setup.md`）。
