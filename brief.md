# Handoff brief: Remove .artifacts from git

Stage reached: **reviewing** · harness: claude-code · updated 2026-11-12T07:28:06.575Z

## Plan

1. Untrack the committed artifact with `git rm -r --cached .artifacts` — this removes `.artifacts/**` from the index while leaving the runtime folder on disk.
2. Commit the deletion (the only tracked entry is `.artifacts/abf378da-.../note.txt`; the root `.gitignore` already ignores `.artifacts`).
3. Verify: `git ls-files .artifacts` is empty, and a new file created under `.artifacts/` does not appear in `git status` (proves future artifacts can't be committed).
4. Run the repo recipe checks via `run_checks` (no source changes expected, but required for the merge gate).

## Findings

- triage: Ticket is clear: stop tracking .artifacts contents. Root .gitignore already lists .artifacts, but .artifacts/abf378da-.../note.txt was committed before that rule and remains tracked, so gitignore does not apply to it.
- investigating: Investigation confirmed the only tracked artifact is `.artifacts/abf378da-b83d-4642-b8e0-5dc8b93a6fe8/6be1b61a-7329-4051-8d13-f510b1b1a86c/note.txt`, committed before `.gitignore` gained the `.artifacts` rule (commit 97ea4dd). `ARTIFACTS_DIR` defaults to `./.artifacts` at runtime, so the folder must stay on disk — only the index entry needs removal.
- implementing: Removed `.artifacts/**` from the git index (`git rm -r --cached .artifacts`) and committed it. The runtime folder remains on disk, `.gitignore` already ignores `.artifacts`, and a probe file created under it did not appear in `git status`, confirming future artifacts cannot be committed.
- review: Reviewed the diff against origin/main: a single deletion, `.artifacts/abf378da-.../6be1b61a-.../note.txt` (content "hello"), the only tracked entry introduced by the accidental checkpoint commit f28633c. Acceptance criterion verified: `git ls-files .artifacts` is empty, and `git check-ignore -v .artifacts/anything/here.txt` confirms the existing root `.gitignore` rule (line 11) covers future files, so new artifacts cannot be staged. The change is appropriately minimal — no source, CI, deploy or docs changes are needed. Checked: code quality (scope, correctness — the deleted file was unrelated runtime output, no test or code references it; `packages/control/src/artifacts.ts` uses `mkdir(dirname(path), { recursive: true })` so a fresh clone without the `.artifacts` directory still works, and deploy uses `ARTIFACTS_DIR=/data/artifacts`); security (removed content is a harmless fixture, no secrets); UI design (not applicable — no UI files or user-facing behavior changed). Tests are not applicable for a pure untrack. Non-blocking note only: history still contains the blob; if the intent were to purge it from repository history, `git filter-repo` would be needed, but the ticket's acceptance criterion covers future commits only.
- reviewing: Reviewer approved the change. Running the repo recipe checks now; no UI changes are involved.

## Checks

_not run_

## Questions and answers

_none_

## Open uncertainties

_none_

```json
{
  "version": 1,
  "jobId": "8a3b87d9-adf3-4191-bd61-a662e2b8f98b",
  "title": "Remove .artifacts from git",
  "stageReached": "reviewing",
  "harness": "claude-code",
  "sessionId": "1de068a3-292b-4264-8ba2-61daefa22bd9",
  "plan": "1. Untrack the committed artifact with `git rm -r --cached .artifacts` — this removes `.artifacts/**` from the index while leaving the runtime folder on disk.\n2. Commit the deletion (the only tracked entry is `.artifacts/abf378da-.../note.txt`; the root `.gitignore` already ignores `.artifacts`).\n3. Verify: `git ls-files .artifacts` is empty, and a new file created under `.artifacts/` does not appear in `git status` (proves future artifacts can't be committed).\n4. Run the repo recipe checks via `run_checks` (no source changes expected, but required for the merge gate).",
  "findings": [
    "triage: Ticket is clear: stop tracking .artifacts contents. Root .gitignore already lists .artifacts, but .artifacts/abf378da-.../note.txt was committed before that rule and remains tracked, so gitignore does not apply to it.",
    "investigating: Investigation confirmed the only tracked artifact is `.artifacts/abf378da-b83d-4642-b8e0-5dc8b93a6fe8/6be1b61a-7329-4051-8d13-f510b1b1a86c/note.txt`, committed before `.gitignore` gained the `.artifacts` rule (commit 97ea4dd). `ARTIFACTS_DIR` defaults to `./.artifacts` at runtime, so the folder must stay on disk — only the index entry needs removal.",
    "implementing: Removed `.artifacts/**` from the git index (`git rm -r --cached .artifacts`) and committed it. The runtime folder remains on disk, `.gitignore` already ignores `.artifacts`, and a probe file created under it did not appear in `git status`, confirming future artifacts cannot be committed.",
    "review: Reviewed the diff against origin/main: a single deletion, `.artifacts/abf378da-.../6be1b61a-.../note.txt` (content \"hello\"), the only tracked entry introduced by the accidental checkpoint commit f28633c. Acceptance criterion verified: `git ls-files .artifacts` is empty, and `git check-ignore -v .artifacts/anything/here.txt` confirms the existing root `.gitignore` rule (line 11) covers future files, so new artifacts cannot be staged. The change is appropriately minimal — no source, CI, deploy or docs changes are needed. Checked: code quality (scope, correctness — the deleted file was unrelated runtime output, no test or code references it; `packages/control/src/artifacts.ts` uses `mkdir(dirname(path), { recursive: true })` so a fresh clone without the `.artifacts` directory still works, and deploy uses `ARTIFACTS_DIR=/data/artifacts`); security (removed content is a harmless fixture, no secrets); UI design (not applicable — no UI files or user-facing behavior changed). Tests are not applicable for a pure untrack. Non-blocking note only: history still contains the blob; if the intent were to purge it from repository history, `git filter-repo` would be needed, but the ticket's acceptance criterion covers future commits only.",
    "reviewing: Reviewer approved the change. Running the repo recipe checks now; no UI changes are involved."
  ],
  "checks": [],
  "qa": [],
  "uncertainties": [],
  "updatedAt": "2026-11-12T07:28:06.575Z"
}
```
