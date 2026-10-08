import type { AgentMessage, ChatActionMarkerModel, RoutineRunMarkerModel } from "@openbot/ui/data";
import { describe, expect, it } from "vitest";
import { groupRoutineRunMarkers, summarizeRoutineRunMessages } from "./routine-run-timeline";

describe("summarizeRoutineRunMessages", () => {
  it("keeps a run with one state unchanged", () => {
    const queued = routineMessage("queued", "run-1");

    expect(summarizeRoutineRunMessages([queued])).toEqual([queued]);
  });

  it.each(["succeeded", "failed", "interrupted", "cancelled"] as const)(
    "shows one %s summary in place of the routine instruction",
    (terminalStatus) => {
      const instruction = routineMessage("queued", "run-1", true);
      const running = routineMessage("running", "run-1");
      const terminal = routineMessage(terminalStatus, "run-1");

      const result = summarizeRoutineRunMessages([instruction, running, terminal]);

      expect(result).toHaveLength(1);
      expect(result[0]?.actionMarker).toMatchObject({
        kind: "routine-run",
        status: terminalStatus,
        previousTransitions: [
          { status: "queued", timestamp: "2026-09-01T08:00:00.000Z" },
          { status: "running", timestamp: "2026-09-01T08:01:00.000Z" },
        ],
      });
    },
  );

  it("keeps separate runs independent when more history is loaded", () => {
    const result = summarizeRoutineRunMessages([
      routineMessage("queued", "run-1"),
      routineMessage("succeeded", "run-1"),
      routineMessage("running", "run-2"),
    ]);

    expect(result.map((message) => message.actionMarker)).toMatchObject([
      { kind: "routine-run", runId: "run-1", status: "succeeded" },
      { kind: "routine-run", runId: "run-2", status: "running" },
    ]);
  });

  it("preserves attention and resume transitions in order", () => {
    const result = summarizeRoutineRunMessages([
      routineMessage("running", "run-1"),
      routineMessage("needs-attention", "run-1"),
      routineMessage("running", "run-1"),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.actionMarker).toMatchObject({
      status: "running",
      previousTransitions: [{ status: "running" }, { status: "needs-attention" }],
    });
  });
});

describe("groupRoutineRunMarkers", () => {
  it("joins consecutive completed runs of one routine into one row", () => {
    const runs = [completedRun(1), completedRun(2), completedRun(3, { routineName: "Watchdog v2" })];

    const result = groupRoutineRunMarkers(runs);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("run-1");
    expect(result[0]?.actionMarker).toEqual({
      kind: "routine-run-group",
      routineId: "routine-watch",
      routineName: "Watchdog v2",
      runs: runs.map((run) => ({ id: run.id, marker: run.actionMarker })),
      timestamp: "2026-09-01T17:45:00.000Z",
    });
  });

  it("keeps a single completed run unchanged", () => {
    const run = completedRun(1);

    expect(groupRoutineRunMarkers([run])).toEqual([run]);
  });

  it("stops a group at a message between runs", () => {
    const reply: AgentMessage = { id: "reply", author: "agent", body: "All good", time: "17:16" };

    const result = groupRoutineRunMarkers([completedRun(1), completedRun(2), reply, completedRun(3), completedRun(4)]);

    expect(result.map((message) => [message.id, message.actionMarker?.kind])).toEqual([
      ["run-1", "routine-run-group"],
      ["reply", undefined],
      ["run-3", "routine-run-group"],
    ]);
  });

  it("stops a group at a run of another routine", () => {
    const result = groupRoutineRunMarkers([
      completedRun(1),
      completedRun(2),
      completedRun(3, { routineId: "routine-mail", routineName: "Mail" }),
    ]);

    expect(result.map((message) => [message.id, message.actionMarker?.kind])).toEqual([
      ["run-1", "routine-run-group"],
      ["run-3", "routine-run"],
    ]);
  });

  it.each(["failed", "interrupted", "cancelled", "needs-attention", "running"] as const)(
    "keeps a %s run in a row of its own between groups",
    (status) => {
      const result = groupRoutineRunMarkers([
        completedRun(1),
        completedRun(2),
        completedRun(3, { status }),
        completedRun(4),
        completedRun(5),
      ]);

      expect(result.map((message) => [message.id, message.actionMarker?.kind])).toEqual([
        ["run-1", "routine-run-group"],
        ["run-3", "routine-run"],
        ["run-4", "routine-run-group"],
      ]);
    },
  );

  it("keeps the row id of the first run when a new run joins", () => {
    const before = groupRoutineRunMarkers([completedRun(1), completedRun(2)]);
    const after = groupRoutineRunMarkers([completedRun(1), completedRun(2), completedRun(3)]);

    expect(after.map((message) => message.id)).toEqual(before.map((message) => message.id));
    expect(after[0]?.actionMarker).toMatchObject({ kind: "routine-run-group", runs: { length: 3 } });
  });

  it("stops a group at the first unread run", () => {
    const result = groupRoutineRunMarkers(
      [completedRun(1), completedRun(2), completedRun(3), completedRun(4)],
      "run-3",
    );

    expect(result.map((message) => message.id)).toEqual(["run-1", "run-3"]);
  });
});

function completedRun(
  index: number,
  overrides: Partial<Pick<RoutineRunMarkerModel, "routineId" | "routineName" | "status">> = {},
): AgentMessage & { actionMarker: RoutineRunMarkerModel } {
  const timestamp = new Date(Date.UTC(2026, 8, 1, 17, 15 + (index - 1) * 15)).toISOString();
  return {
    id: `run-${index}`,
    author: "agent",
    body: "Watchdog",
    time: timestamp.slice(11, 16),
    kind: "action-marker",
    actionMarker: {
      kind: "routine-run",
      sourceAgentId: "watcher",
      routineId: "routine-watch",
      runId: `run-${index}`,
      routineName: "Watchdog",
      status: "succeeded",
      timestamp,
      ...overrides,
    },
  };
}

function routineMessage(
  status: Extract<ChatActionMarkerModel, { kind: "routine-run" }>["status"],
  runId: string,
  withInstruction = false,
): AgentMessage {
  const minute = status === "queued" ? "00" : status === "running" ? "01" : "02";
  return {
    id: `${runId}-${status}-${minute}`,
    author: withInstruction ? "you" : "agent",
    body: withInstruction ? "Prepare the morning brief." : "Morning brief",
    time: `08:${minute}`,
    kind: "action-marker",
    ...(withInstruction
      ? {
          routine: {
            routineId: "routine-1",
            runId,
            name: "Morning brief",
            scheduledFor: "2026-09-01T08:00:00.000Z",
          },
        }
      : {}),
    actionMarker: {
      kind: "routine-run",
      sourceAgentId: "chief",
      routineId: "routine-1",
      runId,
      routineName: "Morning brief",
      status,
      timestamp: `2026-09-01T08:${minute}:00.000Z`,
    },
  };
}
