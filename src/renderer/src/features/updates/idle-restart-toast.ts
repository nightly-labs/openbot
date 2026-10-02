import type { UpdateStatus } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { restartReasonKey } from "@openbot/ui/features/updates/restart-reasons";
import { currentText } from "@openbot/ui/text";
import { type Accessor, createEffect, onCleanup } from "solid-js";

const TOAST_ID = "idle-app-restart";

/**
 * A notice while a restart that the user asked for waits for idle, so the user knows why the
 * routines wait and why OpenBot will restart. A restart that did not start stays as an error until
 * the user closes it. The text is built where the effect tracks it, so it follows a language change.
 */
export function createIdleRestartToast(options: { status: Accessor<UpdateStatus>; cancel: () => Promise<void> }): void {
  createEffect(
    () => {
      const restart = options.status().idleRestart;
      if (!restart || options.status().phase === "installing") return null;
      const { t, format, errorMessage } = currentText();
      if (restart.error !== undefined) {
        return {
          failed: true,
          title: t("update.idleRestart.failedTitle"),
          description: errorMessage(restart.error, t("update.idleRestart.failedTitle")),
          action: t("common.close"),
        };
      }
      const waiting =
        restart.waitingFor.length === 0
          ? ""
          : ` ${t("update.idleRestart.waitingFor", {
              reasons: format.list(restart.waitingFor.map((reason) => t(restartReasonKey(reason)))),
            })}`;
      return {
        failed: false,
        title:
          restart.target === "update" ? t("update.idleRestart.updateTitle") : t("update.idleRestart.relaunchTitle"),
        description: `${t("update.idleRestart.description")}${waiting}`,
        action: t("update.idleRestart.cancel"),
      };
    },
    (view) => {
      if (!view) {
        toast.dismiss(TOAST_ID);
        return;
      }
      const show = view.failed ? toast.error : toast;
      show(view.title, {
        id: TOAST_ID,
        description: view.description,
        duration: Number.POSITIVE_INFINITY,
        dismissible: false,
        action: {
          label: view.action,
          onClick: () => {
            options.cancel().catch((error: unknown) => {
              const text = currentText();
              toast.error(text.errorMessage(error, text.t("update.idleRestart.cancelFailed")));
            });
          },
        },
      });
    },
  );
  onCleanup(() => toast.dismiss(TOAST_ID));
}
