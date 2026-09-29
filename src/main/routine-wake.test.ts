// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RoutineWake } from "./routine-wake";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(online: { value: boolean }) {
  const routines = { suspendRoutines: vi.fn(), resumeRoutines: vi.fn() };
  const wake = new RoutineWake({ routines, isOnline: () => online.value });
  return { routines, wake };
}

it("resumes routines only after the network is back", async () => {
  const online = { value: false };
  const { routines, wake } = setup(online);
  wake.suspend();
  expect(routines.suspendRoutines).toHaveBeenCalledOnce();

  wake.resume();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(routines.resumeRoutines).not.toHaveBeenCalled();

  online.value = true;
  await vi.advanceTimersByTimeAsync(4_000);
  expect(routines.resumeRoutines).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(routines.resumeRoutines).toHaveBeenCalledOnce();
});

it("resumes routines at the limit when the network does not come back", async () => {
  const { routines, wake } = setup({ value: false });
  wake.resume();
  await vi.advanceTimersByTimeAsync(118_000);
  expect(routines.resumeRoutines).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(routines.resumeRoutines).toHaveBeenCalledOnce();
});

it("does not resume routines when the computer sleeps again during the wait", async () => {
  const online = { value: false };
  const { routines, wake } = setup(online);
  wake.resume();
  await vi.advanceTimersByTimeAsync(2_000);
  wake.suspend();
  online.value = true;
  await vi.advanceTimersByTimeAsync(200_000);
  expect(routines.resumeRoutines).not.toHaveBeenCalled();
});
