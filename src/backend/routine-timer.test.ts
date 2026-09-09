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
