import type { AgentProviderStatus, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  type ProviderUpdate,
  presentProviderUpdate,
  providerSystemCliVersion,
  providerUpdatesToAnnounce,
  providerVersionLabel,
} from "./provider-update";

function runtime(patch: Partial<ProviderRuntimeStatus> = {}): ProviderRuntimeStatus {
  return { phase: "ready", progress: null, message: null, version: "2.1.246", ...patch };
}

function update(patch: Partial<ProviderUpdate> = {}): ProviderUpdate {
  return { provider: "claude", name: "Claude", runtime: runtime(), availableVersion: "2.1.250", ...patch };
}

describe("presentProviderUpdate", () => {
  it.each([
    ["ready", "Update", false],
    ["downloading", undefined, true],
    ["finishing", undefined, true],
    ["download-error", "Retry", false],
    ["not-downloaded", undefined, false],
  ] as const satisfies readonly (readonly [ProviderRuntimeStatus["phase"], string | undefined, boolean])[])(
    "offers the right action in the %s phase",
    (phase, actionLabel, busy) => {
      const presentation = presentProviderUpdate(
        update({ runtime: runtime({ phase, version: phase === "not-downloaded" ? null : "2.1.246" }) }),
      );
      expect(presentation.actionLabel).toBe(actionLabel);
      expect(presentation.busy).toBe(busy);
    },
  );

  it("offers nothing when the installed version is already the available one", () => {
    const presentation = presentProviderUpdate(update({ availableVersion: "2.1.246" }));
    expect(presentation.updatable).toBe(false);
    expect(presentation.actionLabel).toBeUndefined();
    expect(presentation.title).toBe("Claude is up to date");
  });

  it("names both versions in the offer, and the outcome afterwards", () => {
    expect(presentProviderUpdate(update()).detail).toBe("v2.1.246 → v2.1.250");
    expect(presentProviderUpdate(update()).title).toBe("Claude update available");
    expect(presentProviderUpdate(update({ availableVersion: "2.1.246" })).detail).toBe("v2.1.246");
  });

  it("explains a provider update failure without displaying the download path", () => {
    const failed = presentProviderUpdate(
      update({ runtime: runtime({ phase: "download-error", message: "ENOSPC: write '/private/provider.zip'" }) }),
    );
    expect(failed.detail).toBe(
      "There is not enough storage space. Free some space on the computer running OpenBot, then try again.",
    );
  });

  it("reports progress while the update runs, and the reason when it fails", () => {
    const running = presentProviderUpdate(update({ runtime: runtime({ phase: "downloading", progress: 42.4 }) }));
    expect(running.progress).toBe(42);
    expect(running.detail).toBe("v2.1.246 → v2.1.250");
    expect(presentProviderUpdate(update({ runtime: runtime({ phase: "downloading" }) })).title).toBe("Updating Claude");
    expect(presentProviderUpdate(update({ runtime: runtime({ phase: "finishing" }) })).progress).toBeNull();
    expect(presentProviderUpdate(update({ runtime: runtime({ phase: "finishing" }) })).detail).toBe("Setting up");

    const failed = presentProviderUpdate(
      update({ runtime: runtime({ phase: "download-error", message: "The connection was lost." }) }),
    );
    expect(failed.failed).toBe(true);
    expect(failed.title).toBe("Claude update failed");
    expect(failed.detail).toBe("The connection was lost.");
  });
});

describe("providerVersionLabel", () => {
  it("names the installed version, and keeps naming it while an update is offered", () => {
    expect(providerVersionLabel(runtime())).toBe("v2.1.246");
    expect(providerVersionLabel(runtime({ version: "v2.1.246" }))).toBe("v2.1.246");
  });

  it("says nothing for a runtime that reports no version", () => {
    expect(providerVersionLabel(runtime({ phase: "not-downloaded", version: null }))).toBeNull();
  });
});

describe("providerUpdatesToAnnounce", () => {
  const offered = update();

  it("announces a provider that has just become updatable", () => {
    const before = update({ runtime: runtime({ phase: "not-downloaded", version: null }) });
    expect(providerUpdatesToAnnounce([before], [offered])).toEqual([offered]);
  });

  it("stays silent while the same offer keeps arriving", () => {
    expect(providerUpdatesToAnnounce([offered], [offered])).toEqual([]);
  });

  it("announces again once a newer version is offered", () => {
    const newer = update({ availableVersion: "2.1.260" });
    expect(providerUpdatesToAnnounce([offered], [newer])).toEqual([newer]);
  });

  it("says nothing about a provider that is up to date or busy", () => {
    const current = update({ availableVersion: "2.1.246" });
    const downloading = update({ runtime: runtime({ phase: "downloading", progress: 10 }) });
    expect(providerUpdatesToAnnounce([], [current, downloading])).toEqual([]);
  });
});

describe("providerSystemCliVersion", () => {
  function row(patch: Partial<AgentProviderStatus> = {}): AgentProviderStatus {
    return { id: "claude", state: "available", version: "2.1.246", message: null, ...patch };
  }

  it("names the version of a CLI the user installed", () => {
    expect(providerSystemCliVersion(row({ cliSource: "system" }))).toBe("2.1.246");
    expect(providerSystemCliVersion(row({ cliSource: "system", version: null }))).toBeNull();
  });

  it("waits for the answer while no resolution has reported one", () => {
    expect(providerSystemCliVersion(undefined)).toBeUndefined();
    expect(providerSystemCliVersion(row({ state: "not-started", version: null }))).toBeUndefined();
    expect(providerSystemCliVersion(row({ state: "checking", version: null }))).toBeUndefined();
  });

  it("keeps the owner a re-check of a resolved provider still names", () => {
    expect(providerSystemCliVersion(row({ state: "checking", cliSource: "system" }))).toBe("2.1.246");
    expect(providerSystemCliVersion(row({ state: "checking", cliSource: "managed" }))).toBeNull();
  });

  it("answers the managed copy for a provider whose CLI could not be resolved", () => {
    // Nothing resolved, so the row names no owner - and that is an answer, not a wait: an app
    // upgrade that pins a newer runtime leaves exactly this state, with the previous managed binary
    // on disk and the new one still to download. The offer that downloads it is the way out.
    expect(providerSystemCliVersion(row({ state: "not-installed", version: null }))).toBeNull();
    expect(providerSystemCliVersion(row({ state: "error", version: null }))).toBeNull();
    expect(providerSystemCliVersion(row({ state: "outdated" }))).toBeNull();
  });
});
