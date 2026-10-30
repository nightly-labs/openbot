import type { AgentProviderId } from "@openbot/contracts/ipc";

/**
 * The API URL, user ID and session scope that start each account query key. A new session changes
 * the scope, so a read that started for the old session cannot fill the cache of the new one.
 */
export type QueryScope = readonly [apiUrl: string | null | undefined, userId: string | undefined, sessionScope: number];

/** The agent records that a single-part key ends in. */
type AgentRecordPart = "memories" | "memory-selection" | "routines" | "storage" | "admin" | "host" | "publish";

/**
 * The last parts of the agent records that are not in the agent summary. The host sends
 * `agents-changed` when one of them changes, so an open settings page reads them again.
 */
export const AGENT_SETTINGS_PARTS: readonly string[] = ["admin", "host", "session-settings", "provider-accounts"];

/**
 * Every query key of the app. The host events invalidate them by prefix, so a key that a reader
 * builds in another shape does not refresh. A function with an optional tail returns the prefix
 * without it.
 */
export const queryKeys = {
  accountSessions: (...scope: [QueryScope] | []) => ["account-sessions", ...(scope[0] ?? [])],
  hostedServerPlans: (...scope: [QueryScope] | []) => ["hosted-server-plans", ...(scope[0] ?? [])],
  agentTemplate: (apiUrl: string | null, templateId: string | null) => ["agent-template", apiUrl, templateId],
  /** The public Marketplace catalog of one account service: a list read, or one listing. */
  marketplace: (apiUrl: string | null, ...parts: (string | null)[]) => ["marketplace", apiUrl, ...parts],

  /** Every agent record. Without a scope, the records of all accounts and servers. */
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
  /** Under the agent's routines, so the routine change events reload this list too. */
  agentEventRoutines: (scope: QueryScope, serverId: string, agentId: string) => [
    ...queryKeys.agentRecord(scope, serverId, agentId, "routines"),
    "events",
  ],
  /** Under the agent's routines, so the routine change events reload them too. */
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
  /** The options depend on the provider and the model, so each pair has its own entry. */
  agentSessionSettings: (
    scope: QueryScope,
    serverId: string,
    agentId: string,
    provider: AgentProviderId | undefined,
    model: string | undefined,
  ) => [...queryKeys.agentInfo(scope, serverId, agentId), provider, model, "session-settings"],
  /** Under the server's agent records, so the host's agent events refresh it. */
  sharedTables: (scope: QueryScope, serverId: string) => [...queryKeys.agentInfo(scope, serverId), "tables"],
  /** The settings of a channel. Its memory and routine events invalidate the part they change. */
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
  agentModels: (scope: QueryScope, serverId: string) => ["agent-models", ...scope, serverId],

  serverMembers: (scope: QueryScope, serverId: string) => ["server-members", ...scope, serverId],
  serverInvites: (scope: QueryScope, serverId: string) => ["server-invites", ...scope, serverId],
  serverTimezone: (scope: QueryScope, serverId: string) => ["server-timezone", ...scope, serverId],
  agentMemoryLimit: (scope: QueryScope, serverId: string) => ["agent-memory-limit", ...scope, serverId],
  serverRoles: (scope: QueryScope, serverId: string) => ["server-roles", ...scope, serverId],
  serverConnector: (scope: QueryScope, serverId: string, connector: string) => [
    "server-connector",
    ...scope,
    serverId,
    connector,
  ],
  serverUpdate: (scope: QueryScope, serverId: string) => ["server-update", ...scope, serverId],
  serverStorage: (scope: QueryScope, serverId: string) => ["server-storage", ...scope, serverId],
  serverSites: (scope: QueryScope, serverId: string) => ["server-sites", ...scope, serverId],
  serverVault: (scope: QueryScope, serverId: string) => ["server-vault", ...scope, serverId],
  providerStatus: (scope: QueryScope, serverId: string) => ["provider-status", ...scope, serverId],
  providerRuntimes: (scope: QueryScope, serverId: string) => ["provider-runtimes", ...scope, serverId],
  providerDefault: (scope: QueryScope, serverId: string) => ["provider-default", ...scope, serverId],
  providerKey: (scope: QueryScope, serverId: string, provider: string) => [
    "provider-key",
    ...scope,
    serverId,
    provider,
  ],
  mcpServers: (scope: QueryScope, serverId: string) => ["mcp-servers", ...scope, serverId],
  mcpSignIns: (scope: QueryScope, serverId: string) => ["mcp-sign-ins", ...scope, serverId],
  serverLogo: (scope: QueryScope, serverId: string, ...logo: [] | [logoKey: string | null]) => [
    "server-logo",
    ...scope,
    serverId,
    ...logo,
  ],
  /** The plan limits of a server's providers. The host's `usage-changed` event writes the providers' own sign-ins. */
  planLimits: (scope: QueryScope, serverId: string) => ["plan-limits", ...scope, serverId],
  serverUsage: (scope: QueryScope, serverId: string, range: unknown, agentId: string | undefined) => [
    "server-usage",
    ...scope,
    serverId,
    range,
    agentId,
  ],
  /** The routine calendar of a server. Its routine and turn events invalidate the prefix. */
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
  /** The tasks of a server. The task events write the lists and the conversations under this prefix. */
  serverTasks: (scope: QueryScope, serverId: string) => ["server-tasks", ...scope, serverId],
  agentTasks: (scope: QueryScope, serverId: string, agentId: string) => [
    ...queryKeys.serverTasks(scope, serverId),
    "agent",
    agentId,
  ],
  /** The person's read mark of each open thread of one agent, from `agent-thread-reads-v1`. */
  agentThreadReads: (scope: QueryScope, serverId: string, agentId: string) => [
    ...queryKeys.serverTasks(scope, serverId),
    "reads",
    agentId,
  ],
  agentTaskConversation: (scope: QueryScope, serverId: string, taskId: string) => [
    ...queryKeys.serverTasks(scope, serverId),
    "task",
    taskId,
  ],
  /** The workflows of a server. `workflows-changed` invalidates the list and the one workflow under it. */
  serverWorkflows: (scope: QueryScope, serverId: string) => ["server-workflows", ...scope, serverId],
  workflowList: (scope: QueryScope, serverId: string) => [...queryKeys.serverWorkflows(scope, serverId), "list"],
  /** A workflow, its newest runs, all its runs page by page, and a run that is older than the first page. */
  workflow: (
    scope: QueryScope,
    serverId: string,
    workflowId: string,
    ...part: [] | ["detail"] | ["runs"] | ["history"] | ["run", runId: string]
  ) => [...queryKeys.serverWorkflows(scope, serverId), "workflow", workflowId, ...part],
  /** The query is the last part: a search that continues the typed query keeps its results on screen. */
  messageSearch: (scope: QueryScope, serverId: string, query: string) => ["message-search", ...scope, serverId, query],
  fileSearch: (scope: QueryScope, serverId: string, query: string) => ["file-search", ...scope, serverId, query],

  /** The ignored webhook requests. A routine change also invalidates them. */
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
};
