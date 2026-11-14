# runner

## Overview

The runner package is the on-machine half of Foundry: a Bun-compiled `foundry`
CLI plus a daemon that joins a team, heartbeats, claims jobs, checks repo
readiness, drives a coding-agent harness inside a git worktree, and reports
staged progress, evidence, and confidence back to the control plane.

## Subdirectories & Boundaries

- src: [./src/EGM.md](./src/EGM.md) — daemon, job runner, workspace/git, harness bridge, MCP tool server, config and CLI entry point.
- scripts: [./scripts/EGM.md](./scripts/EGM.md) — release packaging and the compiled-MCP smoke check.
