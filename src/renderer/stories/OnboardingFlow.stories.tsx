import { isManagedRuntimeProvider, type ManagedProviderId } from "@openbot/contracts/agent-providers";
import type { AgentProviderId, AgentStatus, AppSetupState, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { Toaster, toast } from "@openbot/ui";
import { createSignal, onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { OnboardingFlow } from "../src/features/onboarding/OnboardingFlow";
import { providerKeyApi } from "../src/features/settings/provider-key-api";
import { createFakeCodeLogin } from "./code-login-fixture";
import { STORY_AGENT_STATUS } from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

const setupState: AppSetupState = { completed: false, preferredProvider: null, preferredModel: null };

/** OpenCode installed with no account of its own: enough to run an endpoint that brings its own key. */
const openCodeInstalledAgentStatus: AgentStatus = {
  ...STORY_AGENT_STATUS,
  providers: [
    ...(STORY_AGENT_STATUS.providers ?? []),
    { id: "opencode", state: "sign-in-required", version: "1.18.27", message: null },
  ],
};

const noProvidersConnectedAgentStatus: AgentStatus = {
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

const checkingProvidersAgentStatus: AgentStatus = {
  ...noProvidersConnectedAgentStatus,
  phase: "starting",
  providers: noProvidersConnectedAgentStatus.providers?.map((provider) => ({
    ...provider,
    state: "checking",
    message: null,
  })),
  message: "Checking local AI providers…",
};

const bothConnectingAgentStatus: AgentStatus = {
  ...noProvidersConnectedAgentStatus,
  providers: noProvidersConnectedAgentStatus.providers?.map((provider) => ({
    ...provider,
    connectionState: "connecting" as const,
    message: null,
  })),
};

/** A new computer: no provider is downloaded yet, Gemini included. */
const lazyProviderAgentStatus: AgentStatus = {
  ...noProvidersConnectedAgentStatus,
  providers: [
    ...(noProvidersConnectedAgentStatus.providers ?? []).map((provider) => ({
      ...provider,
      state: "not-installed" as const,
      connectionState: undefined,
      message: null,
    })),
    { id: "antigravity", state: "not-installed", version: null, message: null },
  ],
};

/** Gemini is downloaded and signed in. The others are not downloaded yet. */
const geminiSignedInAgentStatus: AgentStatus = {
  ...lazyProviderAgentStatus,
  providers: lazyProviderAgentStatus.providers?.map((provider) =>
    provider.id === "antigravity"
      ? { ...provider, state: "available", version: "1.2.1", email: "ada@example.com" }
      : provider,
  ),
};

const initialRuntimeStatuses = (): Record<ManagedProviderId, ProviderRuntimeStatus> => ({
  codex: { phase: "not-downloaded", progress: null, message: null, version: null },
  claude: { phase: "not-downloaded", progress: null, message: null, version: null },
  grok: { phase: "not-downloaded", progress: null, message: null, version: null },
  antigravity: { phase: "not-downloaded", progress: null, message: null, version: null },
  opencode: { phase: "not-downloaded", progress: null, message: null, version: null },
});

function MockedOnboardingFlow(props: { args: Parameters<typeof OnboardingFlow>[0]; permissions?: boolean }) {
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
      <OnboardingFlow {...props.args} />
      <Toaster />
    </>
  );
}

function RefreshResettingFlow(props: { args: Parameters<typeof OnboardingFlow>[0] }) {
  const [agentStatus, setAgentStatus] = createSignal(bothConnectingAgentStatus);
  const [refreshingProviders, setRefreshingProviders] = createSignal(false);
  return (
    <MockedOnboardingFlow
      args={{
        ...props.args,
        agentStatus: agentStatus(),
        refreshingProviders: refreshingProviders(),
        onRefreshProviders: async () => {
          setRefreshingProviders(true);
          await props.args.onRefreshProviders?.();
          await new Promise((resolve) => setTimeout(resolve, 100));
          setAgentStatus(noProvidersConnectedAgentStatus);
          setRefreshingProviders(false);
        },
      }}
    />
  );
}

/** ChatGPT, Claude and Grok downloaded and waiting to connect; OpenCode still to download. */
const downloadedAgentStatus: AgentStatus = {
  ...lazyProviderAgentStatus,
  providers: lazyProviderAgentStatus.providers?.map((provider) =>
    provider.id === "opencode" || provider.id === "antigravity" ? provider : { ...provider, state: "sign-in-required" },
  ),
};

const downloadedRuntimeStatuses = (): Record<ManagedProviderId, ProviderRuntimeStatus> => ({
  ...initialRuntimeStatuses(),
  codex: { phase: "ready", progress: 100, message: null, version: "0.149.1" },
  claude: { phase: "ready", progress: 100, message: null, version: "2.1.246" },
  grok: { phase: "ready", progress: 100, message: null, version: "1.0.5" },
});

function LazyProviderDownloadsFlow(props: {
  args: Parameters<typeof OnboardingFlow>[0];
  failGrokOnce?: boolean;
  downloaded?: boolean;
  initialAgentStatus?: AgentStatus;
}) {
  const [agentStatus, setAgentStatus] = createSignal(
    props.initialAgentStatus ?? (props.downloaded ? downloadedAgentStatus : lazyProviderAgentStatus),
  );
  const [runtimeStatuses, setRuntimeStatuses] = createSignal(
    props.downloaded ? downloadedRuntimeStatuses() : initialRuntimeStatuses(),
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

  function updateProvider(
    provider: AgentProviderId,
    update: Partial<NonNullable<AgentStatus["providers"]>[number]>,
  ): void {
    setAgentStatus((current) => ({
      ...current,
      providers: current.providers?.map((candidate) =>
        candidate.id === provider ? { ...candidate, ...update } : candidate,
      ),
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
    updateProvider(provider, { state: "not-installed", connectionState: undefined, message: null });
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
    }, 160);
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
        updateProvider(provider, { state: "available", connectionState: undefined, message: null });
      }, 1_200),
    );
  }

  onCleanup(() => {
    for (const provider of providerTimers.keys()) clearProviderTimers(provider);
  });

  return (
    <MockedOnboardingFlow
      args={{
        ...props.args,
        agentStatus: agentStatus(),
        providerRuntimeStatuses: runtimeStatuses(),
        providerAvailableVersions: availableVersions(),
        onUpdateProvider: installUpdate,
        onDownloadProvider: downloadProvider,
        onCancelProviderDownload: cancelProviderDownload,
        onConnectProvider: connectProvider,
        onInstallProvider: fn(),
        onRefreshProviders: undefined,
        providerKeys: providerKeyApi,
        codeLogin: createFakeCodeLogin({ finishAfterMs: 0 }),
      }}
    />
  );
}

const args: Parameters<typeof OnboardingFlow>[0] = {
  state: setupState,
  agentStatus: STORY_AGENT_STATUS,
  platform: "darwin",
  onSave: async (_provider: AgentProviderId) => undefined,
  // Every onboarding story offers it: naming your own endpoint is part of choosing a provider,
  // not a variant of the step.
  onAddCustomProvider: fn(async () => "restarted" as const),
  customProviders: [
    {
      id: "studio-local",
      name: "Studio Local",
      baseUrl: "http://127.0.0.1:11434/v1",
      hasApiKey: false,
      models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
    },
  ],
};

const meta = {
  title: "Setup/OnboardingFlow",
  component: OnboardingFlow,
  args,
  parameters: {
    layout: "fullscreen",
    viewport: {
      options: {
        onboardingNarrow: {
          name: "Onboarding — 420 × 760",
          styles: { width: "420px", height: "760px" },
        },
      },
    },
  },
  render: (storyArgs) => <MockedOnboardingFlow args={storyArgs} />,
} satisfies Meta<typeof OnboardingFlow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Initial: Story = {};

/** The row that adds a self-described endpoint. OpenCode is installed, so the row offers Add. */
export const AddCustomProvider: Story = {
  args: { agentStatus: openCodeInstalledAgentStatus },
};

/** The endpoint is refused, so the form stays with the values, including the key the user typed. */
export const CustomProviderSaveFails: Story = {
  args: {
    agentStatus: openCodeInstalledAgentStatus,
    onAddCustomProvider: fn(async () => {
      throw new Error("House Router refused the API key.");
    }),
  },
};

export const NarrowProviderVersions: Story = {
  globals: { viewport: "onboardingNarrow" },
  args: {
    providerRuntimeStatuses: {
      codex: { phase: "ready", progress: null, message: null, version: "0.149.1" },
      claude: { phase: "ready", progress: null, message: null, version: "2.1.246" },
      grok: { phase: "ready", progress: null, message: null, version: "1.0.5" },
    },
  },
};

export const OptionalPermissions: Story = {
  render: (storyArgs) => <MockedOnboardingFlow args={storyArgs} permissions />,
};

export const NoProvidersConnected: Story = {
  args: {
    agentStatus: noProvidersConnectedAgentStatus,
    onConnectProvider: fn(),
    onRefreshProviders: fn(),
  },
};

/**
 * The second way in, on the step where it matters most: first run on a computer whose browser
 * cannot finish the hand-off. The ChatGPT row keeps it in its actions menu, beside the Connect the
 * step leads with, and the code opens over the step rather than replacing it.
 */
export const SignInWithCode: Story = {
  args: {
    agentStatus: noProvidersConnectedAgentStatus,
    onConnectProvider: fn(),
    onRefreshProviders: fn(),
    codeLogin: createFakeCodeLogin({ finishAfterMs: 0 }),
  },
};

export const RefreshingProviders: Story = {
  args: {
    agentStatus: checkingProvidersAgentStatus,
    refreshingProviders: true,
    onConnectProvider: fn(),
    onRefreshProviders: fn(),
  },
};

export const ConnectedWithRefreshWarning: Story = {
  args: {
    agentStatus: {
      ...STORY_AGENT_STATUS,
      providers: STORY_AGENT_STATUS.providers?.map((provider) =>
        provider.id === "codex"
          ? {
              ...provider,
              checkError: "Could not verify ChatGPT. Keeping the existing connection.",
            }
          : provider,
      ),
    },
    onConnectProvider: fn(),
    onRefreshProviders: fn(),
  },
};

export const ConnectingChatGPT: Story = {
  args: {
    agentStatus: {
      ...noProvidersConnectedAgentStatus,
      providers: noProvidersConnectedAgentStatus.providers?.map((provider) =>
        provider.id === "codex" ? { ...provider, connectionState: "connecting", message: null } : provider,
      ),
    },
    onConnectProvider: fn(),
    onRefreshProviders: fn(),
  },
};

export const ConnectingClaude: Story = {
  args: {
    agentStatus: {
      ...noProvidersConnectedAgentStatus,
      providers: noProvidersConnectedAgentStatus.providers?.map((provider) =>
        provider.id === "claude" ? { ...provider, connectionState: "connecting", message: null } : provider,
      ),
    },
    onConnectProvider: fn(),
    onRefreshProviders: fn(),
  },
};

export const ConnectingBoth: Story = {
  args: {
    agentStatus: bothConnectingAgentStatus,
    onConnectProvider: fn(),
    onRefreshProviders: fn(),
  },
};

export const RefreshResettingConnections: Story = {
  args: {
    agentStatus: bothConnectingAgentStatus,
    onConnectProvider: fn(),
    onRefreshProviders: fn(),
  },
  render: (storyArgs) => <RefreshResettingFlow args={storyArgs} />,
};

export const ConnectedWithReconnect: Story = {
  args: {
    agentStatus: STORY_AGENT_STATUS,
    onConnectProvider: fn(),
    onRefreshProviders: fn(),
  },
};

export const LazyProviderDownloads: Story = {
  args: {
    agentStatus: lazyProviderAgentStatus,
  },
  render: (storyArgs) => <LazyProviderDownloadsFlow args={storyArgs} />,
};

/**
 * A new computer with no saved endpoint. The list shows ChatGPT, Claude, Grok and OpenCode. Gemini
 * and the custom provider are in "More providers".
 */
export const NewComputer: Story = {
  args: {
    agentStatus: lazyProviderAgentStatus,
    customProviders: [],
  },
  render: (storyArgs) => <LazyProviderDownloadsFlow args={storyArgs} />,
};

/** The user is signed in to Gemini, so Gemini is the first row and Grok is in "More providers". */
export const SignedInToGemini: Story = {
  args: {
    agentStatus: geminiSignedInAgentStatus,
    customProviders: [],
  },
  render: (storyArgs) => <LazyProviderDownloadsFlow args={storyArgs} initialAgentStatus={geminiSignedInAgentStatus} />,
};

export const LazyProviderDownloadsWithFailure: Story = {
  args: {
    agentStatus: lazyProviderAgentStatus,
  },
  render: (storyArgs) => <LazyProviderDownloadsFlow args={storyArgs} failGrokOnce />,
};

/**
 * The whole step to press through: the rows connect after a short wait, OpenCode still downloads,
 * and the main button connects the selected provider and says so in a toast.
 */
export const Interactive: Story = {
  args: {
    agentStatus: downloadedAgentStatus,
  },
  render: (storyArgs) => <LazyProviderDownloadsFlow args={storyArgs} downloaded />,
};
