import type { UpdateStatus } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { restartReasonKey } from "@openbot/ui/features/updates/restart-reasons";
import { currentText } from "@openbot/ui/text";
import { type Accessor, createEffect, onCleanup } from "solid-js";

const TOAST_ID = "idle-app-restart";

/**
 * A notice while a restart that the user asked for waits for idle, so the user knows why the
 * routines wait and why OpenBot will restart. A restart that did not start stays as an error until
 * the user closes it.
 */
export function createIdleRestartToast(options: { status: Accessor<UpdateStatus>; cancel: () => Promise<void> }): void {
  createEffect(
    () => {
      const restart = options.status().idleRestart;
      return restart && options.status().phase !== "installing"
        ? { target: restart.target, waitingFor: restart.waitingFor.join(), error: restart.error ?? null }
        : null;
    },
    (view) => {
      if (!view) {
        toast.dismiss(TOAST_ID);
        return;
      }
      const { t, format, errorMessage } = currentText();
      const cancel = (label: string) => ({
        label,
        onClick: () => {
          options.cancel().catch((error: unknown) => {
            const text = currentText();
            toast.error(text.errorMessage(error, text.t("update.idleRestart.cancelFailed")));
          });
        },
      });
      if (view.error !== null) {
        toast.error(t("update.idleRestart.failedTitle"), {
          id: TOAST_ID,
          description: errorMessage(view.error, t("update.idleRestart.failedTitle")),
          duration: Number.POSITIVE_INFINITY,
          dismissible: false,
          action: cancel(t("common.close")),
        });
        return;
      }
      const reasons = view.waitingFor === "" ? [] : view.waitingFor.split(",");
      const description =
        reasons.length === 0
          ? t("update.idleRestart.description")
          : `${t("update.idleRestart.description")} ${t("update.idleRestart.waitingFor", {
              reasons: format.list(reasons.map((reason) => t(restartReasonKey(reason)))),
            })}`;
      toast(view.target === "update" ? t("update.idleRestart.updateTitle") : t("update.idleRestart.relaunchTitle"), {
        id: TOAST_ID,
        description,
        duration: Number.POSITIVE_INFINITY,
        dismissible: false,
        action: cancel(t("update.idleRestart.cancel")),
      });
    },
  );
  onCleanup(() => toast.dismiss(TOAST_ID));
}
