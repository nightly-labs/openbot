import {
  DISCONNECTED_BITWARDEN_CONNECTOR,
  DISCONNECTED_ONEPASSWORD_CONNECTOR,
  type MessagingConnection,
} from "@openbot/contracts/ipc";
import type { ConnectorDetail } from "@openbot/ui/features/connectors/ConnectorDetailPanel";
import type { SlackIntegrationAgent } from "@openbot/ui/features/settings/SlackIntegrationPanel";
import { WHATSAPP_LINK_IDLE } from "@openbot/ui/features/settings/WhatsAppIntegrationPanel";
import { fn } from "storybook/test";
import type { ConnectorController } from "../src/features/connectors/connector-controller";
import type { ConnectorSet } from "../src/features/connectors/connector-registry";

const workspace = {
  agents: [],
  connections: [],
  busy: false,
  onConnectWorkspace: fn(),
  onDisconnectWorkspace: fn(),
  onDisconnectAll: fn(),
  onReconnect: fn(),
  onSetEnabled: fn(),
  onAddOrchestrator: fn(),
};

/** GitHub is connected; Slack, Discord, Telegram, WhatsApp, 1Password and Bitwarden are not set up. */
export const STORY_CONNECTOR_DETAILS: readonly ConnectorDetail[] = [
  { id: "slack", props: { ...workspace, platform: "slack" } },
  { id: "discord", props: { ...workspace, platform: "discord" } },
  {
    id: "telegram",
    props: {
      agents: [],
      connections: [],
      busy: false,
      onConnectChat: fn(async () => true),
      onDisconnectChat: fn(),
      onDisconnectAll: fn(),
      onReconnect: fn(),
      onSetEnabled: fn(),
      onAddOrchestrator: fn(),
    },
  },
  {
    id: "whatsapp",
    props: {
      agents: [],
      connections: [],
      accounts: [],
      busy: false,
      link: WHATSAPP_LINK_IDLE,
      onStartLink: fn(),
      onEndLink: fn(),
      onDisconnectNumber: fn(),
      onDisconnectAll: fn(),
      onReconnect: fn(),
      onSetEnabled: fn(),
      onSetOwnNumber: fn(),
      onAddOrchestrator: fn(),
      loadGroups: fn(async () => []),
      onAddSender: fn(),
      onRemoveSender: fn(),
      onAnswerRequest: fn(),
    },
  },
  {
    id: "github",
    props: {
      status: {
        available: true,
        state: "connected",
        login: "octocat",
        avatarUrl: null,
        userCode: null,
        verificationUri: null,
        error: null,
      },
      busy: false,
      repositories: {
        repositories: [
          { fullName: "octocat/hello-world", private: false },
          { fullName: "octocat/private-notes", private: true },
        ],
        total: 2,
      },
      repositoriesError: null,
      onConnect: fn(),
      onCancel: fn(),
      onDisconnect: fn(),
      onOpenVerification: fn(),
      onOpenInstall: fn(),
    },
  },
  {
    id: "onepassword",
    props: {
      status: {
        ...DISCONNECTED_ONEPASSWORD_CONNECTOR,
        setup: { cli: "ready", cliVersion: "2.39.0", canInstall: true, appIntegration: true },
      },
      busy: false,
      onWatchSetup: fn(() => () => undefined),
      onCheckSetup: fn(),
      onInstallCli: fn(),
      onOpenApp: fn(),
      onConnect: fn(),
      onConnectWithToken: fn(),
      onCancel: fn(),
      onDisconnect: fn(),
    },
  },
  {
    id: "bitwarden",
    props: { status: DISCONNECTED_BITWARDEN_CONNECTOR, busy: false, onConnect: fn(), onDisconnect: fn() },
  },
];

const ORCHESTRATOR: SlackIntegrationAgent = {
  id: "agent-orchestrator",
  name: "Orchestrator",
  title: "Answers in the channel and asks the team",
  avatarSeed: "orchestrator",
  avatarHue: 280,
  avatarUrl: null,
};

function channel(update: Partial<MessagingConnection> & Pick<MessagingConnection, "platform">): MessagingConnection {
  return {
    workspaceId: "T0STORY",
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

/**
 * Every connector is set up: a Slack workspace, a Discord server, two Telegram chats, a WhatsApp
 * number, both vaults.
 */
export const CONNECTED_CONNECTOR_DETAILS: readonly ConnectorDetail[] = STORY_CONNECTOR_DETAILS.map((detail) => {
  switch (detail.id) {
    case "slack":
      return {
        ...detail,
        props: { ...detail.props, agents: [ORCHESTRATOR], connections: [channel({ platform: "slack" })] },
      };
    case "discord":
      return {
        ...detail,
        props: {
          ...detail.props,
          agents: [ORCHESTRATOR],
          connections: [channel({ platform: "discord", workspaceId: "1000", workspaceName: "Acme community" })],
        },
      };
    case "telegram":
      return {
        ...detail,
        props: {
          ...detail.props,
          agents: [ORCHESTRATOR],
          connections: [
            channel({ platform: "telegram", workspaceId: "-1001234567890", workspaceName: "Acme team" }),
            channel({ platform: "telegram", workspaceId: "123456789", workspaceName: "Ada Lovelace" }),
          ],
        },
      };
    case "whatsapp":
      return {
        ...detail,
        props: {
          ...detail.props,
          agents: [ORCHESTRATOR],
          connections: [channel({ platform: "whatsapp", workspaceId: "447700900123", workspaceName: "Ada Lovelace" })],
          accounts: [{ workspaceId: "447700900123", ownNumber: true, allowedSenders: [], pendingRequests: [] }],
        },
      };
    case "onepassword":
      return {
        ...detail,
        props: {
          ...detail.props,
          status: { ...detail.props.status, state: "connected", vaultNames: ["Shared with OpenBot"], loginCount: 3 },
        },
      };
    case "bitwarden":
      return { ...detail, props: { ...detail.props, status: { ...detail.props.status, connected: true } } };
    default:
      return detail;
  }
});

/** A controller over fixed props. Its actions only record the call. */
function storyConnector(detail: ConnectorDetail): ConnectorController {
  return {
    id: detail.id,
    ready: () => true,
    available: () => true,
    busy: () => false,
    detail,
    connect:
      detail.id === "github"
        ? detail.props.onConnect
        : detail.id === "slack" || detail.id === "discord"
          ? detail.props.onConnectWorkspace
          : undefined,
    reload: fn(),
    watch: () => () => undefined,
  };
}

export function storyConnectorSet(details: readonly ConnectorDetail[] = STORY_CONNECTOR_DETAILS): ConnectorSet {
  return Object.fromEntries(details.map((detail) => [detail.id, storyConnector(detail)]));
}
