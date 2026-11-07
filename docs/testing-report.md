# Testing coverage report

Generated **2026-11-07** by `pnpm test:report`. Database-backed tests: **skipped (FOUNDRY_TEST_DATABASE_URL unset)**.

Regenerate after changing tests:

```bash
FOUNDRY_TEST_DATABASE_URL=postgres://USER@HOST:PORT/postgres pnpm test:report
```

HTML detail: `coverage/index.html` (gitignored). Architecture: `docs/testing.md`.

## Overall

| Statements | Branches | Functions | Lines |
| ---------- | -------- | --------- | ----- |
| 43.5%      | 34.7%    | 39.2%     | 45.5% |

## By package / app

| Path                           | Statements | Branches | Functions | Lines |
| ------------------------------ | ---------- | -------- | --------- | ----- |
| `apps/realtime`                | 59.8%      | 47.2%    | 55.0%     | 57.5% |
| `apps/runner`                  | 63.7%      | 46.0%    | 61.6%     | 67.3% |
| `apps/web`                     | 0.0%       | 0.0%     | 0.0%      | 0.0%  |
| `packages/control`             | 1.4%       | 0.0%     | 0.0%      | 1.6%  |
| `packages/db`                  | 25.8%      | 0.0%     | 7.0%      | 24.7% |
| `packages/github`              | 10.7%      | 10.6%    | 2.6%      | 9.8%  |
| `packages/harness-claude-code` | 71.6%      | 60.9%    | 70.8%     | 77.2% |
| `packages/harness-core`        | 89.2%      | 83.8%    | 82.1%     | 89.0% |
| `packages/harness-opencode`    | 46.2%      | 50.9%    | 42.2%     | 49.7% |
| `packages/mcp-foundry`         | 73.8%      | 27.3%    | 75.0%     | 75.0% |
| `packages/os-adapters`         | 52.9%      | 35.0%    | 42.6%     | 53.2% |
| `packages/playbooks`           | 92.3%      | 73.2%    | 100.0%    | 94.1% |
| `packages/shared`              | 82.3%      | 72.3%    | 81.3%     | 85.0% |
