import type { HostedServerIssue, HostedServerSleep } from "@openbot/contracts/ipc";
import { runTeamEffect } from "@openbot/team-client";
import { createWebHostedServerWake } from "./web-hosted-server-wake";

const START_LIMIT_MS = 5 * 60_000;

/** Hosted state owns wake and sleep. The workspace recovery controller owns connection attempts. */
export function createWebHostLifecycle(options: {
  accountFetch: typeof fetch;
  hostId: () => string | null;
  disposed: () => boolean;
  status: () => "connecting" | "online" | "offline";
  hostedSleep: () => HostedServerSleep | null;
  setHostedSleep: (value: HostedServerSleep | null) => void;
  setIssue: (value: HostedServerIssue | null) => void;
  suspend: () => void;
  recover: () => void;
}) {
  let hosted = createWebHostedServerWake(options.accountFetch);
  let revision = 0;
  let expired = false;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  let sleepTimer: ReturnType<typeof setTimeout> | undefined;
  let removeInput: (() => void) | undefined;
  let waking: Promise<void> | null = null;
  const current = (id: string, version: number) =>
    !options.disposed() && options.hostId() === id && revision === version;

  function clearSleep() {
    removeInput?.();
    removeInput = undefined;
    clearTimeout(sleepTimer);
  }
  function starting(id: string) {
    options.setHostedSleep("waking");
    options.setIssue(null);
    if (startTimer !== undefined) return;
    startTimer = setTimeout(() => {
      startTimer = undefined;
      if (options.disposed() || options.hostId() !== id || options.status() === "online") return;
      cancelPending();
      expired = true;
      options.setHostedSleep(null);
      options.setIssue("start_timeout");
    }, START_LIMIT_MS);
  }
  function waitForInput(id: string) {
    clearSleep();
    const version = revision;
    const input = () => {
      if (current(id, version)) void retry();
    };
    window.addEventListener("pointerdown", input, true);
    window.addEventListener("keydown", input, true);
    removeInput = () => {
      window.removeEventListener("pointerdown", input, true);
      window.removeEventListener("keydown", input, true);
    };
    sleepTimer = setTimeout(() => {
      if (current(id, version) && !document.hidden)
        void hostUnavailable(id).then((retry) => {
          if (retry) options.recover();
        });
    }, START_LIMIT_MS);
  }
  async function hostUnavailable(id: string, opened = false): Promise<boolean> {
    const version = revision;
    if (!current(id, version) || document.hidden) return false;
    const availability = await runTeamEffect(hosted.unavailable(id, { wake: !expired }));
    if (!current(id, version) || options.status() === "online") return false;
    if (availability === "ended") {
      options.setHostedSleep(null);
      options.setIssue("plan_ended");
      options.suspend();
      return false;
    }
    if (availability === "sleeping") {
      options.setHostedSleep("sleeping");
      options.suspend();
      if (opened) {
        await retry();
        return false;
      }
      waitForInput(id);
      return false;
    }
    clearSleep();
    if (availability === "waking" && !expired) starting(id);
    else if (!startTimer) options.setHostedSleep(null);
    return true;
  }
  function retry(): Promise<void> {
    if (waking) return waking;
    const id = options.hostId();
    if (!id || document.hidden) return Promise.resolve();
    const version = revision;
    clearSleep();
    expired = false;
    clearTimeout(startTimer);
    startTimer = undefined;
    options.setIssue(null);
    starting(id);
    const promise = runTeamEffect(hosted.wakeForInput(id))
      .then(async (started) => {
        if (!current(id, version)) return;
        if (!started) {
          clearTimeout(startTimer);
          startTimer = undefined;
          options.setHostedSleep(null);
          options.setIssue("wake_failed");
          const availability = await runTeamEffect(hosted.unavailable(id, { wake: false }));
          if (!current(id, version)) return;
          if (availability === "ended") {
            options.setIssue("plan_ended");
            options.suspend();
            return;
          }
        }
        options.recover();
      })
      .finally(() => {
        if (waking === promise) waking = null;
      });
    waking = promise;
    return promise;
  }
  function cancelPending() {
    revision += 1;
    clearSleep();
    hosted.dispose();
    hosted = createWebHostedServerWake(options.accountFetch);
    waking = null;
  }
  function endSleep() {
    cancelPending();
    clearSleep();
    clearTimeout(startTimer);
    startTimer = undefined;
    expired = false;
    waking = null;
    options.setHostedSleep(null);
    options.setIssue(null);
  }
  function dispose() {
    endSleep();
    hosted.dispose();
  }
  function resume() {
    const id = options.hostId();
    if (!id) return;
    if (options.hostedSleep() === "sleeping") waitForInput(id);
    else if (options.hostedSleep() === "waking" || expired) options.recover();
  }
  return { hostUnavailable, retry, endSleep, cancelPending, resume, retryAfterRestart: options.recover, dispose };
}
