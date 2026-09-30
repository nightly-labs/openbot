import type { MessagingConnection, SlackWorkspace } from "@openbot/contracts/ipc";
import {
  SlackAddAgentDialog,
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

const WORKSPACE: SlackWorkspace = { workspaceId: "T0STORY", name: "Acme Inc." };

function agentId(index: number): string {
  const agent = AGENTS[index];
  if (!agent) throw new Error(`Story agent ${index} is missing.`);
  return agent.id;
}

function connection(index: number, update: Partial<MessagingConnection> = {}): MessagingConnection {
  return {
    agentId: agentId(index),
    platform: "slack",
    enabled: true,
    state: "connected",
    workspaceName: WORKSPACE.name,
    botUserId: "U0STORY",
    missingScopes: [],
    retryAt: null,
    credentials: "saved",
    ...update,
  };
}

const args = (connections: MessagingConnection[], workspaces: SlackWorkspace[] = [WORKSPACE], busy = false) => ({
  agents: AGENTS,
  connections,
  workspaces,
  busy,
  onConnectWorkspace: fn(),
  onDisconnectWorkspace: fn(),
  onCreateApp: fn(),
  onOpenInstall: fn(),
  onReconnect: fn(),
  onSetEnabled: fn(),
  onRemove: fn(),
});

/** No workspace yet: Connect Slack is the only step. */
export const NotSetUp: Story = { args: args([], []) };

export const WorkspaceOnly: Story = { args: args([]) };

export const Live: Story = { args: args([connection(0), connection(1)]) };

/** One agent waits for its install, one is paused, and one lost its token. */
export const Mixed: Story = {
  args: args([
    connection(0, { state: "awaiting_install", botUserId: null }),
    connection(1, { enabled: false, state: "paused" }),
    connection(2, { state: "invalid_token" }),
  ]),
};

export const MissingPermissions: Story = {
  args: args([connection(0, { state: "missing_scope", missingScopes: ["channels:join", "files:read"] })]),
};

type DialogStory = StoryObj<typeof SlackAddAgentDialog>;

const dialogArgs = (initialAgentId: string | null, connections: MessagingConnection[] = []) => ({
  open: true,
  initialAgentId,
  agents: AGENTS,
  connections: new Map(connections.map((entry) => [entry.agentId, entry])),
  workspace: WORKSPACE,
  busy: false,
  onCreate: fn(),
  onOpenInstall: fn(),
  onClose: fn(),
});

/** Step 1: agents already in Slack cannot be picked. */
export const AddPickAgent: DialogStory = {
  render: (props) => <SlackAddAgentDialog {...props} />,
  args: dialogArgs(null, [connection(0)]),
};

/** Step 2: an agent chosen on its row starts at the preview. */
export const AddPreview: DialogStory = {
  render: (props) => <SlackAddAgentDialog {...props} />,
  args: dialogArgs(agentId(1)),
};

export const AddWaitingForInstall: DialogStory = {
  render: (props) => <SlackAddAgentDialog {...props} />,
  args: dialogArgs(agentId(1), [connection(1, { state: "awaiting_install", botUserId: null })]),
};

export const AddDone: DialogStory = {
  render: (props) => <SlackAddAgentDialog {...props} />,
  args: dialogArgs(agentId(1), [connection(1)]),
};
