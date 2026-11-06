/**
 * Build release artifacts for every supported platform (docs/adr/001-runner-runtime.md):
 *
 *   dist/release/foundry-<os>-<arch>.tar.gz   compiled single binary
 *   dist/release/SHA256SUMS
 *   dist/release/install.sh                   the curl | sh installer
 *   dist/release/foundry.rb                   Homebrew formula for the tap
 *   dist/release/*.deb, *.rpm                 Linux packages (when nfpm is installed)
 *
 *   bun scripts/build-release.ts [--targets darwin-arm64,linux-x64] [--release-url URL]
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_RELEASE_URL, installScript, VERSION } from "@foundry/shared";

const ALL_TARGETS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] as const;
type Target = (typeof ALL_TARGETS)[number];

const { values } = parseArgs({
  options: { targets: { type: "string" }, "release-url": { type: "string" }, "skip-packages": { type: "boolean" } },
});
const targets = (values.targets?.split(",") ?? ALL_TARGETS) as Target[];
const releaseUrl = values["release-url"] ?? process.env.FOUNDRY_RELEASE_URL ?? DEFAULT_RELEASE_URL;
const root = resolve(import.meta.dir, "..");
const out = join(root, "dist", "release");
const repoRoot = resolve(root, "../..");

function run(cmd: string, args: string[], cwd = root, env: Record<string, string> = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} failed with ${r.status}`);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const sums: Record<string, string> = {};
for (const target of targets) {
  const dir = join(out, target);
  mkdirSync(dir, { recursive: true });
  run("bun", ["build", "src/cli.ts", "--compile", "--minify", `--target=bun-${target}`, "--outfile", join(dir, "foundry")]);
  const tarball = `foundry-${target}.tar.gz`;
  run("tar", ["-czf", join(out, tarball), "-C", dir, "foundry"]);
  sums[tarball] = sha256(join(out, tarball));
}

writeFileSync(join(out, "install.sh"), installScript({ releaseUrl }), { mode: 0o755 });

const formula = readFileSync(join(repoRoot, "packaging/homebrew/foundry.rb.tmpl"), "utf8")
  .replaceAll("{{VERSION}}", VERSION)
  .replaceAll("{{RELEASE_URL}}", releaseUrl.replace("/latest/download", `/download/v${VERSION}`))
  .replace(/\{\{SHA_([A-Z0-9_]+)\}\}/g, (_, key: string) => sums[`foundry-${key.toLowerCase().replace("_", "-")}.tar.gz`] ?? "MISSING");
writeFileSync(join(out, "foundry.rb"), formula);

const nfpm = spawnSync("nfpm", ["--version"], { stdio: "ignore" }).status === 0;
if (!values["skip-packages"] && nfpm) {
  for (const target of targets.filter((t) => t.startsWith("linux-"))) {
    const arch = target.endsWith("arm64") ? "arm64" : "amd64";
    for (const packager of ["deb", "rpm"]) {
      run("nfpm", ["package", "--config", join(repoRoot, "packaging/nfpm.yaml"), "--packager", packager, "--target", out], repoRoot, {
        FOUNDRY_VERSION: VERSION,
        FOUNDRY_ARCH: arch,
        FOUNDRY_BINARY: join(out, target, "foundry"),
      });
    }
  }
  for (const f of readdirSync(out).filter((f) => f.endsWith(".deb") || f.endsWith(".rpm"))) sums[f] = sha256(join(out, f));
} else if (!values["skip-packages"]) {
  console.log("nfpm not found: skipping .deb/.rpm (https://nfpm.goreleaser.com)");
}

writeFileSync(
  join(out, "SHA256SUMS"),
  Object.entries(sums)
    .map(([f, h]) => `${h}  ${f}`)
    .join("\n") + "\n",
);
console.log(`\nRelease ${VERSION} written to ${out}`);

