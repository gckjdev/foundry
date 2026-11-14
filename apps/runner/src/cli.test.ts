import { describe, expect, it } from "vitest";
import { joinDeniedMessage } from "./cli";

describe("joinDeniedMessage", () => {
  it("points at a fresh token when the join is rejected", () => {
    expect(joinDeniedMessage("join token expired", "http://localhost:3000/")).toBe(
      "join token expired. Create a new join token on the Runners page (http://localhost:3000/runners) and run this command again.",
    );
  });
});
