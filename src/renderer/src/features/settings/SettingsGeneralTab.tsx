import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  ConfirmDialog,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  SwitchField,
  toast,
} from "@openbot/ui";
import type { GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import { createSignal, Show } from "solid-js";
import { useI18n } from "../../i18n-context";
import { LanguageSelect } from "./LanguageSelect";
import { ProviderSettingsSection, type ProviderSettingsSectionProps } from "./ProviderSettingsSection";

const linkTargetOptions: GeneralSettingsValue["externalLinkTarget"][] = ["Default browser", "OpenBot"];

/**
 * The saved value is the English name, because it is what `app-settings.ts` persists and what the
 * main process compares against. Only the label a reader sees is translated.
 */
const LINK_TARGET_KEYS = {
  "Default browser": "settings.externalLinks.defaultBrowser",
  OpenBot: "settings.externalLinks.openbot",
} as const satisfies Record<GeneralSettingsValue["externalLinkTarget"], AppTextKey>;

interface SettingsGeneralTabProps extends ProviderSettingsSectionProps {
  value: GeneralSettingsValue;
  onUpdateSetting: <Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]) => void;
  turboModePending?: boolean;
  /** Shows one desktop notification now. Absent where there is no operating system to show it. */
  onTestNotification?: () => void | Promise<void>;
  /** Opens the operating system notification settings. Absent where the system has no such page. */
  onOpenNotificationSettings?: () => void | Promise<void>;
}

export function SettingsGeneralTab(props: SettingsGeneralTabProps) {
  const i18n = useI18n();
  const runNotificationAction = (
    action: () => void | Promise<void>,
    failed: "settings.testNotification.failed" | "settings.testNotification.openSettingsFailed",
  ) => {
    void Promise.resolve()
      .then(action)
      .catch(() => toast.error(i18n.t(failed)));
  };
  const linkTargetLabel = (value: GeneralSettingsValue["externalLinkTarget"] | undefined) =>
    value === undefined ? "" : i18n.t(LINK_TARGET_KEYS[value]);
  const [confirmingTurbo, setConfirmingTurbo] = createSignal(false);
  return (
    <>
      <ProviderSettingsSection {...props} />

      <SettingsSection title={i18n.t("settings.appBehavior.title")}>
        <ItemGroup class="settings-modal-card">
          <SwitchField
            checked={props.value.launchAtLogin}
            onChange={(checked) => props.onUpdateSetting("launchAtLogin", checked)}
            label={i18n.t("settings.launchAtLogin.title")}
            description={i18n.t("settings.launchAtLogin.description")}
          />
          <SwitchField
            checked={props.value.keepRunningInBackground}
            onChange={(checked) => props.onUpdateSetting("keepRunningInBackground", checked)}
            label={i18n.t("settings.keepRunning.title")}
            description={i18n.t("settings.keepRunning.description")}
          />
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={i18n.t("settings.workspace.title")}>
        <ItemGroup class="settings-modal-card">
          <SwitchField
            checked={props.value.restoreLastWorkspace}
            onChange={(checked) => props.onUpdateSetting("restoreLastWorkspace", checked)}
            label={i18n.t("settings.restoreWorkspace.title")}
            description={i18n.t("settings.restoreWorkspace.description")}
          />
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.language.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.language.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <LanguageSelect value={i18n.language()} onChange={i18n.changeLanguage} mount={props.selectMount} />
            </ItemActions>
          </Item>
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.externalLinks.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.externalLinks.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select<GeneralSettingsValue["externalLinkTarget"]>
                class="settings-modal-select"
                options={linkTargetOptions}
                value={props.value.externalLinkTarget}
                onChange={(value) => value && props.onUpdateSetting("externalLinkTarget", value)}
                placement="bottom-end"
                itemComponent={(selectProps) => (
                  <SelectItem item={selectProps.item}>{linkTargetLabel(selectProps.item.rawValue)}</SelectItem>
                )}
              >
                <SelectTrigger size="sm" aria-label={i18n.t("settings.externalLinks.title")}>
                  <SelectValue<GeneralSettingsValue["externalLinkTarget"]>>
                    {(state) => linkTargetLabel(state.selectedOption())}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent mount={props.selectMount} />
              </Select>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={i18n.t("settings.autonomy.title")}>
        <ItemGroup class="settings-modal-card">
          <SwitchField
            checked={props.value.turboMode}
            disabled={props.turboModePending}
            onChange={(checked) => {
              // Turning it on is the move that needs the warning. Turning it off restores asking and
              // is never something a user needs protecting from, so it is written straight away.
              if (checked) setConfirmingTurbo(true);
              else props.onUpdateSetting("turboMode", false);
            }}
            label={i18n.t("settings.turbo.title")}
            description={i18n.t("settings.turbo.description")}
          />
        </ItemGroup>
      </SettingsSection>

      <ConfirmDialog
        open={confirmingTurbo()}
        tone="default"
        initialFocus="cancel"
        title={i18n.t("settings.turbo.confirmTitle")}
        description={i18n.t("settings.turbo.confirmDescription")}
        cancelLabel={i18n.t("common.cancel")}
        confirmLabel={i18n.t("settings.turbo.confirmAccept")}
        onCancel={() => setConfirmingTurbo(false)}
        onConfirm={() => {
          setConfirmingTurbo(false);
          props.onUpdateSetting("turboMode", true);
        }}
      />

      <SettingsSection title={i18n.t("settings.notifications.title")}>
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
          <SwitchField
            checked={props.value.taskCompletionSound}
            onChange={(checked) => props.onUpdateSetting("taskCompletionSound", checked)}
            label={i18n.t("settings.taskSound.title")}
            description={i18n.t("settings.taskSound.description")}
          />
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={i18n.t("settings.privacy.title")}>
        <ItemGroup class="settings-modal-card">
          <SwitchField
            checked={props.value.productAnalytics}
            onChange={(checked) => props.onUpdateSetting("productAnalytics", checked)}
            label={i18n.t("settings.analytics.title")}
            description={i18n.t("settings.analytics.description")}
          />
        </ItemGroup>
      </SettingsSection>
    </>
  );
}
