import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { runTestEffect } from "../backend/effect-test-runtime";
import { LifecycleGate } from "./lifecycle-gate";

describe("LifecycleGate", () => {
  it("runs a start that waits between two stops before the last stop, so the service ends stopped", async () => {
    const gate = new LifecycleGate<void, never>();
    const calls: string[] = [];
    const record = (call: string) => () =>
      Effect.sync(() => {
        calls.push(call);
      });

    await Promise.all([
      runTestEffect(gate.stop(record("stop"))),
      runTestEffect(gate.start(record("start"))),
      runTestEffect(gate.stop(record("stop"))),
    ]);

    expect(calls).toEqual(["stop", "start", "stop"]);
  });

  it("interrupts a running start for a stop, and stops after that start ends", async () => {
    const gate = new LifecycleGate<void, never>();
    const calls: string[] = [];
    let endStart = (): void => undefined;
    const start = runTestEffect(
      gate.start(() =>
        Effect.callback<void>((resume) => {
          calls.push("start");
          endStart = () => resume(Effect.void);
        }),
      ),
    );
    const secondStart = runTestEffect(
      gate.start(() =>
        Effect.sync(() => {
          calls.push("second start");
        }),
      ),
    );
    const stop = runTestEffect(
      gate.stop(
        () =>
          Effect.sync(() => {
            calls.push("stop");
          }),
        () =>
          Effect.sync(() => {
            calls.push("interrupt");
            endStart();
          }),
      ),
    );

    await Promise.all([start, secondStart, stop]);

    expect(calls).toEqual(["start", "interrupt", "stop"]);
  });
});
