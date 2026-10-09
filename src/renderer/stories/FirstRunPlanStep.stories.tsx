import type { AgentStatus } from "@openbot/contracts/ipc";
import type { ProviderDetection } from "@openbot/ui/features/custom-providers/detected-providers";
import { createSignal, onSettled, Show } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { FirstRunPlanStep } from "../src/features/onboarding/FirstRunPlanStep";
import { createSetupProviders, type SetupProviderProps } from "../src/features/onboarding/SetupProviderPicker";
import { createFakeCodeLogin } from "./code-login-fixture";
import { createStoryDetection, STORY_DETECTED_PROVIDERS } from "./detected-providers-fixture";
import { STORY_AGENT_STATUS } from "./fixtures";
import {
  FakeProviderDownloads,
  lazyProviderAgentStatus,
  lazyProviders,
  MockedOnboardingApi,
  noProvidersConnectedAgentStatus,
} from "./onboarding-fixture";

/** OpenCode installed with no account of its own: enough to run an endpoint that brings its own key. */
const openCodeInstalledAgentStatus: AgentStatus = {
  ...STORY_AGENT_STATUS,
  providers: [
    ...(STORY_AGENT_STATUS.providers ?? []),
    { id: "opencode", state: "sign-in-required", version: "1.18.27", message: null },
  ],
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

/** Gemini is downloaded and signed in. The others are not downloaded yet. */
const geminiSignedInAgentStatus: AgentStatus = {
  ...lazyProviderAgentStatus,
  providers: lazyProviders.map((provider) =>
    provider.id === "antigravity"
      ? { ...provider, state: "available", version: "1.2.1", email: "ada@example.com" }
      : provider,
  ),
};

/**
 * The plan step as first run shows it after "Use your … plan". The flow itself opens on the first
 * question, so these stories show the step alone.
 */
function PlanStep(props: SetupProviderProps) {
  const providers = createSetupProviders(props, undefined, { includeFree: () => false });
  const [screen, setScreen] = createSignal<HTMLElement | undefined>();
  return (
    <main class="onboarding-screen first-run-screen" data-step="plan" ref={(element) => setScreen(element)}>
      <div class="onboarding-shell">
        <FirstRunPlanStep providers={providers} disabled={false} menuMount={screen()} />
        <Show when={providers.error()}>
          <p class="onboarding-error" role="alert">
            {providers.error()}
          </p>
        </Show>
      </div>
    </main>
  );
}

function MockedPlanStep(props: { args: SetupProviderProps }) {
  return (
    <MockedOnboardingApi>
      <PlanStep {...props.args} />
    </MockedOnboardingApi>
  );
}

function RefreshResettingPlanStep(props: { args: SetupProviderProps }) {
  const [agentStatus, setAgentStatus] = createSignal(bothConnectingAgentStatus);
  const [refreshingProviders, setRefreshingProviders] = createSignal(false);
  return (
    <MockedPlanStep
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

function LazyProviderDownloadsPlanStep(props: {
  args: SetupProviderProps;
  failGrokOnce?: boolean;
  initialAgentStatus?: AgentStatus;
}) {
  return (
    <FakeProviderDownloads
      failGrokOnce={props.failGrokOnce}
      initialAgentStatus={props.initialAgentStatus}
      render={(fake) => <MockedPlanStep args={{ ...props.args, ...fake }} />}
    />
  );
}

/** The provider step with a fake scan. `scan` starts one when the story opens, as first run would. */
function DetectingPlanStep(props: { args: SetupProviderProps; initial: ProviderDetection; scan?: boolean }) {
  const story = createStoryDetection(props.initial);
  onSettled(() => {
    if (props.scan) story.scan();
  });
  return (
    <MockedPlanStep
      args={{
        ...props.args,
        providerDetection: story.detection(),
        detectedProviderApi: story.api,
      }}
    />
  );
}

const args: SetupProviderProps = {
  agentStatus: STORY_AGENT_STATUS,
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
  title: "Setup/FirstRunPlanStep",
  component: PlanStep,
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
  render: (storyArgs) => <MockedPlanStep args={storyArgs} />,
} satisfies Meta<typeof PlanStep>;

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

/**
 * First run looks for local model servers and ACP agents while the user reads the list. Rows appear
 * one by one; the provider rows above them do not move.
 */
export const DetectingLocalProviders: Story = {
  args: { agentStatus: openCodeInstalledAgentStatus },
  render: (storyArgs) => <DetectingPlanStep args={storyArgs} initial={{ scanning: true, found: [] }} scan />,
};

/**
 * The scan is done. Add opens the form of its kind, filled from the scan: the endpoint form for a
 * server, the ACP agent form for an agent. X hides a row that the user does not want.
 */
export const DetectedLocalProviders: Story = {
  args: { agentStatus: openCodeInstalledAgentStatus },
  render: (storyArgs) => (
    <DetectingPlanStep args={storyArgs} initial={{ scanning: false, found: STORY_DETECTED_PROVIDERS }} />
  ),
};

/** The same result on a narrow window. */
export const DetectedLocalProvidersNarrow: Story = {
  ...DetectedLocalProviders,
  globals: { viewport: "onboardingNarrow" },
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
  render: (storyArgs) => <RefreshResettingPlanStep args={storyArgs} />,
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
  render: (storyArgs) => <LazyProviderDownloadsPlanStep args={storyArgs} />,
};

/**
 * A new computer with no saved endpoint. The list shows ChatGPT, Claude and Grok. Gemini, OpenCode
 * and the custom provider are in "More providers".
 */
export const NewComputer: Story = {
  args: {
    agentStatus: lazyProviderAgentStatus,
    customProviders: [],
  },
  render: (storyArgs) => <LazyProviderDownloadsPlanStep args={storyArgs} />,
};

/** The user is signed in to Gemini, so Gemini is the first row and Grok is in "More providers". */
export const SignedInToGemini: Story = {
  args: {
    agentStatus: geminiSignedInAgentStatus,
    customProviders: [],
  },
  render: (storyArgs) => (
    <LazyProviderDownloadsPlanStep args={storyArgs} initialAgentStatus={geminiSignedInAgentStatus} />
  ),
};

export const LazyProviderDownloadsWithFailure: Story = {
  args: {
    agentStatus: lazyProviderAgentStatus,
  },
  render: (storyArgs) => <LazyProviderDownloadsPlanStep args={storyArgs} failGrokOnce />,
};
