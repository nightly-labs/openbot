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
import type { GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import { SoundThemePicker } from "@openbot/ui/features/settings/SoundThemePicker";
import { Show } from "solid-js";
import { replayActionSoundChoice } from "../../action-sounds";
import { useI18n } from "../../i18n-context";

interface SettingsNotificationsTabProps {
  value: GeneralSettingsValue;
  onUpdateSetting: <Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]) => void;
  onUpdateSettings: (patch: Partial<GeneralSettingsValue>) => void;
  /** Shows one desktop notification now. Absent where there is no operating system to show it. */
  onTestNotification?: (() => void | Promise<void>) | undefined;
  /** Opens the operating system notification settings. Absent where the system has no such page. */
  onOpenNotificationSettings?: (() => void | Promise<void>) | undefined;
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
      <SettingsSection title={i18n.t("settings.alerts.title")}>
        <ItemGroup class="settings-modal-card">
          <SwitchField
            checked={props.value.desktopNotifications}
            onChange={(checked) => props.onUpdateSetting("desktopNotifications", checked)}
            label={i18n.t("settings.desktopNotifications.title")}
            description={i18n.t("settings.desktopNotifications.description")}
          />
          <Show when={props.onTestNotification}>
            {(onTestNotification) => (
              <Item>
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
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={i18n.t("settings.sounds.title")}>
        <ItemGroup class="settings-modal-card">
          <SwitchField
            checked={props.value.taskCompletionSound}
            onChange={(checked) => props.onUpdateSetting("taskCompletionSound", checked)}
            label={i18n.t("settings.taskSound.title")}
            description={i18n.t("settings.taskSound.description")}
          />
          <Item class="settings-modal-row settings-sound-theme-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.soundFeedback.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.soundFeedback.description")}</ItemDescription>
            </ItemContent>
            <SoundThemePicker
              value={props.value.soundFeedback ? props.value.soundTheme : "off"}
              onChange={(value) =>
                props.onUpdateSettings(
                  value === "off" ? { soundFeedback: false } : { soundFeedback: true, soundTheme: value },
                )
              }
              onReplay={replayActionSoundChoice}
            />
          </Item>
        </ItemGroup>
      </SettingsSection>
    </>
  );
}
