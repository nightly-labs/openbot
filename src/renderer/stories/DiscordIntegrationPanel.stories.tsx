import type { MessagingConnection } from "@openbot/contracts/ipc";
import {
  SlackConnectDialog,
  type SlackIntegrationAgent,
  SlackIntegrationPanel,
} from "@openbot/ui/features/settings/SlackIntegrationPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_SUMMARIES } from "./fixtures";

/** Server settings > Connectors > Discord: the Slack page with `platform` "discord". */
const meta = {
  title: "Settings/DiscordIntegrationPanel",
  component: SlackIntegrationPanel,
  parameters: { layout: "padded", a11y: { test: "error" } },
} satisfies Meta<typeof SlackIntegrationPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const AGENTS: SlackIntegrationAgent[] = STORY_AGENT_SUMMARIES.map((agent) => ({
  id: agent.id,
  name: agent.name,
  title: agent.title,
  avatarSeed: agent.avatarSeed,
  avatarHue: agent.avatarHue,
  avatarUrl: null,
}));

const ORCHESTRATOR: SlackIntegrationAgent = {
  id: "agent-discord-orchestrator",
  name: "Discord Orchestrator",
  title: "Answers in Discord and asks the team",
  avatarSeed: "discord-orchestrator",
  avatarHue: 245,
  avatarUrl: null,
};

function guild(update: Partial<MessagingConnection> = {}): MessagingConnection {
  return {
    workspaceId: "100000000000000001",
    platform: "discord",
    enabled: true,
    state: "connected",
    workspaceName: "Acme Community",
    botUserId: "100000000000000002",
    missingScopes: [],
    retryAt: null,
    credentials: "saved",
    orchestratorAgentId: ORCHESTRATOR.id,
    ...update,
  };
}

const args = (connections: MessagingConnection[], busy = false) => ({
  platform: "discord" as const,
  agents: [ORCHESTRATOR, ...AGENTS],
  connections,
  busy,
  onConnectWorkspace: fn(),
  onDisconnectWorkspace: fn(),
  onReconnect: fn(),
  onSetEnabled: fn(),
  onAddOrchestrator: fn(),
});

/** No Discord server yet: Connect Discord opens the dialog. */
export const NotSetUp: Story = { args: args([]) };

/** The Discord server is connected, and the Discord Orchestrator answers. */
export const Connected: Story = { args: args([guild()]) };

/** The Discord server is connected, and no agent answers yet. */
export const NoOrchestrator: Story = { args: args([guild({ orchestratorAgentId: null })]) };

export const Paused: Story = { args: args([guild({ enabled: false, state: "paused" })]) };

export const Removed: Story = { args: args([guild({ state: "invalid_token" })]) };

export const RelayUnavailable: Story = { args: args([guild({ state: "relay_unavailable" })]) };

type DialogStory = StoryObj<typeof SlackConnectDialog>;

const dialogArgs = (connection: MessagingConnection | null) => ({
  platform: "discord" as const,
  open: true,
  connection,
  agents: [ORCHESTRATOR, ...AGENTS],
  busy: false,
  onConnectWorkspace: fn(),
  onAddOrchestrator: fn(),
  onClose: fn(),
});

/** Step 1: Discord's authorization page opens in the browser. */
export const ConnectGuild: DialogStory = {
  render: (props) => <SlackConnectDialog {...props} />,
  args: dialogArgs(null),
};

/** Step 2: the Discord server is connected, and the Discord Orchestrator is added next. */
export const AddOrchestrator: DialogStory = {
  render: (props) => <SlackConnectDialog {...props} />,
  args: dialogArgs(guild({ orchestratorAgentId: null })),
};

/** Done: the Discord server has its Discord Orchestrator. */
export const ConnectDone: DialogStory = {
  render: (props) => <SlackConnectDialog {...props} />,
  args: dialogArgs(guild()),
};
