import { createRequire } from "node:module";
import type * as WindowsNotifications from "@indutny/simple-windows-notifications";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";

const logger = createOpenBotLogger("windows-notification-history");
const requireModule = createRequire(import.meta.url);

export function clearEarlierWindowsNotifications(appUserModelId: string): void {
  if (process.platform !== "win32") return;
  try {
    const { Notifier }: typeof WindowsNotifications = requireModule("@indutny/simple-windows-notifications");
    new Notifier(appUserModelId).clearAll();
  } catch (error) {
    logger.warn("Unable to clear the notifications of the earlier run:", toLogValue(error));
  }
}
