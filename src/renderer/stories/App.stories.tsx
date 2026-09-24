import { onCleanup } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { App } from "../src/App";
import type { MockOpenBotOptions } from "../src/preview/mock-openbot";
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

function SidebarStatePlayground(props: { compact: boolean; options?: MockOpenBotOptions }) {
  const key = "openbot:left-panel-collapsed";
  const previous = window.localStorage.getItem(key);
  window.localStorage.setItem(key, props.compact ? "true" : "false");
  onCleanup(() => {
    if (previous === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, previous);
  });
  return <OpenBotPlayground options={props.options} />;
}

export const Playground: Story = {
  render: () => <OpenBotPlayground />,
};

export const AccountMenu: Story = {
  render: () => <SidebarStatePlayground compact={false} />,
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
