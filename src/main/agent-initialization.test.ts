// @vitest-environment node

import { Deferred, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { AgentInitializationGate } from "./agent-initialization";

describe("AgentInitializationGate", () => {
  it("coalesces concurrent starts and keeps a successful service initialized", async () => {
    const initialize = vi.fn(() => Effect.void);
    const gate = new AgentInitializationGate(initialize);

    await Promise.all([
      Effect.runPromise(gate.start()),
      Effect.runPromise(gate.start()),
      Effect.runPromise(gate.start()),
    ]);
    await Effect.runPromise(gate.start());

    expect(initialize).toHaveBeenCalledOnce();
  });

  it("allows an explicit retry after initialization fails", async () => {
    const initialize = vi
      .fn<() => Effect.Effect<void, Error>>()
      .mockReturnValueOnce(Effect.fail(new Error("startup failed")))
      .mockReturnValueOnce(Effect.void);
    const gate = new AgentInitializationGate(initialize);

    expect(gate.succeeded).toBe(false);
    await expect(Effect.runPromise(gate.start())).rejects.toThrow("startup failed");
    expect(gate.succeeded).toBe(false);
    await expect(Effect.runPromise(gate.start())).resolves.toBeUndefined();
    expect(gate.succeeded).toBe(true);

    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("reports pending only while initialization runs", async () => {
    const started = Deferred.makeUnsafe<void>();
    const gate = new AgentInitializationGate(() => Deferred.await(started));

    expect(gate.pending).toBe(false);
    expect(gate.succeeded).toBe(false);
    const run = Effect.runPromise(gate.start());
    expect(gate.pending).toBe(true);
    expect(gate.succeeded).toBe(false);
    await Effect.runPromise(Deferred.succeed(started, undefined));
    await run;
    expect(gate.pending).toBe(false);
    expect(gate.succeeded).toBe(true);
  });
});
