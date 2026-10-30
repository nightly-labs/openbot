import {
  type AgentModelId,
  type AgentProviderId,
  type AgentStatus,
  type AppSetupState,
  agentProviderName,
  CUSTOM_PROVIDER_HARNESSES,
  type CustomProviderRestart,
  type CustomProviderSummary,
  customProviderOfModel,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  isCustomProviderHarness,
  type ProviderApiKeyStatus,
  type ProviderRuntimeDownload,
  type ProviderRuntimeStatus,
  type SaveCustomProviderInput,
  type UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { Text } from "@openbot/ui";
import type { ProviderAccountActions } from "@openbot/ui/components/provider-accounts";
import { servesCustomProvider } from "@openbot/ui/components/provider-row";
import type { AccountUsageProviderRow } from "@openbot/ui/features/account/account-usage-view";
import {
  AcpRegistrySettings,
  type AcpRegistrySettingsApi,
} from "@openbot/ui/features/custom-providers/AcpRegistrySettings";
import {
  CustomAgentSettings,
  type CustomAgentSettingsApi,
} from "@openbot/ui/features/custom-providers/CustomAgentSettings";
import { CustomProviderDialog } from "@openbot/ui/features/custom-providers/CustomProviderDialog";
import { CustomProviderPresetDialog } from "@openbot/ui/features/custom-providers/CustomProviderPresetDialog";
import { savedCustomProviderDraft } from "@openbot/ui/features/custom-providers/custom-provider-form";
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
import {
  isKeyDialogProvider,
  type KeyDialogProvider,
  OpenCodeKeyDialog,
  type ProviderKeyApi,
} from "@openbot/ui/features/settings/OpenCodeKeyDialog";
import {
  type ProviderDefaultChoice,
  type ProviderPromptCache,
  type ProviderSettingsDetail,
  ProviderSettingsPage,
} from "@openbot/ui/features/settings/ProviderSettingsPage";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createStore, Show, untrack } from "solid-js";
import { ProviderSignInDialogs } from "../../components/ProviderSignInDialogs";
import type { ProviderConnectionApi } from "../../components/provider-connection-api";
import { createCustomProviderHostState } from "../custom-providers/custom-provider-host-state";
import { createProviderPromptCache, type ProviderPromptCacheSource } from "./provider-prompt-cache";
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
  onMeasureProviderDownload?: ((provider: AgentProviderId) => Promise<ProviderRuntimeDownload>) | undefined;
  onRemoveProviderDownload?: ((provider: AgentProviderId) => Promise<void>) | undefined;
  onInstallProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderSignIn?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
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
  /** Without it the rows have no Edit. This computer only: the Team API has no edit route. */
  onUpdateCustomProvider?: ((input: UpdateCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  onSignInProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /** Adds, names and removes the accounts of each provider that can hold more than one. */
  accountActions?: ProviderAccountActions | undefined;
  /** The sign-ins that a row's Connect and ⋯ menu run. Absent in the stories, where no provider answers it. */
  connection?: ProviderConnectionApi | undefined;
  /** Local model servers and ACP agents that the host found. Without it the section shows no such list. */
  providerDetection?: ProviderDetection | undefined;
  detectedProviderApi?: DetectedProviderApi | undefined;
  takenAgentIds?: readonly string[] | undefined;
  /** The user's own ACP agents. This computer only, so a joined server's section never has it. */
  customAgents?: CustomAgentSettingsApi | undefined;
  acpRegistry?: AcpRegistrySettingsApi | undefined;
  /** What the host found, and how it looks: below the list, not on a provider's page. */
  detectionSettings?: JSX.Element;
  usage?: readonly AccountUsageProviderRow[] | undefined;
  onDetailChange?: ((detail: ProviderSettingsDetail | null) => void) | undefined;
  promptCache?: ProviderPromptCache | undefined;
}

/** The provider list of the computer the agents run on, with its custom endpoint dialogs. */
function ProviderSettingsSection(props: ProviderSettingsSectionProps) {
  const i18n = useText();
  const customProviders = () => props.customProviders ?? [];
  const [saving, setSaving] = createStore<{
    pending: { provider: AgentProviderId; custom: boolean } | null;
    error: string;
  }>({ pending: null, error: "" });
  const [downloadError, setDownloadError] = createSignal("");
  /** The default model when it is a saved endpoint's, on the provider that runs that endpoint. */
  const defaultCustomModel = () => {
    const choice = props.defaultProvider;
    const endpoint = customProviderOfModel(choice?.preferredModel, customProviders());
    return endpoint && choice?.preferredProvider === harnessOf(endpoint) ? (choice.preferredModel ?? null) : null;
  };
  /** Edit and "Runs on" are both of this computer: a joined server's host runs each endpoint on OpenCode. */
  const harnesses = () =>
    props.onUpdateCustomProvider
      ? CUSTOM_PROVIDER_HARNESSES.map((id) => {
          const option = props.store.providerOptions().find((item) => item.id === id);
          return { id, ready: servesCustomProvider(option), runtime: option?.runtimeStatus };
        })
      : undefined;
  const downloadHarness = () =>
    props.onDownloadProvider ? (id: AgentProviderId) => void downloadProvider(id) : undefined;
  /** The provider of the Custom choice: the one that runs the endpoint of its model. */
  const customProvider = (): AgentProviderId => {
    const model = defaultCustomModel() ?? firstEndpointModel();
    return harnessOf(customProviderOfModel(model, customProviders()));
  };
  const firstEndpointModel = () => {
    const endpoint = customProviders().find((item) => item.models.length > 0);
    const firstModel = endpoint?.models[0];
    return endpoint && firstModel ? `${endpoint.id}/${firstModel.id}` : null;
  };

  async function selectProvider(
    provider: AgentProviderId,
    custom = false,
    selectedModel?: AgentModelId | null,
  ): Promise<void> {
    if (saving.pending) return;
    const choice = props.defaultProvider;
    if (!choice) return;
    // A custom row uses its saved model, or the first model of the first saved endpoint.
    const model = custom ? (defaultCustomModel() ?? firstEndpointModel()) : defaultCustomModel() ? null : undefined;
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
  /** A first download that fails rejects with no notification of its own, so its reason is shown here. */
  async function downloadProvider(provider: AgentProviderId): Promise<void> {
    const download = props.onDownloadProvider;
    if (!download) return;
    setDownloadError("");
    try {
      await download(provider);
    } catch (error) {
      setDownloadError(
        i18n.errorMessage(error, i18n.t("onboarding.error.download", { provider: agentProviderName(provider) })),
      );
    }
  }
  async function selectSavedEndpoint(value: SaveCustomProviderInput): Promise<void> {
    const firstModel = value.models[0];
    if (props.defaultProvider && firstModel) {
      await selectProvider(value.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS, true, `${value.id}/${firstModel.id}`);
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
    onUpdate: (input) => props.onUpdateCustomProvider?.(input),
    onSaved: (value) => void selectSavedEndpoint(value),
    onRemoved: (id) => {
      const provider = props.defaultProvider?.preferredProvider ?? null;
      if (isCustomProviderHarness(provider) && props.defaultProvider?.preferredModel?.startsWith(`${id}/`)) {
        void selectProvider(provider, false, null);
      }
    },
    // Main moves the agents off a model that the edit took out, and onto the provider that the edit
    // chose. The default model is the renderer's.
    onUpdated: (input) => {
      const provider = props.defaultProvider?.preferredProvider ?? null;
      const model = isCustomProviderHarness(provider) ? props.defaultProvider?.preferredModel : null;
      if (!provider || !model?.startsWith(`${input.id}/`)) return;
      if (!input.models.some((item) => model === `${input.id}/${item.id}`)) {
        void selectProvider(provider, false, null);
      } else if (input.harness && input.harness !== provider) {
        void selectProvider(input.harness, true, model);
      }
    },
  });
  const editing = () => host.state.editing;
  const editDraft = () => {
    const provider = editing();
    return provider ? savedCustomProviderDraft(provider) : undefined;
  };

  return (
    // The tab title already names this list, so it has no heading of its own.
    <div class="settings-provider-section">
      <ProviderSettingsPage
        options={props.store.providerOptions()}
        defaultProvider={
          props.defaultProvider
            ? {
                get value(): ProviderDefaultChoice | null {
                  if (saving.pending) return saving.pending.custom ? "custom" : saving.pending.provider;
                  return defaultCustomModel() ? "custom" : (props.defaultProvider?.preferredProvider ?? null);
                },
                get pending() {
                  return Boolean(saving.pending);
                },
                onChange: (choice: ProviderDefaultChoice) =>
                  void (choice === "custom" ? selectProvider(customProvider(), true) : selectProvider(choice)),
              }
            : undefined
        }
        disabled={Boolean(saving.pending)}
        usage={props.usage}
        customProviders={customProviders()}
        customProviderHarnesses={Boolean(harnesses())}
        onDownloadProvider={props.onDownloadProvider ? downloadProvider : undefined}
        onCancelProviderDownload={props.onCancelProviderDownload}
        onUpdateProvider={props.onUpdateProvider}
        onRestartProvider={props.onRestartProvider}
        onCancelProviderRestart={props.onCancelProviderRestart}
        onSetProviderOn={props.onSetProviderOn}
        onMeasureProviderDownload={props.onMeasureProviderDownload}
        onRemoveProviderDownload={props.onRemoveProviderDownload}
        connection={props.connection}
        onCancelProviderSignIn={props.onCancelProviderSignIn}
        onInstallProvider={props.onInstallProvider}
        onAddCustomProvider={
          props.onAddCustomProvider ? (props.detectedProviderApi ? () => setChoosing(true) : host.openForm) : undefined
        }
        onEditCustomProvider={props.onUpdateCustomProvider ? host.openEdit : undefined}
        onRemoveCustomProvider={props.onDeleteCustomProvider ? (provider) => void host.remove(provider) : undefined}
        removingCustomProvider={host.state.removing}
        onSignInProvider={props.onSignInProvider}
        accountActions={props.accountActions}
        menuMount={props.selectMount}
        onDetailChange={props.onDetailChange}
        promptCache={props.promptCache}
        footer={
          <>
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
            <Show when={props.acpRegistry} keyed>
              {(api) => <AcpRegistrySettings api={api} />}
            </Show>
            <Show when={props.customAgents}>{(api) => <CustomAgentSettings api={api()} />}</Show>
            {props.detectionSettings}
          </>
        }
      />
      <Show when={saving.error}>
        <Text role="alert">{saving.error}</Text>
      </Show>
      <Show when={downloadError()}>
        <Text role="alert">{downloadError()}</Text>
      </Show>
      <Show when={host.state.note}>
        {(message) => (
          <Text tone="muted" variant="caption" role="status">
            {message()}
          </Text>
        )}
      </Show>
      <Show when={props.onAddCustomProvider}>
        <CustomProviderDialog
          open={host.state.open}
          draft={editDraft()}
          providerIdLocked={Boolean(editing())}
          apiKeyKept={Boolean(editing()?.hasApiKey)}
          // Edit and the context window are both of this computer: the Team API has neither.
          contextWindows={Boolean(props.onUpdateCustomProvider)}
          harnesses={harnesses()}
          onDownloadHarness={downloadHarness()}
          harnessError={downloadError()}
          busy={host.state.saving}
          submitError={host.state.submitError}
          takenProviderIds={customProviders().map((provider) => provider.id)}
          onSubmit={(value) => void host.submit(value)}
          onCancel={host.closeForm}
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
              harnesses={harnesses()}
              onDownloadHarness={downloadHarness()}
              harnessError={downloadError()}
              onClose={() => setPresetFor(null)}
              onSaved={host.showSaved}
            />
          </>
        )}
      </Show>
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
  const [keyProvider, setKeyProvider] = createSignal<KeyDialogProvider>("opencode");
  const [openCodeKeyStatus, setOpenCodeKeyStatus] = createSignal<ProviderApiKeyStatus | undefined>(undefined);
  const [claudeKeyStatus, setClaudeKeyStatus] = createSignal<ProviderApiKeyStatus | undefined>(undefined);
  async function readKeyStatus(keys: ProviderKeyApi, provider: AgentProviderId) {
    try {
      return (await keys.getProviderApiKeyState(provider)).status;
    } catch {
      return undefined;
    }
  }
  async function refreshOpenCodeKeyStatus(): Promise<void> {
    const keys = props.providerKeys;
    if (!keys) return;
    const [openCode, claude] = await Promise.all([
      readKeyStatus(keys, "opencode"),
      keys.readsClaudeKey ? readKeyStatus(keys, "claude") : undefined,
    ]);
    // An answer from a source the modal has since left belongs to the other computer.
    if (keys !== props.providerKeys) return;
    setOpenCodeKeyStatus(openCode);
    setClaudeKeyStatus(claude);
  }
  // The badge has to answer on first paint: the key state arrives after the rows, so an open
  // without a read would show no badge until something else re-renders the list. The keys can move
  // to a joined server's host while the modal is open, when that host's admin role arrives, so a
  // new source is read again rather than keeping the other computer's answer.
  createEffect(
    () => (props.open ? props.providerKeys : undefined),
    (keys) => {
      setOpenCodeKeyStatus(undefined);
      setClaudeKeyStatus(undefined);
      if (keys) void untrack(refreshOpenCodeKeyStatus);
    },
  );
  return {
    keyDialogOpen,
    keyProvider,
    openCodeKeyStatus,
    claudeKeyStatus,
    /**
     * Only the providers whose sign-in can be a pasted key are served: OpenCode, Muse, Gemini, Claude
     * and, on this computer, Codex. Claude's Sign in also lands here on an older host, which would
     * store the key and never read it.
     */
    openKeyDialog(provider: AgentProviderId): void {
      if (isKeyDialogProvider(provider) && (provider !== "claude" || props.providerKeys?.readsClaudeKey)) {
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

/** The key and sign-in dialogs the section opens. Both portal over the dialog they open from. */
function ProviderSettingsDialogs(props: {
  keys: ProviderKeyState;
  providerKeys?: ProviderKeyApi | undefined;
  connection?: ProviderConnectionApi | undefined;
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
              // The reconnect asks the provider again, which only this computer's browser sign-in does.
              props.connection?.connectKind(props.keys.keyProvider()) === "browser"
                ? () => props.connection?.connect(props.keys.keyProvider())
                : undefined
            }
          />
        )}
      </Show>
      <ProviderSignInDialogs api={props.connection} />
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
  /** The names of the agents that use each account, by provider and account. */
  providerAccountUsers?: Partial<Record<AgentProviderId, Readonly<Record<string, readonly string[]>>>> | undefined;
  /** Adds, names and removes provider accounts on the computer that runs the providers. */
  accountActions?: ProviderAccountActions | undefined;
  onSetProviderOn?: ((provider: AgentProviderId, on: boolean) => void | Promise<void>) | undefined;
  onMeasureProviderDownload?: ((provider: AgentProviderId) => Promise<ProviderRuntimeDownload>) | undefined;
  onRemoveProviderDownload?: ((provider: AgentProviderId) => Promise<void>) | undefined;
  customProviders?: readonly CustomProviderSummary[] | undefined;
  onAddCustomProvider?: ((value: SaveCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  onDeleteCustomProvider?: ((id: string) => Promise<CustomProviderRestart>) | undefined;
  /** This computer only: the Team API has no edit route, so a joined server's section has no Edit. */
  onUpdateCustomProvider?: ((input: UpdateCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  providerKeys?: ProviderKeyApi | undefined;
  /** How each row signs in, from where the user connects. */
  connection?: ProviderConnectionApi | undefined;
  /** The browser sign-in and the install guide open on this computer, so only its section has them. */
  onCancelProviderSignIn?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
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
  /** The usage readings of each account, for the badge of an account that is low. */
  usage?: readonly AccountUsageProviderRow[] | undefined;
}

/**
 * The whole Providers section for a server: its list, and the dialogs it opens. Without `hostName`
 * the providers are this computer's.
 */
export function HostProviderSettingsPanel(
  props: HostProviderSettings & {
    hostName?: string | undefined;
    selectMount: HTMLElement | undefined;
    onDetailChange?: ((detail: ProviderSettingsDetail | null) => void) | undefined;
    /** The Claude page's prompt cache time, for a host with `prompt-cache-ttl-v1` that this account administers. */
    promptCache?: ProviderPromptCacheSource | undefined;
  },
) {
  const promptCache = createProviderPromptCache(() => props.promptCache);
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
    claudeKeyStatus: keys.claudeKeyStatus,
    get providerHostName() {
      return props.hostName;
    },
    get offProviders() {
      return props.offProviders;
    },
    get providerUsers() {
      return props.providerUsers;
    },
    get providerAccountUsers() {
      return props.providerAccountUsers;
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
        onMeasureProviderDownload={props.onMeasureProviderDownload}
        onRemoveProviderDownload={props.onRemoveProviderDownload}
        connection={props.connection}
        onCancelProviderSignIn={props.onCancelProviderSignIn}
        onInstallProvider={props.onInstallProvider}
        onAddCustomProvider={props.onAddCustomProvider}
        customProviders={props.customProviders}
        onDeleteCustomProvider={props.onDeleteCustomProvider}
        onUpdateCustomProvider={props.onUpdateCustomProvider}
        accountActions={props.accountActions}
        // With detection off there is no list, not an empty one.
        providerDetection={props.detectionSettings?.enabled === false ? undefined : props.providerDetection}
        detectedProviderApi={props.detectedProviderApi}
        takenAgentIds={props.takenAgentIds}
        customAgents={props.customAgents}
        acpRegistry={props.acpRegistry}
        onSignInProvider={props.providerKeys ? keys.openKeyDialog : undefined}
        usage={props.usage}
        onDetailChange={props.onDetailChange}
        promptCache={promptCache()}
        detectionSettings={
          <Show when={props.detectionSettings}>
            {(value) => (
              <ProviderDetectionSettings
                value={value()}
                error={props.detectionSettingsError}
                onChange={(next) => props.onDetectionSettingsChange?.(next)}
              />
            )}
          </Show>
        }
      />
      <ProviderSettingsDialogs keys={keys} providerKeys={props.providerKeys} connection={props.connection} />
    </>
  );
}

function harnessOf(endpoint: CustomProviderSummary | undefined): AgentProviderId {
  return endpoint?.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS;
}
