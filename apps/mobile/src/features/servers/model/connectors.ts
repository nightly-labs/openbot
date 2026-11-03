import type { ConnectorMessagingPlatform, MessagingConnection } from "@openbot/contracts/ipc";
import type { AppMobileMessages, MobileTextKey } from "@openbot/i18n/mobile";

/**
 * The connectors of a joined server, in the order of desktop Server settings › Connectors. A host
 * without `bitwarden-connector-v1` connects Bitwarden only on its own computer, so a phone shows it
 * with no action.
 */
export const MOBILE_CONNECTOR_IDS = ["slack", "discord", "telegram", "github", "onepassword", "bitwarden"] as const;

export type MobileConnectorId = (typeof MOBILE_CONNECTOR_IDS)[number];

export function isMobileConnectorId(value: string | undefined): value is MobileConnectorId {
  return MOBILE_CONNECTOR_IDS.some((id) => id === value);
}

/** Slack and Discord install the OpenBot app in a workspace; Telegram links chats to one bot. */
export type WorkspacePlatform = Exclude<ConnectorMessagingPlatform, "telegram">;

export const CONNECTOR_TITLE_KEYS = {
  slack: "mobile.server.connectors.slack.title",
  discord: "mobile.server.connectors.discord.title",
  telegram: "mobile.server.connectors.telegram.title",
  github: "mobile.server.connectors.github.title",
  onepassword: "mobile.server.connectors.onePassword.title",
  bitwarden: "mobile.server.connectors.bitwarden.title",
} as const satisfies Record<MobileConnectorId, MobileTextKey>;

/** How a list shows a connector. `idle` is not set up; `unavailable` cannot be set up from a phone. */
export type ConnectorStatus = "connected" | "attention" | "connecting" | "idle" | "unavailable" | "unknown";

export const CONNECTOR_STATUS_KEYS = {
  connected: "mobile.server.connectors.statusConnected",
  attention: "mobile.server.connectors.statusAttention",
  connecting: "mobile.server.connectors.statusConnecting",
  idle: "mobile.server.connectors.statusNotSetUp",
  unavailable: "mobile.server.connectors.localOnly",
  unknown: "mobile.server.connectors.statusUnknown",
} as const satisfies Record<ConnectorStatus, MobileTextKey>;

/** What a connection row can do. */
export type ConnectionKind = "live" | "setup" | "paused" | "attention";

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

/** The orchestrator agent of a Slack workspace or a Discord server, when it still exists. */
export function workspaceOrchestrator<Agent extends { id: string }>(
  connection: MessagingConnection,
  agents: readonly Agent[],
): Agent | null {
  return agents.find((agent) => agent.id === connection.orchestratorAgentId) ?? null;
}

/** The one orchestrator agent of all Telegram chats, when it still exists. */
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

/** The connections that need the user: a stopped connection, or one that no agent answers. */
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

export function messagingStatus(
  platform: ConnectorMessagingPlatform,
  connections: readonly MessagingConnection[],
  agents: readonly { id: string }[],
): ConnectorStatus {
  if (attentionCount(platform, connections, agents) > 0) return "attention";
  return connections.length === 0 ? "idle" : "connected";
}

/** Telegram gives a group, a supergroup and a channel a negative ID, and a direct chat a positive one. */
export function isTelegramGroup(connection: MessagingConnection): boolean {
  return connection.workspaceId.startsWith("-");
}

const PAGE_HOSTS = {
  slack: "slack.com",
  discord: "discord.com",
  telegram: "t.me",
  github: "github.com",
} as const;

/**
 * `address` when it is an https page of the platform, otherwise null. A joined server names the pages
 * that the phone opens, so the phone opens no other site. The React Native `URL` does not parse a
 * host strictly, so the host must follow `https://` with no user, port or other character before the path.
 */
export function platformPage(platform: keyof typeof PAGE_HOSTS, address: string | null): string | null {
  if (address === null) return null;
  const origin = `https://${PAGE_HOSTS[platform]}`;
  if (!address.startsWith(origin)) return null;
  const rest = address.slice(origin.length);
  return rest === "" || /^[/?#][^\s\\]*$/u.test(rest) ? address : null;
}

/**
 * The `openbot://` link where a Slack or Discord install returns, from the page at `/slack/connect` or
 * `/discord/connect`. The phone takes it in the browser session that opened the install.
 */
export const MESSAGING_INSTALL_RETURN = {
  slack: "openbot://slack-workspace",
  discord: "openbot://discord-guild",
} as const satisfies Record<WorkspacePlatform, string>;

/** True for the return link of a Slack or Discord install, which only its browser session takes. */
export function isMessagingInstallReturn(path: string): boolean {
  return Object.values(MESSAGING_INSTALL_RETURN).some(
    (prefix) => path === prefix || path.startsWith(`${prefix}?`) || path.startsWith(`${prefix}/`),
  );
}

/** The sealed grant of a return link, when it has the nonce of the install that the phone opened. */
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

/** The text of one messaging platform. Slack and Discord share a page; Telegram has its own. */
export const MESSAGING_TEXT = {
  slack: {
    summary: "mobile.server.connectors.slack.summary",
    description: "mobile.server.connectors.slack.description",
    connected: "mobile.server.connectors.slack.connected",
    noAgent: "mobile.server.connectors.slack.noAgent",
    many: "mobile.server.connectors.slack.many",
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
    summary: "mobile.server.connectors.discord.summary",
    description: "mobile.server.connectors.discord.description",
    connected: "mobile.server.connectors.discord.connected",
    noAgent: "mobile.server.connectors.discord.noAgent",
    many: "mobile.server.connectors.discord.many",
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
