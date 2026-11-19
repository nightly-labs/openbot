import { describe, expect, test } from "bun:test";
import { remoteDesktopTargets, runtimeTarget, runtimeTargetParts } from "./remote-desktop-runtime-release";

describe("remote desktop release targets", () => {
  test("Linux ARM64 is supported by the same runtime packaging as Linux x64", () => {
    expect(remoteDesktopTargets).toContain("linux-arm64");
    expect(runtimeTarget("linux", "arm64")).toBe("linux-arm64");
    expect(runtimeTargetParts("linux-arm64")).toEqual({ platform: "linux", architecture: "arm64" });
  });

  test("all release targets have reversible platform and architecture mapping", () => {
    for (const target of remoteDesktopTargets) {
      const parts = runtimeTargetParts(target);
      expect(runtimeTarget(parts.platform, parts.architecture)).toBe(target);
    }
  });
});
