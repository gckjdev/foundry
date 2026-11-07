import { describe, expect, it } from "vitest";
import { combineCi, signWebhookPayload, verifyWebhookSignature } from "./index";

describe("webhook signature", () => {
  it("accepts a valid signature and rejects others", async () => {
    const body = JSON.stringify({ hello: "world" });
    const sig = await signWebhookPayload("s3cret", body);
    expect(await verifyWebhookSignature("s3cret", body, sig)).toBe(true);
    expect(await verifyWebhookSignature("wrong", body, sig)).toBe(false);
    expect(await verifyWebhookSignature("s3cret", body, null)).toBe(false);
    expect(await verifyWebhookSignature("s3cret", body, "garbage")).toBe(false);
  });
});

describe("combineCi", () => {
  it("reports none, pending, failure and success", () => {
    expect(combineCi([], [])).toBe("none");
    expect(combineCi([{ name: "test", status: "in_progress", conclusion: null }], [])).toBe("pending");
    expect(combineCi([{ name: "test", status: "completed", conclusion: "failure" }], [])).toBe("failure");
    expect(
      combineCi(
        [{ name: "test", status: "completed", conclusion: "success" }],
        [{ context: "lint", state: "success" }],
      ),
    ).toBe("success");
  });
  it("treats a missing required check as pending", () => {
    expect(combineCi([{ name: "test", status: "completed", conclusion: "success" }], [], ["e2e"])).toBe(
      "pending",
    );
  });
});
