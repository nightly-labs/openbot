import { describe, expect, it } from "vitest";
import { STOP_TASK_TOOL, stopTaskToolSchema } from "./agent-tasks";

describe("stop_task tool", () => {
  it("is named stop_task", () => {
    expect(STOP_TASK_TOOL).toBe("stop_task");
  });

  it("takes a task id and an optional reason", () => {
    expect(stopTaskToolSchema.parse({ taskId: "task-1" })).toEqual({ taskId: "task-1" });
    expect(stopTaskToolSchema.parse({ taskId: "task-1", reason: "user dropped it" })).toEqual({
      taskId: "task-1",
      reason: "user dropped it",
    });
  });

  it("refuses an empty task id and unknown fields", () => {
    expect(() => stopTaskToolSchema.parse({ taskId: "" })).toThrow();
    expect(() => stopTaskToolSchema.parse({ taskId: "task-1", agentId: "another" })).toThrow();
  });
});
