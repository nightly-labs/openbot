import { describe, expect, it } from "vitest";

import { reconcilePendingRequests } from "./runtime-attention";

describe("runtime snapshot attention", () => {
  const shown = [
    { requestId: "left-out", agentId: "scout" },
    { requestId: 7, agentId: "chief" },
  ];

  it("replaces the list with a complete snapshot", () => {
    expect(reconcilePendingRequests(shown, [{ requestId: "new", agentId: "chief" }], true)).toEqual([
      { requestId: "new", agentId: "chief" },
    ]);
  });

  it("keeps requests that a partial snapshot leaves out and replaces those of the agents it names", () => {
    expect(reconcilePendingRequests(shown, [{ requestId: "new", agentId: "chief" }], false)).toEqual([
      { requestId: "left-out", agentId: "scout" },
      { requestId: "new", agentId: "chief" },
    ]);
  });
});
