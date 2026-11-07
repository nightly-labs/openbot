import type { BackgroundProcess } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backgroundProcesses,
  setBackgroundProcessAgent,
  stopBackgroundProcess,
  subscribeBackgroundProcesses,
} from "./background-processes";

const PROCESS: BackgroundProcess = {
  id: "42:1000",
  pid: 42,
  command: "curl",
  startedAt: 1000,
  ports: [],
  agentId: "agent-1",
  verified: true,
  stoppable: true,
};

let list: ReturnType<typeof vi.fn>;
let stop: ReturnType<typeof vi.fn>;
let unsubscribe: (() => void) | undefined;

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  list = vi.fn(async () => []);
  stop = vi.fn(async () => ({ stopped: true }));
  Object.defineProperty(window, "openbot", {
    configurable: true,
    value: { backgroundProcesses: { list, stop } },
  });
  setVisibility("visible");
  setBackgroundProcessAgent("__reset__");
  setBackgroundProcessAgent(undefined);
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  setBackgroundProcessAgent(undefined);
  vi.useRealTimers();
});

describe("background process polling", () => {
  it("does not poll without an agent", async () => {
    unsubscribe = subscribeBackgroundProcesses();
    await flush();

    expect(list).not.toHaveBeenCalled();
  });

  it("polls every 30 seconds while the list is empty", async () => {
    setBackgroundProcessAgent("agent-1");
    unsubscribe = subscribeBackgroundProcesses();
    await flush();

    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenLastCalledWith({ agentId: "agent-1" });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(list).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("polls every 5 seconds while a task is shown", async () => {
    list.mockResolvedValue([PROCESS]);
    setBackgroundProcessAgent("agent-1");
    unsubscribe = subscribeBackgroundProcesses();
    await flush();

    expect(backgroundProcesses()).toEqual([PROCESS]);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(list).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("stops the timer when the last subscriber leaves", async () => {
    setBackgroundProcessAgent("agent-1");
    unsubscribe = subscribeBackgroundProcesses();
    await flush();
    unsubscribe();
    unsubscribe = undefined;

    await vi.advanceTimersByTimeAsync(30_000);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("drops a result for the agent that was on screen before", async () => {
    let resolveFirst: ((value: BackgroundProcess[]) => void) | undefined;
    list.mockImplementationOnce(
      () =>
        new Promise<BackgroundProcess[]>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    list.mockResolvedValue([]);
    setBackgroundProcessAgent("agent-1");
    unsubscribe = subscribeBackgroundProcesses();
    await flush();

    setBackgroundProcessAgent("agent-2");
    await flush();
    resolveFirst?.([PROCESS]);
    await flush();

    expect(backgroundProcesses()).toEqual([]);
  });

  it("sends the agent id with a stop and returns the result", async () => {
    const result = await stopBackgroundProcess(PROCESS);

    expect(stop).toHaveBeenCalledWith({ id: PROCESS.id, agentId: PROCESS.agentId });
    expect(result).toEqual({ stopped: true });
  });

  it("pauses while the document is hidden and reads again when it is visible", async () => {
    setVisibility("hidden");
    setBackgroundProcessAgent("agent-1");
    unsubscribe = subscribeBackgroundProcesses();
    await flush();
    expect(list).not.toHaveBeenCalled();

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(list).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
