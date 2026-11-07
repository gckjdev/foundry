# Handoff brief: remove macos-13 macos-14 from the CI checking

Stage reached: **implementing** · harness: claude-code · updated 2026-11-07T05:13:36.540Z

## Plan

1. Edit `.github/workflows/ci.yml` line 39: change the `runner` job matrix from `[macos-14, macos-13, ubuntu-24.04, ubuntu-24.04-arm]` to `[ubuntu-24.04, ubuntu-24.04-arm]`.
2. Confirm no other workflow, recipe, or doc references macos-13/macos-14 (repo-wide grep already shows only this line).
3. Validate the YAML parses (e.g. `node -e` with a YAML parser if available, or `pnpm exec biome check` on the file).
4. Run the recipe checks with `run_checks` (typecheck + test) to prove nothing else broke.

## Findings

- triage: Ticket is clear: remove macos-13 and macos-14 from CI. The only reference in the repo is the runner job's OS matrix in .github/workflows/ci.yml line 39; no docs or other workflows mention those runners.
- investigating: Located the single change point: the `runner` job matrix in .github/workflows/ci.yml. No tests reference the matrix; the change is confined to CI config. Plan recorded.
- implementing: Removed macos-14 and macos-13 from the runner job matrix in .github/workflows/ci.yml, leaving ubuntu-24.04 and ubuntu-24.04-arm. A repo-wide grep confirms this was the only reference to those runners, and the workflow still parses as valid YAML with the expected matrix.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "3a9fca52-54bd-4e95-b7a8-4cc72c2d870c",
  "title": "remove macos-13 macos-14 from the CI checking",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "1f5ee859-c19e-444e-bc2c-0985e6ae4a55",
  "plan": "1. Edit `.github/workflows/ci.yml` line 39: change the `runner` job matrix from `[macos-14, macos-13, ubuntu-24.04, ubuntu-24.04-arm]` to `[ubuntu-24.04, ubuntu-24.04-arm]`.\n2. Confirm no other workflow, recipe, or doc references macos-13/macos-14 (repo-wide grep already shows only this line).\n3. Validate the YAML parses (e.g. `node -e` with a YAML parser if available, or `pnpm exec biome check` on the file).\n4. Run the recipe checks with `run_checks` (typecheck + test) to prove nothing else broke.",
  "findings": [
    "triage: Ticket is clear: remove macos-13 and macos-14 from CI. The only reference in the repo is the runner job's OS matrix in .github/workflows/ci.yml line 39; no docs or other workflows mention those runners.",
    "investigating: Located the single change point: the `runner` job matrix in .github/workflows/ci.yml. No tests reference the matrix; the change is confined to CI config. Plan recorded.",
    "implementing: Removed macos-14 and macos-13 from the runner job matrix in .github/workflows/ci.yml, leaving ubuntu-24.04 and ubuntu-24.04-arm. A repo-wide grep confirms this was the only reference to those runners, and the workflow still parses as valid YAML with the expected matrix."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-07T05:13:36.540Z"
}
```
