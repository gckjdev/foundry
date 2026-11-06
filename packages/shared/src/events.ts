import { z } from "zod";
import { JobStatusSchema } from "./states";

export const EvidenceStatusSchema = z.enum(["passed", "failed", "skipped"]);

export const FoundryEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("stage_changed"),
    from: JobStatusSchema.nullable(),
    to: JobStatusSchema,
    reason: z.string().optional(),
  }),
  z.object({ kind: z.literal("subagent_started"), name: z.string() }),
  z.object({ kind: z.literal("tool_call"), tool: z.string(), summary: z.string().optional() }),
  z.object({
    kind: z.literal("usage"),
    model: z.string().optional(),
    tokensIn: z.number().int().nonnegative(),
    tokensOut: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  }),
  z.object({ kind: z.literal("message"), role: z.enum(["agent", "human", "system"]), text: z.string() }),
  z.object({ kind: z.literal("question"), questionId: z.string(), prompt: z.string() }),
  z.object({ kind: z.literal("answer"), questionId: z.string(), text: z.string(), by: z.string() }),
  z.object({ kind: z.literal("evidence"), name: z.string(), status: EvidenceStatusSchema }),
  z.object({
    kind: z.literal("log"),
    level: z.enum(["debug", "info", "warn", "error"]),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("resumed"),
    runnerId: z.string(),
    runnerName: z.string(),
    mode: z.enum(["sticky", "portable"]),
    harnessChanged: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("gate"),
    pass: z.boolean(),
    failed: z.array(z.object({ rule: z.string(), detail: z.string() })),
  }),
  z.object({ kind: z.literal("checkpoint"), stage: z.string(), briefRef: z.string() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);

export type FoundryEvent = z.infer<typeof FoundryEventSchema>;
export type FoundryEventKind = FoundryEvent["kind"];
