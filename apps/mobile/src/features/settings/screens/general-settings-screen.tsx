import { Host, Picker, Switch } from "@expo/ui";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { saveAnalyticsPreference, useAnalyticsPreference } from "@/features/analytics/preference";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { saveAppearance, useAppearance } from "@/features/settings/model/appearance";

export function GeneralSettingsScreen() {
  const { theme } = useUniwind();
  const analytics = useAnalyticsPreference();
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [retryAnalyticsValue, setRetryAnalyticsValue] = useState<boolean | null>(null);
  function saveAnalytics(enabled: boolean) {
    setAnalyticsError(null);
    setRetryAnalyticsValue(null);
    void saveAnalyticsPreference(enabled).catch(() => {
      setRetryAnalyticsValue(enabled);
      setAnalyticsError("Could not save this setting. Try again.");
    });
  }
  const { value, ready, saving } = useAppearance();
  const [error, setError] = useState<string | null>(null);
  return (
    <SettingsContent>
      <SettingsSection title="Appearance">
        <SettingsRow
          trailing={
            <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
              <Picker
                selectedValue={value}
                enabled={ready && !saving}
                onValueChange={(next) => {
                  setError(null);
                  void saveAppearance(next).catch(() => setError("Could not save appearance. Try again."));
                }}
              >
                <Picker.Item label="System" value="system" />
                <Picker.Item label="Light" value="light" />
                <Picker.Item label="Dark" value="dark" />
              </Picker>
            </Host>
          }
        >
          <Typography.Paragraph type="body-sm">Theme</Typography.Paragraph>
        </SettingsRow>
        <SettingsNote>{error || "System follows your device’s appearance."}</SettingsNote>
      </SettingsSection>
      <SettingsSection title="Privacy">
        <SettingsRow>
          <Host
            matchContents={{ vertical: true }}
            style={{ width: "100%" }}
            colorScheme={theme === "dark" ? "dark" : "light"}
          >
            <Switch
              value={analytics.enabled}
              disabled={!analytics.ready || analytics.saving}
              label="Share product analytics"
              onValueChange={saveAnalytics}
            />
          </Host>
        </SettingsRow>
        {retryAnalyticsValue !== null ? (
          <SettingsRow
            disabled={analytics.saving}
            disclosure={false}
            onPress={() => saveAnalytics(retryAnalyticsValue)}
          >
            <Typography.Paragraph type="body-sm">Retry saving privacy setting</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        <SettingsNote>
          {analyticsError ??
            "Share feature use and connection results from this phone. Message contents and files are not sent."}
        </SettingsNote>
      </SettingsSection>
      <SettingsSection title="Conversations">
        <SettingsRow
          onPress={() => router.push("/settings/hidden-chats")}
          supportingText="Show conversations you have hidden"
        >
          <Typography.Paragraph type="body-sm">Hidden chats</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
