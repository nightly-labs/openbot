import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { adminTokenMatches } from "../src/server/admin-token";

const matches = (expected: string | undefined, provided: string | null) =>
  Effect.runPromise(adminTokenMatches(expected, provided));

describe("admin token", () => {
  it("accepts only the configured token", async () => {
    expect(await matches("admin-secret", "admin-secret")).toBe(true);
    expect(await matches("admin-secret", "admin-secreT")).toBe(false);
    expect(await matches("admin-secret", "admin")).toBe(false);
    expect(await matches("admin-secret", null)).toBe(false);
  });

  it("refuses every token when none is configured", async () => {
    expect(await matches(undefined, "admin-secret")).toBe(false);
    expect(await matches("", "")).toBe(false);
  });
});
