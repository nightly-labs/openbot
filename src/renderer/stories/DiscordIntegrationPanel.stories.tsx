import { MESSAGING_LIMITS, type MessagingConnection, type MessagingRole } from "@openbot/contracts/ipc";
import {
  type DiscordAccessControl,
  SlackConnectDialog,
  type SlackIntegrationAgent,
  SlackIntegrationPanel,
} from "@openbot/ui/features/settings/SlackIntegrationPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_SUMMARIES } from "./fixtures";
import { SettledArgs } from "./settled-args";

const meta = {
  title: "Settings/DiscordIntegrationPanel",
  component: SlackIntegrationPanel,
  parameters: { layout: "padded", a11y: { test: "error" } },
  render: (args) => <SettledArgs>{() => <SlackIntegrationPanel {...args} />}</SettledArgs>,
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

const SECOND_ORCHESTRATOR: SlackIntegrationAgent = {
  ...ORCHESTRATOR,
  id: "agent-discord-orchestrator-2",
  name: "Discord Orchestrator 2",
  avatarSeed: "discord-orchestrator-2",
};

const ROLES: MessagingRole[] = [
  { id: "200000000000000001", name: "Admin" },
  { id: "200000000000000002", name: "Moderator" },
  { id: "200000000000000003", name: "Member" },
];

const SECOND_GUILD: Partial<MessagingConnection> = {
  workspaceId: "100000000000000003",
  workspaceName: "Acme Support",
};

const args = (connections: MessagingConnection[], busy = false) => ({
  platform: "discord" as const,
  agents: [ORCHESTRATOR, SECOND_ORCHESTRATOR, ...AGENTS],
  connections,
  busy,
  onConnectWorkspace: fn(),
  onDisconnectWorkspace: fn(),
  onDisconnectAll: fn(),
  onReconnect: fn(),
  onSetEnabled: fn(),
  onAddOrchestrator: fn(),
});

function access(allowed: MessagingRole[], unsupported = false): DiscordAccessControl {
  return {
    allowed: () => allowed,
    loadRoles: fn(async () => ROLES),
    onSave: fn(),
    unsupported,
  };
}

export const NotSetUp: Story = { args: args([]) };

export const Connected: Story = { args: args([guild()]) };

export const NoOrchestrator: Story = { args: args([guild({ orchestratorAgentId: null })]) };

export const Paused: Story = { args: args([guild({ enabled: false, state: "paused" })]) };

export const Removed: Story = { args: args([guild({ state: "invalid_token" })]) };

export const RelayUnavailable: Story = { args: args([guild({ state: "relay_unavailable" })]) };

export const TwoServers: Story = { args: args([guild(), guild(SECOND_GUILD)]) };

export const EarlierBuildTwoOrchestrators: Story = {
  args: args([guild(), guild({ ...SECOND_GUILD, orchestratorAgentId: SECOND_ORCHESTRATOR.id })]),
};

export const TwoServersAccess: Story = {
  args: { ...args([guild(), guild(SECOND_GUILD)]), access: access(ROLES.slice(0, 1)) },
};

export const SecondServerNoOrchestrator: Story = {
  args: args([guild(), guild({ ...SECOND_GUILD, orchestratorAgentId: null })]),
};

export const AtLimit: Story = {
  args: args(
    Array.from({ length: MESSAGING_LIMITS.connections }, (_, index) =>
      guild({ workspaceId: String(100000000000000001n + BigInt(index * 2)), workspaceName: `Community ${index + 1}` }),
    ),
  ),
};

export const DiscordAccessEveryone: Story = { args: { ...args([guild()]), access: access([]) } };

export const DiscordAccessRoles: Story = { args: { ...args([guild()]), access: access(ROLES.slice(0, 2)) } };

export const DiscordAccessUnsupported: Story = {
  args: { ...args([guild()]), hostName: "Studio Mac", access: access([], true) },
};

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

export const ConnectGuild: DialogStory = {
  render: (props) => <SlackConnectDialog {...props} />,
  args: dialogArgs(null),
};

export const AddOrchestrator: DialogStory = {
  render: (props) => <SlackConnectDialog {...props} />,
  args: dialogArgs(guild({ orchestratorAgentId: null })),
};

export const ConnectDone: DialogStory = {
  render: (props) => <SlackConnectDialog {...props} />,
  args: dialogArgs(guild()),
};
