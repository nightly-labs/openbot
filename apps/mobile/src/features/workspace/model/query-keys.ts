import type { AgentProviderId } from "@openbot/contracts/ipc";

export type QueryScope = readonly [apiUrl: string | null | undefined, userId: string | undefined, sessionScope: number];

type AgentRecordPart =
  | "memories"
  | "memory-selection"
  | "routines"
  | "storage"
  | "admin"
  | "host"
  | "backup-models"
  | "task-limit"
  | "new-chat"
  | "plan-card"
  | "fast-mode"
  | "instructions"
  | "publish"
  | "browser-profile"
  | "folders";

export const AGENT_SETTINGS_PARTS: readonly string[] = [
  "admin",
  "host",
  "backup-models",
  "task-limit",
  "new-chat",
  "plan-card",
  "fast-mode",
  "session-settings",
  "provider-accounts",
  "browser-profile",
  "folders",
  "agent-defaults",
];

export const queryKeys = {
  accountSessions: (...scope: [QueryScope] | []) => ["account-sessions", ...(scope[0] ?? [])],
  hostedServerPlans: (...scope: [QueryScope] | []) => ["hosted-server-plans", ...(scope[0] ?? [])],
  billing: (...scope: [QueryScope] | []) => ["billing", ...(scope[0] ?? [])],
  ownerHostedServerIds: (scope: QueryScope) => ["owner-hosted-server-ids", ...scope],
  agentTemplate: (apiUrl: string | null, templateId: string | null) => ["agent-template", apiUrl, templateId],
  marketplace: (apiUrl: string | null, ...parts: (string | null)[]) => ["marketplace", apiUrl, ...parts],

  agentInfo: (
    ...prefix: [] | [scope: QueryScope, serverId: string] | [scope: QueryScope, serverId: string, agentId: string]
  ) => {
    const [scope = [], ...ids] = prefix;
    return ["agent-info", ...scope, ...ids];
  },
  agentRecord: (scope: QueryScope, serverId: string, agentId: string, part: AgentRecordPart) => [
    ...queryKeys.agentInfo(scope, serverId, agentId),
    part,
  ],
  agentSkills: (scope: QueryScope, serverId: string, agentId: string, manage: boolean) => [
    ...queryKeys.agentInfo(scope, serverId, agentId),
    "skills",
    manage,
  ],
  agentUsage: (scope: QueryScope, serverId: string, agentId: string, available: boolean, range: unknown) => [
    ...queryKeys.agentInfo(scope, serverId, agentId),
    "usage",
    available,
    range,
  ],
  agentEventRoutines: (scope: QueryScope, serverId: string, agentId: string) => [
    ...queryKeys.agentRecord(scope, serverId, agentId, "routines"),
    "events",
  ],
  agentRoutineResultOptions: (scope: QueryScope, serverId: string, agentId: string) => [
    ...queryKeys.agentRecord(scope, serverId, agentId, "routines"),
    "result-options",
  ],
  agentRoutineResultDestination: (scope: QueryScope, serverId: string, agentId: string, routineId: string) => [
    ...queryKeys.agentRecord(scope, serverId, agentId, "routines"),
    "result-destination",
    routineId,
  ],
  agentProviderAccounts: (scope: QueryScope, serverId: string, agentId: string) => [
    ...queryKeys.agentInfo(scope, serverId, agentId),
    "provider-accounts",
  ],
  agentSessionSettings: (
    scope: QueryScope,
    serverId: string,
    agentId: string,
    provider: AgentProviderId | undefined,
    model: string | undefined,
  ) => [...queryKeys.agentInfo(scope, serverId, agentId), provider, model, "session-settings"],
  agentFolderBrowse: (scope: QueryScope, serverId: string, agentId: string, path: string | null) => [
    "agent-folder-browse",
    ...scope,
    serverId,
    agentId,
    path,
  ],
  agentDefaults: (scope: QueryScope, serverId: string) => [...queryKeys.agentInfo(scope, serverId), "agent-defaults"],
  backgroundProcesses: (scope: QueryScope, serverId: string) => ["background-processes", ...scope, serverId],
  sharedTables: (scope: QueryScope, serverId: string) => [...queryKeys.agentInfo(scope, serverId), "tables"],
  channelInfo: (scope: QueryScope, serverId: string, channelId: string, ...part: [] | ["memories" | "routines"]) => [
    "channel-info",
    ...scope,
    serverId,
    channelId,
    ...part,
  ],
  agentAvatar: (
    scope: QueryScope,
    serverId: string | undefined,
    ...avatar: [] | [agentId: string | undefined, avatarUrl: string | null | undefined]
  ) => ["agent-avatar", ...scope, serverId, ...avatar],
  channelImage: (
    scope: QueryScope,
    serverId: string | undefined,
    ...image: [] | [channelId: string | undefined, imageUrl: string | null | undefined]
  ) => ["channel-image", ...scope, serverId, ...image],
  agentModels: (scope: QueryScope, serverId: string) => ["agent-models", ...scope, serverId],

  serverMembers: (scope: QueryScope, serverId: string) => ["server-members", ...scope, serverId],
  serverInvites: (scope: QueryScope, serverId: string) => ["server-invites", ...scope, serverId],
  serverTimezone: (scope: QueryScope, serverId: string) => ["server-timezone", ...scope, serverId],
  localServers: (scope: QueryScope, serverId: string) => ["local-servers", ...scope, serverId],
  agentMemoryLimit: (scope: QueryScope, serverId: string) => ["agent-memory-limit", ...scope, serverId],
  memoryReview: (scope: QueryScope, serverId: string) => ["memory-review", ...scope, serverId],
  skillLearning: (scope: QueryScope, serverId: string) => ["skill-learning", ...scope, serverId],
  browsingMemory: (scope: QueryScope, serverId: string) => ["browsing-memory", ...scope, serverId],
  serverPersonality: (scope: QueryScope, serverId: string) => ["server-personality", ...scope, serverId],
  serverRoles: (scope: QueryScope, serverId: string) => ["server-roles", ...scope, serverId],
  serverAudit: (scope: QueryScope, serverId: string) => ["server-audit", ...scope, serverId],
  serverConnector: (scope: QueryScope, serverId: string, connector: string) => [
    "server-connector",
    ...scope,
    serverId,
    connector,
  ],
  serverUpdate: (scope: QueryScope, serverId: string) => ["server-update", ...scope, serverId],
  serverStorage: (scope: QueryScope, serverId: string) => ["server-storage", ...scope, serverId],
  serverKeptLibrary: (scope: QueryScope, serverId: string) => ["server-kept-library", ...scope, serverId],
  serverLibraryFolders: (scope: QueryScope, serverId: string) => ["server-library-folders", ...scope, serverId],
  serverDisk: (scope: QueryScope, serverId: string) => ["server-disk", ...scope, serverId],
  serverSites: (scope: QueryScope, serverId: string) => ["server-sites", ...scope, serverId],
  serverVault: (scope: QueryScope, serverId: string) => ["server-vault", ...scope, serverId],
  serverVaultCodes: (scope: QueryScope, serverId: string) => ["server-vault-codes", ...scope, serverId],
  instanceTransferSummary: (scope: QueryScope, serverId: string) => ["instance-transfer-summary", ...scope, serverId],
  serverBrowserProfiles: (scope: QueryScope, serverId: string) => ["server-browser-profiles", ...scope, serverId],
  serverBrowserProxies: (scope: QueryScope, serverId: string) => ["server-browser-proxies", ...scope, serverId],
  providerStatus: (scope: QueryScope, serverId: string) => ["provider-status", ...scope, serverId],
  providerRuntimes: (scope: QueryScope, serverId: string) => ["provider-runtimes", ...scope, serverId],
  providerDefault: (scope: QueryScope, serverId: string) => ["provider-default", ...scope, serverId],
  providerKey: (scope: QueryScope, serverId: string, provider: string) => [
    "provider-key",
    ...scope,
    serverId,
    provider,
  ],
  providerModels: (scope: QueryScope, serverId: string, ...provider: [] | [provider: string]) => [
    "provider-models",
    ...scope,
    serverId,
    ...provider,
  ],
  providerPromptCache: (scope: QueryScope, serverId: string) => ["provider-prompt-cache", ...scope, serverId],
  providerCompactWindow: (scope: QueryScope, serverId: string) => ["provider-compact-window", ...scope, serverId],
  providerEnvironment: (scope: QueryScope, serverId: string, provider: string) => [
    "provider-environment",
    ...scope,
    serverId,
    provider,
  ],
  providerUsageResets: (scope: QueryScope, serverId: string, provider: string) => [
    "provider-usage-resets",
    ...scope,
    serverId,
    provider,
  ],
  providerAccounts: (scope: QueryScope, serverId: string) => ["provider-accounts", ...scope, serverId],
  customAgents: (scope: QueryScope, serverId: string) => ["custom-agents", ...scope, serverId],
  customProviders: (scope: QueryScope, serverId: string, edits: boolean) => [
    "custom-providers",
    ...scope,
    serverId,
    edits ? "edit" : "list",
  ],
  mcpServers: (scope: QueryScope, serverId: string) => ["mcp-servers", ...scope, serverId],
  mcpSignIns: (scope: QueryScope, serverId: string) => ["mcp-sign-ins", ...scope, serverId],
  mcpAccess: (scope: QueryScope, serverId: string) => ["mcp-access", ...scope, serverId],
  serverLogo: (scope: QueryScope, serverId: string, ...logo: [] | [logoKey: string | null]) => [
    "server-logo",
    ...scope,
    serverId,
    ...logo,
  ],
  planLimits: (scope: QueryScope, serverId: string) => ["plan-limits", ...scope, serverId],
  machineMetrics: (scope: QueryScope, serverId: string) => ["machine-metrics", ...scope, serverId],
  serverUsage: (scope: QueryScope, serverId: string, range: unknown) => ["server-usage", ...scope, serverId, range],
  profileActivity: (scope: QueryScope, serverId: string, range: unknown) => [
    "profile-activity",
    ...scope,
    serverId,
    range,
  ],
  serverRoutines: (scope: QueryScope, serverId: string, ...range: [] | [from: string, to: string]) => [
    "server-routines",
    ...scope,
    serverId,
    ...range,
  ],
  serverRoutineSearch: (scope: QueryScope, serverId: string, ownerKey: string) => [
    ...queryKeys.serverRoutines(scope, serverId),
    "search",
    ownerKey,
  ],
  serverTasks: (scope: QueryScope, serverId: string) => ["server-tasks", ...scope, serverId],
  agentTasks: (scope: QueryScope, serverId: string, agentId: string) => [
    ...queryKeys.serverTasks(scope, serverId),
    "agent",
    agentId,
  ],
  agentThreadReads: (scope: QueryScope, serverId: string, agentId: string) => [
    ...queryKeys.serverTasks(scope, serverId),
    "reads",
    agentId,
  ],
  messagePins: (scope: QueryScope, serverId: string, agentId: string) => ["message-pins", ...scope, serverId, agentId],
  agentTaskConversation: (scope: QueryScope, serverId: string, taskId: string) => [
    ...queryKeys.serverTasks(scope, serverId),
    "task",
    taskId,
  ],
  serverWorkflows: (scope: QueryScope, serverId: string) => ["server-workflows", ...scope, serverId],
  workflowList: (scope: QueryScope, serverId: string) => [...queryKeys.serverWorkflows(scope, serverId), "list"],
  workflow: (
    scope: QueryScope,
    serverId: string,
    workflowId: string,
    ...part: [] | ["detail"] | ["runs"] | ["history"] | ["run", runId: string] | ["versions"] | ["github-history"]
  ) => [...queryKeys.serverWorkflows(scope, serverId), "workflow", workflowId, ...part],
  workflowVersionGraph: (scope: QueryScope, serverId: string, workflowId: string, versionId: string) => [
    ...queryKeys.serverWorkflows(scope, serverId),
    "version-graph",
    workflowId,
    versionId,
  ],
  workflowGitHubCatalog: (scope: QueryScope, serverId: string) => [
    ...queryKeys.serverWorkflows(scope, serverId),
    "github-catalog",
  ],
  workflowChats: (scope: QueryScope, serverId: string) => [...queryKeys.serverWorkflows(scope, serverId), "chats"],
  workflowGitHubOptions: (scope: QueryScope, serverId: string, repository: string) => [
    ...queryKeys.serverWorkflows(scope, serverId),
    "github-options",
    repository.toLowerCase(),
  ],
  messageSearch: (scope: QueryScope, serverId: string, query: string) => ["message-search", ...scope, serverId, query],
  fileSearch: (scope: QueryScope, serverId: string, query: string) => ["file-search", ...scope, serverId, query],

  routineWebhooks: (serverId: string) => ["routine-webhooks", serverId],
  routineWebhookActivity: (serverId: string, ownerKind: string, ownerId: string, routineId: string) => [
    ...queryKeys.routineWebhooks(serverId),
    ownerKind,
    ownerId,
    routineId,
    "activity",
  ],
  chatQueue: (...target: [] | [serverId: string] | [serverId: string, agentId: string]) => ["chat-queue", ...target],
  chatAttachment: (serverId: string, attachmentId: string) => ["chat-attachment", serverId, attachmentId],
  chatMediaFile: (serverId: string, attachmentId: string) => ["chat-media-file", serverId, attachmentId],
  chatAttachmentPreview: (serverId: string, attachmentId: string) => [
    "chat-attachment-preview",
    serverId,
    attachmentId,
  ],
};
