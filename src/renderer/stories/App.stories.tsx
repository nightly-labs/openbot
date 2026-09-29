import type { AgentEvent } from "@openbot/contracts/ipc";
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

/** Sets one stored layout value for the story, and puts the old value back when the story ends. */
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

export const AccountMenu: Story = {
  render: () => <SidebarStatePlayground compact={false} />,
};

/** The servers in the menu on the server name, instead of the rail. Click the server name to open it. */
export const ServerMenuView: Story = {
  render: () => <SidebarStatePlayground compact={false} serverView="menu" />,
};

export const CompactAccountMenu: Story = {
  render: () => <SidebarStatePlayground compact={true} />,
};

export const LinuxAccountMenu: Story = {
  render: () => (
    <SidebarStatePlayground compact={false} options={{ appInfo: { ...STORY_APP_INFO, platform: "linux" } }} />
  ),
};

export const LongAccountEmail: Story = {
  render: () => (
    <SidebarStatePlayground
      compact={false}
      options={{
        authState: {
          status: "signed_in",
          user: {
            id: "user-long-name",
            email: "norbert.bodziony.with.a.very.long.workspace.profile@example.com",
            name: "Norbert Bodziony",
            avatarUrl: null,
          },
        },
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

/**
 * The signed-out provider in the real shell. `sign-in-required` is the only input: the notice, the
 * model picker's label and the suppressed usage chip all read that one field.
 */
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

/** One agent for each wait: a question, a command approval and a browser takeover. */
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

/**
 * The "Needs you" group in the real shell. The waits arrive as agent events, so the sidebar reads
 * them through the same bridge as on desktop. Each subscriber gets them again, which is harmless:
 * a wait is kept per agent.
 */
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
