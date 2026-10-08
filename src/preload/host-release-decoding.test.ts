import { describe, expect, it } from "vitest";
import { decodeHostReleaseStatusFromMain } from "./host-release-decoding";

const status = { currentVersion: "0.25.2", latestVersion: "0.26.0", phase: "available", method: "hosted" };
describe("release status from main", () => {
  it("accepts a release result", () => {
    expect(decodeHostReleaseStatusFromMain(status)).toEqual(status);
  });
  it.each([
    { ...status, phase: "install-now" },
    { ...status, method: "execute-command" },
    { ...status, latestVersion: 26 },
    { ...status, currentVersion: "x".repeat(65) },
    null,
    { currentVersion: "0.25.2" },
  ])("rejects malformed status %j", (value) => {
    expect(() => decodeHostReleaseStatusFromMain(value)).toThrow();
  });
});
