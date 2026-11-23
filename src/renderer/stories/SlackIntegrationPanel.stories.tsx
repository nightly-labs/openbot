import { MESSAGING_LIMITS, type MessagingConnection } from "@openbot/contracts/ipc";
import {
  SlackConnectDialog,
  type SlackIntegrationAgent,
  SlackIntegrationPanel,
} from "@openbot/ui/features/settings/SlackIntegrationPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_SUMMARIES } from "./fixtures";
import { SettledArgs } from "./settled-args";

const meta = {
  title: "Settings/SlackIntegrationPanel",
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
  id: "agent-slack-orchestrator",
  name: "Slack Orchestrator",
  title: "Answers in Slack and asks the team",
  avatarSeed: "slack-orchestrator",
  avatarHue: 280,
  avatarUrl: null,
};

function workspace(update: Partial<MessagingConnection> = {}): MessagingConnection {
  return {
    workspaceId: "T0STORY",
    platform: "slack",
    enabled: true,
    state: "connected",
    workspaceName: "Acme Inc.",
    botUserId: "U0STORY",
    missingScopes: [],
    retryAt: null,
    credentials: "saved",
    orchestratorAgentId: ORCHESTRATOR.id,
    ...update,
  };
}

const SECOND_ORCHESTRATOR: SlackIntegrationAgent = {
  ...ORCHESTRATOR,
  id: "agent-slack-orchestrator-2",
  name: "Slack Orchestrator 2",
  avatarSeed: "slack-orchestrator-2",
};

const SECOND_WORKSPACE: Partial<MessagingConnection> = {
  workspaceId: "T0STORY2",
  workspaceName: "Acme Labs",
};

const args = (connections: MessagingConnection[], busy = false) => ({
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

export const NotSetUp: Story = { args: args([]) };

export const Connected: Story = { args: args([workspace()]) };

export const NoOrchestrator: Story = { args: args([workspace({ orchestratorAgentId: null })]) };

export const Paused: Story = { args: args([workspace({ enabled: false, state: "paused" })]) };

export const Uninstalled: Story = { args: args([workspace({ state: "invalid_token" })]) };

export const NotLinked: Story = { args: args([workspace({ state: "not_linked" })]) };

export const MissingPermissions: Story = {
  args: args([workspace({ state: "missing_scope", missingScopes: ["files:read"] })]),
};

export const TwoServers: Story = { args: args([workspace(), workspace(SECOND_WORKSPACE)]) };

export const EarlierBuildTwoOrchestrators: Story = {
  args: args([workspace(), workspace({ ...SECOND_WORKSPACE, orchestratorAgentId: SECOND_ORCHESTRATOR.id })]),
};

export const SecondServerNoOrchestrator: Story = {
  args: args([workspace(), workspace({ ...SECOND_WORKSPACE, orchestratorAgentId: null })]),
};

export const AtLimit: Story = {
  args: args(
    Array.from({ length: MESSAGING_LIMITS.connections }, (_, index) =>
      workspace({ workspaceId: `T0STORY${index + 1}`, workspaceName: `Acme ${index + 1}` }),
    ),
  ),
};

type DialogStory = StoryObj<typeof SlackConnectDialog>;

const dialogArgs = (connection: MessagingConnection | null) => ({
  open: true,
  connection,
  agents: [ORCHESTRATOR, ...AGENTS],
  busy: false,
  onConnectWorkspace: fn(),
  onAddOrchestrator: fn(),
  onClose: fn(),
});

export const ConnectWorkspace: DialogStory = {
  render: (props) => <SlackConnectDialog {...props} />,
  args: dialogArgs(null),
};

export const AddOrchestrator: DialogStory = {
  render: (props) => <SlackConnectDialog {...props} />,
  args: dialogArgs(workspace({ orchestratorAgentId: null })),
};

export const ConnectDone: DialogStory = {
  render: (props) => <SlackConnectDialog {...props} />,
  args: dialogArgs(workspace()),
};
