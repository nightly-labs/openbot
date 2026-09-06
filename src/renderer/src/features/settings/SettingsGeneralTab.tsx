import type { AgentProviderId, AppInfo } from "@openbot/contracts/ipc";
import { Show } from "solid-js";
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
} from "../../components/ui";
import type { GeneralSettingsValue } from "./app-settings";
import type { SettingsGeneralStore } from "./stores/general-store";

const linkTargetOptions: GeneralSettingsValue["externalLinkTarget"][] = ["Default browser", "OpenBot"];

interface SettingsGeneralTabProps {
  store: SettingsGeneralStore;
  value: GeneralSettingsValue;
  onUpdateSetting: <Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]) => void;
  platform: AppInfo["platform"] | undefined;
  /** The dialog element the Select popovers portal into, captured when this tab was created. */
  selectMount: HTMLElement | undefined;
  onDownloadProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onCancelProviderDownload?: (provider: AgentProviderId) => void | Promise<void>;
  onConnectProvider?: (provider: AgentProviderId) => void | Promise<void>;
}

export function SettingsGeneralTab(props: SettingsGeneralTabProps) {
  return (
    <>
      <SettingsSection title="AI providers">
        <ProviderPicker
          value={props.store.selectedProvider()}
          options={props.store.providerOptions()}
          ariaLabel="AI providers"
          embedded
          allowUnavailableSelection
          onChange={props.store.setSelectedProvider}
          onDownloadProvider={props.onDownloadProvider}
          onCancelProviderDownload={props.onCancelProviderDownload}
          onConnectProvider={props.onConnectProvider}
        />
      </SettingsSection>

      <SettingsSection title="App behavior">
        <ItemGroup class="settings-modal-card">
          <SwitchField
            checked={props.value.launchAtLogin}
            onChange={(checked) => props.onUpdateSetting("launchAtLogin", checked)}
            label="Launch OpenBot at login"
            description="Open the app when you sign in to this computer."
          />
          <SwitchField
            checked={props.value.keepRunningInBackground}
            onChange={(checked) => props.onUpdateSetting("keepRunningInBackground", checked)}
            label="Keep OpenBot running in the background"
            description="Keep active tasks running after you close the window."
          />
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title="Workspace">
        <ItemGroup class="settings-modal-card">
          <SwitchField
            checked={props.value.restoreLastWorkspace}
            onChange={(checked) => props.onUpdateSetting("restoreLastWorkspace", checked)}
            label="Restore the last workspace on launch"
            description="Open the workspace and tasks from your previous session."
          />
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>Open external links in</ItemTitle>
              <ItemDescription>Choose where links from conversations open.</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select<GeneralSettingsValue["externalLinkTarget"]>
                class="settings-modal-select"
                options={linkTargetOptions}
                value={props.value.externalLinkTarget}
                onChange={(value) => value && props.onUpdateSetting("externalLinkTarget", value)}
                placement="bottom-end"
                itemComponent={(selectProps) => (
                  <SelectItem item={selectProps.item}>{selectProps.item.rawValue}</SelectItem>
                )}
              >
                <SelectTrigger size="sm" aria-label="Open external links in">
                  <SelectValue<GeneralSettingsValue["externalLinkTarget"]>>
                    {(state) => state.selectedOption()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent mount={props.selectMount} />
              </Select>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title="Notifications">
        <ItemGroup class="settings-modal-card">
          <SwitchField
            checked={props.value.desktopNotifications}
            onChange={(checked) => props.onUpdateSetting("desktopNotifications", checked)}
            label="Desktop notifications"
            description="Show a notification when an agent needs attention."
          />
          <SwitchField
            checked={props.value.taskCompletionSound}
            onChange={(checked) => props.onUpdateSetting("taskCompletionSound", checked)}
            label="Play a sound when a task finishes"
            description="Use a short sound for completed tasks."
          />
        </ItemGroup>
      </SettingsSection>

      <Show when={props.platform === "darwin"}>
        <SettingsSection title="MacBook notch">
          <ItemGroup class="settings-modal-card">
            <SwitchField
              checked={props.value.macBookNotch}
              onChange={(checked) => props.onUpdateSetting("macBookNotch", checked)}
              label="Show status in the MacBook notch"
              description="Show agent activity and items that need attention at the top of each display."
            />
            <SwitchField
              checked={props.value.macBookNotchIdle}
              disabled={!props.value.macBookNotch}
              onChange={(checked) => props.onUpdateSetting("macBookNotchIdle", checked)}
              label="Show idle island"
              description="Show the OpenBot logo and greeting when no status is active."
            />
            <SwitchField
              checked={props.value.macBookNotchAdditionalDisplays}
              disabled={!props.value.macBookNotch}
              onChange={(checked) => props.onUpdateSetting("macBookNotchAdditionalDisplays", checked)}
              label="Show on additional displays"
              description="Show Dynamic Island on connected external displays."
            />
            <SwitchField
              checked={props.value.macBookNotchHaptics}
              disabled={!props.value.macBookNotch}
              onChange={(checked) => props.onUpdateSetting("macBookNotchHaptics", checked)}
              label="Haptic feedback"
              description="Use the Force Touch trackpad to confirm Dynamic Island interactions."
            />
          </ItemGroup>
        </SettingsSection>
      </Show>

      <SettingsSection title="Privacy">
        <ItemGroup class="settings-modal-card">
          <SwitchField
            checked={props.value.productAnalytics}
            onChange={(checked) => props.onUpdateSetting("productAnalytics", checked)}
            label="Share product analytics"
            description="Send usage and reliability metadata with your account ID and email to OpenBot's self-hosted analytics."
          />
        </ItemGroup>
      </SettingsSection>
    </>
  );
}
