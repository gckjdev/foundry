import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PortLeases } from "./ports";

describe("PortLeases", () => {
  it("lets two homes lease a free block without sharing ports.json", async () => {
    const root = mkdtempSync(join(tmpdir(), "foundry-ports-"));
    const a = new PortLeases(join(root, "a", "ports.json"));
    const b = new PortLeases(join(root, "b", "ports.json"));
    const portA = await a.lease("job-a");
    const portB = await b.lease("job-b");
    expect(portA).toBeGreaterThan(0);
    expect(portB).toBeGreaterThan(0);
    expect(a.get("job-b")).toBeNull();
    expect(b.get("job-a")).toBeNull();
  });
});
