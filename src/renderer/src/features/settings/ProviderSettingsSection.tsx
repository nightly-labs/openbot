import type {
  AgentModelId,
  AgentProviderId,
  AgentStatus,
  AppSetupState,
  CustomProviderRestart,
  CustomProviderSummary,
  ProviderApiKeyStatus,
  ProviderRuntimeStatus,
  SaveCustomProviderInput,
} from "@openbot/contracts/ipc";
import { agentProviderDescriptor } from "@openbot/contracts/ipc";
import { Text } from "@openbot/ui";
import { ProviderCodeLoginDialog } from "@openbot/ui/components/ProviderCodeLoginDialog";
import { ProviderPicker } from "@openbot/ui/components/ProviderPicker";
import {
  AcpRegistrySettings,
  type AcpRegistrySettingsApi,
} from "@openbot/ui/features/custom-providers/AcpRegistrySettings";
import {
  CustomAgentSettings,
  type CustomAgentSettingsApi,
} from "@openbot/ui/features/custom-providers/CustomAgentSettings";
import { CustomProviderDialog } from "@openbot/ui/features/custom-providers/CustomProviderDialog";
import { CustomProviderListDialog } from "@openbot/ui/features/custom-providers/CustomProviderListDialog";
import { CustomProviderPresetDialog } from "@openbot/ui/features/custom-providers/CustomProviderPresetDialog";
import { localServerProbes, presetSetupProvider } from "@openbot/ui/features/custom-providers/custom-provider-presets";
import { DetectedProviderSetup } from "@openbot/ui/features/custom-providers/DetectedProviderSetup";
import { DetectedProviders } from "@openbot/ui/features/custom-providers/DetectedProviders";
import type {
  DetectedProvider,
  DetectedProviderApi,
  ProviderDetection,
} from "@openbot/ui/features/custom-providers/detected-providers";
import {
  ProviderDetectionSettings,
  type ProviderDetectionSettingsValue,
} from "@openbot/ui/features/custom-providers/ProviderDetectionSettings";
import { OpenCodeKeyDialog, type ProviderKeyApi } from "@openbot/ui/features/settings/OpenCodeKeyDialog";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, createStore, Show, untrack } from "solid-js";
import type { ProviderCodeLoginApi } from "../../components/provider-code-login-api";
import { createCustomProviderHostState } from "../custom-providers/custom-provider-host-state";
import { savedCustomModel } from "../onboarding/SetupProviderPicker";
import { createSettingsGeneralStore, type SettingsGeneralStore } from "./stores/general-store";

interface DefaultProviderSettings extends Pick<AppSetupState, "preferredProvider" | "preferredModel"> {
  save: (provider: AgentProviderId, model?: AgentModelId | null) => Promise<void>;
}

interface ProviderSettingsSectionProps {
  defaultProvider?: DefaultProviderSettings | undefined;
  store: SettingsGeneralStore;
  /** The dialog element the Select popovers portal into, captured when the section was created. */
  selectMount: HTMLElement | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onUpdateProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onRestartProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderRestart?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onSetProviderOn?: ((provider: AgentProviderId, on: boolean) => void | Promise<void>) | undefined;
  onInstallProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onConnectProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /**
   * Accepts a described endpoint. Without it the section offers no custom provider at all, which is
   * how a remote server hides the whole feature: these endpoints merge into the OpenCode process on
   * this computer.
   */
  onAddCustomProvider?: ((value: SaveCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  /** The endpoints already saved, without their keys. Empty until the first list arrives. */
  customProviders?: readonly CustomProviderSummary[] | undefined;
  /** Without it the rows are listed but not removable, which is what a story without the callback shows. */
  onDeleteCustomProvider?: ((id: string) => Promise<CustomProviderRestart>) | undefined;
  onSignInProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /** Opens the code sign-in. Absent in the stories, where there is no provider to answer it. */
  onSignInWithCodeProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /** The providers the code sign-in reaches. Without it, the providers whose descriptor offers one. */
  codeSignInProviders?: readonly AgentProviderId[] | undefined;
  /** Local model servers and ACP agents that the host found. Without it the section shows no such list. */
  providerDetection?: ProviderDetection | undefined;
  detectedProviderApi?: DetectedProviderApi | undefined;
  takenAgentIds?: readonly string[] | undefined;
  /** The user's own ACP agents. This computer only, so a joined server's section never has it. */
  customAgents?: CustomAgentSettingsApi | undefined;
  acpRegistry?: AcpRegistrySettingsApi | undefined;
}

/** The provider list of the computer the agents run on, with its custom endpoint dialogs. */
function ProviderSettingsSection(props: ProviderSettingsSectionProps) {
  const i18n = useText();
  const customProviders = () => props.customProviders ?? [];
  const [customSelected, setCustomSelected] = createSignal(false);
  const [saving, setSaving] = createStore<{
    pending: { provider: AgentProviderId; custom: boolean } | null;
    error: string;
  }>({ pending: null, error: "" });
  const defaultCustomModel = () => {
    const choice = props.defaultProvider;
    return choice ? savedCustomModel(choice.preferredProvider, choice.preferredModel, customProviders()) : null;
  };

  async function selectProvider(
    provider: AgentProviderId,
    custom = false,
    selectedModel?: AgentModelId | null,
  ): Promise<void> {
    if (saving.pending) return;
    const choice = props.defaultProvider;
    if (!choice) {
      setCustomSelected(custom);
      props.store.setSelectedProvider(provider);
      return;
    }
    // A custom row uses its saved model, or the first model of the first saved endpoint.
    const endpoint = customProviders().find((item) => item.models.length > 0);
    const firstModel = endpoint?.models[0];
    const model = custom
      ? (defaultCustomModel() ?? (endpoint && firstModel ? `${endpoint.id}/${firstModel.id}` : null))
      : defaultCustomModel()
        ? null
        : undefined;
    setSaving(() => ({ pending: { provider, custom }, error: "" }));
    try {
      await choice.save(provider, selectedModel === undefined ? model : selectedModel);
    } catch (error) {
      setSaving((state) => {
        state.error = i18n.errorMessage(error, i18n.t("onboarding.setup.saveFailed"));
      });
    } finally {
      setSaving((state) => {
        state.pending = null;
      });
    }
  }
  async function selectSavedEndpoint(value: SaveCustomProviderInput): Promise<void> {
    const firstModel = value.models[0];
    if (props.defaultProvider && firstModel) {
      await selectProvider("opencode", true, `${value.id}/${firstModel.id}`);
    }
  }
  const detectedApi = createMemo((): DetectedProviderApi | undefined => {
    const api = props.detectedProviderApi;
    if (!api || !props.defaultProvider) return api;
    return {
      ...api,
      save: async (provider, value) => {
        const restart = await api.save(provider, value);
        if (value.kind === "models") await selectSavedEndpoint(value.value);
        return restart;
      },
    };
  });
  /**
   * With a detection API, Add first asks what to add: a local server, any compatible endpoint, or
   * an ACP agent. Without one, as on a joined server's host, Add opens the endpoint form at once.
   */
  const [choosing, setChoosing] = createSignal(false);
  const [presetFor, setPresetFor] = createSignal<DetectedProvider | null>(null);
  const host = createCustomProviderHostState({
    onAdd: (value) => props.onAddCustomProvider?.(value),
    onDelete: (id) => props.onDeleteCustomProvider?.(id),
    onSaved: (value) => void selectSavedEndpoint(value),
    onRemoved: (id) => {
      const choice = props.defaultProvider;
      if (choice?.preferredProvider === "opencode" && choice.preferredModel?.startsWith(`${id}/`)) {
        void selectProvider("opencode", false, null);
      }
      if (customProviders().length === 0) {
        setCustomSelected(false);
      }
    },
  });

  return (
    // The tab title already names this list, so it has no heading of its own.
    <div class="settings-provider-section">
      <ProviderPicker
        value={
          props.defaultProvider
            ? (saving.pending?.provider ?? props.defaultProvider.preferredProvider)
            : props.store.selectedProvider()
        }
        options={props.store.providerOptions()}
        ariaLabel={i18n.t(props.defaultProvider ? "onboarding.setup.defaultProvider" : "settings.providers.title")}
        label={props.defaultProvider ? i18n.t("onboarding.setup.defaultProvider") : undefined}
        hint={props.defaultProvider ? i18n.t("onboarding.setup.defaultProviderHint") : undefined}
        disabled={Boolean(saving.pending)}
        embedded
        allowUnavailableSelection
        customProviders={customProviders()}
        customSelected={
          props.defaultProvider ? (saving.pending?.custom ?? Boolean(defaultCustomModel())) : customSelected()
        }
        onChange={(provider) => void selectProvider(provider)}
        onDownloadProvider={props.onDownloadProvider}
        onCancelProviderDownload={props.onCancelProviderDownload}
        onUpdateProvider={props.onUpdateProvider}
        onRestartProvider={props.onRestartProvider}
        onCancelProviderRestart={props.onCancelProviderRestart}
        onSetProviderOn={props.onSetProviderOn}
        onConnectProvider={props.onConnectProvider}
        onInstallProvider={props.onInstallProvider}
        onAddCustomProvider={
          props.onAddCustomProvider ? (props.detectedProviderApi ? () => setChoosing(true) : host.openForm) : undefined
        }
        onSelectCustomProvider={props.onAddCustomProvider ? () => void selectProvider("opencode", true) : undefined}
        onManageCustomProviders={props.onAddCustomProvider ? host.openList : undefined}
        onSignInProvider={props.onSignInProvider}
        onSignInWithCodeProvider={props.onSignInWithCodeProvider}
        codeSignInProviders={props.codeSignInProviders}
        menuMount={props.selectMount}
        detected={
          <Show when={props.providerDetection}>
            {(detection) => (
              <Show when={detectedApi()}>
                {(api) => (
                  <DetectedProviders
                    detection={detection()}
                    api={api()}
                    takenProviderIds={customProviders().map((provider) => provider.id)}
                    takenAgentIds={props.takenAgentIds}
                    onSaved={host.showSaved}
                  />
                )}
              </Show>
            )}
          </Show>
        }
      />
      <Show when={!host.state.manageOpen && saving.error}>
        <Text role="alert">{saving.error}</Text>
      </Show>
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
          note={saving.error || host.state.note}
          onDelete={props.onDeleteCustomProvider ? (provider) => void host.remove(provider) : undefined}
          onClose={host.closeList}
        />
      </Show>
      <Show when={detectedApi()}>
        {(api) => (
          <>
            <CustomProviderPresetDialog
              open={choosing()}
              probes={localServerProbes(props.providerDetection)}
              onChoose={(preset) => {
                setChoosing(false);
                setPresetFor(presetSetupProvider(preset, props.providerDetection));
              }}
              onCancel={() => setChoosing(false)}
            />
            <DetectedProviderSetup
              provider={presetFor()}
              api={api()}
              takenProviderIds={customProviders().map((provider) => provider.id)}
              takenAgentIds={props.takenAgentIds}
              onClose={() => setPresetFor(null)}
              onSaved={host.showSaved}
            />
          </>
        )}
      </Show>
      <Show when={props.acpRegistry} keyed>
        {(api) => <AcpRegistrySettings api={api} />}
      </Show>
      <Show when={props.customAgents}>{(api) => <CustomAgentSettings api={api()} />}</Show>
    </div>
  );
}

/**
 * Whether the OpenCode key dialog is open, and whether the key is saved, for the row's badge.
 *
 * The badge is read through the key API like the dialog does, on open and after the dialog closes
 * with a save or a removal. Absent until the first read, and on a read failure, so the row shows no
 * key badge rather than a wrong one.
 */
function createProviderKeyState(props: { readonly open: boolean; readonly providerKeys?: ProviderKeyApi | undefined }) {
  const [keyDialogOpen, setKeyDialogOpen] = createSignal(false);
  const [keyProvider, setKeyProvider] = createSignal<"opencode" | "muse">("opencode");
  const [openCodeKeyStatus, setOpenCodeKeyStatus] = createSignal<ProviderApiKeyStatus | undefined>(undefined);
  async function refreshOpenCodeKeyStatus(): Promise<void> {
    const keys = props.providerKeys;
    if (!keys) return;
    let status: ProviderApiKeyStatus | undefined;
    try {
      status = (await keys.getProviderApiKeyState("opencode")).status;
    } catch {
      status = undefined;
    }
    // An answer from a source the modal has since left belongs to the other computer.
    if (keys === props.providerKeys) setOpenCodeKeyStatus(status);
  }
  // The badge has to answer on first paint: the key state arrives after the rows, so an open
  // without a read would show no badge until something else re-renders the list. The keys can move
  // to a joined server's host while the modal is open, when that host's admin role arrives, so a
  // new source is read again rather than keeping the other computer's answer.
  createEffect(
    () => (props.open ? props.providerKeys : undefined),
    (keys) => {
      setOpenCodeKeyStatus(undefined);
      if (keys) void untrack(refreshOpenCodeKeyStatus);
    },
  );
  return {
    keyDialogOpen,
    keyProvider,
    openCodeKeyStatus,
    /** OpenCode is the only provider whose sign-in is a pasted key, so it is the only row served. */
    openKeyDialog(provider: AgentProviderId): void {
      if (provider === "opencode" || provider === "muse") {
        setKeyProvider(provider);
        setKeyDialogOpen(true);
      }
    },
    closeKeyDialog(): void {
      setKeyDialogOpen(false);
      void refreshOpenCodeKeyStatus();
    },
  };
}

type ProviderKeyState = ReturnType<typeof createProviderKeyState>;

/** The key and code sign-in dialogs the section opens. Both portal over the dialog they open from. */
function ProviderSettingsDialogs(props: {
  keys: ProviderKeyState;
  providerKeys?: ProviderKeyApi | undefined;
  codeLogin?: ProviderCodeLoginApi | undefined;
  onConnectProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
}) {
  return (
    <>
      <Show when={props.keys.keyDialogOpen() && props.providerKeys}>
        {(api) => (
          <OpenCodeKeyDialog
            api={api()}
            provider={props.keys.keyProvider()}
            onClose={props.keys.closeKeyDialog}
            onReconnect={
              props.onConnectProvider ? () => props.onConnectProvider?.(props.keys.keyProvider()) : undefined
            }
          />
        )}
      </Show>
      <Show when={props.codeLogin?.provider() ? props.codeLogin : undefined}>
        {(api) => (
          <ProviderCodeLoginDialog
            open={true}
            providerName={agentProviderDescriptor(api().provider() ?? "codex").displayName}
            state={api().state()}
            onOpenVerificationUrl={api().openVerificationUrl}
            onCancel={api().cancel}
            onSubmitCode={api().submit}
          />
        )}
      </Show>
    </>
  );
}

/** The providers of one server's computer, as its server settings section takes them. */
export interface HostProviderSettings {
  /** Saved default for new local agents. Remote host settings do not change this computer's default. */
  defaultProvider?: DefaultProviderSettings | undefined;
  agentStatus: AgentStatus;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;
  providerAvailableVersions?: Partial<Record<AgentProviderId, string | null>> | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onUpdateProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /** The provider restart is of this computer, so only its section has it. */
  onRestartProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderRestart?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /**
   * The stories can supply off providers. Production reads the saved switches from agentStatus.
   */
  offProviders?: readonly AgentProviderId[] | undefined;
  /** The names of the agents that use each provider. A provider with one stays on. */
  providerUsers?: Partial<Record<AgentProviderId, readonly string[]>> | undefined;
  onSetProviderOn?: ((provider: AgentProviderId, on: boolean) => void | Promise<void>) | undefined;
  customProviders?: readonly CustomProviderSummary[] | undefined;
  onAddCustomProvider?: ((value: SaveCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  onDeleteCustomProvider?: ((id: string) => Promise<CustomProviderRestart>) | undefined;
  providerKeys?: ProviderKeyApi | undefined;
  codeLogin?: ProviderCodeLoginApi | undefined;
  /** The browser sign-in and the install guide open on this computer, so only its section has them. */
  onConnectProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onInstallProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /** The scan is of this computer, so a joined server's section shows no found list. */
  providerDetection?: ProviderDetection | undefined;
  detectedProviderApi?: DetectedProviderApi | undefined;
  takenAgentIds?: readonly string[] | undefined;
  customAgents?: CustomAgentSettingsApi | undefined;
  acpRegistry?: AcpRegistrySettingsApi | undefined;
  detectionSettings?: ProviderDetectionSettingsValue | undefined;
  onDetectionSettingsChange?: ((value: ProviderDetectionSettingsValue) => void) | undefined;
  detectionSettingsError?: string | null | undefined;
  /** Called each time the section is shown, for the scan of this computer. */
  onShown?: (() => void) | undefined;
}

/**
 * The whole Providers section for a server: its list, and the dialogs it opens. Without `hostName`
 * the providers are this computer's.
 */
export function HostProviderSettingsPanel(
  props: HostProviderSettings & { hostName?: string | undefined; selectMount: HTMLElement | undefined },
) {
  const keys = createProviderKeyState({
    open: true,
    get providerKeys() {
      return props.providerKeys;
    },
  });
  const store = createSettingsGeneralStore({
    get agentStatus() {
      return props.agentStatus;
    },
    get providerRuntimeStatuses() {
      return props.providerRuntimeStatuses;
    },
    get providerAvailableVersions() {
      return props.providerAvailableVersions;
    },
    openCodeKeyStatus: keys.openCodeKeyStatus,
    get providerHostName() {
      return props.hostName;
    },
    get offProviders() {
      return props.offProviders;
    },
    get providerUsers() {
      return props.providerUsers;
    },
  });
  return (
    <>
      <ProviderSettingsSection
        defaultProvider={props.defaultProvider}
        store={store}
        selectMount={props.selectMount}
        onDownloadProvider={props.onDownloadProvider}
        onCancelProviderDownload={props.onCancelProviderDownload}
        onUpdateProvider={props.onUpdateProvider}
        onRestartProvider={props.onRestartProvider}
        onCancelProviderRestart={props.onCancelProviderRestart}
        onSetProviderOn={props.onSetProviderOn}
        onConnectProvider={props.onConnectProvider}
        onInstallProvider={props.onInstallProvider}
        onAddCustomProvider={props.onAddCustomProvider}
        customProviders={props.customProviders}
        onDeleteCustomProvider={props.onDeleteCustomProvider}
        // With detection off there is no list, not an empty one.
        providerDetection={props.detectionSettings?.enabled === false ? undefined : props.providerDetection}
        detectedProviderApi={props.detectedProviderApi}
        takenAgentIds={props.takenAgentIds}
        customAgents={props.customAgents}
        acpRegistry={props.acpRegistry}
        onSignInProvider={props.providerKeys ? keys.openKeyDialog : undefined}
        onSignInWithCodeProvider={props.codeLogin?.start}
        codeSignInProviders={props.codeLogin?.providers()}
      />
      <Show when={props.detectionSettings}>
        {(value) => (
          <ProviderDetectionSettings
            value={value()}
            error={props.detectionSettingsError}
            onChange={(next) => props.onDetectionSettingsChange?.(next)}
          />
        )}
      </Show>
      <ProviderSettingsDialogs
        keys={keys}
        providerKeys={props.providerKeys}
        codeLogin={props.codeLogin}
        onConnectProvider={props.onConnectProvider}
      />
    </>
  );
}
