export const DEFAULT_RELEASE_URL = "https://github.com/foundry-dev/foundry/releases/latest/download";

/**
 * The `curl … | sh` installer (spec 5.9). Served by the control plane at `/install.sh` with the
 * server URL filled in, and published with each release. Extra arguments are passed to
 * `foundry runner join`, so `sh -s -- fdj_xxx --shared` installs and joins in one step.
 */
export function installScript(opts: { serverUrl?: string; releaseUrl?: string } = {}): string {
  const release = opts.releaseUrl ?? DEFAULT_RELEASE_URL;
  return `#!/bin/sh
# Foundry runner installer. Usage:
#   curl -fsSL ${opts.serverUrl ?? "https://<your-foundry>"}/install.sh | sh
#   curl -fsSL ${opts.serverUrl ?? "https://<your-foundry>"}/install.sh | sh -s -- <fdj_token> [--shared]
set -eu

RELEASE_URL="\${FOUNDRY_RELEASE_URL:-${release}}"
SERVER_URL="\${FOUNDRY_SERVER_URL:-${opts.serverUrl ?? ""}}"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "foundry: unsupported OS $(uname -s); the runner supports macOS and Linux" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "foundry: unsupported CPU $(uname -m)" >&2; exit 1 ;;
esac

if [ -n "\${FOUNDRY_INSTALL_DIR:-}" ]; then
  dir="$FOUNDRY_INSTALL_DIR"
elif [ -w /usr/local/bin ]; then
  dir=/usr/local/bin
else
  dir="$HOME/.local/bin"
fi
mkdir -p "$dir"

asset="foundry-$os-$arch.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "Downloading $asset…"
curl -fsSL "$RELEASE_URL/$asset" -o "$tmp/$asset"
curl -fsSL "$RELEASE_URL/SHA256SUMS" -o "$tmp/SHA256SUMS"
expected="$(grep " $asset\\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"
fi
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  echo "foundry: checksum mismatch for $asset" >&2
  exit 1
fi
tar -xzf "$tmp/$asset" -C "$tmp"
install -m 0755 "$tmp/foundry" "$dir/foundry"
echo "Installed $("$dir/foundry" --version) to $dir/foundry"
case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "Add $dir to your PATH." ;;
esac

if [ "$#" -gt 0 ]; then
  if [ -n "$SERVER_URL" ]; then
    "$dir/foundry" runner join --server "$SERVER_URL" "$@"
  else
    "$dir/foundry" runner join "$@"
  fi
  echo "Start it now with: foundry runner start   (or install the service: foundry runner install-service)"
elif [ -n "$SERVER_URL" ]; then
  echo "Next: foundry runner join <token> --server $SERVER_URL"
fi
`;
}
