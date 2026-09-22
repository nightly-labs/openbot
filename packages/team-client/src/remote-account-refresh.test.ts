import { afterEach, expect, it, vi } from "vitest";
import { createRemoteAccountRefresh } from "./remote-account-refresh";

afterEach(() => vi.useRealTimers());

it("shares pending account requests and applies one trailing invalidation", async () => {
  vi.useFakeTimers();
  let complete = () => {};
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const load = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
  const refresh = createRemoteAccountRefresh(load);
  refresh.setActive(true);
  const first = refresh.refresh();
  expect(refresh.refresh(true)).toBe(first);
  await vi.advanceTimersByTimeAsync(0);
  refresh.invalidate();
  refresh.invalidate();
  complete();
  await first;
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(2);
  refresh.dispose();
});

it("retains failed account checks and bounds retry requests across foreground returns", async () => {
  vi.useFakeTimers();
  const load = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
  const refresh = createRemoteAccountRefresh(load);
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

it("looks for a server joined on another device when the app asks for a fresh list", async () => {
  vi.useFakeTimers();
  const load = vi.fn(async () => {});
  const refresh = createRemoteAccountRefresh(load);
  refresh.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  // A second ask within the minute waits for the floor rather than asking again, and is not
  // dropped: the app in front checks once that floor passes.
  void refresh.foreground();
  await vi.advanceTimersByTimeAsync(59_999);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(2);
  // A phone in a pocket asks for nothing.
  refresh.setActive(false);
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  expect(load).toHaveBeenCalledTimes(2);
  refresh.dispose();
});

it("keeps the account interval when a caller only reports the app is in front", async () => {
  vi.useFakeTimers();
  const load = vi.fn(async () => {});
  const refresh = createRemoteAccountRefresh(load);
  refresh.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  // Session validation shares this controller, so a short visit must not spend a check.
  for (let visit = 0; visit < 2; visit += 1) {
    refresh.setActive(false);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    refresh.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(load).toHaveBeenCalledTimes(1);
  refresh.dispose();
});

it("does not start queued account work after background entry", async () => {
  vi.useFakeTimers();
  const load = vi.fn(async () => {});
  const refresh = createRemoteAccountRefresh(load);
  refresh.setActive(true);
  refresh.setActive(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).not.toHaveBeenCalled();
  refresh.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  refresh.dispose();
});
