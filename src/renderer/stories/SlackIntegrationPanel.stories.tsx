import type { MessagingConnection } from "@openbot/contracts/ipc";
import {
  SlackConnectDialog,
  type SlackIntegrationAgent,
  SlackIntegrationPanel,
} from "@openbot/ui/features/settings/SlackIntegrationPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_SUMMARIES } from "./fixtures";

const meta = {
  title: "Settings/SlackIntegrationPanel",
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

const args = (connections: MessagingConnection[], busy = false) => ({
  agents: [ORCHESTRATOR, ...AGENTS],
  connections,
  busy,
  onConnectWorkspace: fn(),
  onDisconnectWorkspace: fn(),
  onReconnect: fn(),
  onSetEnabled: fn(),
  onAddOrchestrator: fn(),
});

/** No workspace yet: Connect Slack opens the dialog. */
export const NotSetUp: Story = { args: args([]) };

/** The workspace is connected, and the Slack Orchestrator answers. */
export const Connected: Story = { args: args([workspace()]) };

/** The workspace is connected, and no agent answers yet. */
export const NoOrchestrator: Story = { args: args([workspace({ orchestratorAgentId: null })]) };

export const Paused: Story = { args: args([workspace({ enabled: false, state: "paused" })]) };

export const Uninstalled: Story = { args: args([workspace({ state: "invalid_token" })]) };

export const MissingPermissions: Story = {
  args: args([workspace({ state: "missing_scope", missingScopes: ["files:read"] })]),
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

/** Step 1: Slack's install page opens in the browser. */
export const ConnectWorkspace: DialogStory = {
  render: (props) => <SlackConnectDialog {...props} />,
  args: dialogArgs(null),
};

/** Step 2: the workspace is connected, and the Slack Orchestrator is added next. */
export const AddOrchestrator: DialogStory = {
  render: (props) => <SlackConnectDialog {...props} />,
  args: dialogArgs(workspace({ orchestratorAgentId: null })),
};

/** Done: how OpenBot looks in Slack. */
export const ConnectDone: DialogStory = {
  render: (props) => <SlackConnectDialog {...props} />,
  args: dialogArgs(workspace()),
};
