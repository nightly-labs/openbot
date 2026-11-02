import { Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { useUniwind } from "uniwind";
import { dictationLanguageOptions } from "@/features/chat/model/voice-dictation";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import {
  AUTOMATIC_DICTATION_LANGUAGE,
  saveDictationLanguage,
  useDictationLanguage,
} from "@/features/settings/model/dictation-language";
import { haptics } from "@/shared/lib/haptics";
import { speechRecognition } from "@/shared/lib/speech-recognition";
import { useText } from "@/shared/lib/text";

/**
 * The settings of the phone recognizer: the one language it hears. Settings > Voice shows it below the
 * choice of recognizer while the phone recognizer is checked.
 */
export function DictationLanguageSection() {
  const { theme } = useUniwind();
  const dark = theme === "dark";
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
      title={t("mobile.settings.voice.recognition.system")}
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
