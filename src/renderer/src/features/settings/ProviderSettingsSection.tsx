import {
  type AgentModelId,
  type AgentProviderId,
  type AgentStatus,
  type AppSetupState,
  agentProviderName,
  CUSTOM_PROVIDER_HARNESSES,
  type CustomProviderRestart,
  type CustomProviderSummary,
  composedCustomModelId,
  customProviderOfModel,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  isCustomProviderHarness,
  type ManagedProviderId,
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
  type ProviderClaudeCompactWindow,
  type ProviderClaudeUserSetup,
  type ProviderDefaultChoice,
  type ProviderEnvironmentControl,
  type ProviderModelVisibilityControl,
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
import {
  createProviderClaudeCompactWindow,
  type ProviderClaudeCompactWindowSource,
} from "./provider-claude-compact-window";
import { createProviderClaudeUserSetup, type ProviderClaudeUserSetupSource } from "./provider-claude-user-setup";
import { createProviderEnvironment, type ProviderEnvironmentSource } from "./provider-environment";
import { createHostDefaultProvider, type HostDefaultProviderSource } from "./provider-host-default";
import { createProviderModelVisibility, type ProviderModelVisibilitySource } from "./provider-model-visibility";
import { createProviderPromptCache, type ProviderPromptCacheSource } from "./provider-prompt-cache";
import { createSettingsGeneralStore, type SettingsGeneralStore } from "./stores/general-store";

interface DefaultProviderSettings extends Pick<AppSetupState, "preferredProvider" | "preferredModel"> {
  save: (provider: AgentProviderId, model?: AgentModelId | null) => Promise<void>;
}

interface ProviderSettingsSectionProps {
  defaultProvider?: DefaultProviderSettings | undefined;
  store: SettingsGeneralStore;
  selectMount: HTMLElement | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onUpdateProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onRestartProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderRestart?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onChooseInstalledCli?: ((provider: ManagedProviderId, installed: boolean) => void | Promise<void>) | undefined;
  onSetProviderOn?: ((provider: AgentProviderId, on: boolean) => void | Promise<void>) | undefined;
  onMeasureProviderDownload?: ((provider: AgentProviderId) => Promise<ProviderRuntimeDownload>) | undefined;
  onRemoveProviderDownload?: ((provider: AgentProviderId) => Promise<void>) | undefined;
  onInstallProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderSignIn?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onAddCustomProvider?: ((value: SaveCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  customProviders?: readonly CustomProviderSummary[] | undefined;
  onDeleteCustomProvider?: ((id: string) => Promise<CustomProviderRestart>) | undefined;
  onUpdateCustomProvider?: ((input: UpdateCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  localEndpoints?: boolean | undefined;
  customProviderHarnessChoice?: boolean | undefined;
  onSignInProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  accountActions?: ProviderAccountActions | undefined;
  connection?: ProviderConnectionApi | undefined;
  providerDetection?: ProviderDetection | undefined;
  detectedProviderApi?: DetectedProviderApi | undefined;
  takenAgentIds?: readonly string[] | undefined;
  customAgents?: CustomAgentSettingsApi | undefined;
  acpRegistry?: AcpRegistrySettingsApi | undefined;
  detectionSettings?: JSX.Element;
  usage?: readonly AccountUsageProviderRow[] | undefined;
  onDetailChange?: ((detail: ProviderSettingsDetail | null) => void) | undefined;
  promptCache?: ProviderPromptCache | undefined;
  claudeUserSetup?: ProviderClaudeUserSetup | undefined;
  claudeCompactWindow?: ProviderClaudeCompactWindow | undefined;
  environment?: ((provider: AgentProviderId) => ProviderEnvironmentControl | undefined) | undefined;
  modelVisibility?: ((provider: AgentProviderId) => ProviderModelVisibilityControl) | undefined;
}

function ProviderSettingsSection(props: ProviderSettingsSectionProps) {
  const i18n = useText();
  const customProviders = () => props.customProviders ?? [];
  const [saving, setSaving] = createStore<{
    pending: { provider: AgentProviderId; custom: boolean } | null;
    error: string;
  }>({ pending: null, error: "" });
  const [downloadError, setDownloadError] = createSignal("");
  const defaultCustomModel = () => {
    const choice = props.defaultProvider;
    const endpoint = customProviderOfModel(choice?.preferredModel, customProviders());
    return endpoint && choice?.preferredProvider === harnessOf(endpoint) ? (choice.preferredModel ?? null) : null;
  };
  const harnesses = () =>
    props.localEndpoints || props.customProviderHarnessChoice
      ? CUSTOM_PROVIDER_HARNESSES.map((id) => {
          const option = props.store.providerOptions().find((item) => item.id === id);
          return { id, ready: servesCustomProvider(option), runtime: option?.runtimeStatus };
        })
      : undefined;
  const downloadHarness = () =>
    props.onDownloadProvider ? (id: AgentProviderId) => void downloadProvider(id) : undefined;
  const customProvider = (): AgentProviderId => {
    const model = defaultCustomModel() ?? firstEndpointModel();
    return harnessOf(customProviderOfModel(model, customProviders()));
  };
  const firstEndpointModel = () => {
    const endpoint = customProviders().find((item) => item.models.length > 0);
    const firstModel = endpoint?.models[0];
    return endpoint && firstModel ? composedCustomModelId(endpoint.id, firstModel.id) : null;
  };

  async function selectProvider(
    provider: AgentProviderId,
    custom = false,
    selectedModel?: AgentModelId | null,
  ): Promise<void> {
    if (saving.pending) return;
    const choice = props.defaultProvider;
    if (!choice) return;
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
      await selectProvider(
        value.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS,
        true,
        composedCustomModelId(value.id, firstModel.id),
      );
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
  const [choosing, setChoosing] = createSignal(false);
  const [presetFor, setPresetFor] = createSignal<DetectedProvider | null>(null);
  const host = createCustomProviderHostState({
    onAdd: (value) => props.onAddCustomProvider?.(value),
    onDelete: (id) => props.onDeleteCustomProvider?.(id),
    onUpdate: (input) => props.onUpdateCustomProvider?.(input),
    discoverModels: () => props.detectedProviderApi?.discoverModels,
    onSaved: (value) => void selectSavedEndpoint(value),
    onRemoved: (id) => {
      const provider = props.defaultProvider?.preferredProvider ?? null;
      if (isCustomProviderHarness(provider) && props.defaultProvider?.preferredModel?.startsWith(`${id}/`)) {
        void selectProvider(provider, false, null);
      }
    },
    onUpdated: (input) => {
      const provider = props.defaultProvider?.preferredProvider ?? null;
      const model = isCustomProviderHarness(provider) ? props.defaultProvider?.preferredModel : null;
      if (!provider || !model?.startsWith(`${input.id}/`)) return;
      if (!input.models.some((item) => model === composedCustomModelId(input.id, item.id))) {
        void selectProvider(provider, false, null);
      } else if (input.harness && input.harness !== provider) {
        void selectProvider(input.harness, true, model);
      }
    },
  });
  const editing = () => host.state.editing;
  const editDraft = () => {
    const provider = editing();
    return provider ? savedCustomProviderDraft(provider, i18n.format) : undefined;
  };

  return (
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
        onChooseInstalledCli={props.onChooseInstalledCli}
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
        claudeUserSetup={props.claudeUserSetup}
        claudeCompactWindow={props.claudeCompactWindow}
        environment={props.environment}
        modelVisibility={props.modelVisibility}
        footer={
          <>
            <Show when={props.providerDetection}>
              {(detection) => (
                <Show when={detectedApi()}>
                  {(api) => (
                    <DetectedProviders
                      detection={detection()}
                      onServer={!props.localEndpoints}
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
          contextWindows={Boolean(props.localEndpoints)}
          harnesses={harnesses()}
          onDownloadHarness={downloadHarness()}
          harnessError={downloadError()}
          discovery={host.discovery()}
          onDiscoverModels={host.discover()}
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
              host={!props.localEndpoints}
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

function createProviderKeyState(props: {
  readonly open: boolean;
  readonly providerKeys?: ProviderKeyApi | undefined;
  readonly codexState?: string | undefined;
}) {
  const [keyDialogOpen, setKeyDialogOpen] = createSignal(false);
  const [keyProvider, setKeyProvider] = createSignal<KeyDialogProvider>("opencode");
  const [openCodeKeyStatus, setOpenCodeKeyStatus] = createSignal<ProviderApiKeyStatus | undefined>(undefined);
  const [claudeKeyStatus, setClaudeKeyStatus] = createSignal<ProviderApiKeyStatus | undefined>(undefined);
  const [codexKeyStatus, setCodexKeyStatus] = createSignal<ProviderApiKeyStatus | undefined>(undefined);
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
    const [openCode, claude, codex] = await Promise.all([
      readKeyStatus(keys, "opencode"),
      keys.readsClaudeKey ? readKeyStatus(keys, "claude") : undefined,
      keys.readsCodexKey && keys.onHost ? readKeyStatus(keys, "codex") : undefined,
    ]);
    if (keys !== props.providerKeys) return;
    setOpenCodeKeyStatus(openCode);
    setClaudeKeyStatus(claude);
    setCodexKeyStatus(codex);
  }
  createEffect(
    () => (props.open ? props.providerKeys : undefined),
    (keys) => {
      setOpenCodeKeyStatus(undefined);
      setClaudeKeyStatus(undefined);
      setCodexKeyStatus(undefined);
      if (keys) void untrack(refreshOpenCodeKeyStatus);
    },
  );
  let codexState: string | undefined;
  createEffect(
    () => props.codexState,
    (state) => {
      const previous = codexState;
      codexState = state;
      const keys = untrack(() => props.providerKeys);
      if (previous === undefined || state === previous || !keys?.readsCodexKey || !keys.onHost) return;
      void readKeyStatus(keys, "codex").then((status) => {
        if (keys === props.providerKeys) setCodexKeyStatus(status);
      });
    },
  );
  return {
    keyDialogOpen,
    keyProvider,
    openCodeKeyStatus,
    claudeKeyStatus,
    codexKeyStatus,
    openKeyDialog(provider: AgentProviderId): void {
      if (
        isKeyDialogProvider(provider) &&
        (provider !== "claude" || props.providerKeys?.readsClaudeKey) &&
        (provider !== "codex" || props.providerKeys?.readsCodexKey)
      ) {
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

export interface HostProviderSettings {
  defaultProvider?: DefaultProviderSettings | undefined;
  agentStatus: AgentStatus;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;
  providerAvailableVersions?: Partial<Record<AgentProviderId, string | null>> | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onUpdateProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onRestartProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderRestart?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onChooseInstalledCli?: ((provider: ManagedProviderId, installed: boolean) => void | Promise<void>) | undefined;
  offProviders?: readonly AgentProviderId[] | undefined;
  providerUsers?: Partial<Record<AgentProviderId, readonly string[]>> | undefined;
  providerAccountUsers?: Partial<Record<AgentProviderId, Readonly<Record<string, readonly string[]>>>> | undefined;
  accountActions?: ProviderAccountActions | undefined;
  onSetProviderOn?: ((provider: AgentProviderId, on: boolean) => void | Promise<void>) | undefined;
  onMeasureProviderDownload?: ((provider: AgentProviderId) => Promise<ProviderRuntimeDownload>) | undefined;
  onRemoveProviderDownload?: ((provider: AgentProviderId) => Promise<void>) | undefined;
  customProviders?: readonly CustomProviderSummary[] | undefined;
  onAddCustomProvider?: ((value: SaveCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  onDeleteCustomProvider?: ((id: string) => Promise<CustomProviderRestart>) | undefined;
  onUpdateCustomProvider?: ((input: UpdateCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  customProviderHarnessChoice?: boolean | undefined;
  providerKeys?: ProviderKeyApi | undefined;
  connection?: ProviderConnectionApi | undefined;
  onCancelProviderSignIn?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onInstallProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  providerDetection?: ProviderDetection | undefined;
  detectedProviderApi?: DetectedProviderApi | undefined;
  takenAgentIds?: readonly string[] | undefined;
  customAgents?: CustomAgentSettingsApi | undefined;
  acpRegistry?: AcpRegistrySettingsApi | undefined;
  detectionSettings?: ProviderDetectionSettingsValue | undefined;
  onDetectionSettingsChange?: ((value: ProviderDetectionSettingsValue) => void) | undefined;
  detectionSettingsError?: string | null | undefined;
  onShown?: (() => void) | undefined;
  usage?: readonly AccountUsageProviderRow[] | undefined;
}

export function HostProviderSettingsPanel(
  props: HostProviderSettings & {
    hostName?: string | undefined;
    selectMount: HTMLElement | undefined;
    onDetailChange?: ((detail: ProviderSettingsDetail | null) => void) | undefined;
    promptCache?: ProviderPromptCacheSource | undefined;
    claudeUserSetup?: ProviderClaudeUserSetupSource | undefined;
    claudeCompactWindow?: ProviderClaudeCompactWindowSource | undefined;
    providerEnvironment?: ProviderEnvironmentSource | undefined;
    modelVisibility?: ProviderModelVisibilitySource | undefined;
    hostDefaultProvider?: HostDefaultProviderSource | undefined;
  },
) {
  const hostDefaultProvider = createHostDefaultProvider(() => props.hostDefaultProvider);
  const promptCache = createProviderPromptCache(
    () => props.promptCache,
    () => props.agentStatus,
  );
  const modelVisibility = createProviderModelVisibility(
    () => props.modelVisibility,
    () => props.agentStatus,
  );
  const claudeUserSetup = createProviderClaudeUserSetup(
    () => props.claudeUserSetup,
    () => props.agentStatus,
  );
  const claudeCompactWindow = createProviderClaudeCompactWindow(
    () => props.claudeCompactWindow,
    () => props.agentStatus,
  );
  const environment = createProviderEnvironment(
    () => props.providerEnvironment,
    () => props.agentStatus,
  );
  const keys = createProviderKeyState({
    open: true,
    get providerKeys() {
      return props.providerKeys;
    },
    get codexState() {
      return props.agentStatus?.providers?.find((provider) => provider.id === "codex")?.state;
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
    codexKeyStatus: keys.codexKeyStatus,
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
        defaultProvider={props.defaultProvider ?? hostDefaultProvider()}
        store={store}
        selectMount={props.selectMount}
        onDownloadProvider={props.onDownloadProvider}
        onCancelProviderDownload={props.onCancelProviderDownload}
        onUpdateProvider={props.onUpdateProvider}
        onRestartProvider={props.onRestartProvider}
        onCancelProviderRestart={props.onCancelProviderRestart}
        onChooseInstalledCli={props.onChooseInstalledCli}
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
        localEndpoints={props.hostName === undefined}
        customProviderHarnessChoice={props.customProviderHarnessChoice}
        accountActions={props.accountActions}
        providerDetection={props.detectionSettings?.enabled === false ? undefined : props.providerDetection}
        detectedProviderApi={props.detectedProviderApi}
        takenAgentIds={props.takenAgentIds}
        customAgents={props.customAgents}
        acpRegistry={props.acpRegistry}
        onSignInProvider={props.providerKeys ? keys.openKeyDialog : undefined}
        usage={props.usage}
        onDetailChange={props.onDetailChange}
        promptCache={promptCache()}
        claudeUserSetup={claudeUserSetup()}
        claudeCompactWindow={claudeCompactWindow()}
        environment={environment()}
        modelVisibility={modelVisibility()}
        detectionSettings={
          <Show when={props.detectionSettings}>
            {(value) => (
              <ProviderDetectionSettings
                value={value()}
                error={props.detectionSettingsError}
                onServer={props.hostName !== undefined}
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
