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
import { saveLiveActivitiesPreference, useLiveActivitiesPreference } from "@/features/settings/model/live-activities";
import { saveAgentColorMessages, useAgentColorMessages } from "@/features/settings/model/message-color";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { isIOS } from "@/shared/lib/platform";
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
                void haptics.selection();
                void saveAppLanguage(next).catch(() => {
                  setError(t("mobile.settings.saveFailed"));
                  void haptics.notification("error");
                });
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
  const options = dictationLanguageOptions(supported, automatic ? null : language.value, t);
  return (
    <SettingsSection
      title={t("mobile.settings.dictation.title")}
      footer={error ?? t("mobile.settings.dictation.footer")}
    >
      <SettingsRow
        trailing={
          <Host matchContents colorScheme={dark ? "dark" : "light"}>
            <Picker
              selectedValue={language.value}
              enabled={language.ready && !language.saving}
              onValueChange={(next) => {
                setError(null);
                void haptics.selection();
                void saveDictationLanguage(next).catch(() => {
                  setError(t("mobile.settings.saveFailed"));
                  void haptics.notification("error");
                });
              }}
            >
              <Picker.Item label={t("mobile.settings.dictation.automatic")} value={AUTOMATIC_DICTATION_LANGUAGE} />
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

/** Live Activities exist only on iOS. iOS Settings can also turn them off for the app. */
function LiveActivitiesSection({ dark }: { dark: boolean }) {
  const { t } = useText();
  const preference = useLiveActivitiesPreference();
  const [error, setError] = useState<string | null>(null);
  function save(enabled: boolean) {
    setError(null);
    void saveLiveActivitiesPreference(enabled).catch(() => setError(t("mobile.settings.saveFailed")));
  }
  if (!isIOS) return null;
  return (
    <SettingsSection
      title={t("mobile.settings.liveActivities.title")}
      footer={error ?? t("mobile.settings.liveActivities.footer")}
    >
      <SettingsRow>
        <Host matchContents={{ vertical: true }} style={{ width: "100%" }} colorScheme={dark ? "dark" : "light"}>
          <Switch
            value={preference.enabled}
            disabled={!preference.ready || preference.saving}
            label={t("mobile.settings.liveActivities.toggle")}
            onValueChange={save}
          />
        </Host>
      </SettingsRow>
      {error ? (
        <SettingsRow disabled={preference.saving} disclosure={false} onPress={() => save(preference.enabled)}>
          <Typography.Paragraph>{t("mobile.settings.liveActivities.retry")}</Typography.Paragraph>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}

export function GeneralSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const { activeServer } = useMobileWorkspace();
  const hapticsPreference = useHapticsPreference();
  const [hapticsError, setHapticsError] = useState<string | null>(null);
  function saveHaptics(enabled: boolean) {
    setHapticsError(null);
    void saveHapticsPreference(enabled).catch(() => {
      setHapticsError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
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
      setAnalyticsError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  }
  const { value, ready, saving } = useAppearance();
  const [error, setError] = useState<string | null>(null);
  const agentColorMessages = useAgentColorMessages();
  const [agentColorError, setAgentColorError] = useState<string | null>(null);
  return (
    <SettingsContent>
      <SettingsSection
        title={t("mobile.settings.appearance.title")}
        footer={error || t("mobile.settings.appearance.footer")}
      >
        <SettingsRow
          trailing={
            <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
              <Picker
                selectedValue={value}
                enabled={ready && !saving}
                onValueChange={(next) => {
                  setError(null);
                  void haptics.selection();
                  void saveAppearance(next).catch(() => {
                    setError(t("mobile.settings.appearance.saveFailed"));
                    void haptics.notification("error");
                  });
                }}
              >
                <Picker.Item label={t("mobile.settings.appearance.system")} value="system" />
                <Picker.Item label={t("mobile.settings.appearance.light")} value="light" />
                <Picker.Item label={t("mobile.settings.appearance.dark")} value="dark" />
              </Picker>
            </Host>
          }
        >
          <Typography.Paragraph>{t("mobile.settings.appearance.theme")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection footer={agentColorError ?? t("mobile.settings.appearance.agentColorMessagesFooter")}>
        <SettingsRow>
          <Host
            matchContents={{ vertical: true }}
            style={{ width: "100%" }}
            colorScheme={theme === "dark" ? "dark" : "light"}
          >
            <Switch
              value={agentColorMessages.enabled}
              disabled={!agentColorMessages.ready || agentColorMessages.saving}
              label={t("mobile.settings.appearance.agentColorMessages")}
              onValueChange={(enabled) => {
                setAgentColorError(null);
                void saveAgentColorMessages(enabled).catch(() => {
                  setAgentColorError(t("mobile.settings.saveFailed"));
                  void haptics.notification("error");
                });
              }}
            />
          </Host>
        </SettingsRow>
      </SettingsSection>
      <LanguageSection dark={theme === "dark"} />
      <DictationSection dark={theme === "dark"} />
      <SettingsSection
        title={t("mobile.settings.feedback.title")}
        footer={hapticsError ?? t("mobile.settings.feedback.footer")}
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
              label={t("mobile.settings.feedback.haptics")}
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
            <Typography.Paragraph>{t("mobile.settings.feedback.retry")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <LiveActivitiesSection dark={theme === "dark"} />
      <SettingsSection
        title={t("mobile.settings.privacy.title")}
        footer={analyticsError ?? t("mobile.settings.privacy.footer")}
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
              label={t("mobile.settings.privacy.analytics")}
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
            <Typography.Paragraph>{t("mobile.settings.privacy.retry")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <SettingsSection title={t("mobile.settings.conversations.title")}>
        <SettingsRow onPress={() => router.push("/settings/hidden-chats")}>
          <Typography.Paragraph>{t("mobile.settings.conversations.hiddenChats")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          onPress={() => router.push({ pathname: "/settings/deleted-chats", params: { serverId: activeServer.id } })}
        >
          <Typography.Paragraph>{t("mobile.settings.conversations.deletedChannels")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
