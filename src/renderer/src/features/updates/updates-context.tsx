import type { UpdateStatus } from "@openbot/contracts/ipc";
import { createSignal, flush, onSettled } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { FALLBACK_UPDATE_STATUS } from "../../app-defaults";
import { createSimpleContext } from "../../simple-context";
import { createIdleRestartToast } from "./idle-restart-toast";
import { createScheduledUpdateToast } from "./scheduled-update-toast";
import { idleRestartTarget, updatesPort } from "./updates-port";

const Updates = createSimpleContext({
  name: "Updates",
  init: () => {
    const [status, setStatus] = createSignal<UpdateStatus>(FALLBACK_UPDATE_STATUS);

    onSettled(() => {
      const unsubscribe = updatesPort().update.onEvent((next) => {
        flush(() => setStatus(next));
      });
      void updatesPort()
        .update.getStatus()
        .then(setStatus)
        .catch(() => undefined);
      return unsubscribe;
    });

    async function runAction(): Promise<void> {
      const analytics = desktopAnalytics.scope();
      const current = status();
      if (current.managedByHost === true) return;
      const phase = current.phase;
      if (phase === "ready") {
        try {
          const next = await updatesPort().update.install();
          setStatus(next);
          analytics.track("update_action", { action: "install", result: "succeeded", phase: next.phase });
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
        setStatus(next);
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

    async function cancelScheduledRestart(): Promise<void> {
      setStatus(await updatesPort().update.cancelScheduledRestart());
    }

    createScheduledUpdateToast({ status, cancel: cancelScheduledRestart });

    async function restartWhenIdle(): Promise<void> {
      setStatus(await updatesPort().update.restartWhenIdle(idleRestartTarget(status())));
    }

    async function cancelIdleRestart(): Promise<void> {
      setStatus(await updatesPort().update.cancelIdleRestart());
    }

    createIdleRestartToast({ status, cancel: cancelIdleRestart });

    return { status, runAction, cancelScheduledRestart, restartWhenIdle, cancelIdleRestart };
  },
});

export const UpdatesProvider = Updates.provider;
export const useUpdates = Updates.use;
