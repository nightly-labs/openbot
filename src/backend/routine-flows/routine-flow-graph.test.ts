// @vitest-environment node

import { describe, expect, it } from "vitest";
import { routineFlowConnectProblem, routineFlowDepths } from "./routine-flow-graph";

const link = (fromAgentId: string, toAgentId: string) => ({ fromAgentId, toAgentId });

describe("routine flow graph", () => {
  it("runs each agent one step after its latest input", () => {
    const links = [link("research", "writer"), link("sales", "writer"), link("research", "sales")];
    expect(Object.fromEntries(routineFlowDepths("research", links))).toEqual({ research: 0, sales: 1, writer: 2 });
  });

  it.each([
    { from: "writer", to: "writer", problem: "same-agent" },
    { from: "writer", to: "research", problem: "into-owner" },
    { from: "chief", to: "sales", problem: "not-on-path" },
    { from: "research", to: "writer", problem: "duplicate" },
    { from: "chief", to: "writer", problem: "not-on-path" },
    { from: "writer", to: "sales", problem: null },
  ])("answers $problem for $from to $to", ({ from, to, problem }) => {
    expect(routineFlowConnectProblem("research", [link("research", "writer")], from, to)).toBe(problem);
  });

  it("refuses a link that closes a loop", () => {
    const links = [link("research", "writer"), link("writer", "chief")];
    expect(routineFlowConnectProblem("research", links, "chief", "writer")).toBe("cycle");
  });
});
