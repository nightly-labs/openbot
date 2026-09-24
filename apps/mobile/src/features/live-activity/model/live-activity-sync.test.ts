import { describe, expect, it, vi } from "vitest";
import { LIVE_ACTIVITY_URL } from "./live-activity-link";
import { type LiveActivityInstance, type LiveActivityStarter, LiveActivitySync } from "./live-activity-sync";

describe("LiveActivitySync", () => {
  it("starts one activity, updates it only when the state changes, and ends it when nothing needs the user", async () => {
    const activity = instance();
    const starter = fakeStarter([], () => activity);
    const sync = new LiveActivitySync<{ title: string }>(starter);

    await sync.show({ title: "Working" });
    await sync.show({ title: "Working" });
    await sync.show({ title: "Approval" });
    await sync.show(null);

    expect(starter.start).toHaveBeenCalledTimes(1);
    expect(starter.start).toHaveBeenCalledWith({ title: "Working" }, LIVE_ACTIVITY_URL, undefined);
    expect(activity.update).toHaveBeenCalledTimes(1);
    expect(activity.update).toHaveBeenCalledWith({ title: "Approval" }, undefined);
    expect(activity.end).toHaveBeenCalledWith("immediate");
  });

  it("updates the activity from an earlier launch and ends the others", async () => {
    const current = instance();
    const extra = instance();
    const starter = fakeStarter([current, extra], () => instance());
    const sync = new LiveActivitySync<{ title: string }>(starter);
    const staleDate = new Date("2026-09-24T10:05:00.000Z");

    await sync.show({ title: "Working" }, staleDate);

    expect(extra.end).toHaveBeenCalledWith("immediate");
    expect(current.update).toHaveBeenCalledWith({ title: "Working" }, staleDate);
    expect(starter.start).not.toHaveBeenCalled();
  });

  it("tries again on the next state when iOS refuses to start an activity", async () => {
    const activity = instance();
    const starter = fakeStarter([], () => activity);
    starter.start.mockImplementationOnce(() => {
      throw new Error("Live Activities are disabled.");
    });
    const sync = new LiveActivitySync<{ title: string }>(starter);

    await sync.show({ title: "Working" });
    await sync.show({ title: "Working" });

    expect(starter.start).toHaveBeenCalledTimes(2);
  });

  it("starts a new activity when the user dismissed the previous one", async () => {
    const dismissed = instance();
    dismissed.update.mockRejectedValue(new Error("Live Activity not found."));
    const replacement = instance();
    const starter = fakeStarter([dismissed], () => replacement);
    const sync = new LiveActivitySync<{ title: string }>(starter);

    await sync.show({ title: "Working" });
    await sync.show({ title: "Approval" });

    expect(starter.start).toHaveBeenCalledWith({ title: "Approval" }, LIVE_ACTIVITY_URL, undefined);
  });
});

function instance() {
  return {
    update: vi.fn<LiveActivityInstance<{ title: string }>["update"]>(async () => undefined),
    end: vi.fn<LiveActivityInstance<{ title: string }>["end"]>(async () => undefined),
  };
}

function fakeStarter(
  instances: LiveActivityInstance<{ title: string }>[],
  create: () => LiveActivityInstance<{ title: string }>,
) {
  return {
    start: vi.fn<LiveActivityStarter<{ title: string }>["start"]>(create),
    getInstances: () => instances,
  };
}
