import { localeDirection } from "@openbot/i18n/mobile";
import * as Updates from "expo-updates";
import { DevSettings, I18nManager } from "react-native";
import { currentLocale } from "@/shared/lib/text";

/**
 * Sets the layout direction that React Native uses from the next start: right to left for a
 * right-to-left app language, and left to right for all other languages, also on a phone whose own
 * language is right to left. React Native reads the direction once at startup, so this run keeps
 * its layout.
 *
 * Call it only after the app language is read.
 *
 * @returns True when the layout of this run has the other direction, so a restart changes it.
 */
export function syncLayoutDirection(): boolean {
  const rightToLeft = localeDirection(currentLocale()) === "rtl";
  // Both flags, every time: a change back to the first language before the restart cancels the change.
  I18nManager.allowRTL(rightToLeft);
  I18nManager.forceRTL(rightToLeft);
  return rightToLeft !== I18nManager.isRTL;
}

/**
 * Starts the app again in place, behind a reload screen in the color of the splash. A development
 * build has no update module, so its bundle loads again.
 */
export async function restartApp(backgroundColor: string): Promise<void> {
  if (__DEV__) {
    DevSettings.reload();
    return;
  }
  await Updates.reloadAsync({
    reloadScreenOptions: { backgroundColor, fade: true, spinner: { enabled: false } },
  });
}
