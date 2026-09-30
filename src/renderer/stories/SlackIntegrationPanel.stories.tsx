import type { MessagingConnection } from "@openbot/contracts/ipc";
import { type SlackIntegrationAgent, SlackIntegrationPanel } from "@openbot/ui/features/settings/SlackIntegrationPanel";
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

function agentId(index: number): string {
  const agent = AGENTS[index];
  if (!agent) throw new Error(`Story agent ${index} is missing.`);
  return agent.id;
}

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
    routerAgentId: null,
    agentIds: [],
    ...update,
  };
}

const args = (connections: MessagingConnection[], busy = false) => ({
  agents: AGENTS,
  connections,
  busy,
  onConnectWorkspace: fn(),
  onDisconnectWorkspace: fn(),
  onReconnect: fn(),
  onSetEnabled: fn(),
  onSetRouting: fn(),
});

/** No workspace yet: Connect Slack is the only step. */
export const NotSetUp: Story = { args: args([]) };

/** Every agent can answer, and the first one routes. */
export const Connected: Story = { args: args([workspace()]) };

/** A chosen router, and two agents that can answer. */
export const ChosenAgents: Story = {
  args: args([workspace({ routerAgentId: agentId(1), agentIds: [agentId(0), agentId(1)] })]),
};

export const Paused: Story = { args: args([workspace({ enabled: false, state: "paused" })]) };

export const Uninstalled: Story = { args: args([workspace({ state: "invalid_token" })]) };

export const MissingPermissions: Story = {
  args: args([workspace({ state: "missing_scope", missingScopes: ["files:read"] })]),
};
