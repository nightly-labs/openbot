import type { MessagingConnection } from "@openbot/contracts/ipc";
import {
  TelegramConnectDialog,
  type TelegramIntegrationAgent,
  TelegramIntegrationPanel,
} from "@openbot/ui/features/settings/TelegramIntegrationPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_SUMMARIES } from "./fixtures";
import { SettledArgs } from "./settled-args";

const meta = {
  title: "Settings/TelegramIntegrationPanel",
  component: TelegramIntegrationPanel,
  parameters: { layout: "padded", a11y: { test: "error" } },
  render: (args) => <SettledArgs>{() => <TelegramIntegrationPanel {...args} />}</SettledArgs>,
} satisfies Meta<typeof TelegramIntegrationPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const AGENTS: TelegramIntegrationAgent[] = STORY_AGENT_SUMMARIES.map((agent) => ({
  id: agent.id,
  name: agent.name,
  title: agent.title,
  avatarSeed: agent.avatarSeed,
  avatarHue: agent.avatarHue,
  avatarUrl: null,
}));

const ORCHESTRATOR: TelegramIntegrationAgent = {
  id: "agent-telegram-orchestrator",
  name: "Telegram Orchestrator",
  title: "Answers in Telegram and asks the team",
  avatarSeed: "telegram-orchestrator",
  avatarHue: 215,
  avatarUrl: null,
};

function chat(update: Partial<MessagingConnection> = {}): MessagingConnection {
  return {
    workspaceId: "-1001234567890",
    platform: "telegram",
    enabled: true,
    state: "connected",
    workspaceName: "Acme team",
    botUserId: "7000000000",
    missingScopes: [],
    retryAt: null,
    credentials: "saved",
    orchestratorAgentId: ORCHESTRATOR.id,
    ...update,
  };
}

const DIRECT = chat({ workspaceId: "123456789", workspaceName: "Ada Lovelace" });

const args = (connections: MessagingConnection[], busy = false) => ({
  agents: [ORCHESTRATOR, ...AGENTS],
  connections,
  busy,
  onConnectChat: fn(async () => true),
  onDisconnectChat: fn(),
  onDisconnectAll: fn(),
  onReconnect: fn(),
  onSetEnabled: fn(),
  onAddOrchestrator: fn(),
});

/** No chat yet: Connect Telegram opens the dialog. */
export const NotSetUp: Story = { args: args([]) };

/** A group and a direct chat are linked, and the Telegram Orchestrator answers both. Link a chat opens the dialog. */
export const Connected: Story = { args: args([chat(), DIRECT]) };

/** A chat is linked, and no agent answers yet. */
export const NoOrchestrator: Story = { args: args([chat({ orchestratorAgentId: null })]) };

export const Paused: Story = { args: args([chat({ enabled: false, state: "paused" }), DIRECT]) };

/** The bot is no longer in the group. */
export const Removed: Story = { args: args([chat({ state: "removed" }), DIRECT]) };

export const RelayUnavailable: Story = { args: args([chat({ state: "relay_unavailable" })]) };

export const RateLimited: Story = {
  args: args([chat({ state: "rate_limited", retryAt: "2026-10-06T14:30:00.000Z" })]),
};

type DialogStory = StoryObj<typeof TelegramConnectDialog>;

const dialogArgs = (connections: MessagingConnection[], start: "chat" | "agent") => ({
  open: true,
  start,
  connections,
  agents: [ORCHESTRATOR, ...AGENTS],
  busy: false,
  onConnectChat: fn(async () => true),
  onAddOrchestrator: fn(),
  onClose: fn(),
});

/** Step 1: Telegram opens in the browser, to add the bot to a group or to a direct chat. */
export const LinkChat: DialogStory = {
  render: (props) => <TelegramConnectDialog {...props} />,
  args: dialogArgs([], "chat"),
};

/** Link a chat on a page that has chats: the dialog waits for a new chat. */
export const LinkAnotherChat: DialogStory = {
  render: (props) => <TelegramConnectDialog {...props} />,
  args: dialogArgs([chat(), DIRECT], "chat"),
};

/** Step 2: the chat is linked, and the Telegram Orchestrator is added next. */
export const AddOrchestrator: DialogStory = {
  render: (props) => <TelegramConnectDialog {...props} />,
  args: dialogArgs([chat({ orchestratorAgentId: null })], "agent"),
};

/** Done: the chat has the Telegram Orchestrator. */
export const ConnectDone: DialogStory = {
  render: (props) => <TelegramConnectDialog {...props} />,
  args: dialogArgs([chat()], "agent"),
};
