import { Typography } from "heroui-native";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { saveAnalyticsPreference, useAnalyticsPreference } from "@/features/analytics/preference";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function PrivacySettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const analytics = useAnalyticsPreference();
  const [error, setError] = useState<string | null>(null);
  const [retryValue, setRetryValue] = useState<boolean | null>(null);
  function save(enabled: boolean) {
    setError(null);
    setRetryValue(null);
    void saveAnalyticsPreference(enabled).catch(() => {
      setRetryValue(enabled);
      setError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  }
  return (
    <SettingsContent>
      <SettingsSection footer={error ?? t("mobile.settings.privacy.footer")}>
        <SettingsRow>
          <SettingsSwitch
            value={analytics.enabled}
            disabled={!analytics.ready || analytics.saving}
            label={t("mobile.settings.privacy.analytics")}
            dark={theme === "dark"}
            onValueChange={save}
          />
        </SettingsRow>
        {retryValue !== null ? (
          <SettingsRow disabled={analytics.saving} disclosure={false} onPress={() => save(retryValue)}>
            <Typography.Paragraph>{t("mobile.settings.privacy.retry")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </SettingsContent>
  );
}
