import { describe, expect, it } from "vitest";
import type { AgentMessage, ChatActionMarkerModel } from "../../data";
import { summarizeRoutineRunMessages } from "./routine-run-timeline";

describe("summarizeRoutineRunMessages", () => {
  it("keeps a run with one state unchanged", () => {
    const queued = routineMessage("queued", "run-1");

    expect(summarizeRoutineRunMessages([queued])).toEqual([queued]);
  });

  it.each(["succeeded", "failed", "interrupted", "cancelled"] as const)(
    "shows one %s summary and keeps the routine instruction",
    (terminalStatus) => {
      const instruction = routineMessage("queued", "run-1", true);
      const running = routineMessage("running", "run-1");
      const terminal = routineMessage(terminalStatus, "run-1");

      const result = summarizeRoutineRunMessages([instruction, running, terminal]);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: instruction.id, body: instruction.body, actionMarker: undefined });
      expect(result[1]?.actionMarker).toMatchObject({
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
