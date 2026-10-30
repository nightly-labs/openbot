import type { AttachmentSupport } from "@openbot/contracts/attachment-files";
import type {
  AddedAgent,
  AddMessagingOrchestratorResult,
  AgentAccessChange,
  AgentAccessSnapshot,
  AgentAdminSettings,
  AgentAnalytics,
  AgentAnalyticsInput,
  AgentHostSettings,
  AgentMemory,
  AgentMemorySelectionState,
  AgentModelId,
  AgentModelOption,
  AgentProviderId,
  AgentReasoningEffort,
  AgentSessionSettings,
  AgentTask,
  AgentTaskInput,
  AgentTaskReadState,
  AgentTasksSnapshot,
  AgentTemplatePreview,
  AgentTemplatePublication,
  AvatarHue,
  AvatarImageInput,
  BitwardenConnectorStatus,
  BitwardenHostConnectInput,
  ClearableStorageCategory,
  ConversationFileSearchPage,
  ConversationSearchPage,
  ConversationSnapshot,
  CreateAgentInput,
  CreateRoutineInput,
  CreateWorkflowInput,
  DecideWorkflowStepInput,
  DraftAttachment,
  ForeignProviderId,
  GitHubConnectorRepositories,
  HostAddMessagingOrchestratorInput,
  HostAgentMemoryLimit,
  HostAnalytics,
  HostAnalyticsInput,
  HostedSiteList,
  HostGitHubConnectorStatus,
  HostMessagingConnectInput,
  HostMessagingWorkspaceInput,
  HostProviderAccounts,
  HostReleaseStatus,
  HostSetMessagingEnabledInput,
  HostTimezoneSettings,
  HostUpdateSettingsChange,
  HostUpdateStatus,
  InstallAgentTemplateInput,
  InstalledSkill,
  InstallMarketplaceAgentInput,
  InstallSkillInput,
  MarkAgentTaskReadInput,
  McpServerConfig,
  McpSignInState,
  McpTestResult,
  MessagingOverview,
  MessagingPlatform,
  OnePasswordConnectorStatus,
  QueuedMessageReceipt,
  QueueSnapshot,
  RenameWorkflowInput,
  ResetAgentSessionSettingInput,
  RespondToApprovalInput,
  RespondToBrowserSecretInput,
  RespondToPromptInput,
  Routine,
  RoutineCalendar,
  RoutineCalendarInput,
  RoutineCalendarOwner,
  RoutineResultConnectionOption,
  RoutineResultDestination,
  RoutineResultRoutineInput,
  SaveWorkflowGraphInput,
  SetAgentMemoryInclusionInput,
  SetAgentProviderAccountInput,
  SetAgentSessionSettingInput,
  SetEnabledSkillInput,
  SetRoutineResultDestinationInput,
  SharedTable,
  SidebarLayoutAction,
  SidebarLayoutSnapshot,
  SignInRelayStatus,
  StorageUsage,
  UninstallSkillInput,
  UpdateAgentAdminSettingsInput,
  UpdateAgentHostSettingsInput,
  UpdateAgentInput,
  UpdateRestartMode,
  UpdateRoutineInput,
  VaultHostImportResult,
  VaultSaveInput,
  VaultState,
  WorkflowDetail,
  WorkflowRunDetail,
  WorkflowRunPage,
  WorkflowSaveResult,
  WorkflowStep,
  WorkflowSummary,
  WorkflowTriggerInput,
  WorkflowWebhookSecret,
} from "@openbot/contracts/ipc";
import type {
  EventActivity,
  EventRoutine,
  EventRoutineOwner,
  EventRoutineRef,
  ListEventActivityInput,
  SaveEventRoutineInput,
  SaveEventRoutineResult,
  WebhookSecret,
} from "@openbot/contracts/ipc-events";
import type { QueueEditRequest } from "@openbot/contracts/team-protocol/queue-edit-v1";
import type { RemoteConnectionFailure, RemoteRecoveryStatus, RemoteTeamDirectoryClient } from "@openbot/team-client";
import type { PlanLimits } from "@openbot/team-client/plan-limits";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import type { MessagingConnectorPage } from "@openbot/team-client/team-admin-requests";
import type { MobileBrowserTab } from "@/features/browser/model/browser-tabs";
import type { BrowserViewBridgeEvent, RemoteBrowserViewSession } from "@/features/browser/model/browser-view-bridge";
import type { MobileChannelStore } from "@/features/channels/model/channel-store";
import type { ProviderAdmin } from "@/features/servers/model/provider-admin";
import type { MobileConversationStore } from "./conversation-store";
import type { LiveWorkspaceStore } from "./live-workspace-store";

type MobileServerKind = "local" | "remote";
/** The route set that reaches a host's OpenBot update: the admin set or the member set. */
export type ServerUpdateAccess = "admin" | "member";

export type MobileServerState = "unknown" | "connecting" | "online" | "offline" | "error";
export type MobileServerDirectoryState = "loading" | "ready" | "error";

export interface MobileServer {
  id: string;
  name: string;
  /** The logo version in the account directory, or null when the server has no logo. */
  logoKey: string | null;
  kind: MobileServerKind;
  state: MobileServerState;
  initialConnectionPending: boolean;
  connectionMessage: string | null;
  /** The last failed connection step and its code, until the server is online again. */
  connectionFailure?: RemoteConnectionFailure | null;
  recoveryStatus?: RemoteRecoveryStatus;
  /**
   * The server was online when the app left, and the first attempt after the return still runs in
   * its quiet time. The app shows the server as online, and a request waits for the connection.
   */
  resuming?: boolean;
  address: string | null;
  accent: string;
  publicKey: string;
  membershipId: string;
  role: "owner" | "admin" | "member";
  /** The active members that the host's plan allows. Absent when the account server gave none. */
  memberLimit?: number;
  /** A hosted server, which its owner and its admins can restart. Absent when the account server did not say. */
  hosted?: boolean;
}

export interface MobileAgent {
  provider?: AgentProviderId;
  /** The provider when this build does not know it. The host still runs the agent. */
  foreignProvider?: ForeignProviderId | undefined;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
  /** One switch for every member: off stops the host's notifications and Live Activity for the agent. */
  notifications?: boolean;
  /** The agent workspace folder on the host. */
  workspacePath?: string;
  id: string;
  serverId: string;
  name: string;
  title: string;
  description: string;
  preview: string;
  updatedLabel: string;
  avatarUrl?: string | null;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  /** The Marketplace listing the agent was added from, and the listing version it has. */
  marketplaceSource?: { listingId: string; version: number } | undefined;
}

/** The `connectors-v1` routes that answer the host's GitHub connection status. */
export type GitHubConnectorRoute = "githubStatus" | "githubConnect" | "githubCancel" | "githubDisconnect";

type ToggleAgentPinResult = "pinned" | "unpinned" | "error";

interface AddRemoteServerInput {
  inviteUrl: string;
}

/** What a host serves of the live browser view. */
export interface MobileBrowserViewSupport {
  /** `browser-control` and `browser-view`: the phone can show the agent's tab and use it. */
  view: boolean;
  /** `browser-view-clipboard`: the host pastes text and answers the selected text. */
  clipboard: boolean;
  /** `browser-view-context-menu`: the host sends the phone the menu of its right-clicks. */
  contextMenu: boolean;
  /** `browser-view-viewport`: the host holds the page at the size the phone asks for. */
  viewport: boolean;
  /** `browser-navigation`: the host loads an address in a tab that is open. */
  navigation: boolean;
}

/** What the phone does to a host browser tab, through the released `browser-control` routes. */
type MobileBrowserTabAction =
  | { type: "navigate"; tabId: string; direction: "back" | "forward" }
  | { type: "reload"; tabId: string }
  | { type: "load"; tabId: string; url: string }
  | { type: "open"; url: string; ownerAgentId: string; ownerThreadId: string | null }
  | { type: "close"; tabId: string };

export interface MobileWorkspaceContextValue {
  browserViewSupport: (serverId: string) => MobileBrowserViewSupport;
  /** Null when the server is not connected, or its peer page is not ready yet. */
  openBrowserView: (
    serverId: string,
    tabId: string,
    listener: (event: BrowserViewBridgeEvent) => void,
  ) => RemoteBrowserViewSession | null;
  /** The new tab for `open`, and null for the other actions. */
  controlBrowserTab: (serverId: string, action: MobileBrowserTabAction) => Promise<MobileBrowserTab | null>;
  /**
   * Allows or denies an approval that the server's agent waits on. Rejects with
   * `InactiveRequestError`, and drops the request, when it no longer waits on the host.
   */
  respondToApproval: (serverId: string, input: RespondToApprovalInput) => Promise<void>;
  respondToBrowserTakeover: (
    serverId: string,
    input: { requestId: string | number; decision: "complete" | "cancel" },
  ) => Promise<void>;
  respondToBrowserSecret: (serverId: string, input: RespondToBrowserSecretInput) => Promise<void>;
  sidebarByServer: Record<string, { layout: SidebarLayoutSnapshot | null; error: string | null }>;
  mutateSidebarLayout: (serverId: string, action: SidebarLayoutAction) => Promise<void>;
  loadQueue: (agentId: string, serverId: string) => Promise<QueueSnapshot>;
  canEditQueue: (serverId: string) => boolean;
  /** True when the host advertises `message-client-id-v1`: a repeat of a message is stored once. */
  canRetryMessage: (serverId: string) => boolean;
  /** The files this host accepts beyond the base list, as the desktop picker reads them. */
  attachmentSupport: (serverId: string) => AttachmentSupport;
  changeQueue: (
    agentId: string,
    serverId: string,
    action: "cancel" | "steer" | "reorder",
    input: { deliveryId?: string; expectedTurnId?: string; deliveryIds?: string[] },
  ) => Promise<void>;
  editQueue: (agentId: string, serverId: string, input: QueueEditRequest) => Promise<QueueSnapshot>;
  /** Sets the reader's reaction on a message of an agent chat. `null` removes it. */
  setMessageReaction: (agentId: string, serverId: string, messageId: string, emoji: string | null) => Promise<void>;
  interruptTurn: (agentId: string, turnId: string, serverId?: string) => Promise<void>;
  channelStore: MobileChannelStore;
  /** The servers in the order saved on this device. The app opens on the first one. */
  servers: MobileServer[];
  /** Saves the order of all servers on this device. Returns false and keeps the old order on failure. */
  reorderServers: (serverIds: string[]) => boolean;
  /**
   * The members of each server that are not disabled, from the host's presence event. A server that
   * has sent no presence yet has no entry. The account service member list is not read for it.
   */
  memberCountByServer: Readonly<Record<string, number>>;
  teamDirectory: RemoteTeamDirectoryClient;
  serverDirectoryState: MobileServerDirectoryState;
  serverDirectoryError: string | null;
  agents: MobileAgent[];
  activeServer: MobileServer;
  activeAgents: MobileAgent[];
  hiddenAgents: MobileAgent[];
  pinnedAgentIds: string[];
  pinnedChannelIds: string[];
  hiddenChannelIds: string[];
  hideChannel: (channelId: string, serverId: string) => boolean;
  unhideChannel: (channelId: string, serverId: string) => boolean;
  toggleChannelPin: (channelId: string, serverId: string) => ToggleAgentPinResult;
  /** The pinned workflows of each server, in the order the drawer shows them. Saved on this device. */
  pinnedWorkflowIds: Readonly<Record<string, readonly string[]>>;
  toggleWorkflowPin: (workflowId: string, serverId: string) => ToggleAgentPinResult;
  /** Drops the pins of workflows that the host no longer lists. Call only with a complete list. */
  reconcileWorkflowPins: (serverId: string, workflowIds: readonly string[]) => void;
  conversationStore: MobileConversationStore;
  /** Activity, unread agents, and browser requests. Read them with a selector hook, not from the context. */
  liveState: LiveWorkspaceStore;
  selectServer: (serverId: string) => void;
  leaveServer: (serverId: string) => Promise<void>;
  /** Removes a server that this account owns from the account service. The host can be offline. */
  removeServer: (serverId: string) => Promise<void>;
  refreshServers: () => Promise<void>;
  refreshServer: (serverId: string) => Promise<void>;
  /** The account server says that a hosted server starts, for example after a restart. The app connects again soon. */
  hostedServerStarting: (serverId: string) => void;
  /** An owner or admin of an online host that serves `host-admin-v1`. The host checks the role again. */
  canEditServerIdentity: (serverId: string) => boolean;
  /**
   * An online host that sends notifications to this phone: `push-notifications-v1` for an iPhone,
   * `push-notifications-android-v1` for an Android phone.
   */
  canSendNotifications: (serverId: string) => boolean;
  /** An absent field stays unchanged; a `null` logo removes it. */
  updateServerIdentity: (
    serverId: string,
    input: { serverName?: string; logo?: AvatarImageInput | null },
  ) => Promise<void>;
  /** An owner or admin of an online host that serves `host-timezone-v1`. The host checks the role again. */
  canManageServerTimezone: (serverId: string) => boolean;
  /** The zone of a routine that an agent creates with no zone. Owners and admins only. */
  loadServerTimezone: (serverId: string) => Promise<HostTimezoneSettings>;
  /** `null` is automatic: the host system zone. The host refuses a zone that it cannot resolve. */
  setServerTimezone: (timezone: string | null, serverId: string) => Promise<HostTimezoneSettings>;
  /** An owner or admin of an online host that serves `agent-memory-limit-v1`. The host checks the role again. */
  canManageAgentMemoryLimit: (serverId: string) => boolean;
  /** How many memories each agent of the server can keep, and the values that the host permits. */
  loadAgentMemoryLimit: (serverId: string) => Promise<HostAgentMemoryLimit>;
  setAgentMemoryLimit: (limit: number, serverId: string) => Promise<HostAgentMemoryLimit>;
  /** An owner or admin of an online host that serves `agent-access-v1`. The host checks the role again. */
  canManageServerRoles: (serverId: string) => boolean;
  /**
   * A member, not an owner or admin, of an online host that serves `agent-access-v1`: the roles can
   * limit their agents, and `loadServerRoles` gives only their own levels.
   */
  hasAgentAccessLimits: (serverId: string) => boolean;
  /** The roles of the server and the agents that each one gives its members. */
  loadServerRoles: (serverId: string) => Promise<AgentAccessSnapshot>;
  /** Replaces all roles. The host refuses a change made from an earlier revision. */
  setServerRoles: (change: AgentAccessChange, serverId: string) => Promise<AgentAccessSnapshot>;
  /**
   * An owner or admin of an online host that serves `connectors-v1`: its Slack, Discord, Telegram and
   * GitHub connections. The host checks the role again.
   */
  canManageConnectors: (serverId: string) => boolean;
  /** The same for the host's 1Password connection (`onepassword-connector-v1`). */
  canManageOnePasswordConnector: (serverId: string) => boolean;
  /** The same for the host's Bitwarden connection (`bitwarden-connector-v1`). */
  canManageBitwardenConnector: (serverId: string) => boolean;
  /** True for an owner or admin of a host that serves its Vault to other devices (`vault-v1`). */
  canManageVault: (serverId: string) => boolean;
  /** The same for a CSV import from this phone (`vault-import-v1`). */
  canImportVault: (serverId: string) => boolean;
  /** The same for API keys in the Vault (`vault-v2`). */
  canManageVaultApiKeys: (serverId: string) => boolean;
  /** Reads or changes the host's GitHub connection. The answer names the GitHub pages that the phone opens. */
  githubConnector: (route: GitHubConnectorRoute, serverId: string) => Promise<HostGitHubConnectorStatus>;
  /** The repositories where the host's GitHub App is installed. The host reads them from GitHub. */
  loadGitHubRepositories: (serverId: string) => Promise<GitHubConnectorRepositories>;
  loadOnePasswordConnector: (serverId: string) => Promise<OnePasswordConnectorStatus>;
  /** The token goes to the host once. No answer carries it. */
  connectOnePassword: (token: string, serverId: string) => Promise<OnePasswordConnectorStatus>;
  disconnectOnePassword: (serverId: string) => Promise<OnePasswordConnectorStatus>;
  loadBitwardenConnector: (serverId: string) => Promise<BitwardenConnectorStatus>;
  /**
   * The API key and the master password go to the host once. No answer carries them. The host
   * answers `connecting` at once and signs in after that.
   */
  connectBitwarden: (input: BitwardenHostConnectInput, serverId: string) => Promise<BitwardenConnectorStatus>;
  /** Also stops a sign-in that has not ended. */
  disconnectBitwarden: (serverId: string) => Promise<BitwardenConnectorStatus>;
  /** The host's Vault. No answer carries a password, a card number or a security code. */
  loadVault: (serverId: string) => Promise<VaultState>;
  /** A new secret goes to the host once; a null secret keeps the saved one. */
  saveVaultItem: (input: VaultSaveInput, serverId: string) => Promise<VaultState>;
  deleteVaultItem: (id: string, serverId: string) => Promise<VaultState>;
  /** The text of a CSV password export. The host adds its logins and answers only the counts. */
  importVaultCsv: (csv: string, serverId: string) => Promise<VaultHostImportResult>;
  loadMessagingConnections: (platform: MessagingPlatform, serverId: string) => Promise<MessagingOverview>;
  /** The platform's page that the phone opens. The host opens no page. */
  connectMessaging: (input: HostMessagingConnectInput, serverId: string) => Promise<MessagingConnectorPage>;
  /** Sends the sealed grant of a Slack or Discord install to the host that started it. */
  completeMessagingInstall: (
    input: { platform: "slack" | "discord"; nonce: string; grant: string },
    serverId: string,
  ) => Promise<boolean>;
  reconnectMessaging: (input: HostMessagingWorkspaceInput, serverId: string) => Promise<MessagingConnectorPage>;
  disconnectMessaging: (input: HostMessagingWorkspaceInput, serverId: string) => Promise<void>;
  setMessagingEnabled: (input: HostSetMessagingEnabledInput, serverId: string) => Promise<void>;
  /** Creates the orchestrator agent on the host's default provider and model. */
  addMessagingOrchestrator: (
    input: HostAddMessagingOrchestratorInput,
    serverId: string,
  ) => Promise<AddMessagingOrchestratorResult>;
  /**
   * How this user reaches the OpenBot update of an online host: an owner or admin through
   * `host-update-v1`, any member through `host-member-update-v1`. Null when neither applies.
   */
  serverUpdateAccess: (serverId: string) => ServerUpdateAccess | null;
  /** True when the host serves `host-release-v1`, which tells how its installation updates. */
  canReadServerRelease: (serverId: string) => boolean;
  loadServerUpdate: (serverId: string, access: ServerUpdateAccess) => Promise<HostUpdateStatus>;
  /** The host starts the check and answers at once. Read the status again for the outcome. */
  checkServerUpdate: (serverId: string, access: ServerUpdateAccess) => Promise<HostUpdateStatus>;
  /** A member's update always waits for idle agents. A second start replaces the restart mode. */
  startServerUpdate: (
    serverId: string,
    access: ServerUpdateAccess,
    restart: UpdateRestartMode,
  ) => Promise<HostUpdateStatus>;
  /** Owners and admins only. */
  cancelServerUpdate: (serverId: string) => Promise<HostUpdateStatus>;
  setServerUpdateSettings: (settings: HostUpdateSettingsChange, serverId: string) => Promise<HostUpdateStatus>;
  loadServerRelease: (serverId: string) => Promise<HostReleaseStatus>;
  checkServerRelease: (serverId: string) => Promise<HostReleaseStatus>;
  /** An online host that serves `hosted-sites-v1`. Every member reads the sites. */
  canViewHostedSites: (serverId: string) => boolean;
  /** An owner or admin of an online host that serves `hosted-sites-v1`. The host checks the role again. */
  canDeleteHostedSites: (serverId: string) => boolean;
  /** The openbot.site sites that agents on the server published, and the site limit of its plan. */
  loadHostedSites: (serverId: string) => Promise<HostedSiteList>;
  /** The address of the site returns 410 Gone immediately. */
  deleteHostedSite: (siteId: string, serverId: string) => Promise<void>;
  /** An owner or admin of an online host that serves `providers-v1`. The host checks the role again. */
  canManageProviders: (serverId: string) => boolean;
  /** The Providers admin of one host, with the newest route set that it serves. */
  providerAdmin: (serverId: string) => ProviderAdmin;
  /** An owner or admin of an online host that serves `mcp-servers-v1`. The host checks the role again. */
  canManageMcpServers: (serverId: string) => boolean;
  /** The MCP servers that the host gives its agents. Each change answers with the whole list. */
  listMcpServers: (serverId: string) => Promise<McpServerConfig[]>;
  /** An empty id adds a server. */
  saveMcpServer: (config: McpServerConfig, serverId: string) => Promise<McpServerConfig[]>;
  removeMcpServer: (mcpServerId: string, serverId: string) => Promise<McpServerConfig[]>;
  setMcpServerEnabled: (mcpServerId: string, enabled: boolean, serverId: string) => Promise<McpServerConfig[]>;
  /** Connects once with `config` on the host. Nothing is saved. */
  testMcpServer: (config: McpServerConfig, serverId: string) => Promise<McpTestResult>;
  /**
   * An owner or admin of an online host that serves `mcp-servers-v1` and `sign-in-relay-v1`: the phone
   * opens the browser sign-in of an MCP server, and the host keeps the grant.
   */
  canRelayMcpSignIn: (serverId: string) => boolean;
  /** The relayed browser sign-ins of MCP servers on one host. Refuses a host without `sign-in-relay-v1`. */
  mcpSignInRelay: (serverId: string) => McpSignInRelay;
  /** The http servers that the host holds a sign-in for. Empty for a host without `mcp-sign-in-v1`. */
  listMcpSignIns: (serverId: string) => Promise<McpSignInState[]>;
  signOutMcpServer: (mcpServerId: string, serverId: string) => Promise<McpSignInState[]>;
  addRemoteServer: (input: AddRemoteServerInput) => Promise<string>;
  /** Creates an agent on the active server and returns its id. */
  createAgent: (input: CreateAgentInput) => Promise<string>;
  updateAgent: (input: UpdateAgentInput, serverId?: string) => Promise<void>;
  setAgentAvatar: (agentId: string, image: RemoteFileUpload | null, serverId: string) => Promise<void>;
  loadAgentAvatar: (agentId: string, avatarUrl: string, serverId: string) => Promise<string>;
  deleteAgent: (agentId: string) => Promise<void>;
  duplicateAgent: (agentId: string) => Promise<void>;
  saveAgentMemory: (agentId: string, text: string, serverId: string, memoryId?: string) => Promise<void>;
  deleteAgentMemory: (agentId: string, memoryId: string, serverId: string) => Promise<void>;
  createAgentRoutine: (input: CreateRoutineInput, serverId: string) => Promise<void>;
  updateAgentRoutine: (input: UpdateRoutineInput, serverId: string) => Promise<void>;
  deleteAgentRoutine: (agentId: string, routineId: string, serverId: string) => Promise<void>;
  testAgentRoutine: (agentId: string, routineId: string, serverId: string) => Promise<void>;
  /** Event administration is available only to owners and admins on hosts with events-v1. */
  canManageEvents: (serverId: string) => boolean;
  /**
   * An owner or admin of a host with events-v1 and `routine-recovery-v1`: the event routes then carry
   * what a scheduled routine does with the runs that came due while the host was off.
   */
  canManageMissedRuns: (serverId: string) => boolean;
  /** An owner or admin of a host with `routine-results-v1`: an agent routine can send its answers on. */
  canManageRoutineResults: (serverId: string) => boolean;
  /** The host's enabled messaging connections, with the places that each one can post in. */
  loadRoutineResultOptions: (serverId: string) => Promise<RoutineResultConnectionOption[]>;
  loadRoutineResultDestination: (
    input: RoutineResultRoutineInput,
    serverId: string,
  ) => Promise<RoutineResultDestination | null>;
  /** A null destination stops sending. The host refuses a connection that is off. */
  setRoutineResultDestination: (
    input: SetRoutineResultDestinationInput,
    serverId: string,
  ) => Promise<RoutineResultDestination | null>;
  listEventRoutines: (owner: EventRoutineOwner, serverId: string) => Promise<EventRoutine[]>;
  /** The result has the signing secret only when the save made a new webhook trigger. */
  saveEventRoutine: (input: SaveEventRoutineInput, serverId: string) => Promise<SaveEventRoutineResult>;
  deleteEventRoutine: (input: EventRoutineRef, serverId: string) => Promise<void>;
  testEventRoutine: (input: EventRoutineRef, serverId: string) => Promise<void>;
  rotateEventRoutineSecret: (input: EventRoutineRef, serverId: string) => Promise<WebhookSecret>;
  listEventActivity: (input: ListEventActivityInput, serverId: string) => Promise<EventActivity[]>;
  loadAgentModels: (serverId: string) => Promise<AgentModelOption[]>;
  loadAgentMemorySelection: (agentId: string, serverId: string) => Promise<AgentMemorySelectionState | null>;
  setAgentMemoryInclusion: (
    input: SetAgentMemoryInclusionInput,
    serverId: string,
  ) => Promise<AgentMemorySelectionState>;
  loadAgentMemories: (agentId: string, serverId: string) => Promise<AgentMemory[]>;
  loadAgentRoutines: (agentId: string, serverId: string) => Promise<Routine[]>;
  /** Every routine of the server, of agents and channels, with its runs in the range. */
  /**
   * `owners` are the agents and channels whose routines to read, when the caller already knows them.
   * Without it, the phone reads the agent and channel lists of the host first.
   */
  loadRoutineCalendar: (
    input: RoutineCalendarInput,
    serverId: string,
    owners?: readonly RoutineCalendarOwner[],
  ) => Promise<RoutineCalendar>;
  loadAgentAnalytics: (input: AgentAnalyticsInput, serverId: string) => Promise<AgentAnalytics | null>;
  /** Null when the host does not advertise `host-analytics`. Without an agent ID, the report covers every agent. */
  loadHostAnalytics: (input: HostAnalyticsInput, serverId: string) => Promise<HostAnalytics | null>;
  /**
   * Null when the host does not advertise `installed-skills`. With `manage`, reads the
   * `skills-admin-v1` list, which has the enabled state and origin; the host refuses a member.
   */
  loadAgentSkills: (agentId: string, serverId: string, manage?: boolean) => Promise<InstalledSkill[] | null>;
  /** An owner or admin of an online host that serves `skills-admin-v1`. The host checks the role again. */
  canManageAgentSkills: (serverId: string) => boolean;
  /** Owners and admins only; the host refuses a member. Resolves with the skill the host saved. */
  installAgentSkill: (input: InstallSkillInput, serverId: string) => Promise<InstalledSkill>;
  /** Owners and admins only; the host refuses a member. Resolves with the skill the host saved. */
  setAgentSkillEnabled: (input: SetEnabledSkillInput, serverId: string) => Promise<InstalledSkill>;
  /** Owners and admins only; the host refuses a member. */
  uninstallAgentSkill: (input: UninstallSkillInput, serverId: string) => Promise<void>;
  /** Null when the host does not advertise `storage-v1`. */
  loadAgentStorage: (agentId: string, serverId: string, force?: boolean) => Promise<StorageUsage | null>;
  /** True when the host advertises `storage-v1`. Every member reads the host's storage. */
  canReadServerStorage: (serverId: string) => boolean;
  /** Every location on the host, its agents, its largest chats and its stored files. */
  loadServerStorage: (serverId: string, force?: boolean) => Promise<StorageUsage>;
  /** Owners and admins only; the host refuses a member. */
  clearServerStorage: (category: ClearableStorageCategory, serverId: string) => Promise<void>;
  /** Null when the host does not advertise `agent-admin-v1`. Owners and admins only; the host refuses a member. */
  loadAgentAdminSettings: (agentId: string, serverId: string) => Promise<AgentAdminSettings | null>;
  /** Owners and admins only; the host refuses a member. Resolves with the settings the host saved. */
  updateAgentAdminSettings: (input: UpdateAgentAdminSettingsInput, serverId: string) => Promise<AgentAdminSettings>;
  /** An owner or admin of an online host that serves `agent-admin-v1`. The host checks the role again. */
  canManageAgentAccess: (serverId: string) => boolean;
  /** An owner or admin of an online host that serves `agent-host-settings-v1`. The host checks the role again. */
  canManageAgentHostSettings: (serverId: string) => boolean;
  /**
   * Computer Use, local scripts and the busy-message mode. Null when the host does not advertise
   * `agent-host-settings-v1`. Owners and admins only; the host refuses a member.
   */
  loadAgentHostSettings: (agentId: string, serverId: string) => Promise<AgentHostSettings | null>;
  /** Owners and admins only; the host refuses a member. Resolves with the settings the host saved. */
  updateAgentHostSettings: (input: UpdateAgentHostSettingsInput, serverId: string) => Promise<AgentHostSettings>;
  /** An owner or admin of an online host that serves `provider-accounts-v1`. The host checks the role again. */
  canManageProviderAccounts: (serverId: string) => boolean;
  /**
   * The accounts of the host's providers, and the agents on an account after the first. Null when
   * the host does not advertise `provider-accounts-v1`. Owners and admins only; the host refuses a member.
   */
  loadProviderAccounts: (serverId: string) => Promise<HostProviderAccounts | null>;
  /**
   * The plan limits of the host's providers. Every member reads the providers' own sign-ins. With
   * `accounts`, an owner or admin also reads the accounts after the first and their names.
   */
  loadPlanLimits: (serverId: string, accounts: boolean) => Promise<PlanLimits>;
  /** Owners and admins only. The host refuses an agent that works, and an account of another provider. */
  setAgentProviderAccount: (input: SetAgentProviderAccountInput, serverId: string) => Promise<void>;
  /** True when the host advertises `context-reset-v1`. Any member can start a new chat. */
  canStartNewChat: (serverId: string) => boolean;
  /**
   * True when the host advertises `agent-create-model`: a new agent can start on a chosen provider
   * and model. Without it, the host drops the choice and starts its own default.
   */
  canChooseNewAgentModel: (serverId: string) => boolean;
  /** The agent forgets the messages before it. The host refuses while the agent works. */
  loadAgentSessionSettings: (agentId: string, serverId: string) => Promise<AgentSessionSettings | null>;
  setAgentSessionSetting: (input: SetAgentSessionSettingInput, serverId: string) => Promise<AgentSessionSettings>;
  resetAgentSessionSetting: (input: ResetAgentSessionSettingInput, serverId: string) => Promise<AgentSessionSettings>;
  startNewChat: (agentId: string, serverId: string) => Promise<void>;
  /** An owner or admin of an online host that serves `shared-tables-v1`. The host checks the role again. */
  canManageSharedTables: (serverId: string) => boolean;
  /** Every table that the agents of the host share. Owners and admins only. */
  listSharedTables: (serverId: string) => Promise<SharedTable[]>;
  /** Owners and admins only. The table goes for every agent. */
  deleteSharedTable: (name: string, serverId: string) => Promise<void>;
  /** An owner or admin of an online host that serves `agent-publish-v1`. The host checks the role again. */
  canPublishAgent: (serverId: string) => boolean;
  /** What the host would publish for the agent, and its link when it is published. Owners and admins only. */
  loadAgentTemplatePreview: (agentId: string, serverId: string) => Promise<AgentTemplatePreview>;
  /** The host publishes with its own account, without a share card. Owners and admins only. */
  publishAgentTemplate: (agentId: string, serverId: string) => Promise<AgentTemplatePublication>;
  /** Owners and admins only. The link stops working. */
  unpublishAgentTemplate: (agentId: string, serverId: string) => Promise<void>;
  /** True when the host advertises `agent-install-v1`. The host still refuses a member. */
  canInstallAgentTemplate: (serverId: string) => boolean;
  /** Owners and admins only. The host downloads the template with its own account. */
  installAgentTemplate: (input: InstallAgentTemplateInput, serverId: string) => Promise<AddedAgent>;
  /** An owner or admin of an online host that serves `agent-install-v1`. The host checks the role again. */
  canAddMarketplaceAgents: (serverId: string) => boolean;
  /** An owner or admin of an online host that serves `agent-update-v1`. The host checks the role again. */
  canUpdateMarketplaceAgents: (serverId: string) => boolean;
  /** Owners and admins only. The host downloads the listing with its own account. */
  installMarketplaceAgent: (input: InstallMarketplaceAgentInput, serverId: string) => Promise<AddedAgent>;
  /** Owners and admins only; the host refuses a member. */
  deleteStoredFile: (fileId: string, serverId: string) => Promise<void>;
  /** Searches message text in the server's agent chats, one page from `cursor` or from the newest match. */
  searchMessages: (query: string, serverId: string, cursor?: string) => Promise<ConversationSearchPage>;
  /** True when the host advertises `conversation-file-search-v1`. */
  canSearchFiles: (serverId: string) => boolean;
  /** Searches file names in the server's agent chats. An empty query lists the newest files. */
  searchFiles: (query: string, serverId: string, cursor?: string) => Promise<ConversationFileSearchPage>;
  /** True when the host advertises `agent-tasks-v1`. A member who can message an agent can use its tasks. */
  canUseTasks: (serverId: string) => boolean;
  /** True when the host advertises `agent-threads-v1`: a member who can message an agent can rename and delete its threads. */
  canEditThreads: (serverId: string) => boolean;
  /** True when the host advertises `agent-thread-reads-v1`: the host keeps the person's read mark of each thread. */
  canReadThreads: (serverId: string) => boolean;
  /** True when the host advertises `agent-thread-files-v1`: a message in a thread can carry files. */
  canAttachThreadFiles: (serverId: string) => boolean;
  /** True when the host advertises `workflows-v1`. The host shows each member the workflows of their agents. */
  canUseWorkflows: (serverId: string) => boolean;
  listWorkflows: (serverId: string) => Promise<WorkflowSummary[]>;
  loadWorkflow: (workflowId: string, serverId: string) => Promise<WorkflowDetail>;
  createWorkflow: (input: CreateWorkflowInput, serverId: string) => Promise<WorkflowDetail>;
  renameWorkflow: (input: RenameWorkflowInput, serverId: string) => Promise<WorkflowSummary>;
  deleteWorkflow: (workflowId: string, serverId: string) => Promise<void>;
  /** Answers a conflict with the saved workflow when another device saved it first. */
  saveWorkflowGraph: (input: SaveWorkflowGraphInput, serverId: string) => Promise<WorkflowSaveResult>;
  /** The newest runs of a workflow, or the runs older than `before`. */
  loadWorkflowRuns: (workflowId: string, serverId: string, before?: string) => Promise<WorkflowRunPage>;
  loadWorkflowRun: (runId: string, serverId: string) => Promise<WorkflowRunDetail>;
  startWorkflowRun: (workflowId: string, serverId: string) => Promise<WorkflowRunDetail>;
  stopWorkflowRun: (runId: string, serverId: string) => Promise<void>;
  retryWorkflowStep: (stepId: string, serverId: string) => Promise<WorkflowStep>;
  decideWorkflowStep: (input: DecideWorkflowStepInput, serverId: string) => Promise<void>;
  /** A new webhook secret, which the host shows once. Only an owner or admin can make one. */
  rotateWorkflowWebhookSecret: (input: WorkflowTriggerInput, serverId: string) => Promise<WorkflowWebhookSecret>;
  /** The tasks of one agent. The host answers 404 for an agent that this member cannot see. */
  loadAgentTasks: (agentId: string, serverId: string) => Promise<AgentTasksSnapshot>;
  loadAgentTaskConversation: (input: AgentTaskInput, serverId: string) => Promise<ConversationSnapshot>;
  /** Files need `canAttachThreadFiles`: `agent-tasks-v1` carries text only. */
  startAgentTask: (
    input: { agentId: string; text: string; attachmentDraftIds?: string[]; clientMessageId: string },
    serverId: string,
  ) => Promise<AgentTask>;
  /** Steers the running turn of the task, or queues the message in the task. */
  sendAgentTaskMessage: (
    input: AgentTaskInput & { text: string; attachmentDraftIds?: string[]; clientMessageId: string },
    serverId: string,
  ) => Promise<QueuedMessageReceipt>;
  /** Stops the running turn of a task, closes the task, or reopens it. */
  controlAgentTask: (action: "stop" | "close" | "reopen", input: AgentTaskInput, serverId: string) => Promise<void>;
  /** Renames a thread. The title then no longer follows its first message. */
  renameAgentThread: (input: AgentTaskInput & { title: string }, serverId: string) => Promise<void>;
  /** Deletes a thread, its conversation, its files and its queued messages for good. */
  deleteAgentThread: (input: AgentTaskInput, serverId: string) => Promise<void>;
  /** The person's read mark of each open thread of the agent. The member's devices share it. */
  loadAgentThreadReads: (agentId: string, serverId: string) => Promise<AgentTaskReadState[]>;
  /** Moves the person's read mark of a thread to a message that they see. */
  markAgentThreadRead: (input: MarkAgentTaskReadInput, serverId: string) => Promise<AgentTaskReadState>;
  /** Answers a question of a task turn. The host finds the question by its request, on any thread. */
  respondToTaskPrompt: (input: RespondToPromptInput, serverId: string) => Promise<void>;
  loadConversation: (agentId: string, serverId?: string) => Promise<ConversationSnapshot>;
  /**
   * Loads the page around a message, for a chat that opens at a search result. False when the host
   * does not have the message.
   */
  loadConversationAround: (agentId: string, messageId: string, serverId?: string) => Promise<boolean>;
  /** Loads the latest page in place of a window around a searched message. */
  loadLatestMessages: (agentId: string, serverId?: string) => Promise<void>;
  loadOlderMessages: (agentId: string, serverId?: string) => Promise<void>;
  respondToPrompt: (agentId: string, input: RespondToPromptInput) => Promise<void>;
  sendMessage: (
    agentId: string,
    text: string,
    attachmentDraftIds?: string[],
    replyToMessageId?: string | null,
    serverId?: string,
    /** Names the message for the host, which stores a repeat of it once. Send it only when `canRetryMessage`. */
    clientMessageId?: string,
  ) => Promise<string>;
  uploadAttachment: (
    agentId: string,
    input: RemoteFileUpload,
    serverId?: string,
    /** Hears the fraction of the file sent so far, from 0 to 1. */
    onProgress?: (fraction: number) => void,
  ) => Promise<DraftAttachment>;
  downloadAttachment: (serverId: string, attachmentId: string) => Promise<RemoteFileUpload>;
  discardAttachment: (agentId: string, attachmentId: string, serverId?: string) => Promise<void>;
  /**
   * True when a hide goes to the host (`agent-hidden-v1`, and the user is an owner or admin), so each
   * device shows it. A member hides on this phone only.
   */
  hidesAgentsOnServer: (serverId: string) => boolean;
  /**
   * True when the user can show a hidden agent of the active server again: this phone hid it, or the
   * host hid it and the user is an owner or admin.
   */
  canUnhideAgent: (agentId: string) => boolean;
  /** Hides an agent of the active server: on the host when it owns the list, else on this phone only. */
  hideAgent: (agentId: string) => void;
  /** Shows a hidden agent of the active server again, on this phone and on the host. */
  unhideAgent: (agentId: string) => void;
  markAgentRead: (agentId: string, throughMessageId?: string, serverId?: string) => void;
  markAgentUnread: (agentId: string) => void;
  /** Marks every unread chat of the active server read. It rejects when a chat stays unread. */
  markAllRead: () => Promise<void>;
  toggleAgentPin: (agentId: string) => ToggleAgentPinResult;
}

/**
 * One host's relayed MCP sign-ins (`sign-in-relay-v1`). The host starts the sign-in and opens no page;
 * the phone opens the page, and the address it ends on goes back with `complete`.
 */
interface McpSignInRelay {
  /** Starts the sign-in of `config` and answers its flow id. */
  start: (config: McpServerConfig) => Promise<string>;
  status: (flowId: string) => Promise<SignInRelayStatus>;
  /** `query` holds a grant. It goes only to the host. */
  complete: (flowId: string, query: string) => Promise<SignInRelayStatus>;
  cancel: (flowId: string) => Promise<void>;
}

/** The checks that read what a host advertised. Their answer changes when a server connects. */
export type MobileWorkspaceCapabilityCheck =
  | "browserViewSupport"
  | "canEditQueue"
  | "canRetryMessage"
  | "attachmentSupport"
  | "canStartNewChat"
  | "canChooseNewAgentModel"
  | "canInstallAgentTemplate"
  | "canSearchFiles"
  | "canUseTasks"
  | "canEditThreads"
  | "canReadThreads"
  | "canAttachThreadFiles"
  | "canUseWorkflows"
  | "canReadServerStorage";

type MobileWorkspaceStateKey =
  | MobileWorkspaceCapabilityCheck
  | "sidebarByServer"
  | "servers"
  | "memberCountByServer"
  | "serverDirectoryState"
  | "serverDirectoryError"
  | "agents"
  | "activeServer"
  | "activeAgents"
  | "hiddenAgents"
  | "pinnedAgentIds"
  | "pinnedChannelIds"
  | "pinnedWorkflowIds"
  | "hiddenChannelIds"
  | "hidesAgentsOnServer"
  | "canUnhideAgent"
  | "canEditServerIdentity"
  | "canManageServerTimezone"
  | "canManageAgentMemoryLimit"
  | "canManageServerRoles"
  | "hasAgentAccessLimits"
  | "canManageConnectors"
  | "canManageOnePasswordConnector"
  | "canManageBitwardenConnector"
  | "canManageVault"
  | "canImportVault"
  | "canManageVaultApiKeys"
  | "serverUpdateAccess"
  | "canReadServerRelease"
  | "canViewHostedSites"
  | "canDeleteHostedSites"
  | "canManageProviders"
  | "canManageMcpServers"
  | "canRelayMcpSignIn"
  | "canAddMarketplaceAgents"
  | "canUpdateMarketplaceAgents"
  | "canSendNotifications"
  | "canManageEvents"
  | "canManageMissedRuns"
  | "canManageRoutineResults"
  | "canManageAgentSkills"
  | "canManageAgentAccess"
  | "canManageAgentHostSettings"
  | "canManageProviderAccounts"
  | "canManageSharedTables"
  | "canPublishAgent";

/**
 * The workspace data, and the checks that a component calls while it renders. A change renders
 * every component that reads the context again.
 */
export type MobileWorkspaceState = Pick<MobileWorkspaceContextValue, MobileWorkspaceStateKey>;

/**
 * The commands, and the stores and the directory of the session. They do not change while the
 * session lasts, so a component that reads only these does not render again for a workspace change.
 * A command reads the latest workspace when it runs.
 */
export type MobileWorkspaceActions = Omit<MobileWorkspaceContextValue, MobileWorkspaceStateKey>;
