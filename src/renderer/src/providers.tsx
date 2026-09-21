import { type AgentProviderId, type AgentStatus, agentProviderDescriptor } from "@openbot/contracts/ipc";
import { createEffect, createSignal, flush, onSettled } from "solid-js";
import { desktopAnalytics } from "./analytics";
import type { ProviderCodeLoginState } from "./components/ProviderCodeLoginDialog";
import type { ProviderCodeLoginApi } from "./components/provider-code-login-api";
import { toast } from "./components/ui";
import { useAgents } from "./features/agents/agents-context";
import { createProviderRuntimeStore } from "./features/provider-updates/provider-runtime-store";
import { useServers } from "./features/servers/servers-context";
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
    const runtimes = createProviderRuntimeStore(window.openbot.providerRuntimes, {
      systemCliVersion,
      isLocalServer: () => activeServer()?.kind === "local",
    });
    /** Connect attempts still waiting for the status that says how they ended. */
    const pendingProviderConnections = new Map<AgentProviderId, ReturnType<typeof desktopAnalytics.scope>>();
    /** The provider whose code dialog is open, and the phase that dialog shows. */
    const [codeLoginProvider, setCodeLoginProvider] = createSignal<AgentProviderId | null>(null);
    const [codeLoginState, setCodeLoginState] = createSignal<ProviderCodeLoginState>({ phase: "starting" });
    let codeLoginExpiry: number | undefined;
    /** Whether the provider has been seen working on the open code sign-in. */
    let codeLoginStarted = false;

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
        return Promise.reject(new Error(`${descriptor.displayName} is included with OpenBot.`));
      }
      return window.openbot.openExternal(descriptor.installGuideLink);
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
        const status = await window.openbot.connectProvider(provider);
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
      clearCodeLoginExpiry();
      codeLoginStarted = false;
      setCodeLoginProvider(provider);
      setCodeLoginState({ phase: "starting" });
      const analytics = beginProviderConnection(provider);
      try {
        const started = await window.openbot.startProviderCodeLogin(provider);
        // A dialog the user closed while the provider was answering: the login was cancelled with
        // it, so there is nobody left to show a code to.
        if (codeLoginProvider() !== provider) return;
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
            codeLoginExpiry = undefined;
            if (codeLoginState().phase === "waiting") endProviderCodeLogin(provider, { kind: "expired" });
          },
          Math.max(0, started.expiresAt - Date.now()),
        );
      } catch (error) {
        if (codeLoginProvider() !== provider) return;
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
      clearCodeLoginExpiry();
      setCodeLoginProvider(null);
      if (!provider) return;
      pendingProviderConnections.delete(provider);
      void window.openbot
        .cancelProviderCodeLogin(provider)
        .then((status) => flush(() => applyAgentStatus(status)))
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
      clearCodeLoginExpiry();
      codeLoginStarted = false;
      flush(() => setCodeLoginProvider(null));
      const name = agentProviderDescriptor(provider).displayName;
      if (outcome.kind === "connected") {
        toast.success(`${name} connected`, {
          description: outcome.accountLabel
            ? `Signed in as ${outcome.accountLabel}.`
            : "The sign-in finished on the other device.",
        });
        return;
      }
      const retry = { label: "Get a new code", onClick: () => void startProviderCodeLogin(provider) };
      if (outcome.kind === "expired") {
        toast.warning(`The ${name} code expired`, {
          description: "Nobody entered it in time. That code no longer works.",
          action: retry,
        });
        return;
      }
      toast.error(`Could not connect ${name}`, {
        description: outcome.message,
        action: { ...retry, label: "Try again" },
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
        if (row.state === "available") {
          endProviderCodeLogin(row.id, { kind: "connected", accountLabel: row.email ?? null });
        } else {
          endProviderCodeLogin(row.id, {
            kind: "failed",
            message:
              row.message ?? `OpenBot could not connect ${agentProviderDescriptor(row.id).displayName}. Try again.`,
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
        const status = await window.openbot.refreshAgentProviders();
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
      openVerificationUrl: (url) => void window.openbot.openUrl(url),
    };

    return {
      ...runtimes,
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
