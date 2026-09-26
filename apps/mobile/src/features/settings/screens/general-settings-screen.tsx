import { Host, Picker, Switch } from "@expo/ui";
import { APP_LANGUAGE_OPTIONS } from "@openbot/i18n/languages";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { useUniwind } from "uniwind";
import { saveAnalyticsPreference, useAnalyticsPreference } from "@/features/analytics/preference";
import { dictationLanguageOptions } from "@/features/chat/model/voice-dictation";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { saveAppLanguage, useAppLanguage } from "@/features/settings/model/app-language";
import { saveAppearance, useAppearance } from "@/features/settings/model/appearance";
import {
  AUTOMATIC_DICTATION_LANGUAGE,
  saveDictationLanguage,
  useDictationLanguage,
} from "@/features/settings/model/dictation-language";
import { saveHapticsPreference, useHapticsPreference } from "@/features/settings/model/haptics";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { speechRecognition } from "@/shared/lib/speech-recognition";
import { useText } from "@/shared/lib/text";

function LanguageSection({ dark }: { dark: boolean }) {
  const { t } = useText();
  const language = useAppLanguage();
  const [error, setError] = useState<string | null>(null);
  return (
    <SettingsSection title={t("mobile.settings.language.title")} footer={error ?? t("mobile.settings.language.footer")}>
      <SettingsRow
        trailing={
          <Host matchContents colorScheme={dark ? "dark" : "light"}>
            <Picker
              selectedValue={language.value}
              enabled={language.ready && !language.saving}
              onValueChange={(next) => {
                setError(null);
                void saveAppLanguage(next).catch(() => setError(t("mobile.settings.saveFailed")));
              }}
            >
              {APP_LANGUAGE_OPTIONS.map((option) => (
                <Picker.Item
                  key={option.id}
                  label={option.id === "system" ? t("mobile.settings.language.system") : option.label}
                  value={option.id}
                />
              ))}
            </Picker>
          </Host>
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
  const options = dictationLanguageOptions(supported, automatic ? null : language.value);
  return (
    <SettingsSection
      title="Dictation"
      footer={
        error ??
        "The language you speak when you dictate a message. Automatic uses the first language in your phone settings that speech recognition supports."
      }
    >
      <SettingsRow
        trailing={
          <Host matchContents colorScheme={dark ? "dark" : "light"}>
            <Picker
              selectedValue={language.value}
              enabled={language.ready && !language.saving}
              onValueChange={(next) => {
                setError(null);
                void saveDictationLanguage(next).catch(() => setError("Could not save this setting. Try again."));
              }}
            >
              <Picker.Item label="Automatic" value={AUTOMATIC_DICTATION_LANGUAGE} />
              {options.map((option) => (
                <Picker.Item key={option.value} label={option.label} value={option.value} />
              ))}
            </Picker>
          </Host>
        }
      >
        <Typography.Paragraph>{t("mobile.settings.dictation.language")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

export function GeneralSettingsScreen() {
  const { theme } = useUniwind();
  const { activeServer } = useMobileWorkspace();
  const hapticsPreference = useHapticsPreference();
  const [hapticsError, setHapticsError] = useState<string | null>(null);
  function saveHaptics(enabled: boolean) {
    setHapticsError(null);
    void saveHapticsPreference(enabled).catch(() => {
      setHapticsError("Could not save this setting. Try again.");
    });
  }
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
      <SettingsSection title="Appearance" footer={error || "System follows your device’s appearance."}>
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
          <Typography.Paragraph>Theme</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <LanguageSection dark={theme === "dark"} />
      <DictationSection dark={theme === "dark"} />
      <SettingsSection
        title="Feedback"
        footer={hapticsError ?? "Touch feedback for actions in the app on this device."}
      >
        <SettingsRow>
          <Host
            matchContents={{ vertical: true }}
            style={{ width: "100%" }}
            colorScheme={theme === "dark" ? "dark" : "light"}
          >
            <Switch
              value={hapticsPreference.enabled}
              disabled={!hapticsPreference.ready || hapticsPreference.saving}
              label="Haptics"
              onValueChange={saveHaptics}
            />
          </Host>
        </SettingsRow>
        {hapticsError ? (
          <SettingsRow
            disabled={hapticsPreference.saving}
            disclosure={false}
            onPress={() => saveHaptics(hapticsPreference.enabled)}
          >
            <Typography.Paragraph>Retry saving haptics setting</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <SettingsSection
        title="Privacy"
        footer={
          analyticsError ??
          "Share feature use and connection results from this phone. Message contents and files are not sent."
        }
      >
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
            <Typography.Paragraph>Retry saving privacy setting</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <SettingsSection title="Conversations">
        <SettingsRow onPress={() => router.push("/settings/hidden-chats")}>
          <Typography.Paragraph>Hidden chats</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          onPress={() => router.push({ pathname: "/settings/deleted-chats", params: { serverId: activeServer.id } })}
        >
          <Typography.Paragraph>Deleted channels</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
