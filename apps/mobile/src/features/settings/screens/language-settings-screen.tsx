import { APP_LANGUAGE_OPTIONS } from "@openbot/i18n/languages";
import { Typography } from "heroui-native";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { saveAppLanguage, useAppLanguage } from "@/features/settings/model/app-language";
import { offerLayoutRestart } from "@/features/settings/model/layout-direction";
import { useBloubColors } from "@/shared/components/bloub-stage/bloub-look";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

function AppLanguageSection({ dark }: { dark: boolean }) {
  const { t } = useText();
  const language = useAppLanguage();
  const colors = useBloubColors();
  const [error, setError] = useState<string | null>(null);
  // React Native reads the layout direction at startup. A language of the other direction asks
  // for a restart; the text changes language at once in both cases.
  const offerRestart = () => offerLayoutRestart(colors.dark ? colors.dimBody : colors.body, setError);
  return (
    <SettingsSection footer={error ?? t("mobile.settings.language.footer")}>
      <SettingsRow
        trailing={
          <SettingsPicker
            value={language.value}
            options={APP_LANGUAGE_OPTIONS.map((option) => ({
              value: option.id,
              label: option.id === "system" ? t("mobile.settings.language.system") : option.label,
            }))}
            enabled={language.ready && !language.saving}
            dark={dark}
            label={t("mobile.settings.language.row")}
            onChange={(next) => {
              setError(null);
              void haptics.selection();
              void saveAppLanguage(next).then(offerRestart, () => {
                setError(t("mobile.settings.saveFailed"));
                void haptics.notification("error");
              });
            }}
          />
        }
      >
        <Typography.Paragraph>{t("mobile.settings.language.row")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

export function LanguageSettingsScreen() {
  const { theme } = useUniwind();
  return (
    <SettingsContent>
      <AppLanguageSection dark={theme === "dark"} />
    </SettingsContent>
  );
}
