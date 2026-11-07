import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

const markdownAsText = {
  name: "markdown-as-text",
  transform(code: string, id: string) {
    if (id.endsWith(".md")) return { code: `export default ${JSON.stringify(code)};`, map: null };
  },
};

const aliases = {
  "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
  "server-only": fileURLToPath(new URL("./tests/shims/server-only.ts", import.meta.url)),
  "next/server": fileURLToPath(new URL("./tests/shims/next-server.ts", import.meta.url)),
};

const nodeTest = {
  environment: "node" as const,
  testTimeout: 30_000,
  hookTimeout: 30_000,
  pool: "forks" as const,
};

export default defineConfig({
  root,
  plugins: [markdownAsText],
  resolve: { alias: aliases },
  test: {
    ...nodeTest,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/testing.ts", "**/*.d.ts"],
    },
    projects: [
      {
        plugins: [markdownAsText],
        resolve: { alias: aliases },
        test: {
          name: "unit",
          ...nodeTest,
          include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
          exclude: ["packages/control/**", "packages/db/**"],
        },
      },
      {
        plugins: [markdownAsText],
        resolve: { alias: aliases },
        test: {
          name: "api",
          ...nodeTest,
          include: [
            "packages/control/src/**/*.test.ts",
            "packages/db/src/**/*.test.ts",
            "tests/api/**/*.test.ts",
          ],
        },
      },
      {
        plugins: [markdownAsText],
        resolve: { alias: aliases },
        test: {
          name: "e2e",
          ...nodeTest,
          testTimeout: 60_000,
          hookTimeout: 60_000,
          include: ["tests/e2e/**/*.test.ts"],
        },
      },
    ],
  },
});
