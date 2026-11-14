# @foundry/os-adapters — Source

## Overview

Platform integration behind one `OsAdapter` interface: secret storage, service installation (launchd/systemd/Startup), sleep prevention, process control and small filesystem helpers. `currentOsAdapter()` picks the implementation from `process.platform`.

## Interface

- `[index.ts]` — `currentOsAdapter`, `OsAdapter` type re-exports.
- `[types.ts]` — `OsAdapter` interface: `secretStore`, `installService`, `uninstallService`, `serviceStatus`, `preventSleep`, `restoreSleep` and platform-specific options.
- `[exec.ts]` — `exec`, `which`, `killTree`, `platformExecutable`, `windowsExecutablePath`, `dfFreeMb`.
- `[file-secrets.ts]` — `FileSecretStore`: AES-256-GCM encrypted JSON store with a `0600` key file.
- `[home.ts]` — home/data/config dir helpers.
- `[service-names.ts]` — `serviceSlug` and service label/file naming.
- `[macos.ts]` — `MacOsAdapter`: launchd plist install, `KeychainSecretStore`, `caffeinate`.
- `[linux.ts]` — `LinuxAdapter`: systemd user unit install, `SystemdCredsStore`, `systemd-inhibit`.
- `[windows.ts]` — `WindowsAdapter`: Startup shortcut install.

## Invariants

- `exec` never throws for exit codes 124 (timeout) or 127 (not found); callers see a structured result `[exec.ts:exec]`.
- `killTree` is best-effort and never throws `[exec.ts:killTree]`.
- `FileSecretStore` encrypts with AES-256-GCM and writes the key with mode `0600` `[file-secrets.ts]`.
- Service filenames derive from `serviceSlug`, so uninstall targets the same path that install wrote `[service-names.ts:serviceSlug]`.
- Platform selection is exhaustive over `darwin`/`linux`/`win32` `[index.ts:currentOsAdapter]`.

## Side Effects

- Spawns system commands (`launchctl`, `systemctl`, `caffeinate`, `taskkill`, `which`, `df`).
- Reads and writes secret files, plist/unit/shortcut files.
- Raises and releases sleep inhibitors and kills process trees.

## Verification

- Run: `pnpm test`
