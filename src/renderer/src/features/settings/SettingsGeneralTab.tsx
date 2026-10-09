import { AGENT_MEMORY_LIMITS, type AgentMemoryLimit, type AppVariant } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
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
} from "@openbot/ui";
import type { GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import { LanguageSelect } from "@openbot/ui/features/settings/LanguageSelect";
import { LogoColorPicker } from "@openbot/ui/features/settings/LogoColorPicker";
import { SendShortcutSelect } from "@openbot/ui/features/settings/SendShortcutSelect";
import { createSignal, Show } from "solid-js";
import { useI18n } from "../../i18n-context";
import { useLogoColorChoice } from "../../logo-color";

const linkTargetOptions: GeneralSettingsValue["externalLinkTarget"][] = ["Default browser", "OpenBot"];

/**
 * The saved value is the English name, because it is what `app-settings.ts` persists and what the
 * main process compares against. Only the label a reader sees is translated.
 */
const LINK_TARGET_KEYS = {
  "Default browser": "settings.externalLinks.defaultBrowser",
  OpenBot: "settings.externalLinks.openbot",
} as const satisfies Record<GeneralSettingsValue["externalLinkTarget"], AppTextKey>;

interface SettingsGeneralTabProps {
  value: GeneralSettingsValue;
  /** The device with the keyboard, naming ⌘ or Ctrl in the shortcut option. */
  platform?: "darwin" | "win32" | "linux";
  /** A dev or preview build keeps its own logo color, so the logo color row says so. */
  variant: AppVariant;
  /** The dialog element the Select popovers portal into, captured when the tab was created. */
  selectMount: HTMLElement | undefined;
  onUpdateSetting: <Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]) => void;
  onUpdateSettings: (patch: Partial<GeneralSettingsValue>) => void;
  turboModePending?: boolean;
}

export function SettingsGeneralTab(props: SettingsGeneralTabProps) {
  const i18n = useI18n();
  const linkTargetLabel = (value: GeneralSettingsValue["externalLinkTarget"] | undefined) =>
    value === undefined ? "" : i18n.t(LINK_TARGET_KEYS[value]);
  const [confirmingTurbo, setConfirmingTurbo] = createSignal(false);
  const logoColor = useLogoColorChoice();
  return (
    <>
      <SettingsSection title={i18n.t("settings.appearance.title")}>
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.language.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.language.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <LanguageSelect value={i18n.language()} onChange={i18n.changeLanguage} mount={props.selectMount} />
            </ItemActions>
          </Item>
          <Item class="settings-modal-row settings-logo-color-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.logoColor.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.logoColor.description")}</ItemDescription>
              <Show when={props.variant !== "production"}>
                <ItemDescription>{i18n.t("settings.logoColor.buildNote")}</ItemDescription>
              </Show>
            </ItemContent>
            <LogoColorPicker value={logoColor.color()} onChange={logoColor.changeColor} />
          </Item>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={i18n.t("settings.conversations.title")}>
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.sendShortcut.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.sendShortcut.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <SendShortcutSelect
                value={props.value.sendShortcut}
                onChange={(mode) => props.onUpdateSetting("sendShortcut", mode)}
                devicePlatform={props.platform ?? "darwin"}
                mount={props.selectMount}
              />
            </ItemActions>
          </Item>
          <SwitchField
            checked={props.value.busyMessageMode === "steer"}
            onChange={(checked) => props.onUpdateSetting("busyMessageMode", checked ? "steer" : "queue")}
            label={i18n.t("settings.busyMessage.title")}
            description={i18n.t("settings.busyMessage.description")}
          />
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.agentMemoryLimit.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.agentMemoryLimit.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select<AgentMemoryLimit>
                class="settings-modal-select"
                options={[...AGENT_MEMORY_LIMITS]}
                value={props.value.agentMemoryLimit}
                onChange={(value) => value && props.onUpdateSetting("agentMemoryLimit", value)}
                placement="bottom-end"
                itemComponent={(selectProps) => (
                  <SelectItem item={selectProps.item}>{String(selectProps.item.rawValue)}</SelectItem>
                )}
              >
                <SelectTrigger size="sm" aria-label={i18n.t("settings.agentMemoryLimit.title")}>
                  <SelectValue<AgentMemoryLimit>>{(state) => String(state.selectedOption() ?? "")}</SelectValue>
                </SelectTrigger>
                <SelectContent mount={props.selectMount} />
              </Select>
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

      <SettingsSection title={i18n.t("settings.appBehavior.title")}>
        <ItemGroup class="settings-modal-card">
          <SwitchField
            checked={props.value.launchAtLogin}
            onChange={(checked) => props.onUpdateSetting("launchAtLogin", checked)}
            label={i18n.t("settings.launchAtLogin.title")}
            description={i18n.t("settings.launchAtLogin.description")}
          />
          <SwitchField
            checked={props.value.keepRemoteSessions}
            onChange={(checked) => props.onUpdateSetting("keepRemoteSessions", checked)}
            label={i18n.t("settings.keepRemoteSessions.title")}
            description={i18n.t("settings.keepRemoteSessions.description")}
          />
          <SwitchField
            checked={props.value.keepRunningInBackground}
            onChange={(checked) => props.onUpdateSetting("keepRunningInBackground", checked)}
            label={i18n.t("settings.keepRunning.title")}
            description={i18n.t("settings.keepRunning.description")}
          />
          <SwitchField
            checked={props.value.restoreLastWorkspace}
            onChange={(checked) => props.onUpdateSetting("restoreLastWorkspace", checked)}
            label={i18n.t("settings.restoreWorkspace.title")}
            description={i18n.t("settings.restoreWorkspace.description")}
          />
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={i18n.t("settings.permissions.title")}>
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
          <SwitchField
            checked={props.value.productAnalytics}
            onChange={(checked) => props.onUpdateSetting("productAnalytics", checked)}
            label={i18n.t("settings.analytics.title")}
            description={i18n.t("settings.analytics.description")}
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
    </>
  );
}
