import { Typography } from "heroui-native";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { type HapticsSetting, saveHapticsPreference, useHapticsPreference } from "@/features/settings/model/haptics";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function HapticsSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const preference = useHapticsPreference();
  const [failed, setFailed] = useState<HapticsSetting | null>(null);
  function save(setting: HapticsSetting, value: boolean) {
    setFailed(null);
    void saveHapticsPreference(setting, value).catch(() => {
      setFailed(setting);
      void haptics.notification("error");
    });
  }
  const busy = !preference.ready || preference.saving;
  return (
    <SettingsContent>
      <SettingsSection footer={failed ? t("mobile.settings.saveFailed") : t("mobile.settings.feedback.footer")}>
        <SettingsRow>
          <SettingsSwitch
            value={preference.enabled}
            disabled={busy}
            label={t("mobile.settings.feedback.haptics")}
            dark={theme === "dark"}
            onValueChange={(value) => save("enabled", value)}
          />
        </SettingsRow>
        {failed ? (
          <SettingsRow disabled={preference.saving} disclosure={false} onPress={() => save(failed, preference[failed])}>
            <Typography.Paragraph>{t("mobile.settings.feedback.retry")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <SettingsSection footer={t("mobile.settings.feedback.repliesFooter")}>
        <SettingsRow>
          <SettingsSwitch
            value={preference.enabled && preference.replies}
            disabled={busy || !preference.enabled}
            label={t("mobile.settings.feedback.replies")}
            dark={theme === "dark"}
            onValueChange={(value) => save("replies", value)}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
