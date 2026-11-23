import {
  type AgentProviderId,
  type AgentStatus,
  agentProviderDescriptor,
  type McpSignInRelayPage,
  type ProviderAccountCodeLoginStart,
  type ProviderAccountCodeLoginStatus,
  type ProviderCodeLoginStart,
  type ProviderHostSignInStatus,
  type ProviderRelaySignInStatus,
} from "@openbot/contracts/ipc";
import type { ProviderCodeLoginState } from "@openbot/ui/components/ProviderCodeLoginDialog";
import type { BrowserViewRuntime } from "@openbot/ui/features/browser/BrowserLiveView";
import { currentText } from "@openbot/ui/text";
import { createEffect, createSignal, flush, onCleanup } from "solid-js";
import { actionToast } from "../../action-toast";
import type {
  ProviderCodeLoginOpener,
  ProviderConnectionApi,
  ProviderUseApp,
} from "../../components/provider-connection-api";
import {
  type ProviderCodeLoginMethod,
  type ProviderConnectPlace,
  type ProviderSignInMethod,
  providerConnectRoute,
} from "./provider-connect-route";

interface ProviderCodeLoginTarget {
  start: (provider: AgentProviderId) => Promise<ProviderCodeLoginStart>;
  submit?: (provider: AgentProviderId, code: string) => Promise<AgentStatus>;
  cancel: (provider: AgentProviderId) => Promise<AgentStatus>;
  hostSignIn?: ProviderHostSignInTarget;
  relay?: ProviderRelayTarget;
  accountSignIn?: ProviderAccountSignInTarget;
  accountRelay?: ProviderAccountRelayTarget;
  accountCode?: ProviderAccountCodeTarget;
}

interface ProviderAccountCodeTarget {
  start: (provider: AgentProviderId, accountId: string | null) => Promise<ProviderAccountCodeLoginStart>;
  submit: (provider: AgentProviderId, accountId: string, code: string) => Promise<void>;
  status: (provider: AgentProviderId, accountId: string) => Promise<ProviderAccountCodeLoginStatus>;
  cancel: (provider: AgentProviderId, accountId: string) => Promise<void>;
}

interface ProviderRelayTarget {
  hostName: string;
  start: (provider: AgentProviderId) => Promise<void>;
  status: (provider: AgentProviderId) => Promise<ProviderRelaySignInStatus>;
  open: (provider: AgentProviderId) => Promise<void>;
  paste: (provider: AgentProviderId, address: string) => Promise<void>;
  cancel: (provider: AgentProviderId) => Promise<AgentStatus>;
}

interface ProviderHostSignInTarget {
  hostName: string;
  runtime: BrowserViewRuntime;
  clipboard: boolean;
  start: (provider: AgentProviderId) => Promise<void>;
  status: (provider: AgentProviderId) => Promise<ProviderHostSignInStatus>;
  cancel: (provider: AgentProviderId) => Promise<AgentStatus>;
}

interface ProviderAccountSignInTarget extends Omit<ProviderHostSignInTarget, "start"> {
  start: (provider: AgentProviderId, accountId: string | null) => Promise<void>;
}

interface ProviderAccountRelayTarget extends Omit<ProviderRelayTarget, "start"> {
  providers: readonly AgentProviderId[];
  start: (provider: AgentProviderId, accountId: string | null) => Promise<void>;
}

const HOST_SIGN_IN_POLL_MS = 1_000;
const HOST_SIGN_IN_STATUS_RETRY_MS = 60_000;

function waitForNextPoll(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, HOST_SIGN_IN_POLL_MS));
}

export interface ProviderConnectionOptions {
  agentStatus: () => AgentStatus;
  applyStatus: (status: AgentStatus) => void;
  target: () => ProviderCodeLoginTarget;
  place: () => ProviderConnectPlace | null;
  connectInBrowser?: (provider: AgentProviderId) => Promise<void>;
  connectInMainlandChina?: (provider: AgentProviderId) => Promise<void>;
  openVerificationUrl: (url: string) => void;
  openAppDownload?: () => void;
  analytics?: {
    begin: (provider: AgentProviderId) => () => void;
    drop: (provider: AgentProviderId) => void;
  };
}

export interface ProviderConnectionController extends ProviderConnectionApi {
  connectAccount: (provider: AgentProviderId, accountId: string | null) => void;
  connectAccountWithCode: (provider: AgentProviderId, accountId: string | null) => void;
}

export function createProviderConnection(options: ProviderConnectionOptions): ProviderConnectionController {
  const [codeLoginProvider, setCodeLoginProvider] = createSignal<AgentProviderId | null>(null);
  const [codeLoginState, setCodeLoginState] = createSignal<ProviderCodeLoginState>({ phase: "starting" });
  const [codeLoginOpener, setCodeLoginOpener] = createSignal<ProviderCodeLoginOpener | null>(null);
  const [useApp, setUseApp] = createSignal<ProviderUseApp | null>(null);
  let codeLoginExpiry: number | undefined;
  let codeLoginStarted = false;
  let codeLoginGeneration = 0;
  let codeLoginCancellation: Promise<void> = Promise.resolve();
  let codeLoginTarget: ProviderCodeLoginTarget | undefined;
  let codeLoginMethod: ProviderCodeLoginMethod = "code";
  let codeLoginAccount: string | null | undefined;
  let codeLoginAccountId: string | undefined;

  function run(
    provider: AgentProviderId,
    method: ProviderSignInMethod | null,
    opener: ProviderCodeLoginOpener | null,
  ): Promise<void> {
    if (method === "browser") return options.connectInBrowser?.(provider) ?? Promise.resolve();
    if (method === "use-app") setUseApp({ provider, opener });
    else if (method === "relay" || method === "host-page" || method === "code")
      void startProviderCodeLogin(provider, method, opener);
    return Promise.resolve();
  }

  async function startProviderCodeLogin(
    provider: AgentProviderId,
    method: ProviderCodeLoginMethod,
    opener: ProviderCodeLoginOpener | null,
    accountId?: string | null,
  ): Promise<void> {
    const generation = ++codeLoginGeneration;
    clearCodeLoginExpiry();
    codeLoginStarted = false;
    const target = accountTarget(options.target(), accountId);
    codeLoginTarget = target;
    codeLoginMethod = method;
    codeLoginAccount = accountId;
    codeLoginAccountId = undefined;
    setCodeLoginOpener(opener);
    setCodeLoginProvider(provider);
    setCodeLoginState({ phase: "starting" });
    const failConnection = options.analytics?.begin(provider);
    try {
      await codeLoginCancellation;
      if (generation !== codeLoginGeneration) return;
      const failed = () =>
        new Error(
          currentText().t("app.provider.connectFailedRetry", { name: agentProviderDescriptor(provider).displayName }),
        );
      if (method === "relay") {
        const relay = target.relay;
        if (!relay) throw failed();
        setCodeLoginState({ phase: "relay", hostName: relay.hostName, page: null });
        await relay.start(provider);
        if (generation !== codeLoginGeneration) {
          if (codeLoginProvider() !== provider) void relay.cancel(provider).catch(() => undefined);
          return;
        }
        await followRelaySignIn(provider, relay, generation);
        return;
      }
      if (method === "host-page") {
        const host = target.hostSignIn;
        if (!host) throw failed();
        setCodeLoginState({ phase: "page", hostName: host.hostName, page: null });
        await host.start(provider);
        if (generation !== codeLoginGeneration) {
          if (codeLoginProvider() !== provider) void host.cancel(provider).catch(() => undefined);
          return;
        }
        await followHostSignIn(provider, host, generation);
        return;
      }
      if (accountId !== undefined) {
        const accountCode = target.accountCode;
        if (!accountCode) throw failed();
        const account = await accountCode.start(provider, accountId);
        if (generation !== codeLoginGeneration) {
          if (codeLoginProvider() !== provider || codeLoginAccount !== account.accountId)
            void accountCode.cancel(provider, account.accountId).catch(() => undefined);
          return;
        }
        codeLoginAccountId = account.accountId;
        if (account.start.kind === "connected") {
          await followAccountCodeSignIn(provider, accountCode, account.accountId, generation);
          return;
        }
        showCode(account.start);
        codeLoginExpiry = window.setTimeout(
          () => {
            if (generation !== codeLoginGeneration) return;
            codeLoginExpiry = undefined;
            if (!isWaitingPhase(codeLoginState())) return;
            void accountCode.cancel(provider, account.accountId).catch(() => undefined);
            endProviderCodeLogin(provider, { kind: "expired" });
          },
          Math.max(0, account.start.expiresAt - Date.now()),
        );
        await followAccountCodeSignIn(provider, accountCode, account.accountId, generation);
        return;
      }
      const started = await target.start(provider);
      if (generation !== codeLoginGeneration) return;
      if (started.kind === "connected") {
        const row = options.agentStatus().providers?.find((candidate) => candidate.id === provider);
        endProviderCodeLogin(provider, { kind: "connected", accountLabel: row?.email ?? null });
        return;
      }
      showCode(started);
      codeLoginExpiry = window.setTimeout(
        () => {
          if (generation !== codeLoginGeneration) return;
          codeLoginExpiry = undefined;
          if (isWaitingPhase(codeLoginState())) endProviderCodeLogin(provider, { kind: "expired" });
        },
        Math.max(0, started.expiresAt - Date.now()),
      );
    } catch (error) {
      if (generation !== codeLoginGeneration) return;
      failConnection?.();
      endProviderCodeLogin(provider, {
        kind: "failed",
        message:
          error instanceof Error && error.message
            ? error.message
            : currentText().t("app.provider.connectFailedRetry", {
                name: agentProviderDescriptor(provider).displayName,
              }),
      });
    }
  }

  function showCode(started: Exclude<ProviderCodeLoginStart, { kind: "connected" }>): void {
    flush(() =>
      setCodeLoginState(
        started.kind === "paste" || started.kind === "link"
          ? { phase: started.kind, verificationUrl: started.verificationUrl, expiresAt: started.expiresAt }
          : {
              phase: "waiting",
              userCode: started.userCode,
              verificationUrl: started.verificationUrl,
              ...(started.verificationUrlComplete === undefined
                ? {}
                : { verificationUrlComplete: started.verificationUrlComplete }),
              expiresAt: started.expiresAt,
            },
      ),
    );
  }

  async function readSignInStatus<T>(
    read: () => Promise<T>,
    cancel: () => Promise<unknown>,
    generation: number,
  ): Promise<T> {
    const firstAttemptAt = Date.now();
    for (;;) {
      try {
        return await read();
      } catch (error) {
        if (generation !== codeLoginGeneration) throw error;
        if (Date.now() - firstAttemptAt >= HOST_SIGN_IN_STATUS_RETRY_MS) {
          void cancel().catch(() => undefined);
          throw error;
        }
      }
      await waitForNextPoll();
    }
  }

  async function followAccountCodeSignIn(
    provider: AgentProviderId,
    accountCode: ProviderAccountCodeTarget,
    accountId: string,
    generation: number,
  ): Promise<void> {
    while (generation === codeLoginGeneration) {
      const status = await readSignInStatus(
        () => accountCode.status(provider, accountId),
        () => accountCode.cancel(provider, accountId),
        generation,
      );
      if (generation !== codeLoginGeneration) return;
      if (status.result) {
        if (status.result.error) endProviderCodeLogin(provider, { kind: "failed", message: status.result.error });
        else endProviderCodeLogin(provider, { kind: "connected", accountLabel: signedInLabel(provider) });
        return;
      }
      await waitForNextPoll();
    }
  }

  async function followHostSignIn(
    provider: AgentProviderId,
    host: ProviderHostSignInTarget,
    generation: number,
  ): Promise<void> {
    while (generation === codeLoginGeneration) {
      const status = await readSignInStatus(
        () => host.status(provider),
        () => host.cancel(provider),
        generation,
      );
      if (generation !== codeLoginGeneration) return;
      if (status.result) {
        if (status.result.error) {
          endProviderCodeLogin(provider, { kind: "failed", message: status.result.error });
        } else {
          endProviderCodeLogin(provider, { kind: "connected", accountLabel: signedInLabel(provider) });
        }
        return;
      }
      const state = codeLoginState();
      const shown = state.phase === "page" ? (state.page?.tabId ?? null) : null;
      if (status.tabId !== shown)
        setCodeLoginState({
          phase: "page",
          hostName: host.hostName,
          page: status.tabId ? { runtime: host.runtime, tabId: status.tabId, clipboard: host.clipboard } : null,
        });
      await waitForNextPoll();
    }
  }

  function signedInLabel(provider: AgentProviderId): string | null {
    const row = options.agentStatus().providers?.find((candidate) => candidate.id === provider);
    if (codeLoginAccount === undefined) return row?.email ?? null;
    const accountId = codeLoginAccountId ?? codeLoginAccount;
    if (accountId === null) return null;
    return row?.accounts?.find((account) => account.id === accountId)?.email ?? null;
  }

  async function followRelaySignIn(
    provider: AgentProviderId,
    relay: ProviderRelayTarget,
    generation: number,
  ): Promise<void> {
    while (generation === codeLoginGeneration) {
      const status = await readSignInStatus(
        () => relay.status(provider),
        () => relay.cancel(provider),
        generation,
      );
      if (generation !== codeLoginGeneration) return;
      if (status.result) {
        if (status.result.error) {
          endProviderCodeLogin(provider, { kind: "failed", message: status.result.error });
        } else {
          endProviderCodeLogin(provider, { kind: "connected", accountLabel: signedInLabel(provider) });
        }
        return;
      }
      const state = codeLoginState();
      const shown = state.phase === "relay" ? state.page : null;
      const page =
        status.page?.listening && codeLoginAccount === undefined && route(provider).alternative === "code"
          ? { ...status.page, pasteable: false }
          : status.page;
      if (!page && shown) setCodeLoginState({ phase: "verifying" });
      else if (page && !samePage(shown, page)) setCodeLoginState({ phase: "relay", hostName: relay.hostName, page });
      await waitForNextPoll();
    }
  }

  function openRelay(): { provider: AgentProviderId; relay: ProviderRelayTarget } | null {
    const provider = codeLoginProvider();
    const relay = codeLoginTarget?.relay;
    if (!provider || !relay || codeLoginState().phase !== "relay") return null;
    return { provider, relay };
  }

  async function submitProviderCodeLogin(code: string): Promise<void> {
    const provider = codeLoginProvider();
    const state = codeLoginState();
    const target = codeLoginTarget;
    const accountId = codeLoginAccount === undefined ? undefined : codeLoginAccountId;
    const account = accountId === undefined ? undefined : target?.accountCode;
    if (!provider || state.phase !== "paste" || state.submitting || !(account ?? target?.submit)) return;
    const generation = codeLoginGeneration;
    setCodeLoginState({
      phase: "paste",
      verificationUrl: state.verificationUrl,
      expiresAt: state.expiresAt,
      submitting: true,
    });
    try {
      if (account && accountId !== undefined) {
        await account.submit(provider, accountId, code);
        if (generation === codeLoginGeneration && codeLoginState().phase === "paste")
          setCodeLoginState({ phase: "verifying" });
        return;
      }
      const status = await target?.submit?.(provider, code);
      if (generation !== codeLoginGeneration || !status) return;
      flush(() => {
        setCodeLoginState({ phase: "verifying" });
        options.applyStatus(status);
      });
    } catch (error) {
      if (generation !== codeLoginGeneration) return;
      const { t, sourceText } = currentText();
      setCodeLoginState({
        ...state,
        submitting: false,
        error:
          error instanceof Error && error.message
            ? sourceText(error.message)
            : t("app.provider.connectFailedRetry", { name: agentProviderDescriptor(provider).displayName }),
      });
    }
  }

  function cancelProviderCodeLogin(): void {
    const provider = codeLoginProvider();
    const generation = ++codeLoginGeneration;
    codeLoginStarted = false;
    clearCodeLoginExpiry();
    setCodeLoginProvider(null);
    const target = codeLoginTarget;
    if (!provider || !target) return;
    options.analytics?.drop(provider);
    if (codeLoginMethod === "code" && codeLoginAccount !== undefined) {
      const accountId = codeLoginAccountId;
      if (accountId && target.accountCode)
        codeLoginCancellation = target.accountCode.cancel(provider, accountId).catch(() => undefined);
      return;
    }
    const cancel =
      codeLoginMethod === "relay" && target.relay
        ? target.relay.cancel
        : codeLoginMethod === "host-page" && target.hostSignIn
          ? target.hostSignIn.cancel
          : target.cancel;
    codeLoginCancellation = cancel(provider)
      .then((status) => {
        if (generation === codeLoginGeneration) flush(() => options.applyStatus(status));
      })
      .catch(() => undefined);
  }

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
    const opener = codeLoginOpener();
    const method = codeLoginMethod;
    const accountId = codeLoginAccount;
    const name = agentProviderDescriptor(provider).displayName;
    const { t, sourceText } = currentText();
    if (outcome.kind === "connected") {
      const description = outcome.accountLabel
        ? t("app.provider.signedInAs", { account: outcome.accountLabel })
        : accountId === undefined
          ? t("app.provider.signedInElsewhere")
          : undefined;
      actionToast.success(t("app.provider.connected", { name }), description ? { description } : {});
      return;
    }
    const retry = {
      label: t("app.provider.newCode"),
      onClick: () => void startProviderCodeLogin(provider, method, opener, accountId),
    };
    if (outcome.kind === "expired") {
      actionToast.warning(t("app.provider.codeExpired", { name }), {
        ...{
          description: t("app.provider.codeExpiredDescription"),
          action: retry,
        },
        report: { operation: "provider", source: "action", cause_code: "unknown" },
      });
      return;
    }
    actionToast.error(t("app.provider.connectFailed", { name }), {
      ...{
        description: sourceText(outcome.message),
        action: { ...retry, label: t("common.tryAgain") },
      },
      report: { operation: "provider", source: "action", cause_code: "unknown" },
    });
  }

  function clearCodeLoginExpiry(): void {
    if (codeLoginExpiry === undefined) return;
    window.clearTimeout(codeLoginExpiry);
    codeLoginExpiry = undefined;
  }

  createEffect(
    () => {
      const provider = codeLoginProvider();
      if (provider === null || !isWaitingPhase(codeLoginState())) return null;
      return options.agentStatus().providers?.find((row) => row.id === provider) ?? null;
    },
    (row) => {
      if (!row || (codeLoginMethod === "code" && codeLoginAccount !== undefined)) return;
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

  onCleanup(() => {
    codeLoginGeneration++;
    clearCodeLoginExpiry();
  });

  const route = (provider: AgentProviderId) => providerConnectRoute(provider, options.place());

  return {
    connectKind: (provider) => {
      const connect = route(provider).connect;
      if (connect === "browser") return options.connectInBrowser ? "browser" : null;
      return connect === null ? null : "dialog";
    },
    alternativeKind: (provider) => {
      const alternative = route(provider).alternative;
      return alternative === "code" ? "code" : alternative === "relay" ? "address" : null;
    },
    provider: codeLoginProvider,
    state: codeLoginState,
    opener: codeLoginOpener,
    connect: (provider, opener) => run(provider, route(provider).connect, opener ?? null),
    connectAccount: (provider, accountId) => {
      const relay = options.target().accountRelay?.providers.includes(provider);
      void startProviderCodeLogin(provider, relay ? "relay" : "host-page", null, accountId);
    },
    connectAccountWithCode: (provider, accountId) => void startProviderCodeLogin(provider, "code", null, accountId),
    alternative: (provider, opener) => run(provider, route(provider).alternative, opener ?? null),
    mainlandChinaSite: (provider) =>
      route(provider).connect === "browser" && options.connectInMainlandChina
        ? (agentProviderDescriptor(provider).mainlandChinaSignInSite ?? null)
        : null,
    connectInMainlandChina: (provider) => options.connectInMainlandChina?.(provider) ?? Promise.resolve(),
    useApp,
    closeUseApp: () => setUseApp(null),
    openAppDownload: options.openAppDownload,
    submit: (code) => void submitProviderCodeLogin(code),
    cancel: cancelProviderCodeLogin,
    openVerificationUrl: options.openVerificationUrl,
    openRelayPage: () => {
      const open = openRelay();
      return open ? open.relay.open(open.provider) : Promise.reject(new Error(currentText().t("error.mcp.relayEnded")));
    },
    pasteRelayAddress: (address) => {
      const open = openRelay();
      return open
        ? open.relay.paste(open.provider, address)
        : Promise.reject(new Error(currentText().t("error.mcp.relayEnded")));
    },
  };
}

function isWaitingPhase(state: ProviderCodeLoginState): boolean {
  return (
    state.phase === "waiting" ||
    state.phase === "paste" ||
    state.phase === "link" ||
    state.phase === "page" ||
    state.phase === "relay" ||
    state.phase === "verifying"
  );
}

function samePage(shown: McpSignInRelayPage | null, page: McpSignInRelayPage): boolean {
  return (
    shown?.authorizeHost === page.authorizeHost &&
    shown.url === page.url &&
    shown.listening === page.listening &&
    shown.pasteable === page.pasteable
  );
}

function accountTarget(target: ProviderCodeLoginTarget, accountId: string | null | undefined): ProviderCodeLoginTarget {
  if (accountId === undefined) return target;
  const { hostSignIn: _ownSignIn, relay: _ownRelay, accountSignIn, accountRelay, ...rest } = target;
  return {
    ...rest,
    ...(accountSignIn
      ? { hostSignIn: { ...accountSignIn, start: (provider) => accountSignIn.start(provider, accountId) } }
      : {}),
    ...(accountRelay
      ? { relay: { ...accountRelay, start: (provider) => accountRelay.start(provider, accountId) } }
      : {}),
  };
}
