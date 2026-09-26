import { type AgentProviderId, type AgentStatus, agentProviderDescriptor } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import type { ProviderCodeLoginState } from "@openbot/ui/components/ProviderCodeLoginDialog";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, flush, onSettled } from "solid-js";
import { desktopAnalytics } from "./analytics";
import { appPort } from "./app-port";
import type { ProviderCodeLoginApi } from "./components/provider-code-login-api";
import { useAgents } from "./features/agents/agents-context";
import { hostCustomProvidersApi } from "./features/custom-providers/custom-providers-port";
import { createCustomProvidersStore } from "./features/custom-providers/stores/custom-providers-store";
import { createProviderRuntimeStore } from "./features/provider-updates/provider-runtime-store";
import { remoteProviderRuntimes } from "./features/provider-updates/remote-provider-runtimes";
import { remoteAdminServer } from "./features/servers/server-capabilities";
import { useServers } from "./features/servers/servers-context";
import { hostProviderKeyApi, providerKeyApi } from "./features/settings/provider-key-api";
import { providersPort } from "./providers-port";
import { createSimpleContext } from "./simple-context";

/**
 * Coding providers (Codex, Claude, Grok) as two paths the renderer reconciles: managed
 * `providerRuntimes` snapshots from main, and the older installed-CLI sign-in state via
 * `AgentStatus`. Consumers pick handlers through `providerRuntimeDownloadsAvailable()`.
 * Nested under `agents` so the edge stays one-way; see docs/ARCHITECTURE.md.
 */
const Providers = createSimpleContext({
  name: "Providers",
  init: () => {
    const { agentStatus, setAgentStatus } = useAgents();
    const { activeServer } = useServers();
    const [refreshingProviders, setRefreshingProviders] = createSignal(false);
    /**
     * A CLI the user installed themselves, and the version it reports. Only the agent status knows
     * this, and the runtime store needs it to offer that install the same update a managed runtime
     * gets. Updates install the managed copy without changing the system installation.
     */
    function systemCliVersion(provider: AgentProviderId): string | null {
      const row = agentStatus().providers?.find((candidate) => candidate.id === provider);
      return row?.cliSource === "system" ? (row.version ?? null) : null;
    }
    /**
     * The joined server whose host this window manages, when the account administers it and the host
     * serves `providers-v1`. A memo, not a value: the host's capabilities arrive after this mounts.
     */
    const providerAdminServerId = createMemo(() => remoteAdminServer(activeServer(), "providers-v1")?.id);
    const providerAdmin = () => providersPort().providerAdmin;
    const runtimes = createProviderRuntimeStore(
      createMemo(() => {
        const serverId = providerAdminServerId();
        return serverId ? remoteProviderRuntimes(providerAdmin, serverId) : providersPort().providerRuntimes;
      }),
      {
        systemCliVersion,
        isLocalServer: () => activeServer()?.kind === "local",
        managesRuntimes: () => activeServer()?.kind === "local" || providerAdminServerId() !== undefined,
      },
    );
    /** The provider keys of the computer the providers run on. */
    const providerKeys = createMemo(() => {
      const serverId = providerAdminServerId();
      return serverId ? hostProviderKeyApi(providerAdmin, serverId) : providerKeyApi;
    });
    /**
     * The host's own endpoints, for Settings. The machine-local list in `CustomProvidersProvider`
     * stays what the model picker reads.
     */
    const hostCustomProviders = createCustomProvidersStore(() => {
      const serverId = providerAdminServerId();
      return serverId ? hostCustomProvidersApi(providerAdmin, serverId) : undefined;
    });
    createEffect(providerAdminServerId, (serverId) => {
      // As for this computer's list: a failure leaves it empty, and nothing retries it from here.
      if (serverId) void hostCustomProviders.refreshCustomProviders().catch(() => undefined);
    });
    /** Connect attempts still waiting for the status that says how they ended. */
    const pendingProviderConnections = new Map<AgentProviderId, ReturnType<typeof desktopAnalytics.scope>>();
    /** The provider whose code dialog is open, and the phase that dialog shows. */
    const [codeLoginProvider, setCodeLoginProvider] = createSignal<AgentProviderId | null>(null);
    const [codeLoginState, setCodeLoginState] = createSignal<ProviderCodeLoginState>({ phase: "starting" });
    let codeLoginExpiry: number | undefined;
    /** Whether the provider has been seen working on the open code sign-in. */
    let codeLoginStarted = false;
    let codeLoginGeneration = 0;
    let codeLoginCancellation: Promise<void> = Promise.resolve();
    /** The joined server whose host runs the open code sign-in, or undefined for this computer. */
    let codeLoginServerId: string | undefined;

    /**
     * The status is the completion signal for every connect started here: main
     * answers `connect()` before the provider has finished coming up, so the
     * outcome arrives later, in a status this or an agent event applies.
     */
    function applyAgentStatus(status: AgentStatus): void {
      for (const provider of status.providers ?? []) {
        const analytics = pendingProviderConnections.get(provider.id);
        if (!analytics) continue;
        if (provider.state === "available") {
          pendingProviderConnections.delete(provider.id);
          analytics.track("provider_action", {
            provider: provider.id,
            action: "connect_completed",
            result: "succeeded",
          });
        } else if (provider.state === "error") {
          pendingProviderConnections.delete(provider.id);
          analytics.track("provider_action", {
            provider: provider.id,
            action: "connect_completed",
            result: "failed",
            failure_code: "connect_failed",
          });
        }
      }
      setAgentStatus(status);
    }

    function openProviderInstallGuide(provider: AgentProviderId): Promise<void> {
      const descriptor = agentProviderDescriptor(provider);
      if (descriptor.installGuideLink === null) {
        return Promise.reject(new Error(currentText().t("app.provider.included", { name: descriptor.displayName })));
      }
      return appPort().openExternal(descriptor.installGuideLink);
    }

    /**
     * Signs the user in to one provider, through that provider's own login: Codex opens a browser,
     * Claude and Grok run their CLI's OAuth command, and OpenCode is asked again. Every sign-in
     * entry point calls this - the composer notice, the model picker, onboarding and settings - so
     * none of them leaves the user to read a documentation page and sign in in a terminal.
     */
    async function connectProvider(provider: AgentProviderId): Promise<void> {
      if (refreshingProviders()) return;
      const analytics = beginProviderConnection(provider);
      try {
        const status = await providersPort().connectProvider(provider);
        flush(() => applyAgentStatus(status));
      } catch (error) {
        endFailedProviderConnection(provider, analytics);
        throw error;
      }
    }

    /** Opens a connect attempt: the status that ends it is matched back to this scope by provider. */
    function beginProviderConnection(provider: AgentProviderId) {
      const analytics = desktopAnalytics.scope();
      pendingProviderConnections.set(provider, analytics);
      analytics.track("provider_action", { provider, action: "connect_started", result: "succeeded" });
      return analytics;
    }

    function endFailedProviderConnection(
      provider: AgentProviderId,
      analytics: ReturnType<typeof desktopAnalytics.scope>,
    ): void {
      pendingProviderConnections.delete(provider);
      analytics.track("provider_action", {
        provider,
        action: "connect_completed",
        result: "failed",
        failure_code: "connect_failed",
      });
    }

    /**
     * The sign-in the user finishes on another device, for a provider whose descriptor offers one.
     *
     * Everything about how it ends arrives in the agent status, the same way a browser sign-in's
     * does, so this holds only what the status cannot say: which provider the open dialog belongs
     * to, and the code that provider issued. The code is a one-time handle and is meant to be read
     * out; nothing it is later traded for reaches the renderer.
     */
    async function startProviderCodeLogin(provider: AgentProviderId): Promise<void> {
      const generation = ++codeLoginGeneration;
      clearCodeLoginExpiry();
      codeLoginStarted = false;
      // The code is issued by the computer the providers run on; the admin types it in the browser of
      // this one.
      const serverId = providerAdminServerId();
      codeLoginServerId = serverId;
      setCodeLoginProvider(provider);
      setCodeLoginState({ phase: "starting" });
      const analytics = beginProviderConnection(provider);
      try {
        // Cancellation emits a terminal status. Finish it before the next attempt can wait.
        await codeLoginCancellation;
        if (generation !== codeLoginGeneration) return;
        const started = serverId
          ? await providerAdmin().startCodeLogin(provider, serverId)
          : await providersPort().startProviderCodeLogin(provider);
        // A dialog the user closed while the provider was answering: the login was cancelled with
        // it, so there is nobody left to show a code to.
        if (generation !== codeLoginGeneration) return;
        if (started.kind === "connected") {
          const row = agentStatus().providers?.find((candidate) => candidate.id === provider);
          endProviderCodeLogin(provider, { kind: "connected", accountLabel: row?.email ?? null });
          return;
        }
        flush(() =>
          setCodeLoginState({
            phase: "waiting",
            userCode: started.userCode,
            verificationUrl: started.verificationUrl,
            expiresAt: started.expiresAt,
          }),
        );
        // Main gives up on the same deadline and reports a failure, but the user is looking at a
        // countdown: when it reaches zero the screen has to say so without waiting for a round trip.
        codeLoginExpiry = window.setTimeout(
          () => {
            if (generation !== codeLoginGeneration) return;
            codeLoginExpiry = undefined;
            if (codeLoginState().phase === "waiting") endProviderCodeLogin(provider, { kind: "expired" });
          },
          Math.max(0, started.expiresAt - Date.now()),
        );
      } catch (error) {
        if (generation !== codeLoginGeneration) return;
        endFailedProviderConnection(provider, analytics);
        endProviderCodeLogin(provider, {
          kind: "failed",
          message:
            error instanceof Error && error.message
              ? error.message
              : `OpenBot could not connect ${agentProviderDescriptor(provider).displayName}. Try again.`,
        });
      }
    }

    /** Abandons the code sign-in and closes the dialog. The code stops working before this returns. */
    function cancelProviderCodeLogin(): void {
      const provider = codeLoginProvider();
      const generation = ++codeLoginGeneration;
      codeLoginStarted = false;
      clearCodeLoginExpiry();
      setCodeLoginProvider(null);
      if (!provider) return;
      pendingProviderConnections.delete(provider);
      const serverId = codeLoginServerId;
      codeLoginCancellation = (
        serverId
          ? providerAdmin().cancelCodeLogin(provider, serverId)
          : providersPort().cancelProviderCodeLogin(provider)
      )
        .then((status) => {
          if (generation === codeLoginGeneration) flush(() => applyAgentStatus(status));
        })
        // The provider has already stopped waiting for the code in every case that fails here: a
        // login that was never started, or one that ended on its own while the dialog was open.
        .catch(() => undefined);
    }

    /**
     * Closes the dialog on an ending and says how it went in a notification.
     *
     * Not a last screen in the dialog: the user finished this sign-in on another device, so they
     * come back to an app that should already be theirs to use, not to a modal to dismiss. The
     * notification carries the retry, because "the code expired" with no way to ask for another
     * one is a dead end.
     */
    function endProviderCodeLogin(
      provider: AgentProviderId,
      outcome:
        | { kind: "connected"; accountLabel: string | null }
        | { kind: "expired" }
        | { kind: "failed"; message: string },
    ): void {
      codeLoginGeneration++;
      clearCodeLoginExpiry();
      codeLoginStarted = false;
      flush(() => setCodeLoginProvider(null));
      const name = agentProviderDescriptor(provider).displayName;
      const { t, sourceText } = currentText();
      if (outcome.kind === "connected") {
        toast.success(t("app.provider.connected", { name }), {
          description: outcome.accountLabel
            ? t("app.provider.signedInAs", { account: outcome.accountLabel })
            : t("app.provider.signedInElsewhere"),
        });
        return;
      }
      const retry = { label: t("app.provider.newCode"), onClick: () => void startProviderCodeLogin(provider) };
      if (outcome.kind === "expired") {
        toast.warning(t("app.provider.codeExpired", { name }), {
          description: t("app.provider.codeExpiredDescription"),
          action: retry,
        });
        return;
      }
      toast.error(t("app.provider.connectFailed", { name }), {
        description: sourceText(outcome.message),
        action: { ...retry, label: t("common.tryAgain") },
      });
    }

    function clearCodeLoginExpiry(): void {
      if (codeLoginExpiry === undefined) return;
      window.clearTimeout(codeLoginExpiry);
      codeLoginExpiry = undefined;
    }

    /**
     * How a code sign-in ends: the provider's own status, which is what a browser sign-in reports
     * too. An account means it worked; anything else that stops the connect means it did not.
     *
     * The row has to be seen working on this login before its end is read out of it. A provider the
     * user is already signed in to is `available` from the start, and taking that for the finish
     * reported success as soon as the code appeared: nobody asking for a second account ever got to
     * type one.
     */
    createEffect(
      () => {
        const provider = codeLoginProvider();
        // The phase belongs in here rather than in the callback: a reactive read in an effect
        // callback is not tracked, so a dialog that reached `waiting` after the status did would
        // never be told about it.
        if (provider === null || codeLoginState().phase !== "waiting") return null;
        return agentStatus().providers?.find((row) => row.id === provider) ?? null;
      },
      (row) => {
        if (!row) return;
        if (row.connectionState === "connecting") {
          codeLoginStarted = true;
          return;
        }
        if (!codeLoginStarted) return;
        codeLoginStarted = false;
        if (row.state === "available" && !row.message) {
          endProviderCodeLogin(row.id, { kind: "connected", accountLabel: row.email ?? null });
        } else {
          endProviderCodeLogin(row.id, {
            kind: "failed",
            message:
              row.message ??
              currentText().t("app.provider.connectFailedRetry", {
                name: agentProviderDescriptor(row.id).displayName,
              }),
          });
        }
      },
    );

    async function refreshAgentProviders(): Promise<void> {
      if (refreshingProviders() || agentStatus().phase === "starting" || agentStatus().phase === "restarting") {
        return;
      }
      const analytics = desktopAnalytics.scope();
      setRefreshingProviders(true);
      try {
        const status = await providersPort().refreshAgentProviders();
        flush(() => applyAgentStatus(status));
        analytics.track("provider_action", { action: "refresh", result: "succeeded" });
      } catch (error) {
        analytics.track("provider_action", {
          action: "refresh",
          result: "failed",
          failure_code: "refresh_failed",
        });
        throw error;
      } finally {
        flush(() => setRefreshingProviders(false));
      }
    }

    onSettled(() => {
      return () => {
        codeLoginGeneration++;
        pendingProviderConnections.clear();
        clearCodeLoginExpiry();
      };
    });

    /**
     * The code sign-in as the one object its surfaces take. Onboarding and Settings both offer it
     * and would otherwise each assemble the same six pieces.
     */
    const codeLogin: ProviderCodeLoginApi = {
      provider: codeLoginProvider,
      state: codeLoginState,
      start: (provider) => void startProviderCodeLogin(provider),
      cancel: cancelProviderCodeLogin,
      openVerificationUrl: (url) => void appPort().openUrl(url),
    };

    return {
      ...runtimes,
      providerAdminServerId,
      providerKeys,
      hostCustomProviders,
      refreshingProviders,
      applyAgentStatus,
      connectProvider,
      codeLogin,
      openProviderInstallGuide,
      refreshAgentProviders,
    };
  },
});

export const ProvidersProvider = Providers.provider;
export const useProviders = Providers.use;
