import { APP_INTERFACE_SIZES, type AppInterfaceSize, type AppVariant } from "@openbot/contracts/ipc";
import {
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
import { AppearanceSelect } from "@openbot/ui/features/settings/AppearanceSelect";
import type { GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import { LanguageSelect } from "@openbot/ui/features/settings/LanguageSelect";
import { LogoColorPicker } from "@openbot/ui/features/settings/LogoColorPicker";
import { SendShortcutSelect } from "@openbot/ui/features/settings/SendShortcutSelect";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import { useAppearanceChoice } from "../../appearance-choice";
import { useI18n } from "../../i18n-context";
import { useInterfaceSizeChoice } from "../../interface-size";
import { useLogoColorChoice } from "../../logo-color";
import { ExternalLinkSelect } from "./ExternalLinkSelect";

const interfaceSizeOptions = [...APP_INTERFACE_SIZES];

interface SettingsGeneralTabProps {
  value: GeneralSettingsValue;
  /** The device with the keyboard, naming ⌘ or Ctrl in the shortcut option. */
  platform?: "darwin" | "win32" | "linux" | undefined;
  /** A dev or preview build keeps its own logo color, so the logo color row says so. */
  variant: AppVariant;
  /** The dialog element the Select popovers portal into, captured when the tab was created. */
  selectMount: HTMLElement | undefined;
  onUpdateSetting: <Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]) => void;
  onUpdateSettings: (patch: Partial<GeneralSettingsValue>) => void;
}

export function SettingsGeneralTab(props: SettingsGeneralTabProps) {
  const i18n = useI18n();
  const appearance = useAppearanceChoice();
  const logoColor = useLogoColorChoice();
  const interfaceSize = useInterfaceSizeChoice();
  const { format } = useText();
  const interfaceSizeLabel = (value: AppInterfaceSize | undefined) =>
    value === undefined ? "" : format.percent(value / 100);
  return (
    <>
      <SettingsSection title={i18n.t("settings.appearance.title")}>
        <ItemGroup class="settings-modal-card">
          <Item data-settings-row="settings.appearance.theme.title" class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.appearance.theme.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.appearance.theme.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <AppearanceSelect
                value={appearance.appearance()}
                onChange={appearance.changeAppearance}
                mount={props.selectMount}
              />
            </ItemActions>
          </Item>
          <Show when={props.platform === "darwin"}>
            <SwitchField
              data-settings-row="settings.appearance.transparentWindow.title"
              checked={appearance.transparentWindow()}
              onChange={appearance.changeTransparentWindow}
              label={i18n.t("settings.appearance.transparentWindow.title")}
              description={i18n.t("settings.appearance.transparentWindow.description")}
            />
          </Show>
          <Item data-settings-row="settings.language.title" class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.language.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.language.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <LanguageSelect value={i18n.language()} onChange={i18n.changeLanguage} mount={props.selectMount} />
            </ItemActions>
          </Item>
          <Item data-settings-row="settings.interfaceSize.title" class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.interfaceSize.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.interfaceSize.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select<AppInterfaceSize>
                class="settings-modal-select"
                options={interfaceSizeOptions}
                value={interfaceSize.percent()}
                onChange={(value) => value && interfaceSize.changePercent(value)}
                placement="bottom-end"
                itemComponent={(selectProps) => (
                  <SelectItem item={selectProps.item}>{interfaceSizeLabel(selectProps.item.rawValue)}</SelectItem>
                )}
              >
                <SelectTrigger size="sm" aria-label={i18n.t("settings.interfaceSize.title")}>
                  <SelectValue<AppInterfaceSize>>{(state) => interfaceSizeLabel(state.selectedOption())}</SelectValue>
                </SelectTrigger>
                <SelectContent mount={props.selectMount} />
              </Select>
            </ItemActions>
          </Item>
          <Item data-settings-row="settings.logoColor.title" class="settings-modal-row settings-logo-color-row">
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
          <Item data-settings-row="settings.sendShortcut.title" class="settings-modal-row">
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
            data-settings-row="settings.showAgentSteps.title"
            checked={props.value.showAgentSteps}
            onChange={(checked) => props.onUpdateSetting("showAgentSteps", checked)}
            label={i18n.t("settings.showAgentSteps.title")}
            description={i18n.t("settings.showAgentSteps.description")}
          />
          <Item data-settings-row="settings.externalLinks.title" class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{i18n.t("settings.externalLinks.title")}</ItemTitle>
              <ItemDescription>{i18n.t("settings.externalLinks.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ExternalLinkSelect
                target={props.value.externalLinkTarget}
                platform={props.platform}
                mount={props.selectMount}
                onChange={(target) => props.onUpdateSetting("externalLinkTarget", target)}
              />
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={i18n.t("settings.appBehavior.title")}>
        <ItemGroup class="settings-modal-card">
          <Show when={props.value.launchAtLogin !== null}>
            <SwitchField
              data-settings-row="settings.launchAtLogin.title"
              checked={props.value.launchAtLogin === true}
              onChange={(checked) => props.onUpdateSetting("launchAtLogin", checked)}
              label={i18n.t("settings.launchAtLogin.title")}
              description={i18n.t("settings.launchAtLogin.description")}
            />
          </Show>
          <SwitchField
            data-settings-row="settings.keepRemoteSessions.title"
            checked={props.value.keepRemoteSessions}
            onChange={(checked) => props.onUpdateSetting("keepRemoteSessions", checked)}
            label={i18n.t("settings.keepRemoteSessions.title")}
            description={i18n.t("settings.keepRemoteSessions.description")}
          />
          <Show when={props.value.keepRunningInBackground !== null}>
            <SwitchField
              data-settings-row="settings.keepRunning.title"
              checked={props.value.keepRunningInBackground === true}
              onChange={(checked) => props.onUpdateSetting("keepRunningInBackground", checked)}
              label={i18n.t("settings.keepRunning.title")}
              description={i18n.t("settings.keepRunning.description")}
            />
          </Show>
          <Show when={props.value.keepAwake !== null}>
            <SwitchField
              data-settings-row="settings.keepAwake.title"
              checked={props.value.keepAwake === true}
              onChange={(checked) => props.onUpdateSetting("keepAwake", checked)}
              label={i18n.t("settings.keepAwake.title")}
              description={i18n.t("settings.keepAwake.description")}
            />
            <SwitchField
              data-settings-row="settings.keepAwakeOnBattery.title"
              checked={props.value.keepAwakeOnBattery === true}
              disabled={props.value.keepAwake !== true}
              onChange={(checked) => props.onUpdateSetting("keepAwakeOnBattery", checked)}
              label={i18n.t("settings.keepAwakeOnBattery.title")}
              description={i18n.t("settings.keepAwakeOnBattery.description")}
            />
          </Show>
          <SwitchField
            data-settings-row="settings.restoreWorkspace.title"
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
            data-settings-row="settings.analytics.title"
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
