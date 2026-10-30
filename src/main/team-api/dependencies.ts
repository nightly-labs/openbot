import type { Effect } from "effect";
import type { ChannelService } from "../../backend/channel-service";
import type { AcpRegistry } from "../acp-registry";
import type { AgentAccessStore } from "../agent-access-store";
import type { AgentAdminSettingsService } from "../agent-admin-settings";
import type { AgentHostSettingsService } from "../agent-host-settings";
import type { AgentMarketplaceService } from "../agent-marketplace-service";
import type { AgentMemoryLimitSetting } from "../agent-memory-limit-preference-store";
import type { AgentTemplateService } from "../agent-template-service";
import type { BrowserProfileService } from "../browser-profile-service";
import type { PeerCustomProviderChanges } from "../custom-provider-changes";
import type { HostEventsApi } from "../host-events-api";
import type { HostEventsService } from "../host-events-service";
import type { HostReleaseService } from "../host-release-service";
import type { HostService } from "../host-service";
import type { MachineAlertMonitor } from "../machine-alerts";
import type { MemoryReviewPreferenceStore } from "../memory-review-preference-store";
import type { PreferenceFileFailure } from "../preference-file";
import type { PromptCacheTtlPreferenceStore } from "../prompt-cache-ttl-preference-store";
import type { ProviderCredentialStore } from "../provider-credential-store";
import type { ProviderRuntimeManager } from "../provider-runtime-manager";
import type { RemoteWorkflowError } from "../remote-service-effects";
import type { RequestedUpdate } from "../requested-update";
import type { ServerTimezonePreferenceStore } from "../server-timezone-preference-store";
import type { SkillMarketplaceService } from "../skill-marketplace-service";
// What `TeamApiServer` needs from the rest of the main process, and nothing else.
//
// Every service arrives as a `Pick<>` of the real class. The point is not brevity: the Team API is
// reachable from outside the machine, so the narrow type is the written-down list of what a remote
// caller can eventually reach, and widening one to the whole store is how something that was never
// meant to be remote becomes remote. The route modules under this directory each declare their own
// still-narrower `*RouteDependencies` over these.

import type {
  AgentEvent,
  AgentModelId,
  AgentNotificationLevelsSnapshot,
  AgentProviderId,
  CentralAuthUser,
  DirectMessageRealtimeEvent,
  DirectTypingRealtimeEvent,
  RoutineResultConnectionOption,
  RoutineResultDestination,
  RoutineResultRoutineInput,
  SaveSetupInput,
  ServerNotificationLevel,
  SetAgentNotificationLevelInput,
  SetRoutineResultDestinationInput,
  SidebarLayoutSnapshot,
  TeamPresenceSnapshot,
  UpdateHostIdentityInput,
} from "@openbot/contracts/ipc";
import type { Logger } from "@openbot/logging";
import type { AgentService } from "../../backend/agent-service";
import type { BrowserHost } from "../../backend/browser-host";
import type { MailboxStore } from "../../backend/mailbox-store";
import type { MessagingService } from "../../backend/messaging/messaging-service";
import type { RoutineFlowsHandle } from "../../backend/routine-flows/routine-flows";
import type { SidebarLayoutStore } from "../../backend/sidebar-layout-store";
import type { StorageUsageService } from "../../backend/storage-usage";
import type { TeamChatStore } from "../../backend/team-chat-store";
import type { WorkflowsHandle } from "../../backend/workflows/workflows";
import type { AgentImportService } from "../agent-import-service";
import type { BitwardenConnectorService } from "../bitwarden-connector-service";
import type { BrowserViewGateway } from "../browser-view-gateway";
import type { GitHubConnectorService } from "../github-connector-service";
import type { HostedSiteDesktopService } from "../hosted-site-service";
import type { InstanceTransferService } from "../instance-transfer-service";
import type { McpToolRuntimePreparation } from "../ipc/mcp-server-handlers";
import type { LiveActivityPushService } from "../live-activity-push";
import type { McpHostSignIns } from "../mcp-host-sign-ins";
import type { OnePasswordConnectorService } from "../onepassword-connector-service";
import type { ProviderAccountsHost } from "../provider-accounts-host";
import type { ProviderHostSignIns } from "../provider-host-sign-ins";
import type { PushNotificationService } from "../push-notifications";
import type { RemoteScreenGateway } from "../remote-screen-gateway";
import type { SignInRelayHost } from "../sign-in-relay-host";
import type { TeamStore } from "../team-store";
import type { VaultService } from "../vault-service";

type TeamApiAgentMethods = Pick<
  AgentService,
  | "preferredProvider"
  | "newAgentProvider"
  | "getStatus"
  | "getRuntimeSnapshot"
  | "getUsage"
  | "getAnalytics"
  | "getHostAnalytics"
  | "listModels"
  | "listAgents"
  | "sidebarChatIds"
  | "listConversationReads"
  | "generateProfile"
  | "askSideQuestion"
  | "saveProfile"
  | "createAgent"
  | "committedAgentDuplication"
  | "duplicateAgent"
  | "commitAgentDuplication"
  | "updateAgent"
  | "deleteAgent"
  | "getMemorySelection"
  | "setMemoryInclusion"
  | "listMemories"
  | "createMemory"
  | "updateMemory"
  | "deleteMemory"
  | "clearMemories"
  | "listRoutines"
  | "createRoutine"
  | "updateRoutine"
  | "deleteRoutine"
  | "testRoutine"
  | "listRoutineRuns"
  | "listChannelMemories"
  | "createChannelMemory"
  | "updateChannelMemory"
  | "deleteChannelMemory"
  | "clearChannelMemories"
  | "listChannelRoutines"
  | "createChannelRoutine"
  | "updateChannelRoutine"
  | "deleteChannelRoutine"
  | "testChannelRoutine"
  | "listChannelRoutineRuns"
  | "setAvatar"
  | "resolveAvatar"
  | "readConversation"
  | "readConversationFor"
  | "readConversationPageFor"
  | "searchConversationMessages"
  | "searchConversationFiles"
  | "markConversationRead"
  | "markConversationUnread"
  | "prepareImportedAttachments"
  | "discardDraftAttachment"
  | "resolveSharedFile"
  | "resolveWorkspaceFile"
  | "listWorkspaceDirectory"
  | "sendMessage"
  | "listQueue"
  | "acknowledgeFailedTurn"
  | "setMessageReaction"
  | "cancelQueuedMessage"
  | "steerQueuedMessage"
  | "updateQueuedMessage"
  | "editQueuedMessage"
  | "reorderQueue"
  | "interrupt"
  | "clearAgentContext"
  | "agentIdForRequest"
  | "respondToPrompt"
  | "respondToApproval"
  | "respondToBrowserSecret"
  | "respondToBrowserTakeover"
>;

export type TeamApiAgents = TeamApiAgentMethods & {
  on: (event: "event", listener: (event: AgentEvent) => void) => void;
  off: (event: "event", listener: (event: AgentEvent) => void) => void;
};

/**
 * The MCP half of `AgentService`, kept as its own option rather than folded into `TeamApiAgents`:
 * its presence is what `#protocolSupport` advertises the capability on, exactly as `channels` is.
 */
export type TeamApiMcpServers = Pick<
  AgentService,
  "listMcpServers" | "saveMcpServer" | "removeMcpServer" | "setMcpServerEnabled" | "testMcpServer"
>;

/** Its presence, beside `mcpServers`, is what `#protocolSupport` advertises `mcp-sign-in-v1` on. */
export type TeamApiMcpSignIns = Pick<
  McpHostSignIns,
  "start" | "status" | "cancel" | "signOut" | "list" | "app" | "saveApp" | "removeApp"
>;

/** `connectors-v1`: the GitHub connection and the messaging connections of this host. */
export interface TeamApiConnectors {
  github: Pick<GitHubConnectorService, "status" | "pages" | "connect" | "cancel" | "disconnect" | "repositories">;
  messaging: Pick<
    MessagingService,
    | "slackOverview"
    | "discordOverview"
    | "telegramOverview"
    | "connectSlackWorkspace"
    | "connectDiscordGuild"
    | "connectTelegramChat"
    | "completeSlackWorkspace"
    | "completeDiscordGuild"
    | "disconnectSlackWorkspace"
    | "disconnectDiscordGuild"
    | "disconnectTelegramChat"
    | "reconnect"
    | "setEnabled"
    | "addOrchestrator"
    | "addTelegramOrchestrator"
    | "discordAccess"
    | "listDiscordRoles"
    | "setDiscordAccess"
  >;
}

/**
 * Its presence, beside `mcpServers`, is what `#protocolSupport` advertises `sign-in-relay-v1` on, and
 * beside `providerAccounts` too, `provider-account-relay-v1`.
 */
export type TeamApiSignInRelay = Pick<
  SignInRelayHost,
  "startMcp" | "startProvider" | "startProviderAccount" | "startLink" | "status" | "complete" | "cancel"
>;

/**
 * Its presence is what `#protocolSupport` advertises `provider-host-sign-in-v1` on. Only a Linux host
 * passes it: there the Gemini CLI prints its sign-in page instead of opening a browser.
 */
export type TeamApiProviderHostSignIns = Pick<ProviderHostSignIns, "start" | "status" | "cancel">;

/** Its presence is what `#protocolSupport` advertises `provider-accounts-v1` on. The routes are admin-only. */
export type TeamApiProviderAccounts = Pick<
  ProviderAccountsHost,
  "list" | "usage" | "startSignIn" | "signInStatus" | "cancelSignIn" | "rename" | "remove" | "setAgentAccount"
>;

/** Its presence is what `#protocolSupport` advertises `provider-usage-reset-v1` on. The routes are admin-only. */
export type TeamApiProviderUsageResets = Pick<AgentService, "providerUsageResets" | "resetProviderUsage">;

/** Its presence is what `#protocolSupport` advertises `provider-sign-out-v1` on. The route is admin-only. */
export type TeamApiProviderSignOut = Pick<AgentService, "signOutProvider">;

/** Its presence is what `#protocolSupport` advertises `storage-v1` and `storage-disk-v1` on. */
export type TeamApiStorage = Pick<StorageUsageService, "usage" | "deleteFile" | "clear" | "disk">;
/** `machine-resources-v1`: the machine use and its alerts. The routes are admin-only. */
export type TeamApiMachine = Pick<
  MachineAlertMonitor,
  "metrics" | "alerts" | "setAlerts" | "canBeResponsible" | "pending" | "subscribe"
>;
/** `hosted-sites-v1`: the openbot.site sites of this server. Members list; only admins delete. */
export type TeamApiHostedSites = Pick<HostedSiteDesktopService, "listServerSites" | "deleteServerSite">;

/** Its presence is what `#protocolSupport` advertises `agent-hidden-v1` on. Any member can use it. */
export type TeamApiHiddenAgents = Pick<AgentService, "listHiddenAgents" | "setAgentHidden">;

/**
 * `agent-notification-levels-v1`: the level that each member chose for this server and for each agent.
 * The host keeps the levels of the owner under one key, so its desktop app and its phones read the
 * same levels.
 */
export interface TeamApiAgentNotificationLevels {
  snapshot(memberId: string, hidden: ReadonlySet<string>): AgentNotificationLevelsSnapshot;
  set(memberId: string, input: SetAgentNotificationLevelInput): Effect.Effect<unknown, PreferenceFileFailure>;
  setServer(memberId: string, level: ServerNotificationLevel | null): Effect.Effect<unknown, PreferenceFileFailure>;
  /** Calls `listener` with the member after each change of their levels, from any of their devices. */
  subscribe(listener: (memberId: string) => void): () => void;
}

/**
 * Its presence is what `#protocolSupport` advertises `agent-tasks-v1` and `agent-threads-v1` on. A member
 * who can send a message to the agent can use it. Moving a queued message into a task stays local.
 */
export type TeamApiAgentTasks = Pick<
  AgentService,
  | "listAgents"
  | "listTasks"
  | "readTask"
  | "startTask"
  | "sendMessage"
  | "stopTask"
  | "closeTask"
  | "reopenTask"
  | "renameTask"
  | "deleteTask"
  | "listTaskReads"
  | "markTaskRead"
>;

/**
 * Its presence is what `#protocolSupport` advertises `browser-profiles-v1` on. Only admins change
 * profiles; any member reads the profile labels of the tabs they can see.
 */
export type TeamApiBrowserProfiles = BrowserProfileService;

/** Its presence is what `#protocolSupport` advertises `agent-import-v1` on. Any member can use it. */
export type TeamApiAgentImport = Pick<AgentImportService, "stageUpload" | "apply" | "discard">;

/** Its presence is what `#protocolSupport` advertises `instance-transfer-v1` on. Only admins use it. */
export type TeamApiInstanceTransfer = Pick<
  InstanceTransferService,
  "summary" | "exportForMember" | "stageUpload" | "apply" | "discard"
>;

/**
 * Its presence is what `#protocolSupport` advertises `routine-flows-v1` on. Any member who can see
 * every agent a flow touches can use it.
 */
export type TeamApiRoutineFlows = Pick<
  RoutineFlowsHandle,
  "canvas" | "savePosition" | "removePosition" | "connect" | "disconnect" | "updateLink" | "agentsOf"
>;

/**
 * Its presence is what `#protocolSupport` advertises `workflows-v1` on. Any member who can see every
 * agent of a workflow can use it; see `workflows-v1.ts` for the grant.
 */
export type TeamApiWorkflows = Pick<
  WorkflowsHandle,
  | "list"
  | "listWithGraphs"
  | "get"
  | "create"
  | "rename"
  | "remove"
  | "saveGraph"
  | "versions"
  | "restoreVersion"
  | "versionGraph"
  | "startRun"
  | "runStep"
  | "stopStep"
  | "stopRun"
  | "retryStep"
  | "decide"
  | "runs"
  | "run"
  | "workflowOf"
> &
  Pick<HostEventsService, "rotateWorkflowSecret">;

/** The setup choice of this computer: the same file and the same service step as the local Settings save. */
interface TeamApiDefaultProvider {
  get(): Effect.Effect<ProviderDefaultSetting, { readonly cause: unknown }>;
  set(input: SaveSetupInput): Effect.Effect<ProviderDefaultSetting, { readonly cause: unknown }>;
}

export interface ProviderDefaultSetting {
  provider: AgentProviderId | null;
  model: AgentModelId | null;
}

/**
 * The admin routes, one member per optional capability. A member's presence is what
 * `#protocolSupport` advertises its capability on; every route behind it requires an owner or admin.
 */
export interface TeamApiAdmin {
  acpRegistry?: {
    [Method in "search" | "listInstalled" | "status" | "install" | "cancel" | "uninstall"]: OmitThisParameter<
      AcpRegistry[Method]
    >;
  };
  /** Read-only release discovery, independent of permission to install. */
  release?: Pick<HostReleaseService, "snapshot" | "check">;
  /** `agent-admin-v1`: access and auto-approve of one agent. */
  agents?: AgentAdminSettingsService;
  /**
   * `agent-host-settings-v1`: Computer Use, local scripts and the busy-message mode of one agent.
   * `agent-backup-models-v1`: its backup models.
   * `agent-task-limit-v1`: how many of its tasks run at the same time.
   */
  agentHost?: AgentHostSettingsService;
  sessionSettings?: Pick<
    AgentService,
    "readAgentSessionSettings" | "setAgentSessionSetting" | "resetAgentSessionSetting"
  >;
  /** `skills-admin-v1`: list, install, remove and enable the skills of one agent. */
  skills?: Pick<SkillMarketplaceService, "listInstalled" | "install" | "uninstall" | "setEnabled">;
  /** `shared-tables-v1`: list and delete the tables the agents share. */
  sharedTables?: Pick<AgentService, "listTables" | "deleteTable">;
  /**
   * `agent-install-v1`: add an agent from a marketplace listing or a shared template. Both must be set.
   * `agent-update-v1`: update an agent from a listing; needs only `marketplaceAgents`.
   * `agent-publish-v1`: publish, update and unpublish an agent's share link; needs only `agentTemplates`.
   */
  marketplaceAgents?: Pick<AgentMarketplaceService, "install">;
  agentTemplates?: Pick<AgentTemplateService, "install" | "preview" | "publish" | "unpublish">;
  /** `providers-v1`: code sign-in, provider API keys, managed CLI runtimes and custom endpoints. */
  providers?: TeamApiProviders;
  /** `host-admin-v1`: the server name and logo. */
  identity?: TeamApiHostIdentity;
  /** `host-update-v1`: the app update of this computer. Advertised also when the host user turned it off. */
  update?: Pick<RequestedUpdate, "snapshot" | "check" | "start" | "requestWhenIdle" | "cancel" | "changeSettings">;
  /** `host-timezone-v1`: the server timezone. */
  timezone?: Pick<ServerTimezonePreferenceStore, "get" | "set">;
  /** `agent-memory-limit-v1`: how many memories each agent of this computer can keep. */
  memoryLimit?: AgentMemoryLimitSetting;
  /** `memory-review-v1`: how often this computer's agents review their memories in the background. */
  memoryReview?: MemoryReviewPreferenceStore;
  /** `prompt-cache-ttl-v1`: how long the provider keeps the prompt cache of this computer's agents. */
  promptCacheTtl?: Pick<PromptCacheTtlPreferenceStore, "get" | "set">;
  /** `provider-default-v1`: the provider and model that a new agent of this computer starts on. */
  defaultProvider?: TeamApiDefaultProvider;
  /** `routine-results-v1`: the place where an agent routine sends its answers. */
  routineResults?: TeamApiRoutineResults;
}

/** A failure keeps its cause; a `RoutineResultError` cause is a refusal that the reader sees. */
interface TeamApiRoutineResults {
  options(): Effect.Effect<RoutineResultConnectionOption[]>;
  destination(
    input: RoutineResultRoutineInput,
  ): Effect.Effect<RoutineResultDestination | null, { readonly cause: unknown }>;
  setDestination(
    input: SetRoutineResultDestinationInput,
  ): Effect.Effect<RoutineResultDestination | null, { readonly cause: unknown }>;
}

interface TeamApiHostIdentity {
  updateIdentity(input: UpdateHostIdentityInput): Effect.Effect<void, RemoteWorkflowError>;
}

interface TeamApiProviders {
  service: Pick<
    AgentService,
    | "startProviderCodeLogin"
    | "submitProviderCodeLogin"
    | "cancelProviderCodeLogin"
    | "changeProviderCredential"
    | "clearProviderCredential"
  >;
  credentials: Pick<ProviderCredentialStore, "status" | "set" | "clear">;
  runtimes: Pick<
    ProviderRuntimeManager,
    "getStatus" | "download" | "cancel" | "checkForUpdates" | "startKeyProviderCli"
  >;
  customProviders: PeerCustomProviderChanges;
  /**
   * Whether this host can run the Claude pasted-code sign-in. `providers-v3` promises it, so a host
   * that cannot does not advertise `providers-v3`, and its clients keep the Codex-only `providers-v1`.
   */
  pasteSignIn: boolean;
}

export type TeamApiMailbox = Pick<MailboxStore, "resolveAttachment">;
export type TeamApiSidebarLayout = Pick<
  SidebarLayoutStore,
  "getSnapshot" | "mutate" | "removeAgent" | "placeDuplicateAfter" | "withProfileAssignment"
> & {
  on: (event: "changed", listener: (layout: SidebarLayoutSnapshot) => void) => void;
  off: (event: "changed", listener: (layout: SidebarLayoutSnapshot) => void) => void;
};
export type TeamApiBrowser = Pick<
  BrowserHost,
  | "listTabs"
  | "getControlState"
  | "open"
  | "activate"
  | "navigate"
  | "reload"
  | "close"
  | "capturePreview"
  | "setVisible"
  | "getDisplayState"
  | "loadUrl"
  | "isPrivate"
  // A person's control of a tab, behind `browser-user-control`.
  | "takeUserControl"
  | "releaseUserControl"
  | "releaseUserControlHeldBy"
  // Behind `browser-page-state`.
  | "stop"
  // Behind `browser-sign-in`.
  | "importSignIn"
  // The live view, behind `browser-view`. `browser-view-gateway.ts` is what reaches these; a route
  // cannot, because frames outlive the request that asked for them.
  | "startView"
  | "dispatchViewInput"
  | "copyViewSelection"
>;
export type TeamApiBrowserView = Pick<
  BrowserViewGateway,
  "handlesUpgrade" | "handleUpgrade" | "stop" | "createSession" | "closeMemberSession" | "revokeTeamSession"
>;
export type TeamApiRemoteScreen = Pick<
  RemoteScreenGateway,
  | "handlesUpgrade"
  | "handleUpgrade"
  | "handlesHttp"
  | "handleHttp"
  | "stop"
  | "capabilities"
  | "createSession"
  | "selectDisplay"
  | "closeMemberSession"
  | "revokeTeamSession"
  | "revokeMember"
> &
  Partial<Pick<RemoteScreenGateway, "checkSetup" | "test">>;

/** `onepassword-connector-v1`: the 1Password connection of this host, by a service account token. */
export type TeamApiOnePasswordConnector = Pick<
  OnePasswordConnectorService,
  "status" | "refreshLogins" | "connectWithToken" | "disconnect"
>;

/** `bitwarden-connector-v1`: the Bitwarden connection of this host, by an API key and the master password. */
export type TeamApiBitwardenConnector = Pick<BitwardenConnectorService, "status" | "connectWithApiKey" | "disconnect">;

/** `vault-v1`: the Vault of this host, for an owner or admin. The route uses no CSV import. */
export type TeamApiVault = VaultService;

export type TeamApiAgentAccess = Pick<AgentAccessStore, "copyAgent" | "get" | "levels" | "set" | "subscribe">;

export interface TeamApiOptions {
  /** `events-v1`: admin-only event source and routine management. */
  events?: HostEventsApi | undefined;
  channels?: ChannelService | undefined;
  mcpServers?: TeamApiMcpServers | undefined;
  mcpSignIns?: TeamApiMcpSignIns | undefined;
  signInRelay?: TeamApiSignInRelay | undefined;
  connectors?: TeamApiConnectors | undefined;
  onePasswordConnector?: TeamApiOnePasswordConnector | undefined;
  bitwardenConnector?: TeamApiBitwardenConnector | undefined;
  vault?: TeamApiVault | undefined;
  providerHostSignIns?: TeamApiProviderHostSignIns | undefined;
  providerAccounts?: TeamApiProviderAccounts | undefined;
  providerUsageResets?: TeamApiProviderUsageResets | undefined;
  providerSignOut?: TeamApiProviderSignOut | undefined;
  /** Starts and waits for the managed tool runtimes behind the MCP save, enable, and test routes. */
  mcpToolRuntimePreparation?: McpToolRuntimePreparation;
  storage?: TeamApiStorage;
  machine?: TeamApiMachine;
  hostedSites?: TeamApiHostedSites;
  agentImport?: TeamApiAgentImport;
  instanceTransfer?: TeamApiInstanceTransfer;
  routineFlows?: TeamApiRoutineFlows;
  workflows?: TeamApiWorkflows;
  hiddenAgents?: TeamApiHiddenAgents;
  agentNotificationLevels?: TeamApiAgentNotificationLevels;
  /** `agent-access-v1`: the roles that limit what a member can do with each agent. */
  agentAccess?: TeamApiAgentAccess;
  agentTasks?: TeamApiAgentTasks;
  browserProfiles?: TeamApiBrowserProfiles;
  admin?: TeamApiAdmin;
  appVersion?: string;
  store: TeamStore;
  agents: TeamApiAgents;
  /**
   * Waits for the agent initialization in progress. A host that wakes publishes before its agents
   * load, and an empty roster then would tell a peer that the server has no agents.
   */
  agentsReady?: (() => Effect.Effect<void>) | undefined;
  skills?: Pick<SkillMarketplaceService, "listInstalledForChatTags"> | undefined;
  sidebarLayout?: TeamApiSidebarLayout | undefined;
  mailbox: TeamApiMailbox;
  browser: TeamApiBrowser;
  browserView?: TeamApiBrowserView | undefined;
  remoteScreen?: TeamApiRemoteScreen | undefined;
  redeemCentralTicket?: (
    ticket: string,
    serverId: string,
  ) => Effect.Effect<CentralAuthUser | null, RemoteWorkflowError>;
  onPresence?: ((snapshot: TeamPresenceSnapshot) => void) | undefined;
  chat?: TeamChatStore | undefined;
  onDirectMessage?: ((event: DirectMessageRealtimeEvent) => void) | undefined;
  onDirectTyping?: ((event: DirectTypingRealtimeEvent) => void) | undefined;
  createInvite?: OmitThisParameter<HostService["createInvite"]> | undefined;
  /**
   * Changes and removes members as the desktop app does. With an OpenBot account, the account
   * directory holds the membership; a change only in the team file has no effect there.
   */
  updateMember?: OmitThisParameter<HostService["updateMember"]> | undefined;
  removeMember?: OmitThisParameter<HostService["removeMember"]> | undefined;
  onSessionRevoked?: ((sessionId: string) => Effect.Effect<void, RemoteWorkflowError>) | undefined;
  /** Sends Live Activity updates to members' phones. Absent when this host has no account credential. */
  liveActivityPush?: LiveActivityPushService | undefined;
  /** Sends notifications to members' phones. Absent when this host has no account credential. */
  pushNotifications?: PushNotificationService | undefined;
  /** `focus-use-v1`: true on a hosted server, where a focused app keeps the server running. */
  focusUse?: boolean | undefined;
  rateLimitCapacity?: number | undefined;
  now?: (() => number) | undefined;
  logger?: Logger | undefined;
}
