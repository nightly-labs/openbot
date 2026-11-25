import { agentProviderDescriptor, isInstallerProvider, isKeyOnlyProvider } from "@openbot/contracts/agent-providers";
import type {
  AgentProviderId,
  AgentProviderState,
  ProviderRuntimePhase,
  ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import type { AppFormat, AppMessages, AppTextKey, AppTranslate } from "@openbot/i18n";
import { createSignal } from "solid-js";
import { providerUpdateAvailable, providerVersionLabel } from "../features/provider-updates/provider-update";
import { useText } from "../text";
import { toast } from "../toast";
import { createCodeSignInFallback } from "./createCodeSignInFallback";
import type { ProviderAlternativeSignIn, ProviderConnection, ProviderPickerOption } from "./ProviderPicker";
import { accountCodeSignInOffered, type ProviderAccountActions } from "./provider-accounts";

export interface ProviderRowHost {
  readonly connection?: ProviderConnection | undefined;
  readonly accountActions?: ProviderAccountActions | undefined;
  readonly onCancelProviderSignIn?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  readonly onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  readonly onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  readonly onUpdateProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  readonly onRestartProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  readonly onInstallProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  readonly onSignInProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
}

export function createProviderRow(option: () => ProviderPickerOption, host: ProviderRowHost) {
  const { t, errorMessage } = useText();
  const state = () => option().state;
  const runtimeStatus = () => option().runtimeStatus;
  const connecting = () => option().connectionState === "connecting";
  const available = () => state() === "available";
  const off = () => Boolean(option().off);
  const updatable = () => {
    const runtime = runtimeStatus();
    return runtime ? providerUpdateAvailable(runtime, option().availableVersion ?? null) : false;
  };
  const version = () => {
    const runtime = runtimeStatus();
    return runtime ? providerVersionLabel(runtime, { t }) : null;
  };
  const visualState = () => providerVisualState(state(), connecting(), runtimeStatus(), updatable());
  const connectKind = () => host.connection?.connectKind(option().id) ?? null;
  const runtimeReady = () => (runtimeStatus()?.phase ?? "ready") === "ready";
  const browserConnect = () => connectKind() === "browser";
  const keyConnect = () => isKeyOnlyProvider(option().id) && Boolean(host.onSignInProvider);
  const dialogConnect = () => connectKind() === "dialog" && runtimeReady();
  const alternative = (): ProviderAlternativeSignIn | null =>
    runtimeReady() ? (host.connection?.alternativeKind(option().id) ?? null) : null;
  const connectOptional = () =>
    freeModelsReady(option()) && providerRuntimeAction(state(), connecting(), runtimeStatus()) === "connect";
  const runtimeAction = () => {
    if (updatable() && host.onUpdateProvider && runtimeStatus()?.phase === "not-downloaded") return;
    const action = providerRuntimeAction(state(), connecting(), runtimeStatus());
    if (action !== "connect" && action !== "reconnect" && action !== "restart") return action;
    if (browserConnect()) return action;
    if (action !== "restart" && dialogConnect()) return action;
    return option().id === "opencode" && (action === "reconnect" || connectOptional()) && host.onSignInProvider
      ? action
      : undefined;
  };
  const codeFallback = createCodeSignInFallback(connecting);
  const codeFallbackOffered = () =>
    browserConnect() && alternative() !== null && !off() && state() !== "available" && codeFallback.offered();
  const signInAlternative = () => {
    codeFallback.startedWithCode();
    host.connection?.alternative(option().id);
  };
  const mainlandChinaSite = (): string | null =>
    browserConnect() && !off() && state() !== "available"
      ? (host.connection?.mainlandChinaSite?.(option().id) ?? null)
      : null;
  const [connectError, setConnectError] = createSignal<string | null>(null);
  const connect = () => {
    if (isKeyOnlyProvider(option().id) && host.onSignInProvider) {
      void host.onSignInProvider(option().id);
      return;
    }
    if (browserConnect()) codeFallback.startedInBrowser();
    else codeFallback.startedWithCode();
    setConnectError(null);
    void Promise.resolve(host.connection?.connect(option().id)).catch((error: unknown) =>
      setConnectError(errorMessage(error, t("app.provider.connectFailedRetry", { name: option().name }))),
    );
  };
  const connectInMainlandChina = () => {
    codeFallback.startedInBrowser();
    setConnectError(null);
    void Promise.resolve(host.connection?.connectInMainlandChina?.(option().id)).catch((error: unknown) =>
      setConnectError(errorMessage(error, t("app.provider.connectFailedRetry", { name: option().name }))),
    );
  };
  const runAction = (action: ProviderAction) => {
    if (action === "cancel") {
      void host.onCancelProviderDownload?.(option().id);
    } else if (action !== "download" && action !== "retry") {
      if (option().id === "opencode" && (action === "reconnect" || connectOptional()) && host.onSignInProvider) {
        void host.onSignInProvider(option().id);
      } else {
        connect();
      }
    } else {
      void host.onDownloadProvider?.(option().id);
    }
  };
  const cancelSignIn = () => {
    setConnectError(null);
    void Promise.resolve(host.onCancelProviderSignIn?.(option().id)).catch((error: unknown) =>
      setConnectError(errorMessage(error, t("provider.connecting.cancelFailed", { name: option().name }))),
    );
  };
  const signingIn = () => connecting() && option().signInPending !== false && browserConnect() && runtimeReady();
  const hostSignInHint = () =>
    !off() &&
    option().id === "antigravity" &&
    runtimeStatus()?.phase === "ready" &&
    !available() &&
    !connecting() &&
    connectKind() === null;
  const statusMessage = () => {
    if (off() || connecting() || hostSignInHint()) return undefined;
    const runtime = runtimeStatus();
    if (runtime?.phase === "download-error") return runtime.message ?? undefined;
    if (runtime?.phase === "downloading" && runtime.message) return runtime.message;
    const message = option().message;
    if (!message || state() === "not-installed") return undefined;
    return message === option().checkError || message === option().lastError ? undefined : message;
  };
  const updateOffered = () =>
    Boolean(host.onUpdateProvider) &&
    !off() &&
    !isInstallerProvider(option().id) &&
    (runtimeStatus()?.phase === "ready" || updatable());
  const restartOffered = () =>
    Boolean(host.onRestartProvider) && (option().restartPending || (available() && !connecting()));
  const diagnosticsOffered = () => Boolean(option().lastError && option().diagnostics);
  const accountsOffered = () =>
    Boolean(host.accountActions && option().accounts) && available() && !off() && !connecting();
  const [accountError, setAccountError] = createSignal<string | null>(null);
  const addAccount = () => {
    setAccountError(null);
    void Promise.resolve(host.accountActions?.connect(option().id, null)).catch((error: unknown) =>
      setAccountError(errorMessage(error, t("provider.account.actionFailed", { name: option().name }))),
    );
  };
  const accountCodeOffered = () => accountsOffered() && accountCodeSignInOffered(option().id, host.accountActions);
  const addAccountWithCode = () => {
    setAccountError(null);
    void Promise.resolve(host.accountActions?.connectWithCode?.(option().id, null)).catch((error: unknown) =>
      setAccountError(errorMessage(error, t("provider.account.actionFailed", { name: option().name }))),
    );
  };
  const installOffered = () =>
    !runtimeStatus() &&
    agentProviderDescriptor(option().id).installGuideLink !== null &&
    state() === "not-installed" &&
    !browserConnect() &&
    Boolean(host.onInstallProvider);
  const signInOffered = () =>
    Boolean(host.onSignInProvider) &&
    !connectOptional() &&
    (option().id === "opencode" || option().id === "muse"
      ? runtimeAction() === undefined || runtimeAction() === "connect" || runtimeAction() === "restart"
      : option().id === "claude" &&
        !runtimeStatus() &&
        state() === "sign-in-required" &&
        connectKind() === null &&
        !apiKeyOffered());
  const apiKeyOffered = () =>
    Boolean(host.onSignInProvider) &&
    ((option().id === "antigravity" && browserConnect() && runtimeStatus()?.phase === "ready") ||
      ((option().id === "claude" || option().id === "codex") &&
        option().keyStatus !== undefined &&
        runtimeReady() &&
        state() !== "not-installed"));
  const freeKey = () =>
    option().id === "opencode" && (option().keyStatus === "missing" || option().keyStatus === "unreadable");
  return {
    state,
    runtimeStatus,
    connecting,
    available,
    off,
    updatable,
    version,
    visualState,
    connectKind,
    runtimeReady,
    browserConnect,
    keyConnect,
    dialogConnect,
    alternative,
    connectOptional,
    runtimeAction,
    codeFallbackOffered,
    signInAlternative,
    mainlandChinaSite,
    connectInMainlandChina,
    connectError,
    connect,
    runAction,
    cancelSignIn,
    signingIn,
    hostSignInHint,
    statusMessage,
    updateOffered,
    restartOffered,
    diagnosticsOffered,
    accountsOffered,
    accountError,
    addAccount,
    accountCodeOffered,
    addAccountWithCode,
    installOffered,
    signInOffered,
    apiKeyOffered,
    freeKey,
  };
}

export type ProviderRow = ReturnType<typeof createProviderRow>;

export function servesCustomProvider(openCode: ProviderPickerOption | undefined): boolean {
  return openCode?.state === "available" || openCode?.state === "sign-in-required";
}

export function customEngineDownloadAction(
  openCode: ProviderPickerOption | undefined,
): "download" | "cancel" | "retry" | undefined {
  const phase = openCode?.runtimeStatus?.phase;
  if (phase === "not-downloaded") return "download";
  if (phase === "downloading") return "cancel";
  if (phase === "download-error") return "retry";
  return undefined;
}

export type ProviderVisualState = AgentProviderState | ProviderRuntimePhase | "connecting" | "update-available";

export function providerStatusVariant(
  state: ProviderVisualState,
): "success-light" | "warning-light" | "destructive-light" | "secondary" {
  if (state === "available") return "success-light";
  if (state === "ready") return "success-light";
  if (state === "error" || state === "download-error") return "destructive-light";
  if (state === "sign-in-required" || state === "outdated" || state === "finishing") return "warning-light";
  if (state === "update-available") return "warning-light";
  return "secondary";
}

export function providerStatusLabel(
  translate: AppTranslate,
  format: AppFormat,
  state: AgentProviderState,
  connecting = false,
  runtimeStatus?: ProviderRuntimeStatus,
  updatable = false,
): string {
  if (runtimeStatus?.phase === "downloading" && runtimeStatus.message)
    return translate("provider.status.updateWaiting");
  if (runtimeStatus?.phase === "downloading") {
    return format.percent(Math.round(Math.max(0, Math.min(100, runtimeStatus.progress ?? 0))) / 100);
  }
  if (runtimeStatus?.phase === "finishing") return translate("provider.status.settingUp");
  if (connecting && state !== "available") return translate("provider.status.connecting");
  if (updatable) return translate("provider.status.updateAvailable");
  if (runtimeStatus?.phase === "download-error")
    return translate(runtimeStatus.version ? "provider.status.updateFailed" : "provider.status.setupFailed");
  if (state === "available") return translate("provider.status.connected");
  if (runtimeStatus?.phase === "not-downloaded") return translate("provider.status.notDownloaded");
  if (state === "sign-in-required") return translate("provider.status.notConnected");
  if (state === "outdated") return translate("provider.status.updateRequired");
  if (state === "error") return translate("provider.status.unavailable");
  if (runtimeStatus?.phase === "ready") return translate("provider.status.ready");
  if (state === "not-installed") return translate("provider.status.notInstalled");
  return translate("provider.status.checking");
}

export function showProviderInUse(translate: AppTranslate, agents: readonly string[], name: string): void {
  const [agent, ...others] = agents;
  const text =
    agent !== undefined && others.length === 0
      ? translate("provider.use.inUseOne", { agent, name })
      : translate("provider.use.inUse", { count: agents.length, name });
  toast(text, { id: "provider-in-use" });
}

export function providerVisualState(
  state: AgentProviderState,
  connecting: boolean,
  runtimeStatus?: ProviderRuntimeStatus,
  updatable = false,
): ProviderVisualState {
  const phase = runtimeStatus?.phase;
  if (phase === "downloading" || phase === "finishing") return phase;
  if (connecting && state !== "available") return "connecting";
  if (updatable) return "update-available";
  if (phase === "download-error") return phase;
  if (state === "available") return "available";
  if (phase === "not-downloaded") return phase;
  if (state === "sign-in-required" || state === "outdated" || state === "error") return state;
  return phase ?? state;
}

export type ProviderAction = "download" | "cancel" | "connect" | "reconnect" | "restart" | "retry";

export const PROVIDER_ACTION_TEXT = {
  download: "common.download",
  cancel: "common.cancel",
  connect: "provider.action.connect",
  reconnect: "provider.action.reconnect",
  restart: "provider.action.restart",
  retry: "common.retry",
} as const satisfies Record<ProviderAction, AppTextKey>;

export const PROVIDER_ACTION_LABEL = {
  download: "provider.aria.download",
  cancel: "provider.aria.cancel",
  connect: "provider.aria.connect",
  reconnect: "provider.aria.reconnect",
  restart: "provider.aria.restart",
  retry: "provider.aria.retry",
} as const satisfies Record<ProviderAction, keyof AppMessages>;

export function freeModelsReady(option: ProviderPickerOption): boolean {
  if (!option.freeModels || option.state === "error" || option.state === "outdated") return false;
  return option.runtimeStatus?.phase === "ready";
}

export function runtimeStoreAction(action: ProviderAction): boolean {
  return action === "download" || action === "cancel" || action === "retry";
}

export function providerRuntimeAction(
  state: AgentProviderState,
  connecting: boolean,
  runtimeStatus?: ProviderRuntimeStatus,
): ProviderAction | undefined {
  if (!runtimeStatus) return;
  if (runtimeStatus.phase === "not-downloaded") return "download";
  if (runtimeStatus.phase === "downloading") return "cancel";
  if (runtimeStatus.phase === "ready") return providerAction(state, connecting);
  if (runtimeStatus.phase === "download-error") return "retry";
}

export function providerAction(state: AgentProviderState, connecting: boolean): ProviderAction {
  if (connecting) return "restart";
  return state === "available" ? "reconnect" : "connect";
}
