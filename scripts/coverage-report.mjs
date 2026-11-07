#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const summaryPath = join(process.cwd(), "coverage/coverage-summary.json");
let summary;
try {
  summary = JSON.parse(readFileSync(summaryPath, "utf8"));
} catch {
  console.error("Run `pnpm test:coverage` first (writes coverage/coverage-summary.json).");
  process.exit(1);
}

function pct(metric) {
  const n = metric?.pct;
  return typeof n === "number" ? n.toFixed(1) : "n/a";
}

function bucket(file) {
  const short = file.replace(`${process.cwd()}/`, "");
  const m = /^(packages\/[^/]+|apps\/[^/]+)/.exec(short);
  return m ? m[1] : short.split("/").slice(0, 2).join("/");
}

const total = summary.total ?? {};
const generated = new Date().toISOString().slice(0, 10);
const db = process.env.FOUNDRY_TEST_DATABASE_URL ? "included" : "skipped (FOUNDRY_TEST_DATABASE_URL unset)";

const groups = new Map();
for (const [file, metrics] of Object.entries(summary)) {
  if (file === "total") continue;
  const key = bucket(file);
  const g = groups.get(key) ?? { s: 0, sc: 0, b: 0, bc: 0, f: 0, fc: 0, l: 0, lc: 0 };
  g.s += metrics.statements?.total ?? 0;
  g.sc += metrics.statements?.covered ?? 0;
  g.b += metrics.branches?.total ?? 0;
  g.bc += metrics.branches?.covered ?? 0;
  g.f += metrics.functions?.total ?? 0;
  g.fc += metrics.functions?.covered ?? 0;
  g.l += metrics.lines?.total ?? 0;
  g.lc += metrics.lines?.covered ?? 0;
  groups.set(key, g);
}

function rate(covered, all) {
  return all === 0 ? "n/a" : ((100 * covered) / all).toFixed(1);
}

function markdownTable(headers, bodyRows) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...bodyRows.map((row) => row[index].length)),
  );
  const render = (cells) => `| ${cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  const rule = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  return [render(headers), rule, ...bodyRows.map((row) => render(row))].join("\n");
}

const rows = [...groups.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, g]) => [
    `\`${name}\``,
    `${rate(g.sc, g.s)}%`,
    `${rate(g.bc, g.b)}%`,
    `${rate(g.fc, g.f)}%`,
    `${rate(g.lc, g.l)}%`,
  ]);

const overall = markdownTable(
  ["Statements", "Branches", "Functions", "Lines"],
  [
    [
      `${pct(total.statements)}%`,
      `${pct(total.branches)}%`,
      `${pct(total.functions)}%`,
      `${pct(total.lines)}%`,
    ],
  ],
);
const byPackage = markdownTable(["Path", "Statements", "Branches", "Functions", "Lines"], rows);

const md = `# Testing coverage report

Generated **${generated}** by \`pnpm test:report\`. Database-backed tests: **${db}**.

Regenerate after changing tests:

\`\`\`bash
FOUNDRY_TEST_DATABASE_URL=postgres://USER@HOST:PORT/postgres pnpm test:report
\`\`\`

HTML detail: \`coverage/index.html\` (gitignored). Architecture: \`docs/testing.md\`.

## Overall

${overall}

## By package / app

${byPackage}
`;

writeFileSync(join(process.cwd(), "docs/testing-report.md"), md);
console.log("Wrote docs/testing-report.md");
