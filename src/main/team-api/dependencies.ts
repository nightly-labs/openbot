import type { ChannelService } from "../../backend/channel-service";
import type { AgentAdminSettingsService } from "../agent-admin-settings";
import type { AgentMarketplaceService } from "../agent-marketplace-service";
import type { AgentTemplateService } from "../agent-template-service";
import type { CustomProviderChanges } from "../custom-provider-changes";
import type { ProviderCredentialStore } from "../provider-credential-store";
import type { ProviderRuntimeManager } from "../provider-runtime-manager";
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
  CreateTeamInviteInput,
  DirectMessageRealtimeEvent,
  DirectTypingRealtimeEvent,
  InstalledSkill,
  InviteSummary,
  SidebarLayoutSnapshot,
  TeamPresenceSnapshot,
  UpdateHostIdentityInput,
} from "@openbot/contracts/ipc";
import type { Logger } from "@openbot/logging";
import type { AgentService } from "../../backend/agent-service";
import type { BrowserHost } from "../../backend/browser-host";
import type { MailboxStore } from "../../backend/mailbox-store";
import type { SidebarLayoutStore } from "../../backend/sidebar-layout-store";
import type { StorageUsageService } from "../../backend/storage-usage";
import type { TeamChatStore } from "../../backend/team-chat-store";
import type { BrowserViewGateway } from "../browser-view-gateway";
import type { McpToolRuntimePreparation } from "../ipc/mcp-server-handlers";
import type { RemoteScreenGateway } from "../remote-screen-gateway";
import type { TeamStore } from "../team-store";

type TeamApiAgentMethods = Pick<
  AgentService,
  | "preferredProvider"
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
  | "readConversationFor"
  | "readConversationPageFor"
  | "searchConversationMessages"
  | "markConversationRead"
  | "markConversationUnread"
  | "prepareImportedAttachments"
  | "discardDraftAttachment"
  | "resolveSharedFile"
  | "resolveWorkspaceFile"
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

/**
 * The admin routes, one member per optional capability. A member's presence is what
 * `#protocolSupport` advertises its capability on; every route behind it requires an owner or admin.
 */
export interface TeamApiAdmin {
  /** `agent-admin-v1`: access and auto-approve of one agent. */
  agents?: AgentAdminSettingsService;
  /** `skills-admin-v1`: list, install, remove and enable the skills of one agent. */
  skills?: Pick<SkillMarketplaceService, "listInstalled" | "install" | "uninstall" | "setEnabled">;
  /** `shared-tables-v1`: list and delete the tables the agents share. */
  sharedTables?: Pick<AgentService, "listTables" | "deleteTable">;
  /**
   * `agent-install-v1`: add an agent from a marketplace listing or a shared template. Both must be set.
   * `agent-update-v1`: update an agent from a listing; needs only `marketplaceAgents`.
   */
  marketplaceAgents?: Pick<AgentMarketplaceService, "install">;
  agentTemplates?: Pick<AgentTemplateService, "install">;
  /** `providers-v1`: code sign-in, provider API keys, managed CLI runtimes and custom endpoints. */
  providers?: TeamApiProviders;
  /** `host-admin-v1`: the server name and logo. */
  identity?: TeamApiHostIdentity;
}

interface TeamApiHostIdentity {
  updateIdentity(input: UpdateHostIdentityInput): Promise<unknown>;
}

interface TeamApiProviders {
  service: Pick<AgentService, "startProviderCodeLogin" | "cancelProviderCodeLogin" | "changeProviderCredential">;
  credentials: Pick<ProviderCredentialStore, "status" | "set" | "clear">;
  runtimes: Pick<ProviderRuntimeManager, "getStatus" | "download" | "cancel" | "checkForUpdates">;
  customProviders: CustomProviderChanges;
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
  channels?: ChannelService;
  mcpServers?: TeamApiMcpServers;
  /** Starts and waits for the managed tool runtimes behind the MCP save, enable, and test routes. */
  mcpToolRuntimePreparation?: McpToolRuntimePreparation;
  storage?: TeamApiStorage;
  admin?: TeamApiAdmin;
  appVersion?: string;
  store: TeamStore;
  agents: TeamApiAgents;
  skills?: { listInstalledForChatTags: (agentId: string) => Promise<InstalledSkill[]> };
  sidebarLayout?: TeamApiSidebarLayout;
  mailbox: TeamApiMailbox;
  browser: TeamApiBrowser;
  browserView?: TeamApiBrowserView;
  remoteScreen?: TeamApiRemoteScreen;
  redeemCentralTicket?: (ticket: string, serverId: string) => Promise<CentralAuthUser | null>;
  onPresence?: (snapshot: TeamPresenceSnapshot) => void;
  chat?: TeamChatStore;
  onDirectMessage?: (event: DirectMessageRealtimeEvent) => void;
  onDirectTyping?: (event: DirectTypingRealtimeEvent) => void;
  createInvite?: (input: CreateTeamInviteInput) => Promise<InviteSummary>;
  onSessionRevoked?: (sessionId: string) => Promise<void> | void;
  rateLimitCapacity?: number;
  now?: () => number;
  logger?: Logger;
}
