import { TEST_DATABASE_URL } from "@foundry/db/testing";
import { FakeHarness } from "@foundry/harness-core";
import { afterEach, describe, expect, it } from "vitest";
import { createE2E, type E2E, labeledIssue } from "./harness";

const RECIPE = `
checks:
  - name: marker
    run: test -f done.txt
`;

describe.skipIf(!TEST_DATABASE_URL)("in-process job e2e", () => {
  let world: E2E | undefined;

  afterEach(async () => {
    await world?.close();
    world = undefined;
  });

  it("labels an issue, joins a runner, and queues the job", async () => {
    world = await createE2E({ recipe: RECIPE });
    world.gh.addIssue("acme/app", { number: 1, title: "Add done.txt", labels: ["foundry"] });
    await world.deliver("issues", labeledIssue(1, "Add done.txt"));
    const job = await world.job();
    expect(job.status).toBe("queued");
    expect(job.issueNumber).toBe(1);

    const { runnerId } = await world.startRunner({
      name: "mac",
      os: "macos",
      harness: new FakeHarness("claude-code", []),
    });
    const runner = await world.ctx.db.query.runners.findFirst();
    expect(runner?.id).toBe(runnerId);
    expect(runner?.name).toBe("mac");
  });
});
