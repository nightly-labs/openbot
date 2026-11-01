// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { RoutineWake } from "./routine-wake";

afterEach(() => {
  vi.useRealTimers();
});

function makeWake(
  options: { online?: () => boolean; pollMs?: number; maxWaitMs?: number; lostResumeMs?: number } = {},
) {
  const routines = { suspendRoutines: vi.fn(), resumeRoutines: vi.fn() };
  const wake = new RoutineWake({
    routines,
    isOnline: options.online ?? (() => true),
    pollMs: options.pollMs ?? 1,
    onlineReads: 1,
    maxWaitMs: options.maxWaitMs ?? 60_000,
    lostResumeMs: options.lostResumeMs ?? 600_000,
  });
  return { routines, wake };
}

describe("routine wake", () => {
  it("resumes through the lost-resume window when the resume event never arrives", () => {
    vi.useFakeTimers();
    const { routines, wake } = makeWake({ lostResumeMs: 600_000 });
    wake.suspend();
    expect(routines.suspendRoutines).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(599_999);
    expect(routines.resumeRoutines).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(routines.resumeRoutines).toHaveBeenCalledTimes(1);
    wake.dispose();
  });

  it("resumes only once when the reported resume arrives before the window ends", () => {
    vi.useFakeTimers();
    const { routines, wake } = makeWake({ lostResumeMs: 600_000 });
    wake.suspend();
    wake.resume();
    expect(routines.resumeRoutines).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600_000);
    expect(routines.resumeRoutines).toHaveBeenCalledTimes(1);
    wake.dispose();
  });

  it("resumes only once when the reported resume arrives after the window ran out", () => {
    vi.useFakeTimers();
    const { routines, wake } = makeWake({ lostResumeMs: 600_000 });
    wake.suspend();
    vi.advanceTimersByTime(600_000);
    expect(routines.resumeRoutines).toHaveBeenCalledTimes(1);
    wake.resume();
    expect(routines.resumeRoutines).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600_000);
    expect(routines.resumeRoutines).toHaveBeenCalledTimes(1);
    wake.dispose();
  });

  it("keeps a lost-resume resume waiting for the network, like a reported wake", () => {
    vi.useFakeTimers();
    let online = false;
    const { routines, wake } = makeWake({
      online: () => online,
      pollMs: 100,
      lostResumeMs: 600_000,
    });
    wake.suspend();
    vi.advanceTimersByTime(600_000);
    expect(routines.resumeRoutines).not.toHaveBeenCalled();
    online = true;
    vi.advanceTimersByTime(100);
    expect(routines.resumeRoutines).toHaveBeenCalledTimes(1);
    wake.dispose();
  });

  it("gives up waiting for the network, so a lost-resume resume never stays held", () => {
    vi.useFakeTimers();
    const { routines, wake } = makeWake({
      online: () => false,
      pollMs: 100,
      maxWaitMs: 5_000,
      lostResumeMs: 600_000,
    });
    wake.suspend();
    vi.advanceTimersByTime(600_000);
    expect(routines.resumeRoutines).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(routines.resumeRoutines).toHaveBeenCalledTimes(1);
    wake.dispose();
  });

  it("resumes nothing when no suspend came first, so a stray resume event does nothing", () => {
    vi.useFakeTimers();
    const { routines, wake } = makeWake({ lostResumeMs: 600_000 });
    wake.resume();
    vi.advanceTimersByTime(600_000);
    expect(routines.suspendRoutines).not.toHaveBeenCalled();
    expect(routines.resumeRoutines).not.toHaveBeenCalled();
  });

  it("clears the lost-resume window on dispose, so a stopped process does not resume", () => {
    vi.useFakeTimers();
    const { routines, wake } = makeWake({ lostResumeMs: 600_000 });
    wake.suspend();
    wake.dispose();
    vi.advanceTimersByTime(600_000);
    expect(routines.resumeRoutines).not.toHaveBeenCalled();
  });

  it("ignores a resume event that arrives after dispose, while the process ends", () => {
    vi.useFakeTimers();
    const { routines, wake } = makeWake({ lostResumeMs: 600_000 });
    wake.suspend();
    wake.dispose();
    wake.resume();
    vi.advanceTimersByTime(600_000);
    expect(routines.resumeRoutines).not.toHaveBeenCalled();
  });

  it("cancels a network wait that a second suspend interrupts", () => {
    vi.useFakeTimers();
    let online = false;
    const { routines, wake } = makeWake({
      online: () => online,
      pollMs: 100,
      maxWaitMs: 60_000,
      lostResumeMs: 600_000,
    });
    wake.suspend();
    wake.resume();
    // The second suspend takes the pending network poll away, and starts one new window.
    wake.suspend();
    expect(routines.suspendRoutines).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    expect(routines.resumeRoutines).not.toHaveBeenCalled();
    online = true;
    vi.advanceTimersByTime(600_000);
    expect(routines.resumeRoutines).toHaveBeenCalledTimes(1);
    wake.dispose();
  });

  it("keeps one lost-resume window across a repeated suspend", () => {
    vi.useFakeTimers();
    const { routines, wake } = makeWake({ lostResumeMs: 600_000 });
    wake.suspend();
    wake.suspend();
    vi.advanceTimersByTime(600_000);
    expect(routines.resumeRoutines).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600_000);
    expect(routines.resumeRoutines).toHaveBeenCalledTimes(1);
    wake.dispose();
  });
});
