import type { Effect } from "effect";
import type { ChannelService } from "../../backend/channel-service";
import type { AgentAdminSettingsService } from "../agent-admin-settings";
import type { AgentMarketplaceService } from "../agent-marketplace-service";
import type { AgentTemplateService } from "../agent-template-service";
import type { PeerCustomProviderChanges } from "../custom-provider-changes";
import type { HostEventsApi } from "../host-events-api";
import type { HostReleaseService } from "../host-release-service";
import type { HostService } from "../host-service";
import type { ProviderCredentialStore } from "../provider-credential-store";
import type { ProviderRuntimeManager } from "../provider-runtime-manager";
import type { RemoteWorkflowError } from "../remote-service-effects";
import type { RequestedUpdate } from "../requested-update";
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
  CentralAuthUser,
  DirectMessageRealtimeEvent,
  DirectTypingRealtimeEvent,
  SidebarLayoutSnapshot,
  TeamPresenceSnapshot,
  UpdateHostIdentityInput,
} from "@openbot/contracts/ipc";
import type { Logger } from "@openbot/logging";
import type { AgentService } from "../../backend/agent-service";
import type { BrowserHost } from "../../backend/browser-host";
import type { MailboxStore } from "../../backend/mailbox-store";
import type { RoutineFlowsHandle } from "../../backend/routine-flows/routine-flows";
import type { SidebarLayoutStore } from "../../backend/sidebar-layout-store";
import type { StorageUsageService } from "../../backend/storage-usage";
import type { TeamChatStore } from "../../backend/team-chat-store";
import type { AgentImportService } from "../agent-import-service";
import type { BrowserViewGateway } from "../browser-view-gateway";
import type { HostedSiteDesktopService } from "../hosted-site-service";
import type { McpToolRuntimePreparation } from "../ipc/mcp-server-handlers";
import type { LiveActivityPushService } from "../live-activity-push";
import type { RemoteScreenGateway } from "../remote-screen-gateway";
import type { TeamStore } from "../team-store";

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
  | "saveProfile"
  | "createAgent"
  | "committedAgentDuplication"
  | "duplicateAgent"
  | "commitAgentDuplication"
  | "updateAgent"
  | "deleteAgent"
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

/** Its presence is what `#protocolSupport` advertises `storage-v1` on. */
export type TeamApiStorage = Pick<StorageUsageService, "usage" | "deleteFile" | "clear">;
/** `hosted-sites-v1`: the openbot.site sites of this server. Members list; only admins delete. */
export type TeamApiHostedSites = Pick<HostedSiteDesktopService, "listServerSites" | "deleteServerSite">;

/** Its presence is what `#protocolSupport` advertises `agent-import-v1` on. Any member can use it. */
export type TeamApiAgentImport = Pick<AgentImportService, "stageUpload" | "apply" | "discard">;

/**
 * Its presence is what `#protocolSupport` advertises `routine-flows-v1` on. Any member who can see
 * every agent a flow touches can use it.
 */
export type TeamApiRoutineFlows = Pick<
  RoutineFlowsHandle,
  "canvas" | "savePosition" | "removePosition" | "connect" | "disconnect" | "updateLink" | "agentsOf"
>;

/**
 * The admin routes, one member per optional capability. A member's presence is what
 * `#protocolSupport` advertises its capability on; every route behind it requires an owner or admin.
 */
export interface TeamApiAdmin {
  /** Read-only release discovery, independent of permission to install. */
  release?: Pick<HostReleaseService, "snapshot" | "check">;
  /** `agent-admin-v1`: access and auto-approve of one agent. */
  agents?: AgentAdminSettingsService;
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
}

interface TeamApiHostIdentity {
  updateIdentity(input: UpdateHostIdentityInput): Effect.Effect<void, RemoteWorkflowError>;
}

interface TeamApiProviders {
  service: Pick<
    AgentService,
    "startProviderCodeLogin" | "submitProviderCodeLogin" | "cancelProviderCodeLogin" | "changeProviderCredential"
  >;
  credentials: Pick<ProviderCredentialStore, "status" | "set" | "clear">;
  runtimes: Pick<ProviderRuntimeManager, "getStatus" | "download" | "cancel" | "checkForUpdates">;
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

export interface TeamApiOptions {
  /** `events-v1`: admin-only event source and routine management. */
  events?: HostEventsApi;
  channels?: ChannelService;
  mcpServers?: TeamApiMcpServers;
  /** Starts and waits for the managed tool runtimes behind the MCP save, enable, and test routes. */
  mcpToolRuntimePreparation?: McpToolRuntimePreparation;
  storage?: TeamApiStorage;
  hostedSites?: TeamApiHostedSites;
  agentImport?: TeamApiAgentImport;
  routineFlows?: TeamApiRoutineFlows;
  admin?: TeamApiAdmin;
  appVersion?: string;
  store: TeamStore;
  agents: TeamApiAgents;
  /**
   * Waits for the agent initialization in progress. A host that wakes publishes before its agents
   * load, and an empty roster then would tell a peer that the server has no agents.
   */
  agentsReady?: () => Effect.Effect<void>;
  skills?: Pick<SkillMarketplaceService, "listInstalledForChatTags">;
  sidebarLayout?: TeamApiSidebarLayout;
  mailbox: TeamApiMailbox;
  browser: TeamApiBrowser;
  browserView?: TeamApiBrowserView;
  remoteScreen?: TeamApiRemoteScreen;
  redeemCentralTicket?: (
    ticket: string,
    serverId: string,
  ) => Effect.Effect<CentralAuthUser | null, RemoteWorkflowError>;
  onPresence?: (snapshot: TeamPresenceSnapshot) => void;
  chat?: TeamChatStore;
  onDirectMessage?: (event: DirectMessageRealtimeEvent) => void;
  onDirectTyping?: (event: DirectTypingRealtimeEvent) => void;
  createInvite?: OmitThisParameter<HostService["createInvite"]>;
  onSessionRevoked?: (sessionId: string) => Effect.Effect<void, RemoteWorkflowError>;
  /** Sends Live Activity updates to members' phones. Absent when this host has no account credential. */
  liveActivityPush?: LiveActivityPushService;
  rateLimitCapacity?: number;
  now?: () => number;
  logger?: Logger;
}
