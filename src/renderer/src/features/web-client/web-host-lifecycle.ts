import type { HostedServerSleep } from "@openbot/contracts/ipc";
import { runTeamEffect } from "@openbot/team-client";
import { WAKE_RECONNECT_DELAY_MS } from "@openbot/team-client/hosted-server-wake";
import { createWebHostedServerWake } from "./web-hosted-server-wake";

/** A host restarts in under a minute; the retries stop after three. */
const HOST_RESTART_RETRY_MS = 5_000;
const HOST_RESTART_RETRY_LIMIT = 36;
/** A sleeping server can start for a routine. The tab asks the account service again after this long. */
const SLEEP_RECHECK_MS = 5 * 60_000;

/**
 * The retries of the opened host that is offline: a hosted server that sleeps or wakes, and a host
 * that restarts into an update. Each retry stops when the tab opens another host or the host is online.
 */
export function createWebHostLifecycle(options: {
  accountFetch: typeof fetch;
  /** The id of the opened host. */
  hostId: () => string | null;
  disposed: () => boolean;
  status: () => "connecting" | "online" | "offline";
  hostedSleep: () => HostedServerSleep | null;
  setHostedSleep: (hostedSleep: HostedServerSleep | null) => void;
  reconnect: () => Promise<void>;
  report: (error: unknown) => void;
}) {
  const { hostId, disposed, status } = options;
  const hostedServer = createWebHostedServerWake(options.accountFetch);
  let wakeReconnectTimer: number | undefined;
  let sleepRecheckTimer: number | undefined;
  /** Removes the listeners that wait for the user's input while the opened server sleeps. */
  let stopWaitingForInput: (() => void) | null = null;
  /** The next reconnect to a host that restarts into an update. The opened host has no other retry. */
  let restartRetry: ReturnType<typeof setTimeout> | null = null;

  /**
   * The opened host is offline. A hosted server that the account service stopped for no use waits for the
   * user's input. Another stopped hosted server starts, and the tab connects again. A server that starts
   * already is asked to start again, with no status read in between. The `error` of a failed connection
   * shows only for a host that does not sleep or wake: for those, the workspace shows why it waits.
   */
  function hostUnavailable(id: string, error?: unknown): void {
    const starting = options.hostedSleep() === "waking";
    void (starting ? runTeamEffect(hostedServer.wake(id)) : Promise.resolve(false)).then(async (waking) => {
      const availability = waking ? "waking" : await runTeamEffect(hostedServer.unavailable(id));
      if (disposed() || hostId() !== id || status() === "online") return;
      if (error !== undefined && availability !== "sleeping" && availability !== "waking") options.report(error);
      // The 5-minute recheck can find that the server does not sleep now, so input does not wake it.
      if (availability !== "sleeping") stopWaitingForInput?.();
      options.setHostedSleep(availability === "sleeping" ? "sleeping" : availability === "waking" ? "waking" : null);
      if (availability === "waking") reconnectAfterWake(id);
      else if (availability === "sleeping") waitForInput(id);
    });
  }
  function reconnectAfterWake(id: string): void {
    window.clearTimeout(wakeReconnectTimer);
    wakeReconnectTimer = window.setTimeout(() => {
      if (!disposed() && hostId() === id && status() === "offline") void options.reconnect().catch(options.report);
    }, WAKE_RECONNECT_DELAY_MS);
  }
  /** The next key or pointer press in the tab starts the sleeping server. */
  function waitForInput(id: string): void {
    stopWaitingForInput?.();
    const onInput = () => {
      stopWaitingForInput?.();
      if (disposed() || hostId() !== id || status() === "online") return;
      options.setHostedSleep("waking");
      void runTeamEffect(hostedServer.wakeForInput(id)).then((waking) => {
        if (disposed() || hostId() !== id || status() === "online") return;
        if (waking) reconnectAfterWake(id);
        else {
          options.setHostedSleep(null);
          hostUnavailable(id);
        }
      });
    };
    window.addEventListener("pointerdown", onInput, true);
    window.addEventListener("keydown", onInput, true);
    sleepRecheckTimer = window.setTimeout(() => hostUnavailable(id), SLEEP_RECHECK_MS);
    stopWaitingForInput = () => {
      window.removeEventListener("pointerdown", onInput, true);
      window.removeEventListener("keydown", onInput, true);
      window.clearTimeout(sleepRecheckTimer);
      stopWaitingForInput = null;
    };
  }
  function endSleep(): void {
    stopWaitingForInput?.();
    options.setHostedSleep(null);
  }
  /** `connect` clears `hostRestart`, so the retries count down instead of reading it again. */
  function retryAfterRestart(retries = HOST_RESTART_RETRY_LIMIT): void {
    if (restartRetry || disposed() || retries <= 0) return;
    const retryHostId = hostId();
    restartRetry = setTimeout(() => {
      restartRetry = null;
      if (disposed() || hostId() !== retryHostId || status() === "online") return;
      void options
        .reconnect()
        .catch(() => undefined)
        .then(() => {
          if (!disposed() && hostId() === retryHostId && status() !== "online") retryAfterRestart(retries - 1);
        });
    }, HOST_RESTART_RETRY_MS);
  }
  function dispose(): void {
    window.clearTimeout(wakeReconnectTimer);
    stopWaitingForInput?.();
    if (restartRetry) clearTimeout(restartRetry);
  }
  return { hostUnavailable, endSleep, retryAfterRestart, dispose };
}
