import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useState } from "react";
import { Linking } from "react-native";
import { useUniwind } from "uniwind";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { NotificationMatrix } from "@/features/push-notifications/components/notification-matrix";
import { pushNotificationsNative } from "@/features/push-notifications/push-notifications-native";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { saveLiveActivitiesPreference, useLiveActivitiesPreference } from "@/features/settings/model/live-activities";
import {
  savePushNotificationPreference,
  usePushNotificationPreference,
} from "@/features/settings/model/push-notifications";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

/**
 * The one place for the notification settings. First what the user hears about from each server and
 * agent, which the host keeps for all of their devices, and the mute of this phone. Then the ways this
 * phone tells the user, and the one sound that they play. On iOS, notifications and Live Activities
 * tell the user, and the sound is there while either is on. Android has notifications only, which
 * reach the phone through Google. The server settings and the agent settings open this screen with
 * `serverId`, and the agent settings also with `agentId`, to show that server and that agent.
 */
export function NotificationsSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const { serverId, agentId } = useLocalSearchParams<{ serverId?: string; agentId?: string }>();
  const preference = usePushNotificationPreference();
  const liveActivities = useLiveActivitiesPreference();
  const [error, setError] = useState<string | null>(null);
  const [liveActivitiesError, setLiveActivitiesError] = useState<string | null>(null);
  const dark = theme === "dark";
  const busy = !preference.ready || preference.saving;
  const denied = preference.enabled && preference.permission === "denied";
  const soundAvailable = !busy && (preference.enabled || (!isAndroid && liveActivities.enabled));

  function save(change: Parameters<typeof savePushNotificationPreference>[0]) {
    setError(null);
    if (change.enabled !== undefined) {
      mobileAnalytics.track("notification_settings_action", {
        action: change.enabled ? "enabled" : "disabled",
        enabled: change.enabled,
      });
    }
    if (change.preview !== undefined) {
      mobileAnalytics.track("notification_settings_action", { action: "preview_toggled", enabled: change.preview });
    }
    void savePushNotificationPreference(change).catch(() => {
      setError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  }

  function saveLiveActivities(enabled: boolean) {
    setLiveActivitiesError(null);
    void saveLiveActivitiesPreference(enabled).catch(() => setLiveActivitiesError(t("mobile.settings.saveFailed")));
  }

  return (
    <SettingsContent>
      <NotificationMatrix initialServerId={serverId} highlightAgentId={agentId} />
      <SettingsSection
        title={t("mobile.settings.notifications.thisPhone")}
        footer={
          error ??
          (denied
            ? t(isAndroid ? "mobile.settings.notifications.deniedAndroid" : "mobile.settings.notifications.denied")
            : isAndroid
              ? `${t("mobile.settings.notifications.footerAndroid")}\n\n${t("mobile.settings.notifications.previewFooterAndroid")}`
              : `${t("mobile.settings.notifications.footer")}\n\n${t("mobile.settings.notifications.previewFooter")}`)
        }
      >
        <SettingsRow>
          <SettingsSwitch
            value={preference.enabled}
            disabled={busy}
            label={t("mobile.settings.notifications.toggle")}
            dark={dark}
            onValueChange={(enabled) => save({ enabled })}
          />
        </SettingsRow>
        {denied ? (
          <SettingsRow disclosure={false} onPress={() => void Linking.openSettings()}>
            <Typography.Paragraph>
              {t(
                isAndroid
                  ? "mobile.settings.notifications.openSettingsAndroid"
                  : "mobile.settings.notifications.openSettings",
              )}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        <SettingsRow>
          <SettingsSwitch
            value={preference.preview}
            disabled={busy || !preference.enabled}
            label={t("mobile.settings.notifications.preview")}
            dark={dark}
            onValueChange={(preview) => save({ preview })}
          />
        </SettingsRow>
      </SettingsSection>
      {isAndroid ? null : (
        <SettingsSection
          title={t("mobile.settings.liveActivities.title")}
          footer={liveActivitiesError ?? t("mobile.settings.liveActivities.footer")}
        >
          <SettingsRow>
            <SettingsSwitch
              value={liveActivities.enabled}
              disabled={!liveActivities.ready || liveActivities.saving}
              label={t("mobile.settings.liveActivities.toggle")}
              dark={dark}
              onValueChange={(enabled) => {
                mobileAnalytics.track("notification_settings_action", { action: "live_activities_toggled", enabled });
                saveLiveActivities(enabled);
              }}
            />
          </SettingsRow>
          {liveActivitiesError ? (
            <SettingsRow
              disabled={liveActivities.saving}
              disclosure={false}
              onPress={() => saveLiveActivities(liveActivities.enabled)}
            >
              <Typography.Paragraph>{t("mobile.settings.liveActivities.retry")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      )}
      <SettingsSection
        title={t("mobile.settings.notifications.sound")}
        footer={t(
          isAndroid ? "mobile.settings.notifications.soundFooterAndroid" : "mobile.settings.notifications.soundFooter",
        )}
      >
        {/* The hosts get the sound with the notification choices, also with notifications off. */}
        <SettingsRow>
          <SettingsSwitch
            value={preference.playSound}
            disabled={!soundAvailable}
            label={t("mobile.settings.notifications.playSound")}
            dark={dark}
            onValueChange={(playSound) => save({ playSound })}
          />
        </SettingsRow>
        <SettingsRow
          trailing={
            <SettingsPicker
              value={preference.sound}
              options={[
                { value: "openbot", label: t("mobile.settings.notifications.sound.openbot") },
                { value: "warm", label: t("mobile.settings.notifications.sound.warm") },
                { value: "mech", label: t("mobile.settings.notifications.sound.mech") },
                { value: "bubble", label: t("mobile.settings.notifications.sound.bubble") },
                { value: "press", label: t("mobile.settings.notifications.sound.press") },
                {
                  value: "default",
                  label: t(
                    isAndroid
                      ? "mobile.settings.notifications.sound.defaultAndroid"
                      : "mobile.settings.notifications.sound.default",
                  ),
                },
              ]}
              enabled={soundAvailable && preference.playSound}
              dark={dark}
              label={t("mobile.settings.notifications.sound")}
              onChange={(sound) => {
                void haptics.selection();
                save({ sound });
                // Without notification permission the phone plays nothing, as it would for a notification.
                void pushNotificationsNative?.previewSound(sound).catch(() => undefined);
              }}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.settings.notifications.sound")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
