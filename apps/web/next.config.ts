import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: root,
  // Playwright hits 127.0.0.1; Next 16 blocks that origin from /_next/* unless listed.
  allowedDevOrigins: ["127.0.0.1"],
  // "Message the agent" uploads up to five 5 MB images in one server action; the 1 MB default
  // rejects ordinary screenshots.
  experimental: { serverActions: { bodySizeLimit: "32mb" } },
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@foundry/control", "@foundry/db", "@foundry/github", "@foundry/shared"],
  serverExternalPackages: ["postgres", "web-push", "nodemailer", "undici"],
  outputFileTracingIncludes: {
    "/**": ["../../packages/db/migrations/**"],
  },
};

export default config;
