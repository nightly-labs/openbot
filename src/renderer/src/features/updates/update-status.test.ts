import type { UpdateFailureCode, UpdateStatus } from "@openbot/contracts/ipc";
import { presentUpdateStatus } from "@openbot/ui/features/updates/update-status";
import { describe, expect, it } from "vitest";

function status(patch: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    phase: "idle",
    currentVersion: "0.4.2",
    availableVersion: null,
    progress: null,
    checkedAt: null,
    message: null,
    errorCode: null,
    ...patch,
  };
}

describe("presentUpdateStatus", () => {
  it.each([
    ["idle", "Check for updates", false],
    ["checking", "Checking for updates…", true],
    ["available", "Download update", false],
    ["downloading", "Downloading update…", true],
    ["ready", "Restart to update", false],
    ["installing", "Restarting…", true],
    ["up-to-date", "Check for updates", false],
  ] as const)("labels the %s phase", (phase, actionLabel, busy) => {
    const presentation = presentUpdateStatus(status({ phase }));
    expect(presentation.actionLabel).toBe(actionLabel);
    expect(presentation.busy).toBe(busy);
  });

  it.each([
    // A download is retryable in place. An install is not: shutdown preparation has already run, so
    // the message asks for a relaunch and the action falls back to checking rather than inviting a
    // second teardown.
    ["download_failed", "Retry download"],
    ["install_failed", "Check for updates"],
    ["check_failed", "Check for updates"],
  ] as const satisfies readonly (readonly [UpdateFailureCode, string])[])(
    "offers the right action after %s",
    (errorCode, actionLabel) => {
      const presentation = presentUpdateStatus(status({ phase: "error", errorCode }));
      expect(presentation.actionLabel).toBe(actionLabel);
      expect(presentation.busy).toBe(false);
      expect(presentation.supported).toBe(true);
    },
  );

  it("reports an unsupported build as unsupported", () => {
    expect(presentUpdateStatus(status({ phase: "unsupported" })).supported).toBe(false);
  });

  it("names host management instead of an action on a managed host", () => {
    for (const phase of ["available", "ready"] as const) {
      const presentation = presentUpdateStatus(status({ phase, managedByHost: true }));
      expect(presentation.managed).toBe(true);
      expect(presentation.actionLabel).toBe("Managed by host");
      expect(presentation.available).toBe(true);
    }
    expect(presentUpdateStatus(status({ phase: "ready" })).managed).toBe(false);
  });

  it("shows download progress and otherwise the relevant version", () => {
    expect(presentUpdateStatus(status({ phase: "downloading", progress: 42.4 })).detail).toBe("42%");
    expect(presentUpdateStatus(status({ phase: "available", availableVersion: "0.4.3" })).detail).toBe("v0.4.3");
    expect(presentUpdateStatus(status({ phase: "up-to-date" })).detail).toBe("Up to date");
    expect(presentUpdateStatus(status({ phase: "idle" })).detail).toBe("v0.4.2");
  });
});
