# `.foundry/` 目录参考

> English: [foundry-dot-dir.md](foundry-dot-dir.md)

`docs/onboarding.zh-CN.md` 说明 Foundry 如何创建这些文件。本页是字段参考：Foundry 从 `.foundry/`
读取的每个文件、`recipe.yaml` 和 `policy.yaml` 中的每个字段，以及 runner 和置信度门禁如何使用它们。

事实来源：`packages/shared/src/recipe.ts`（`RecipeSchema`）和 `packages/shared/src/policy.ts`
（`PolicySchema`）。两个 YAML 文件都用 zod 解析；未知键会被忽略。

## 文件

| 文件                                 | 必需 | 内容                                                                                                     |
| ------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------- |
| `.foundry/recipe.yaml`               | 是   | 如何安装、检查和运行仓库。没有有效 recipe，ticket 任务无法启动。                                         |
| `.foundry/policy.yaml`               | 否   | 合并模式、预算、权限和风险规则。缺失或无效时回退到 `DEFAULT_POLICY`（即下面的默认值）。                  |
| `.foundry/playbook.md`               | 否   | 替换内置 `default` playbook，用于 ticket 任务。                                                          |
| `.foundry/playbook.<name>.md`        | 否   | 替换同名内置 playbook（`bugfix`、`feature`），或提供新的 playbook。用 `playbook:<name>` issue 标签选择。 |
| `.foundry/playbook.<harness>.md`     | 否   | 追加到该 harness（`claude-code` 或 `opencode`）系统提示词后的额外说明。                                  |
| `.foundry/skills/*.md`               | 否   | 追加到系统提示词的仓库知识，每个文件一节，按文件名排序。                                                 |
| `.github/ISSUE_TEMPLATE/foundry.yml` | 否   | issue 表单，添加 `foundry` 标签以及 Goal / Acceptance criteria / Constraints / Out of scope 各节。       |

Onboarding 任务始终使用内置 onboarding playbook；仓库 playbook 和 skills 只影响 ticket 任务。ticket
任务的 `playbook` 为 `default` 时从 `.foundry/playbook.md` 取 playbook，否则从
`.foundry/playbook.<name>.md` 取。harness 说明在所选 playbook 之外追加，`.foundry/skills/` 中的每个
文件再在其后追加。

issue 表单生成 Foundry 读取的 ticket 结构正文：提示词使用 `Goal` 和 `Acceptance criteria` 标题，
缺少 `Acceptance criteria` 一节会让 triage 考虑提问。仓库完成 onboarding 后，正是
`labels: ["foundry"]` 让 issue 有资格成为任务。

## recipe 命令中的变量

每个任务运行时都有这些环境变量：

| 变量               | 值                                             |
| ------------------ | ---------------------------------------------- |
| `FOUNDRY_JOB_ID`   | 任务的 id。                                    |
| `FOUNDRY_PORT`     | 任务端口块中的第一个端口。                     |
| `FOUNDRY_PORT_END` | 端口块中的最后一个端口（`FOUNDRY_PORT + 9`）。 |
| `FOUNDRY_BRANCH`   | 任务正在工作的分支。                           |

`expandRecipeVars`（`packages/shared/src/recipe.ts`）替换值中的 `$FOUNDRY_...` 和
`${FOUNDRY_...}`。runner 在启动 dev server 前对 `dev_server.run` 应用它。对于 ticket 任务，
`install` 和 `checks[].run` 也会通过平台 shell（`sh -c`，Windows 上为 PowerShell）在相同环境下
运行，因此 shell 也会在那里展开这些变量。`warm` 只在就绪检查期间运行，该阶段只设置代理变量和
`FOUNDRY_TEST_DATABASE_URL`，因此没有按任务的值可用。`services.postgres.database` 是名称，不是
命令，不会被展开。

## `recipe.yaml`

### 顶层字段

| 字段          | 类型                               | 默认值       | runner 如何使用                                                                                                                                                              |
| ------------- | ---------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install`     | string                             | 无           | ticket 任务启动时运行一次（原地恢复时跳过），超时 30 分钟。onboarding 和就绪检查期间也会在检查之前运行。非零退出会使任务失败。                                               |
| `checks`      | 检查对象数组                       | `[]`         | 验证命令。Agent 用 `run_checks` MCP 工具运行它们；在 `stage(done)` 时 runner 会针对最终工作树再运行一次（工作树未变时复用上次结果）。每个结果记录为 `check` 证据。见下文。   |
| `dev_server`  | object                             | 无           | 仅当 diff 触及 `ui_paths` 且 Agent 未附加截图时使用。见下文。                                                                                                                |
| `services`    | object                             | `{}`         | 可选的按任务服务。见下文。                                                                                                                                                   |
| `env_file`    | string                             | 无           | 如果任务工作树还没有 `.env`，把此路径复制为工作树中的 `.env`。复制错误被忽略。                                                                                               |
| `system_deps` | string 数组                        | `[]`         | 仅就绪检查：每项是 `PATH` 上必须存在的二进制，可选带最低版本（`node>=22`）。带 `>=` 最低版本时 runner 运行 `<bin> --version`，依赖缺失或过旧则报告未就绪。不会安装任何东西。 |
| `warm`        | string 数组                        | `[]`         | 就绪检查期间、`install` 和检查之前运行的命令。它们在 runner 首次证明 recipe、以及重启或 recipe 变更后运行，不是每个任务都运行。没有单步超时；受 20 分钟就绪截止时间约束。    |
| `os`          | `macos`、`linux`、`windows` 的数组 | 缺省（任意） | 仅就绪检查：OS 不在列表中的 runner 报告该仓库未就绪。                                                                                                                        |
| `ui_paths`    | glob 数组                          | 见下文       | 匹配任何 glob 的变更文件都算 UI 变更。若 diff 是 UI 变更，打开 PR 前和门禁自动合并前都需要通过的截图。设为 `[]` 可禁用 UI 变更检测。                                         |

如果 `recipe.yaml` 缺失或验证失败，ticket 任务在启动时失败；就绪检查报告该仓库未就绪。

### `checks[]`

| 字段          | 类型         | 默认值 | runner 如何处理                                                |
| ------------- | ------------ | ------ | -------------------------------------------------------------- |
| `name`        | 非空 string  | 必需   | 证据名称。门禁要求每个检查名称都有通过的 `check` 证据。        |
| `run`         | 非空 string  | 必需   | 在任务环境中通过平台 shell 于工作树里运行的命令。              |
| `timeout_sec` | 正数 integer | `900`  | 每项检查的超时。超时后 runner 杀掉整个进程树并记录该检查失败。 |

失败的检查会把任务送回 **implementing** 并重试，直到 `max_verify_loops`。重试耗尽后任务失败。空的
`checks` 列表会使 onboarding 失败（"The recipe defines no checks"）并阻止自动合并，因为没有任何
东西被验证。

### `dev_server`

| 字段          | 类型         | 默认值 | runner 如何使用                                                                                  |
| ------------- | ------------ | ------ | ------------------------------------------------------------------------------------------------ |
| `run`         | string       | 必需   | 在 `expandRecipeVars` 替换 `FOUNDRY_*` 变量后，于工作树中启动。                                  |
| `ready_path`  | string       | `/`    | 追加到 `http://127.0.0.1:$FOUNDRY_PORT`；缺少前导 `/` 时会补上。runner 轮询该 URL 直到返回 2xx。 |
| `timeout_sec` | 正数 integer | `120`  | 等待该 URL 的时长，超时则任务失败。                                                              |

服务器只在捕获 UI 截图时启动，之后停止。如果 UI 变更没有 `dev_server` 且 Agent 未附加截图，任务失败。
截图用 `npx playwright screenshot` 拍摄，因此 Playwright 必须可用（把它放进 `warm` 或 `system_deps`）。

### `services`

| 字段                | 类型   | 默认值 | runner 如何使用                                                                                                                                                                                                                              |
| ------------------- | ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres.database` | string | 无     | 声明 ticket 任务需要 Postgres。runner 在其 `FOUNDRY_POSTGRES_URL` 管理 URL 上创建 `foundry_<jobid>_<database>`，并暴露 `DATABASE_URL` 和 `FOUNDRY_DATABASE_URL`。任务结束时删除该数据库。runner 未配置 Postgres URL 时，就绪检查报告未就绪。 |

该值是名称后缀，会被清理为单词字符并截断到 63 个字符；它不是命令，也不会被展开。就绪检查还会把
runner 的 Postgres 导出为 `FOUNDRY_TEST_DATABASE_URL`。

### 默认 `ui_paths`

设置 `ui_paths` 时会替换默认列表：

```
**/*.tsx
**/*.jsx
**/*.vue
**/*.svelte
**/*.css
**/*.scss
**/*.html
**/components/**
**/pages/**
**/app/**/page.*
```

### 最小 `recipe.yaml`

```yaml
# .foundry/recipe.yaml —— 未特别说明的字段使用 schema 默认值。
install: pnpm install --frozen-lockfile

checks:
  - name: test
    run: pnpm test
    # timeout_sec: 900

dev_server:
  run: pnpm dev --port $FOUNDRY_PORT
  # ready_path: /
  # timeout_sec: 120

# 可选：
# services:
#   postgres:
#     database: app
# env_file: .env.example
# system_deps: [node>=22]
# warm:
#   - pnpm install --frozen-lockfile
# os: [macos, linux]
# ui_paths: ["apps/web/src/**"]
```

## `policy.yaml`

如果 `policy.yaml` 缺失或 schema 验证失败，runner 和控制面使用 `DEFAULT_POLICY`，因此错误值会静默
恢复下面的所有默认值（未知键直接忽略）。既没有 `paths` 也没有 `diff_regex` 的风险规则无效，并使整个
文件无效。

### 门禁与预算字段

| 字段                           | 类型                            | 默认值                             | 作用                                                                                                                          |
| ------------------------------ | ------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `merge`                        | `off` \| `merge_when_confident` | `off`                              | 仅在 `merge_when_confident` 时考虑自动合并。面板中的仓库设置启用合并时以其为准；否则由此值决定。Onboarding 任务从不自动合并。 |
| `require_ci_green`             | boolean                         | `true`                             | 为 true 时，挂起的 CI 运行会让门禁等待，失败的运行会阻止自动合并。为 false 时忽略 CI。                                        |
| `require_ai_review_clean`      | boolean                         | `false`                            | 为 true 时，门禁等待 `ai_review_bots` 中的某个评审出现，若最新的此类评审为 `CHANGES_REQUESTED` 则阻止。                       |
| `ai_review_bots`               | GitHub 登录名数组               | `["cursor[bot]"]`                  | 来自这些登录名的评审算作 AI 评审。                                                                                            |
| `auto_pr_review`               | boolean                         | `false`                            | PR 的 CI 检查结束后，再次评审已推送的 head，并把失败的检查详情交给评审 agent，结果发布到 PR。阻塞性问题会把任务送回 implementing；通过时也只留评论并交给人工，永不自动合并。如果仓库完全没有检查，评审会从 worker 的下一轮开始。 |
| `max_verify_loops`             | integer ≥ 0                     | `3`                                | 验证失败后允许多少次把任务送回 implementing。`0` 表示立即失败。                                                               |
| `max_review_loops`             | integer ≥ 0                     | `2`                                | 评审员可以把改动送回 implementing 多少次（包含验证前评审和自动 PR 评审）。超出预算后不再循环，交给人工。                      |
| `max_cost_per_job_usd`         | 正数                            | `10`                               | 成本预算。累计成本超过它时 runner 停止任务；门禁也会因此让自动合并失败。任务级覆盖优先。                                      |
| `max_diff_lines_for_automerge` | 正数 integer                    | `400`                              | 更大的 diff 会阻止自动合并并等待人工。                                                                                        |
| `max_job_minutes`              | 正数 integer                    | `60`                               | 挂钟时间限制。超过后 runner 停止任务。任务级覆盖优先。                                                                        |
| `permissions.deny_commands`    | string 数组                     | `["git push", "rm -rf /", "sudo"]` | harness 不得运行的 shell 命令。按前缀匹配，包括 `&&` 或 `;` 之后的命令。                                                      |
| `permissions.allow_web_fetch`  | boolean                         | `true`                             | 作为 web-fetch 权限传给 harness。                                                                                             |
| `risk_rules`                   | 数组                            | `[]`                               | 阻止自动合并并路由评审者的路径或正则规则。见下文。                                                                            |

`permissions` 由 `permissionsFromPolicy`（`packages/harness-core/src/types.ts`）转换为 harness
权限策略。预算用 `effectiveMaxJobMinutes` 和 `effectiveMaxCostUsd` 解析：任务级覆盖优先于 policy 值。

### `risk_rules[]`

| 字段         | 类型           | 默认值 | 作用                                                                                              |
| ------------ | -------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `name`       | 非空 string    | 必需   | 规则阻止自动合并时显示为 `Risk rule hit: <name> (N files)`。                                      |
| `paths`      | glob 数组      | 无     | 用 picomatch 匹配变更文件路径。                                                                   |
| `diff_regex` | string（正则） | 无     | 对每个变更文件的新增行进行测试。                                                                  |
| `reviewers`  | handle 数组    | `[]`   | GitHub 用户或团队（`@user`、`@org/team`；`@` 可省略）。规则阻止自动合并时在 PR 上请求这些评审者。 |

只要任何变更路径匹配 `paths` **或**任何新增行匹配 `diff_regex`，规则就命中。每个命中的规则都会列在
任务上、阻止自动合并，并把它的 `reviewers` 加入路由的评审请求。规则需要非空 `paths` 或
`diff_regex`。

### 最小 `policy.yaml`

下面的值都是默认值：

```yaml
# .foundry/policy.yaml
merge: off
require_ci_green: true
require_ai_review_clean: false
ai_review_bots: ["cursor[bot]"]
auto_pr_review: false
max_verify_loops: 3
max_review_loops: 2
max_cost_per_job_usd: 10
max_diff_lines_for_automerge: 400
max_job_minutes: 60

permissions:
  deny_commands: ["git push", "rm -rf /", "sudo"]
  allow_web_fetch: true

risk_rules: []
```

一条规则阻止数据库变更的自动合并并要求团队评审：

```yaml
risk_rules:
  - name: database
    paths: ["packages/db/migrations/**", "packages/db/src/**"]
    reviewers: ["@acme/backend-leads"]
```

## 其他文件

`playbook.md`、`playbook.<name>.md` 和 `playbook.<harness>.md` 是 markdown，不是 YAML。它们替换或
添加系统提示词；没有 schema 字段。

```markdown
<!-- .foundry/playbook.md -->
# 仓库 playbook

遵循默认阶段，另外：

- 使用 `pnpm`，不要用 `npm`。
- 在你修改的包中添加测试。
```

```markdown
<!-- .foundry/playbook.bugfix.md -->
# Bugfix playbook

从用失败测试复现 bug 开始 triage。
```

```markdown
<!-- .foundry/playbook.claude-code.md -->
# 给 claude-code 的说明

本仓库的测试需要 `FOUNDRY_TEST_DATABASE_URL`。
```

```markdown
<!-- .foundry/skills/architecture.md -->
# 架构

`apps/web` 是控制面。业务规则位于 `packages/control`，不在路由处理器中。
```

```yaml
# .github/ISSUE_TEMPLATE/foundry.yml —— 最小表单；仓库中自带的表单还有 Constraints 和 Out of scope。
name: Foundry ticket
description: 描述希望 Foundry 处理的工作。
labels: ["foundry"]
body:
  - type: textarea
    id: goal
    attributes:
      label: Goal
      description: 完成时什么应当成立？
    validations:
      required: true
  - type: textarea
    id: acceptance-criteria
    attributes:
      label: Acceptance criteria
      description: 具体、可检查的结果。
    validations:
      required: true
```
