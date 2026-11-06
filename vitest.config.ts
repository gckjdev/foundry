import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      // Bun imports `.md` playbooks as text (`with { type: "text" }`); mirror that for tests.
      name: "markdown-as-text",
      transform(code, id) {
        if (id.endsWith(".md")) return { code: `export default ${JSON.stringify(code)};`, map: null };
      },
    },
  ],
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
  },
});
