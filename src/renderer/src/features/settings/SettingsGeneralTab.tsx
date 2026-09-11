import type {
  AgentModelId,
  AgentModelOption,
  AgentProviderId,
  AgentStatus,
  AppInfo,
  CustomMcpSummary,
  CustomProviderRestart,
  CustomProviderSummary,
  ProviderRuntimeStatus,
  SaveCustomMcpInput,
  SaveCustomProviderInput,
} from "@openbot/contracts/ipc";
import { createSignal, For, Show } from "solid-js";
import { ProviderModelPicker } from "../../components/ProviderModelPicker";
import { ProviderPicker } from "../../components/ProviderPicker";
import {
  Button,
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
  Trash2,
} from "../../components/ui";
import { errorMessage } from "../../error-message";
import { CustomMcpDialog } from "../custom-mcp/CustomMcpDialog";
import { CustomProviderDialog } from "../custom-providers/CustomProviderDialog";
import { CustomProviderListDialog } from "../custom-providers/CustomProviderListDialog";
import { createCustomProviderHostState } from "../custom-providers/custom-provider-host-state";
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
  onAddCustomMcp?: (value: SaveCustomMcpInput) => Promise<void>;
  customMcpServers?: readonly CustomMcpSummary[];
  onDeleteCustomMcp?: (id: string) => Promise<void>;
  mcpFullAccess?: boolean;
  onSetMcpFullAccess?: (enabled: boolean) => Promise<void>;
  globalModel?: { provider: AgentProviderId; model: AgentModelId } | null;
  modelOptions?: readonly AgentModelOption[];
  agentStatus?: AgentStatus;
  onApplyGlobalModel?: (model: AgentModelId, provider: AgentProviderId) => Promise<void>;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>>;
  onSignInProvider?: (provider: AgentProviderId) => void | Promise<void>;
}

export function SettingsGeneralTab(props: SettingsGeneralTabProps) {
  const customProviders = () => props.customProviders ?? [];
  const customMcpServers = () => props.customMcpServers ?? [];
  const [mcpOpen, setMcpOpen] = createSignal(false);
  const [mcpSaving, setMcpSaving] = createSignal(false);
  const [mcpSubmitError, setMcpSubmitError] = createSignal<string | null>(null);
  const [mcpRemoving, setMcpRemoving] = createSignal<string | null>(null);
  const [mcpNote, setMcpNote] = createSignal<string | null>(null);
  const [mcpAccessBusy, setMcpAccessBusy] = createSignal(false);
  const [globalModelBusy, setGlobalModelBusy] = createSignal(false);
  const [globalModelNote, setGlobalModelNote] = createSignal<string | null>(null);
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

  async function submitCustomMcp(value: SaveCustomMcpInput): Promise<void> {
    setMcpSaving(true);
    setMcpSubmitError(null);
    setMcpNote(null);
    try {
      await props.onAddCustomMcp?.(value);
      setMcpOpen(false);
      setMcpNote("Saved. Agents pick this server up on their next task.");
    } catch (error) {
      setMcpSubmitError(errorMessage(error, "OpenBot could not save this MCP server."));
    } finally {
      setMcpSaving(false);
    }
  }

  async function applyGlobalModel(model: AgentModelId, provider: AgentProviderId): Promise<void> {
    setGlobalModelBusy(true);
    setGlobalModelNote(null);
    try {
      await props.onApplyGlobalModel?.(model, provider);
      setGlobalModelNote("Applied to every agent. Agents pick it up on their next task.");
    } catch (error) {
      setGlobalModelNote(errorMessage(error, "OpenBot could not change every agent's model."));
    } finally {
      setGlobalModelBusy(false);
    }
  }

  async function setMcpFullAccess(enabled: boolean): Promise<void> {
    setMcpAccessBusy(true);
    try {
      await props.onSetMcpFullAccess?.(enabled);
    } catch (error) {
      setMcpNote(errorMessage(error, "OpenBot could not change MCP access."));
    } finally {
      setMcpAccessBusy(false);
    }
  }

  async function removeCustomMcp(server: CustomMcpSummary): Promise<void> {
    if (!window.confirm(`Remove ${server.name}? Agents lose its tools on their next task.`)) return;
    setMcpRemoving(server.id);
    setMcpNote(null);
    try {
      await props.onDeleteCustomMcp?.(server.id);
      setMcpNote(`Removed ${server.name}.`);
    } catch (error) {
      setMcpNote(errorMessage(error, `OpenBot could not remove ${server.name}.`));
    } finally {
      setMcpRemoving(null);
    }
  }

  return (
    <>
      <SettingsSection title="AI providers">
        <ProviderPicker
          value={props.store.selectedProvider()}
          options={props.store.providerOptions()}
          ariaLabel="AI providers"
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

      <Show
        when={
          props.onApplyGlobalModel && props.agentStatus && (props.modelOptions?.length ?? 0) > 0
            ? { status: props.agentStatus, models: props.modelOptions ?? [] }
            : null
        }
      >
        {(ctx) => (
          <SettingsSection title="Global model">
            <ItemGroup class="settings-modal-card">
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>Every agent</ItemTitle>
                  <ItemDescription>
                    Change the model for every agent on this computer, and for agents you create next.
                  </ItemDescription>
                </ItemContent>
              </Item>
              <div class="settings-modal-row">
                <ProviderModelPicker
                  provider={props.globalModel?.provider ?? ctx().models[0]?.provider ?? "codex"}
                  value={props.globalModel?.model ?? ctx().models[0]?.id ?? ""}
                  modelOptions={[...ctx().models]}
                  agentStatus={ctx().status}
                  runtimeStatuses={props.providerRuntimeStatuses}
                  customProviders={customProviders()}
                  disabled={globalModelBusy()}
                  onChange={(model, provider) => void applyGlobalModel(model, provider)}
                  onDownloadProvider={props.onDownloadProvider}
                  onCancelProviderDownload={props.onCancelProviderDownload}
                  onConnectProvider={props.onConnectProvider}
                />
              </div>
            </ItemGroup>
            <Show when={globalModelNote()}>
              {(message) => (
                <Text tone="muted" variant="caption" role="status">
                  {message()}
                </Text>
              )}
            </Show>
          </SettingsSection>
        )}
      </Show>

      <Show when={props.onAddCustomMcp}>
        <SettingsSection title="MCP servers">
          <ItemGroup class="settings-modal-card">
            <Show when={props.onSetMcpFullAccess}>
              <SwitchField
                checked={props.mcpFullAccess === true}
                onChange={(checked) => void setMcpFullAccess(checked)}
                disabled={mcpAccessBusy()}
                label="Full MCP access"
                description="Allow MCP servers to run without asking. Commands and file changes still wait for you."
              />
            </Show>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>Custom MCP</ItemTitle>
                <ItemDescription>
                  Give agents tools from a local command or an HTTP server. They pick a saved server up on their next
                  task.
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Add custom MCP server"
                  onClick={() => {
                    setMcpSubmitError(null);
                    setMcpOpen(true);
                  }}
                >
                  Add
                </Button>
              </ItemActions>
            </Item>
            <For each={customMcpServers()}>
              {(server) => (
                <Item class="settings-modal-row">
                  <ItemContent>
                    <ItemTitle>{server.name}</ItemTitle>
                    <ItemDescription>{server.transport === "stdio" ? server.command : server.url}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Show when={props.onDeleteCustomMcp}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${server.name}`}
                        loading={mcpRemoving() === server.id}
                        loadingLabel="Removing…"
                        disabled={mcpRemoving() !== null}
                        onClick={() => void removeCustomMcp(server)}
                      >
                        <Trash2 />
                      </Button>
                    </Show>
                  </ItemActions>
                </Item>
              )}
            </For>
          </ItemGroup>
          <Show when={mcpNote()}>
            {(message) => (
              <Text tone="muted" variant="caption" role="status">
                {message()}
              </Text>
            )}
          </Show>
          <CustomMcpDialog
            open={mcpOpen()}
            busy={mcpSaving()}
            submitError={mcpSubmitError()}
            takenServerIds={customMcpServers().map((server) => server.id)}
            onSubmit={(value) => void submitCustomMcp(value)}
            onCancel={() => setMcpOpen(false)}
          />
        </SettingsSection>
      </Show>

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
