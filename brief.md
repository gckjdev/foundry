# Handoff brief: Fix bug: opencode model not found

Stage reached: **implementing** · harness: claude-code · updated 2026-11-08T08:48:42.465Z

## Plan

## Plan

**Root cause.** The panel stores the model string verbatim (`updateRepoSettings`) and the runner passes it straight to OpenCode as `config.model` / `promptAsync.model`. OpenCode references models as `provider/model`. A bare name like `deepseek-flash` has no provider, so `splitModel()` returns `undefined` and OpenCode reports `Model not found: deepseek-flash/.`.

**Scope.** The ticket's acceptance criteria are documentation + input placeholder; no behavior change is requested.

1. `apps/web/src/app/(panel)/repos/page.tsx` — replace the repo card's `Default model` placeholder (`team default`) with text that shows the `provider/model` shape and keeps the "empty inherits team default" meaning.
2. `docs/local-setup.md` — add a "Harness and model" subsection after "First login": where model is set (team Settings, repo card, `model:provider/model` issue label), the naming style per harness (Claude Code Anthropic ID vs OpenCode `provider/model`), concrete OpenCode examples including `deepseek/deepseek-chat`, the exact `Model not found: deepseek-flash/.` failure for bare names, and that the provider must be authenticated on the runner (`opencode auth login` / `DEEPSEEK_API_KEY`).
3. `docs/local-setup.zh-CN.md` — matching Chinese translation of the same subsection.
4. Verify with recipe checks, and capture a screenshot of `/repos` since the UI text changed.

## Findings

- triage: The error comes from OpenCode receiving a model name without the required `provider/model` prefix: the repo/team "Default model" field is persisted verbatim and passed to OpenCode (splitModel returns undefined for a bare name like `deepseek-flash`, so OpenCode reports `Model not found: deepseek-flash/.`). Acceptance criteria are documentation plus UI placeholder guidance, so the fix is docs + placeholder rather than a behavior change.
- investigating: Plan recorded. Implementing the placeholder change in the repo settings card and the matching bilingual local-setup documentation, then I will run checks and capture a `/repos` screenshot.
- implementing: Implemented the bilingual "Harness and model" docs section and updated the repo card model placeholder. Next: run recipe checks and capture a `/repos` screenshot to prove the placeholder renders.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "a893a790-24d0-4ac3-a95a-e44fa4c5330b",
  "title": "Fix bug: opencode model not found",
  "stageReached": "implementing",
  "harness": "claude-code",
  "sessionId": "83a12c51-c1e2-4d2e-a6e6-2336f053569b",
  "plan": "## Plan\n\n**Root cause.** The panel stores the model string verbatim (`updateRepoSettings`) and the runner passes it straight to OpenCode as `config.model` / `promptAsync.model`. OpenCode references models as `provider/model`. A bare name like `deepseek-flash` has no provider, so `splitModel()` returns `undefined` and OpenCode reports `Model not found: deepseek-flash/.`.\n\n**Scope.** The ticket's acceptance criteria are documentation + input placeholder; no behavior change is requested.\n\n1. `apps/web/src/app/(panel)/repos/page.tsx` — replace the repo card's `Default model` placeholder (`team default`) with text that shows the `provider/model` shape and keeps the \"empty inherits team default\" meaning.\n2. `docs/local-setup.md` — add a \"Harness and model\" subsection after \"First login\": where model is set (team Settings, repo card, `model:provider/model` issue label), the naming style per harness (Claude Code Anthropic ID vs OpenCode `provider/model`), concrete OpenCode examples including `deepseek/deepseek-chat`, the exact `Model not found: deepseek-flash/.` failure for bare names, and that the provider must be authenticated on the runner (`opencode auth login` / `DEEPSEEK_API_KEY`).\n3. `docs/local-setup.zh-CN.md` — matching Chinese translation of the same subsection.\n4. Verify with recipe checks, and capture a screenshot of `/repos` since the UI text changed.",
  "findings": [
    "triage: The error comes from OpenCode receiving a model name without the required `provider/model` prefix: the repo/team \"Default model\" field is persisted verbatim and passed to OpenCode (splitModel returns undefined for a bare name like `deepseek-flash`, so OpenCode reports `Model not found: deepseek-flash/.`). Acceptance criteria are documentation plus UI placeholder guidance, so the fix is docs + placeholder rather than a behavior change.",
    "investigating: Plan recorded. Implementing the placeholder change in the repo settings card and the matching bilingual local-setup documentation, then I will run checks and capture a `/repos` screenshot.",
    "implementing: Implemented the bilingual \"Harness and model\" docs section and updated the repo card model placeholder. Next: run recipe checks and capture a `/repos` screenshot to prove the placeholder renders."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-08T08:48:42.465Z"
}
```
