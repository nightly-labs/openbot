import { describe, expect, it } from "vitest";
import { LifecycleGate } from "./lifecycle-gate";

describe("LifecycleGate", () => {
  it("runs a start that waits between two stops before the last stop, so the service ends stopped", async () => {
    const gate = new LifecycleGate<void>();
    const calls: string[] = [];
    const record = (call: string) => async () => {
      calls.push(call);
    };

    await Promise.all([gate.stop(record("stop")), gate.start(record("start")), gate.stop(record("stop"))]);

    expect(calls).toEqual(["stop", "start", "stop"]);
  });

  it("interrupts a running start for a stop, and stops after that start ends", async () => {
    const gate = new LifecycleGate<void>();
    const calls: string[] = [];
    let endStart = (): void => undefined;
    const start = gate.start(
      () =>
        new Promise<void>((resolve) => {
          calls.push("start");
          endStart = resolve;
        }),
    );
    const secondStart = gate.start(async () => {
      calls.push("second start");
    });
    const stop = gate.stop(
      async () => {
        calls.push("stop");
      },
      async () => {
        calls.push("interrupt");
        endStart();
      },
    );

    await Promise.all([start, secondStart, stop]);

    expect(calls).toEqual(["start", "interrupt", "stop"]);
  });
});
