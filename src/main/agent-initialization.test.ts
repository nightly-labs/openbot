// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { AgentInitializationGate } from "./agent-initialization";

describe("AgentInitializationGate", () => {
  it("coalesces concurrent starts and keeps a successful service initialized", async () => {
    const initialize = vi.fn(async () => undefined);
    const gate = new AgentInitializationGate(initialize);

    await Promise.all([gate.start(), gate.start(), gate.start()]);
    await gate.start();

    expect(initialize).toHaveBeenCalledOnce();
  });

  it("allows an explicit retry after initialization fails", async () => {
    const initialize = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("startup failed"))
      .mockResolvedValueOnce(undefined);
    const gate = new AgentInitializationGate(initialize);

    expect(gate.succeeded).toBe(false);
    await expect(gate.start()).rejects.toThrow("startup failed");
    expect(gate.succeeded).toBe(false);
    await expect(gate.start()).resolves.toBeUndefined();
    expect(gate.succeeded).toBe(true);

    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("reports pending only while initialization runs", async () => {
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate = new AgentInitializationGate(() => started);

    expect(gate.pending).toBe(false);
    expect(gate.succeeded).toBe(false);
    const run = gate.start();
    expect(gate.pending).toBe(true);
    expect(gate.succeeded).toBe(false);
    release();
    await run;
    expect(gate.pending).toBe(false);
    expect(gate.succeeded).toBe(true);
  });
});
