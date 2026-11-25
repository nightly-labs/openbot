import type { AppTranslate } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { Notification } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import { notificationSettingsUrl, showRetainedNotification } from "../desktop-notifications";
import type { NotificationPreferenceStore } from "../notification-preference-store";
import { parseNotificationPreference } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface NotificationIpcDependencies {
  notificationPreference: NotificationPreferenceStore;
  translate: AppTranslate;
  requestPermission: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
}

export function notificationIpcHandlers({
  notificationPreference,
  translate,
  requestPermission,
  openExternal,
}: NotificationIpcDependencies): Pick<IpcGroupHandlers, "notifications"> {
  return {
    notifications: {
      getPreference: handler(() => notificationPreference.get()),
      setPreference: payloadHandler(parseNotificationPreference, async (preference) => {
        const saved = await runCauseEffect(notificationPreference.set(preference));
        await requestPermission();
        return saved;
      }),
      test: handler(() => {
        if (!Notification.isSupported()) throw new Error(sourceText("error.app.notificationsUnsupported"));
        showRetainedNotification(new Notification({ title: "OpenBot", body: translate("notification.test") }));
      }),
      openSettings: handler(async () => {
        const url = notificationSettingsUrl(process.platform);
        if (!url) throw new Error(sourceText("error.app.notificationSettingsMissing"));
        await openExternal(url);
      }),
    },
  };
}
