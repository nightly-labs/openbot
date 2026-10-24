import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useEffect } from "react";
import { View } from "react-native";
import { DEVICE_APP_NAME } from "@/features/device-apps/model/app-text";
import {
  answerDeviceAppConsent,
  type ConsentPrompt,
  dismissDeviceAppConsents,
  useDeviceAppConsent,
} from "@/features/device-apps/model/consent";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { type MobileText, useText } from "@/shared/lib/text";

/** What the agent wants to do, in the words of the user. An add names the item. */
function describeRequest({ t }: MobileText, { operation, title = "" }: ConsentPrompt): string {
  switch (operation) {
    case "calendar.list_events":
      return t("mobile.deviceApps.consent.calendarListEvents");
    case "calendar.add_event":
      return t("mobile.deviceApps.consent.calendarAddEvent", { title });
    case "reminders.list":
      return t("mobile.deviceApps.consent.remindersList");
    case "reminders.add":
      return t("mobile.deviceApps.consent.remindersAdd", { title });
    case "contacts.find":
      return t("mobile.deviceApps.consent.contactsFind");
    case "location.current":
      return t("mobile.deviceApps.consent.locationCurrent");
  }
}

/**
 * The first use of an app by an agent, or an add that is not allowed for good. The sheet closes by
 * itself when no prompt is left. A swipe down refuses what is open and saves nothing.
 */
export function DeviceAppConsentScreen() {
  const text = useText();
  const { t } = text;
  const prompt = useDeviceAppConsent((state) => state.prompts[0]);

  useEffect(() => () => dismissDeviceAppConsents(), []);
  useEffect(() => {
    if (!prompt && router.canGoBack()) router.back();
  }, [prompt]);

  if (!prompt) return null;
  const app = t(DEVICE_APP_NAME[prompt.app]);
  const answer = (choice: "once" | "always" | "deny") => {
    void haptics.impact("soft");
    answerDeviceAppConsent(prompt.requestId, choice);
  };
  return (
    <SheetScrollView scrollEdgeEffect={false} contentContainerClassName="gap-6 px-4 pb-safe-offset-5 pt-5">
      <View className="gap-2">
        <Typography.Heading type="h4" accessibilityRole="header">
          {t("mobile.deviceApps.consent.heading", { app })}
        </Typography.Heading>
        <Typography.Paragraph>{describeRequest(text, prompt)}</Typography.Paragraph>
        <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
          {t("mobile.deviceApps.consent.privacy")}
        </Typography.Paragraph>
      </View>
      <View className="gap-3">
        <Button onPress={() => answer("once")}>
          <Button.Label>{t("mobile.deviceApps.consent.once")}</Button.Label>
        </Button>
        <Button variant="secondary" onPress={() => answer("always")}>
          <Button.Label>{t("mobile.deviceApps.consent.always")}</Button.Label>
        </Button>
        <Button variant="ghost" onPress={() => answer("deny")}>
          <Button.Label className="text-danger-text">{t("mobile.deviceApps.consent.deny")}</Button.Label>
        </Button>
      </View>
    </SheetScrollView>
  );
}
