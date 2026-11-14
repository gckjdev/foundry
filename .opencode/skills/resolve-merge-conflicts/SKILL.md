---

name: resolve-merge-conflicts
description: Resolve Git merge conflicts using compact diffs and index stages instead of loading whole files into context. Use when a merge, rebase, cherry-pick or stash pop stops on conflicts, when `git status` shows unmerged paths, or when files contain conflict markers.
---

# Resolve merge conflicts

## Overview

Resolve conflicts without reading whole files unless the compact view is not enough. Start with a
summary, then inspect and resolve one conflicted file at a time. Keeping the context small matters in
large repositories, and taking one file at a time makes it obvious which decision belongs to which
conflict.

## Workflow

1. **Summarize the conflict.** List the unresolved paths, their index stages and the kind of conflict:

   ```bash
   git diff --name-only --diff-filter=U
   git status --short
   git ls-files -u
   ```

   `git status --short` shows the conflict code: `UU` both modified, `AA` both added, `DU`/`UD`
   deleted on one side. `git ls-files -u` prints one line per index stage — 1 is the common base,
   2 is ours, 3 is theirs — so a missing stage tells you which side deleted the file.

2. **Inspect one file.** A combined diff shows only the conflicting hunks, a few surrounding lines
   and both sides, which is usually all you need:

   ```bash
   git diff --stat -- <path>
   git diff -- <path>
   ```

   When the combined diff is unclear, or the file has no markers (add/add, binary or rename
   conflicts), compare the index stages directly:

   ```bash
   git show :1:<path>   # common base
   git show :2:<path>   # ours
   git show :3:<path>   # theirs
   ```

3. **Resolve the file.**
   - Take one side wholesale when it is entirely correct: `git checkout --ours -- <path>` or
     `git checkout --theirs -- <path>`.
   - Read more of the file, or open it, only when the compact view is not enough to decide.
   - Otherwise edit the file and remove the `<<<<<<<`, `=======`, `>>>>>>>` markers, keeping the
     intent of both sides where the change is additive.
   - For a modify/delete conflict decide whether the file survives: `git rm -- <path>` removes it,
     `git add -- <path>` keeps the version in the worktree.
   - During a rebase "ours" is the branch being rebased onto and "theirs" is the commit being
     replayed. Check `git status` before choosing a side.

4. **Re-check unresolved files and markers.**

   ```bash
   git diff --name-only --diff-filter=U
   git grep -n -E '^(<{7}|={7}|>{7})( |$)' -- <paths>
   ```

   Expect a marker hit while a file is unresolved; repeat until both commands come back empty.

5. **Validate and stage.**
   - Run the checks for the touched area: targeted tests, typecheck, lint or build.
   - Stage each resolved file with `git add -- <path>`.
   - Let the caller decide when to commit. Never push, force-push or rewrite history as part of
     resolving a conflict.

## Notes

- Use the summary and combined diff before opening a conflicted file directly.
- Resolve one file at a time to keep context small.
- Expect both marker-based text conflicts and index-only conflicts such as add/add or
  modify/delete. The commands above summarize both.
- If a resolution goes wrong, `git checkout --conflict=merge -- <path>` restores the conflict
  markers. `git merge --abort`, `git rebase --abort` or `git cherry-pick --abort` returns to the
  state before the operation started.
- If a conflicting change comes from a dependency update or generated file, check the repository's
  instructions for how that file is produced before hand-editing it.
