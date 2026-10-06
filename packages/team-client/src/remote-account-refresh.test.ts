import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { runTeamEffect } from "./effect-boundary";
import { createRemoteAccountRefresh } from "./remote-account-refresh";

afterEach(() => vi.useRealTimers());

it("shares pending account requests and applies one trailing invalidation", async () => {
  vi.useFakeTimers();
  let complete = () => {};
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const load = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
  const refresh = createRemoteAccountRefresh(() => Effect.tryPromise(load));
  refresh.setActive(true);
  const first = runTeamEffect(refresh.refresh());
  const second = runTeamEffect(refresh.refresh(true));
  await vi.advanceTimersByTimeAsync(0);
  refresh.invalidate();
  refresh.invalidate();
  complete();
  await Promise.all([first, second]);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(2);
  refresh.dispose();
});

it("retains failed account checks and bounds retry requests across foreground returns", async () => {
  vi.useFakeTimers();
  const load = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
  const refresh = createRemoteAccountRefresh(() => Effect.tryPromise(load));
  refresh.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  refresh.setActive(false);
  refresh.setActive(true);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(2);
  refresh.setActive(false);
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  expect(load).toHaveBeenCalledTimes(2);
  refresh.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(3);
  refresh.dispose();
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  expect(load).toHaveBeenCalledTimes(3);
});

it("does not start queued account work after background entry", async () => {
  vi.useFakeTimers();
  const load = vi.fn(async () => {});
  const refresh = createRemoteAccountRefresh(() => Effect.tryPromise(load));
  refresh.setActive(true);
  refresh.setActive(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).not.toHaveBeenCalled();
  refresh.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  refresh.dispose();
});
