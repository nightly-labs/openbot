import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  AgentConnectedApps,
  BotPlatformPage,
  CONCEPT_AGENTS,
  DISCORD_ROWS,
  DiscordAddAgentPanel,
  HUB_ROWS,
  type HubRow,
  IntegrationsHub,
  ServerSettingsFrame,
  SLACK_ROWS,
  SlackAddAgentPanel,
} from "./integrations-concept";
import "./IntegrationsConcept.css";

const meta = {
  title: "Concepts/Integrations",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function row(id: string, overrides: Partial<HubRow> = {}): HubRow {
  const base = HUB_ROWS.find((item) => item.id === id);
  if (!base) throw new Error(`Hub row ${id} is missing.`);
  return { ...base, ...overrides };
}

const FIRST_RUN_ROWS: HubRow[] = [
  row("github", {
    status: "idle",
    summary: "Agents read code, open pull requests, and answer issues.",
    agents: undefined,
    action: "Connect",
  }),
  row("slack", {
    status: "idle",
    summary: "Give each agent its own Slack app.",
    agents: undefined,
    action: "Set up",
  }),
  row("discord"),
  row("mcp", {
    status: "idle",
    summary: "Tools from local programs and remote servers.",
    scope: undefined,
    action: "Add server",
  }),
];

const HUB_DESCRIPTION = "Connect agents on this computer to GitHub, Slack, Discord and MCP tools.";

export const Hub: Story = {
  name: "1. Hub",
  render: () => (
    <ServerSettingsFrame title="Integrations" description={HUB_DESCRIPTION}>
      <IntegrationsHub rows={HUB_ROWS} />
    </ServerSettingsFrame>
  ),
};

export const HubEmpty: Story = {
  name: "2. Hub: first run",
  render: () => (
    <ServerSettingsFrame title="Integrations" description={HUB_DESCRIPTION}>
      <IntegrationsHub firstRun rows={FIRST_RUN_ROWS} />
    </ServerSettingsFrame>
  ),
};

export const HubRemoteServer: Story = {
  name: "3. Hub: remote server",
  render: () => (
    <ServerSettingsFrame title="Integrations" description="Integrations of Nightly Labs, a server you joined.">
      <IntegrationsHub
        rows={[
          row("mcp", { summary: "linear, sentry · 11 tools" }),
          row("github", {
            status: "unavailable",
            summary: "Only on the computer that runs the server. Ask the owner.",
            agents: undefined,
          }),
          row("slack", {
            status: "unavailable",
            summary: "The owner of Nightly Labs manages Slack.",
            agents: undefined,
          }),
          row("discord", {
            status: "unavailable",
            summary: "The owner of Nightly Labs manages Discord.",
            action: undefined,
          }),
        ]}
      />
    </ServerSettingsFrame>
  ),
};

export const SlackAgents: Story = {
  name: "4. Slack: agents",
  render: () => (
    <ServerSettingsFrame title="Slack" parent="Integrations" description={HUB_DESCRIPTION}>
      <BotPlatformPage
        brand="slack"
        name="Slack"
        status="attention"
        subtitle="Each agent is its own Slack app, with its own name, picture and token."
        workspace={{ label: "Workspace", value: "Acme Inc.", detail: "acme.slack.com · connected by Norbert" }}
        rows={SLACK_ROWS}
        attention="Slack revoked the token of Support triage 2 hours ago. Messages in #support get no reply."
      />
    </ServerSettingsFrame>
  ),
};

export const SlackAddAgent: Story = {
  name: "5. Slack: add agent",
  render: () => (
    <main class="ic-canvas">
      <div class="ic-gallery">
        <SlackAddAgentPanel step={0} caption="1 · Pick an agent" />
        <SlackAddAgentPanel step={1} caption="2 · Preview in Slack" />
        <SlackAddAgentPanel step={2} caption="3 · Create the Slack app" />
        <SlackAddAgentPanel step={3} caption="4 · Install" />
        <SlackAddAgentPanel step={4} caption="5 · Channels and replies" />
      </div>
    </main>
  ),
};

export const DiscordAgents: Story = {
  name: "6. Discord: agents",
  render: () => (
    <ServerSettingsFrame title="Discord" parent="Integrations" description={HUB_DESCRIPTION}>
      <BotPlatformPage
        brand="discord"
        name="Discord"
        status="connected"
        subtitle="Each agent is its own Discord bot user, with its own name, picture and token."
        workspace={{ label: "Server", value: "Acme Community", detail: "2 agents joined · 1,240 members" }}
        rows={DISCORD_ROWS}
      />
    </ServerSettingsFrame>
  ),
};

export const DiscordAddAgent: Story = {
  name: "7. Discord: add agent",
  render: () => (
    <main class="ic-canvas">
      <div class="ic-gallery">
        <DiscordAddAgentPanel step={0} caption="1 · Application" />
        <DiscordAddAgentPanel step={1} caption="2 · Token" />
        <DiscordAddAgentPanel step={2} caption="3 · Invite" />
        <DiscordAddAgentPanel step={3} caption="4 · Channels" />
      </div>
    </main>
  ),
};

export const AgentApps: Story = {
  name: "8. Agent settings: connected apps",
  render: () => {
    const agent = CONCEPT_AGENTS[1];
    if (!agent) throw new Error("Concept agent Research is missing.");
    return (
      <main class="ic-canvas">
        <AgentConnectedApps agent={agent} />
      </main>
    );
  },
};
