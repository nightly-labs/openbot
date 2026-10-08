import { Effect } from "effect";

import { UpdateOperationFailure } from "./update-service";
// @vitest-environment node

import { EventEmitter } from "node:events";
import type { ScheduledUpdateRestart, UpdatePreference, UpdateStatus } from "@openbot/contracts/ipc";
import type { HostRestartState } from "@openbot/contracts/team-protocol/host-update-v1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { RequestedUpdate, RequestedUpdateRefusal } from "./requested-update";
import type { RestartReadiness } from "./update-readiness";

const ADA = { id: "member-ada", name: "Ada" };

class FakeUpdater extends EventEmitter<{ status: [UpdateStatus] }> {
  status: UpdateStatus = {
    phase: "up-to-date",
    currentVersion: "0.24.0",
    availableVersion: null,
    progress: null,
    checkedAt: null,
    message: null,
    errorCode: null,
  };
  scheduled: ScheduledUpdateRestart | null = null;
  autoDownload = true;
  checkForUpdates = vi.fn((): Effect.Effect<UpdateStatus, UpdateOperationFailure> => Effect.succeed(this.status));
  downloadUpdate = vi.fn((): Effect.Effect<UpdateStatus, UpdateOperationFailure> => Effect.succeed(this.status));
  installUpdate = vi.fn(
    (): Effect.Effect<void, UpdateOperationFailure> =>
      Effect.sync(() => {
        this.set({ phase: "installing" });
      }),
  );

  getAutoDownload(): boolean {
    return this.autoDownload;
  }

  setAutoDownload(enabled: boolean): Effect.Effect<void> {
    return Effect.sync(() => {
      this.autoDownload = enabled;
    });
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  setScheduledRestart(restart: ScheduledUpdateRestart | null): void {
    this.scheduled = restart;
    this.emit("status", this.getStatus());
  }

  set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit("status", this.getStatus());
  }
}

let updater: FakeUpdater;
let readiness: RestartReadiness;
let requested: RequestedUpdate;

let stored: UpdatePreference;
let announce: ReturnType<typeof vi.fn<(state: HostRestartState, version: string | null) => void>>;

function create(preference: Partial<UpdatePreference> = {}) {
  stored = { autoDownload: true, allowRemoteUpdates: true, autoInstall: false, ...preference };
  requested = new RequestedUpdate({
    updater,
    describeReadiness: () => readiness,
    preference: stored,
    savePreference: (change) =>
      Effect.sync(() => {
        stored = { ...stored, ...change };
        return stored;
      }),
    log: () => undefined,
    announce,
    pollMs: 5_000,
    graceMs: 1_000,
  });
  return requested;
}

beforeEach(() => {
  vi.useFakeTimers();
  updater = new FakeUpdater();
  announce = vi.fn();
  readiness = { safeToRestart: true, reasons: [] };
});

afterEach(async () => {
  if (requested) await runCauseEffect(requested.dispose());
  vi.useRealTimers();
});

describe("RequestedUpdate", () => {
  it("keeps the current requester and restart mode after another member asks", async () => {
    updater.status = { ...updater.status, phase: "ready", availableVersion: "0.25.0" };
    await runCauseEffect(create().start(ADA, "now"));
    await runCauseEffect(requested.requestWhenIdle({ id: "member-other", name: "Other" }));
    expect(requested.snapshot().restart).toEqual({ requestedBy: "Ada", mode: "now", waitingFor: [] });
    requested.cancel();
    await runCauseEffect(requested.requestWhenIdle({ id: "member-other", name: "Other" }));
    expect(requested.snapshot().restart).toEqual({ requestedBy: "Other", mode: "when-idle", waitingFor: [] });
  });

  it("checks, downloads, waits for idle work, then installs", async () => {
    await runCauseEffect(create().requestWhenIdle(ADA));
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(updater.scheduled).toEqual({ requestedBy: "Ada", mode: "when-idle", waitingFor: [] });

    updater.set({ phase: "available", availableVersion: "0.25.0" });
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();

    readiness = { safeToRestart: false, reasons: ["agent-turn", "agent-turn", "routine-run"] };
    updater.set({ phase: "ready", progress: 100 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(updater.installUpdate).not.toHaveBeenCalled();
    expect(requested.snapshot().restart).toEqual({
      requestedBy: "Ada",
      mode: "when-idle",
      waitingFor: ["agent-turn", "routine-run"],
    });
    expect(updater.scheduled?.waitingFor).toEqual(["agent-turn", "routine-run"]);

    readiness = { safeToRestart: true, reasons: [] };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(updater.installUpdate).toHaveBeenCalledOnce();
    expect(requested.snapshot().phase).toBe("installing");
    // Every member is told before the host goes away.
    expect(announce.mock.calls).toEqual([
      ["waiting", null],
      ["waiting", "0.25.0"],
      ["restarting", "0.25.0"],
    ]);
  });

  it("restarts at ready without waiting when the admin asks for now", async () => {
    updater.status = { ...updater.status, phase: "ready", availableVersion: "0.25.0", progress: 100 };
    readiness = { safeToRestart: false, reasons: ["agent-turn"] };
    await runCauseEffect(create().start(ADA, "now"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(updater.installUpdate).toHaveBeenCalledOnce();
  });

  it("a second request with now skips the wait of the first", async () => {
    updater.status = { ...updater.status, phase: "ready", availableVersion: "0.25.0", progress: 100 };
    readiness = { safeToRestart: false, reasons: ["agent-turn"] };
    await runCauseEffect(create().start(ADA, "when-idle"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(updater.installUpdate).not.toHaveBeenCalled();
    await runCauseEffect(requested.start(ADA, "now"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(updater.installUpdate).toHaveBeenCalledOnce();
  });

  it("cancel stops a restart that waits, and is refused once the install runs", async () => {
    updater.status = { ...updater.status, phase: "ready", availableVersion: "0.25.0", progress: 100 };
    readiness = { safeToRestart: false, reasons: ["agent-turn"] };
    await runCauseEffect(create().start(ADA, "when-idle"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requested.cancel().restart).toBeNull();
    expect(updater.scheduled).toBeNull();
    expect(announce).toHaveBeenLastCalledWith("none", null);
    readiness = { safeToRestart: true, reasons: [] };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(updater.installUpdate).not.toHaveBeenCalled();

    updater.set({ phase: "installing" });
    expect(() => requested.cancel()).toThrow(RequestedUpdateRefusal);
  });

  it("refuses a cancel while the install checks for other sessions", async () => {
    updater.status = { ...updater.status, phase: "ready", availableVersion: "0.25.0", progress: 100 };
    let finishChecks: () => void = () => undefined;
    updater.installUpdate.mockImplementationOnce(() =>
      Effect.callback<void>((resume) => {
        finishChecks = () => {
          updater.set({ phase: "installing" });
          resume(Effect.void);
        };
      }),
    );
    await runCauseEffect(create().start(ADA, "now"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(updater.installUpdate).toHaveBeenCalledOnce();
    expect(() => requested.cancel()).toThrow(RequestedUpdateRefusal);
    expect(announce).toHaveBeenLastCalledWith("restarting", "0.25.0");
    finishChecks();
  });

  it("clears the schedule and reports install_failed when the install is refused", async () => {
    updater.status = { ...updater.status, phase: "ready", availableVersion: "0.25.0", progress: 100 };
    updater.installUpdate.mockReturnValueOnce(
      Effect.fail(new UpdateOperationFailure({ cause: new Error("Another OpenBot session is still running.") })),
    );
    await runCauseEffect(create().start(ADA, "now"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requested.snapshot()).toMatchObject({ phase: "ready", errorCode: "install_failed", restart: null });
    expect(updater.scheduled).toBeNull();
  });

  it("schedules nothing when the check finds no update", async () => {
    await runCauseEffect(create().start(ADA, "when-idle"));
    updater.set({ phase: "checking" });
    updater.set({ phase: "up-to-date" });
    expect(requested.snapshot().restart).toBeNull();
    expect(updater.scheduled).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(updater.installUpdate).not.toHaveBeenCalled();
  });

  it("refuses a managed host and a host whose user turned remote updates off", async () => {
    updater.status = { ...updater.status, managedByHost: true };
    await expect(runCauseEffect(create().start(ADA, "now"))).rejects.toMatchObject(
      expect.objectContaining({ reason: "managed" }),
    );
    expect(requested.snapshot().remoteUpdates).toBe("managed");
    await runCauseEffect(requested.dispose());

    updater.status = { ...updater.status, managedByHost: false };
    await expect(runCauseEffect(create({ allowRemoteUpdates: false }).check())).rejects.toMatchObject(
      expect.objectContaining({ reason: "disabled" }),
    );
    expect(requested.snapshot().remoteUpdates).toBe("disabled");
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("turning remote updates off removes a restart that waits", async () => {
    updater.status = { ...updater.status, phase: "ready", availableVersion: "0.25.0", progress: 100 };
    readiness = { safeToRestart: false, reasons: ["agent-turn"] };
    await runCauseEffect(create().start(ADA, "when-idle"));
    await runCauseEffect(requested.setPreference({ allowRemoteUpdates: false }));
    expect(updater.scheduled).toBeNull();
    readiness = { safeToRestart: true, reasons: [] };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(updater.installUpdate).not.toHaveBeenCalled();
  });
});

describe("RequestedUpdate automatic install", () => {
  it("downloads a new version and restarts into it once idle, with no request", async () => {
    updater.autoDownload = false;
    create({ autoDownload: false, autoInstall: true });
    updater.set({ phase: "available", availableVersion: "0.25.0" });
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();

    readiness = { safeToRestart: false, reasons: ["agent-turn"] };
    updater.set({ phase: "ready", progress: 100 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requested.snapshot().restart).toEqual({ requestedBy: null, mode: "when-idle", waitingFor: ["agent-turn"] });
    expect(updater.installUpdate).not.toHaveBeenCalled();

    readiness = { safeToRestart: true, reasons: [] };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(updater.installUpdate).toHaveBeenCalledOnce();
  });

  it("an admin turns it on remotely, and the ready update is scheduled at once", async () => {
    updater.status = { ...updater.status, phase: "ready", availableVersion: "0.25.0", progress: 100 };
    create();
    expect(requested.snapshot().restart).toBeNull();
    const snapshot = await runCauseEffect(requested.changeSettings({ autoInstall: true }));
    expect(stored.autoInstall).toBe(true);
    expect(snapshot).toMatchObject({ autoInstall: true, restart: { requestedBy: null } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(updater.installUpdate).toHaveBeenCalledOnce();
  });

  it("refuses a remote change when the host user turned remote updates off", async () => {
    create({ allowRemoteUpdates: false });
    await expect(runCauseEffect(requested.changeSettings({ autoInstall: true }))).rejects.toMatchObject({
      reason: "disabled",
    });
    expect(stored.autoInstall).toBe(false);
  });

  it("a cancelled automatic restart stays cancelled for that version only", async () => {
    updater.status = { ...updater.status, phase: "ready", availableVersion: "0.25.0", progress: 100 };
    readiness = { safeToRestart: false, reasons: ["agent-turn"] };
    create({ autoInstall: true });
    requested.cancel();
    updater.set({ phase: "ready" });
    readiness = { safeToRestart: true, reasons: [] };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(updater.installUpdate).not.toHaveBeenCalled();
    expect(requested.snapshot().restart).toBeNull();

    updater.set({ phase: "ready", availableVersion: "0.26.0" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(updater.installUpdate).toHaveBeenCalledOnce();
  });

  it("does not retry a failed automatic install for the same version", async () => {
    updater.status = { ...updater.status, phase: "ready", availableVersion: "0.25.0", progress: 100 };
    updater.installUpdate.mockReturnValue(
      Effect.fail(new UpdateOperationFailure({ cause: new Error("Another OpenBot session is still running.") })),
    );
    create({ autoInstall: true });
    await vi.advanceTimersByTimeAsync(1_000);
    updater.set({ phase: "ready" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(updater.installUpdate).toHaveBeenCalledOnce();
    expect(requested.snapshot()).toMatchObject({ errorCode: "install_failed", restart: null });
  });

  it("each switch removes only the restart it allowed", async () => {
    updater.status = { ...updater.status, phase: "ready", availableVersion: "0.25.0", progress: 100 };
    readiness = { safeToRestart: false, reasons: ["agent-turn"] };
    create({ autoInstall: true });
    await runCauseEffect(requested.setPreference({ allowRemoteUpdates: false }));
    expect(requested.snapshot().restart?.requestedBy).toBeNull();
    await runCauseEffect(requested.setPreference({ autoInstall: false }));
    expect(requested.snapshot().restart).toBeNull();

    await runCauseEffect(requested.setPreference({ allowRemoteUpdates: true }));
    await runCauseEffect(requested.start(ADA, "when-idle"));
    await runCauseEffect(requested.setPreference({ autoInstall: false }));
    expect(requested.snapshot().restart?.requestedBy).toBe("Ada");
  });
});
