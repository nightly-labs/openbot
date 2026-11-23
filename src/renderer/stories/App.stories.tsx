import type { AgentEvent, WorkflowNode } from "@openbot/contracts/ipc";
import type { ServerView } from "@openbot/ui/features/servers/ServerMenu";
import { onCleanup } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { App } from "../src/App";
import { LEFT_PANEL_COLLAPSED_STORAGE_KEY, SERVER_VIEW_STORAGE_KEY } from "../src/layout-constants";
import { createMockOpenBot, type MockOpenBotOptions } from "../src/preview/mock-openbot";
import { OpenBotPlayground } from "../src/preview/OpenBotPlayground";
import { STORY_AGENT_STATUS, STORY_AGENT_SUMMARIES, STORY_APP_INFO, STORY_SERVERS } from "./fixtures";

const [storyLocalServer, storyRemoteServer] = STORY_SERVERS;
if (!storyLocalServer || !storyRemoteServer) throw new Error("Story server fixtures need a local and a remote server.");

const meta = {
  title: "App",
  component: App,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

function useStoredLayoutValue(key: string, value: string): void {
  const previous = window.localStorage.getItem(key);
  window.localStorage.setItem(key, value);
  onCleanup(() => {
    if (previous === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, previous);
  });
}

function SidebarStatePlayground(props: { compact: boolean; serverView?: ServerView; options?: MockOpenBotOptions }) {
  useStoredLayoutValue(LEFT_PANEL_COLLAPSED_STORAGE_KEY, props.compact ? "true" : "false");
  if (props.serverView) useStoredLayoutValue(SERVER_VIEW_STORAGE_KEY, props.serverView);
  return <OpenBotPlayground options={props.options} />;
}

export const Playground: Story = {
  render: () => <OpenBotPlayground />,
};

export const ExpandedSidebar: Story = {
  render: () => <SidebarStatePlayground compact={false} />,
};

export const ServerRailView: Story = {
  render: () => <SidebarStatePlayground compact={false} serverView="rail" />,
};

const SLOW_REMOTE_LOAD_MS = 15_000;

function SlowRemotePlayground() {
  useStoredLayoutValue(LEFT_PANEL_COLLAPSED_STORAGE_KEY, "false");
  useStoredLayoutValue(SERVER_VIEW_STORAGE_KEY, "rail");
  return (
    <OpenBotPlayground
      dependencies={{
        createMock: (options) => {
          const mock = createMockOpenBot(options);
          const listAgents = mock.api.agent.listAgents;
          mock.api.agent.listAgents = async (serverId) => {
            if (serverId === storyRemoteServer?.id)
              await new Promise((resolve) => setTimeout(resolve, SLOW_REMOTE_LOAD_MS));
            return listAgents(serverId);
          };
          return mock;
        },
        renderApp: () => <App />,
      }}
    />
  );
}

export const SlowRemoteServer: Story = {
  render: () => <SlowRemotePlayground />,
};

export const CompactSidebar: Story = {
  render: () => <SidebarStatePlayground compact={true} />,
};

export const LinuxWindow: Story = {
  render: () => (
    <SidebarStatePlayground compact={false} options={{ appInfo: { ...STORY_APP_INFO, platform: "linux" } }} />
  ),
};

function mediaStep(id: string, column: number, fields: WorkflowNode["fields"]): WorkflowNode {
  return { kind: "image", id, at: { x: column * 460, y: 0 }, fields };
}

export const CanvasMediaSteps: Story = {
  render: () => (
    <SidebarStatePlayground
      compact={false}
      options={{
        workflows: [
          {
            id: "launch-media",
            title: "Launch media",
            graph: {
              nodes: [
                mediaStep("poster", 0, {
                  media: "image",
                  model: "higgsfield-gpt_image_2_6",
                  prompt: "The product box on a white table, soft light, no text",
                  aspect: "4:3",
                }),
                mediaStep("teaser", 1, {
                  media: "video",
                  model: "higgsfield-seedance_2_0",
                  prompt: "A slow push-in on the product window at dusk, soft city sounds",
                  aspect: "21:9",
                  duration: 7,
                  resolution: "720p",
                }),
                mediaStep("clip", 2, {
                  media: "video",
                  model: "sunra-veo-3.1",
                  prompt: "A hand opens the box; the camera follows the lid",
                  aspect: "16:9",
                }),
                mediaStep("unboxing", 3, {
                  media: "video",
                  model: "higgsfield-kling4_0",
                  prompt: "The product turns slowly on a stand; the light moves across it",
                  aspect: "16:9",
                  duration: 12,
                }),
                mediaStep("banner", 4, {
                  media: "image",
                  model: "sunra-nano-banana-pro",
                  prompt: "A wide banner of the product on a city street at night",
                  aspect: "16:9",
                }),
              ],
              edges: [
                { id: "poster>teaser:image", from: "poster", to: "teaser", type: "image" },
                { id: "clip>unboxing:file", from: "clip", to: "unboxing", type: "file" },
              ],
              strokes: [],
            },
          },
        ],
      }}
    />
  ),
};

export const EmptyWorkspace: Story = {
  render: () => (
    <OpenBotPlayground
      options={{
        agents: [],
        servers: STORY_SERVERS.filter((server) => server.kind === "local"),
        presence: { serverId: "local", updatedAt: "2026-08-24T12:00:00.000Z", members: [] },
        directThreads: [],
        teamMembers: [],
        browserTabs: [],
        remoteDesktopSessions: [],
      }}
    />
  ),
};

export const IncompatibleRemoteHost: Story = {
  render: () => (
    <OpenBotPlayground
      options={{
        servers: [
          { ...storyLocalServer, active: false },
          {
            ...storyRemoteServer,
            active: true,
            state: "incompatible",
            compatibility: {
              localAppVersion: "44.0.0",
              hostAppVersion: "42.0.0",
              localProtocol: { minimum: 2, maximum: 2 },
              hostProtocol: { minimum: 1, maximum: 1 },
              negotiatedProtocol: null,
              capabilities: [],
            },
            issue: {
              code: "host_update_required",
              message: "Update OpenBot on the host.",
              retryable: true,
            },
          },
        ],
      }}
    />
  ),
};

export const DifferentRemoteVersions: Story = {
  render: () => (
    <OpenBotPlayground
      options={{
        servers: [
          { ...storyLocalServer, active: false },
          {
            ...storyRemoteServer,
            active: true,
            compatibility: {
              localAppVersion: "44.0.0",
              hostAppVersion: "43.0.0",
              localProtocol: { minimum: 1, maximum: 1 },
              hostProtocol: { minimum: 1, maximum: 1 },
              negotiatedProtocol: 1,
              capabilities: [
                "agent-runtime-snapshots",
                "browser-control",
                "conversation-pagination",
                "direct-messages",
                "remote-desktop",
                "sidebar-layout",
              ],
            },
            connectionSequence: 1,
          },
        ],
      }}
    />
  ),
};

export const RemoteHostUpdate: Story = {
  render: () => (
    <OpenBotPlayground
      options={{
        servers: [
          storyLocalServer,
          {
            ...storyRemoteServer,
            active: false,
            compatibility: {
              localAppVersion: "0.24.0",
              hostAppVersion: "0.23.0",
              localProtocol: { minimum: 1, maximum: 1 },
              hostProtocol: { minimum: 1, maximum: 1 },
              negotiatedProtocol: 1,
              capabilities: ["host-admin-v1", "host-update-v1", "host-release-v1", "sidebar-layout"],
            },
            connectionSequence: 1,
          },
        ],
      }}
    />
  ),
};

export const Onboarding: Story = {
  render: () => (
    <OpenBotPlayground options={{ setupState: { completed: false, preferredProvider: null, preferredModel: null } }} />
  ),
};

export const SignedOut: Story = {
  render: () => <OpenBotPlayground options={{ authState: { status: "signed_out" } }} />,
};

export const AgentStarting: Story = {
  render: () => (
    <OpenBotPlayground
      options={{
        agentStatus: {
          ...STORY_AGENT_STATUS,
          phase: "starting",
          message: "Starting local agent CLIs…",
        },
        agents: STORY_AGENT_SUMMARIES.slice(0, 1),
      }}
    />
  ),
};

export const ProviderSignInRequired: Story = {
  render: () => (
    <OpenBotPlayground
      options={{
        agentStatus: {
          ...STORY_AGENT_STATUS,
          auth: { kind: "signed-out" },
          providers: STORY_AGENT_STATUS.providers?.map((provider) =>
            provider.id === "codex"
              ? {
                  ...provider,
                  state: "sign-in-required" as const,
                  email: null,
                  message: "Connect ChatGPT to continue.",
                }
              : provider,
          ),
        },
      }}
    />
  ),
};

const STORY_WAITING_EVENTS: AgentEvent[] = [
  {
    type: "prompt",
    requestId: "story-question",
    agentId: "research",
    threadId: "thread-research",
    turnId: "turn-research-wait",
    questions: [
      {
        id: "region",
        header: "Region",
        question: "Which region should we launch in first?",
        isSecret: false,
        options: [
          { label: "EU", description: "Start with the EU store." },
          { label: "US", description: "Start with the US store." },
        ],
      },
    ],
  },
  {
    type: "approval",
    approval: {
      requestId: "story-approval",
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-chief-wait",
      kind: "command",
      command: "bun run release:publish",
      cwd: null,
      reason: null,
      grantRoot: null,
      permissions: null,
    },
  },
  {
    type: "browser-takeover-requested",
    request: {
      requestId: "story-takeover",
      agentId: "sales",
      threadId: "thread-sales",
      turnId: "turn-sales-wait",
      tabId: "story-tab",
    },
  },
];

function WaitingForInputPlayground(props: { compact: boolean }) {
  useStoredLayoutValue(LEFT_PANEL_COLLAPSED_STORAGE_KEY, props.compact ? "true" : "false");
  return (
    <OpenBotPlayground
      dependencies={{
        createMock: (options) => {
          const mock = createMockOpenBot(options);
          const subscribe = mock.api.agent.onEvent;
          mock.api.agent.onEvent = (listener) => {
            const unsubscribe = subscribe(listener);
            queueMicrotask(() => {
              for (const event of STORY_WAITING_EVENTS) mock.emitAgentEvent(event);
            });
            return unsubscribe;
          };
          return mock;
        },
        renderApp: () => <App />,
      }}
    />
  );
}

export const AgentsWaitingForInput: Story = {
  render: () => <WaitingForInputPlayground compact={false} />,
};

export const CompactAgentsWaitingForInput: Story = {
  render: () => <WaitingForInputPlayground compact />,
};

function paywallServers(role: "owner" | "member"): MockOpenBotOptions {
  if (!storyLocalServer || !storyRemoteServer) return {};
  return {
    servers: [
      { ...storyLocalServer, active: false },
      {
        ...storyRemoteServer,
        active: true,
        role,
        paymentRequired: true,
        ...(role === "owner"
          ? {
              customPlan: {
                name: "Business",
                amount: 89_000,
                currency: "eur",
                interval: "month",
                vcpu: 16,
                memoryGb: 64,
                storageGb: 500,
                personalizedSupport: true,
              },
            }
          : {}),
      },
    ],
    agents: [],
  };
}

export const CustomServerPaywall: Story = {
  render: () => <SidebarStatePlayground compact={false} serverView="menu" options={paywallServers("owner")} />,
};

export const CustomServerPaywallMember: Story = {
  render: () => <SidebarStatePlayground compact={false} serverView="menu" options={paywallServers("member")} />,
};
