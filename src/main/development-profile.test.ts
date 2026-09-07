import { describe, expect, it } from "vitest";
import {
  developmentInstanceIdForWorktree,
  developmentUserDataName,
  readDevelopmentInstanceId,
  readDevelopmentProfile,
  readDevelopmentRemoteDebuggingPort,
  shouldAutoStartHost,
  shouldShowDevelopmentWindow,
} from "./development-profile";

describe("development profile", () => {
  it("uses a separate userData folder for the test client", () => {
    expect(developmentUserDataName(readDevelopmentProfile("test-client"))).toBe("OpenBot Dev Test Client");
    expect(developmentUserDataName(readDevelopmentProfile("app"))).toBe("OpenBot Dev");
  });

  it("does not accept an arbitrary profile as a path component", () => {
    expect(readDevelopmentProfile("../../other")).toBe("app");
    expect(readDevelopmentInstanceId("../../other")).toBeNull();
    expect(readDevelopmentInstanceId("wt-../../other")).toBeNull();
    expect(readDevelopmentInstanceId("wt-short")).toBeNull();
  });

  it("isolates a fallback dev instance without accepting arbitrary path content", () => {
    expect(readDevelopmentInstanceId("5174")).toBe("5174");
    expect(developmentUserDataName("app", "5174")).toBe("OpenBot Dev 5174");
  });

  it("keeps an isolated worktree on one profile whichever port it wins", () => {
    const instanceId = developmentInstanceIdForWorktree("/worktrees/openbot-191");

    // These paths collided under the old five-digit hash.
    expect(developmentInstanceIdForWorktree("/worktrees/openbot-191")).toBe(instanceId);
    expect(developmentInstanceIdForWorktree("/worktrees/openbot-356")).not.toBe(instanceId);
    expect(instanceId).not.toBe("22200");
    expect(readDevelopmentInstanceId(instanceId)).toBe(instanceId);
    expect(developmentUserDataName("app", instanceId)).toBe(`OpenBot Dev ${instanceId}`);
  });

  it("only accepts a remote-debugging port inside the range automation connects to", () => {
    expect(readDevelopmentRemoteDebuggingPort("9333")).toBe("9333");
    expect(readDevelopmentRemoteDebuggingPort(" 9333 ")).toBe("9333");
    expect(readDevelopmentRemoteDebuggingPort("0000")).toBeNull();
    expect(readDevelopmentRemoteDebuggingPort("99999")).toBeNull();
    expect(readDevelopmentRemoteDebuggingPort("80")).toBeNull();
    expect(readDevelopmentRemoteDebuggingPort(undefined)).toBeNull();
  });

  it.each([undefined, null, "host"] as const)("restores published hosting after restart for role %s", (remoteRole) => {
    expect(
      shouldAutoStartHost({
        configured: true,
        enabledOnLaunch: true,
        remoteRole,
      }),
    ).toBe(true);
    expect(
      shouldAutoStartHost({
        configured: true,
        enabledOnLaunch: false,
        remoteRole,
      }),
    ).toBe(false);
    expect(shouldAutoStartHost({ configured: false, enabledOnLaunch: true, remoteRole })).toBe(false);
  });

  it("does not publish the development test client even with a saved hosting preference", () => {
    expect(shouldAutoStartHost({ configured: true, enabledOnLaunch: true, remoteRole: "client" })).toBe(false);
  });

  it("hides the host window only in the two-client development harness", () => {
    expect(shouldShowDevelopmentWindow({ remoteRole: "host", testClientEnabled: false })).toBe(true);
    expect(shouldShowDevelopmentWindow({ remoteRole: "host", testClientEnabled: true })).toBe(false);
    expect(shouldShowDevelopmentWindow({ remoteRole: "client", testClientEnabled: true })).toBe(true);
    expect(shouldShowDevelopmentWindow({ remoteRole: null, testClientEnabled: false })).toBe(true);
  });
});
