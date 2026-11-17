// Kiro CLI 2.37.1 sends the roster of its subagents in `_kiro.dev/subagent/list_update`. The payloads
// below are the ones that a real run sent: two subagents that start together, and then end.
import { describe, expect, it } from "vitest";
import { foldKiroSubagentRoster, foldOpenCodeChildUpdate } from "./acp-subagent-updates";
import { newSubagentState, subagentFor } from "./subagent-updates";

const NOW = "2026-11-17T10:00:00.000Z";
const LATER = "2026-11-17T10:00:05.000Z";

function entry(sessionId: string, type: "working" | "terminated", query: string) {
  return {
    sessionId,
    sessionName: `subagent-${sessionId.slice(0, 1)}`,
    agentName: "worker-lite",
    initialQuery: query,
    status: type === "working" ? { type, message: "Running" } : { type },
    group: "crew-Two independent suba",
    role: "worker-lite",
    dependsOn: [],
    hasLoop: false,
    loopIteration: 0,
    loopMaxIterations: 0,
    createdAtMs: 1794907063708,
  };
}

const ONE = "67a412d7-20d6-4824-a278-b5f9441e0f5d";
const TWO = "0cfa0e37-7897-4a6c-9ea7-95400c253374";
const QUERY_ONE = "Reply with exactly the single word: one. Do not use any tools.\nDo not read or write files.";

describe("foldKiroSubagentRoster", () => {
  it("shows each working subagent of the roster in the turn that started it", () => {
    const state = newSubagentState();
    const [change] = foldKiroSubagentRoster(
      state,
      "turn-1",
      { subagents: [entry(ONE, "working", QUERY_ONE), entry(TWO, "working", "Reply: two.")], pendingStages: [] },
      NOW,
    );
    expect(change?.turnId).toBe("turn-1");
    expect(change?.subagents).toHaveLength(2);
    expect(change?.subagents[0]).toMatchObject({
      id: ONE,
      title: "Reply with exactly the single word: one. Do not use any tools.",
      agentType: "worker-lite",
      prompt: QUERY_ONE,
      status: "running",
      startedAt: NOW,
    });
  });

  it("sends no change when the roster repeats", () => {
    const state = newSubagentState();
    const roster = { subagents: [entry(ONE, "working", "one")], pendingStages: [] };
    foldKiroSubagentRoster(state, "turn-1", roster, NOW);
    expect(foldKiroSubagentRoster(state, "turn-1", roster, LATER)).toEqual([]);
  });

  it("ends a subagent that is terminated, and one that the roster no longer lists", () => {
    const state = newSubagentState();
    foldKiroSubagentRoster(
      state,
      "turn-1",
      { subagents: [entry(ONE, "working", "one"), entry(TWO, "working", "two")], pendingStages: [] },
      NOW,
    );
    const [terminated] = foldKiroSubagentRoster(
      state,
      "turn-1",
      { subagents: [entry(ONE, "terminated", "one"), entry(TWO, "working", "two")], pendingStages: [] },
      LATER,
    );
    expect(terminated?.subagents.map((subagent) => subagent.status)).toEqual(["completed", "running"]);
    expect(terminated?.subagents[0]?.endedAt).toBe(LATER);
    const [emptied] = foldKiroSubagentRoster(state, "turn-1", { subagents: [], pendingStages: [] }, LATER);
    expect(emptied?.subagents.map((subagent) => subagent.status)).toEqual(["completed", "completed"]);
  });

  it("does not start a subagent that no turn can claim", () => {
    const state = newSubagentState();
    expect(foldKiroSubagentRoster(state, null, { subagents: [entry(ONE, "working", "one")] }, NOW)).toEqual([]);
    expect(subagentFor(state, ONE)).toBeUndefined();
  });

  it("does not start a subagent that is already terminated, or has a status that it does not know", () => {
    const state = newSubagentState();
    const odd = { ...entry(TWO, "working", "two"), status: { type: "queued" } };
    expect(foldKiroSubagentRoster(state, "turn-1", { subagents: [entry(ONE, "terminated", "one"), odd] }, NOW)).toEqual(
      [],
    );
  });

  it("cuts a long task to a short title and keeps the whole task as the prompt", () => {
    const state = newSubagentState();
    const long = `${"word ".repeat(60)}end`;
    const [change] = foldKiroSubagentRoster(state, "turn-1", { subagents: [entry(ONE, "working", long)] }, NOW);
    expect(change?.subagents[0]?.title.length).toBe(120);
    expect(change?.subagents[0]?.title.endsWith("…")).toBe(true);
    expect(change?.subagents[0]?.prompt).toBe(long);
  });

  it("ignores a payload that is not a roster", () => {
    const state = newSubagentState();
    for (const params of [null, "x", {}, { subagents: "no" }, { subagents: [null, 3, { sessionId: 4 }] }])
      expect(foldKiroSubagentRoster(state, "turn-1", params, NOW)).toEqual([]);
  });

  it("shows the tool calls of a subagent's own session as its steps", () => {
    const state = newSubagentState();
    foldKiroSubagentRoster(state, "turn-1", { subagents: [entry(ONE, "working", "one")] }, NOW);
    const change = foldOpenCodeChildUpdate(
      state,
      new Map(),
      null,
      {
        type: "update",
        childSessionId: ONE,
        update: { sessionUpdate: "tool_call", toolCallId: "call-1", title: "Reading file.ts", kind: "read" },
      },
      LATER,
    );
    expect(change?.subagents[0]?.steps).toEqual([{ id: "call-1", kind: "read", text: "Reading file.ts" }]);
  });

  it("keeps a step that a subagent sent before its end, when the roster came first", () => {
    const state = newSubagentState();
    foldKiroSubagentRoster(state, "turn-1", { subagents: [entry(ONE, "working", "one")] }, NOW);
    foldKiroSubagentRoster(state, "turn-1", { subagents: [entry(ONE, "terminated", "one")] }, LATER);
    const answer = {
      type: "update",
      childSessionId: ONE,
      update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "one" } },
    };
    // Without `lateSteps`, an ended subagent takes no step: that is the rule for OpenCode.
    expect(foldOpenCodeChildUpdate(state, new Map(), null, answer, LATER)).toBeNull();
    const change = foldOpenCodeChildUpdate(state, new Map(), null, answer, LATER, true);
    expect(change?.subagents[0]).toMatchObject({ status: "completed", steps: [{ kind: "text", text: "one" }] });
  });
});
