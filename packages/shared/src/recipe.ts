import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const OsSchema = z.enum(["macos", "linux", "windows"]);
export type Os = z.infer<typeof OsSchema>;

export const DEFAULT_UI_PATHS = [
  "**/*.tsx",
  "**/*.jsx",
  "**/*.vue",
  "**/*.svelte",
  "**/*.css",
  "**/*.scss",
  "**/*.html",
  "**/components/**",
  "**/pages/**",
  "**/app/**/page.*",
];

export const RecipeCheckSchema = z.object({
  name: z.string().min(1),
  run: z.string().min(1),
  timeout_sec: z.number().int().positive().default(900),
});

export const RecipeSchema = z.object({
  install: z.string().optional(),
  checks: z.array(RecipeCheckSchema).default([]),
  dev_server: z
    .object({
      run: z.string(),
      ready_path: z.string().default("/"),
      timeout_sec: z.number().int().positive().default(120),
    })
    .optional(),
  services: z
    .object({
      postgres: z.object({ database: z.string() }).optional(),
    })
    .default({}),
  env_file: z.string().optional(),
  system_deps: z.array(z.string()).default([]),
  warm: z.array(z.string()).default([]),
  os: z.array(OsSchema).optional(),
  ui_paths: z.array(z.string()).default(DEFAULT_UI_PATHS),
});

export type Recipe = z.infer<typeof RecipeSchema>;
export type RecipeCheck = z.infer<typeof RecipeCheckSchema>;

export function parseRecipeYaml(text: string): Recipe {
  return RecipeSchema.parse(parseYaml(text) ?? {});
}

/** Replace `$FOUNDRY_*` placeholders used in recipe commands, e.g. `--port $FOUNDRY_PORT`. */
export function expandRecipeVars(value: string, vars: Record<string, string>): string {
  return value.replace(/\$\{?(FOUNDRY_[A-Z_]+)\}?/g, (m, name: string) => vars[name] ?? m);
}
