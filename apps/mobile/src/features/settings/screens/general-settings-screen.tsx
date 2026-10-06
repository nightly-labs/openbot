import { APP_LANGUAGE_OPTIONS } from "@openbot/i18n/languages";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { useUniwind } from "uniwind";
import { saveAnalyticsPreference, useAnalyticsPreference } from "@/features/analytics/preference";
import { dictationLanguageOptions } from "@/features/chat/model/voice-dictation";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
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
        <SettingsSwitch
          value={preference.enabled}
          disabled={!preference.ready || preference.saving}
          label={t("mobile.settings.liveActivities.toggle")}
          dark={dark}
          onValueChange={save}
        />
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
            <SettingsPicker
              value={value}
              options={[
                { value: "system", label: t("mobile.settings.appearance.system") },
                { value: "light", label: t("mobile.settings.appearance.light") },
                { value: "dark", label: t("mobile.settings.appearance.dark") },
              ]}
              enabled={ready && !saving}
              dark={theme === "dark"}
              label={t("mobile.settings.appearance.theme")}
              onChange={(next) => {
                setError(null);
                void haptics.selection();
                void saveAppearance(next).catch(() => {
                  setError(t("mobile.settings.appearance.saveFailed"));
                  void haptics.notification("error");
                });
              }}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.settings.appearance.theme")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection footer={agentColorError ?? t("mobile.settings.appearance.agentColorMessagesFooter")}>
        <SettingsRow>
          <SettingsSwitch
            value={agentColorMessages.enabled}
            disabled={!agentColorMessages.ready || agentColorMessages.saving}
            label={t("mobile.settings.appearance.agentColorMessages")}
            dark={theme === "dark"}
            onValueChange={(enabled) => {
              setAgentColorError(null);
              void saveAgentColorMessages(enabled).catch(() => {
                setAgentColorError(t("mobile.settings.saveFailed"));
                void haptics.notification("error");
              });
            }}
          />
        </SettingsRow>
      </SettingsSection>
      <LanguageSection dark={theme === "dark"} />
      <DictationSection dark={theme === "dark"} />
      <SettingsSection
        title={t("mobile.settings.feedback.title")}
        footer={hapticsError ?? t("mobile.settings.feedback.footer")}
      >
        <SettingsRow>
          <SettingsSwitch
            value={hapticsPreference.enabled}
            disabled={!hapticsPreference.ready || hapticsPreference.saving}
            label={t("mobile.settings.feedback.haptics")}
            dark={theme === "dark"}
            onValueChange={saveHaptics}
          />
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
          <SettingsSwitch
            value={analytics.enabled}
            disabled={!analytics.ready || analytics.saving}
            label={t("mobile.settings.privacy.analytics")}
            dark={theme === "dark"}
            onValueChange={saveAnalytics}
          />
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
