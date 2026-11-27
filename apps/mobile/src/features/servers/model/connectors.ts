import type { ConnectorMessagingPlatform, MessagingConnection } from "@openbot/contracts/ipc";
import type { AppMobileMessages, MobileTextKey } from "@openbot/i18n/mobile";

export const MOBILE_CONNECTOR_IDS = [
  "slack",
  "discord",
  "telegram",
  "whatsapp",
  "github",
  "onepassword",
  "bitwarden",
  "protonpass",
] as const;

export type MobileConnectorId = (typeof MOBILE_CONNECTOR_IDS)[number];

export function isMobileConnectorId(value: string | undefined): value is MobileConnectorId {
  return MOBILE_CONNECTOR_IDS.some((id) => id === value);
}

export type WorkspacePlatform = Exclude<ConnectorMessagingPlatform, "telegram">;

export const CONNECTOR_TITLE_KEYS = {
  slack: "mobile.server.connectors.slack.title",
  discord: "mobile.server.connectors.discord.title",
  telegram: "mobile.server.connectors.telegram.title",
  whatsapp: "mobile.server.connectors.whatsapp.title",
  github: "mobile.server.connectors.github.title",
  onepassword: "mobile.server.connectors.onePassword.title",
  bitwarden: "mobile.server.connectors.bitwarden.title",
  protonpass: "mobile.server.connectors.protonPass.title",
} as const satisfies Record<MobileConnectorId, MobileTextKey>;

export type ConnectorStatus = "connected" | "paused" | "attention" | "connecting" | "idle" | "unavailable" | "unknown";

export const CONNECTOR_STATUS_KEYS = {
  connected: "mobile.server.connectors.statusConnected",
  paused: "mobile.server.connectors.statusPaused",
  attention: "mobile.server.connectors.statusAttention",
  connecting: "mobile.server.connectors.statusConnecting",
  idle: "mobile.server.connectors.statusNotSetUp",
  unavailable: "mobile.server.connectors.localOnly",
  unknown: "mobile.server.connectors.statusUnknown",
} as const satisfies Record<ConnectorStatus, MobileTextKey>;

export type ConnectionKind = "live" | "setup" | "paused" | "attention";

export const CONNECTION_KIND_KEYS = {
  live: "mobile.server.connectors.statusConnected",
  paused: "mobile.server.connectors.statusPaused",
  setup: "mobile.server.connectors.statusConnecting",
  attention: "mobile.server.connectors.statusAttention",
} as const satisfies Record<ConnectionKind, MobileTextKey>;

export function connectionKind(connection: MessagingConnection): ConnectionKind {
  switch (connection.state) {
    case "connected":
      return "live";
    case "paused":
      return "paused";
    case "connecting":
    case "reconnecting":
    case "rate_limited":
      return "setup";
    default:
      return "attention";
  }
}

export function workspaceOrchestrator<Agent extends { id: string }>(
  connection: MessagingConnection,
  agents: readonly Agent[],
): Agent | null {
  return agents.find((agent) => agent.id === connection.orchestratorAgentId) ?? null;
}

export function telegramOrchestrator<Agent extends { id: string }>(
  connections: readonly MessagingConnection[],
  agents: readonly Agent[],
): Agent | null {
  for (const connection of connections) {
    const agent = agents.find((candidate) => candidate.id === connection.orchestratorAgentId);
    if (agent) return agent;
  }
  return null;
}

export function attentionCount(
  platform: ConnectorMessagingPlatform,
  connections: readonly MessagingConnection[],
  agents: readonly { id: string }[],
): number {
  const telegramAgent = platform === "telegram" ? telegramOrchestrator(connections, agents) : null;
  return connections.filter(
    (connection) =>
      connectionKind(connection) === "attention" ||
      !(platform === "telegram" ? telegramAgent : workspaceOrchestrator(connection, agents)),
  ).length;
}

function pausedOrConnected(connections: readonly MessagingConnection[]): ConnectorStatus {
  return connections.every((connection) => connectionKind(connection) === "paused") ? "paused" : "connected";
}

export function messagingStatus(
  platform: ConnectorMessagingPlatform,
  connections: readonly MessagingConnection[],
  agents: readonly { id: string }[],
): ConnectorStatus {
  if (attentionCount(platform, connections, agents) > 0) return "attention";
  return connections.length === 0 ? "idle" : pausedOrConnected(connections);
}

export function whatsappAttentionCount(
  connections: readonly MessagingConnection[],
  agents: readonly { id: string }[],
): number {
  const orchestrator = telegramOrchestrator(connections, agents);
  return connections.filter((connection) => connectionKind(connection) === "attention" || !orchestrator).length;
}

export function whatsappStatus(
  connections: readonly MessagingConnection[],
  agents: readonly { id: string }[],
): ConnectorStatus {
  if (whatsappAttentionCount(connections, agents) > 0) return "attention";
  return connections.length === 0 ? "idle" : pausedOrConnected(connections);
}

export function whatsappPhoneNumber(digits: string): string {
  return `+${digits}`;
}

export function whatsappNumberName(connection: MessagingConnection): string {
  return connection.workspaceName || whatsappPhoneNumber(connection.workspaceId);
}

export function maskedWhatsAppNumber(digits: string): string {
  return `+${digits.slice(0, 2)} ••• ${digits.slice(-3)}`;
}

export function groupedPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function isTelegramGroup(connection: MessagingConnection): boolean {
  return connection.workspaceId.startsWith("-");
}

const PAGE_HOSTS = {
  slack: "slack.com",
  discord: "discord.com",
  telegram: "t.me",
  github: "github.com",
} as const;

export function platformPage(platform: keyof typeof PAGE_HOSTS, address: string | null): string | null {
  if (address === null) return null;
  const origin = `https://${PAGE_HOSTS[platform]}`;
  if (!address.startsWith(origin)) return null;
  const rest = address.slice(origin.length);
  return rest === "" || /^[/?#][^\s\\]*$/u.test(rest) ? address : null;
}

export const MESSAGING_INSTALL_RETURN = {
  slack: "openbot://slack-workspace",
  discord: "openbot://discord-guild",
} as const satisfies Record<WorkspacePlatform, string>;

export function isMessagingInstallReturn(path: string): boolean {
  return Object.values(MESSAGING_INSTALL_RETURN).some(
    (prefix) => path === prefix || path.startsWith(`${prefix}?`) || path.startsWith(`${prefix}/`),
  );
}

export function messagingInstallGrant(
  platform: WorkspacePlatform,
  url: string,
  nonce: string,
): { nonce: string; grant: string } | null {
  const prefix = MESSAGING_INSTALL_RETURN[platform];
  if (!url.startsWith(prefix)) return null;
  const query = url.indexOf("?");
  if (query < 0) return null;
  const params = new URLSearchParams(url.slice(query + 1).split("#")[0]);
  const grant = params.get("grant");
  return params.get("nonce") === nonce && grant ? { nonce, grant } : null;
}

export const MESSAGING_TEXT = {
  slack: {
    description: "mobile.server.connectors.slack.description",
    attention: "mobile.server.connectors.slack.attention",
    connect: "mobile.server.connectors.slack.connect",
    connectFooter: "mobile.server.connectors.slack.connectFooter",
    add: "mobile.server.connectors.slack.add",
    limit: "mobile.server.connectors.slack.limit",
    connectionTitle: "mobile.server.connectors.slack.workspaceTitle",
    connectionDescription: "mobile.server.connectors.slack.workspaceDescription",
    missingScopes: "mobile.server.connectors.slack.missingScopes",
    retryAt: "mobile.server.connectors.slack.retryAt",
    orchestratorTitle: "mobile.server.connectors.slack.orchestratorTitle",
    orchestratorDescription: "mobile.server.connectors.slack.orchestratorDescription",
    orchestratorNone: "mobile.server.connectors.slack.orchestratorNone",
    addAgent: "mobile.server.connectors.slack.addAgent",
    note: "mobile.server.connectors.slack.note",
    disconnectTitle: "mobile.server.connectors.slack.disconnectTitle",
    disconnectBody: "mobile.server.connectors.slack.disconnectBody",
    disconnectKept: "mobile.server.connectors.slack.disconnectKept",
    disconnectDeleted: "mobile.server.connectors.slack.disconnectDeleted",
    agentPromptTitle: "mobile.server.connectors.slack.agentPromptTitle",
    agentPromptBody: "mobile.server.connectors.slack.agentPromptBody",
    installFailed: "mobile.server.connectors.slack.installFailed",
  },
  discord: {
    description: "mobile.server.connectors.discord.description",
    attention: "mobile.server.connectors.discord.attention",
    connect: "mobile.server.connectors.discord.connect",
    connectFooter: "mobile.server.connectors.discord.connectFooter",
    add: "mobile.server.connectors.discord.add",
    limit: "mobile.server.connectors.discord.limit",
    connectionTitle: "mobile.server.connectors.discord.workspaceTitle",
    connectionDescription: "mobile.server.connectors.discord.workspaceDescription",
    missingScopes: "mobile.server.connectors.discord.missingScopes",
    retryAt: "mobile.server.connectors.discord.retryAt",
    orchestratorTitle: "mobile.server.connectors.discord.orchestratorTitle",
    orchestratorDescription: "mobile.server.connectors.discord.orchestratorDescription",
    orchestratorNone: "mobile.server.connectors.discord.orchestratorNone",
    addAgent: "mobile.server.connectors.discord.addAgent",
    note: "mobile.server.connectors.discord.note",
    disconnectTitle: "mobile.server.connectors.discord.disconnectTitle",
    disconnectBody: "mobile.server.connectors.discord.disconnectBody",
    disconnectKept: "mobile.server.connectors.discord.disconnectKept",
    disconnectDeleted: "mobile.server.connectors.discord.disconnectDeleted",
    agentPromptTitle: "mobile.server.connectors.discord.agentPromptTitle",
    agentPromptBody: "mobile.server.connectors.discord.agentPromptBody",
    installFailed: "mobile.server.connectors.discord.installFailed",
  },
} as const satisfies Record<WorkspacePlatform, Record<string, keyof AppMobileMessages>>;
