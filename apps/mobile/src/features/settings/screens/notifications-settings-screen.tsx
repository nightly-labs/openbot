import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useState } from "react";
import { Linking } from "react-native";
import { useUniwind } from "uniwind";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { chatBubbleNative } from "@/features/chat-bubble/chat-bubble-native";
import { agentBubbleKey, useChatBubblePreference } from "@/features/chat-bubble/model/chat-bubble-preference";
import {
  saveAgentBubbleOverride,
  saveChatBubblePreference,
} from "@/features/chat-bubble/model/chat-bubble-preference-storage";
import { NotificationMatrix } from "@/features/push-notifications/components/notification-matrix";
import { pushNotificationsNative } from "@/features/push-notifications/push-notifications-native";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { saveLiveActivitiesPreference, useLiveActivitiesPreference } from "@/features/settings/model/live-activities";
import {
  savePushNotificationPreference,
  usePushNotificationPreference,
} from "@/features/settings/model/push-notifications";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { findChatAgent } from "@/features/workspace/model/directory-agents";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export function NotificationsSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const { serverId, agentId } = useLocalSearchParams<{ serverId?: string; agentId?: string }>();
  const preference = usePushNotificationPreference();
  const liveActivities = useLiveActivitiesPreference();
  const bubble = useChatBubblePreference();
  const workspaceAgents = useMobileWorkspaceSelector((current) => current.agents);
  const activeServerId = useMobileWorkspaceSelector((current) => current.activeServer.id);
  const [error, setError] = useState<string | null>(null);
  const [liveActivitiesError, setLiveActivitiesError] = useState<string | null>(null);
  const [bubbleError, setBubbleError] = useState<string | null>(null);
  const [bubblesAllowed, setBubblesAllowed] = useState(() => chatBubbleNative?.areBubblesEnabled() ?? false);
  const dark = theme === "dark";
  const busy = !preference.ready || preference.saving;
  const denied = preference.enabled && preference.permission === "denied";
  const soundAvailable = !busy && (preference.enabled || (!isAndroid && liveActivities.enabled));
  const bubbleBusy = !bubble.ready || bubble.saving;
  const bubbleAgent = agentId ? findChatAgent(workspaceAgents, agentId, serverId, activeServerId) : undefined;
  const bubbleOverride = bubbleAgent ? bubble.agents[agentBubbleKey(bubbleAgent.serverId, bubbleAgent.id)] : undefined;

  useFocusEffect(
    useCallback(() => {
      setBubblesAllowed(chatBubbleNative?.areBubblesEnabled() ?? false);
    }, []),
  );

  function saveBubble(enabled: boolean) {
    setBubbleError(null);
    mobileAnalytics.track("chat_bubble_settings_action", { action: enabled ? "enabled" : "disabled", enabled });
    void saveChatBubblePreference({ enabled }).catch(() => {
      setBubbleError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  }

  function saveBubbleAgent(targetServerId: string, targetAgentId: string, enabled: boolean | null) {
    setBubbleError(null);
    mobileAnalytics.track("chat_bubble_settings_action", {
      action: enabled === null ? "agent_default" : "agent_toggled",
      enabled: enabled ?? true,
    });
    void saveAgentBubbleOverride(targetServerId, targetAgentId, enabled).catch(() => {
      setBubbleError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  }

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
    if (change.threadReplies !== undefined) {
      mobileAnalytics.track("notification_settings_action", {
        action: "thread_replies_toggled",
        enabled: change.threadReplies,
      });
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
              ? `${t("mobile.settings.notifications.footerAndroid")}\n\n${t("mobile.settings.notifications.previewFooterAndroid")}\n\n${t("mobile.settings.notifications.threadRepliesFooter")}`
              : `${t("mobile.settings.notifications.footer")}\n\n${t("mobile.settings.notifications.previewFooter")}\n\n${t("mobile.settings.notifications.threadRepliesFooter")}`)
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
        <SettingsRow>
          <SettingsSwitch
            value={preference.threadReplies}
            disabled={busy || !preference.enabled}
            label={t("mobile.settings.notifications.threadReplies")}
            dark={dark}
            onValueChange={(threadReplies) => save({ threadReplies })}
          />
        </SettingsRow>
      </SettingsSection>
      {isAndroid ? (
        <SettingsSection
          title={t("mobile.settings.chatBubble.title")}
          footer={bubbleError ?? t("mobile.settings.chatBubble.footer")}
        >
          <SettingsRow>
            <SettingsSwitch
              value={bubble.enabled}
              disabled={bubbleBusy}
              label={t("mobile.settings.chatBubble.toggle")}
              dark={dark}
              onValueChange={saveBubble}
            />
          </SettingsRow>
          {bubble.enabled && !bubblesAllowed ? (
            <SettingsRow
              disclosure={false}
              onPress={() => {
                mobileAnalytics.track("chat_bubble_settings_action", { action: "open_settings", enabled: true });
                void chatBubbleNative?.openBubbleSettings();
              }}
            >
              <Typography.Paragraph>{t("mobile.settings.chatBubble.openSettings")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {bubbleAgent ? (
            <SettingsRow>
              <SettingsSwitch
                value={bubbleOverride ?? true}
                disabled={bubbleBusy || !bubble.enabled}
                label={t("mobile.settings.chatBubble.agentToggle")}
                dark={dark}
                onValueChange={(enabled) => saveBubbleAgent(bubbleAgent.serverId, bubbleAgent.id, enabled)}
              />
            </SettingsRow>
          ) : null}
          {bubbleAgent && bubbleOverride !== undefined ? (
            <SettingsRow onPress={() => saveBubbleAgent(bubbleAgent.serverId, bubbleAgent.id, null)}>
              <Typography.Paragraph>{t("mobile.settings.chatBubble.useDefault")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}
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
