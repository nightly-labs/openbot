import type {
  AgentProviderId,
  AppInfo,
  CustomProviderRestart,
  CustomProviderSummary,
  SaveCustomProviderInput,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { createSignal, Show } from "solid-js";
import { ProviderPicker } from "../../components/ProviderPicker";
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
  Text,
} from "../../components/ui";
import { useI18n } from "../../i18n-context";
import { CustomProviderDialog } from "../custom-providers/CustomProviderDialog";
import { CustomProviderListDialog } from "../custom-providers/CustomProviderListDialog";
import { createCustomProviderHostState } from "../custom-providers/custom-provider-host-state";
import type { GeneralSettingsValue } from "./app-settings";
import { LanguageSelect } from "./LanguageSelect";
import type { SettingsGeneralStore } from "./stores/general-store";

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
  store: SettingsGeneralStore;
  value: GeneralSettingsValue;
  onUpdateSetting: <Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]) => void;
  platform: AppInfo["platform"] | undefined;
  /** The dialog element the Select popovers portal into, captured when this tab was created. */
  selectMount: HTMLElement | undefined;
  onDownloadProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onCancelProviderDownload?: (provider: AgentProviderId) => void | Promise<void>;
  onUpdateProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onInstallProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onConnectProvider?: (provider: AgentProviderId) => void | Promise<void>;
  /**
   * Accepts a described endpoint. Without it the section offers no custom provider at all, which is
   * how a remote server hides the whole feature: these endpoints merge into the OpenCode process on
   * this computer.
   */
  onAddCustomProvider?: (value: SaveCustomProviderInput) => Promise<CustomProviderRestart>;
  /** The endpoints already saved, without their keys. Empty until the first list arrives. */
  customProviders?: readonly CustomProviderSummary[];
  /** Without it the rows are listed but not removable, which is what a story without the callback shows. */
  onDeleteCustomProvider?: (id: string) => Promise<CustomProviderRestart>;
  onSignInProvider?: (provider: AgentProviderId) => void | Promise<void>;
}

export function SettingsGeneralTab(props: SettingsGeneralTabProps) {
  const i18n = useI18n();
  const linkTargetLabel = (value: GeneralSettingsValue["externalLinkTarget"] | undefined) =>
    value === undefined ? "" : i18n.t(LINK_TARGET_KEYS[value]);
  const customProviders = () => props.customProviders ?? [];
  /**
   * Which row holds the check here. Nothing stores it: the whole Settings picker is local state
   * today, so this row matches its neighbours and no more. Do not wire it to a saved default without
   * first deciding what a saved default means for the four rows beside it.
   */
  const [customSelected, setCustomSelected] = createSignal(false);
  const host = createCustomProviderHostState({
    onAdd: (value) => props.onAddCustomProvider?.(value),
    onDelete: (id) => props.onDeleteCustomProvider?.(id),
    onRemoved: () => {
      if (customProviders().length === 0) {
        setCustomSelected(false);
      }
    },
  });

  return (
    <>
      <SettingsSection title={i18n.t("settings.providers.title")}>
        <ProviderPicker
          value={props.store.selectedProvider()}
          options={props.store.providerOptions()}
          ariaLabel={i18n.t("settings.providers.title")}
          embedded
          allowUnavailableSelection
          customProviders={customProviders()}
          customSelected={customSelected()}
          onChange={(provider) => {
            setCustomSelected(false);
            props.store.setSelectedProvider(provider);
          }}
          onDownloadProvider={props.onDownloadProvider}
          onCancelProviderDownload={props.onCancelProviderDownload}
          onUpdateProvider={props.onUpdateProvider}
          onConnectProvider={props.onConnectProvider}
          onInstallProvider={props.onInstallProvider}
          onAddCustomProvider={props.onAddCustomProvider ? host.openForm : undefined}
          onSelectCustomProvider={props.onAddCustomProvider ? () => setCustomSelected(true) : undefined}
          onManageCustomProviders={props.onAddCustomProvider ? host.openList : undefined}
          onSignInProvider={props.onSignInProvider}
        />
        {/* The outcome is shown where the user is looking. While the list is open the section behind
            it is hidden from assistive technology, so a status left here could not be read. */}
        <Show when={host.state.manageOpen ? null : host.state.note}>
          {(message) => (
            <Text tone="muted" variant="caption" role="status">
              {message()}
            </Text>
          )}
        </Show>
        <Show when={props.onAddCustomProvider}>
          <CustomProviderDialog
            open={host.state.open}
            busy={host.state.saving}
            submitError={host.state.submitError}
            takenProviderIds={customProviders().map((provider) => provider.id)}
            onSubmit={(value) => void host.submit(value)}
            onCancel={host.closeForm}
          />
          <CustomProviderListDialog
            open={host.state.manageOpen}
            providers={customProviders()}
            removing={host.state.removing}
            note={host.state.note}
            onDelete={props.onDeleteCustomProvider ? (provider) => void host.remove(provider) : undefined}
            onClose={host.closeList}
          />
        </Show>
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

      <SettingsSection title={i18n.t("settings.notifications.title")}>
        <ItemGroup class="settings-modal-card">
          <SwitchField
            checked={props.value.desktopNotifications}
            onChange={(checked) => props.onUpdateSetting("desktopNotifications", checked)}
            label={i18n.t("settings.desktopNotifications.title")}
            description={i18n.t("settings.desktopNotifications.description")}
          />
          <SwitchField
            checked={props.value.taskCompletionSound}
            onChange={(checked) => props.onUpdateSetting("taskCompletionSound", checked)}
            label={i18n.t("settings.taskSound.title")}
            description={i18n.t("settings.taskSound.description")}
          />
        </ItemGroup>
      </SettingsSection>

      <Show when={props.platform === "darwin"}>
        <SettingsSection title={i18n.t("settings.notch.title")}>
          <ItemGroup class="settings-modal-card">
            <SwitchField
              checked={props.value.macBookNotch}
              onChange={(checked) => props.onUpdateSetting("macBookNotch", checked)}
              label={i18n.t("settings.notch.show.title")}
              description={i18n.t("settings.notch.show.description")}
            />
            <SwitchField
              checked={props.value.macBookNotchIdle}
              disabled={!props.value.macBookNotch}
              onChange={(checked) => props.onUpdateSetting("macBookNotchIdle", checked)}
              label={i18n.t("settings.notch.idle.title")}
              description={i18n.t("settings.notch.idle.description")}
            />
            <SwitchField
              checked={props.value.macBookNotchAdditionalDisplays}
              disabled={!props.value.macBookNotch}
              onChange={(checked) => props.onUpdateSetting("macBookNotchAdditionalDisplays", checked)}
              label={i18n.t("settings.notch.displays.title")}
              description={i18n.t("settings.notch.displays.description")}
            />
            <SwitchField
              checked={props.value.macBookNotchHaptics}
              disabled={!props.value.macBookNotch}
              onChange={(checked) => props.onUpdateSetting("macBookNotchHaptics", checked)}
              label={i18n.t("settings.notch.haptics.title")}
              description={i18n.t("settings.notch.haptics.description")}
            />
          </ItemGroup>
        </SettingsSection>
      </Show>

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
