import {
  AGENT_PROVIDER_DESCRIPTORS,
  type AgentModelId,
  type AgentProviderId,
  type AgentStatus,
  type CustomProviderRestart,
  type CustomProviderSummary,
  type ProviderRuntimeStatus,
  type SaveCustomProviderInput,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { ProviderCodeLoginDialog } from "@openbot/ui/components/ProviderCodeLoginDialog";
import { freeModelsReady, ProviderPicker, type ProviderPickerOption } from "@openbot/ui/components/ProviderPicker";
import { CustomProviderDialog } from "@openbot/ui/features/custom-providers/CustomProviderDialog";
import { CustomProviderListDialog } from "@openbot/ui/features/custom-providers/CustomProviderListDialog";
import { DetectedProviders } from "@openbot/ui/features/custom-providers/DetectedProviders";
import type { DetectedProviderApi, ProviderDetection } from "@openbot/ui/features/custom-providers/detected-providers";
import { OpenCodeKeyDialog, type ProviderKeyApi } from "@openbot/ui/features/settings/OpenCodeKeyDialog";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";
import type { ProviderCodeLoginApi } from "../../components/provider-code-login-api";
import { createCustomProviderHostState } from "../custom-providers/custom-provider-host-state";
import { FREE_PROVIDER, onboardingProviderRows } from "./onboarding-provider-rows";
import { fallbackProviderState } from "./onboarding-provider-state";

/** The providers of this computer, and the actions on them, as both setup screens take them. */
export interface SetupProviderProps {
  agentStatus: AgentStatus;
  refreshingProviders?: boolean | undefined;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;
  /** The newer runtime main offers per provider; the row's actions menu offers it as in Settings. */
  providerAvailableVersions?: Partial<Record<AgentProviderId, string | null>> | undefined;
  onUpdateProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onConnectProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onInstallProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onSignInProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /**
   * Saves the optional OpenCode Go key. OpenCode runs free models without it, so its Connect row
   * button opens the key dialog rather than gating the step.
   */
  providerKeys?: ProviderKeyApi | undefined;
  /**
   * The sign-in finished on another device. First run is where it is needed most: the browser this
   * computer opens is the part of the hand-off that is most likely to be missing or wrong here.
   */
  codeLogin?: ProviderCodeLoginApi | undefined;
  onRefreshProviders?: (() => void | Promise<void>) | undefined;
  /** Accepts a described endpoint. Without it the step offers no custom provider at all. */
  onAddCustomProvider?: ((value: SaveCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  onDeleteCustomProvider?: ((id: string) => Promise<CustomProviderRestart>) | undefined;
  /**
   * The endpoints already saved. They share one Custom provider row, which counts them and becomes a
   * choice beside the built-in providers, and a duplicate ID is a field error before the round trip.
   */
  customProviders?: readonly CustomProviderSummary[] | undefined;
  /**
   * Local model servers and ACP agents that the host found. Without it, or when a scan finds
   * nothing, the step shows no such list. Setup does not scan again, so there is no scan control.
   */
  providerDetection?: ProviderDetection | undefined;
  /** Saves, hides and checks what the scan found. Without it the step shows no such list. */
  detectedProviderApi?: DetectedProviderApi | undefined;
  /** Saved custom agent IDs, so a found agent's ID is checked before the round trip. */
  takenAgentIds?: readonly string[] | undefined;
}

/** The choice a screen opens with. A review opens with the saved one; the first run with none. */
export interface SetupProviderChoice {
  provider: AgentProviderId | null;
  /**
   * Set when the saved model is one of a custom endpoint, so the custom row holds the check. The
   * endpoint list loads after the screen opens, so the value can arrive late.
   */
  customModel: () => AgentModelId | null;
}

// A custom agent is not a first provider: it is added from the detected list or in Settings.
const SETUP_PROVIDERS: Array<{ id: AgentProviderId; name: string; description: string }> =
  AGENT_PROVIDER_DESCRIPTORS.filter((descriptor) => descriptor.id !== "acp").map((descriptor) => ({
    id: descriptor.id,
    name: descriptor.displayName,
    description: descriptor.onboardingDescription,
  }));

/**
 * The provider registry carries its onboarding line in English. A line that has no key here, such
 * as one a newer registry adds, shows as it is.
 */
const PROVIDER_DESCRIPTION_KEYS: Readonly<Record<string, AppTextKey>> = {
  "Included with OpenBot": "onboarding.provider.included",
  "Free models, no account needed": "onboarding.provider.freeModels",
  "Google AI Pro or Ultra plan": "onboarding.provider.googlePlan",
  "Cursor plan or API key": "onboarding.provider.cursorPlan",
};

/**
 * Whether setup can continue with this provider. A signed-in provider can; so can a downloaded
 * provider that runs free models, because it has no sign-in to wait for.
 */
function providerReady(option: ProviderPickerOption): boolean {
  return option.state === "available" || freeModelsReady(option);
}

/** The saved model when it names a custom endpoint, which OpenCode calls `<endpoint id>/<model id>`. */
export function savedCustomModel(
  provider: AgentProviderId | null,
  model: AgentModelId | null,
  customProviders: readonly CustomProviderSummary[] | undefined,
): AgentModelId | null {
  if (provider !== FREE_PROVIDER || !model) return null;
  return (customProviders ?? []).some((endpoint) => model.startsWith(`${endpoint.id}/`)) ? model : null;
}

export type SetupProviders = ReturnType<typeof createSetupProviders>;

/**
 * The provider step of setup: its rows, its choice, the actions on a row, and the errors those
 * actions leave. The first-run flow and the setup dialog both hold one, so a provider is chosen,
 * connected and added the same way on each.
 */
export function createSetupProviders(props: SetupProviderProps, initial?: SetupProviderChoice) {
  const { t } = useText();
  const [selectedProvider, setSelectedProvider] = createSignal<AgentProviderId | null>(initial?.provider ?? null);
  /**
   * Whether the user chose their own endpoints rather than a built-in provider. `selectedProvider`
   * stays `opencode` beside it, because that is the provider setup records: which endpoint an agent
   * uses is a model choice, which comes later than this step.
   */
  const [customSelected, setCustomSelected] = createSignal(Boolean(untrack(() => initial?.customModel())));
  /**
   * The model a new agent starts on while the custom row holds the choice. Only an endpoint saved
   * here names one: the user listed its models in the dialog a moment ago, and nothing else on this
   * screen chooses a model. Without one the provider falls back to the first model it lists.
   */
  const [customModel, setCustomModel] = createSignal<AgentModelId | null>(
    untrack(() => initial?.customModel()) ?? null,
  );
  // A saved choice is the user's own, so the automatic choice below does not replace it.
  const [providerSelectedByUser, setProviderSelectedByUser] = createSignal(Boolean(initial?.provider));
  /** The user chose a row on this screen, so a late saved choice does not replace it. */
  let choiceChanged = false;
  const [openCodeKeyOpen, setOpenCodeKeyOpen] = createSignal(false);
  const [error, setError] = createSignal("");
  const [providerErrors, setProviderErrors] = createSignal<Partial<Record<AgentProviderId, string>>>({});
  const visibleError = createMemo(
    () => error() || SETUP_PROVIDERS.map((provider) => providerErrors()[provider.id]).find(Boolean) || "",
  );
  const previousConnectionStates = new Map<AgentProviderId, boolean>();
  const connectionStartingMessages = new Map<AgentProviderId, string | null>();
  const refreshedConnectionStates = new Set<AgentProviderId>();
  const providersAwaitingFocusRefresh = new Set<AgentProviderId>();
  let blurredAfterProviderConnect = false;
  let focusRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  const providerOptions = createMemo<ProviderPickerOption[]>(() =>
    SETUP_PROVIDERS.map((provider) => {
      const status = props.agentStatus.providers?.find((candidate) => candidate.id === provider.id);
      const runtime = props.providerRuntimeStatuses?.[provider.id];
      const descriptionKey = PROVIDER_DESCRIPTION_KEYS[provider.description];
      return {
        ...provider,
        description: descriptionKey ? t(descriptionKey) : provider.description,
        state: status?.state ?? fallbackProviderState(props.agentStatus),
        message: status?.message,
        email: status?.email,
        connectionState: status?.connectionState,
        checkError: status?.checkError,
        availableVersion: props.providerAvailableVersions?.[provider.id] ?? null,
        freeModels: provider.id === "opencode",
        // For a user with no account anywhere, this row is the way forward, and among four rows it
        // reads like any other; the note points it out.
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
  /**
   * The plan rows that stay in the list, in their order, or `null` until the user first acts on the
   * list. Until then the row rule can change the list when the provider status arrives. After that,
   * a row never moves or goes away under the pointer.
   */
  const [keptProviders, setKeptProviders] = createSignal<AgentProviderId[] | null>(null);
  /** The user chose the custom provider in "More providers", so it is a row from now on. */
  const [customRevealed, setCustomRevealed] = createSignal(false);
  const providerRows = createMemo(() => {
    const kept = keptProviders();
    const rows = onboardingProviderRows(providerOptions(), kept ?? []);
    // A saved choice that the row rule hides still shows, after the rows the rule gives.
    const saved = initial?.provider;
    if (kept || !saved || rows.listed.some((option) => option.id === saved)) return rows;
    return onboardingProviderRows(providerOptions(), [...planRowIds(rows.listed), saved]);
  });
  const customInMore = () =>
    Boolean(props.onAddCustomProvider) && (props.customProviders ?? []).length === 0 && !customRevealed();

  /** Keeps the rows that the user sees now, and adds `provider` after them if it is not a row. */
  function keepProviderRows(provider?: AgentProviderId): void {
    const kept = keptProviders() ?? planRowIds(providerRows().listed);
    const next = provider && provider !== FREE_PROVIDER && !kept.includes(provider) ? [...kept, provider] : kept;
    if (next !== keptProviders()) setKeptProviders(next);
  }

  /** Chooses a row, or a provider in "More providers", which then becomes a row. */
  function chooseProvider(provider: AgentProviderId): void {
    keepProviderRows(provider);
    choiceChanged = true;
    setProviderSelectedByUser(true);
    setSelectedProvider(provider);
    setCustomSelected(false);
  }

  /** OpenCode runs the custom endpoints, so the form opens only when OpenCode can run one. */
  function chooseMoreCustom(): void {
    keepProviderRows();
    setCustomRevealed(true);
    const openCode = providerOptions().find((option) => option.id === FREE_PROVIDER);
    if (openCode?.state === "available" || openCode?.state === "sign-in-required") host.openForm();
  }

  /**
   * The dialogs that add and remove an endpoint. The state is shared with Settings, which carries the
   * same removal sentence and the same busy row; what happens after a save or a removal is this
   * step's own, because only this step starts an agent on the model it just learned about.
   */
  const host = createCustomProviderHostState({
    onAdd: (value) => props.onAddCustomProvider?.(value),
    onDelete: (id) => props.onDeleteCustomProvider?.(id),
    onSaved: selectSavedEndpoint,
    onRemoved: (id) => {
      // The save reads these two to decide whether to send a model, so a model of an endpoint that
      // is gone would be stored on the first agent. The remaining endpoints keep the row selected.
      if (customModel()?.startsWith(`${id}/`)) setCustomModel(null);
      // The row stays where the user saw it, and does not go back into "More providers".
      setCustomRevealed(true);
      if ((props.customProviders ?? []).length === 0) setCustomSelected(false);
    },
  });

  /**
   * A model of an endpoint saved before this screen opened.
   *
   * Without it the custom choice would reach setup with no model, and a new agent would start on the
   * first model the catalog lists - a hosted one, because free models come first. The endpoint the
   * user selected would then be unused, which is the opposite of what the row says. OpenCode names a
   * custom model `<endpoint id>/<model id>`, so the id is composed rather than looked up in a list
   * the CLI has not published yet.
   */
  function firstSavedCustomModel(): AgentModelId | null {
    for (const provider of props.customProviders ?? []) {
      const [model] = provider.models;
      if (model) return `${provider.id}/${model.id}`;
    }
    return null;
  }

  /**
   * The endpoint the user just described is what they came here to use, so the step selects the
   * custom row rather than leaving the choice on whichever provider connected first, and its first
   * model becomes the one a new agent starts on. OpenCode names a custom model by its endpoint, so
   * the id is composed here rather than looked up in a catalog it has yet to list.
   */
  function selectSavedEndpoint(value: SaveCustomProviderInput): void {
    selectCustomProvider();
    const [firstModel] = value.models;
    if (firstModel) setCustomModel(`${value.id}/${firstModel.id}`);
  }

  /** A found server that the user saves is selected like one added with the form. */
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

  /** OpenCode runs every custom endpoint, so choosing them chooses that provider along with them. */
  function selectCustomProvider(): void {
    keepProviderRows();
    choiceChanged = true;
    setProviderSelectedByUser(true);
    setSelectedProvider("opencode");
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
    return Boolean(
      selected && providerOptions().some((provider) => provider.id === selected && providerReady(provider)),
    );
  });

  createEffect(
    () => ({
      options: providerOptions(),
      selected: selectedProvider(),
      selectedByUser: providerSelectedByUser(),
    }),
    ({ options, selected, selectedByUser }) => {
      if (selectedByUser && selected && options.some((provider) => provider.id === selected)) return;
      if (selected && options.some((provider) => provider.id === selected && providerReady(provider))) return;
      // A signed-in provider comes first, then one whose CLI is on the computer. Free models are the
      // way in when the user has neither.
      const ready =
        options.find((provider) => provider.state === "available") ??
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
    } catch {
      setError(
        kind === "install"
          ? t("onboarding.error.installGuide", { provider: providerName(provider) })
          : t("onboarding.error.signInGuide", { provider: providerName(provider) }),
      );
    }
  }

  /** OpenCode signs in with a pasted key, so its row opens the key dialog; the rest open a guide. */
  function signInProvider(provider: AgentProviderId): void {
    if (provider === "opencode" && props.providerKeys) {
      setOpenCodeKeyOpen(true);
      return;
    }
    void openProviderGuide(provider, props.onSignInProvider, "sign-in");
  }

  async function connectProvider(provider: AgentProviderId): Promise<void> {
    if (!props.onConnectProvider || props.refreshingProviders) return;
    keepProviderRows();
    setError("");
    setProviderErrors((current) => ({ ...current, [provider]: undefined }));
    providersAwaitingFocusRefresh.add(provider);
    refreshedConnectionStates.delete(provider);
    connectionStartingMessages.set(
      provider,
      props.agentStatus.providers?.find((candidate) => candidate.id === provider)?.message ?? null,
    );
    try {
      await props.onConnectProvider(provider);
    } catch {
      providersAwaitingFocusRefresh.delete(provider);
      setError(t("onboarding.error.connect", { provider: providerName(provider) }));
    }
  }

  async function downloadProvider(provider: AgentProviderId): Promise<void> {
    if (!props.onDownloadProvider) return;
    keepProviderRows();
    setError("");
    setProviderSelectedByUser(true);
    setSelectedProvider(provider);
    try {
      await props.onDownloadProvider(provider);
    } catch {
      setError(t("onboarding.error.download", { provider: providerName(provider) }));
    }
  }

  async function cancelProviderDownload(provider: AgentProviderId): Promise<void> {
    if (!props.onCancelProviderDownload) return;
    setError("");
    try {
      await props.onCancelProviderDownload(provider);
    } catch {
      setError(t("onboarding.error.cancelDownload", { provider: providerName(provider) }));
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
    } catch {
      setError(t("onboarding.error.refresh"));
    }
  }

  return {
    props,
    options: providerOptions,
    rows: providerRows,
    customInMore,
    selectedProvider,
    customSelected,
    /** The model to save with the custom row: the one described here, else one saved before. */
    customModel: () => customModel() ?? firstSavedCustomModel(),
    detectedApi,
    selectedProviderConnected,
    /** A provider action's error, or the message of a connection that ended without success. */
    error: visibleError,
    setError,
    clearErrors: () => {
      setError("");
      setProviderErrors({});
    },
    openCodeKeyOpen,
    closeOpenCodeKey: () => setOpenCodeKeyOpen(false),
    host,
    chooseProvider,
    chooseMoreCustom,
    selectCustomProvider,
    signInProvider,
    connectProvider,
    downloadProvider,
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
  /** Where the row menus mount. A screen on the dialog layer passes itself, or they paint behind it. */
  menuMount: HTMLElement | undefined;
}

/** The provider list of setup, with the dialogs its rows open. */
export function SetupProviderPicker(props: SetupProviderPickerProps) {
  const { t } = useText();
  const source = () => props.providers.props;
  const lazyProviderMode = () => Boolean(source().providerRuntimeStatuses || source().onDownloadProvider);
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
        onConnectProvider={source().onConnectProvider ? props.providers.connectProvider : undefined}
        onDownloadProvider={source().onDownloadProvider ? props.providers.downloadProvider : undefined}
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
        onSignInWithCodeProvider={source().codeLogin?.start}
        codeSignInProviders={source().codeLogin?.providers()}
        onUpdateProvider={source().onUpdateProvider}
        menuMount={props.menuMount}
        onRefreshProviders={
          !lazyProviderMode() && source().onRefreshProviders ? props.providers.refreshProviders : undefined
        }
        onAddCustomProvider={source().onAddCustomProvider ? props.providers.host.openForm : undefined}
        customProviders={source().customProviders}
        customSelected={props.providers.customSelected()}
        onSelectCustomProvider={source().onAddCustomProvider ? props.providers.selectCustomProvider : undefined}
        onManageCustomProviders={source().onAddCustomProvider ? props.providers.host.openList : undefined}
        moreProviders={props.providers.rows().hidden}
        customInMore={props.providers.customInMore()}
        moreCallout={{
          title: t("onboarding.provider.moreTitle"),
          detail: t("onboarding.provider.moreDetail"),
        }}
        onChooseMoreProvider={props.providers.chooseProvider}
        onChooseMoreCustom={props.providers.chooseMoreCustom}
        detected={
          // In setup a scan that found nothing is noise, so the list goes away. Hidden rows keep it:
          // Show hidden is the only way back to them in this step.
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
      <Show when={props.providers.openCodeKeyOpen() && source().providerKeys}>
        {(api) => (
          <OpenCodeKeyDialog
            api={api()}
            onClose={props.providers.closeOpenCodeKey}
            onReconnect={source().onConnectProvider ? () => props.providers.connectProvider("opencode") : undefined}
          />
        )}
      </Show>
      {/* Sits beside the picker it was started from, so the code covers the row rather
          than a step the user has not reached. */}
      <Show when={source().codeLogin?.provider() ? source().codeLogin : undefined}>
        {(api) => (
          <ProviderCodeLoginDialog
            open={true}
            providerName={SETUP_PROVIDERS.find((candidate) => candidate.id === api().provider())?.name ?? ""}
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
