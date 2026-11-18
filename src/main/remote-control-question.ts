import type { AppTranslate } from "@openbot/i18n";
import { Effect } from "effect";
import { type BrowserWindow, dialog, Notification } from "electron";
import { showRetainedNotification } from "./desktop-notifications";
import { RemoteWorkflowError } from "./remote-service-effects";

/**
 * Asks the person at this computer whether a member may control it, and answers true for Allow.
 *
 * The question is a sheet of the main window, which is shown first. On macOS a message box with no
 * window runs synchronously: it would stop the main process, and the end of the wait could not close
 * it. Interrupting the Effect closes the question. Enter and Escape choose Deny.
 */
export function createRemoteControlQuestion(options: {
  translate: AppTranslate;
  ensureMainWindow: () => Promise<BrowserWindow>;
  presentMainWindow: (window: BrowserWindow) => void;
}): (memberName: string) => Effect.Effect<boolean, RemoteWorkflowError> {
  return (memberName) =>
    Effect.tryPromise({
      try: async (signal) => {
        const window = await options.ensureMainWindow();
        if (signal.aborted || window.isDestroyed()) return false;
        options.presentMainWindow(window);
        const { response } = await dialog.showMessageBox(window, {
          type: "warning",
          message: options.translate("remoteDesktop.host.questionTitle", { name: memberName }),
          detail: options.translate("remoteDesktop.host.questionDetail", { name: memberName }),
          buttons: [options.translate("remoteDesktop.host.allow"), options.translate("remoteDesktop.host.deny")],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
          signal,
        });
        return !signal.aborted && response === 0;
      },
      catch: (cause) => new RemoteWorkflowError({ cause }),
    });
}

/** Tells the person at this computer that a member started to control it. */
export function notifyRemoteControlStarted(translate: AppTranslate, memberName: string): void {
  if (!Notification.isSupported()) return;
  showRetainedNotification(
    new Notification({
      title: translate("remoteDesktop.host.startedTitle"),
      body: translate("remoteDesktop.host.startedBody", { name: memberName }),
    }),
  );
}
