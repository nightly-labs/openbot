import type { ServerNotificationLevel } from "@openbot/contracts/ipc";
import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  SwitchField,
  toast,
} from "@openbot/ui";
import {
  ACTION_SOUND_CHOICES,
  type GeneralSettingsValue,
  TASK_SOUND_CHOICES,
} from "@openbot/ui/features/settings/app-settings";
import { NotificationMatrix, NotificationScopeTitle } from "@openbot/ui/features/settings/NotificationMatrix";
import { SoundChoiceSelect } from "@openbot/ui/features/settings/SoundChoiceSelect";
import { Show } from "solid-js";
import { playSoundChoice } from "../../completion-sound";
import { useI18n } from "../../i18n-context";
import type { NotificationLevelsStore } from "./notification-levels-store";

interface SettingsNotificationsTabProps {
  value: GeneralSettingsValue;
  onUpdateSetting: <Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]) => void;
  onUpdateSettings: (patch: Partial<GeneralSettingsValue>) => void;
  onTestNotification?: (() => void | Promise<void>) | undefined;
  onOpenNotificationSettings?: (() => void | Promise<void>) | undefined;
  levels: NotificationLevelsStore;
  onSetServerLevel: (serverId: string, level: ServerNotificationLevel) => Promise<void>;
  onSetServerMuted: (serverId: string, muted: boolean, durationMs?: number) => Promise<void>;
  focusRequest?: { serverId: string; nonce: number } | null | undefined;
  menuMount?: HTMLElement | undefined;
}

export function SettingsNotificationsTab(props: SettingsNotificationsTabProps) {
  const i18n = useI18n();
  const runNotificationAction = (
    action: () => void | Promise<void>,
    failed: "settings.testNotification.failed" | "settings.testNotification.openSettingsFailed",
  ) => {
    void Promise.resolve()
      .then(action)
      .catch(() =>
        toast.error(i18n.t(failed), { report: { operation: "settings", source: "system", cause_code: "unknown" } }),
      );
  };
  return (
    <>
      <SettingsSection
        title={
          <NotificationScopeTitle
            title={i18n.t("settings.notifications.whatYouHear")}
            scope="settings.notifications.allDevices"
          />
        }
      >
        <NotificationMatrix
          data-settings-row="settings.notifications.whatYouHear"
          servers={props.levels.matrixServers()}
          device="computer"
          onSetServerLevel={props.onSetServerLevel}
          onSetAgentLevel={props.levels.setAgentLevel}
          onMute={(serverId, durationMs) =>
            durationMs === null
              ? props.onSetServerMuted(serverId, true)
              : props.onSetServerMuted(serverId, true, durationMs)
          }
          onUnmute={(serverId) => props.onSetServerMuted(serverId, false)}
          onRetry={props.levels.retry}
          focusRequest={props.focusRequest}
          menuMount={props.menuMount}
        />
      </SettingsSection>

      <SettingsSection title={i18n.t("settings.notifications.thisComputer")}>
        <ItemGroup class="settings-modal-card">
          <SwitchField
            data-settings-row="settings.desktopNotifications.title"
            checked={props.value.desktopNotifications}
            onChange={(checked) => props.onUpdateSetting("desktopNotifications", checked)}
            label={i18n.t("settings.desktopNotifications.title")}
            description={i18n.t("settings.desktopNotifications.description")}
          />
          <SwitchField
            data-settings-row="settings.notificationPreview.title"
            checked={props.value.notificationPreview}
            disabled={!props.value.desktopNotifications}
            onChange={(checked) => props.onUpdateSetting("notificationPreview", checked)}
            label={i18n.t("settings.notificationPreview.title")}
            description={i18n.t("settings.notificationPreview.description")}
          />
          <Show when={props.onTestNotification}>
            {(onTestNotification) => (
              <Item data-settings-row="settings.testNotification.title">
                <ItemContent>
                  <ItemTitle>{i18n.t("settings.testNotification.title")}</ItemTitle>
                  <ItemDescription>{i18n.t("settings.testNotification.description")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Show when={props.onOpenNotificationSettings}>
                    {(onOpenNotificationSettings) => (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          runNotificationAction(
                            onOpenNotificationSettings(),
                            "settings.testNotification.openSettingsFailed",
                          )
                        }
                      >
                        {i18n.t("settings.testNotification.openSettings")}
                      </Button>
                    )}
                  </Show>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => runNotificationAction(onTestNotification(), "settings.testNotification.failed")}
                  >
                    {i18n.t("settings.testNotification.action")}
                  </Button>
                </ItemActions>
              </Item>
            )}
          </Show>
          <Item data-settings-row="settings.taskSound.title" class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.taskSound.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.taskSound.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <SoundChoiceSelect
                label={i18n.t("settings.taskSound.title")}
                choices={TASK_SOUND_CHOICES}
                value={props.value.taskSound}
                onChange={(value) => props.onUpdateSetting("taskSound", value)}
                onPreview={playSoundChoice}
                mount={props.menuMount}
              />
            </ItemActions>
          </Item>
          <Item data-settings-row="settings.soundFeedback.title" class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.soundFeedback.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.soundFeedback.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <SoundChoiceSelect
                label={i18n.t("settings.soundFeedback.title")}
                choices={ACTION_SOUND_CHOICES}
                value={props.value.soundFeedback ? props.value.soundTheme : "off"}
                onChange={(value) =>
                  props.onUpdateSettings(
                    value === "off" ? { soundFeedback: false } : { soundFeedback: true, soundTheme: value },
                  )
                }
                onPreview={playSoundChoice}
                mount={props.menuMount}
              />
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>
    </>
  );
}
