import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: root,
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@foundry/control", "@foundry/db", "@foundry/github", "@foundry/shared"],
  serverExternalPackages: ["postgres", "web-push", "nodemailer", "undici"],
  outputFileTracingIncludes: {
    "/**": ["../../packages/db/migrations/**"],
  },
};

export default config;
