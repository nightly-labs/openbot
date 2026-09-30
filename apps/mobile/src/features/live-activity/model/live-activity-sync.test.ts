import { describe, expect, it, vi } from "vitest";
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
    expect(starter.start).toHaveBeenCalledWith({ title: "Working" }, undefined);
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

  it("starts a new activity when the user or the host ended the previous one", async () => {
    const ended = instance();
    ended.update.mockRejectedValue(new Error("Live Activity not found."));
    const replacement = instance();
    const starter = fakeStarter([ended], () => replacement);
    const sync = new LiveActivitySync<{ title: string }>(starter);

    await sync.show({ title: "Working" });

    expect(starter.start).toHaveBeenCalledWith({ title: "Working" }, undefined);
  });

  it("gives the push token of the activity it shows, so only that activity gets host updates", async () => {
    const activity = instance("token-1");
    const tokens = vi.fn<(token: string | null) => void>();
    const sync = new LiveActivitySync<{ title: string }>(
      fakeStarter([], () => activity),
      tokens,
    );

    await sync.show({ title: "Working" });
    expect(tokens).toHaveBeenLastCalledWith("token-1");
    await sync.show(null);
    expect(tokens).toHaveBeenLastCalledWith(null);
  });

  it("shows the app state again after the host changed the activity", async () => {
    const activity = instance();
    const sync = new LiveActivitySync<{ title: string }>(fakeStarter([], () => activity));

    await sync.show({ title: "Working" });
    sync.forget();
    await sync.show({ title: "Working" });

    expect(activity.update).toHaveBeenCalledWith({ title: "Working" }, undefined);
  });
});

function instance(token?: string) {
  return {
    update: vi.fn<LiveActivityInstance<{ title: string }>["update"]>(async () => undefined),
    end: vi.fn<LiveActivityInstance<{ title: string }>["end"]>(async () => undefined),
    watchPushToken(receive: (token: string) => void) {
      if (token) receive(token);
      return () => undefined;
    },
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
