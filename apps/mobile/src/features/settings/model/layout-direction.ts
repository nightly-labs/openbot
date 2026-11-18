import { localeDirection } from "@openbot/i18n/mobile";
import * as Updates from "expo-updates";
import { Alert, DevSettings, I18nManager } from "react-native";
import { currentLocale, currentText } from "@/shared/lib/text";

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
function syncLayoutDirection(): boolean {
  const rightToLeft = localeDirection(currentLocale()) === "rtl";
  // Both flags, every time: a change back to the first language before the restart cancels the change.
  I18nManager.allowRTL(rightToLeft);
  I18nManager.forceRTL(rightToLeft);
  return rightToLeft !== I18nManager.isRTL;
}

/**
 * Starts the app again in place, behind a reload screen in the color of the splash. A development
 * build has no update module, so its bundle loads again. On iOS the root view keeps the layout
 * direction that it had when the process started, so some views can keep the previous direction
 * until the user closes the app. The restart question tells the user so.
 */
async function restartApp(backgroundColor: string): Promise<void> {
  if (__DEV__) {
    DevSettings.reload();
    return;
  }
  await Updates.reloadAsync({
    reloadScreenOptions: { backgroundColor, fade: true, spinner: { enabled: false } },
  });
}

/**
 * Sets the layout direction for the app language, and asks to restart the app when this run has the
 * other direction.
 *
 * @param backgroundColor The color of the reload screen.
 * @param onRestartFailed Gets the message to show when the restart fails.
 */
export function offerLayoutRestart(backgroundColor: string, onRestartFailed: (message: string) => void): void {
  if (!syncLayoutDirection()) return;
  // The question is in the current language: a render can still hold the text of the previous one.
  const text = currentText();
  Alert.alert(text.t("mobile.settings.language.restartTitle"), text.t("mobile.settings.language.restartBody"), [
    { text: text.t("common.cancel"), style: "cancel" },
    {
      text: text.t("mobile.settings.language.restartNow"),
      onPress: () => {
        void restartApp(backgroundColor).catch(() => {
          onRestartFailed(text.t("mobile.settings.language.restartFailed"));
        });
      },
    },
  ]);
}
