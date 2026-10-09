import { isManagedRuntimeProvider, type ManagedProviderId } from "@openbot/contracts/agent-providers";
import type { AgentProviderId, AgentProviderStatus, AgentStatus, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { Toaster, toast } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, onCleanup, untrack } from "solid-js";
import { fn } from "storybook/test";
import type { FirstRunFlowProps } from "../src/features/onboarding/FirstRunFlow";
import { providerKeyApi } from "../src/features/settings/provider-key-api";
import { createFakeCodeLogin } from "./code-login-fixture";
import { STORY_AGENT_STATUS } from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

export const noProvidersConnectedAgentStatus: AgentStatus = {
  ...STORY_AGENT_STATUS,
  phase: "blocked",
  cliVersion: null,
  auth: { kind: "unknown" },
  providers: [
    { id: "opencode", state: "not-installed", version: null, message: "Install OpenCode on this computer." },
    {
      id: "codex",
      state: "sign-in-required",
      version: "0.149.1",
      message: "Connect ChatGPT to continue.",
    },
    {
      id: "claude",
      state: "sign-in-required",
      version: "2.1.246",
      message: "Connect Claude to continue.",
    },
    {
      id: "grok",
      state: "sign-in-required",
      version: "1.0.5",
      message: "Connect Grok to continue.",
    },
  ],
  capabilities: { ...STORY_AGENT_STATUS.capabilities, chat: "unavailable" },
  message: "Connect ChatGPT or Claude to create a local agent.",
};

/** A new computer: no provider is downloaded yet, Gemini, Cursor and Cline included. */
export const lazyProviders: AgentProviderStatus[] = [
  ...(noProvidersConnectedAgentStatus.providers ?? []).map(
    ({ connectionState: _connectionState, ...provider }): AgentProviderStatus => ({
      ...provider,
      state: "not-installed",
      message: null,
    }),
  ),
  { id: "antigravity", state: "not-installed", version: null, message: null },
  { id: "cursor", state: "not-installed", version: null, message: null },
  { id: "cline", state: "not-installed", version: null, message: null },
];
export const lazyProviderAgentStatus: AgentStatus = { ...noProvidersConnectedAgentStatus, providers: lazyProviders };

const initialRuntimeStatuses = (): Record<ManagedProviderId, ProviderRuntimeStatus> => ({
  codex: { phase: "not-downloaded", progress: null, message: null, version: null },
  claude: { phase: "not-downloaded", progress: null, message: null, version: null },
  grok: { phase: "not-downloaded", progress: null, message: null, version: null },
  antigravity: { phase: "not-downloaded", progress: null, message: null, version: null },
  cursor: { phase: "not-downloaded", progress: null, message: null, version: null },
  cline: { phase: "not-downloaded", progress: null, message: null, version: null },
  opencode: { phase: "not-downloaded", progress: null, message: null, version: null },
});

/** ChatGPT, Claude and Grok downloaded and waiting to connect; OpenCode still to download. */
const downloadedAgentStatus: AgentStatus = {
  ...lazyProviderAgentStatus,
  providers: lazyProviders.map((provider) =>
    provider.id === "opencode" || provider.id === "antigravity" || provider.id === "cursor" || provider.id === "cline"
      ? provider
      : { ...provider, state: "sign-in-required" },
  ),
};

const downloadedRuntimeStatuses = (): Record<ManagedProviderId, ProviderRuntimeStatus> => ({
  ...initialRuntimeStatuses(),
  codex: { phase: "ready", progress: 100, message: null, version: "0.149.1" },
  claude: { phase: "ready", progress: 100, message: null, version: "2.1.246" },
  grok: { phase: "ready", progress: 100, message: null, version: "1.0.5" },
});

/** Installs the mock `window.openbot` before the flow renders, and a toaster beside it. */
export function MockedOnboardingApi(props: { permissions?: boolean; children: JSX.Element }) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot();
  if (props.permissions) {
    mock.api.computerUse.getState = async () => ({
      status: "permissions-required",
      permissions: [
        { id: "screen-recording", granted: false },
        { id: "accessibility", granted: false },
      ],
      message: null,
    });
  }
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    toast.dismiss();
    window.openbot = previousApi;
  });
  return (
    <>
      {props.children}
      <Toaster />
    </>
  );
}

/** The flow arguments that `FakeProviderDownloads` supplies. The story spreads them over its own. */
type FakeProviderArgs = Pick<
  FirstRunFlowProps,
  | "agentStatus"
  | "providerRuntimeStatuses"
  | "providerAvailableVersions"
  | "onUpdateProvider"
  | "onDownloadProvider"
  | "onCancelProviderDownload"
  | "onConnectProvider"
  | "onInstallProvider"
  | "onRefreshProviders"
  | "providerKeys"
  | "codeLogin"
>;

/**
 * Fake provider downloads and connections: a download ticks every `tickMs` (default 160), finishes
 * in 700 ms, and a connection succeeds after 1.2 s.
 */
export function FakeProviderDownloads(props: {
  render: (fake: FakeProviderArgs) => JSX.Element;
  failGrokOnce?: boolean | undefined;
  downloaded?: boolean | undefined;
  initialAgentStatus?: AgentStatus | undefined;
  tickMs?: number | undefined;
}) {
  // The story chooses the start state once; later changes come from the fake actions below.
  const [agentStatus, setAgentStatus] = createSignal(
    untrack(() => props.initialAgentStatus ?? (props.downloaded ? downloadedAgentStatus : lazyProviderAgentStatus)),
  );
  const [runtimeStatuses, setRuntimeStatuses] = createSignal(
    untrack(() => (props.downloaded ? downloadedRuntimeStatuses() : initialRuntimeStatuses())),
  );
  const [grokFailed, setGrokFailed] = createSignal(false);
  // One offer, so the row actions menu shows both an Update and a "Check for updates".
  const [availableVersions, setAvailableVersions] = createSignal<Partial<Record<AgentProviderId, string | null>>>({
    claude: "2.1.250",
  });
  const providerTimers = new Map<AgentProviderId, Set<number>>();

  function rememberTimer(provider: AgentProviderId, timer: number): number {
    const timers = providerTimers.get(provider) ?? new Set<number>();
    timers.add(timer);
    providerTimers.set(provider, timers);
    return timer;
  }

  function clearProviderTimers(provider: AgentProviderId): void {
    for (const timer of providerTimers.get(provider) ?? []) {
      window.clearInterval(timer);
      window.clearTimeout(timer);
    }
    providerTimers.delete(provider);
  }

  function updateRuntime(provider: AgentProviderId, status: Partial<ProviderRuntimeStatus>): void {
    if (!isManagedRuntimeProvider(provider)) return;
    setRuntimeStatuses((current) => ({ ...current, [provider]: { ...current[provider], ...status } }));
  }

  /** Sets `update` on one provider. A connection state that `update` does not set is removed. */
  function updateProvider(provider: AgentProviderId, update: Partial<AgentProviderStatus>): void {
    setAgentStatus((current) => ({
      ...current,
      providers: (current.providers ?? []).map((candidate) => {
        if (candidate.id !== provider) return candidate;
        const { connectionState: _connectionState, ...rest } = candidate;
        return { ...rest, ...update };
      }),
    }));
  }

  function finishDownload(provider: AgentProviderId): void {
    updateRuntime(provider, { phase: "finishing", progress: 100 });
    rememberTimer(
      provider,
      window.setTimeout(() => {
        providerTimers.delete(provider);
        updateRuntime(provider, { phase: "ready", progress: 100 });
        updateProvider(provider, { state: "sign-in-required", message: `Connect ${provider} to continue.` });
      }, 700),
    );
  }

  function downloadProvider(provider: AgentProviderId): void {
    clearProviderTimers(provider);
    updateProvider(provider, { state: "not-installed", message: null });
    updateRuntime(provider, { phase: "downloading", progress: 0 });
    let progress = 0;
    const interval = window.setInterval(() => {
      progress = Math.min(100, progress + 4);
      if (props.failGrokOnce && provider === "grok" && !grokFailed() && progress >= 56) {
        window.clearInterval(interval);
        providerTimers.delete(provider);
        setGrokFailed(true);
        updateRuntime(provider, {
          phase: "download-error",
          progress: 55,
          message: "The download was interrupted. Try again.",
        });
        return;
      }
      updateRuntime(provider, { phase: "downloading", progress });
      if (progress < 100) return;
      window.clearInterval(interval);
      providerTimers.delete(provider);
      finishDownload(provider);
    }, props.tickMs ?? 160);
    rememberTimer(provider, interval);
  }

  function installUpdate(provider: AgentProviderId): void {
    const version = availableVersions()[provider] ?? null;
    clearProviderTimers(provider);
    setAvailableVersions((current) => ({ ...current, [provider]: null }));
    updateRuntime(provider, { phase: "downloading", progress: 0 });
    let progress = 0;
    const interval = window.setInterval(() => {
      progress = Math.min(100, progress + 10);
      if (progress < 100) {
        updateRuntime(provider, { phase: "downloading", progress });
        return;
      }
      window.clearInterval(interval);
      providerTimers.delete(provider);
      updateRuntime(provider, { phase: "ready", progress: 100, version });
    }, 160);
    rememberTimer(provider, interval);
  }

  function cancelProviderDownload(provider: AgentProviderId): void {
    clearProviderTimers(provider);
    updateRuntime(provider, { phase: "not-downloaded", progress: null });
  }

  function connectProvider(provider: AgentProviderId): void {
    clearProviderTimers(provider);
    updateProvider(provider, { connectionState: "connecting", message: null });
    rememberTimer(
      provider,
      window.setTimeout(() => {
        providerTimers.delete(provider);
        updateProvider(provider, { state: "available", message: null });
      }, 1_200),
    );
  }

  onCleanup(() => {
    for (const provider of providerTimers.keys()) clearProviderTimers(provider);
  });

  // The getters keep the flow reactive: the flow reads each value when it uses it.
  return props.render({
    get agentStatus() {
      return agentStatus();
    },
    get providerRuntimeStatuses() {
      return runtimeStatuses();
    },
    get providerAvailableVersions() {
      return availableVersions();
    },
    onUpdateProvider: installUpdate,
    onDownloadProvider: downloadProvider,
    onCancelProviderDownload: cancelProviderDownload,
    onConnectProvider: connectProvider,
    onInstallProvider: fn(),
    onRefreshProviders: undefined,
    providerKeys: providerKeyApi,
    codeLogin: createFakeCodeLogin({ finishAfterMs: 0 }),
  });
}
