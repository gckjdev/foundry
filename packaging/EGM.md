# Packaging

## Overview

Release-packaging assets for the `foundry` runner binary. They are consumed by
`apps/runner/scripts/build-release.ts` (invoked from `.github/workflows/release.yml`) and turn the
compiled binary into a Homebrew formula and Linux `.deb` / `.rpm` packages. Nothing here is
executed directly against the control plane; these files describe how the runner is installed on a
team's machines.

Direct files in this directory:

- `nfpm.yaml` — nfpm configuration for the `.deb` and `.rpm` packages. Package identity is
  `name: foundry`, `platform: linux`, with `version: ${FOUNDRY_VERSION}` and
  `arch: ${FOUNDRY_ARCH}` supplied by the build; `depends: git`, `recommends: systemd`; the binary
  is installed from `${FOUNDRY_BINARY}` to `/usr/bin/foundry` with mode `0755`; the post-install
  hook is `scripts.postinstall: packaging/linux/postinstall.sh` [`nfpm.yaml:2-23`].
- `homebrew/foundry.rb.tmpl` — Homebrew formula template (not source code, no contract generated).
  It is rendered by `build-release.ts` (`{{VERSION}}`, `{{RELEASE_URL}}`, `{{SHA_*}}` placeholders)
  into `dist/release/foundry.rb` and pushed to the `foundry-dev/homebrew-tap` repository
  [`apps/runner/scripts/build-release.ts:69-76`].

## Subdirectories & Boundaries

- [linux](./linux/EGM.md): The `.deb` / `.rpm` post-install script that prints explicit join and
  service-install steps instead of starting the runner during package installation.
- `homebrew`: Unlinked (pruned, no source code). Contains only the Homebrew formula template
  described above; its contract is the template placeholder set, not executable code.

## Invariants

- Every template placeholder must be replaced by `build-release.ts`; an unmatched `{{SHA_*}}`
  renders as `MISSING` rather than silently producing a broken checksum
  [`apps/runner/scripts/build-release.ts:72-75`].
- `nfpm` is invoked from the repository root with `FOUNDRY_VERSION`, `FOUNDRY_ARCH`, and
  `FOUNDRY_BINARY` in the environment [`apps/runner/scripts/build-release.ts:83-100`], so the
  relative `scripts.postinstall: packaging/linux/postinstall.sh` path resolves.
- Packaging is optional: when `nfpm` is absent or `--skip-packages` is passed, `.deb` / `.rpm`
  output is skipped with a log line [`apps/runner/scripts/build-release.ts:78-79,105-107`].
- Install and formula documentation direct the user to join the team and install the service
  explicitly; installing never starts work by itself
  [`packaging/linux/postinstall.sh:2-3`, `packaging/homebrew/foundry.rb.tmpl:33-39`].
- `packaging/**` changes are classified as human-review infrastructure per
  `.foundry/policy.yaml:47-55`.

## Side Effects

- `nfpm package` writes `.deb` / `.rpm` artifacts into `apps/runner/dist/release` and their hashes
  are appended to `SHA256SUMS` [`apps/runner/scripts/build-release.ts:83-104,109-114`].
- Rendering the template writes `dist/release/foundry.rb`; the release workflow copies it into the
  `homebrew-tap` checkout and commits/pushes it [`apps/runner/scripts/build-release.ts:76`,
  `.github/workflows/release.yml:42-51`].
- The Linux post-install script emits guidance to stdout on the target machine
  [`packaging/linux/postinstall.sh:4-9`].

## Verification

- Run: `pnpm test` (from the repository root)
