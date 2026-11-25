import type { AppTranslate } from "@openbot/i18n";
import { Effect } from "effect";
import { type BrowserWindow, dialog, Notification } from "electron";
import { showRetainedNotification } from "./desktop-notifications";
import { RemoteWorkflowError } from "./remote-service-effects";

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

export function notifyRemoteControlStarted(translate: AppTranslate, memberName: string): void {
  if (!Notification.isSupported()) return;
  showRetainedNotification(
    new Notification({
      title: translate("remoteDesktop.host.startedTitle"),
      body: translate("remoteDesktop.host.startedBody", { name: memberName }),
    }),
  );
}
