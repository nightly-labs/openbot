// @vitest-environment node

import { describe, expect, it } from "vitest";
import { replaysUnworkedTurn } from "./turn-lifecycle";

const STALLED = {
  status: "failed",
  acted: false,
  produced: false,
  refused: false,
  limited: false,
  failover: false,
  executionThread: false,
};

describe("replaysUnworkedTurn", () => {
  it("replays a failed turn that no provider work reached", () => {
    expect(replaysUnworkedTurn(STALLED)).toBe(true);
  });

  it("does not replay when the provider echoed the messages", () => {
    expect(replaysUnworkedTurn({ ...STALLED, produced: true })).toBe(false);
  });

  it("does not replay a turn that did work", () => {
    expect(replaysUnworkedTurn({ ...STALLED, acted: true })).toBe(false);
    expect(replaysUnworkedTurn({ ...STALLED, acted: true, produced: true })).toBe(false);
  });

  it("does not replay a turn that did not fail", () => {
    expect(replaysUnworkedTurn({ ...STALLED, status: "completed" })).toBe(false);
    expect(replaysUnworkedTurn({ ...STALLED, status: "interrupted" })).toBe(false);
  });

  it("leaves a refused turn to its own retry", () => {
    expect(replaysUnworkedTurn({ ...STALLED, refused: true })).toBe(false);
  });

  it("leaves a limited turn to the usage-limit requeue", () => {
    expect(replaysUnworkedTurn({ ...STALLED, limited: true })).toBe(false);
  });

  it("leaves a provider error to the backup-model requeue", () => {
    expect(replaysUnworkedTurn({ ...STALLED, failover: true })).toBe(false);
  });

  it("does not replay a turn of an execution thread", () => {
    expect(replaysUnworkedTurn({ ...STALLED, executionThread: true })).toBe(false);
  });
});
