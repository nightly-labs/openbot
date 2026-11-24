import {
  AGENT_PROVIDER_DESCRIPTORS,
  type AgentModelId,
  type AgentProviderId,
  type AgentStatus,
  CUSTOM_PROVIDER_HARNESSES,
  type CustomProviderHarness,
  type CustomProviderRestart,
  type CustomProviderSummary,
  customProviderOfModel,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  isCustomProviderHarness,
  isLocalOnlyProvider,
  type ProviderRuntimeStatus,
  type SaveCustomProviderInput,
  savedCustomModelId,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  type ProviderConnection,
  ProviderPicker,
  type ProviderPickerOption,
} from "@openbot/ui/components/ProviderPicker";
import { freeModelsReady, servesCustomProvider } from "@openbot/ui/components/provider-row";
import {
  CustomProviderDialog,
  type CustomProviderHarnessChoice,
} from "@openbot/ui/features/custom-providers/CustomProviderDialog";
import { CustomProviderListDialog } from "@openbot/ui/features/custom-providers/CustomProviderListDialog";
import { DetectedProviders } from "@openbot/ui/features/custom-providers/DetectedProviders";
import type { DetectedProviderApi, ProviderDetection } from "@openbot/ui/features/custom-providers/detected-providers";
import {
  isKeyDialogProvider,
  type KeyDialogProvider,
  OpenCodeKeyDialog,
  type ProviderKeyApi,
} from "@openbot/ui/features/settings/OpenCodeKeyDialog";
import { useText } from "@openbot/ui/text";
import { errorReference, type UserErrorDetails } from "@openbot/user-errors";
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";
import { ProviderSignInDialogs } from "../../components/ProviderSignInDialogs";
import type { ProviderConnectionApi } from "../../components/provider-connection-api";
import { createCustomProviderHostState } from "../custom-providers/custom-provider-host-state";
import { FREE_PROVIDER, onboardingProviderRows } from "./onboarding-provider-rows";
import { fallbackProviderState } from "./onboarding-provider-state";

export interface SetupProviderProps {
  agentStatus: AgentStatus;
  hostProviders?: boolean | undefined;
  customProviderHarnessChoice?: boolean | undefined;
  refreshingProviders?: boolean | undefined;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;
  providerAvailableVersions?: Partial<Record<AgentProviderId, string | null>> | undefined;
  onUpdateProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderSignIn?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onInstallProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onSignInProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  providerKeys?: ProviderKeyApi | undefined;
  connection?: ProviderConnectionApi | undefined;
  onRefreshProviders?: (() => void | Promise<void>) | undefined;
  onAddCustomProvider?: ((value: SaveCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  onDeleteCustomProvider?: ((id: string) => Promise<CustomProviderRestart>) | undefined;
  customProviders?: readonly CustomProviderSummary[] | undefined;
  providerDetection?: ProviderDetection | undefined;
  detectedProviderApi?: DetectedProviderApi | undefined;
  takenAgentIds?: readonly string[] | undefined;
}

export interface SetupProviderOptions {
  includeFree?: () => boolean;
}

export interface SetupProviderChoice {
  provider: AgentProviderId | null;
  customModel: () => AgentModelId | null;
}

const INCLUDED_DESCRIPTION = "Included with OpenBot";

const SETUP_PROVIDERS: Array<{ id: AgentProviderId; name: string; description: string | null }> =
  AGENT_PROVIDER_DESCRIPTORS.filter((descriptor) => descriptor.id !== "acp").map((descriptor) => ({
    id: descriptor.id,
    name: descriptor.displayName,
    description: descriptor.onboardingDescription === INCLUDED_DESCRIPTION ? null : descriptor.onboardingDescription,
  }));

const PROVIDER_DESCRIPTION_KEYS: Readonly<Record<string, AppTextKey>> = {
  "Free models, no account needed": "onboarding.provider.freeModels",
  "Google AI Pro or Ultra plan": "onboarding.provider.googlePlan",
  "Cursor plan or API key": "onboarding.provider.cursorPlan",
  "Free models with a Cline account": "onboarding.provider.clineAccount",
  "Kimi models with a Kimi Code account": "onboarding.provider.kimiAccount",
  "Many models with a Devin account": "onboarding.provider.devinAccount",
  "Many models with a Copilot plan": "onboarding.provider.copilotAccount",
  "Mistral models with a Mistral account": "onboarding.provider.mistralAccount",
  "Mercury models with an Inception API key": "onboarding.provider.inceptionKey",
  "DeepSeek models with a DeepSeek API key": "onboarding.provider.deepseekKey",
  "Many models with an OpenRouter API key": "onboarding.provider.openrouterKey",
  "Uncensored open-weight models with a bf16.ai API key": "onboarding.provider.bf16Key",
  "Nous Portal plan or your Hermes setup": "onboarding.provider.hermesNous",
};

function providerReady(option: ProviderPickerOption): boolean {
  return option.state === "available" || freeModelsReady(option);
}

export function savedCustomModel(
  provider: AgentProviderId | null,
  model: AgentModelId | null,
  customProviders: readonly CustomProviderSummary[] | undefined,
): AgentModelId | null {
  if (!isCustomProviderHarness(provider) || !model) return null;
  const endpoint = customProviderOfModel(model, customProviders ?? []);
  return endpoint && harnessOf(endpoint) === provider ? model : null;
}

function harnessOf(endpoint: CustomProviderSummary): CustomProviderHarness {
  return endpoint.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS;
}

export type SetupProviders = ReturnType<typeof createSetupProviders>;

export function createSetupProviders(
  props: SetupProviderProps,
  initial?: SetupProviderChoice,
  settings: SetupProviderOptions = {},
) {
  const { t, errorMessage } = useText();
  const includeFree = () => settings.includeFree?.() ?? true;
  const [selectedProvider, setSelectedProvider] = createSignal<AgentProviderId | null>(initial?.provider ?? null);
  const [customSelected, setCustomSelected] = createSignal(Boolean(untrack(() => initial?.customModel())));
  const [customModel, setCustomModel] = createSignal<AgentModelId | null>(
    untrack(() => initial?.customModel()) ?? null,
  );
  const [providerSelectedByUser, setProviderSelectedByUser] = createSignal(Boolean(initial?.provider));
  let choiceChanged = false;
  const [keyProvider, setKeyProvider] = createSignal<KeyDialogProvider | null>(null);
  const [error, setErrorText] = createSignal("");
  const [errorCode, setErrorCode] = createSignal<UserErrorDetails | null>(null);
  const setError = (message: string, cause?: unknown) => {
    setErrorText(message);
    const reference = cause === undefined ? null : errorReference(cause);
    setErrorCode(reference ? { message, reference } : null);
  };
  const [providerErrors, setProviderErrors] = createSignal<Partial<Record<AgentProviderId, string>>>({});
  const selectedProviderError = () => {
    const selected = selectedProvider();
    return selected ? providerErrors()[selected] : undefined;
  };
  const visibleError = createMemo(() => error() || selectedProviderError() || "");
  const previousConnectionStates = new Map<AgentProviderId, boolean>();
  const connectionStartingMessages = new Map<AgentProviderId, string | null>();
  const refreshedConnectionStates = new Set<AgentProviderId>();
  const providersAwaitingFocusRefresh = new Set<AgentProviderId>();
  let blurredAfterProviderConnect = false;
  let focusRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  const providerOptions = createMemo<ProviderPickerOption[]>(() =>
    SETUP_PROVIDERS.filter(
      (provider) =>
        !props.hostProviders ||
        !isLocalOnlyProvider(provider.id) ||
        props.agentStatus.providers?.some((candidate) => candidate.id === provider.id) === true,
    ).map((provider) => {
      const status = props.agentStatus.providers?.find((candidate) => candidate.id === provider.id);
      const runtime = props.providerRuntimeStatuses?.[provider.id];
      const descriptionKey = provider.description ? PROVIDER_DESCRIPTION_KEYS[provider.description] : undefined;
      return {
        ...provider,
        description: descriptionKey ? t(descriptionKey) : provider.description,
        state: status?.state ?? fallbackProviderState(props.agentStatus),
        message: status?.message,
        email: status?.email,
        connectionState: status?.connectionState,
        signInPending: status?.signInPending,
        checkError: status?.checkError,
        availableVersion: props.providerAvailableVersions?.[provider.id] ?? null,
        freeModels: provider.id === "opencode",
        callout:
          provider.id === "opencode"
            ? { title: t("onboarding.provider.tryFree"), detail: t("onboarding.provider.noSignIn") }
            : null,
        runtimeStatus:
          runtime?.phase === "not-downloaded" && (status?.state === "available" || status?.state === "sign-in-required")
            ? { ...runtime, phase: "ready", version: status.version }
            : runtime,
      };
    }),
  );
  const [keptProviders, setKeptProviders] = createSignal<AgentProviderId[] | null>(null);
  const [customRevealed, setCustomRevealed] = createSignal(false);
  const freeRow = () =>
    includeFree() || (selectedProvider() === FREE_PROVIDER && providerSelectedByUser() && !customSelected());
  const providerRows = createMemo(() => {
    const kept = keptProviders();
    const host = Boolean(props.hostProviders);
    const rows = onboardingProviderRows(providerOptions(), kept ?? [], freeRow(), host);
    const saved = initial?.provider;
    if (kept || !saved || rows.listed.some((option) => option.id === saved)) return rows;
    return onboardingProviderRows(providerOptions(), [...planRowIds(rows.listed), saved], freeRow(), host);
  });
  const providersReported = createMemo(
    () =>
      Boolean(props.hostProviders) &&
      props.agentStatus.phase !== "starting" &&
      props.agentStatus.phase !== "restarting" &&
      providerOptions().every((option) => option.state !== "checking"),
  );
  createEffect(
    () => (providersReported() && keptProviders() === null ? planRowIds(providerRows().listed) : null),
    (rows) => {
      if (rows) setKeptProviders(rows);
    },
  );
  const customInMore = () =>
    Boolean(props.onAddCustomProvider) && (props.customProviders ?? []).length === 0 && !customRevealed();

  function keepProviderRows(provider?: AgentProviderId): void {
    const kept = keptProviders() ?? planRowIds(providerRows().listed);
    const next = provider && provider !== FREE_PROVIDER && !kept.includes(provider) ? [...kept, provider] : kept;
    if (next !== keptProviders()) setKeptProviders(next);
  }

  function chooseProvider(provider: AgentProviderId): void {
    keepProviderRows(provider);
    choiceChanged = true;
    setProviderSelectedByUser(true);
    setSelectedProvider(provider);
    setCustomSelected(false);
  }

  const harnesses = createMemo((): CustomProviderHarnessChoice[] | undefined =>
    props.hostProviders && !props.customProviderHarnessChoice
      ? undefined
      : CUSTOM_PROVIDER_HARNESSES.map((id) => {
          const option = providerOptions().find((item) => item.id === id);
          return { id, ready: servesCustomProvider(option), runtime: option?.runtimeStatus };
        }),
  );
  function customHarness(): CustomProviderHarness {
    const endpoint = customProviderOfModel(customModel() ?? firstSavedCustomModel(), props.customProviders ?? []);
    if (endpoint) return harnessOf(endpoint);
    return harnesses()?.find((choice) => choice.ready)?.id ?? DEFAULT_CUSTOM_PROVIDER_HARNESS;
  }
  const [harnessError, setHarnessError] = createSignal("");
  async function downloadHarness(harness: CustomProviderHarness): Promise<void> {
    if (!props.onDownloadProvider) return;
    setHarnessError("");
    try {
      await props.onDownloadProvider(harness);
    } catch (cause) {
      setHarnessError(errorMessage(cause, t("onboarding.error.download", { provider: providerName(harness) })));
    }
  }

  function openCustomForm(): void {
    setHarnessError("");
    host.openForm();
  }

  function chooseMoreCustom(): void {
    keepProviderRows();
    setCustomRevealed(true);
    if (servesCustomProvider(providerOptions().find((option) => option.id === customHarness()))) openCustomForm();
  }

  const host = createCustomProviderHostState({
    onAdd: (value) => props.onAddCustomProvider?.(value),
    onDelete: (id) => props.onDeleteCustomProvider?.(id),
    discoverModels: () => props.detectedProviderApi?.discoverModels,
    onSaved: selectSavedEndpoint,
    onRemoved: (id) => {
      if (customModel()?.startsWith(`${id}/`)) setCustomModel(null);
      setCustomRevealed(true);
      if ((props.customProviders ?? []).length === 0) setCustomSelected(false);
      else if (customSelected()) setSelectedProvider(customHarness());
    },
  });

  function firstSavedCustomModel(): AgentModelId | null {
    for (const provider of props.customProviders ?? []) {
      const [model] = provider.models;
      if (model) return savedCustomModelId(provider.id, provider.harness, model.id);
    }
    return null;
  }

  function selectSavedEndpoint(value: SaveCustomProviderInput): void {
    selectCustomProvider(value.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS);
    const [firstModel] = value.models;
    if (firstModel) setCustomModel(savedCustomModelId(value.id, value.harness, firstModel.id));
  }

  const detectedApi = createMemo((): DetectedProviderApi | undefined => {
    const api = props.detectedProviderApi;
    if (!api) return undefined;
    return {
      ...api,
      save: async (provider, value) => {
        const restart = await api.save(provider, value);
        if (value.kind === "models") selectSavedEndpoint(value.value);
        return restart;
      },
    };
  });

  function selectCustomProvider(harness: CustomProviderHarness = customHarness()): void {
    keepProviderRows();
    choiceChanged = true;
    setProviderSelectedByUser(true);
    setSelectedProvider(harness);
    setCustomSelected(true);
  }

  createEffect(
    () => initial?.customModel() ?? null,
    (model) => {
      if (!model || choiceChanged || customSelected()) return;
      setCustomSelected(true);
      setCustomModel(model);
    },
  );

  const selectedProviderConnected = createMemo(() => {
    const selected = selectedProvider();
    const option = selected ? providerOptions().find((provider) => provider.id === selected) : undefined;
    if (!option) return false;
    return customSelected() && isCustomProviderHarness(selected) ? servesCustomProvider(option) : providerReady(option);
  });

  createEffect(
    () => ({
      options: providerOptions(),
      selected: selectedProvider(),
      selectedByUser: providerSelectedByUser(),
      withFree: includeFree(),
    }),
    ({ options: allOptions, selected, selectedByUser, withFree }) => {
      if (selectedByUser && selected && allOptions.some((provider) => provider.id === selected)) return;
      const options = withFree ? allOptions : allOptions.filter((provider) => provider.id !== FREE_PROVIDER);
      const signedIn = options.find((provider) => provider.state === "available" && !provider.freeModels);
      const selectedReady = options.some((provider) => provider.id === selected && providerReady(provider));
      if (selectedReady && !(signedIn && selected === FREE_PROVIDER)) return;
      const ready =
        signedIn ??
        options.find((provider) => provider.state === "sign-in-required" && !provider.freeModels) ??
        options.find((provider) => providerReady(provider));
      setSelectedProvider(ready?.id ?? null);
    },
  );

  createEffect(
    () => props.agentStatus.providers,
    (providers) => {
      for (const provider of SETUP_PROVIDERS) {
        const status = providers?.find((candidate) => candidate.id === provider.id);
        const connecting = status?.connectionState === "connecting";
        const wasConnecting = previousConnectionStates.get(provider.id) ?? false;
        if (wasConnecting && !connecting) {
          const startingMessage = connectionStartingMessages.get(provider.id) ?? null;
          if (refreshedConnectionStates.delete(provider.id)) {
            setProviderErrors((current) => ({ ...current, [provider.id]: undefined }));
          } else {
            setProviderErrors((current) => ({
              ...current,
              [provider.id]: status?.message && status.message !== startingMessage ? status.message : undefined,
            }));
          }
          connectionStartingMessages.delete(provider.id);
          if (status?.state === "available") providersAwaitingFocusRefresh.delete(provider.id);
        }
        previousConnectionStates.set(provider.id, connecting);
      }
    },
  );

  const handleWindowBlur = (): void => {
    if (providersAwaitingFocusRefresh.size > 0) blurredAfterProviderConnect = true;
  };
  const handleWindowFocus = (): void => {
    if (!blurredAfterProviderConnect || providersAwaitingFocusRefresh.size === 0 || focusRefreshTimer) return;
    const synchronize = (): void => {
      focusRefreshTimer = undefined;
      if (props.refreshingProviders) {
        focusRefreshTimer = setTimeout(synchronize, 250);
        return;
      }
      const signingIn = props.agentStatus.providers?.some(
        (status) => providersAwaitingFocusRefresh.has(status.id) && status.connectionState === "connecting",
      );
      if (signingIn) {
        blurredAfterProviderConnect = false;
        return;
      }
      providersAwaitingFocusRefresh.clear();
      blurredAfterProviderConnect = false;
      void refreshProviders();
    };
    focusRefreshTimer = setTimeout(synchronize, 250);
  };
  window.addEventListener("blur", handleWindowBlur);
  window.addEventListener("focus", handleWindowFocus);

  onCleanup(() => {
    window.removeEventListener("blur", handleWindowBlur);
    window.removeEventListener("focus", handleWindowFocus);
    if (focusRefreshTimer) clearTimeout(focusRefreshTimer);
  });

  function providerName(provider: AgentProviderId): string {
    return (
      SETUP_PROVIDERS.find((candidate) => candidate.id === provider)?.name ?? t("onboarding.provider.fallbackName")
    );
  }

  async function openProviderGuide(
    provider: AgentProviderId,
    action: ((provider: AgentProviderId) => void | Promise<void>) | undefined,
    kind: "install" | "sign-in",
  ): Promise<void> {
    if (!action) return;
    keepProviderRows();
    setError("");
    try {
      await action(provider);
    } catch (cause) {
      setError(
        kind === "install"
          ? t("onboarding.error.installGuide", { provider: providerName(provider) })
          : t("onboarding.error.signInGuide", { provider: providerName(provider) }),
        cause,
      );
    }
  }

  function signInProvider(provider: AgentProviderId): void {
    if (isKeyDialogProvider(provider) && provider !== "claude" && provider !== "codex" && props.providerKeys) {
      setKeyProvider(provider);
      return;
    }
    void openProviderGuide(provider, props.onSignInProvider, "sign-in");
  }

  function connectProvider(provider: AgentProviderId): Promise<boolean> {
    return followSignIn(provider, (connection) => connection.connect(provider));
  }

  function connectProviderInMainlandChina(provider: AgentProviderId): Promise<boolean> {
    return followSignIn(provider, (connection) => connection.connectInMainlandChina?.(provider) ?? Promise.resolve());
  }

  async function followSignIn(
    provider: AgentProviderId,
    start: (connection: ProviderConnectionApi) => Promise<void>,
  ): Promise<boolean> {
    const connection = props.connection;
    const kind = connection?.connectKind(provider);
    if (!connection || !kind || props.refreshingProviders) return true;
    chooseProvider(provider);
    if (kind === "dialog") {
      await start(connection);
      return true;
    }
    setError("");
    setProviderErrors((current) => ({ ...current, [provider]: undefined }));
    providersAwaitingFocusRefresh.add(provider);
    refreshedConnectionStates.delete(provider);
    connectionStartingMessages.set(
      provider,
      props.agentStatus.providers?.find((candidate) => candidate.id === provider)?.message ?? null,
    );
    try {
      await start(connection);
      return true;
    } catch (cause) {
      providersAwaitingFocusRefresh.delete(provider);
      setError(t("onboarding.error.connect", { provider: providerName(provider) }), cause);
      return false;
    }
  }

  async function downloadProvider(provider: AgentProviderId): Promise<boolean> {
    if (!props.onDownloadProvider) return true;
    keepProviderRows();
    setError("");
    setProviderErrors((current) => ({ ...current, [provider]: undefined }));
    setProviderSelectedByUser(true);
    setSelectedProvider(provider);
    try {
      await props.onDownloadProvider(provider);
      return true;
    } catch (cause) {
      setError(t("onboarding.error.download", { provider: providerName(provider) }), cause);
      return false;
    }
  }

  async function cancelProviderDownload(provider: AgentProviderId): Promise<void> {
    if (!props.onCancelProviderDownload) return;
    setError("");
    try {
      await props.onCancelProviderDownload(provider);
    } catch (cause) {
      setError(t("onboarding.error.cancelDownload", { provider: providerName(provider) }), cause);
    }
  }

  async function refreshProviders(): Promise<void> {
    if (!props.onRefreshProviders || props.refreshingProviders) return;
    setError("");
    setProviderErrors({});
    for (const provider of SETUP_PROVIDERS) {
      if (previousConnectionStates.get(provider.id)) refreshedConnectionStates.add(provider.id);
      previousConnectionStates.set(provider.id, false);
      connectionStartingMessages.delete(provider.id);
    }
    try {
      await props.onRefreshProviders();
    } catch (cause) {
      setError(t("onboarding.error.refresh"), cause);
    }
  }

  return {
    props,
    options: providerOptions,
    rows: providerRows,
    customInMore,
    selectedProvider,
    customSelected,
    customModel: () => customModel() ?? firstSavedCustomModel(),
    detectedApi,
    selectedProviderConnected,
    error: visibleError,
    errorReference: () => {
      const code = errorCode();
      return code && code.message === visibleError() ? code.reference : null;
    },
    setError,
    clearErrors: () => {
      setError("");
      setProviderErrors({});
    },
    keyProvider,
    closeKeyDialog: () => setKeyProvider(null),
    host,
    harnesses,
    harnessError,
    downloadHarness,
    openCustomForm,
    customEngine: () => providerOptions().find((option) => option.id === customHarness()),
    chooseProvider,
    chooseMoreCustom,
    selectCustomProvider,
    signInProvider,
    connectProvider,
    connectProviderInMainlandChina,
    downloadProvider,
    clearChoice: () => {
      choiceChanged = true;
      setProviderSelectedByUser(false);
      setCustomSelected(false);
      setSelectedProvider(null);
    },
    cancelProviderDownload,
    refreshProviders,
    openProviderGuide,
  };
}

function planRowIds(listed: readonly ProviderPickerOption[]): AgentProviderId[] {
  return listed.map((option) => option.id).filter((id) => id !== FREE_PROVIDER);
}

export interface SetupProviderPickerProps {
  providers: SetupProviders;
  ariaLabel: string;
  label: string;
  hint: string;
  disabled: boolean;
  menuMount: HTMLElement | undefined;
}

export function SetupProviderPicker(props: SetupProviderPickerProps) {
  const { t } = useText();
  const source = () => props.providers.props;
  const lazyProviderMode = () => Boolean(source().providerRuntimeStatuses || source().onDownloadProvider);
  const connection = createMemo((): ProviderConnection | undefined => {
    const api = source().connection;
    return api
      ? {
          connectKind: api.connectKind,
          alternativeKind: api.alternativeKind,
          alternative: api.alternative,
          connect: async (provider) => {
            await props.providers.connectProvider(provider);
          },
          ...(api.mainlandChinaSite && api.connectInMainlandChina
            ? {
                mainlandChinaSite: api.mainlandChinaSite,
                connectInMainlandChina: async (provider) => {
                  await props.providers.connectProviderInMainlandChina(provider);
                },
              }
            : {}),
        }
      : undefined;
  });
  return (
    <>
      <ProviderPicker
        value={props.providers.selectedProvider()}
        options={props.providers.rows().listed}
        ariaLabel={props.ariaLabel}
        label={props.label}
        hint={props.hint}
        allowUnavailableSelection
        focusFirst
        disabled={props.disabled}
        refreshingProviders={source().refreshingProviders}
        connection={connection()}
        onCancelProviderSignIn={source().onCancelProviderSignIn}
        onDownloadProvider={
          source().onDownloadProvider
            ? async (provider) => {
                await props.providers.downloadProvider(provider);
              }
            : undefined
        }
        onCancelProviderDownload={
          source().onCancelProviderDownload ? props.providers.cancelProviderDownload : undefined
        }
        onInstallProvider={
          source().onInstallProvider
            ? (provider) => props.providers.openProviderGuide(provider, source().onInstallProvider, "install")
            : undefined
        }
        onSignInProvider={
          source().onSignInProvider || source().providerKeys ? props.providers.signInProvider : undefined
        }
        onUpdateProvider={source().onUpdateProvider}
        menuMount={props.menuMount}
        onRefreshProviders={
          !lazyProviderMode() && source().onRefreshProviders ? props.providers.refreshProviders : undefined
        }
        onAddCustomProvider={source().onAddCustomProvider ? props.providers.openCustomForm : undefined}
        customProviders={source().customProviders}
        customSelected={props.providers.customSelected()}
        onSelectCustomProvider={source().onAddCustomProvider ? props.providers.selectCustomProvider : undefined}
        onManageCustomProviders={source().onAddCustomProvider ? props.providers.host.openList : undefined}
        moreProviders={props.providers.rows().hidden}
        customInMore={props.providers.customInMore()}
        customEngine={props.providers.customEngine()}
        versionInDetail
        moreCallout={{
          title: t("onboarding.provider.moreTitle"),
          detail: t("onboarding.provider.moreDetail"),
        }}
        onChooseMoreProvider={props.providers.chooseProvider}
        onChooseMoreCustom={props.providers.chooseMoreCustom}
        detected={
          <Show
            when={
              source().providerDetection?.scanning ||
              source().providerDetection?.found.length ||
              source().providerDetection?.hidden
                ? source().providerDetection
                : undefined
            }
          >
            {(detection) => (
              <Show when={props.providers.detectedApi()}>
                {(api) => (
                  <DetectedProviders
                    detection={detection()}
                    api={api()}
                    takenProviderIds={(source().customProviders ?? []).map((provider) => provider.id)}
                    takenAgentIds={source().takenAgentIds}
                    disabled={props.disabled}
                  />
                )}
              </Show>
            )}
          </Show>
        }
        onChange={props.providers.chooseProvider}
      />
      <Show when={source().onAddCustomProvider}>
        <CustomProviderDialog
          open={props.providers.host.state.open}
          contextWindows={!source().hostProviders}
          harnesses={props.providers.harnesses()}
          onDownloadHarness={
            source().onDownloadProvider ? (harness) => void props.providers.downloadHarness(harness) : undefined
          }
          harnessError={props.providers.harnessError()}
          discovery={props.providers.host.discovery()}
          onDiscoverModels={props.providers.host.discover()}
          busy={props.providers.host.state.saving}
          submitError={props.providers.host.state.submitError}
          takenProviderIds={(source().customProviders ?? []).map((provider) => provider.id)}
          onSubmit={(value) => void props.providers.host.submit(value)}
          onCancel={props.providers.host.closeForm}
        />
        <CustomProviderListDialog
          open={props.providers.host.state.manageOpen}
          providers={source().customProviders ?? []}
          removing={props.providers.host.state.removing}
          note={props.providers.host.state.note}
          onDelete={
            source().onDeleteCustomProvider ? (provider) => void props.providers.host.remove(provider) : undefined
          }
          onClose={props.providers.host.closeList}
        />
      </Show>
      <Show when={props.providers.keyProvider()} keyed>
        {(provider) => (
          <Show when={source().providerKeys}>
            {(api) => (
              <OpenCodeKeyDialog
                api={api()}
                provider={provider}
                onClose={props.providers.closeKeyDialog}
                onReconnect={
                  source().connection?.connectKind(provider) === "browser"
                    ? async () => {
                        await props.providers.connectProvider(provider);
                      }
                    : undefined
                }
              />
            )}
          </Show>
        )}
      </Show>
      <ProviderSignInDialogs api={source().connection} />
    </>
  );
}
