# Testing coverage report

Generated **2026-11-07** by `pnpm test:report`. Database-backed tests: **included**.

Regenerate after changing tests:

```bash
FOUNDRY_TEST_DATABASE_URL=postgres://USER@HOST:PORT/postgres pnpm test:report
```

HTML detail: `coverage/index.html` (gitignored). Architecture: `docs/testing.md`.

## Overall

| Statements | Branches | Functions | Lines |
| ---------- | -------- | --------- | ----- |
| 67.1%      | 55.7%    | 67.3%     | 70.0% |

## By package / app

| Path                           | Statements | Branches | Functions | Lines |
| ------------------------------ | ---------- | -------- | --------- | ----- |
| `apps/realtime`                | 59.8%      | 47.2%    | 55.0%     | 57.5% |
| `apps/runner`                  | 67.1%      | 48.6%    | 70.3%     | 70.9% |
| `apps/web`                     | 18.5%      | 17.0%    | 18.1%     | 18.0% |
| `packages/control`             | 70.6%      | 56.6%    | 72.1%     | 76.0% |
| `packages/db`                  | 57.3%      | 28.6%    | 39.5%     | 55.6% |
| `packages/github`              | 88.0%      | 72.7%    | 90.9%     | 90.2% |
| `packages/harness-claude-code` | 71.6%      | 60.9%    | 70.8%     | 77.2% |
| `packages/harness-core`        | 89.2%      | 83.8%    | 82.1%     | 89.0% |
| `packages/harness-opencode`    | 46.2%      | 50.9%    | 42.2%     | 49.7% |
| `packages/mcp-foundry`         | 73.8%      | 27.3%    | 75.0%     | 75.0% |
| `packages/os-adapters`         | 63.7%      | 44.4%    | 57.4%     | 64.2% |
| `packages/playbooks`           | 92.3%      | 73.2%    | 100.0%    | 94.1% |
| `packages/shared`              | 91.1%      | 80.0%    | 95.6%     | 94.3% |
