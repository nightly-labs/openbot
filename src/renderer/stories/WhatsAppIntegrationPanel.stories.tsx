import type { MessagingConnection, WhatsAppAccount, WhatsAppLinkState } from "@openbot/contracts/ipc";
import {
  WHATSAPP_LINK_IDLE,
  type WhatsAppIntegrationAgent,
  WhatsAppIntegrationPanel,
  WhatsAppLinkDialog,
} from "@openbot/ui/features/settings/WhatsAppIntegrationPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_SUMMARIES } from "./fixtures";
import { SettledArgs } from "./settled-args";

const meta = {
  title: "Settings/WhatsAppIntegrationPanel",
  component: WhatsAppIntegrationPanel,
  parameters: { layout: "padded", a11y: { test: "error" } },
  render: (args) => <SettledArgs>{() => <WhatsAppIntegrationPanel {...args} />}</SettledArgs>,
} satisfies Meta<typeof WhatsAppIntegrationPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const AGENTS: WhatsAppIntegrationAgent[] = STORY_AGENT_SUMMARIES.map((agent) => ({
  id: agent.id,
  name: agent.name,
  title: agent.title,
  avatarSeed: agent.avatarSeed,
  avatarHue: agent.avatarHue,
  avatarUrl: null,
}));

const ORCHESTRATOR: WhatsAppIntegrationAgent = {
  id: "agent-whatsapp-orchestrator",
  name: "WhatsApp Orchestrator",
  title: "Answers in WhatsApp and asks the team",
  avatarSeed: "whatsapp-orchestrator",
  avatarHue: 150,
  avatarUrl: null,
};

function number(update: Partial<MessagingConnection> = {}): MessagingConnection {
  return {
    workspaceId: "447700900123",
    platform: "whatsapp",
    enabled: true,
    state: "connected",
    workspaceName: "Ada Lovelace",
    botUserId: "447700900123",
    missingScopes: [],
    retryAt: null,
    credentials: "saved",
    orchestratorAgentId: ORCHESTRATOR.id,
    ...update,
  };
}

const PERSONAL: WhatsAppAccount = {
  workspaceId: "447700900123",
  ownNumber: true,
  allowedSenders: [
    { id: "447700900456", kind: "contact", name: "Charles Babbage" },
    { id: "120363000000000001@g.us", kind: "group", name: "Family" },
  ],
  pendingRequests: [],
};

const DEDICATED_NUMBER = number({ workspaceId: "447700900999", workspaceName: "Acme assistant" });

const DEDICATED: WhatsAppAccount = {
  workspaceId: "447700900999",
  ownNumber: false,
  allowedSenders: [{ id: "447700900456", kind: "contact", name: "Charles Babbage" }],
  pendingRequests: [
    { code: "K7Q2ZP", senderId: "447700900555", name: "Grace Hopper", expiresAt: "2026-10-30T15:00:00.000Z" },
    { code: "M4X9RT", senderId: "14155550100", name: "", expiresAt: "2026-10-30T15:10:00.000Z" },
  ],
};

const args = (connections: MessagingConnection[], accounts: WhatsAppAccount[], link = WHATSAPP_LINK_IDLE) => ({
  agents: [ORCHESTRATOR, ...AGENTS],
  connections,
  accounts,
  busy: false,
  link,
  onStartLink: fn(),
  onEndLink: fn(),
  onDisconnectNumber: fn(),
  onDisconnectAll: fn(),
  onReconnect: fn(),
  onSetEnabled: fn(),
  onSetOwnNumber: fn(),
  onAddOrchestrator: fn(),
  loadGroups: fn(async () => [
    { id: "120363000000000001@g.us", name: "Family" },
    { id: "120363000000000002@g.us", name: "Book club" },
  ]),
  onAddSender: fn(),
  onRemoveSender: fn(),
  onAnswerRequest: fn(),
});

/** No number yet: the warning, and Link WhatsApp opens the dialog. */
export const NotSetUp: Story = { args: args([], []) };

/** A personal number with two allowed senders, and a number only for OpenBot with two requests. */
export const Linked: Story = { args: args([number(), DEDICATED_NUMBER], [PERSONAL, DEDICATED]) };

/** A number is linked, and no agent answers yet. */
export const NoOrchestrator: Story = {
  args: args([number({ orchestratorAgentId: null })], [{ ...PERSONAL, allowedSenders: [] }]),
};

export const Paused: Story = { args: args([number({ enabled: false, state: "paused" })], [PERSONAL]) };

/** WhatsApp removed the linked device, such as after 14 days with the computer off: Link again. */
export const LoggedOut: Story = { args: args([number({ state: "invalid_token" })], [PERSONAL]) };

type DialogStory = StoryObj<typeof WhatsAppLinkDialog>;

const LINK_QR: WhatsAppLinkState = {
  status: "waiting",
  qr: "2@openbot-story-ref,openbot-story-noise-key,openbot-story-identity-key,story",
  code: null,
  workspaceId: null,
  error: null,
};

const dialogArgs = (
  link: WhatsAppLinkState,
  connections: MessagingConnection[] = [],
  start: "number" | "agent" = "number",
) => ({
  open: true,
  start,
  connections,
  agents: [ORCHESTRATOR, ...AGENTS],
  busy: false,
  link,
  onStartLink: fn(),
  onAddOrchestrator: fn(),
  onClose: fn(),
});

const renderDialog = (props: Parameters<typeof WhatsAppLinkDialog>[0]) => <WhatsAppLinkDialog {...props} />;

/** Step 1: what the number is, and how the phone links. */
export const LinkChoose: DialogStory = { render: renderDialog, args: dialogArgs(WHATSAPP_LINK_IDLE) };

/** The phone scans the QR code. */
export const LinkingQr: DialogStory = { render: renderDialog, args: dialogArgs(LINK_QR) };

/** The phone types the pairing code. */
export const LinkingCode: DialogStory = {
  render: renderDialog,
  args: dialogArgs({ ...LINK_QR, qr: null, code: "K7Q2ZPMX" }),
};

/** The phone did not link in time. */
export const LinkFailed: DialogStory = {
  render: renderDialog,
  args: dialogArgs({ ...LINK_QR, status: "failed", qr: null, error: "timeout" }),
};

/** Step 2: the number is linked, and the WhatsApp Orchestrator is added next. */
export const AddOrchestrator: DialogStory = {
  render: renderDialog,
  args: dialogArgs({ status: "linked", qr: null, code: null, workspaceId: "447700900123", error: null }, [
    number({ orchestratorAgentId: null }),
  ]),
};

/** Done: the number has the WhatsApp Orchestrator. */
export const LinkDone: DialogStory = {
  render: renderDialog,
  args: dialogArgs(WHATSAPP_LINK_IDLE, [number()], "agent"),
};
