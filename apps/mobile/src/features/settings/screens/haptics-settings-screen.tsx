import { Typography } from "heroui-native";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { saveHapticsPreference, useHapticsPreference } from "@/features/settings/model/haptics";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function HapticsSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const preference = useHapticsPreference();
  const [error, setError] = useState<string | null>(null);
  function save(enabled: boolean) {
    setError(null);
    void saveHapticsPreference(enabled).catch(() => {
      setError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  }
  return (
    <SettingsContent>
      <SettingsSection footer={error ?? t("mobile.settings.feedback.footer")}>
        <SettingsRow>
          <SettingsSwitch
            value={preference.enabled}
            disabled={!preference.ready || preference.saving}
            label={t("mobile.settings.feedback.haptics")}
            dark={theme === "dark"}
            onValueChange={save}
          />
        </SettingsRow>
        {error ? (
          <SettingsRow disabled={preference.saving} disclosure={false} onPress={() => save(preference.enabled)}>
            <Typography.Paragraph>{t("mobile.settings.feedback.retry")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </SettingsContent>
  );
}
