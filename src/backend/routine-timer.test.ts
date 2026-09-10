// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type RoutineDueSource, RoutineTimer } from "./routine-timer";

const start = new Date("2026-08-25T10:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
});

afterEach(() => {
  vi.useRealTimers();
});

interface StubSource {
  dueAt: string | null;
  /** Every wake-up asks every owner; only the owner whose time has come does work. */
  asked: number;
  fired: string[];
  record: RoutineDueSource;
}

function source(dueAt: string | null, onProcess?: () => Promise<void>): StubSource {
  const stub: StubSource = {
    dueAt,
    asked: 0,
    fired: [],
    record: {
      nextDueAt: () => stub.dueAt,
      processDue: async (now) => {
        stub.asked += 1;
        if (stub.dueAt && now.toISOString() >= stub.dueAt) {
          stub.fired.push(stub.dueAt);
          stub.dueAt = null;
        }
        await onProcess?.();
      },
    },
  };
  return stub;
}

it("wakes at the earliest due time across every owner", async () => {
  const early = source("2026-08-25T10:01:00.000Z");
  const late = source("2026-08-25T11:00:00.000Z");
  const timer = new RoutineTimer(
    // Declared late first, so a timer that armed from the first source alone would sleep an hour.
    () => [late.record, early.record],
    () => true,
    () => undefined,
  );
  timer.arm();

  await vi.advanceTimersByTimeAsync(59_000);
  expect(early.asked).toBe(0);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(early.fired).toEqual(["2026-08-25T10:01:00.000Z"]);
  expect(late.asked).toBe(1);
  expect(late.fired).toEqual([]);

  // The re-arm after that wake-up has to come from the owner that is still waiting.
  await vi.advanceTimersByTimeAsync(59 * 60_000);
  expect(late.fired).toEqual(["2026-08-25T11:00:00.000Z"]);
  timer.dispose();
});

it("reports a failing owner, still drives the others, and still re-arms", async () => {
  const errors: string[] = [];
  const failing = source("2026-08-25T10:01:00.000Z", async () => {
    throw new Error("The routine store is unavailable.");
  });
  const healthy = source("2026-08-25T10:01:00.000Z");
  const timer = new RoutineTimer(
    () => [failing.record, healthy.record],
    () => true,
    (code) => errors.push(code),
  );
  timer.arm();

  await vi.advanceTimersByTimeAsync(60_000);
  expect(errors).toEqual(["routine_scheduler_failed"]);
  expect(healthy.fired).toEqual(["2026-08-25T10:01:00.000Z"]);

  // The failure must not leave the process asleep: the next occurrence still wakes it.
  healthy.dueAt = "2026-08-25T10:02:00.000Z";
  timer.arm();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(healthy.fired).toEqual(["2026-08-25T10:01:00.000Z", "2026-08-25T10:02:00.000Z"]);
  timer.dispose();
});

it("does not wake a stopped service and stops waking after dispose", async () => {
  const running = { value: false };
  const pending = source("2026-08-25T10:01:00.000Z");
  const timer = new RoutineTimer(
    () => [pending.record],
    () => running.value,
    () => undefined,
  );
  timer.arm();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(pending.asked).toBe(0);

  running.value = true;
  timer.arm();
  timer.dispose();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(pending.asked).toBe(0);
});

it("asks each owner once for a wake a fire arms again", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Firing a routine writes, and every write arms the timer. The owner behind this one is still
  // due at that moment, so a second pass would fire it while this pass still holds it in the list
  // it read - and the repeated command answers with the receipt of the first one.
  const slow = source("2026-08-25T10:01:00.000Z", async () => {
    timer.arm();
    await gate;
  });
  const behind = source("2026-08-25T10:01:00.000Z");
  const timer = new RoutineTimer(
    () => [slow.record, behind.record],
    () => true,
    () => undefined,
  );
  timer.arm();

  await vi.advanceTimersByTimeAsync(60_000);
  // The pass is in flight, and it armed the timer from inside its own fire. No wake of that timer
  // may start a second pass while this one still holds the owners it read.
  await vi.advanceTimersByTimeAsync(1_000);
  expect(slow.asked).toBe(1);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(behind.asked).toBe(1);
  timer.dispose();
});
