# Linux Package Post-Install Script

## Overview

Shell post-install hook embedded in the Linux `.deb` / `.rpm` runner packages. It prints the
explicit next steps a human must take after installing the package (join a team, then install the
per-user or system service). It is registered by `nfpm.yaml` as `scripts.postinstall` and executes
at package-install time on the target machine. It is not the installer and it does not join,
start, or configure the runner itself.

## Interface

- `packaging/linux/postinstall.sh` [`postinstall.sh`] — executable `/bin/sh` script invoked by the
  package manager's post-install phase; its only output is a quoted heredoc (`cat <<'EOF'`) printed
  to stdout.
- Printed command contracts (documentation only; the script does not run them):
  - `foundry runner join <token> --server https://<your-foundry>` [`postinstall.sh:6`]
  - `foundry runner install-service` — per-user service, starts on login [`postinstall.sh:7`]
  - `sudo foundry runner install-service --system --user foundry` — shared box, starts on boot
    [`postinstall.sh:8`]
- Subdirectories: none.

## Invariants

- Installing the package must never start work on the machine by itself; joining and service
  installation are explicit human steps [`postinstall.sh:2-3`].
- The heredoc is quoted (`'EOF'`), so variable/command substitution is suppressed and the
  `<token>` / `<your-foundry>` placeholders are printed literally [`postinstall.sh:4`].
- The script performs no validation and no branching; it must remain tolerant of running as any
  package-manager user.

## Side Effects

- Writes a multi-line instruction block to stdout during `.deb` / `.rpm` post-install
  [`postinstall.sh:4-9`].
- No filesystem writes, no process spawning, no service activation, no network calls.

## Verification

- Run: `pnpm test` (from the repository root)
