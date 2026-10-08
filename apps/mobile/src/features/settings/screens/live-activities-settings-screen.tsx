import { Typography } from "heroui-native";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { saveLiveActivitiesPreference, useLiveActivitiesPreference } from "@/features/settings/model/live-activities";
import { useText } from "@/shared/lib/text";

/** Live Activities exist only on iOS, so Settings links here only on iOS. iOS Settings can also turn them off for the app. */
export function LiveActivitiesSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const preference = useLiveActivitiesPreference();
  const [error, setError] = useState<string | null>(null);
  function save(enabled: boolean) {
    setError(null);
    void saveLiveActivitiesPreference(enabled).catch(() => setError(t("mobile.settings.saveFailed")));
  }
  return (
    <SettingsContent>
      <SettingsSection footer={error ?? t("mobile.settings.liveActivities.footer")}>
        <SettingsRow>
          <SettingsSwitch
            value={preference.enabled}
            disabled={!preference.ready || preference.saving}
            label={t("mobile.settings.liveActivities.toggle")}
            dark={theme === "dark"}
            onValueChange={save}
          />
        </SettingsRow>
        {error ? (
          <SettingsRow disabled={preference.saving} disclosure={false} onPress={() => save(preference.enabled)}>
            <Typography.Paragraph>{t("mobile.settings.liveActivities.retry")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </SettingsContent>
  );
}
