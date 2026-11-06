import { describe, expect, it } from "vitest";
import { activityStartedAt, type RenderedAgentActivity, withActivityDetail } from "./activity-store";

const activity: RenderedAgentActivity = {
  activityId: "agent-1:turn:turn-1",
  agent: undefined,
  detail: "curl 1%",
  since: 1_000,
  phase: "active",
  label: "Working on it…",
};

describe("activityStartedAt", () => {
  it("keeps the start of the same activity when its detail changes", () => {
    expect(activityStartedAt(activity, activity.activityId, 9_000)).toBe(1_000);
  });

  it("starts a new clock for another activity", () => {
    expect(activityStartedAt(activity, "agent-1:turn:turn-2", 9_000)).toBe(9_000);
  });
});

describe("withActivityDetail", () => {
  it("changes the detail without restarting the clock", () => {
    const next = withActivityDetail(activity, activity.activityId, "curl 2%");
    expect(next?.detail).toBe("curl 2%");
    expect(next?.since).toBe(1_000);
  });

  it("keeps the value when the detail is the same", () => {
    expect(withActivityDetail(activity, activity.activityId, "curl 1%")).toBe(activity);
  });
});
