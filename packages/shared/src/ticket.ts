export const TRIGGER_LABEL = "foundry";
export const HARNESS_IDS = ["claude-code", "opencode"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export interface LabelOverrides {
  triggered: boolean;
  harness?: HarnessId;
  model?: string;
  runner?: string;
  playbook?: string;
}

export function parseLabels(labels: string[]): LabelOverrides {
  const out: LabelOverrides = { triggered: labels.includes(TRIGGER_LABEL) };
  for (const label of labels) {
    const [key, ...rest] = label.split(":");
    const value = rest.join(":").trim();
    if (!value) continue;
    switch (key) {
      case "harness":
        if ((HARNESS_IDS as readonly string[]).includes(value)) out.harness = value as HarnessId;
        break;
      case "model":
        out.model = value;
        break;
      case "runner":
        out.runner = value;
        break;
      case "playbook":
        out.playbook = value;
        break;
    }
  }
  return out;
}

export interface TicketSections {
  goal?: string;
  acceptanceCriteria?: string;
  constraints?: string;
  outOfScope?: string;
}

const SECTION_KEYS: Record<string, keyof TicketSections> = {
  goal: "goal",
  "acceptance criteria": "acceptanceCriteria",
  constraints: "constraints",
  "out of scope": "outOfScope",
};

/** Parse the issue-form body (`### Goal\n\n...`). Empty answers render as `_No response_`. */
export function parseTicketSections(body: string): TicketSections {
  const out: TicketSections = {};
  const parts = body.split(/^#{2,3}\s+/m);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    if (nl < 0) continue;
    const key = SECTION_KEYS[part.slice(0, nl).trim().toLowerCase()];
    const value = part.slice(nl + 1).trim();
    if (key && value && value !== "_No response_") out[key] = value;
  }
  return out;
}

/** Sections the triage stage should ask about when missing. */
export function missingTicketSections(body: string): (keyof TicketSections)[] {
  const s = parseTicketSections(body);
  const missing: (keyof TicketSections)[] = [];
  if (!s.goal && body.trim().length < 40) missing.push("goal");
  if (!s.acceptanceCriteria) missing.push("acceptanceCriteria");
  return missing;
}

export function jobBranchName(jobId: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `foundry/${jobId.slice(0, 8)}-${slug || "job"}`;
}
