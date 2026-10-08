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

  // A peer request waits through this. It must not start the providers again after a failure.
  it("waits for the initialization in progress without starting or retrying one", async () => {
    const failed = Deferred.makeUnsafe<void, Error>();
    const initialize = vi.fn(() => Deferred.await(failed));
    const gate = new AgentInitializationGate(initialize);

    await Effect.runPromise(gate.awaitSettled());
    expect(initialize).not.toHaveBeenCalled();
    const run = Effect.runPromise(gate.start());
    const waiting = Effect.runPromise(gate.awaitSettled());
    await Effect.runPromise(Deferred.fail(failed, new Error("startup failed")));
    await expect(run).rejects.toThrow("startup failed");
    await expect(waiting).resolves.toBeUndefined();
    await Effect.runPromise(gate.awaitSettled());

    expect(initialize).toHaveBeenCalledOnce();
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
