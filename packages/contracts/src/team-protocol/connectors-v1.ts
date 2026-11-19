import {
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const CONNECTORS_CAPABILITY = "connectors-v1";

export const CONNECTORS_ROUTES = {
  githubStatus: "/v1/admin/connectors/github/status",
  githubConnect: "/v1/admin/connectors/github/connect",
  githubCancel: "/v1/admin/connectors/github/cancel",
  githubDisconnect: "/v1/admin/connectors/github/disconnect",
  githubRepositories: "/v1/admin/connectors/github/repositories",
  messagingOverview: "/v1/admin/connectors/messaging/overview",
  messagingConnect: "/v1/admin/connectors/messaging/connect",
  messagingComplete: "/v1/admin/connectors/messaging/complete",
  messagingDisconnect: "/v1/admin/connectors/messaging/disconnect",
  messagingReconnect: "/v1/admin/connectors/messaging/reconnect",
  messagingEnabled: "/v1/admin/connectors/messaging/enabled",
  messagingOrchestrator: "/v1/admin/connectors/messaging/orchestrator",
} as const;

const githubStatus = fields({
  available: boolean,
  state: oneOf("disconnected", "pending", "connected", "expired"),
  login: nullable(string(255)),
  avatarUrl: nullable(string(2_048)),
  userCode: nullable(string(64)),
  verificationUri: nullable(string(2_048)),
  error: nullable(string(2_000)),
  installUrl: nullable(string(2_048)),
  revokeUrl: nullable(string(2_048)),
});
const githubRepositories = fields({
  repositories: list(fields({ fullName: string(255), private: boolean }), 500),
  total: count,
});

const platform = oneOf("slack", "discord", "telegram");
const messagingWorkspace = fields({ platform, workspaceId: identifier });
const messagingConnection = fields({
  workspaceId: identifier,
  platform,
  enabled: boolean,
  state: string(64),
  workspaceName: string(256),
  botUserId: nullable(string(256)),
  missingScopes: list(string(64), 32),
  retryAt: nullable(string(64)),
  credentials: string(64),
  orchestratorAgentId: nullable(identifier),
});
const messagingPage = fields({ url: nullable(string(4_096)), nonce: nullable(string(128)) });

export const CONNECTORS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CONNECTORS_ROUTES.githubStatus, adminRoute(empty, githubStatus)],
  [CONNECTORS_ROUTES.githubConnect, adminRoute(empty, githubStatus)],
  [CONNECTORS_ROUTES.githubCancel, adminRoute(empty, githubStatus)],
  [CONNECTORS_ROUTES.githubDisconnect, adminRoute(empty, githubStatus)],
  [CONNECTORS_ROUTES.githubRepositories, adminRoute(empty, githubRepositories)],
  [
    CONNECTORS_ROUTES.messagingOverview,
    adminRoute(fields({ platform }), fields({ connections: list(messagingConnection, 64) })),
  ],
  [
    CONNECTORS_ROUTES.messagingConnect,
    adminRoute(fields({ platform, place: nullable(oneOf("group", "direct")) }), messagingPage),
  ],
  [
    CONNECTORS_ROUTES.messagingComplete,
    adminRoute(
      fields({ platform: oneOf("slack", "discord"), nonce: string(128), grant: string(16_384) }),
      fields({ accepted: boolean }),
    ),
  ],
  [CONNECTORS_ROUTES.messagingDisconnect, adminRoute(messagingWorkspace, empty)],
  [CONNECTORS_ROUTES.messagingReconnect, adminRoute(messagingWorkspace, messagingPage)],
  [
    CONNECTORS_ROUTES.messagingEnabled,
    adminRoute(fields({ platform, workspaceId: identifier, enabled: boolean }), empty),
  ],
  [
    CONNECTORS_ROUTES.messagingOrchestrator,
    adminRoute(
      fields({ platform, workspaceId: nullable(identifier) }),
      fields({ agentId: identifier, sectionId: nullable(identifier) }),
    ),
  ],
]);
