import { describe, expect, it } from "vitest";

import { reconcilePendingRequests } from "./runtime-attention";

describe("runtime snapshot attention", () => {
  const shown = [
    { requestId: "left-out", value: "shown" },
    { requestId: 7, value: "old" },
  ];

  it("replaces the list with a complete snapshot", () => {
    expect(reconcilePendingRequests(shown, [{ requestId: "new", value: "next" }], true)).toEqual([
      { requestId: "new", value: "next" },
    ]);
  });

  it("keeps requests that a partial snapshot leaves out", () => {
    expect(reconcilePendingRequests(shown, [{ requestId: "7", value: "next" }], false)).toEqual([
      { requestId: "left-out", value: "shown" },
      { requestId: "7", value: "next" },
    ]);
  });
});
