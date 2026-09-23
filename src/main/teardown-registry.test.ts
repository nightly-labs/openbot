// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { TeardownRegistry } from "./teardown-registry";

describe("TeardownRegistry", () => {
  it("runs steps in declared order rather than registration order", async () => {
    const stopped: string[] = [];
    const registry = new TeardownRegistry({ reportError: () => undefined });

    registry.push(30, "agents", () => void stopped.push("agents"));
    registry.push(10, "browser", () => void stopped.push("browser"));
    registry.push(20, "provider runtimes", () => void stopped.push("provider runtimes"));
    await registry.runAll();

    expect(stopped).toEqual(["browser", "provider runtimes", "agents"]);
  });

  it("reports a failing step and still runs the ones after it", async () => {
    const stopped: string[] = [];
    const reportError = vi.fn();
    const registry = new TeardownRegistry({ reportError });
    const failure = new Error("the host would not shut down");

    registry.push(10, "host", () => Promise.reject(failure));
    registry.push(20, "agents", () => void stopped.push("agents"));
    await registry.runAll();

    expect(stopped).toEqual(["agents"]);
    expect(reportError).toHaveBeenCalledWith("host", failure);
  });

  it("moves past a step that never finishes so the process can still exit", async () => {
    vi.useFakeTimers();
    try {
      const stopped: string[] = [];
      const reportError = vi.fn();
      const registry = new TeardownRegistry({ reportError, stepTimeoutMs: 1_000 });

      registry.push(10, "remote servers", () => new Promise(() => undefined));
      registry.push(20, "agents", () => void stopped.push("agents"));
      const shutdown = registry.runAll();
      await vi.advanceTimersByTimeAsync(1_000);
      await shutdown;

      expect(stopped).toEqual(["agents"]);
      expect(reportError).toHaveBeenCalledWith("remote servers", expect.any(Error));
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs each step once when shutdown is requested twice", async () => {
    const stop = vi.fn();
    const registry = new TeardownRegistry({ reportError: () => undefined });

    registry.push(10, "agents", stop);
    await Promise.all([registry.runAll(), registry.runAll()]);
    await registry.runAll();

    expect(stop).toHaveBeenCalledOnce();
  });

  it("gives a step registered after shutdown has begun its declared position", async () => {
    const stopped: string[] = [];
    const registry = new TeardownRegistry({ reportError: () => undefined });

    registry.push(10, "browser", () => {
      stopped.push("browser");
      // Construction is not aborted by a quit, so a service can finish building here. It belongs
      // ahead of the steps the drain has not reached, not appended after all of them.
      registry.push(20, "remote servers", () => void stopped.push("remote servers"));
    });
    registry.push(30, "agents", () => void stopped.push("agents"));
    await registry.runAll();

    expect(stopped).toEqual(["browser", "remote servers", "agents"]);
  });
});
