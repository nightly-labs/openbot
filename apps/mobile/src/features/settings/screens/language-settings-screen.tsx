import { APP_LANGUAGE_OPTIONS } from "@openbot/i18n/languages";
import { Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { useUniwind } from "uniwind";
import { dictationLanguageOptions } from "@/features/chat/model/voice-dictation";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { saveAppLanguage, useAppLanguage } from "@/features/settings/model/app-language";
import {
  AUTOMATIC_DICTATION_LANGUAGE,
  saveDictationLanguage,
  useDictationLanguage,
} from "@/features/settings/model/dictation-language";
import { haptics } from "@/shared/lib/haptics";
import { speechRecognition } from "@/shared/lib/speech-recognition";
import { useText } from "@/shared/lib/text";

function AppLanguageSection({ dark }: { dark: boolean }) {
  const { t } = useText();
  const language = useAppLanguage();
  const [error, setError] = useState<string | null>(null);
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
              void saveAppLanguage(next).catch(() => {
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

function DictationSection({ dark }: { dark: boolean }) {
  const { t } = useText();
  const language = useDictationLanguage();
  const [supported, setSupported] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void speechRecognition
      ?.getSupportedLocales({})
      .then(({ locales }) => {
        if (active) setSupported(locales);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  // Without the module the composer has no mic, so the setting would do nothing.
  if (!speechRecognition) return null;
  const automatic = language.value === AUTOMATIC_DICTATION_LANGUAGE;
  const options = dictationLanguageOptions(supported, automatic ? null : language.value, t);
  return (
    <SettingsSection
      title={t("mobile.settings.dictation.title")}
      footer={error ?? t("mobile.settings.dictation.footer")}
    >
      <SettingsRow
        trailing={
          <SettingsPicker
            value={language.value}
            options={[
              { value: AUTOMATIC_DICTATION_LANGUAGE, label: t("mobile.settings.dictation.automatic") },
              ...options.map((option) => ({ value: option.value, label: option.label })),
            ]}
            enabled={language.ready && !language.saving}
            dark={dark}
            label={t("mobile.settings.dictation.language")}
            onChange={(next) => {
              setError(null);
              void haptics.selection();
              void saveDictationLanguage(next).catch(() => {
                setError(t("mobile.settings.saveFailed"));
                void haptics.notification("error");
              });
            }}
          />
        }
      >
        <Typography.Paragraph>{t("mobile.settings.dictation.language")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

export function LanguageSettingsScreen() {
  const { theme } = useUniwind();
  return (
    <SettingsContent>
      <AppLanguageSection dark={theme === "dark"} />
      <DictationSection dark={theme === "dark"} />
    </SettingsContent>
  );
}
