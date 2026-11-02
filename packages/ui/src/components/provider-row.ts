import { agentProviderDescriptor, isKeyOnlyProvider } from "@openbot/contracts/agent-providers";
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
import type { ProviderAccountActions } from "./provider-accounts";

/** The callbacks a provider row runs. The onboarding picker and the Providers settings page pass their own. */
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

/**
 * What one provider row shows and offers, worked out from its option and its host's callbacks. The
 * onboarding picker and the Providers settings page both read it, so they offer the same actions.
 */
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
  /** A runtime still being downloaded has no CLI to sign in with yet. */
  const runtimeReady = () => (runtimeStatus()?.phase ?? "ready") === "ready";
  /** Connect opens this computer's browser, and the row follows that sign-in. */
  const browserConnect = () => connectKind() === "browser";
  /** A key-only provider's Connect opens the key dialog, on this computer and on a server. */
  const keyConnect = () => isKeyOnlyProvider(option().id) && Boolean(host.onSignInProvider);
  /**
   * Connect opens a dialog that the user finishes there, or on another device.
   *
   * Offered while connected as well: that is how the user reaches a second account, which is
   * otherwise only possible by signing out first and hoping the new sign-in works.
   */
  const dialogConnect = () => connectKind() === "dialog" && runtimeReady();
  /** The second way in that the ⋯ menu offers, when it differs from Connect. */
  const alternative = (): ProviderAlternativeSignIn | null =>
    runtimeReady() ? (host.connection?.alternativeKind(option().id) ?? null) : null;
  /**
   * A downloaded row that runs free models needs no sign-in, so its Connect is an option rather
   * than the step the row waits for: it stays outlined, and it opens the key dialog when the caller
   * has one. The caller starts the provider when it is chosen.
   */
  const connectOptional = () =>
    freeModelsReady(option()) && providerRuntimeAction(state(), connecting(), runtimeStatus()) === "connect";
  const runtimeAction = () => {
    if (updatable() && host.onUpdateProvider && runtimeStatus()?.phase === "not-downloaded") return;
    const action = providerRuntimeAction(state(), connecting(), runtimeStatus());
    // A dialog sign-in, such as a host's, cannot restart the provider: show only the Connect or
    // Reconnect that it, or the key dialog, can answer.
    if (action !== "connect" && action !== "reconnect" && action !== "restart") return action;
    if (browserConnect()) return action;
    if (action !== "restart" && dialogConnect()) return action;
    return option().id === "opencode" && (action === "reconnect" || connectOptional()) && host.onSignInProvider
      ? action
      : undefined;
  };
  /**
   * The browser sign-in is slow or failed. Only a row whose Connect is that browser hand-off offers
   * the code here; a host's Connect is already its most direct way in.
   */
  const codeFallback = createCodeSignInFallback(connecting);
  const codeFallbackOffered = () =>
    browserConnect() && alternative() === "code" && !off() && state() !== "available" && codeFallback.offered();
  const signInAlternative = () => {
    codeFallback.startedWithCode();
    host.connection?.alternative(option().id);
  };
  /** A Connect that failed before the sign-in started. The status reports the rest. */
  const [connectError, setConnectError] = createSignal<string | null>(null);
  const connect = () => {
    // A key-only provider, such as Inception, has no sign-in other than its key, so its Connect and
    // Reconnect open the key dialog, where the key is also replaced or removed.
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
  /** Runs the row's runtime action: a download, its cancel or retry, or a Connect, Reconnect or Restart. */
  const runAction = (action: ProviderAction) => {
    if (action === "cancel") {
      void host.onCancelProviderDownload?.(option().id);
    } else if (action !== "download" && action !== "retry") {
      // Reconnect and an optional Connect open the key dialog; the rest stay on the connection.
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
  /**
   * A sign-in that Connect started and that waits for the browser. A download or an update also
   * marks the row connecting, until its new runtime is ready, and so does a check again after a key
   * change or a restart, which `signInPending` marks false.
   */
  const signingIn = () => connecting() && option().signInPending !== false && browserConnect() && runtimeReady();
  const hostSignInHint = () =>
    !off() &&
    option().id === "antigravity" &&
    runtimeStatus()?.phase === "ready" &&
    !available() &&
    !connecting() &&
    connectKind() === null;
  /**
   * Why the row cannot be used, as text: a hover title is easy to miss. A row that is not downloaded
   * says so with its Download button.
   */
  const statusMessage = () => {
    if (off() || connecting() || hostSignInHint()) return undefined;
    const runtime = runtimeStatus();
    if (runtime?.phase === "download-error") return runtime.message ?? undefined;
    // An update that waits for the provider's turns to end says so.
    if (runtime?.phase === "downloading" && runtime.message) return runtime.message;
    const message = option().message;
    if (!message || state() === "not-installed") return undefined;
    return message === option().checkError || message === option().lastError ? undefined : message;
  };
  /**
   * Every row with a runtime on the computer offers Update in the same place. While a newer version
   * waits, the badge says so and the action names the version it installs; otherwise the same
   * action checks for one.
   */
  // A provider that is off gets no update offer from main, so a check there could only say "up to date".
  const updateOffered = () =>
    Boolean(host.onUpdateProvider) && !off() && (runtimeStatus()?.phase === "ready" || updatable());
  const restartOffered = () =>
    Boolean(host.onRestartProvider) && (option().restartPending || (available() && !connecting()));
  const diagnosticsOffered = () => Boolean(option().lastError && option().diagnostics);
  /** Another account is offered on a connected row of a provider that can hold one. */
  const accountsOffered = () =>
    Boolean(host.accountActions && option().accounts) && available() && !off() && !connecting();
  const [accountError, setAccountError] = createSignal<string | null>(null);
  const addAccount = () => {
    setAccountError(null);
    void Promise.resolve(host.accountActions?.connect(option().id, null)).catch((error: unknown) =>
      setAccountError(errorMessage(error, t("provider.account.actionFailed", { name: option().name }))),
    );
  };
  const installOffered = () =>
    !runtimeStatus() &&
    agentProviderDescriptor(option().id).installGuideLink !== null &&
    state() === "not-installed" &&
    !browserConnect() &&
    Boolean(host.onInstallProvider);
  /**
   * Claude's sign-in is a browser round trip it only needs while signed out. The key providers
   * (OpenCode, Muse, Gemini) reconnect through their runtime Reconnect, so Sign in stays only where
   * the row cannot offer it: with no runtime action at all, or a Connect or Restart that retries the
   * same credentials. A saved key that blocks startup must stay replaceable and removable, so those
   * actions never take the dialog away.
   */
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
  /**
   * Gemini's Connect and Reconnect are the Google sign-in, and a saved key wins over it, so the key
   * stays reachable in every state, Connected included: a refused key must stay replaceable and
   * removable. A released host stores a Gemini key but never reads it, so only this computer offers it.
   * Claude's key works the same way. Its row has a key status only where the host reads the key.
   * Codex's key is a login on this computer, so its row has a key status only here.
   */
  const apiKeyOffered = () =>
    Boolean(host.onSignInProvider) &&
    ((option().id === "antigravity" && browserConnect() && runtimeStatus()?.phase === "ready") ||
      ((option().id === "claude" || option().id === "codex") &&
        option().keyStatus !== undefined &&
        runtimeReady() &&
        state() !== "not-installed"));
  /** OpenCode runs free models while no key is saved. */
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
    installOffered,
    signInOffered,
    apiKeyOffered,
    freeKey,
  };
}

export type ProviderRow = ReturnType<typeof createProviderRow>;

/** OpenCode runs user endpoints when its CLI is installed and answers; sign-in is irrelevant. */
export function servesCustomProvider(openCode: ProviderPickerOption | undefined): boolean {
  return openCode?.state === "available" || openCode?.state === "sign-in-required";
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

/** Badge text, translated where drawn; downloads report a percentage, not a key. */
export function providerStatusLabel(
  translate: AppTranslate,
  format: AppFormat,
  state: AgentProviderState,
  connecting = false,
  runtimeStatus?: ProviderRuntimeStatus,
  updatable = false,
): string {
  // Downloads outrank connection words; the row reports progress until it ends. An update that waits
  // for the provider's turns to end has a message and no progress yet.
  if (runtimeStatus?.phase === "downloading" && runtimeStatus.message)
    return translate("provider.status.updateWaiting");
  if (runtimeStatus?.phase === "downloading") {
    return format.percent(Math.round(Math.max(0, Math.min(100, runtimeStatus.progress ?? 0))) / 100);
  }
  if (runtimeStatus?.phase === "finishing") return translate("provider.status.settingUp");
  if (connecting && state !== "available") return translate("provider.status.connecting");
  // Update offers outrank "Connected"/"Ready": a hidden offer is never taken.
  if (updatable) return translate("provider.status.updateAvailable");
  // The failure can come after the download: a new CLI that does not start also ends here. A failed
  // update keeps the installed version, so the version tells an update from a first setup.
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

/**
 * Says why the provider's switch stays on. One agent is named; more are counted, because a list of
 * names makes a long line. All providers share one id, so a new try replaces the old toast and the
 * newest text is always in front.
 */
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
  // Same order as the label above.
  if (phase === "downloading" || phase === "finishing") return phase;
  if (connecting && state !== "available") return "connecting";
  if (updatable) return "update-available";
  if (phase === "download-error") return phase;
  if (state === "available") return "available";
  if (phase === "not-downloaded") return phase;
  if (state === "sign-in-required" || state === "outdated" || state === "error") return state;
  return phase ?? state;
}

/** Row action identifier; never a translated label, since the handler branches on it. */
export type ProviderAction = "download" | "cancel" | "connect" | "reconnect" | "restart" | "retry";

export const PROVIDER_ACTION_TEXT = {
  download: "common.download",
  cancel: "common.cancel",
  connect: "provider.action.connect",
  reconnect: "provider.action.reconnect",
  restart: "provider.action.restart",
  retry: "common.retry",
} as const satisfies Record<ProviderAction, AppTextKey>;

/** The name a screen reader reads. It repeats the provider, because a list of rows that all say
 * "Connect" names nothing. */
export const PROVIDER_ACTION_LABEL = {
  download: "provider.aria.download",
  cancel: "provider.aria.cancel",
  connect: "provider.aria.connect",
  reconnect: "provider.aria.reconnect",
  restart: "provider.aria.restart",
  retry: "provider.aria.retry",
} as const satisfies Record<ProviderAction, keyof AppMessages>;

/**
 * Whether a free-models row can be used without Connect: its runtime is on disk and nothing reports
 * it broken. The provider state can still say signed out or unchecked, because free models need no
 * sign-in and the first connection only asks the CLI for its models. An error or an outdated CLI
 * keeps Connect, which is how the user retries.
 */
export function freeModelsReady(option: ProviderPickerOption): boolean {
  if (!option.freeModels || option.state === "error" || option.state === "outdated") return false;
  return option.runtimeStatus?.phase === "ready";
}

/**
 * Whether the action reaches main's managed runtime store rather than a provider CLI.
 *
 * A download, its cancellation and its retry are file transfers the runtime manager owns; it neither
 * asks the agent runtime for anything nor waits for it. The rest put a question to a CLI, so they
 * wait while the providers are being checked. Keeping the two apart is what stops a provider check
 * that never ends from disabling the one action that would end it: with nothing downloaded, every
 * other button on the first-run screen is refused by design, and disabling Download as well leaves
 * the user with no way forward at all.
 */
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
