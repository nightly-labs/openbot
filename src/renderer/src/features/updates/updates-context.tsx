import type { UpdateStatus } from "@openbot/contracts/ipc";
import type { UpdateReadyPhase } from "@openbot/ui/features/updates/UpdateReadyScreen";
import { createSignal, createStore, flush, onSettled } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { FALLBACK_UPDATE_STATUS } from "../../app-defaults";
import { createSimpleContext } from "../../simple-context";
import { createIdleRestartToast } from "./idle-restart-toast";
import { createScheduledUpdateToast } from "./scheduled-update-toast";
import { readUpdateAttempt, updatesPort, writeUpdateAttempt } from "./updates-port";

/**
 * The updater, as the renderer sees it: one status main pushes, and one button
 * whose meaning depends on that status.
 *
 * Ungated - the app is fully usable while the updater is still checking, so
 * nothing waits on it, and consumers read `FALLBACK_UPDATE_STATUS` meanwhile.
 * It depends on no other domain, which is why it is the smallest one to move.
 */
const Updates = createSimpleContext({
  name: "Updates",
  init: () => {
    const [status, setStatus] = createSignal<UpdateStatus>(FALLBACK_UPDATE_STATUS);

    const [screen, setScreen] = createStore<{
      open: boolean;
      outcome: UpdateReadyPhase | null;
      target: string | null;
    }>({ open: false, outcome: null, target: null });
    let receivedStatus = false;
    let shownVersion: string | null = null;

    function receiveStatus(next: UpdateStatus): void {
      if (!receivedStatus && !next.managedByHost) {
        const target = readUpdateAttempt();
        if (target && next.phase !== "installing") {
          setScreen((draft) => {
            draft.open = true;
            draft.target = target;
            draft.outcome = next.currentVersion === target ? "success" : "interrupted";
          });
          writeUpdateAttempt(null);
          receivedStatus = true;
          if (next.phase === "ready") shownVersion = next.availableVersion;
          setStatus(next);
          return;
        }
      }
      receivedStatus = true;
      if (next.managedByHost) {
        setScreen((draft) => {
          draft.open = false;
          draft.outcome = null;
        });
      } else if (next.phase === "installing" || next.errorCode === "install_failed") {
        if (next.phase === "installing" && next.availableVersion) writeUpdateAttempt(next.availableVersion);
        if (status().phase !== next.phase || status().errorCode !== next.errorCode) {
          setScreen((draft) => {
            draft.open = true;
            draft.outcome = null;
          });
        }
      } else if (next.phase === "ready" && next.availableVersion !== shownVersion) {
        shownVersion = next.availableVersion;
        setScreen((draft) => {
          draft.open = true;
        });
      } else if (next.phase !== "ready" && screen.outcome === null) {
        setScreen((draft) => {
          draft.open = false;
        });
      }
      setStatus(next);
    }

    function dismissScreen(): void {
      setScreen((draft) => {
        draft.open = false;
        draft.outcome = null;
      });
    }

    async function openAction(): Promise<void> {
      const current = status();
      if (current.managedByHost) return;
      if (current.phase === "ready" || current.phase === "installing" || current.errorCode === "install_failed") {
        setScreen((draft) => {
          draft.open = true;
          draft.outcome = null;
        });
        return;
      }
      await runAction();
    }

    onSettled(() => {
      const unsubscribe = updatesPort().update.onEvent((next) => {
        flush(() => receiveStatus(next));
      });
      void updatesPort()
        .update.getStatus()
        .then((next) => {
          if (!receivedStatus) receiveStatus(next);
        })
        .catch(() => undefined);
      return unsubscribe;
    });

    /**
     * One button, four meanings. `ready` installs; `available` and a failed
     * download retry the download; everything else checks again. The status
     * main pushes back is applied here rather than waited for, so the button
     * settles even if the event is slower than the call.
     */
    async function runAction(): Promise<void> {
      const analytics = desktopAnalytics.scope();
      const current = status();
      // Host-managed tenants never act: the host owns check, download and install timing.
      // The button is disabled too; this is the second lock for callers that reach past it.
      if (current.managedByHost === true) return;
      const phase = current.phase;
      if (phase === "ready") {
        try {
          await updatesPort().update.install();
          analytics.track("update_action", { action: "install", result: "succeeded", phase: "installing" });
        } catch (error) {
          analytics.track("update_action", {
            action: "install",
            result: "failed",
            failure_code: "install_failed",
          });
          throw error;
        }
        return;
      }
      const action =
        phase === "available" || (phase === "error" && current.errorCode === "download_failed")
          ? ("download" as const)
          : ("check" as const);
      try {
        const next = action === "download" ? await updatesPort().update.download() : await updatesPort().update.check();
        receiveStatus(next);
        const succeeded =
          action === "download"
            ? next.phase === "downloading" || next.phase === "ready"
            : next.phase !== "error" && next.phase !== "unsupported";
        analytics.track("update_action", {
          action,
          result: succeeded ? "succeeded" : "failed",
          phase: next.phase,
          ...(succeeded ? {} : { failure_code: action === "download" ? "download_failed" : "check_failed" }),
        });
      } catch (error) {
        analytics.track("update_action", {
          action,
          result: "failed",
          failure_code: action === "download" ? "download_failed" : "check_failed",
        });
        throw error;
      }
    }

    /** Removes a restart that a server admin asked for. The update stays downloaded. */
    async function cancelScheduledRestart(): Promise<void> {
      setStatus(await updatesPort().update.cancelScheduledRestart());
    }

    createScheduledUpdateToast({ status, cancel: cancelScheduledRestart });

    /** Restarts OpenBot when no work runs. A downloaded update is installed by the same restart. */
    async function restartWhenIdle(): Promise<void> {
      const current = status();
      const target = current.phase === "ready" && current.managedByHost !== true ? "update" : "relaunch";
      setStatus(await updatesPort().update.restartWhenIdle(target));
    }

    async function cancelIdleRestart(): Promise<void> {
      setStatus(await updatesPort().update.cancelIdleRestart());
    }

    createIdleRestartToast({ status, cancel: cancelIdleRestart });

    return {
      status,
      screen,
      dismissScreen,
      openAction,
      runAction,
      cancelScheduledRestart,
      restartWhenIdle,
      cancelIdleRestart,
    };
  },
});

export const UpdatesProvider = Updates.provider;
export const useUpdates = Updates.use;
