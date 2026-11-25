import { AGENT_MEMORY_CONTEXT_BUDGET_BYTES, essentialMemoryBytes } from "@openbot/contracts/agent-memory-context";
import { feedbackSentIssue, feedbackWithdrawnItemType } from "@openbot/contracts/feedback";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AcpRegistryEntry,
  AgentProviderRef,
  AgentSessionSettings,
  CreateAgentInput,
  HiddenAgentsSnapshot,
  ListArchivedAgentTasksInput,
  McpSignInApp,
  McpSignInAppState,
  ServerNotificationLevel,
} from "@openbot/contracts/ipc";
import {
  type AccountUsage,
  AGENT_DEFAULT_KEYS,
  AGENT_FOLDER_LIMIT,
  AGENT_INSTRUCTIONS_CHANGE_ITEM_TYPE,
  AGENT_WELCOME_ITEM_TYPE,
  type AgentAccessChange,
  type AgentBrowserProfile,
  type AgentDefaults,
  type AgentEvent,
  type AgentExclusionChange,
  type AgentFolderChange,
  type AgentFolderList,
  type AgentInstructionsFile,
  type AgentMemory,
  type AgentMemoryLimitPreference,
  type AgentMemorySelection,
  type AgentMemorySelectionState,
  type AgentProviderId,
  type AgentRuntimeSnapshot,
  type AgentStatus,
  type AgentSubmission,
  type AgentTask,
  type AgentTasksSnapshot,
  type AgentTemplatePublication,
  type AnalyticsPreference,
  type AppAppearancePreference,
  type AppBehaviorPreference,
  type AppInfo,
  type AppInterfaceSizePreference,
  type AppLanguagePreference,
  type AppLogoColorPreference,
  type ApprovalAutomationPreference,
  type AppSetupState,
  type ArchivedAgentTasksPage,
  type AttachmentImportEvent,
  type AvatarHue,
  agentAccessAuditChanges,
  agentAutoApprovalEnabled,
  agentAutomationAllowed,
  agentBrowserProfile,
  agentComputerUseEnabled,
  agentDefaultChoiceValues,
  agentExclusionCoverage,
  agentFolderCoverage,
  agentMemoryEnabled,
  agentNewChatAllowed,
  agentQuickAcknowledgementEnabled,
  agentTaskLimit,
  type BackgroundProcess,
  type BrowserProfileSummary,
  type BrowserProxySummary,
  type BrowsingMemoryPreference,
  type BusyMessageModePreference,
  browserProxyAddressText,
  type CacheExpiryCompactionSetting,
  type CentralAuthState,
  CHANNEL_FOLDER_LIMIT,
  type ChannelFolderChange,
  type ChannelFolderList,
  type ClaudeCompactWindowSetting,
  type ClaudeUserSetupSetting,
  type ClientAgentModelOption,
  type ClientAgentSummary,
  CONTEXT_RESET_ITEM_TYPE,
  CONVERSATION_MEMORY_CHANGES_ITEM_TYPE,
  type ComputerUseState,
  type ConversationMessage,
  type ConversationReadState,
  type ConversationSnapshot,
  type ConversationTurnTrace,
  type CustomAgentSummary,
  type CustomProviderSummary,
  channelFolderCoverage,
  createMcpServerId,
  DEFAULT_AGENT_ACCESS,
  DEFAULT_AGENT_DEFAULTS,
  DEFAULT_AGENT_MEMORY_LIMIT,
  DEFAULT_APP_APPEARANCE,
  DEFAULT_APP_INTERFACE_SIZE,
  DEFAULT_APP_LOGO_COLOR,
  DEFAULT_APPROVAL_AUTOMATION_PREFERENCE,
  DEFAULT_BROWSING_MEMORY_PREFERENCE,
  DEFAULT_BUSY_MESSAGE_MODE,
  DEFAULT_CACHE_EXPIRY_COMPACTION,
  DEFAULT_CLAUDE_COMPACT_WINDOW,
  DEFAULT_CLAUDE_USER_SETUP,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
  DEFAULT_EXTERNAL_LINK_PREFERENCE,
  DEFAULT_MACHINE_ALERT_SETTINGS,
  DEFAULT_MEDIA_APPROVAL_CREDITS_SETTING,
  DEFAULT_MEMORY_REVIEW_INTERVAL,
  DEFAULT_PROMPT_CACHE_TTL,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  DEFAULT_PROVIDER_DETECTION_SETTINGS,
  DEFAULT_REMOTE_NETWORK_ROUTE,
  DEFAULT_REMOTE_SESSION_REUSE_PREFERENCE,
  DEFAULT_SKILL_LEARNING_MODE,
  DEFAULT_TRANSPARENT_WINDOW,
  type DirectConversationSnapshot,
  type DirectMessageRealtimeEvent,
  type DirectTypingRealtimeEvent,
  type DynamicIslandPreference,
  type DynamicIslandPresentation,
  decodeMachineAlertSettings,
  defaultProviderModel,
  type ExternalLinkBrowsers,
  type ExternalLinkPreference,
  type FilePreview,
  folderInside,
  type HostedSiteSummary,
  type HostStatus,
  hostAgentMemoryLimit,
  hostBrowsingMemory,
  hostMemoryReview,
  hostSkillLearning,
  isAgentMemoryLimit,
  isAgentSummary,
  isClaudeCompactWindowTokens,
  isMemoryReviewInterval,
  isPromptCacheTtl,
  isReleasedRoutineSchedule,
  isSkillLearningMode,
  LOCAL_SERVER_ID,
  type MachineAlertSettings,
  type MacPermissionId,
  type McpAccessSnapshot,
  type McpServerAccess,
  MESSAGE_PIN_TEXT_LIMIT,
  MESSAGE_PIN_THREAD_TITLE_LIMIT,
  MESSAGE_PINS_LIMIT,
  MESSAGE_PINS_LIST_LIMIT,
  type MediaApprovalCreditsSetting,
  type MemoryReviewPreference,
  type MessagePinner,
  nextBrowserProfileHue,
  normalizeMcpConfig,
  type OpenAttachmentInput,
  type OpenBotDesktopApi,
  type OpenSharedFileInput,
  type OpenWorkspaceFileInput,
  type PinnedMessage,
  type PinnedMessagesSnapshot,
  PLAN_CONTINUATION_ITEM_TYPE,
  type PromptCacheTtlSetting,
  type ProviderAccountStatus,
  type ProviderDetectionSettings,
  type ProviderEnvironment,
  type ProviderEnvironmentProvider,
  type ProviderModelVisibility,
  parseAgentAccessChange,
  parseBrowserProxyAddress,
  parseMediaApprovalCreditsUpdate,
  parseProviderModelVisibilityChange,
  parseSetMcpAccessInput,
  providerEnvironmentProblem,
  type QueueDelivery,
  type QueuedMessageReceipt,
  type QueueHold,
  type QueueSnapshot,
  type RemoteDesktopSession,
  type RemoteNetworkRouteState,
  type RemoteSessionReusePreference,
  type ReorderQueueInput,
  type RespondToPromptInput,
  type Routine,
  type RoutineRun,
  type RoutineSchedule,
  type SendMessageInput,
  type ServerAuditEntry,
  type SetAgentAvatarInput,
  type SetMessageReactionInput,
  type SharedTable,
  SIDEBAR_PEOPLE_SECTION_ID,
  SIDEBAR_UNASSIGNED_SECTION_ID,
  type SidebarLayoutSnapshot,
  type SidebarPinsSnapshot,
  type SkillLearningPreference,
  type SteerQueuedMessageInput,
  sameCustomProviderOrigin,
  savedCustomModelId,
  type TeamPresenceSnapshot,
  type UpdateAgentInput,
  type UpdatePreference,
  type UpdateQueuedMessageInput,
  type UpdateStatus,
  type WorkspaceDirectory,
} from "@openbot/contracts/ipc";
import { ACTIVE_QUEUE_STATUSES } from "@openbot/contracts/team-protocol/agent-active-queues-v1";
import { sourceText } from "@openbot/i18n/source";
import {
  AGENT_IMPORT_PREVIEW,
  AGENT_IMPORT_SKILL,
  HERMES_EXPORT_SKILL,
  HERMES_IMPORT_PREVIEW,
} from "../../stories/agent-import-fixtures";
import { filePreviewForPath } from "../../stories/file-previews";
import { INSTANCE_TRANSFER_PREVIEW } from "../../stories/instance-transfer-fixtures";
import { toggleChannelMember } from "../features/channels/channels-draft";
import { readStateForMessages } from "../features/conversation/conversation-read-state";
import {
  STORY_AGENT_TEMPLATE_DETAIL,
  STORY_AGENT_TEMPLATE_PUBLICATION,
  storyAgentTemplatePreview,
} from "./agent-template-fixtures";
import {
  STORY_AGENT_STATUS,
  STORY_AGENT_SUBMISSIONS,
  STORY_AGENT_SUMMARIES,
  STORY_APP_INFO,
  STORY_FOREIGN_AGENT,
  STORY_FOREIGN_MODEL,
  STORY_FOREIGN_SERVER_ID,
  STORY_HOSTED_SITES,
  STORY_MARKETPLACE_AGENT_DETAILS,
  STORY_MARKETPLACE_AGENTS,
  STORY_MCP_SERVERS,
  STORY_MODELS,
  STORY_PRESENCE,
  STORY_QUEUES,
  STORY_SERVER_AUDIT_ENTRIES,
  STORY_SHARED_TABLES,
  STORY_SNAPSHOTS,
  STORY_UPDATE_STATUS,
  STORY_USAGE,
  withStoryForeignProvider,
} from "./fixtures";
import { mockAgentAnalytics, mockHostAnalytics } from "./mock-agent-analytics";
import { createMockAuth, type MockAuthOptions } from "./mock-auth";
import { createMockBilling, previewBillingServers } from "./mock-billing";
import { createMockBitwardenConnector } from "./mock-bitwarden-connector";
import { createMockBrowser, type MockBrowserOptions } from "./mock-browser";
import { createMockChannels, type MockChannelSeed } from "./mock-channels";
import { createMockCredits } from "./mock-credits";
import { type MockCrmSeed, mockCrm } from "./mock-crm";
import { createMockEvents } from "./mock-events";
import { createMockGitHubConnector } from "./mock-github-connector";
import { createMockHostPersonality } from "./mock-host-personality";
import { createMockHostSignalHome } from "./mock-host-signal-home";
import { createMockHostTimezone } from "./mock-host-timezone";
import { createMockHostTurnLimits } from "./mock-host-turn-limits";
import { createMockHostUpdate, type MockHostUpdateOptions } from "./mock-host-update";
import { createMockHostVoiceModel } from "./mock-host-voice-model";
import { createMockHostedServers } from "./mock-hosted-servers";
import { createMockLicense } from "./mock-license";
import { createMockLinkAccount } from "./mock-link-account";
import { createMockMessaging } from "./mock-messaging";
import { createMockOnePasswordConnector } from "./mock-onepassword-connector";
import { createMockPasswordManagers } from "./mock-password-managers";
import { createMockProviderRuntimes, type MockProviderRuntimeOptions } from "./mock-provider-runtimes";
import { createMockReferral } from "./mock-referral";
import { mockRoutineCalendar } from "./mock-routine-calendar";
import { createMockRoutineFeed } from "./mock-routine-feed";
import { type MockRoutineResultsOptions, mockRoutineResults } from "./mock-routine-results";
import { applySidebarLayoutAction } from "./mock-sidebar-layout";
import { createMockSkills, type MockSkillsOptions } from "./mock-skills";
import { createMockStorage } from "./mock-storage";
import { clone, type Listener, type MockRuntime, matchesQuery } from "./mock-support";
import { createMockTeam, type MockTeamOptions } from "./mock-team";
import { createMockVault } from "./mock-vault";
import { createMockVoice, type MockVoiceOptions } from "./mock-voice";
import { type MockWorkflowSeed, mockWorkflows } from "./mock-workflows";

export interface MockOpenBotOptions
  extends MockProviderRuntimeOptions,
    MockVoiceOptions,
    MockAuthOptions,
    MockBrowserOptions,
    MockTeamOptions,
    MockSkillsOptions,
    MockHostUpdateOptions,
    MockRoutineResultsOptions {
  appInfo?: AppInfo;
  analyticsPreference?: AnalyticsPreference;
  analyticsDefault?: boolean;
  languagePreference?: AppLanguagePreference;
  setupState?: AppSetupState;
  agentStatus?: AgentStatus;
  usage?: AccountUsage;
  agents?: ClientAgentSummary[];
  models?: ClientAgentModelOption[];
  snapshots?: Record<string, ConversationSnapshot>;
  queues?: Record<string, QueueDelivery[]>;
  tasks?: Record<string, AgentTask[]>;
  taskConversations?: Record<string, ConversationSnapshot>;
  pinnedMessages?: Record<string, (string | { messageId: string; pinnedBy: MessagePinner })[]>;
  taskUnread?: Record<string, number>;
  updateStatus?: UpdateStatus;
  memories?: Record<string, AgentMemory[]>;
  tables?: SharedTable[];
  routines?: Record<string, Routine[]>;
  routineRuns?: Record<string, RoutineRun[]>;
  workflows?: MockWorkflowSeed[];
  crm?: MockCrmSeed;
  customProviders?: CustomProviderSummary[];
  conversationReads?: Record<string, ConversationReadState>;
  runtimeSnapshot?: AgentRuntimeSnapshot;
  storyForeignAgent?: boolean;
  channels?: MockChannelSeed[];
  sidebarLayout?: SidebarLayoutSnapshot;
}

export interface MockSentMessage {
  agentId: string;
  text: string;
  turnId: string;
  delivery: QueueDelivery;
}

function mockTurnTrace(turnId: string, endedAt: Date): ConversationTurnTrace {
  const end = endedAt.getTime();
  const at = (offsetMs: number) => new Date(end - 6_400 + offsetMs).toISOString();
  return {
    startedAt: at(0),
    endedAt: endedAt.toISOString(),
    steps: [
      { id: `${turnId}:thought`, kind: "reasoning", startedAt: at(180), endedAt: at(1_420) },
      {
        id: `${turnId}:read`,
        kind: "tool",
        text: "Gathering the relevant information…",
        startedAt: at(1_500),
        endedAt: at(2_260),
      },
      {
        id: `${turnId}:search`,
        kind: "tool",
        text: "Searching for current information…",
        startedAt: at(2_340),
        endedAt: at(3_910),
        failed: true,
        error: "fetch failed: getaddrinfo ENOTFOUND search.example.com",
      },
      {
        id: `${turnId}:edit`,
        kind: "tool",
        text: "Making the requested changes…",
        startedAt: at(4_020),
        endedAt: at(5_480),
      },
      { id: `${turnId}:answer`, kind: "message", startedAt: at(5_560), endedAt: at(6_400) },
    ],
    tokens: 18_342,
    cachedInput: 14_120,
    costUsd: 0.0427,
  };
}

function mockCustomProviderModels(provider: CustomProviderSummary): ClientAgentModelOption[] {
  const harness = provider.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS;
  return provider.models.map((model) => {
    const efforts = model.reasoningEfforts ?? (harness === "pi" ? [] : (["low", "medium", "high"] as const));
    return {
      provider: harness,
      id: savedCustomModelId(provider.id, harness, model.id),
      name: `${provider.name}/${model.name}`,
      description: `Served by ${provider.baseUrl}.`,
      defaultReasoningEffort: efforts.includes("medium") ? "medium" : (efforts[0] ?? "medium"),
      supportedReasoningEfforts: [...efforts],
    };
  });
}

export interface MockOpenBotControls {
  api: OpenBotDesktopApi;
  emitAgentEvent: (event: AgentEvent) => void;
  onLatestConversationOpened: (listener: (agentId: string) => void) => () => void;
  onLatestDirectConversationOpened: (listener: (memberId: string) => void) => () => void;
  readConversationSnapshot: (agentId: string) => ConversationSnapshot;
  updateConversationSnapshot: (
    agentId: string,
    update: (snapshot: ConversationSnapshot) => void,
  ) => ConversationSnapshot;
  readDirectConversationSnapshot: (memberId: string) => DirectConversationSnapshot;
  updateDirectConversationSnapshot: (
    memberId: string,
    update: (snapshot: DirectConversationSnapshot) => void,
  ) => DirectConversationSnapshot;
  emitConversationDelta: (
    event: Omit<Extract<AgentEvent, { type: "conversation-delta" }>, "type" | "revision">,
  ) => void;
  setQueueSnapshot: (agentId: string, deliveries: QueueDelivery[], hold?: QueueHold | null) => QueueSnapshot;
  setRuntimeSnapshot: (snapshot: AgentRuntimeSnapshot) => void;
  onMessageSent: (listener: (message: MockSentMessage) => boolean) => () => void;
  onPromptResponse: (listener: (input: RespondToPromptInput) => void) => () => void;
  emitAuthState: (state: CentralAuthState) => void;
  emitPresence: (snapshot: TeamPresenceSnapshot) => void;
  emitDirectMessage: (event: DirectMessageRealtimeEvent) => void;
  emitDirectTyping: (event: DirectTypingRealtimeEvent) => void;
  emitInvite: (inviteUrl: string) => void;
  emitHostStatus: (status: HostStatus) => void;
  emitRemoteDesktopSessions: (sessions: RemoteDesktopSession[]) => void;
  dispose: () => void;
}

function mockFilePreview(path: string, fallbackName: string): FilePreview {
  return (
    filePreviewForPath(path) ?? {
      name: path.split("/").at(-1) ?? fallbackName,
      size: 0,
      mimeType: "application/octet-stream",
      previewKind: "none",
      bytes: null,
    }
  );
}

function mockWorkspaceDirectory(path: string): WorkspaceDirectory {
  const folder = path.replace(/\/+$/u, "") || ".";
  const child = (name: string) => (folder === "." ? name : `${folder}/${name}`);
  const modifiedAt = Date.UTC(2026, 9, 1, 9, 30);
  return {
    name: folder.split("/").at(-1) ?? folder,
    path: folder,
    root: "/Users/demo/OpenBot/Agents/research",
    parentPath: folder === "." ? null : folder.split("/").slice(0, -1).join("/") || ".",
    entries: [
      { name: "sources", path: child("sources"), kind: "directory", size: 0, modifiedAt },
      { name: "brief.md", path: child("brief.md"), kind: "file", size: 4_812, modifiedAt },
      { name: "notes.txt", path: child("notes.txt"), kind: "file", size: 1_204, modifiedAt },
    ],
    truncated: false,
  };
}

const STORY_INSTALLED_FONTS = [
  "Al Bayan",
  "Arial",
  "Avenir Next",
  "Baghdad",
  "Courier New",
  "Geeza Pro",
  "Georgia",
  "Helvetica Neue",
  "Menlo",
  "Monaco",
  "Noto Nastaliq Urdu",
  "Tahoma",
  "Times New Roman",
  "Verdana",
];

const PREVIEW_BROWSERS: ExternalLinkBrowsers = {
  defaultBrowser: { name: "Safari", path: "/Applications/Safari.app" },
  browsers: [
    { name: "Arc", path: "/Applications/Arc.app" },
    { name: "Brave Browser", path: "/Applications/Brave Browser.app" },
    { name: "Firefox", path: "/Applications/Firefox.app" },
    { name: "Google Chrome", path: "/Applications/Google Chrome.app" },
    { name: "Safari", path: "/Applications/Safari.app" },
  ],
};

const MOCK_MCP_TOOL_COUNTS: Record<string, number> = { "Local SQLite": 12, Linear: 1, Figma: 6 };
const MOCK_MCP_SIGN_IN_URL = "https://mcp.granola.ai/mcp";

export function createMockOpenBot(options: MockOpenBotOptions = {}): MockOpenBotControls {
  const appInfo = clone(options.appInfo ?? STORY_APP_INFO);
  let setupState = clone<AppSetupState>(
    options.setupState ?? { completed: true, preferredProvider: "codex", preferredModel: null },
  );
  const grantedComputerUsePermissions = new Set<MacPermissionId>();
  let backgroundProcesses: BackgroundProcess[] = [
    {
      id: "48210:1",
      pid: 48210,
      command: "node /mock/OpenBot/Agents/research/site/node_modules/.bin/vite --port 5173",
      startedAt: Date.now() - 2 * 60 * 60_000,
      ports: [5173],
      agentId: "research",
    },
    {
      id: "51377:1",
      pid: 51377,
      command: "python3 -m http.server 8000",
      startedAt: Date.now() - 3 * 24 * 60 * 60_000,
      ports: [8000],
      agentId: null,
    },
  ];
  const computerUseState = (): ComputerUseState => {
    const permissions = (["screen-recording", "accessibility"] as const).map((id) => ({
      id,
      granted: grantedComputerUsePermissions.has(id),
    }));
    return {
      status: permissions.every(({ granted }) => granted) ? "ready" : "permissions-required",
      permissions,
      message: null,
    };
  };
  let analyticsPreference = clone<AnalyticsPreference>(options.analyticsPreference ?? { enabled: true });
  let approvalAutomation = clone<ApprovalAutomationPreference>(DEFAULT_APPROVAL_AUTOMATION_PREFERENCE);
  let busyMessageMode: BusyMessageModePreference = { mode: DEFAULT_BUSY_MESSAGE_MODE };
  let agentDefaults: AgentDefaults = { ...DEFAULT_AGENT_DEFAULTS };
  const hostTurnLimits = createMockHostTurnLimits(() => emitAgentEvent({ type: "host-turn-limits-changed" }));
  let agentMemoryLimit: AgentMemoryLimitPreference = { limit: DEFAULT_AGENT_MEMORY_LIMIT };
  let memoryReview: MemoryReviewPreference = { interval: DEFAULT_MEMORY_REVIEW_INTERVAL };
  let skillLearning: SkillLearningPreference = { mode: DEFAULT_SKILL_LEARNING_MODE };
  let browsingMemory: BrowsingMemoryPreference = { ...DEFAULT_BROWSING_MEMORY_PREFERENCE };
  let machineAlerts: MachineAlertSettings = { ...DEFAULT_MACHINE_ALERT_SETTINGS, diskPercent: 80 };
  let promptCacheTtl: PromptCacheTtlSetting = { ...DEFAULT_PROMPT_CACHE_TTL };
  let claudeUserSetup: ClaudeUserSetupSetting = { ...DEFAULT_CLAUDE_USER_SETUP };
  let cacheExpiryCompaction: CacheExpiryCompactionSetting = { ...DEFAULT_CACHE_EXPIRY_COMPACTION };
  let mediaApprovalCredits: MediaApprovalCreditsSetting = { ...DEFAULT_MEDIA_APPROVAL_CREDITS_SETTING };
  let claudeCompactWindow: ClaudeCompactWindowSetting = { ...DEFAULT_CLAUDE_COMPACT_WINDOW };
  const providerVariables = new Map<
    ProviderEnvironmentProvider,
    { name: string; value: string; sensitive: boolean }[]
  >();
  const shownModels = new Map<string, readonly string[]>();
  let agentAccess: AgentAccessChange = { revision: 0, everyone: {}, roles: [] };
  let serverAudit: ServerAuditEntry[] = clone(STORY_SERVER_AUDIT_ENTRIES);
  const agentMemoryLimitListeners = new Set<(preference: AgentMemoryLimitPreference) => void>();
  let remoteSessionReuse: RemoteSessionReusePreference = { ...DEFAULT_REMOTE_SESSION_REUSE_PREFERENCE };
  let externalLinks: ExternalLinkPreference = clone(DEFAULT_EXTERNAL_LINK_PREFERENCE);
  let remoteNetworkRoute: RemoteNetworkRouteState = { route: DEFAULT_REMOTE_NETWORK_ROUTE, tailscaleConnected: true };
  let appBehavior: AppBehaviorPreference = {
    launchAtLogin: false,
    keepRunningInBackground: false,
    keepAwake: false,
    keepAwakeOnBattery: false,
    quitGuard: "working",
  };
  let languagePreference = clone<AppLanguagePreference>(options.languagePreference ?? { language: "system" });
  const languageListeners = new Set<(preference: AppLanguagePreference) => void>();
  let logoColorPreference: AppLogoColorPreference = { color: DEFAULT_APP_LOGO_COLOR };
  const logoColorListeners = new Set<(preference: AppLogoColorPreference) => void>();
  let appearancePreference: AppAppearancePreference = {
    appearance: DEFAULT_APP_APPEARANCE,
    transparentWindow: DEFAULT_TRANSPARENT_WINDOW,
    palette: null,
    palettes: [],
    chatBackgroundLight: null,
    chatBackgroundDark: null,
    interfaceFont: null,
    codeFont: null,
  };
  const appearanceListeners = new Set<(preference: AppAppearancePreference) => void>();
  let interfaceSizePreference: AppInterfaceSizePreference = { percent: DEFAULT_APP_INTERFACE_SIZE };
  const interfaceSizeListeners = new Set<(preference: AppInterfaceSizePreference) => void>();
  const approvalAutomationListeners = new Set<(preference: ApprovalAutomationPreference) => void>();
  let dynamicIslandPreference: DynamicIslandPreference = { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE };
  let dynamicIslandPresentation: DynamicIslandPresentation = { serverId: "local", mode: "idle" };
  let agentStatus = clone(options.agentStatus ?? STORY_AGENT_STATUS);
  const changeProviderAccounts = (
    provider: AgentProviderId,
    change: (accounts: ProviderAccountStatus[]) => ProviderAccountStatus[],
  ): AgentStatus => {
    const providers = agentStatus.providers;
    if (!providers) return agentStatus;
    agentStatus = {
      ...agentStatus,
      providers: providers.map((row) => {
        if (row.id !== provider) return row;
        const accounts = row.accounts ?? [
          { id: DEFAULT_PROVIDER_ACCOUNT_ID, label: null, email: null, state: "connected", message: null },
        ];
        return { ...row, accounts: change(accounts) };
      }),
    };
    emitAgentEvent({ type: "status", status: clone(agentStatus) });
    return agentStatus;
  };
  let agents = clone(options.agents ?? STORY_AGENT_SUMMARIES);
  const agentNotificationLevels = new Map<string, Map<string, ServerNotificationLevel>>();
  const notificationLevelsOf = (serverId: string | undefined) => {
    const key = serverId ?? LOCAL_SERVER_ID;
    const levels = agentNotificationLevels.get(key) ?? new Map<string, ServerNotificationLevel>();
    agentNotificationLevels.set(key, levels);
    return levels;
  };
  const notificationLevelsSnapshot = (levels: ReadonlyMap<string, ServerNotificationLevel>) => ({
    server: null,
    agents: [...levels].map(([agentId, level]) => ({ agentId, level })),
  });
  let browserProfiles: { id: string; name: string; hue: AvatarHue }[] = [
    { id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "Client A", hue: 215 },
    { id: "f9e8d7c6b5a4938271605f4e3d2c1b0a", name: "Client B", hue: 30 },
  ];
  const browserProfileSummary = (profile: { id: string; name: string; hue: AvatarHue }): BrowserProfileSummary => ({
    ...profile,
    agentIds: agents.filter((agent) => agent.browserProfileId === profile.id).map((agent) => agent.id),
    tabCount: 0,
  });
  const withBrowserProfile = (
    { browserProfileId: _previous, ...agent }: ClientAgentSummary,
    profile: AgentBrowserProfile,
  ): ClientAgentSummary =>
    profile.kind === "profile"
      ? { ...agent, ownBrowserSession: true, browserProfileId: profile.profileId }
      : { ...agent, ownBrowserSession: profile.kind === "agent" };
  const requireBrowserProfile = (profileId: string) => {
    const profile = browserProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) throw new Error(sourceText("error.backend.browserProfileNotFound"));
    return profile;
  };
  const requireFreeBrowserProfileName = (name: string, profileId?: string) => {
    if (
      browserProfiles.some((profile) => profile.id !== profileId && profile.name.toLowerCase() === name.toLowerCase())
    )
      throw new Error(sourceText("error.backend.browserProfileNameTaken"));
  };
  let browserProxies: BrowserProxySummary[] = [
    {
      id: "1b2c3d4e5f60718293a4b5c6d7e8f90a",
      scheme: "socks5",
      host: "proxy.example.net",
      port: 1080,
      username: null,
      hasPassword: false,
      profileIds: ["0a1b2c3d4e5f60718293a4b5c6d7e8f9"],
      failure: null,
    },
  ];
  const requireBrowserProxy = (proxyId: string) => {
    const proxy = browserProxies.find((candidate) => candidate.id === proxyId);
    if (!proxy) throw new Error(sourceText("error.backend.browserProxyNotFound"));
    return proxy;
  };
  const sessionSettings = new Map<string, AgentSessionSettings>();
  function previewSessionSettings(agentId: string): AgentSessionSettings {
    const agent = agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error("Agent not found");
    let value = sessionSettings.get(agentId);
    if (!value || value.providerIdentity !== agent.provider) {
      value = {
        agentId,
        providerIdentity: agent.provider,
        pending: false,
        overrides: {},
        options: [
          { id: "compact", name: "Compact replies", type: "boolean", currentValue: false },
          {
            id: "format",
            name: "Reply format",
            type: "select",
            currentValue: "auto",
            options: [
              { value: "auto", name: "Automatic" },
              { value: "brief", name: "Brief" },
            ],
          },
        ],
      };
      sessionSettings.set(agentId, value);
    }
    return value;
  }
  let mcpServers = clone(STORY_MCP_SERVERS);
  let mcpAccess: Record<string, McpServerAccess> = {};
  let mcpAccessRevision = 0;
  const mcpAccessSnapshot = (): McpAccessSnapshot => ({
    revision: mcpAccessRevision,
    mine: Object.fromEntries(mcpServers.map((server) => [server.id, "manage" as const])),
    servers: clone(mcpAccess),
  });
  let mcpSignedIn = new Set<string>();
  let mcpLost = new Set<string>(["mcp-figma"]);
  let mcpSignedInUrls = new Set<string>();
  let cancelPendingMcpSignIn: (() => void) | null = null;
  const forgetMcpSignIn = (mcpServerId: string) => {
    const url = mcpServers.find((server) => server.id === mcpServerId)?.url;
    mcpSignedIn = new Set([...mcpSignedIn].filter((id) => id !== mcpServerId));
    mcpLost = new Set([...mcpLost].filter((id) => id !== mcpServerId));
    mcpSignedInUrls = new Set([...mcpSignedInUrls].filter((signedIn) => signedIn !== url));
  };
  const mcpSignInStates = () =>
    mcpServers
      .filter((server) => server.transport === "http")
      .map((server) => ({
        mcpServerId: server.id,
        signedIn: mcpSignedIn.has(server.id) || mcpSignedInUrls.has(server.url),
        needsSignIn: mcpLost.has(server.id),
      }));
  let mcpSignInApps: Record<string, McpSignInApp> = {};
  const mcpSignInAppState = (mcpServerId: string): McpSignInAppState => ({
    redirectUrl: "http://127.0.0.1:28417/mcp-auth",
    app: mcpSignInApps[mcpServerId] ?? null,
  });
  let sidebarPins: SidebarPinsSnapshot = { items: [], updatedAt: null };
  let sidebarLayout: SidebarLayoutSnapshot = clone(
    options.sidebarLayout ?? {
      revision: 0,
      sections: [],
      order: [SIDEBAR_PEOPLE_SECTION_ID, SIDEBAR_UNASSIGNED_SECTION_ID],
      agentAssignments: {},
      agentOrder: [],
    },
  );
  const models = clone(options.models ?? STORY_MODELS);
  const snapshots = clone(options.snapshots ?? STORY_SNAPSHOTS);
  let updateStatus = clone(options.updateStatus ?? STORY_UPDATE_STATUS);
  let updatePreference: UpdatePreference = { autoDownload: true, allowRemoteUpdates: true, autoInstall: false };
  const usage = clone(options.usage ?? STORY_USAGE);
  const usageResets = new Map<string, number>();
  let agentCounter = agents.length;
  let hostedSites = clone(STORY_HOSTED_SITES);
  let detectionSettings: ProviderDetectionSettings = clone(DEFAULT_PROVIDER_DETECTION_SETTINGS);
  let customAgents: CustomAgentSummary[] = [];
  const registryEntry: AcpRegistryEntry = {
    id: "example-acp",
    name: "Example ACP",
    version: "1.0.0",
    description: "Preview agent",
    website: null,
    license: "MIT",
    distributions: ["binary"],
    installedVersion: null,
    customAgentId: null,
  };
  let customProviders = clone(
    options.customProviders ?? [
      {
        id: "studio-local",
        name: "Studio Local",
        baseUrl: "http://127.0.0.1:11434/v1",
        hasApiKey: false,
        models: [
          { id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" },
          { id: "gpt-oss:120b", name: "GPT-OSS 120B" },
        ],
      },
      {
        id: "house-router",
        name: "House Router",
        baseUrl: "https://models.example.com/v1",
        hasApiKey: true,
        headerNames: ["X-Team"],
        models: [{ id: "glm-5-air", name: "GLM-5 Air" }],
      },
    ],
  );
  let marketplaceAgentSubmissions = clone(STORY_AGENT_SUBMISSIONS);
  const agentTemplatePublications = new Map<string, AgentTemplatePublication>();
  let messageCounter = 10;
  const sentReceipts = new Map<string, QueuedMessageReceipt>();

  const providerApiKeys = new Set<AgentProviderId>();

  const agentListeners = new Set<Listener<AgentEvent>>();
  const updateListeners = new Set<Listener<UpdateStatus>>();
  const attachmentListeners = new Set<Listener<AttachmentImportEvent>>();
  const latestConversationListeners = new Set<Listener<string>>();
  const messageSentListeners = new Set<(message: MockSentMessage) => boolean>();
  const promptResponseListeners = new Set<Listener<RespondToPromptInput>>();
  const conversationReads = new Map(Object.entries(clone(options.conversationReads ?? {})));
  let runtimeSnapshot = options.runtimeSnapshot ? clone(options.runtimeSnapshot) : null;
  const storyForeignServerId = options.storyForeignAgent === false ? null : STORY_FOREIGN_SERVER_ID;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const emit = <T>(listeners: Set<Listener<T>>, value: T) => {
    for (const listener of listeners) listener(clone(value));
  };
  const schedule = (callback: () => void, delay = 24) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  };
  const runtime: MockRuntime = { emit, schedule };
  const emptyQueue = (agentId: string): QueueSnapshot => ({ agentId, deliveries: [] });
  const queueEdits = new Map<string, { agentId: string; delivery: QueueDelivery }>();
  const queueSeeds = clone(options.queues ?? STORY_QUEUES);
  const queues = new Map<string, QueueSnapshot>(
    agents.map((agent) => [agent.id, { agentId: agent.id, deliveries: queueSeeds[agent.id] ?? [] }]),
  );
  const memories = new Map<string, AgentMemory[]>(Object.entries(clone(options.memories ?? {})));
  const memorySelections = new Map<string, AgentMemorySelection>();
  for (const entries of memories.values()) {
    const selected: AgentMemory[] = [];
    for (const entry of [...entries].sort((left, right) => {
      if (left.origin !== right.origin) return left.origin === "manual" ? -1 : 1;
      return left.updatedAt !== right.updatedAt
        ? left.updatedAt > right.updatedAt
          ? -1
          : 1
        : left.id < right.id
          ? -1
          : left.id > right.id
            ? 1
            : 0;
    })) {
      const inclusion =
        essentialMemoryBytes([...selected, entry]) <= AGENT_MEMORY_CONTEXT_BUDGET_BYTES ? "essential" : "searchable";
      if (inclusion === "essential") selected.push(entry);
      memorySelections.set(entry.id, { memoryId: entry.id, inclusion, userControlled: false, revision: 0 });
    }
  }
  function getMemorySelection(agentId: string): AgentMemorySelectionState {
    const entries = memories.get(agentId) ?? [];
    return {
      selections: entries.map(
        (entry) =>
          memorySelections.get(entry.id) ?? {
            memoryId: entry.id,
            inclusion: "searchable",
            userControlled: false,
            revision: 0,
          },
      ),
      usedBytes: essentialMemoryBytes(
        entries.filter((entry) => memorySelections.get(entry.id)?.inclusion === "essential"),
      ),
      budgetBytes: AGENT_MEMORY_CONTEXT_BUDGET_BYTES,
    };
  }

  let tables: SharedTable[] = clone(options.tables ?? STORY_SHARED_TABLES);
  const routines = new Map<string, Routine[]>(Object.entries(clone(options.routines ?? {})));
  const routineRuns = new Map<string, RoutineRun[]>(Object.entries(clone(options.routineRuns ?? {})));

  function requireMockAgent(agentId: string): ClientAgentSummary {
    const agent = agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error("Agent not found");
    return agent;
  }

  const mockInstructionFiles = new Map<string, AgentInstructionsFile>();

  function mockAgentInstructions(agentId: string): AgentInstructionsFile {
    requireMockAgent(agentId);
    return mockInstructionFiles.get(agentId) ?? { fileName: "AGENTS.md", exists: false, text: "" };
  }

  function mockAgentFolders(agentId: string): AgentFolderList {
    const agent = requireMockAgent(agentId);
    return {
      workspace: agent.workspacePath,
      shared: "/mock/OpenBot/Shared",
      folders: (agent.additionalFolders ?? []).map((path) => ({ path, found: !path.endsWith("(missing)") })),
      excluded: agent.excludedFolders ?? [],
    };
  }

  function setMockAgentExclusions(agent: ClientAgentSummary, excluded: string[]): void {
    const updated: ClientAgentSummary = { ...agent, excludedFolders: excluded };
    if (excluded.length === 0) delete updated.excludedFolders;
    agents = agents.map((candidate) => (candidate.id === agent.id ? updated : candidate));
    emitAgentEvent({ type: "agents-changed", agents });
  }

  function addMockAgentExclusion(agentId: string, path: string): AgentExclusionChange {
    const agent = requireMockAgent(agentId);
    const list = mockAgentFolders(agentId);
    const roots = [list.workspace, list.shared, ...list.folders.map((folder) => folder.path)];
    if (roots.includes(path)) return { outcome: "refused", path, refusal: "root", list };
    if (!roots.some((root) => folderInside(root, path))) return { outcome: "refused", path, refusal: "outside", list };
    const folder = agentExclusionCoverage(path, list.excluded);
    if (folder) return { outcome: "covered", path, folder, list };
    const kept = list.excluded.filter((excluded) => !folderInside(path, excluded));
    if (kept.length >= AGENT_FOLDER_LIMIT) return { outcome: "refused", path, refusal: "limit", list };
    setMockAgentExclusions(agent, [...kept, path]);
    const replaced = list.excluded.filter((excluded) => !kept.includes(excluded));
    return { outcome: "excluded", path, replaced, list: mockAgentFolders(agentId) };
  }

  function setMockAgentFolders(agent: ClientAgentSummary, folders: string[]): void {
    const updated: ClientAgentSummary = { ...agent, additionalFolders: folders };
    if (folders.length === 0) delete updated.additionalFolders;
    agents = agents.map((candidate) => (candidate.id === agent.id ? updated : candidate));
    emitAgentEvent({ type: "agents-changed", agents });
  }

  function addMockAgentFolder(agentId: string, path: string, replace?: string): AgentFolderChange {
    const agent = requireMockAgent(agentId);
    const current = agent.additionalFolders ?? [];
    const others = current.filter((folder) => folder !== replace);
    const list = mockAgentFolders(agentId);
    const coverage = agentFolderCoverage(path, { workspace: list.workspace, shared: list.shared, folders: others });
    if (coverage) return { outcome: "covered", path, coverage, list };
    const kept = others.filter((folder) => !folderInside(path, folder));
    if (kept.length >= AGENT_FOLDER_LIMIT) return { outcome: "refused", path, refusal: "limit", list };
    const replacing = replace !== undefined && current.includes(replace);
    setMockAgentFolders(
      agent,
      replacing ? current.map((folder) => (folder === replace ? path : folder)) : [...kept, path],
    );
    if (replacing) return { outcome: "replaced", path, list: mockAgentFolders(agentId) };
    const replaced = others.filter((folder) => !kept.includes(folder));
    return { outcome: "added", path, replaced, list: mockAgentFolders(agentId) };
  }

  const mockChannelFolderPaths = new Map<string, string[]>();

  function mockChannelFolders(channelId: string): ChannelFolderList {
    return { folders: (mockChannelFolderPaths.get(channelId) ?? []).map((path) => ({ path, found: true })) };
  }

  function addMockChannelFolder(channelId: string, path: string): ChannelFolderChange {
    const current = mockChannelFolderPaths.get(channelId) ?? [];
    const list = mockChannelFolders(channelId);
    const folder = channelFolderCoverage(path, current);
    if (folder) return { outcome: "covered", path, folder, list };
    const kept = current.filter((existing) => !folderInside(path, existing));
    if (kept.length >= CHANNEL_FOLDER_LIMIT) return { outcome: "refused", path, refusal: "limit", list };
    mockChannelFolderPaths.set(channelId, [...kept, path]);
    const replaced = current.filter((existing) => !kept.includes(existing));
    return { outcome: "added", path, replaced, list: mockChannelFolders(channelId) };
  }

  function allModels() {
    return [...models, ...customProviders.flatMap(mockCustomProviderModels)].filter(
      (model) => !agentStatus.providers?.some((row) => row.id === model.provider && row.off),
    );
  }

  function modelVisibility(provider: AgentProviderRef): ProviderModelVisibility {
    const listed = allModels().filter((model) => model.provider === provider);
    const shown = shownModels.get(provider);
    return clone({
      provider,
      models: listed.map((model) => ({ id: model.id, name: model.name })),
      shown: listed.filter((model) => !shown || shown.includes(model.id)).map((model) => model.id),
      changed: shown !== undefined,
    });
  }

  function emitAgentEvent(event: AgentEvent): void {
    emit(agentListeners, event);
  }

  const tasks = new Map<string, AgentTask[]>(Object.entries(clone(options.tasks ?? {})));
  const taskConversations = new Map<string, ConversationSnapshot>(
    Object.entries(clone(options.taskConversations ?? {})),
  );
  const taskUnread = new Map<string, number>(Object.entries(options.taskUnread ?? {}));
  const branches = new Map<string, AgentTask>();

  const newestTaskFirst = (left: AgentTask, right: AgentTask) =>
    right.updatedAt.localeCompare(left.updatedAt) || left.threadId.localeCompare(right.threadId);

  function taskList(agentId: string): AgentTasksSnapshot {
    const list = tasks.get(agentId) ?? [];
    const archived = list.filter((task) => task.closedAt).sort(newestTaskFirst);
    return {
      agentId,
      tasks: clone([...list.filter((task) => !task.closedAt), ...archived].slice(0, INPUT_LIMITS.agentTasks)),
      limit: agentTaskLimitOf(agentId),
    };
  }

  function archivedTaskPage(input: ListArchivedAgentTasksInput): ArchivedAgentTasksPage {
    const { before } = input;
    const archived = (tasks.get(input.agentId) ?? [])
      .filter((task) => task.closedAt)
      .sort(newestTaskFirst)
      .filter(
        (task) =>
          !before ||
          task.updatedAt < before.updatedAt ||
          (task.updatedAt === before.updatedAt && task.threadId > before.threadId),
      );
    return {
      tasks: clone(archived.slice(0, INPUT_LIMITS.agentTasks)),
      hasMore: archived.length > INPUT_LIMITS.agentTasks,
    };
  }

  function agentTaskLimitOf(agentId: string): number {
    const agent = agents.find((candidate) => candidate.id === agentId);
    return agent && isAgentSummary(agent) ? agentTaskLimit(agent) : 1;
  }

  function hiddenAgents(): HiddenAgentsSnapshot {
    return {
      agents: agents
        .flatMap((agent) => (agent.hiddenAt === undefined ? [] : [{ agentId: agent.id, hiddenAt: agent.hiddenAt }]))
        .sort(
          (left, right) => left.hiddenAt.localeCompare(right.hiddenAt) || left.agentId.localeCompare(right.agentId),
        ),
    };
  }

  function emitTasks(agentId: string): void {
    emitAgentEvent({ type: "agent-tasks-changed", snapshot: taskList(agentId) });
  }

  const messagePins = new Map<string, { messageId: string; pinnedAt: string; pinnedBy: MessagePinner }[]>(
    Object.entries(clone(options.pinnedMessages ?? {})).map(([key, entries]) => [
      key,
      entries.map((entry, index) => ({
        ...(typeof entry === "string" ? { messageId: entry, pinnedBy: { kind: "person", sender: null } } : entry),
        pinnedAt: new Date(Date.now() - index * 60_000).toISOString(),
      })),
    ]),
  );
  const pinKey = (target: { agentId: string; taskId?: string | undefined }) => target.taskId ?? target.agentId;
  const pinnableMessages = (target: { agentId: string; taskId?: string | undefined }) =>
    target.taskId === undefined
      ? getSnapshot(target.agentId).messages
      : taskConversation(findTask(target.agentId, target.taskId)).messages;
  function pinnedSnapshot(agentId: string): PinnedMessagesSnapshot {
    const chats = [
      { taskId: undefined, title: null },
      ...(tasks.get(agentId) ?? []).map((task) => ({ taskId: task.id, title: task.title })),
    ];
    const pins: PinnedMessage[] = [];
    for (const chat of chats) {
      const messages = new Map(
        pinnableMessages({ agentId, taskId: chat.taskId }).map((message) => [message.id, message]),
      );
      for (const pin of messagePins.get(pinKey({ agentId, taskId: chat.taskId })) ?? []) {
        const message = messages.get(pin.messageId);
        if (!message) continue;
        pins.push({
          messageId: message.id,
          taskId: chat.taskId ?? null,
          threadTitle: chat.title?.slice(0, MESSAGE_PIN_THREAD_TITLE_LIMIT) ?? null,
          pinnedAt: pin.pinnedAt,
          pinnedBy: pin.pinnedBy,
          author: message.author === "user" ? "user" : "agent",
          sender: message.senderMember ?? null,
          senderAgentId: message.senderAgentId ?? null,
          createdAt: message.createdAt,
          text: message.text.trim().slice(0, MESSAGE_PIN_TEXT_LIMIT),
        });
      }
    }
    pins.sort((left, right) => right.pinnedAt.localeCompare(left.pinnedAt));
    return { agentId, pins: pins.slice(0, MESSAGE_PINS_LIST_LIMIT) };
  }

  function findTask(agentId: string, taskId: string): AgentTask {
    const task = tasks.get(agentId)?.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(sourceText("error.backend.threadNotFound"));
    return task;
  }

  function taskConversation(task: AgentTask): ConversationSnapshot {
    const existing = taskConversations.get(task.id);
    if (existing) return existing;
    const created: ConversationSnapshot = {
      agentId: task.agentId,
      threadId: task.threadId,
      activeTurnId: null,
      revision: 0,
      messages: [],
    };
    taskConversations.set(task.id, created);
    return created;
  }

  function createTask(agentId: string, text: string): AgentTask {
    const now = new Date().toISOString();
    const title =
      text
        .split("\n")
        .find((line) => line.trim())
        ?.trim()
        .slice(0, 120) ?? "";
    if (!title) throw new Error(sourceText("error.backend.threadTitleRequired"));
    const task: AgentTask = {
      id: `mock-task-${messageCounter++}`,
      agentId,
      threadId: `mock-task-thread-${messageCounter++}`,
      origin: "user",
      title,
      state: "idle",
      outcome: null,
      hold: null,
      activeTurnId: null,
      progress: null,
      error: null,
      queuedMessages: [],
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    };
    tasks.set(agentId, [task, ...(tasks.get(agentId) ?? [])]);
    return task;
  }

  function routineTask(agentId: string, routine: { id: string; name: string }): AgentTask {
    const listed = tasks.get(agentId) ?? [];
    const existing = listed.find((task) => task.routineId === routine.id);
    if (existing && !existing.closedAt) return existing;
    const now = new Date().toISOString();
    if (existing) {
      Object.assign(existing, { state: "idle", closedAt: null, updatedAt: now });
      emitTasks(agentId);
      return existing;
    }
    const task: AgentTask = {
      ...createTask(agentId, routine.name),
      origin: "agent",
      routineId: routine.id,
    };
    tasks.set(agentId, [task, ...listed]);
    emitTasks(agentId);
    return task;
  }

  function runTaskTurn(task: AgentTask, text: string, replyToMessageId: string | null = null): QueuedMessageReceipt {
    if (task.closedAt) throw new Error(sourceText("error.backend.threadArchived"));
    const deliveryId = `mock-delivery-${messageCounter++}`;
    const turnId = `mock-turn-${messageCounter++}`;
    const conversation = taskConversation(task);
    conversation.messages = [
      ...conversation.messages,
      {
        id: deliveryId,
        turnId,
        author: "user",
        source: "user",
        text,
        replyToMessageId,
        createdAt: new Date().toISOString(),
        status: "completed",
      },
    ];
    conversation.activeTurnId = turnId;
    conversation.revision += 1;
    Object.assign(task, {
      state: "running",
      activeTurnId: turnId,
      progress: "Reviewing the task…",
      updatedAt: new Date().toISOString(),
    });
    emitAgentEvent({ type: "agent-task-conversation", taskId: task.id, snapshot: clone(conversation) });
    emitTasks(task.agentId);
    schedule(() => {
      if (task.activeTurnId !== turnId) return;
      conversation.messages = [
        ...conversation.messages,
        {
          id: `mock-reply-${messageCounter++}`,
          turnId,
          author: "assistant",
          source: "assistant",
          text: `Mock task result: I finished “${text}”.`,
          createdAt: new Date().toISOString(),
          status: "completed",
        },
      ];
      conversation.activeTurnId = null;
      conversation.revision += 1;
      Object.assign(task, { state: "idle", activeTurnId: null, progress: null, outcome: "completed" });
      emitAgentEvent({ type: "agent-task-conversation", taskId: task.id, snapshot: clone(conversation) });
      emitTasks(task.agentId);
    }, 600);
    return {
      messageId: `mock-message-${messageCounter++}`,
      deliveries: [{ id: deliveryId, recipientAgentId: task.agentId, status: "running", position: null }],
    };
  }

  function getSnapshot(agentId: string): ConversationSnapshot {
    return (
      snapshots[agentId] ?? {
        agentId,
        threadId: `thread-${agentId}`,
        activeTurnId: null,
        revision: 0,
        messages: [],
      }
    );
  }

  function updateSnapshot(agentId: string, update: (snapshot: ConversationSnapshot) => void): void {
    const snapshot = getSnapshot(agentId);
    update(snapshot);
    snapshot.revision += 1;
    snapshots[agentId] = snapshot;
    emitAgentEvent({ type: "conversation", snapshot });
  }

  function readConversationSnapshot(agentId: string): ConversationSnapshot {
    return clone(getSnapshot(agentId));
  }

  function updateConversationSnapshot(
    agentId: string,
    update: (snapshot: ConversationSnapshot) => void,
  ): ConversationSnapshot {
    updateSnapshot(agentId, update);
    return readConversationSnapshot(agentId);
  }

  function emitConversationDelta(
    event: Omit<Extract<AgentEvent, { type: "conversation-delta" }>, "type" | "revision">,
  ): void {
    const snapshot = getSnapshot(event.agentId);
    snapshot.revision += 1;
    snapshots[event.agentId] = snapshot;
    emitAgentEvent({ ...event, type: "conversation-delta", revision: snapshot.revision });
  }

  function conversationReadState(agentId: string): ConversationReadState {
    const state = conversationReads.get(agentId);
    if (!state) return { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null };
    return readStateForMessages(state, getSnapshot(agentId).messages);
  }

  function setQueueSnapshot(agentId: string, deliveries: QueueDelivery[], hold?: QueueHold | null): QueueSnapshot {
    const snapshot: QueueSnapshot = { agentId, deliveries: clone(deliveries), ...(hold ? { hold: clone(hold) } : {}) };
    queues.set(agentId, snapshot);
    emitAgentEvent({ type: "queue-changed", snapshot });
    return clone(snapshot);
  }

  function createAgentSummary(
    input: { [Key in keyof ClientAgentSummary]?: ClientAgentSummary[Key] | undefined } = {},
  ): ClientAgentSummary {
    agentCounter += 1;
    const id = input.id ?? `mock-agent-${agentCounter}`;
    return {
      id,
      provider: input.provider ?? "codex",
      name: input.name ?? "New agent",
      title: input.title ?? "Generalist agent",
      description: input.description ?? "A new agent ready to help with focused work.",
      notifications: input.notifications ?? true,
      model: input.model ?? defaultProviderModel("codex"),
      reasoningEffort: input.reasoningEffort ?? "low",
      access: input.access ?? "full",
      computerUse: input.computerUse ?? true,
      ...(input.allowAutomation ? { allowAutomation: true } : {}),
      threadId: input.threadId ?? `thread-${id}`,
      workspacePath: input.workspacePath ?? `/mock/OpenBot/Agents/${id}`,
      preview: input.preview ?? "No messages yet",
      updatedAt: input.updatedAt ?? null,
      avatarSeed: input.avatarSeed ?? id,
      avatarHue: input.avatarHue ?? null,
      avatarUrl: input.avatarUrl ?? null,
      ...(input.marketplaceSource ? { marketplaceSource: input.marketplaceSource } : {}),
    };
  }

  function createRoutineRecord(input: {
    agentId: string;
    name: string;
    instruction: string;
    active: boolean;
    timezone: string;
    schedule: RoutineSchedule;
    limitPolicy?: Routine["limitPolicy"];
    missedPolicy?: Routine["missedPolicy"];
    runIn?: Routine["runIn"];
    runsChangeRoutines?: boolean;
  }): Routine {
    const now = new Date().toISOString();
    const routineId = crypto.randomUUID();
    return {
      id: routineId,
      agentId: input.agentId,
      name: input.name.trim(),
      instruction: input.instruction.trim(),
      active: input.active,
      timezone: input.timezone,
      limitPolicy: input.limitPolicy ?? "wait",
      missedPolicy: input.missedPolicy ?? "skip",
      runIn: input.runIn ?? "chat",
      runsChangeRoutines: input.runsChangeRoutines ?? false,
      trigger: {
        id: crypto.randomUUID(),
        routineId,
        schedule: input.schedule,
        nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
        createdAt: now,
        updatedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  const mockChannels = createMockChannels(
    emitAgentEvent,
    (agentId) => agents.find((entry) => entry.id === agentId)?.name ?? agentId,
    options.channels,
  );
  const mockProviderRuntimes = createMockProviderRuntimes(options, runtime);
  const mockVoice = createMockVoice(options, runtime);
  const mockAuth = createMockAuth(options, runtime);
  const mockSkills = createMockSkills(options, (agentId) => emitAgentEvent({ type: "skills-changed", agentId }));
  const { installedSkills, readInstalledSkills } = mockSkills;
  const mockBrowser = createMockBrowser(options, runtime, emitAgentEvent);
  const mockTeam = createMockTeam(options, runtime, emitAgentEvent, () => agents);
  const mockEvents = createMockEvents(({ owner, routineId, limit = 10 }) =>
    owner.kind === "agent"
      ? Promise.resolve(clone((routineRuns.get(routineId) ?? []).slice(0, limit)))
      : mockChannels.listChannelRoutineRuns({ channelId: owner.id, routineId, limit }),
  );
  const billingPlans = previewBillingServers();

  async function createMockAgent(input: CreateAgentInput, welcome: boolean): Promise<ClientAgentSummary> {
    const agent = createAgentSummary({
      name: input.name,
      title: "",
      description: input.description,
      avatarSeed: input.avatarSeed,
      avatarHue: input.avatarHue,
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
    });
    if (input.provider && input.model && input.providerAccountId) agent.providerAccountId = input.providerAccountId;
    agents = [...agents, agent];
    queues.set(agent.id, emptyQueue(agent.id));
    emitAgentEvent({ type: "agents-changed", agents });
    try {
      await api.agent.sendMessage({ agentId: agent.id, text: input.initialMessage, attachmentDraftIds: [] });
      if (welcome)
        updateSnapshot(agent.id, (snapshot) => {
          snapshot.messages = snapshot.messages.map((message) =>
            message.author === "user" ? { ...message, itemType: AGENT_WELCOME_ITEM_TYPE } : message,
          );
        });
      return clone(agent);
    } catch (error) {
      agents = agents.filter((candidate) => candidate.id !== agent.id);
      queues.delete(agent.id);
      delete snapshots[agent.id];
      emitAgentEvent({ type: "agents-changed", agents });
      throw error;
    }
  }

  const api: OpenBotDesktopApi = {
    getAppInfo: async () => clone(appInfo),
    getSetupState: async () => clone(setupState),
    saveSetup: async ({ preferredProvider, preferredModel }) => {
      setupState = { completed: true, preferredProvider, preferredModel };
      return clone(setupState);
    },
    onSetupState: () => () => undefined,
    getAnalyticsPreference: async () => clone(analyticsPreference),
    getAnalyticsDefault: async () => ({ enabled: options.analyticsDefault ?? false }),
    setAnalyticsPreference: async ({ enabled }) => {
      analyticsPreference = { enabled };
      return clone(analyticsPreference);
    },
    onAnalyticsPreference: () => () => undefined,
    reportRendererTiming: async () => undefined,
    getApprovalAutomation: async () => clone(approvalAutomation),
    onApprovalAutomation: (listener) => {
      approvalAutomationListeners.add(listener);
      return () => approvalAutomationListeners.delete(listener);
    },
    getBusyMessageModePreference: async () => clone(busyMessageMode),
    getAppBehaviorPreference: async () => clone(appBehavior),
    setAppBehaviorPreference: async (change) => {
      appBehavior = { ...appBehavior, ...change };
      return clone(appBehavior);
    },
    getRemoteSessionReusePreference: async () => clone(remoteSessionReuse),
    setRemoteSessionReusePreference: async ({ keepBetweenRuns }) => {
      remoteSessionReuse = { keepBetweenRuns };
      return clone(remoteSessionReuse);
    },
    getExternalLinkPreference: async () => clone(externalLinks),
    setExternalLinkPreference: async (preference) => {
      externalLinks = clone(preference);
      return clone(externalLinks);
    },
    listExternalLinkBrowsers: async () => clone(PREVIEW_BROWSERS),
    chooseExternalLinkApp: async () => ({ name: "Orion", path: "/Applications/Orion.app" }),
    onExternalLinkFallback: () => () => undefined,
    getRemoteNetworkRoute: async () => clone(remoteNetworkRoute),
    setRemoteNetworkRoute: async ({ route }) => {
      remoteNetworkRoute = { ...remoteNetworkRoute, route };
      return clone(remoteNetworkRoute);
    },
    getAgentDefaults: async () => clone(agentDefaults),
    getAgentMemoryLimitPreference: async () => clone(agentMemoryLimit),
    onAgentMemoryLimitPreference: (listener) => {
      agentMemoryLimitListeners.add(listener);
      return () => agentMemoryLimitListeners.delete(listener);
    },
    getAppLanguagePreference: async () => clone(languagePreference),
    setAppLanguagePreference: async ({ language }) => {
      languagePreference = { language };
      for (const listener of languageListeners) listener(clone(languagePreference));
      return clone(languagePreference);
    },
    onAppLanguagePreference: (listener) => {
      languageListeners.add(listener);
      return () => languageListeners.delete(listener);
    },
    getAppLogoColorPreference: async () => clone(logoColorPreference),
    setAppLogoColorPreference: async ({ color }) => {
      logoColorPreference = { color };
      for (const listener of logoColorListeners) listener(clone(logoColorPreference));
      return clone(logoColorPreference);
    },
    onAppLogoColorPreference: (listener) => {
      logoColorListeners.add(listener);
      return () => logoColorListeners.delete(listener);
    },
    getAppAppearancePreference: async () => clone(appearancePreference),
    setAppAppearancePreference: async (change) => {
      const next = { ...appearancePreference, ...change };
      const listed = next.palettes.some((palette) => palette.id === next.palette);
      appearancePreference = { ...next, palette: listed ? next.palette : null };
      for (const listener of appearanceListeners) listener(clone(appearancePreference));
      return clone(appearancePreference);
    },
    listInstalledFonts: async () => [...STORY_INSTALLED_FONTS],
    onAppAppearancePreference: (listener) => {
      appearanceListeners.add(listener);
      return () => appearanceListeners.delete(listener);
    },
    getAppInterfaceSizePreference: async () => clone(interfaceSizePreference),
    setAppInterfaceSizePreference: async ({ percent }) => {
      interfaceSizePreference = { percent };
      for (const listener of interfaceSizeListeners) listener(clone(interfaceSizePreference));
      return clone(interfaceSizePreference);
    },
    onAppInterfaceSizePreference: (listener) => {
      interfaceSizeListeners.add(listener);
      return () => interfaceSizeListeners.delete(listener);
    },
    onOpenSettings: () => () => undefined,
    onOpenUpdateSettings: () => () => undefined,
    openChatWindow: async () => undefined,
    getChatWindows: async () => [],
    onChatWindows: () => () => undefined,
    onQuitShortcutHint: () => () => undefined,
    browserDock: {
      publishPresentation: async () => undefined,
      getPresentation: async () => null,
      onPresentation: () => () => undefined,
      performAction: async () => undefined,
      onAction: () => () => undefined,
      setFrame: async () => undefined,
      onShown: () => () => undefined,
    },
    agentDock: {
      publishPresentation: async () => undefined,
      getPresentation: async () => null,
      onPresentation: () => () => undefined,
      performAction: async () => undefined,
      onAction: () => () => undefined,
      setInteractive: async () => undefined,
      setInputRegion: async () => undefined,
      setExtent: async () => undefined,
      setXWayland: async () => undefined,
      onCloseChat: () => () => undefined,
      listDisplays: async () => [{ id: 1, label: "Built-in Retina Display", primary: true, internal: true }],
      drag: async () => undefined,
      onMoved: () => () => undefined,
    },
    dynamicIsland: {
      getPreference: async () => clone(dynamicIslandPreference),
      setPreference: async (preference) => {
        dynamicIslandPreference = { ...preference };
        return clone(dynamicIslandPreference);
      },
      publishPresentation: async (presentation) => {
        dynamicIslandPresentation = clone(presentation);
      },
      getPresentation: async () => clone(dynamicIslandPresentation),
      getBuiltInDisplayGeometry: async () => ({ width: 192, height: 32 }),
      openBrowserTakeover: async () => undefined,
      onPreference: () => () => undefined,
      onPresentation: () => () => undefined,
      onGeometry: () => () => undefined,
      performAction: async () => undefined,
      performHaptic: async () => undefined,
      onAction: () => () => undefined,
      setInteractive: async () => undefined,
      setInputRegion: async () => undefined,
      setXWayland: async () => undefined,
    },
    macAutomation: {
      request: async (targets) => targets.map((target) => ({ target, status: "granted" })),
    },
    backgroundProcesses: {
      list: async () => clone(backgroundProcesses),
      stop: async (id) => {
        backgroundProcesses = backgroundProcesses.filter((process) => process.id !== id);
      },
    },
    computerUse: {
      getState: async () => computerUseState(),
      openPermissionPane: async (permission) => {
        grantedComputerUsePermissions.add(permission);
        return computerUseState();
      },
      closePermissionHelp: async () => undefined,
      getPermissionApp: async () => null,
      startPermissionAppDrag: async () => undefined,
      revealPermissionApp: async () => undefined,
      onHighlightPlacement: () => () => undefined,
    },
    openExternal: async () => undefined,
    getSentMessageStats: async () => ({ firstSentAt: "2026-10-01T09:00:00.000Z", sentCount: 40 }),
    connectProvider: async () => clone(agentStatus),
    connectProviderInMainlandChina: async () => clone(agentStatus),
    updateProviderCli: async () => clone(agentStatus),
    refreshAgentProviders: async () => clone(agentStatus),
    setProviderOn: async ({ provider, on }) => {
      if (!on && agents.some((agent) => agent.provider === provider))
        throw new Error(sourceText("error.provider.inUse", { provider }));
      if (agentStatus.providers)
        agentStatus = {
          ...agentStatus,
          providers: agentStatus.providers.map((row) => (row.id === provider ? { ...row, off: !on } : row)),
        };
      emitAgentEvent({ type: "status", status: clone(agentStatus) });
      return clone(agentStatus);
    },
    restartProvider: async () => clone(agentStatus),
    cancelProviderRestart: async () => clone(agentStatus),
    chooseInstalledCli: async ({ provider, installed }) => {
      if (agentStatus.providers)
        agentStatus = {
          ...agentStatus,
          providers: agentStatus.providers.map((row) =>
            row.id === provider && row.otherCliVersion && (row.cliSource === "system") !== installed
              ? {
                  ...row,
                  cliSource: installed ? "system" : "managed",
                  version: row.otherCliVersion,
                  ...(row.version ? { otherCliVersion: row.version } : {}),
                }
              : row,
          ),
        };
      emitAgentEvent({ type: "status", status: clone(agentStatus) });
      return clone(agentStatus);
    },
    startProviderCodeLogin: async (provider) =>
      provider === "claude"
        ? {
            kind: "paste",
            verificationUrl: "https://claude.com/cai/oauth/authorize?code=true",
            expiresAt: Date.now() + 10 * 60_000,
          }
        : provider === "cursor"
          ? {
              kind: "link",
              verificationUrl: "https://cursor.com/loginDeepControl?mode=login&redirectTarget=cli",
              expiresAt: Date.now() + 10 * 60_000,
            }
          : provider === "hermes"
            ? {
                kind: "code",
                userCode: "NOUS-1234",
                verificationUrl: "https://portal.nousresearch.com",
                expiresAt: Date.now() + 10 * 60_000,
              }
            : {
                kind: "code",
                userCode: "KTQ4-B62MX",
                verificationUrl: "https://auth.openai.com/codex/device",
                expiresAt: Date.now() + 10 * 60_000,
              },
    cancelProviderCodeLogin: async () => clone(agentStatus),
    cancelProviderSignIn: async () => clone(agentStatus),
    setProviderApiKey: async ({ provider, key }) => {
      if (!key.trim()) throw new Error("A provider key is required.");
      if (provider === "codex") {
        agentStatus = {
          ...agentStatus,
          providers: agentStatus.providers?.map((row) =>
            row.id === "codex" ? { ...row, state: "available", apiKeyInUse: true } : row,
          ),
        };
        emitAgentEvent({ type: "status", status: clone(agentStatus) });
        return clone(agentStatus);
      }
      providerApiKeys.add(provider);
      return clone(agentStatus);
    },
    clearProviderApiKey: async (provider) => {
      providerApiKeys.delete(provider);
      return clone(agentStatus);
    },
    connectProviderAccount: async ({ provider, accountId }) => {
      const changed = changeProviderAccounts(provider, (accounts) =>
        accountId
          ? accounts.map((account) =>
              account.id === accountId ? { ...account, state: "connected", message: null } : account,
            )
          : [
              ...accounts,
              {
                id: `a${(accounts.length + 1).toString(16).padStart(16, "0")}`,
                label: null,
                email: `account${accounts.length + 1}@example.com`,
                state: "connected",
                message: null,
              },
            ],
      );
      return clone(changed);
    },
    connectProviderAccountKey: async ({ provider, accountId }) => {
      const changed = changeProviderAccounts(provider, (accounts) =>
        accountId
          ? accounts.map((account) =>
              account.id === accountId ? { ...account, state: "connected", message: null } : account,
            )
          : [
              ...accounts,
              {
                id: `a${(accounts.length + 1).toString(16).padStart(16, "0")}`,
                label: null,
                email: null,
                state: "connected",
                message: null,
              },
            ],
      );
      return clone(changed);
    },
    cancelProviderAccountSignIn: async () => clone(agentStatus),
    renameProviderAccount: async ({ provider, accountId, label }) =>
      clone(
        changeProviderAccounts(provider, (accounts) =>
          accounts.map((account) => (account.id === accountId ? { ...account, label } : account)),
        ),
      ),
    removeProviderAccount: async ({ provider, accountId }) => {
      agents = agents.map((agent) => {
        if (agent.provider !== provider || agent.providerAccountId !== accountId) return agent;
        const { providerAccountId: _removed, ...moved } = agent;
        return moved;
      });
      emitAgentEvent({ type: "agents-changed", agents });
      return clone(
        changeProviderAccounts(provider, (accounts) => accounts.filter((account) => account.id !== accountId)),
      );
    },
    setProviderAccountPool: async ({ provider, enabled, leftOut }) => {
      agentStatus = {
        ...agentStatus,
        providers: agentStatus.providers?.map((row) => {
          if (row.id !== provider) return row;
          const { accountPool: _old, ...rest } = row;
          if (!enabled) return rest;
          const inUse = row.accounts?.find((account) => !leftOut.includes(account.id))?.id ?? null;
          return { ...rest, accountPool: { leftOut: [...leftOut], inUse } };
        }),
      };
      return clone(agentStatus);
    },
    setLiveVoiceAccount: async ({ accountId }) => {
      agentStatus = {
        ...agentStatus,
        providers: agentStatus.providers?.map((row) => {
          if (row.id !== "codex") return row;
          const { liveVoiceAccount: _old, ...rest } = row;
          return accountId ? { ...rest, liveVoiceAccount: accountId } : rest;
        }),
      };
      return clone(agentStatus);
    },
    signOutProvider: async (provider) => {
      agentStatus = {
        ...agentStatus,
        providers: agentStatus.providers?.map((row) =>
          row.id === provider ? { ...row, state: "sign-in-required", email: null, message: null } : row,
        ),
      };
      return clone(
        changeProviderAccounts(provider, (accounts) =>
          accounts.map((account) =>
            account.id === DEFAULT_PROVIDER_ACCOUNT_ID ? { ...account, email: null, state: "signed-out" } : account,
          ),
        ),
      );
    },
    providerUsageResets: async (provider) =>
      provider === "codex"
        ? (agentStatus.providers?.find((row) => row.id === provider)?.accounts ?? [])
            .filter((account) => account.state === "connected")
            .map((account) => ({
              provider,
              accountId: account.id,
              available: usageResets.get(account.id) ?? (account.id === DEFAULT_PROVIDER_ACCOUNT_ID ? 2 : 0),
            }))
        : [],
    resetProviderUsage: async ({ provider, accountId }) => {
      const readings = await api.providerUsageResets(provider);
      const available = readings.find((reading) => reading.accountId === accountId)?.available ?? 0;
      if (available === 0) return "noCredit";
      usageResets.set(accountId, available - 1);
      return "reset";
    },
    getProviderApiKeyState: async (provider) => ({
      provider,
      status: providerApiKeys.has(provider) ? "saved" : "missing",
    }),
    providerRuntimes: mockProviderRuntimes.providerRuntimes,
    openUrl: async () => undefined,
    voice: mockVoice.voice,
    workflows: mockWorkflows(
      options.workflows ?? [],
      (workflowId) => emitAgentEvent({ type: "workflows-changed", workflowId }),
      () => emitAgentEvent({ type: "workflow-folders-changed" }),
    ),
    crm: mockCrm(options.crm ?? {}, () => emitAgentEvent({ type: "crm-changed" })),
    routineResults: mockRoutineResults(routines, options, (agentId) =>
      emitAgentEvent({ type: "routines-changed", agentId }),
    ),
    auth: mockAuth.auth,
    skills: mockSkills.skills,
    hostedSites: {
      list: async () => ({
        sites: clone(hostedSites),
        limit: 3,
        used: hostedSites.filter((site) => site.status === "active").length,
      }),
      chooseDirectory: async () => "/mock/OpenBot/Sites/launch-notes",
      publish: async (input) => {
        const hostname = `${input.title.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")}.openbot.site`;
        const site: HostedSiteSummary = {
          id: `site-${hostedSites.length + 1}`,
          hostname,
          url: `https://${hostname}`,
          title: input.title,
          description: input.description,
          framework: "vanilla",
          status: "active",
          fileCount: 12,
          size: 786_432,
          expiresAt: null,
          updatedAt: new Date().toISOString(),
          serverId: "host-preview",
        };
        hostedSites = [site, ...hostedSites];
        return clone(site);
      },
      replace: async (input) => {
        const existing = hostedSites.find((site) => site.id === input.siteId);
        if (!existing) throw new Error("Site not found");
        const replaced: HostedSiteSummary = {
          ...existing,
          title: input.title,
          description: input.description,
          updatedAt: new Date().toISOString(),
        };
        hostedSites = hostedSites.map((site) => (site.id === input.siteId ? replaced : site));
        return clone(replaced);
      },
      delete: async ({ siteId }) => {
        hostedSites = hostedSites.filter((site) => site.id !== siteId);
      },
    },
    githubConnector: createMockGitHubConnector(),
    linkAccount: createMockLinkAccount(),
    onePasswordConnector: createMockOnePasswordConnector(),
    bitwardenConnector: createMockBitwardenConnector(),
    passwordManagers: createMockPasswordManagers(),
    vault: createMockVault(),
    billing: createMockBilling(billingPlans),
    referral: createMockReferral(),
    license: createMockLicense(),
    credits: createMockCredits(),
    routineFeed: createMockRoutineFeed(),
    hostedServers: createMockHostedServers(billingPlans),
    customProviders: {
      list: async () => clone(customProviders),
      save: async (input) => {
        if (customProviders.some((provider) => provider.id === input.id)) {
          throw new Error("An endpoint with this provider ID is already saved. Remove it first, or use another ID.");
        }
        customProviders = [
          ...customProviders,
          {
            id: input.id,
            name: input.name,
            baseUrl: input.baseUrl,
            hasApiKey: input.apiKey !== null,
            headerNames: input.headers.map((header) => header.name),
            models: input.models.map((model) => ({ ...model })),
            harness: input.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS,
          },
        ];
        emitAgentEvent({ type: "status", status: clone(agentStatus) });
        return { providers: clone(customProviders), restart: "restarted" };
      },
      delete: async ({ id }) => {
        customProviders = customProviders.filter((provider) => provider.id !== id);
        emitAgentEvent({ type: "status", status: clone(agentStatus) });
        return { providers: clone(customProviders), restart: "restarted" };
      },
      update: async (input) => {
        const stored = customProviders.find((provider) => provider.id === input.id);
        if (!stored) throw new Error("This endpoint is not saved.");
        const savedNames = stored.headerNames ?? [];
        const headerNames = input.headers?.map((header) => header.name) ?? savedNames;
        const missing = input.headers?.find((header) => header.value === null && !savedNames.includes(header.name));
        if (missing) throw new Error(sourceText("error.provider.headerValueMissing", { name: missing.name }));
        const keepsKey = input.apiKey === undefined && stored.hasApiKey;
        const keepsHeader = input.headers
          ? input.headers.some((header) => header.value === null)
          : savedNames.length > 0;
        if ((keepsKey || keepsHeader) && !sameCustomProviderOrigin(stored.baseUrl, input.baseUrl)) {
          throw new Error("Enter the API key again for the new address.");
        }
        customProviders = customProviders.map((provider) =>
          provider.id === input.id
            ? {
                id: input.id,
                name: input.name,
                baseUrl: input.baseUrl,
                hasApiKey: input.apiKey !== undefined || keepsKey,
                headerNames,
                models: input.models.map((model) => ({ ...model })),
                harness: input.harness ?? stored.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS,
              }
            : provider,
        );
        emitAgentEvent({ type: "status", status: clone(agentStatus) });
        return { providers: clone(customProviders), restart: "restarted" };
      },
    },
    acpRegistry: {
      search: async (query) =>
        clone(!query || registryEntry.name.toLowerCase().includes(query.toLowerCase()) ? [registryEntry] : []),
      installed: async () =>
        registryEntry.installedVersion && registryEntry.customAgentId
          ? [
              {
                registryId: registryEntry.id,
                customAgentId: registryEntry.customAgentId,
                version: registryEntry.installedVersion,
                distribution: "binary",
              },
            ]
          : [],
      status: async () => [],
      install: async (input) => {
        registryEntry.installedVersion = registryEntry.version;
        registryEntry.customAgentId = input.customAgentId;
        if (!customAgents.some((agent) => agent.id === input.customAgentId))
          customAgents.push({
            id: input.customAgentId,
            name: input.name ?? registryEntry.name,
            command: "/preview/example-acp",
            args: [],
            envNames: [],
            resolvedCommand: "/preview/example-acp",
            usagePrompt: null,
          });
        return { agents: clone(customAgents), restart: "not-running" };
      },
      cancel: async () => undefined,
      remove: async () => {
        registryEntry.installedVersion = null;
      },
    },
    customAgents: {
      list: async () => clone(customAgents),
      save: async (input) => {
        const summary: CustomAgentSummary = {
          id: input.id,
          name: input.name,
          command: input.command,
          args: [...input.args],
          envNames: input.env.map((entry) => entry.name),
          resolvedCommand: input.command.startsWith("/") ? input.command : `/usr/local/bin/${input.command}`,
          usagePrompt: input.usagePrompt,
        };
        customAgents = customAgents.some((agent) => agent.id === input.id)
          ? customAgents.map((agent) => (agent.id === input.id ? summary : agent))
          : [...customAgents, summary];
        emitAgentEvent({ type: "status", status: clone(agentStatus) });
        return { agents: clone(customAgents), restart: "restarted" };
      },
      delete: async ({ id }) => {
        customAgents = customAgents.filter((agent) => agent.id !== id);
        emitAgentEvent({ type: "status", status: clone(agentStatus) });
        return { agents: clone(customAgents), restart: "restarted" };
      },
      check: async (input) => ({
        agentName: input.command.split("/").pop() ?? input.command,
        version: null,
        protocolVersion: 1,
        capabilities: ["loadSession"],
        models: ["Default", "Fast"],
      }),
      usage: async () =>
        customAgents.flatMap((agent) =>
          agent.usagePrompt ? [{ id: agent.id, text: `Preview answer to ${agent.usagePrompt}` }] : [],
        ),
    },
    providerDetection: {
      scanModelServers: async () => [],
      scanAgents: async () => [],
      discoverModels: async () => ({ models: [] }),
      getSettings: async () => clone(detectionSettings),
      setSettings: async (settings) => {
        detectionSettings = clone(settings);
        return clone(detectionSettings);
      },
    },
    messaging: createMockMessaging(() => agents[0]?.id ?? "preview-agent"),
    providerAdmin: {
      startCodeLogin: (provider) => api.startProviderCodeLogin(provider),
      submitCodeLogin: async () => clone(agentStatus),
      cancelCodeLogin: (provider) => api.cancelProviderCodeLogin(provider),
      startHostSignIn: async () => undefined,
      hostSignInStatus: async () => ({ tabId: null, result: null }),
      cancelHostSignIn: async () => clone(agentStatus),
      accounts: async () => ({
        providers: (agentStatus.providers ?? []).flatMap((row) =>
          row.accounts ? [{ provider: row.id, accounts: clone(row.accounts) }] : [],
        ),
        pools: (agentStatus.providers ?? []).flatMap((row) =>
          row.accounts && row.accountPool ? [{ provider: row.id, pool: clone(row.accountPool) }] : [],
        ),
        liveVoiceAccount: agentStatus.providers?.find((row) => row.id === "codex")?.liveVoiceAccount ?? null,
        agents: [],
      }),
      accountUsage: async () => ({ limits: [] }),
      startAccountSignIn: async () => undefined,
      accountSignInStatus: async () => ({ tabId: null, result: null }),
      cancelAccountSignIn: async () => undefined,
      connectAccountKey: async (input) => {
        await api.connectProviderAccountKey(input);
      },
      startAccountCodeLogin: async ({ provider, accountId }) => {
        const status = await api.connectProviderAccount({ provider, accountId });
        const accounts = status.providers?.find((row) => row.id === provider)?.accounts ?? [];
        return {
          accountId: accountId ?? accounts.at(-1)?.id ?? "a0000000000000001",
          start: {
            kind: "code",
            userCode: "ABCD-12345",
            verificationUrl: "https://example.com/device",
            expiresAt: Date.now() + 15 * 60_000,
          },
        };
      },
      submitAccountCodeLogin: async () => undefined,
      accountCodeLoginStatus: async () => ({ result: null }),
      cancelAccountCodeLogin: async () => undefined,
      renameAccount: async (input) => {
        await api.renameProviderAccount(input);
      },
      removeAccount: async (input) => {
        await api.removeProviderAccount(input);
      },
      setAccountPool: async (input) => {
        await api.setProviderAccountPool(input);
      },
      setLiveVoiceAccount: async (input) => {
        await api.setLiveVoiceAccount(input);
      },
      hostDefaultProvider: async () => ({
        preferredProvider: setupState.preferredProvider,
        preferredModel: setupState.preferredModel,
      }),
      setHostDefaultProvider: async (input) => {
        const { preferredProvider, preferredModel } = await api.saveSetup(input);
        return { preferredProvider, preferredModel };
      },
      usageResets: (provider) => api.providerUsageResets(provider),
      resetUsage: (input) => api.resetProviderUsage(input),
      signOut: async (provider) => {
        await api.signOutProvider(provider);
      },
      startRelaySignIn: async () => undefined,
      startAccountRelaySignIn: async () => undefined,
      relaySignInStatus: async () => ({ page: null, result: null }),
      openRelaySignIn: async () => undefined,
      pasteRelaySignIn: async () => undefined,
      cancelRelaySignIn: async () => clone(agentStatus),
      getApiKeyState: (provider) => api.getProviderApiKeyState(provider),
      setApiKey: (input) => api.setProviderApiKey(input),
      clearApiKey: (provider) => api.clearProviderApiKey(provider),
      getRuntimes: () => api.providerRuntimes.getStatus(),
      downloadRuntime: (provider) => api.providerRuntimes.download(provider),
      cancelRuntime: (provider) => api.providerRuntimes.cancel(provider),
      checkRuntimeUpdates: () => api.providerRuntimes.checkForUpdates(),
      listCustomProviders: () => api.customProviders.list(),
      saveCustomProvider: (input) => api.customProviders.save(input),
      updateCustomProvider: (input) => api.customProviders.update(input),
      deleteCustomProvider: (input) => api.customProviders.delete(input),
      providerUse: async () => (agentStatus.providers ?? []).filter((row) => row.off).map((row) => row.id),
      setProviderUse: async (input) =>
        ((await api.setProviderOn(input)).providers ?? []).filter((row) => row.off).map((row) => row.id),
    },
    agentTemplates: {
      preview: async (agentId) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error("Choose a local agent first.");
        return clone({
          ...storyAgentTemplatePreview(agent.id, agentTemplatePublications.get(agent.id) ?? null),
          name: agent.name,
          title: agent.title,
          description: agent.description,
          avatarSeed: agent.avatarSeed,
          avatarHue: agent.avatarHue,
          avatarUrl: agent.avatarUrl,
          updatedAt: agent.updatedAt,
        });
      },
      publish: async ({ agentId }) => {
        if (!agents.some((candidate) => candidate.id === agentId)) throw new Error("Choose a local agent first.");
        const publication = { ...STORY_AGENT_TEMPLATE_PUBLICATION, publishedAt: new Date().toISOString() };
        agentTemplatePublications.set(agentId, publication);
        return clone(publication);
      },
      unpublish: async (agentId) => {
        agentTemplatePublications.delete(agentId);
      },
      get: async (templateId) => {
        if (templateId !== STORY_AGENT_TEMPLATE_DETAIL.id) throw new Error("This shared agent is no longer published.");
        return clone(STORY_AGENT_TEMPLATE_DETAIL);
      },
      install: async () => {
        const agent = agents[0];
        if (!agent) throw new Error("Agent not found");
        return clone({ agent });
      },
      takePendingLink: async () => null,
      onOpenLink: (listener) => {
        void listener;
        return () => undefined;
      },
    },
    marketplaceAgents: {
      list: async (query) => {
        const matches = STORY_MARKETPLACE_AGENTS.filter(
          (agent) =>
            matchesQuery(`${agent.name} ${agent.title} ${agent.description} ${agent.creatorName}`, query?.query) &&
            (!query?.category || (agent.category ?? "other") === query.category) &&
            (query?.featured !== true || agent.featured) &&
            (query?.verified === undefined || (agent.verified === true) === query.verified),
        );
        const start = Number(query?.cursor ?? 0);
        const end = start + (query?.limit ?? 50);
        return clone({
          agents: matches.slice(start, end),
          nextCursor: end < matches.length ? String(end) : null,
        });
      },
      get: async (listingId) => {
        const detail = STORY_MARKETPLACE_AGENT_DETAILS[listingId];
        if (!detail) throw new Error("Agent not found");
        return clone(detail);
      },
      getListing: async (agentId) => {
        const detail = STORY_MARKETPLACE_AGENT_DETAILS[agentId];
        if (!detail) throw new Error("Agent not found");
        return clone(detail);
      },
      listMine: async () => clone(marketplaceAgentSubmissions),
      preview: async (agentId) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error("Agent not found");
        return clone({
          agentId: agent.id,
          name: agent.name,
          title: agent.title,
          description: agent.description,
          avatarSeed: agent.avatarSeed,
          avatarHue: agent.avatarHue,
          avatarUrl: agent.avatarUrl,
          skills: readInstalledSkills(agent.id).map((skill) => ({
            skillId: skill.skillId,
            versionId: `${skill.skillId}-v${skill.installedVersion}`,
            slug: skill.slug,
            name: skill.name,
            version: skill.installedVersion,
          })),
          routines: (routines.get(agent.id) ?? []).flatMap(({ name, instruction, active, trigger }) =>
            isReleasedRoutineSchedule(trigger.schedule)
              ? [{ name, instruction, active, schedule: trigger.schedule }]
              : [],
          ),
        });
      },
      submit: async (input) => {
        const agent = agents.find((candidate) => candidate.id === input.agentId);
        if (!agent) throw new Error("Agent not found");
        const submission: AgentSubmission = {
          id: `agent-submission-${agent.id}-${marketplaceAgentSubmissions.length + 1}`,
          showCreatorAvatar: input.showCreatorAvatar ?? false,
          category: input.category ?? "other",
          listingId: input.listingId ?? `listing-${agent.id}`,
          name: agent.name,
          title: agent.title,
          description: agent.description,
          version: 1,
          status: "pending",
          rejectionNote: null,
          avatarSeed: agent.avatarSeed,
          avatarHue: agent.avatarHue,
          avatarUrl: agent.avatarUrl,
          skillCount: readInstalledSkills(agent.id).length,
          routineCount: (routines.get(agent.id) ?? []).length,
          activeRoutineCount: (routines.get(agent.id) ?? []).filter((routine) => routine.active).length,
          createdAt: new Date().toISOString(),
        };
        marketplaceAgentSubmissions = [submission, ...marketplaceAgentSubmissions];
        return clone(submission);
      },
      install: async ({ listingId, agentId, timezone }) => {
        const detail = STORY_MARKETPLACE_AGENT_DETAILS[listingId];
        if (!detail) throw new Error("Agent not found");
        const existing = agentId ? agents.find((candidate) => candidate.id === agentId) : undefined;
        if (agentId && !existing) throw new Error("The installed agent no longer exists.");
        if (existing && existing.marketplaceSource?.listingId !== detail.id) {
          throw new Error("This local agent was installed from a different marketplace agent.");
        }
        const previousRoutineIds = existing?.marketplaceSource?.routineIds ?? [];
        const previousSkillIds = existing?.marketplaceSource?.skillIds ?? [];
        const target =
          existing ??
          createAgentSummary({
            name: detail.name,
            title: detail.title,
            description: detail.description,
            avatarSeed: detail.avatarSeed,
            avatarHue: detail.avatarHue,
          });
        const created = detail.routines.map((routine) =>
          createRoutineRecord({
            agentId: target.id,
            name: routine.name,
            instruction: routine.instruction,
            active: routine.active,
            timezone,
            schedule: routine.schedule,
          }),
        );
        const agent: ClientAgentSummary = {
          ...target,
          name: detail.name,
          title: detail.title,
          description: detail.description,
          avatarSeed: detail.avatarSeed,
          avatarHue: detail.avatarHue,
          marketplaceSource: {
            listingId: detail.id,
            versionId: detail.versionId,
            version: detail.version,
            skillIds: detail.skills.map((skill) => skill.skillId),
            routineIds: created.map((routine) => routine.id),
          },
        };
        agents = existing
          ? agents.map((candidate) => (candidate.id === agent.id ? agent : candidate))
          : [...agents, agent];
        if (!existing) queues.set(agent.id, emptyQueue(agent.id));
        const listingSkillIds = new Set(detail.skills.map((skill) => skill.skillId));
        const kept = readInstalledSkills(agent.id).filter(
          (skill) => !listingSkillIds.has(skill.skillId) && !previousSkillIds.includes(skill.skillId),
        );
        installedSkills.set(agent.id, [
          ...detail.skills.map((skill) => ({
            skillId: skill.skillId,
            slug: skill.slug,
            name: skill.name,
            installedVersion: skill.version,
            availableVersion: skill.version,
            state: "installed" as const,
          })),
          ...kept,
        ]);
        routines.set(agent.id, [
          ...created,
          ...(routines.get(agent.id) ?? []).filter((routine) => !previousRoutineIds.includes(routine.id)),
        ]);
        emitAgentEvent({ type: "agents-changed", agents });
        emitAgentEvent({ type: "routines-changed", agentId: agent.id });
        return clone({ agent });
      },
    },
    agent: {
      getStatus: async (serverId) =>
        clone(serverId === storyForeignServerId ? withStoryForeignProvider(agentStatus) : agentStatus),
      getRuntimeSnapshot: async () => clone(runtimeSnapshot),
      getHostAnalytics: async (input) => mockHostAnalytics(input, agents),
      getAnalytics: async (input) => {
        const agent = agents.find((entry) => entry.id === input.agentId);
        if (!agent) throw new Error("Agent not found.");
        return mockAgentAnalytics(input, agent);
      },
      getUsage: async (agentId) => {
        if (!agentId) return clone(usage);
        const agent = agents.find((candidate) => candidate.id === agentId);
        return clone({
          limits: agent ? usage.limits.filter((limit) => limit.id === agent.provider) : [],
        });
      },
      listModels: async (serverId) =>
        clone([
          ...allModels().filter((model) => {
            const shown = shownModels.get(model.provider);
            return (
              !shown ||
              shown.includes(model.id) ||
              agents.some((agent) => agent.provider === model.provider && agent.model === model.id)
            );
          }),
          ...(serverId === storyForeignServerId ? [STORY_FOREIGN_MODEL] : []),
        ]),
      listAgents: async (serverId) =>
        clone(serverId === storyForeignServerId ? [...agents, STORY_FOREIGN_AGENT] : agents),
      listHiddenAgents: async () => hiddenAgents(),
      setAgentHidden: async ({ agentId, hidden }) => {
        const current = agents.find((agent) => agent.id === agentId);
        if (!current) throw new Error(sourceText("error.agent.unknown", { id: agentId }));
        if ((current.hiddenAt !== undefined) === hidden) return hiddenAgents();
        const { hiddenAt: _hiddenAt, ...visible } = current;
        const updated = hidden ? { ...visible, hiddenAt: new Date().toISOString() } : visible;
        agents = agents.map((agent) => (agent.id === agentId ? updated : agent));
        const snapshot = hiddenAgents();
        emitAgentEvent({ type: "hidden-agents-changed", agents: snapshot.agents });
        emitAgentEvent({ type: "agents-changed", agents });
        return snapshot;
      },
      listAgentNotificationLevels: async (serverId) => notificationLevelsSnapshot(notificationLevelsOf(serverId)),
      setAgentNotificationLevel: async ({ agentId, level }, serverId) => {
        const known = serverId === storyForeignServerId ? [...agents, STORY_FOREIGN_AGENT] : agents;
        if (!known.some((agent) => agent.id === agentId))
          throw new Error(sourceText("error.agent.unknown", { id: agentId }));
        const levels = notificationLevelsOf(serverId);
        if (level === null) levels.delete(agentId);
        else levels.set(agentId, level);
        return notificationLevelsSnapshot(levels);
      },
      readAgentSessionSettings: async (agentId) => clone(previewSessionSettings(agentId)),
      setAgentSessionSetting: async ({ agentId, settingId, value }) => {
        const settings = previewSessionSettings(agentId);
        const option = settings.options.find((entry) => entry.id === settingId);
        if (!option) throw new Error("Unknown setting");
        if (option.type === "boolean" && typeof value === "boolean") option.currentValue = value;
        else if (
          option.type === "select" &&
          typeof value === "string" &&
          option.options.some((choice) => choice.value === value)
        )
          option.currentValue = value;
        else throw new Error("Invalid setting value");
        settings.overrides[settingId] = value;
        emitAgentEvent({ type: "agent-session-settings-changed", agentId });
        return clone(settings);
      },
      resetAgentSessionSetting: async ({ agentId, settingId }) => {
        const settings = previewSessionSettings(agentId);
        delete settings.overrides[settingId];
        const option = settings.options.find((entry) => entry.id === settingId);
        if (option?.type === "boolean") option.currentValue = false;
        else if (option?.type === "select") option.currentValue = "auto";
        emitAgentEvent({ type: "agent-session-settings-changed", agentId });
        return clone(settings);
      },
      listInstalledSkills: async (agentId) => clone(readInstalledSkills(agentId)),
      ...mockChannels,
      getAgentAdminSettings: async (agentId) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error("Agent not found");
        return {
          access: agent.access ?? DEFAULT_AGENT_ACCESS,
          autoApprove: agentAutoApprovalEnabled(approvalAutomation, agentId),
          autoApproveLocked: false,
        };
      },
      getAgentHostSettings: async (agentId) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error("Agent not found");
        return {
          computerUse: agentComputerUseEnabled(agent),
          allowAutomation: agentAutomationAllowed(agent, agentDefaults),
          busyMessageMode: agent.busyMessageMode ?? null,
          defaultBusyMessageMode: busyMessageMode.mode,
        };
      },
      updateAgentHostSettings: async (input) => {
        await api.agent.updateAgent(input);
        return api.agent.getAgentHostSettings(input.agentId);
      },
      getAgentBackupModels: async (agentId) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error("Agent not found");
        return { backupModels: agent.backupModels ?? null, usageLimitReturn: agent.usageLimitReturn ?? null };
      },
      updateAgentBackupModels: async (input) => {
        await api.agent.updateAgent(input);
        return api.agent.getAgentBackupModels(input.agentId);
      },
      listAgentFolders: async (agentId) => mockAgentFolders(agentId),
      chooseAgentFolder: async ({ agentId, replace }) =>
        addMockAgentFolder(agentId, replace ? `${replace} (found)` : "/mock/Projects/Leads", replace),
      addAgentFolder: async ({ agentId, path, replace }) => addMockAgentFolder(agentId, path, replace),
      addDroppedAgentFolder: async (agentId, folder) => addMockAgentFolder(agentId, `/mock/Dropped/${folder.name}`),
      removeAgentFolder: async ({ agentId, path }) => {
        const agent = requireMockAgent(agentId);
        setMockAgentFolders(
          agent,
          (agent.additionalFolders ?? []).filter((folder) => folder !== path),
        );
        return { outcome: "removed", path, list: mockAgentFolders(agentId) };
      },
      chooseAgentExclusion: async (agentId) =>
        addMockAgentExclusion(agentId, `${requireMockAgent(agentId).workspacePath}/archive`),
      addAgentExclusion: async ({ agentId, path }) => addMockAgentExclusion(agentId, path),
      removeAgentExclusion: async ({ agentId, path }) => {
        const agent = requireMockAgent(agentId);
        setMockAgentExclusions(
          agent,
          (agent.excludedFolders ?? []).filter((folder) => folder !== path),
        );
        return { outcome: "included", path, list: mockAgentFolders(agentId) };
      },
      browseAgentFolders: async ({ path }) => {
        const home = "/mock";
        const folder = path ?? home;
        const names = folder === home ? ["Documents", "Projects"] : [];
        return {
          path: folder,
          parentPath: folder === "/" ? null : folder.slice(0, folder.lastIndexOf("/")) || "/",
          entries: names.map((name) => ({ name, path: `${folder}/${name}` })),
          truncated: false,
          home,
          volumes: [],
        };
      },
      listChannelFolders: async (channelId) => mockChannelFolders(channelId),
      chooseChannelFolder: async (channelId) => addMockChannelFolder(channelId, "/mock/Projects/Shared work"),
      addChannelFolder: async ({ channelId, path }) => addMockChannelFolder(channelId, path),
      removeChannelFolder: async ({ channelId, path }) => {
        mockChannelFolderPaths.set(
          channelId,
          (mockChannelFolderPaths.get(channelId) ?? []).filter((folder) => folder !== path),
        );
        return { outcome: "removed", path, list: mockChannelFolders(channelId) };
      },
      browseChannelFolders: async ({ path }) => api.agent.browseAgentFolders({ agentId: "", path }),
      readAgentInstructions: async (agentId) => mockAgentInstructions(agentId),
      saveAgentInstructions: async ({ agentId, text, expected }) => {
        const current = mockAgentInstructions(agentId);
        if (current.text !== expected) throw new Error(sourceText("error.agent.instructionsChanged"));
        const file: AgentInstructionsFile = { fileName: current.fileName, exists: true, text };
        mockInstructionFiles.set(agentId, file);
        return file;
      },
      revealAgentInstructions: async (agentId) => {
        requireMockAgent(agentId);
      },
      getAgentNewChat: async (agentId) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error("Agent not found");
        return { allowNewChat: agentNewChatAllowed(agent, agentDefaults) };
      },
      updateAgentNewChat: async (input) => {
        await api.agent.updateAgent(input);
        return api.agent.getAgentNewChat(input.agentId);
      },
      previewAgentTemplate: (agentId) => api.agentTemplates.preview(agentId),
      publishAgentTemplate: (input) => api.agentTemplates.publish(input),
      unpublishAgentTemplate: (agentId) => api.agentTemplates.unpublish(agentId),
      getAgentPlanCard: async (agentId) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error("Agent not found");
        return { quickAcknowledgement: agentQuickAcknowledgementEnabled(agent, agentDefaults) };
      },
      updateAgentPlanCard: async (input) => {
        await api.agent.updateAgent(input);
        return api.agent.getAgentPlanCard(input.agentId);
      },
      getAgentBuiltinMemory: async (agentId) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error("Agent not found");
        return { memory: agentMemoryEnabled(agent) };
      },
      updateAgentBuiltinMemory: async (input) => {
        await api.agent.updateAgent(input);
        return api.agent.getAgentBuiltinMemory(input.agentId);
      },
      getAgentFastMode: async (agentId) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error("Agent not found");
        return { fastMode: agent.fastMode ?? null, ...(agent.fastMode && agent.ultrafast ? { ultrafast: true } : {}) };
      },
      updateAgentFastMode: async (input) => {
        await api.agent.updateAgent(input);
        return api.agent.getAgentFastMode(input.agentId);
      },
      listBrowserProfiles: async () => ({
        profiles: browserProfiles.map(browserProfileSummary),
        sharedAgentIds: agents.filter((agent) => agentBrowserProfile(agent).kind === "shared").map((agent) => agent.id),
      }),
      createBrowserProfile: async (name) => {
        requireFreeBrowserProfileName(name);
        const hue = nextBrowserProfileHue(browserProfiles.map((profile) => profile.hue));
        const profile = { id: crypto.randomUUID().replaceAll("-", ""), name, hue };
        browserProfiles = [...browserProfiles, profile];
        emitAgentEvent({ type: "browser-profiles-changed" });
        return browserProfileSummary(profile);
      },
      updateBrowserProfile: async ({ profileId, name, hue }) => {
        const current = requireBrowserProfile(profileId);
        if (name !== undefined) requireFreeBrowserProfileName(name, profileId);
        const next = { ...current, name: name ?? current.name, hue: hue ?? current.hue };
        browserProfiles = browserProfiles.map((profile) => (profile.id === profileId ? next : profile));
        emitAgentEvent({ type: "browser-profiles-changed" });
        return browserProfileSummary(requireBrowserProfile(profileId));
      },
      clearBrowserData: async (input) => {
        if ("profileId" in input) requireBrowserProfile(input.profileId);
        emitAgentEvent({ type: "browser-profiles-changed" });
      },
      deleteBrowserProfile: async (profileId) => {
        requireBrowserProfile(profileId);
        browserProfiles = browserProfiles.filter((profile) => profile.id !== profileId);
        agents = agents.map((agent) =>
          agent.browserProfileId === profileId ? withBrowserProfile(agent, { kind: "shared" }) : agent,
        );
        emitAgentEvent({ type: "agents-changed", agents });
        emitAgentEvent({ type: "browser-profiles-changed" });
      },
      getAgentBrowserProfile: async (agentId) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error("Agent not found");
        return agentBrowserProfile(agent);
      },
      updateAgentBrowserProfile: async ({ agentId, profile }) => {
        if (profile.kind === "profile") requireBrowserProfile(profile.profileId);
        agents = agents.map((agent) => (agent.id === agentId ? withBrowserProfile(agent, profile) : agent));
        emitAgentEvent({ type: "agents-changed", agents });
        emitAgentEvent({ type: "browser-profiles-changed" });
        return api.agent.getAgentBrowserProfile(agentId);
      },
      getAgentDefaultsOverview: async () => ({
        defaults: clone(agentDefaults),
        busyMessageMode: busyMessageMode.mode,
        agents: agents.map((agent) => ({
          agentId: agent.id,
          allowAutomation: agent.allowAutomation ?? null,
          allowNewChat: agent.allowNewChat ?? null,
          quickAcknowledgement: agent.quickAcknowledgement ?? null,
          busyMessageMode: agent.busyMessageMode ?? null,
        })),
      }),
      updateAgentDefaultsOverview: async ({ busyMessageMode: mode, ...changes }, serverId) => {
        if (mode) busyMessageMode = { mode };
        agentDefaults = { ...agentDefaults, ...changes };
        emitAgentEvent({ type: "agents-changed", agents });
        return api.agent.getAgentDefaultsOverview(serverId);
      },
      setAgentDefaultChoice: async ({ agentIds, setting, choice }, serverId) => {
        for (const agentId of agentIds)
          await api.agent.updateAgent({ agentId, ...agentDefaultChoiceValues(setting, choice) });
        return api.agent.getAgentDefaultsOverview(serverId);
      },
      listBrowserProxies: async () => ({ proxies: browserProxies, computers: [] }),
      getBrowserComputerSharing: async () => null,
      setBrowserComputerSharing: async () => {
        throw new Error(sourceText("error.team.agentSettingsUnsupported"));
      },
      saveBrowserProxy: async ({ proxyId, previousAddress, keepPassword, address }) => {
        const parsed = parseBrowserProxyAddress(address);
        if (parsed === null) throw new Error(sourceText("error.backend.browserProxyAddressInvalid"));
        const { scheme, host, port, username, password } = parsed;
        const existing = proxyId === undefined ? undefined : requireBrowserProxy(proxyId);
        if (existing && browserProxyAddressText(existing) !== previousAddress)
          throw new Error(sourceText("error.backend.browserProxyChanged"));
        const saved: BrowserProxySummary = {
          id: existing?.id ?? crypto.randomUUID().replaceAll("-", ""),
          scheme,
          host,
          port,
          username,
          hasPassword: password !== null || (existing?.hasPassword === true && keepPassword === true),
          profileIds: existing?.profileIds ?? [],
          failure: null,
        };
        browserProxies = existing
          ? browserProxies.map((proxy) => (proxy.id === saved.id ? saved : proxy))
          : [...browserProxies, saved];
        emitAgentEvent({ type: "browser-profiles-changed" });
        return saved;
      },
      deleteBrowserProxy: async ({ proxyId, profileIds }) => {
        const existing = requireBrowserProxy(proxyId);
        if (
          existing.profileIds.length !== profileIds.length ||
          existing.profileIds.some((id) => !profileIds.includes(id))
        )
          throw new Error(sourceText("error.backend.browserProxyChanged"));
        browserProxies = browserProxies.filter((proxy) => proxy.id !== proxyId);
        emitAgentEvent({ type: "browser-profiles-changed" });
      },
      setBrowserProfileProxy: async ({ profileId, proxyId }) => {
        requireBrowserProfile(profileId);
        if (proxyId !== null) requireBrowserProxy(proxyId);
        browserProxies = browserProxies.map((proxy) => ({
          ...proxy,
          profileIds: [
            ...proxy.profileIds.filter((id) => id !== profileId),
            ...(proxy.id === proxyId ? [profileId] : []),
          ],
        }));
        emitAgentEvent({ type: "browser-profiles-changed" });
      },
      listBrowserTabProfiles: async () => [],
      updateAgentAdminSettings: async ({ agentId, access, autoApprove }) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error("Agent not found");
        if (access !== undefined) {
          agents = agents.map((candidate) => (candidate.id === agentId ? { ...candidate, access } : candidate));
          emitAgentEvent({ type: "agents-changed", agents });
        }
        if (autoApprove !== undefined) {
          approvalAutomation = {
            ...approvalAutomation,
            autoApproveOverrides: { ...approvalAutomation.autoApproveOverrides, [agentId]: autoApprove },
          };
          for (const listener of approvalAutomationListeners) listener(clone(approvalAutomation));
        }
        return {
          access: access ?? agent.access ?? DEFAULT_AGENT_ACCESS,
          autoApprove: agentAutoApprovalEnabled(approvalAutomation, agentId),
          autoApproveLocked: false,
        };
      },
      listAgentSkills: (agentId) => mockSkills.skills.listInstalled(agentId),
      installAgentSkill: (input) => mockSkills.skills.install(input),
      uninstallAgentSkill: (input) => mockSkills.skills.uninstall(input),
      setAgentSkillEnabled: (input) => mockSkills.skills.setEnabled(input),
      readGithubSkills: (link) => mockSkills.readGithub(link),
      addMarketplaceAgent: async (input) => {
        const { agent } = await api.marketplaceAgents.install(input);
        return { id: agent.id, name: agent.name };
      },
      addTemplateAgent: async (input) => {
        const { agent } = await api.agentTemplates.install(input);
        return { id: agent.id, name: agent.name };
      },
      listMcpServers: async () => clone(mcpServers),
      saveMcpServer: async ({ config }) => {
        const normalized = normalizeMcpConfig(config);
        const existing = mcpServers.findIndex((server) => server.id === normalized.id);
        if (existing < 0) mcpServers = [...mcpServers, { ...normalized, id: normalized.id || createMcpServerId() }];
        else mcpServers = mcpServers.map((server, index) => (index === existing ? normalized : server));
        return clone(mcpServers);
      },
      removeMcpServer: async ({ mcpServerId }) => {
        mcpServers = mcpServers.filter((server) => server.id !== mcpServerId);
        mcpAccess = Object.fromEntries(Object.entries(mcpAccess).filter(([id]) => id !== mcpServerId));
        return clone(mcpServers);
      },
      getMcpAccess: async () => mcpAccessSnapshot(),
      setMcpAccess: async (input) => {
        const change = parseSetMcpAccessInput(input);
        if (!mcpServers.some((server) => server.id === change.mcpServerId))
          throw new Error("Invalid MCP access change.");
        if (change.revision !== mcpAccessRevision) throw new Error(sourceText("error.team.mcpAccessStale"));
        mcpAccessRevision += 1;
        mcpAccess = { ...mcpAccess, [change.mcpServerId]: change.access };
        return mcpAccessSnapshot();
      },
      setMcpServerEnabled: async ({ mcpServerId, enabled }) => {
        mcpServers = mcpServers.map((server) => (server.id === mcpServerId ? { ...server, enabled } : server));
        return clone(mcpServers);
      },
      testMcpServer: async ({ config }) => {
        await new Promise((resolve) => schedule(() => resolve(null), 400));
        const command = config.command.split(" ")[0] ?? "";
        if (config.transport === "stdio" && command.startsWith("bunx"))
          return { toolCount: 0, error: `Command not found: ${command}` };
        if (config.transport === "http" && config.url === MOCK_MCP_SIGN_IN_URL && !mcpSignedInUrls.has(config.url))
          return { toolCount: 0, error: sourceText("error.backend.mcpSignInRequired") };
        return { toolCount: MOCK_MCP_TOOL_COUNTS[config.name] ?? 4, error: null };
      },
      signInMcpServer: ({ config }) =>
        new Promise((resolve) => {
          let settled = false;
          const settle = (error: string | null) => {
            if (settled) return;
            settled = true;
            cancelPendingMcpSignIn = null;
            if (!error && config.id) {
              forgetMcpSignIn(config.id);
              mcpSignedIn = new Set(mcpSignedIn).add(config.id);
            }
            if (!error) mcpSignedInUrls = new Set(mcpSignedInUrls).add(config.url);
            resolve({ toolCount: error ? 0 : (MOCK_MCP_TOOL_COUNTS[config.name] ?? 4), error });
          };
          cancelPendingMcpSignIn = () => settle(sourceText("error.backend.mcpSignInCancelled"));
          schedule(() => settle(null), 1500);
        }),
      mcpSignInPage: async () => null,
      mcpSignInRelay: async () => null,
      openMcpSignInRelay: async () => undefined,
      completeMcpSignInRelay: async () => undefined,
      cancelMcpSignIn: async () => {
        cancelPendingMcpSignIn?.();
      },
      copyMcpSignInLink: async () => undefined,
      signOutMcpServer: async ({ mcpServerId }) => {
        forgetMcpSignIn(mcpServerId);
        return mcpSignInStates();
      },
      listMcpSignIns: async () => mcpSignInStates(),
      mcpSignInApp: async ({ mcpServerId }) => mcpSignInAppState(mcpServerId),
      saveMcpSignInApp: async ({ mcpServerId, clientId, clientSecret, scope }) => {
        const secretSaved =
          clientSecret === null ? (mcpSignInApps[mcpServerId]?.secretSaved ?? false) : clientSecret !== "";
        mcpSignInApps = { ...mcpSignInApps, [mcpServerId]: { clientId, secretSaved, scope } };
        forgetMcpSignIn(mcpServerId);
        return mcpSignInAppState(mcpServerId);
      },
      removeMcpSignInApp: async ({ mcpServerId }) => {
        const { [mcpServerId]: _removed, ...rest } = mcpSignInApps;
        mcpSignInApps = rest;
        forgetMcpSignIn(mcpServerId);
        return mcpSignInAppState(mcpServerId);
      },
      getSidebarPins: async () => clone(sidebarPins),
      setSidebarPins: async ({ items }) => {
        sidebarPins = { items: clone(items), updatedAt: new Date().toISOString() };
        emitAgentEvent({ type: "sidebar-pins-changed", ...clone(sidebarPins) });
        return clone(sidebarPins);
      },
      seedSidebarPins: async ({ items }) => {
        if (sidebarPins.updatedAt === null) sidebarPins = { items: clone(items), updatedAt: new Date().toISOString() };
        return clone(sidebarPins);
      },
      getSidebarLayout: async () => clone(sidebarLayout),
      mutateSidebarLayout: async (action) => {
        sidebarLayout = applySidebarLayoutAction(sidebarLayout, action);
        emitAgentEvent({ type: "sidebar-layout-changed", layout: sidebarLayout });
        return clone(sidebarLayout);
      },
      generateProfile: async (input) => ({
        name: input.draft?.name ?? "Research partner",
        title: input.draft?.title ?? "Research assistant",
        description: input.prompt.slice(0, 2000),
        avatarSeed: input.draft?.avatarSeed ?? "profile:research",
        avatarHue: input.draft?.avatarHue ?? 215,
        sectionId: input.draft?.sectionId ?? null,
      }),
      askSideQuestion: async (input) => `You asked: ${input.question}`,
      saveSkillSuggestion: async () => ({ saved: false }),
      saveProfile: async (input) => {
        const agent = input.agentId
          ? await api.agent.updateAgent({ agentId: input.agentId, ...input.draft })
          : await createMockAgent({ ...input.draft, initialMessage: input.initialMessage ?? "Hello" }, false);
        const updated = await api.agent.updateAgent({ agentId: agent.id, ...input.draft });
        await api.agent.setAvatar({ agentId: agent.id, image: null });
        const layout = await api.agent.mutateSidebarLayout({
          type: "assign",
          agentId: agent.id,
          sectionId: input.draft.sectionId,
        });
        if (!isAgentSummary(updated)) throw new Error("Mock profile agent has an unknown provider.");
        return { agent: { ...updated, avatarUrl: null }, layout };
      },
      createAgent: (input) => createMockAgent(input, true),
      duplicateAgent: async (agentId) => {
        const source = agents.find((agent) => agent.id === agentId);
        if (!source) throw new Error("Agent not found");
        const { id: _sourceId, workspacePath: _sourceWorkspacePath, ...copied } = source;
        const agent = {
          ...createAgentSummary({
            ...copied,
            name: `${source.name} copy`,
            preview: "",
            updatedAt: null,
          }),
          ...(source.browserProfileId === undefined
            ? {}
            : { ownBrowserSession: true, browserProfileId: source.browserProfileId }),
          threadId: null,
        };
        agents = [...agents, agent];
        queues.set(agent.id, emptyQueue(agent.id));
        snapshots[agent.id] = {
          agentId: agent.id,
          threadId: null,
          messages: [],
          activeTurnId: null,
          revision: 0,
        };
        memories.set(
          agent.id,
          (memories.get(agentId) ?? []).map((memory) => {
            const id = crypto.randomUUID();
            const selection = memorySelections.get(memory.id);
            if (selection) memorySelections.set(id, { ...selection, memoryId: id });
            return { ...memory, id, agentId: agent.id, sourceTurnId: null };
          }),
        );
        routines.set(
          agent.id,
          (routines.get(agentId) ?? []).map((routine) => {
            const routineId = crypto.randomUUID();
            return {
              ...routine,
              id: routineId,
              agentId: agent.id,
              trigger: {
                ...routine.trigger,
                id: crypto.randomUUID(),
                routineId,
                nextRunAt: new Date().toISOString(),
              },
            };
          }),
        );
        const sourceSectionId = sidebarLayout.agentAssignments[agentId] ?? null;
        const orderWithoutAgent = sidebarLayout.agentOrder.filter((agentId) => agentId !== agent.id);
        const sourceIndex = orderWithoutAgent.indexOf(agentId);
        const beforeAgentId = sourceIndex < 0 ? null : (orderWithoutAgent[sourceIndex + 1] ?? null);
        sidebarLayout = applySidebarLayoutAction(sidebarLayout, {
          type: "move-agent",
          agentId: agent.id,
          sectionId: sourceSectionId,
          beforeAgentId,
        });
        emitAgentEvent({ type: "agents-changed", agents });
        emitAgentEvent({ type: "sidebar-layout-changed", layout: sidebarLayout });
        return clone({ agent, layout: sidebarLayout });
      },
      updateAgent: async (input: UpdateAgentInput) => {
        const current = agents.find((agent) => agent.id === input.agentId);
        if (!current) throw new Error("Agent not found");
        if (input.ultrafast !== undefined && input.fastMode === undefined) throw new Error("Invalid fast mode value.");
        const {
          agentId: _agentId,
          busyMessageMode,
          taskLimit,
          providerAccountId,
          backupModels,
          leaveUsageLimit: _leaveUsageLimit,
          allowAutomation,
          allowNewChat,
          quickAcknowledgement,
          chatColor,
          ...updates
        } = input;
        const updated: ClientAgentSummary = { ...current, ...updates };
        const flags = { allowAutomation, allowNewChat, quickAcknowledgement };
        for (const key of AGENT_DEFAULT_KEYS) {
          const flag = flags[key];
          if (flag === null) delete updated[key];
          else if (flag !== undefined) updated[key] = flag;
        }
        if (backupModels === null) delete updated.backupModels;
        else if (backupModels) updated.backupModels = backupModels;
        if (providerAccountId === null || (updates.provider && !providerAccountId)) delete updated.providerAccountId;
        else if (providerAccountId) updated.providerAccountId = providerAccountId;
        if (busyMessageMode === null) delete updated.busyMessageMode;
        else if (busyMessageMode) updated.busyMessageMode = busyMessageMode;
        if (taskLimit === null) delete updated.taskLimit;
        else if (taskLimit) updated.taskLimit = taskLimit;
        if (chatColor === null) delete updated.chatColor;
        else if (chatColor) updated.chatColor = chatColor;
        if (updates.fastMode !== undefined && !(updates.fastMode && updates.ultrafast)) delete updated.ultrafast;
        if (!updated.fastMode) delete updated.ultrafast;
        agents = agents.map((agent) => (agent.id === updated.id ? updated : agent));
        emitAgentEvent({ type: "agents-changed", agents });
        emitTasks(updated.id);
        return clone(updated);
      },
      setAvatar: async (input: SetAgentAvatarInput) => {
        const current = agents.find((agent) => agent.id === input.agentId);
        if (!current) throw new Error("Agent not found");
        const updated = {
          ...current,
          avatarUrl: input.image ? `mock-avatar://${input.agentId}` : null,
        };
        agents = agents.map((agent) => (agent.id === updated.id ? updated : agent));
        emitAgentEvent({ type: "agents-changed", agents });
        return clone(updated);
      },
      deleteAgent: async (agentId) => {
        agents = agents.filter((agent) => agent.id !== agentId);
        queues.delete(agentId);
        memories.delete(agentId);
        routines.delete(agentId);
        for (const channel of await mockChannels.listChannels()) {
          if (!channel.members.some((member) => member.agentId === agentId)) continue;
          const draft = {
            name: channel.name,
            title: channel.title,
            instructions: channel.instructions,
            members: channel.members,
            leadAgentId: channel.leadAgentId,
          };
          toggleChannelMember(draft, agentId, false);
          await mockChannels.channelCommand({
            type: "save",
            operationId: crypto.randomUUID(),
            channelId: channel.id,
            draft,
            update: true,
          });
        }
        emitAgentEvent({ type: "agents-changed", agents });
      },
      getMemorySelection: async (agentId) => clone(getMemorySelection(agentId)),
      setMemoryInclusion: async ({ agentId, changes }) => {
        const state = getMemorySelection(agentId);
        const next = state.selections.map((selection) => ({ ...selection }));
        for (const change of changes) {
          const selection = next.find((entry) => entry.memoryId === change.memoryId);
          if (!selection || selection.revision !== change.expectedRevision)
            throw new Error(sourceText("error.backend.memorySelectionConflict"));
          if (change.inclusion !== "automatic") selection.inclusion = change.inclusion;
          selection.userControlled = change.inclusion !== "automatic";
          selection.revision += 1;
        }
        const ids = new Set(next.filter((entry) => entry.inclusion === "essential").map((entry) => entry.memoryId));
        if (
          essentialMemoryBytes((memories.get(agentId) ?? []).filter((entry) => ids.has(entry.id))) >
          AGENT_MEMORY_CONTEXT_BUDGET_BYTES
        )
          throw new Error(sourceText("error.backend.memoryEssentialBudget"));
        for (const selection of next) memorySelections.set(selection.memoryId, selection);
        emitAgentEvent({ type: "memories-changed", agentId });
        return clone(getMemorySelection(agentId));
      },
      listMemories: async (agentId) => clone(memories.get(agentId) ?? []),
      createMemory: async (input) => {
        const now = new Date().toISOString();
        const memory: AgentMemory = {
          id: crypto.randomUUID(),
          agentId: input.agentId,
          text: input.text.trim(),
          origin: "manual",
          sourceTurnId: null,
          createdAt: now,
          updatedAt: now,
        };
        memories.set(input.agentId, [...(memories.get(input.agentId) ?? []), memory]);
        memorySelections.set(memory.id, {
          memoryId: memory.id,
          inclusion: "searchable",
          userControlled: false,
          revision: 0,
        });
        emitAgentEvent({ type: "memories-changed", agentId: input.agentId });
        return clone(memory);
      },
      updateMemory: async (input) => {
        const current = memories.get(input.agentId)?.find((memory) => memory.id === input.memoryId);
        if (!current) throw new Error("Memory not found");
        const updated = { ...current, text: input.text.trim(), updatedAt: new Date().toISOString() };
        const selected = (memories.get(input.agentId) ?? [])
          .filter((entry) => memorySelections.get(entry.id)?.inclusion === "essential")
          .map((entry) => (entry.id === input.memoryId ? updated : entry));
        if (essentialMemoryBytes(selected) > AGENT_MEMORY_CONTEXT_BUDGET_BYTES)
          throw new Error(sourceText("error.backend.memoryEssentialBudget"));
        const selection = memorySelections.get(input.memoryId);
        if (selection) memorySelections.set(input.memoryId, { ...selection, revision: selection.revision + 1 });
        memories.set(
          input.agentId,
          (memories.get(input.agentId) ?? []).map((memory) => (memory.id === input.memoryId ? updated : memory)),
        );
        emitAgentEvent({ type: "memories-changed", agentId: input.agentId });
        return clone(updated);
      },
      deleteMemory: async (input) => {
        memorySelections.delete(input.memoryId);
        memories.set(
          input.agentId,
          (memories.get(input.agentId) ?? []).filter((memory) => memory.id !== input.memoryId),
        );
        emitAgentEvent({ type: "memories-changed", agentId: input.agentId });
      },
      clearMemories: async (agentId) => {
        for (const entry of memories.get(agentId) ?? []) memorySelections.delete(entry.id);
        memories.delete(agentId);
        emitAgentEvent({ type: "memories-changed", agentId });
      },
      listTables: async () => clone(tables),
      deleteTable: async (input) => {
        tables = tables.filter((table) => table.name !== input.name);
      },
      listRoutines: async (agentId) => clone(routines.get(agentId) ?? []),
      createRoutine: async (input) => {
        const routine = createRoutineRecord(input);
        routines.set(input.agentId, [routine, ...(routines.get(input.agentId) ?? [])]);
        emitAgentEvent({ type: "routines-changed", agentId: input.agentId });
        return clone(routine);
      },
      updateRoutine: async (input) => {
        const current = routines.get(input.agentId)?.find((routine) => routine.id === input.routineId);
        if (!current) throw new Error("Routine not found");
        const updated: Routine = {
          ...current,
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...(input.instruction === undefined ? {} : { instruction: input.instruction.trim() }),
          ...(input.active === undefined ? {} : { active: input.active }),
          ...(input.limitPolicy === undefined ? {} : { limitPolicy: input.limitPolicy }),
          ...(input.missedPolicy === undefined ? {} : { missedPolicy: input.missedPolicy }),
          ...(input.runIn === undefined ? {} : { runIn: input.runIn }),
          ...(input.runsChangeRoutines === undefined ? {} : { runsChangeRoutines: input.runsChangeRoutines }),
          ...(input.schedule === undefined
            ? {}
            : {
                trigger: {
                  id: crypto.randomUUID(),
                  routineId: current.id,
                  schedule: input.schedule,
                  nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
                  createdAt: current.createdAt,
                  updatedAt: new Date().toISOString(),
                },
              }),
          updatedAt: new Date().toISOString(),
        };
        routines.set(
          input.agentId,
          (routines.get(input.agentId) ?? []).map((routine) => (routine.id === current.id ? updated : routine)),
        );
        emitAgentEvent({ type: "routines-changed", agentId: input.agentId });
        return clone(updated);
      },
      deleteRoutine: async (input) => {
        routines.set(
          input.agentId,
          (routines.get(input.agentId) ?? []).filter((routine) => routine.id !== input.routineId),
        );
        const thread = tasks.get(input.agentId)?.find((task) => task.routineId === input.routineId);
        if (thread && !thread.closedAt) {
          Object.assign(thread, { state: "closed", closedAt: new Date().toISOString() });
          emitTasks(input.agentId);
        }
        emitAgentEvent({ type: "routines-changed", agentId: input.agentId });
      },
      testRoutine: async (input) => {
        const routine = routines.get(input.agentId)?.find((candidate) => candidate.id === input.routineId);
        if (!routine) throw new Error("Routine not found");
        const now = new Date().toISOString();
        const run: RoutineRun = {
          id: crypto.randomUUID(),
          routineId: routine.id,
          agentId: input.agentId,
          triggerId: null,
          kind: "manual",
          scheduledFor: now,
          routineName: routine.name,
          instruction: routine.instruction,
          deliveryId: crypto.randomUUID(),
          status: "queued",
          error: null,
          createdAt: now,
          updatedAt: now,
        };
        routineRuns.set(routine.id, [run, ...(routineRuns.get(routine.id) ?? [])]);
        routineTask(input.agentId, routine);
        emitAgentEvent({ type: "routines-changed", agentId: input.agentId });
        return clone(run);
      },
      listRoutineRuns: async (input) => clone((routineRuns.get(input.routineId) ?? []).slice(0, input.limit)),
      automationRunCommand: async (input) =>
        `curl -sS -X POST "$(cat '/mock/automation/url')/v1/agents/${input.agentId}/routines/${input.routineId}/run" -H @'/mock/automation/headers' -H 'Content-Type: application/json' -d '{"payload":""}'`,
      routineCalendar: async (input) => mockRoutineCalendar(input, routines, routineRuns),
      readConversation: async (agentId) => ({
        ...clone(getSnapshot(agentId)),
        readState: conversationReadState(agentId),
      }),
      readConversationPage: async (input) => {
        if (!input.anchor || input.anchor.type === "latest") {
          emit(latestConversationListeners, input.agentId);
        }
        const snapshot = clone(getSnapshot(input.agentId));
        const limit = Math.min(input.limit ?? 50, 100);
        const anchor = input.anchor;
        const cursorIndex =
          anchor?.type === "before" ? snapshot.messages.findIndex((message) => message.id === anchor.cursor) : -1;
        const end = cursorIndex >= 0 ? cursorIndex : snapshot.messages.length;
        const start = Math.max(0, end - limit);
        const messages = snapshot.messages.slice(start, end);
        return {
          ...snapshot,
          messages,
          references: {},
          pageInfo: { hasOlder: start > 0, olderCursor: start > 0 ? (messages[0]?.id ?? null) : null },
          readState: conversationReadState(input.agentId),
        };
      },
      openMessageLink: async () => null,
      pasteMessageLink: async () => undefined,
      cancelMessageLink: async () => undefined,
      searchConversationMessages: async (input) => {
        const query = input.query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
        const matches = (message: ConversationMessage) =>
          message.text.replace(/\s+/g, " ").toLocaleLowerCase().includes(query);
        const results = agents
          .filter((agent) => input.agentId === undefined || agent.id === input.agentId)
          .flatMap((agent) => [
            ...getSnapshot(agent.id)
              .messages.filter(matches)
              .map((message) => ({ agentId: agent.id, message: clone(message) })),
            ...(input.includeSideThreads ? (tasks.get(agent.id) ?? []) : [])
              .filter((task) => task.closedAt === null)
              .flatMap((task) =>
                taskConversation(task)
                  .messages.filter(matches)
                  .map((message) => ({ agentId: agent.id, message: clone(message), taskId: task.id })),
              ),
          ])
          .sort((left, right) => right.message.createdAt.localeCompare(left.message.createdAt));
        return { results: results.slice(0, input.limit ?? 100), total: results.length, nextCursor: null };
      },
      searchConversationFiles: async (input) => {
        const query = input.query.trim().toLocaleLowerCase();
        const results = agents.flatMap((agent) =>
          getSnapshot(agent.id).messages.flatMap((message) =>
            (message.attachments ?? [])
              .filter((attachment) => attachment.name.toLocaleLowerCase().includes(query))
              .map((attachment) => ({
                agentId: agent.id,
                messageId: message.id,
                createdAt: message.createdAt,
                attachment: clone(attachment),
              })),
          ),
        );
        results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const offset = Number(input.cursor ?? 0);
        const end = offset + (input.limit ?? 50);
        return { results: results.slice(offset, end), nextCursor: end < results.length ? String(end) : null };
      },
      listConversationReads: async () =>
        Object.fromEntries([...conversationReads.keys()].map((agentId) => [agentId, conversationReadState(agentId)])),
      markConversationRead: async (input) => {
        const state = { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: input.throughMessageId };
        if (conversationReads.has(input.agentId)) conversationReads.set(input.agentId, state);
        return clone(state);
      },
      markConversationUnread: async (input) => {
        const { messages, revision } = getSnapshot(input.agentId);
        const index = messages.findIndex((message) => message.id === input.fromMessageId);
        if (index < 0) throw new Error(sourceText("error.backend.readBoundaryUnavailable"));
        const throughMessageId = messages[index - 1]?.id ?? null;
        conversationReads.set(input.agentId, { unreadCount: 0, firstUnreadMessageId: null, throughMessageId });
        emitAgentEvent({ type: "conversation-invalidated", agentId: input.agentId, revision });
        return clone(conversationReadState(input.agentId));
      },
      listPinnedMessages: async (agentId) => pinnedSnapshot(agentId),
      setMessagePinned: async (input) => {
        const key = pinKey(input);
        const pins = (messagePins.get(key) ?? []).filter((pin) => pin.messageId !== input.messageId);
        if (input.pinned) {
          if (!pinnableMessages(input).some((message) => message.id === input.messageId))
            throw new Error(sourceText("error.backend.messagePinNotFound"));
          if (pins.length >= MESSAGE_PINS_LIMIT) throw new Error(sourceText("error.backend.messagePinLimit"));
          pins.unshift({
            messageId: input.messageId,
            pinnedAt: new Date().toISOString(),
            pinnedBy: { kind: "person", sender: null },
          });
        }
        messagePins.set(key, pins);
        emitAgentEvent({ type: "message-pins-changed", agentId: input.agentId });
        return pinnedSnapshot(input.agentId);
      },
      deleteConversationMessage: async (input) => {
        if (input.taskId !== undefined) {
          const task = findTask(input.agentId, input.taskId);
          const conversation = taskConversation(task);
          if (!conversation.messages.some((message) => message.id === input.messageId))
            throw new Error(sourceText("error.backend.messageDeleteNotFound"));
          conversation.messages = conversation.messages.filter((message) => message.id !== input.messageId);
          conversation.revision += 1;
          emitAgentEvent({ type: "agent-task-conversation", taskId: task.id, snapshot: clone(conversation) });
          emitAgentEvent({ type: "message-pins-changed", agentId: input.agentId });
          return;
        }
        if (!getSnapshot(input.agentId).messages.some((message) => message.id === input.messageId))
          throw new Error(sourceText("error.backend.messageDeleteNotFound"));
        updateSnapshot(input.agentId, (snapshot) => {
          snapshot.messages = snapshot.messages.filter((message) => message.id !== input.messageId);
        });
        emitAgentEvent({ type: "message-pins-changed", agentId: input.agentId });
      },
      withdrawFeedback: async (input) => {
        const card = getSnapshot(input.agentId).messages.find((message) => message.id === input.messageId);
        const issue = card ? feedbackSentIssue(card) : null;
        if (!issue) return { status: "notFound" };
        updateSnapshot(input.agentId, (snapshot) => {
          snapshot.messages = snapshot.messages.map((message) =>
            message.id === input.messageId
              ? { ...message, itemType: feedbackWithdrawnItemType(issue.number) }
              : message,
          );
        });
        return { status: "withdrawn" };
      },
      chooseAttachments: async (_input) => [],
      importAttachmentData: async (data) =>
        data.map((file) => ({
          id: crypto.randomUUID(),
          name: file.name,
          mimeType: file.mimeType,
          size: file.bytes.byteLength,
          kind: file.mimeType.startsWith("image/") ? ("image" as const) : ("file" as const),
          previewKind: file.mimeType.startsWith("image/") ? ("image" as const) : ("none" as const),
          previewUrl: URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], { type: file.mimeType })),
        })),
      onAttachmentImport: (listener) => {
        attachmentListeners.add(listener);
        return () => attachmentListeners.delete(listener);
      },
      retryAttachmentImport: () => undefined,
      discardAttachmentImport: () => undefined,
      discardDraftAttachment: async () => undefined,
      downloadAttachments: async () => {
        throw new Error("ZIP downloads are available in the desktop app.");
      },
      openAttachment: async (_input: OpenAttachmentInput) => undefined,
      stopAttachmentDownload: async () => undefined,
      onAttachmentDownload: () => () => undefined,
      openSharedFile: async (_input: OpenSharedFileInput) => undefined,
      openWorkspaceFile: async (_input: OpenWorkspaceFileInput) => undefined,
      previewSharedFile: async (input: OpenSharedFileInput) => mockFilePreview(input.path, "shared-file"),
      releaseFilePreview: async () => undefined,
      addPreviewPage: async () => null,
      previewWorkspaceFile: async (input: OpenWorkspaceFileInput) => {
        if (!/\.[^/]+$/u.test(input.path)) throw new Error("Workspace path is not a file.");
        return mockFilePreview(input.path, "workspace-file");
      },
      listWorkspaceDirectory: async (input: OpenWorkspaceFileInput) => mockWorkspaceDirectory(input.path),
      sendMessage: async (input: SendMessageInput) => {
        if (input.taskId)
          return runTaskTurn(findTask(input.agentId, input.taskId), input.text, input.replyToMessageId ?? null);
        const repeated = input.clientMessageId ? sentReceipts.get(input.clientMessageId) : undefined;
        if (repeated) return repeated;
        const messageId = `mock-message-${messageCounter++}`;
        const deliveryId = `mock-delivery-${messageCounter++}`;
        const turnId = `mock-turn-${messageCounter++}`;
        const createdAt = new Date().toISOString();
        const userMessage: ConversationMessage = {
          id: deliveryId,
          turnId,
          author: "user",
          source: "user",
          text: input.text,
          createdAt,
          status: "completed",
          replyToMessageId: input.replyToMessageId ?? null,
        };
        const delivery: QueueDelivery = {
          id: deliveryId,
          messageId,
          recipientAgentId: input.agentId,
          sender: { kind: "user" },
          text: input.text,
          attachments: [],
          replyToMessageId: input.replyToMessageId ?? null,
          status: "running",
          position: null,
          turnId,
          error: null,
          createdAt,
        };
        updateSnapshot(input.agentId, (snapshot) => {
          snapshot.activeTurnId = turnId;
          snapshot.messages = [...snapshot.messages, userMessage];
        });
        queues.set(input.agentId, { agentId: input.agentId, deliveries: [delivery] });
        emitAgentEvent({
          type: "queue-changed",
          snapshot: queues.get(input.agentId) ?? emptyQueue(input.agentId),
        });
        emitAgentEvent({
          type: "turn-started",
          agentId: input.agentId,
          threadId: getSnapshot(input.agentId).threadId ?? `thread-${input.agentId}`,
          turnId,
        });
        const receipt: QueuedMessageReceipt = {
          messageId,
          deliveries: [{ id: deliveryId, recipientAgentId: input.agentId, status: "running", position: null }],
        };
        if (input.clientMessageId) sentReceipts.set(input.clientMessageId, receipt);
        const sent = { agentId: input.agentId, text: input.text, turnId, delivery };
        if ([...messageSentListeners].some((listener) => listener(clone(sent)))) return receipt;
        emitAgentEvent({
          type: "turn-progress",
          agentId: input.agentId,
          threadId: getSnapshot(input.agentId).threadId ?? `thread-${input.agentId}`,
          turnId,
          detail: "Reviewing your request…",
          activity: "reading",
        });
        emitAgentEvent({
          type: "turn-progress",
          agentId: input.agentId,
          threadId: getSnapshot(input.agentId).threadId ?? `thread-${input.agentId}`,
          turnId,
          detail: "Searched its memories: 1 found",
        });

        schedule(() => {
          const repliedAt = new Date();
          const assistantMessage: ConversationMessage = {
            id: `mock-reply-${messageCounter++}`,
            turnId,
            author: "assistant",
            source: "assistant",
            text: `Mock reply from ${agents.find((agent) => agent.id === input.agentId)?.name ?? "agent"}: I received “${input.text}” and added it to the working context.`,
            createdAt: repliedAt.toISOString(),
            status: "completed",
            trace: mockTurnTrace(turnId, repliedAt),
          };
          const memoryMessage: ConversationMessage[] = /\bremember\b/iu.test(input.text)
            ? [
                {
                  id: `${turnId}:memory-changes`,
                  turnId,
                  author: "system",
                  source: "system",
                  text: "Memory: 1 saved, 0 updated, 0 forgotten.",
                  createdAt: new Date().toISOString(),
                  status: "completed",
                  itemType: CONVERSATION_MEMORY_CHANGES_ITEM_TYPE,
                  memoryChanges: [{ memoryId: `memory-${turnId}`, action: "saved", text: input.text.slice(0, 500) }],
                },
              ]
            : [];
          const planContinuation: ConversationMessage[] = /\bplan\b/iu.test(input.text)
            ? [
                {
                  id: `${turnId}:plan-continuation`,
                  author: "system",
                  source: "system",
                  text: sourceText("status.agent.planContinues", { current: 1, limit: 8 }),
                  createdAt: new Date().toISOString(),
                  status: "completed",
                  itemType: PLAN_CONTINUATION_ITEM_TYPE,
                },
              ]
            : [];
          const instructionsChange: ConversationMessage[] = [];
          if (/\brule\b/iu.test(input.text)) {
            const before = mockAgentInstructions(input.agentId);
            const after = `${before.text}${before.text && !before.text.endsWith("\n") ? "\n" : ""}- ${input.text.slice(0, 200)}\n`;
            mockInstructionFiles.set(input.agentId, { ...before, exists: true, text: after });
            instructionsChange.push({
              id: `${turnId}:instructions-change`,
              author: "system",
              source: "system",
              text: sourceText("status.agent.instructionsChanged"),
              createdAt: new Date().toISOString(),
              status: "completed",
              itemType: AGENT_INSTRUCTIONS_CHANGE_ITEM_TYPE,
              instructionsChange: { before: before.text, after },
            });
          }
          updateSnapshot(input.agentId, (snapshot) => {
            snapshot.activeTurnId = null;
            snapshot.messages = [
              ...snapshot.messages,
              assistantMessage,
              ...memoryMessage,
              ...instructionsChange,
              ...planContinuation,
            ];
          });
          queues.set(input.agentId, {
            agentId: input.agentId,
            deliveries: [{ ...delivery, status: "completed" }],
          });
          emitAgentEvent({
            type: "queue-changed",
            snapshot: queues.get(input.agentId) ?? emptyQueue(input.agentId),
          });
          emitAgentEvent({
            type: "turn-completed",
            agentId: input.agentId,
            threadId: getSnapshot(input.agentId).threadId ?? `thread-${input.agentId}`,
            turnId,
            status: "completed",
          });
        }, 80);

        return receipt;
      },
      setMessageReaction: async (input: SetMessageReactionInput) => {
        updateSnapshot(input.agentId, (snapshot) => {
          const message = snapshot.messages.find((candidate) => candidate.id === input.messageId);
          if (message) {
            message.reaction = input.emoji;
            message.reactions = [
              ...(message.reactions ?? []).filter((reaction) => reaction.actor.kind !== "user"),
              ...(input.emoji ? [{ emoji: input.emoji, actor: { kind: "user" as const } }] : []),
            ];
          }
        });
      },
      listQueue: async (agentId) => clone(queues.get(agentId) ?? emptyQueue(agentId)),
      listActiveQueues: async (agentIds) => ({
        queues: agentIds.map((agentId) => {
          const queue = clone(queues.get(agentId) ?? emptyQueue(agentId));
          return {
            ...queue,
            deliveries: queue.deliveries.filter((delivery) => ACTIVE_QUEUE_STATUSES.has(delivery.status)),
          };
        }),
        omitted: [],
      }),
      listWaits: async (agentId) => ({ agentId, waits: [] }),
      cancelWait: async () => undefined,
      listTasks: async (agentId) => taskList(agentId),
      listArchivedTasks: async (input) => archivedTaskPage(input),
      readTask: async (input) => {
        const conversation = taskConversation(findTask(input.agentId, input.taskId));
        return clone({ ...conversation, messages: conversation.messages.slice(-100) });
      },
      readTaskPage: async (input) => {
        const conversation = taskConversation(findTask(input.agentId, input.taskId));
        const index = conversation.messages.findIndex((message) => message.id === input.beforeMessageId);
        const start = Math.max(0, index - input.limit);
        return clone({
          conversation: { ...conversation, messages: index > 0 ? conversation.messages.slice(start, index) : [] },
          hasOlder: start > 0,
        });
      },
      readTaskAround: async (input) => {
        const conversation = taskConversation(findTask(input.agentId, input.taskId));
        const index = conversation.messages.findIndex((message) => message.id === input.messageId);
        if (index < 0)
          return clone({ conversation: { ...conversation, messages: [] }, hasOlder: false, hasNewer: false });
        const start = Math.max(0, index - Math.floor(input.limit / 2));
        const end = Math.min(conversation.messages.length, start + input.limit);
        return clone({
          conversation: { ...conversation, messages: conversation.messages.slice(start, end) },
          hasOlder: start > 0,
          hasNewer: end < conversation.messages.length,
        });
      },
      startTask: async (input) => {
        const task = createTask(input.agentId, input.text);
        runTaskTurn(task, input.text);
        return clone(task);
      },
      runQueuedMessageAsTask: async (input) => {
        const queue = queues.get(input.agentId) ?? emptyQueue(input.agentId);
        const delivery = queue.deliveries.find(
          (candidate) => candidate.id === input.deliveryId && candidate.status === "queued",
        );
        if (!delivery) throw new Error(sourceText("error.backend.queuedMessageUnavailable"));
        queue.deliveries = queue.deliveries.filter((candidate) => candidate.id !== input.deliveryId);
        queues.set(input.agentId, queue);
        emitAgentEvent({ type: "queue-changed", snapshot: clone(queue) });
        const task = createTask(input.agentId, delivery.text);
        runTaskTurn(task, delivery.text);
        return clone(task);
      },
      branchTask: async (input) => {
        const earlier = branches.get(input.requestId);
        if (earlier) return clone(earlier);
        const sourceTask = input.taskId === null ? null : findTask(input.agentId, input.taskId);
        const source = sourceTask ? taskConversation(sourceTask) : getSnapshot(input.agentId);
        if (source.activeTurnId) throw new Error(sourceText("error.backend.branchSourceBusy"));
        const index = source.messages.findIndex((message) => message.id === input.messageId);
        const chosen = source.messages[index];
        if (chosen?.author !== "assistant" || chosen.status === "streaming") {
          throw new Error(sourceText("error.backend.branchMessageNotFound"));
        }
        const messages = source.messages
          .slice(0, index + 1)
          .map(({ delivery: _delivery, reaction: _reaction, reactions: _reactions, ...message }) => ({
            ...clone(message),
            id: `mock-branch-message-${messageCounter++}`,
          }));
        const lastUserText = messages.findLast((message) => message.author === "user")?.text;
        const task = createTask(
          input.agentId,
          sourceTask ? `${sourceTask.title} #2` : lastUserText?.trim() || sourceText("status.agent.branchTitle"),
        );
        const through = messages.at(-1);
        task.branch = {
          sourceTaskId: input.taskId,
          sourceTitle: sourceTask?.title ?? null,
          sourceMessageId: input.messageId,
          throughMessageId: through?.id ?? input.messageId,
        };
        taskConversations.set(task.id, {
          agentId: task.agentId,
          threadId: task.threadId,
          activeTurnId: null,
          revision: 0,
          messages,
        });
        branches.set(input.requestId, task);
        emitTasks(input.agentId);
        return clone(task);
      },
      stopTask: async (input) => {
        const task = findTask(input.agentId, input.taskId);
        const conversation = taskConversation(task);
        conversation.activeTurnId = null;
        Object.assign(task, {
          state: "idle",
          activeTurnId: null,
          progress: null,
          queuedMessages: [],
          outcome: task.activeTurnId ? "interrupted" : task.outcome,
        });
        emitTasks(input.agentId);
      },
      closeTask: async (input) => {
        const task = findTask(input.agentId, input.taskId);
        const now = new Date().toISOString();
        Object.assign(task, {
          state: "closed",
          activeTurnId: null,
          progress: null,
          queuedMessages: [],
          hold: null,
          closedAt: now,
          updatedAt: now,
        });
        emitTasks(input.agentId);
      },
      reopenTask: async (input) => {
        const task = findTask(input.agentId, input.taskId);
        Object.assign(task, { state: "idle", closedAt: null, updatedAt: new Date().toISOString() });
        emitTasks(input.agentId);
      },
      renameTask: async (input) => {
        const task = findTask(input.agentId, input.taskId);
        Object.assign(task, { title: input.title, updatedAt: new Date().toISOString() });
        emitTasks(input.agentId);
      },
      deleteTask: async (input) => {
        const task = findTask(input.agentId, input.taskId);
        if (task.activeTurnId) throw new Error(sourceText("error.backend.threadStillRunning"));
        tasks.set(
          input.agentId,
          (tasks.get(input.agentId) ?? []).filter((candidate) => candidate.id !== input.taskId),
        );
        taskConversations.delete(input.taskId);
        emitTasks(input.agentId);
      },
      listTaskReads: async (agentId) =>
        (tasks.get(agentId) ?? [])
          .filter((task) => task.state !== "closed")
          .map((task) => ({
            taskId: task.id,
            unreadCount: taskUnread.get(task.id) ?? 0,
            firstUnreadMessageId: null,
            throughMessageId: null,
          })),
      markTaskRead: async (input) => {
        findTask(input.agentId, input.taskId);
        taskUnread.delete(input.taskId);
        return {
          taskId: input.taskId,
          unreadCount: 0,
          firstUnreadMessageId: null,
          throughMessageId: input.throughMessageId,
        };
      },
      acknowledgeFailedTurn: async () => undefined,
      cancelQueuedMessage: async (input) => {
        const queue = queues.get(input.agentId) ?? emptyQueue(input.agentId);
        queue.deliveries = queue.deliveries.map((delivery) =>
          delivery.id === input.deliveryId ? { ...delivery, status: "cancelled" } : delivery,
        );
        queues.set(input.agentId, queue);
        emitAgentEvent({ type: "queue-changed", snapshot: queue });
      },
      steerQueuedMessage: async (input: SteerQueuedMessageInput) => {
        const queue = queues.get(input.agentId) ?? emptyQueue(input.agentId);
        queue.deliveries = queue.deliveries.map((delivery) =>
          delivery.id === input.deliveryId
            ? { ...delivery, status: "running", turnId: input.expectedTurnId, position: null }
            : delivery,
        );
        queues.set(input.agentId, queue);
        emitAgentEvent({ type: "queue-changed", snapshot: queue });
      },
      editQueuedMessage: async (input) => {
        const queue = queues.get(input.agentId) ?? emptyQueue(input.agentId);
        if (input.action === "begin") {
          const existing = queueEdits.get(input.editId);
          const delivery =
            existing?.delivery ??
            queue.deliveries.find((item) => item.id === input.deliveryId && item.status === "queued");
          if (!delivery || (existing && existing.agentId !== input.agentId))
            throw new Error("This queued message is no longer available.");
          queueEdits.set(input.editId, { agentId: input.agentId, delivery });
          queue.deliveries = queue.deliveries.map((item) =>
            item.id === delivery.id ? { ...item, editing: true } : item,
          );
          queues.set(input.agentId, queue);
          emitAgentEvent({ type: "queue-changed", snapshot: structuredClone(queue) });
          return structuredClone(queue);
        }
        const held = queueEdits.get(input.editId);
        if (!held || held.agentId !== input.agentId || held.delivery.id !== input.deliveryId)
          throw new Error("This edit is no longer available.");
        if (input.action === "retain-attachments") return structuredClone(queue);
        queueEdits.delete(input.editId);
        const delivery =
          input.action === "save"
            ? {
                ...held.delivery,
                text: input.text,
                attachments: held.delivery.attachments.filter((item) => input.keepAttachmentIds.includes(item.id)),
              }
            : held.delivery;
        queue.deliveries = queue.deliveries.some((item) => item.id === delivery.id)
          ? queue.deliveries.map((item) => (item.id === delivery.id ? { ...delivery, editing: false } : item))
          : [...queue.deliveries, { ...delivery, editing: false }];
        queues.set(input.agentId, queue);
        emitAgentEvent({ type: "queue-changed", snapshot: structuredClone(queue) });
        return structuredClone(queue);
      },
      updateQueuedMessage: async (input: UpdateQueuedMessageInput) => {
        const queue = queues.get(input.agentId) ?? emptyQueue(input.agentId);
        queue.deliveries = queue.deliveries.map((delivery) =>
          delivery.id === input.deliveryId ? { ...delivery, text: input.text } : delivery,
        );
        queues.set(input.agentId, queue);
        emitAgentEvent({ type: "queue-changed", snapshot: queue });
      },
      reorderQueue: async (input: ReorderQueueInput) => {
        const queue = queues.get(input.agentId) ?? emptyQueue(input.agentId);
        const byId = new Map(queue.deliveries.map((delivery) => [delivery.id, delivery]));
        queue.deliveries = input.deliveryIds.flatMap((deliveryId, index) => {
          const delivery = byId.get(deliveryId);
          return delivery ? [{ ...delivery, position: index + 1 }] : [];
        });
        queues.set(input.agentId, queue);
        emitAgentEvent({ type: "queue-changed", snapshot: queue });
      },
      interrupt: async (input) => {
        emitAgentEvent({
          type: "turn-completed",
          agentId: input.agentId,
          threadId: getSnapshot(input.agentId).threadId ?? `thread-${input.agentId}`,
          turnId: input.turnId,
          status: "interrupted",
        });
      },
      clearContext: async (agentId: string) => {
        updateSnapshot(agentId, (snapshot) => {
          snapshot.messages.push({
            id: crypto.randomUUID(),
            author: "system",
            source: "system",
            text: sourceText("status.agent.contextCleared"),
            createdAt: new Date().toISOString(),
            status: "completed",
            itemType: CONTEXT_RESET_ITEM_TYPE,
          });
        });
      },
      deleteHistory: async (agentId: string) => {
        updateSnapshot(agentId, (snapshot) => {
          snapshot.messages = [];
        });
      },
      compactContext: async () => undefined,
      compactTaskContext: async () => undefined,
      respondToPrompt: async (input: RespondToPromptInput) => {
        emit(promptResponseListeners, input);
      },
      respondToApproval: async () => undefined,
      readPendingApproval: async () => null,
      readMediaApproval: async () => ({ media: null, hold: null }),
      respondToMediaApproval: async () => undefined,
      respondToCreditsHold: async () => null,
      setCreditsAskMuted: async () => undefined,
      readCreditsAskMuted: async () => ({ muted: false }),
      listPendingPrompts: async () => (runtimeSnapshot ? clone(runtimeSnapshot.pendingPrompts) : []),
      respondToBrowserSecret: async (input) => {
        for (const listener of agentListeners)
          listener({ type: "browser-takeover-resolved", requestId: input.requestId, agentId: input.agentId });
      },
      respondToBrowserTakeover: async () => undefined,
      onEvent: (listener) => {
        agentListeners.add(listener);
        return () => agentListeners.delete(listener);
      },
      onScopedEvent: (listener) => {
        const scopedListener = (event: AgentEvent) => listener({ serverId: mockTeam.activeServerId(), event });
        agentListeners.add(scopedListener);
        return () => agentListeners.delete(scopedListener);
      },
    },
    browser: mockBrowser.browser,
    update: {
      getStatus: async () => clone(updateStatus),
      check: async () => {
        updateStatus = { ...updateStatus, phase: "up-to-date", availableVersion: null };
        emit(updateListeners, updateStatus);
        return clone(updateStatus);
      },
      download: async () => {
        updateStatus = { ...updateStatus, phase: "downloading", progress: null };
        emit(updateListeners, updateStatus);
        const downloadSteps = [
          { delay: 350, expectedPhase: "downloading", phase: "downloading", progress: 28 },
          { delay: 700, expectedPhase: "downloading", phase: "downloading", progress: 64 },
          { delay: 1_050, expectedPhase: "downloading", phase: "ready", progress: 100 },
        ] as const;
        for (const step of downloadSteps) {
          schedule(() => {
            if (updateStatus.phase !== step.expectedPhase) return;
            updateStatus = { ...updateStatus, phase: step.phase, progress: step.progress };
            emit(updateListeners, updateStatus);
          }, step.delay);
        }
        return clone(updateStatus);
      },
      install: async () => {
        updateStatus = { ...updateStatus, phase: "installing" };
        emit(updateListeners, updateStatus);
        return clone(updateStatus);
      },
      getPreference: async () => clone(updatePreference),
      setPreference: async (input) => {
        updatePreference = { ...updatePreference, ...input };
        return clone(updatePreference);
      },
      cancelScheduledRestart: async () => {
        const { scheduledRestart: _cancelled, ...rest } = updateStatus;
        updateStatus = rest;
        emit(updateListeners, updateStatus);
        return clone(updateStatus);
      },
      restartWhenIdle: async (target) => {
        updateStatus = { ...updateStatus, idleRestart: { target, waitingFor: ["agent-turn"] } };
        emit(updateListeners, updateStatus);
        return clone(updateStatus);
      },
      cancelIdleRestart: async () => {
        const { idleRestart: _cancelled, ...rest } = updateStatus;
        updateStatus = rest;
        emit(updateListeners, updateStatus);
        return clone(updateStatus);
      },
      restartNow: async () => {
        const { idleRestart: _restarted, ...rest } = updateStatus;
        updateStatus = rest;
        emit(updateListeners, updateStatus);
        return clone(updateStatus);
      },
      onEvent: (listener) => {
        updateListeners.add(listener);
        return () => updateListeners.delete(listener);
      },
      onPreference: () => () => undefined,
    },
    notifications: {
      getPreference: async () => ({ desktopNotifications: true, messagePreview: true }),
      setPreference: async (input) => ({ ...input }),
      test: async () => undefined,
      openSettings: async () => undefined,
      onOpened: () => () => undefined,
      onWorkflowOpened: () => () => undefined,
    },
    maintenance: {
      exportData: async () => ({ saved: true }),
      exportDiagnostics: async () => ({ saved: true }),
    },
    servers: mockTeam.servers,
    localServers: mockTeam.localServers,
    plugins: {
      takePendingListing: async () => null,
      onOpenListing: (listener) => {
        void listener;
        return () => undefined;
      },
    },
    marketplace: {
      takePendingListing: async () => null,
      onOpenListing: (listener) => {
        void listener;
        return () => undefined;
      },
    },
    host: mockTeam.host,
    events: mockEvents,
    hostAdmin: {
      updateIdentity: async (input, serverId) => {
        const { appearance, ...identity } = input;
        if (identity.serverName !== undefined || identity.logo !== undefined)
          await mockTeam.host.updateIdentity(identity);
        if (appearance !== undefined) mockTeam.setServerAppearance(serverId, appearance);
        const server = (await mockTeam.servers.list()).find((candidate) => candidate.id === serverId);
        if (!server) throw new Error("Server not found");
        return server;
      },
      rotateHostKey: async () => {
        await mockTeam.host.rotateIdentityKey();
      },
      restartHost: async () => {},
      ...createMockHostUpdate(options),
      ...createMockHostTimezone(),
      ...createMockHostSignalHome(),
      ...createMockHostVoiceModel(),
      ...hostTurnLimits,
      ...createMockHostPersonality(),
      getAgentMemoryLimit: async () => hostAgentMemoryLimit(agentMemoryLimit),
      setAgentMemoryLimit: async (limit) => {
        if (!isAgentMemoryLimit(limit)) throw new Error("Agent memory limit is required.");
        agentMemoryLimit = { limit };
        for (const listener of agentMemoryLimitListeners) listener(clone(agentMemoryLimit));
        return hostAgentMemoryLimit(agentMemoryLimit);
      },
      getMemoryReview: async () => hostMemoryReview(memoryReview),
      setMemoryReview: async (interval) => {
        if (!isMemoryReviewInterval(interval)) throw new Error("Memory review interval is required.");
        memoryReview = { interval };
        return hostMemoryReview(memoryReview);
      },
      getSkillLearning: async () => hostSkillLearning(skillLearning),
      setSkillLearning: async (mode) => {
        if (!isSkillLearningMode(mode)) throw new Error("Skill learning mode is required.");
        skillLearning = { mode };
        return hostSkillLearning(skillLearning);
      },
      getBrowsingMemory: async () => hostBrowsingMemory(browsingMemory),
      setBrowsingMemory: async (enabled) => {
        browsingMemory = { enabled };
        return hostBrowsingMemory(browsingMemory);
      },
      getMachineAlerts: async () => clone(machineAlerts),
      setMachineAlerts: async (settings) => {
        machineAlerts = decodeMachineAlertSettings(settings);
        return clone(machineAlerts);
      },
      getPromptCacheTtl: async () => clone(promptCacheTtl),
      setPromptCacheTtl: async (ttl) => {
        if (!isPromptCacheTtl(ttl)) throw new Error("Prompt cache time is required.");
        promptCacheTtl = { ttl };
        return clone(promptCacheTtl);
      },
      getCacheExpiryCompaction: async () => clone(cacheExpiryCompaction),
      setCacheExpiryCompaction: async (enabled) => {
        if (typeof enabled !== "boolean") throw new Error("Invalid cache expiry compaction setting.");
        cacheExpiryCompaction = { enabled };
        return clone(cacheExpiryCompaction);
      },
      getMediaApprovalCredits: async () => clone(mediaApprovalCredits),
      setMediaApprovalCredits: async (update) => {
        const parsed = parseMediaApprovalCreditsUpdate(update);
        if (!parsed) throw new Error("Invalid media approval credits.");
        mediaApprovalCredits = { ...mediaApprovalCredits, ...parsed };
        return clone(mediaApprovalCredits);
      },
      getClaudeUserSetup: async () => clone(claudeUserSetup),
      setClaudeUserSetup: async (enabled) => {
        if (typeof enabled !== "boolean") throw new Error("Invalid Claude setup setting.");
        claudeUserSetup = { enabled };
        return clone(claudeUserSetup);
      },
      getClaudeCompactWindow: async () => clone(claudeCompactWindow),
      setClaudeCompactWindow: async (tokens) => {
        if (!isClaudeCompactWindowTokens(tokens)) throw new Error("Invalid Claude compaction size.");
        claudeCompactWindow = { tokens };
        return clone(claudeCompactWindow);
      },
      getProviderEnvironment: async (provider): Promise<ProviderEnvironment> => ({
        provider,
        variables: (providerVariables.get(provider) ?? []).map((variable) => ({
          name: variable.name,
          value: variable.sensitive ? "" : variable.value,
          sensitive: variable.sensitive,
          stored: variable.sensitive,
        })),
      }),
      setProviderEnvironment: async ({ provider, variables }): Promise<ProviderEnvironment> => {
        const previous = providerVariables.get(provider) ?? [];
        const names = variables.map((variable) => variable.name.trim());
        const next = variables.map((variable, index) => {
          const name = names[index] ?? "";
          const problem = providerEnvironmentProblem(provider, name, names);
          if (problem === "reserved") throw new Error(sourceText("error.provider.environmentNameReserved", { name }));
          if (problem === "duplicate") throw new Error(sourceText("error.provider.environmentNameDuplicate", { name }));
          if (problem) throw new Error(sourceText("error.provider.environmentNameInvalid", { name }));
          const value = variable.value ?? previous.find((item) => item.name === name && item.sensitive)?.value;
          if (value === undefined) throw new Error(sourceText("error.provider.customAgentEnvValueMissing", { name }));
          return { name, value, sensitive: variable.sensitive };
        });
        providerVariables.set(provider, next);
        return {
          provider,
          variables: next.map((variable) => ({
            name: variable.name,
            value: variable.sensitive ? "" : variable.value,
            sensitive: variable.sensitive,
            stored: variable.sensitive,
          })),
        };
      },
      getModelVisibility: async (provider) => modelVisibility(provider),
      setModelVisibility: async (input) => {
        const change = parseProviderModelVisibilityChange(input);
        if (change.shown === null) shownModels.delete(change.provider);
        else shownModels.set(change.provider, change.shown);
        emitAgentEvent({ type: "status", status: clone(agentStatus) });
        return modelVisibility(change.provider);
      },
      getAgentAccess: async () => ({
        ...clone(agentAccess),
        mine: Object.fromEntries(agents.map((agent) => [agent.id, "manage" as const])),
      }),
      setAgentAccess: async (input) => {
        const change = parseAgentAccessChange(input);
        if (change.revision !== agentAccess.revision) throw new Error(sourceText("error.team.agentAccessStale"));
        const names = {
          member: (id: string) => STORY_PRESENCE.members.find((member) => member.id === id)?.name ?? id,
          agent: (id: string) => agents.find((agent) => agent.id === id)?.name ?? id,
        };
        const at = new Date().toISOString();
        const actor = { id: "member-self", name: "Norbert" };
        serverAudit = [
          ...agentAccessAuditChanges(agentAccess, change, names)
            .reverse()
            .map((auditChange) => ({ id: crypto.randomUUID(), at, actor, change: auditChange })),
          ...serverAudit,
        ];
        agentAccess = { ...change, revision: change.revision + 1 };
        return {
          ...clone(agentAccess),
          mine: Object.fromEntries(agents.map((agent) => [agent.id, "manage" as const])),
        };
      },
      getAuditLog: async () => ({ entries: clone(serverAudit) }),
    },
    storage: createMockStorage(() => emitAgentEvent({ type: "library-folders-changed" })),
    agentImport: {
      choose: async () => clone(AGENT_IMPORT_PREVIEW),
      apply: async ({ token, keys, channelKeys }) => {
        if (token !== AGENT_IMPORT_PREVIEW.token) throw new Error("The export is no longer open. Choose it again.");
        const selected = AGENT_IMPORT_PREVIEW.agents.filter((agent) => keys.includes(agent.key));
        const imported = selected.map((agent) =>
          createAgentSummary({ name: agent.name, title: agent.title, description: agent.description }),
        );
        agents = [...agents, ...imported];
        emitAgentEvent({ type: "agents-changed", agents });
        const agentIds = new Map(selected.map((agent, index) => [agent.key, imported[index]?.id ?? ""]));
        const channels = [];
        const skippedChannels = [];
        for (const source of AGENT_IMPORT_PREVIEW.channels.filter((channel) => channelKeys.includes(channel.key))) {
          const members = source.memberKeys.flatMap((key) => {
            const agentId = agentIds.get(key);
            return agentId ? [{ agentId }] : [];
          });
          if (members.length === 0) {
            skippedChannels.push({
              key: source.key,
              name: source.name,
              reason: "None of its agents were imported.",
            });
            continue;
          }
          const channel = await api.agent.channelCommand({
            type: "save",
            operationId: crypto.randomUUID(),
            channelId: crypto.randomUUID(),
            draft: {
              name: source.name,
              title: source.title,
              instructions: "",
              members,
              leadAgentId: source.leadKey ? (agentIds.get(source.leadKey) ?? null) : null,
            },
          });
          channels.push({ id: channel.id, name: channel.name });
        }
        return clone({ agents: imported, skipped: [], channels, skippedChannels, warnings: [] });
      },
      discard: async () => undefined,
      readSkill: async (source) => (source === "hermes-agent" ? HERMES_EXPORT_SKILL : AGENT_IMPORT_SKILL),
      saveSkill: async () => ({ saved: true }),
      readHermes: async () => clone(HERMES_IMPORT_PREVIEW),
      chooseHermes: async () => clone(HERMES_IMPORT_PREVIEW),
      applyHermes: async ({ token, profiles }) => {
        if (token !== HERMES_IMPORT_PREVIEW.token)
          throw new Error("The Hermes profiles are no longer open. Read them again.");
        const imported = HERMES_IMPORT_PREVIEW.profiles
          .filter((profile) => profiles.some((entry) => entry.key === profile.key))
          .map((profile) => createAgentSummary({ name: profile.name, title: "", description: "" }));
        agents = [...agents, ...imported];
        emitAgentEvent({ type: "agents-changed", agents });
        return clone({ agents: imported, skipped: [], channels: [], skippedChannels: [], warnings: [] });
      },
      discardHermes: async () => undefined,
    },
    instanceTransfer: {
      summary: async () =>
        clone({
          agents: agents.map((agent, index) => ({
            id: agent.id,
            name: agent.name,
            title: agent.title,
            avatarSeed: agent.avatarSeed,
            avatarHue: agent.avatarHue,
            avatarUrl: agent.avatarUrl,
            skillCount: index % 4,
            routineCount: routines.get(agent.id)?.length ?? 0,
            memoryCount: memories.get(agent.id)?.length ?? 0,
            fileCount: index * 37,
            fileBytes: index * 3_400_000,
          })),
        }),
      export: async () => ({
        saved: true,
        fileName: `openbot-transfer-${new Date().toISOString().slice(0, 10)}.zip`,
        warnings: [],
      }),
      showExport: async () => undefined,
      choose: async () => clone(INSTANCE_TRANSFER_PREVIEW),
      apply: async ({ token, keys }) => {
        if (token !== INSTANCE_TRANSFER_PREVIEW.token)
          throw new Error("The export is no longer open. Choose it again.");
        const imported = INSTANCE_TRANSFER_PREVIEW.agents
          .filter((agent) => keys.includes(agent.key))
          .map((agent) => createAgentSummary({ name: agent.name, title: agent.title, description: agent.description }));
        agents = [...agents, ...imported];
        emitAgentEvent({ type: "agents-changed", agents });
        return clone({ agents: imported, skipped: [], signIn: ["claude"], warnings: [] });
      },
      discard: async () => undefined,
      copy: async ({ agentIds }) => {
        const copied = agents
          .filter((agent) => agentIds.includes(agent.id))
          .map((agent) => createAgentSummary({ name: agent.name, title: agent.title, description: agent.description }));
        agents = [...agents, ...copied];
        emitAgentEvent({ type: "agents-changed", agents });
        return clone({ agents: copied, skipped: [], signIn: ["claude"], warnings: [] });
      },
      onUploadProgress: () => () => undefined,
    },
    remoteDesktop: mockTeam.remoteDesktop,
  };

  return {
    api,
    emitAgentEvent,
    onLatestConversationOpened: (listener) => {
      latestConversationListeners.add(listener);
      return () => latestConversationListeners.delete(listener);
    },
    onLatestDirectConversationOpened: mockTeam.onLatestDirectConversationOpened,
    readConversationSnapshot,
    updateConversationSnapshot,
    readDirectConversationSnapshot: mockTeam.readDirectConversationSnapshot,
    updateDirectConversationSnapshot: mockTeam.updateDirectConversationSnapshot,
    emitConversationDelta,
    setQueueSnapshot,
    setRuntimeSnapshot: (snapshot) => {
      runtimeSnapshot = clone(snapshot);
      emitAgentEvent({ type: "runtime-snapshot", snapshot });
    },
    onMessageSent: (listener) => {
      messageSentListeners.add(listener);
      return () => messageSentListeners.delete(listener);
    },
    onPromptResponse: (listener) => {
      promptResponseListeners.add(listener);
      return () => promptResponseListeners.delete(listener);
    },
    emitAuthState: mockAuth.emitAuthState,
    emitPresence: mockTeam.emitPresence,
    emitDirectMessage: mockTeam.emitDirectMessage,
    emitDirectTyping: mockTeam.emitDirectTyping,
    emitInvite: mockTeam.emitInvite,
    emitHostStatus: mockTeam.emitHostStatus,
    emitRemoteDesktopSessions: mockTeam.emitRemoteDesktopSessions,
    dispose: () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      mockProviderRuntimes.dispose();
      mockAuth.dispose();
      mockBrowser.dispose();
      mockTeam.dispose();
      agentListeners.clear();
      updateListeners.clear();
      attachmentListeners.clear();
      latestConversationListeners.clear();
      messageSentListeners.clear();
      promptResponseListeners.clear();
      void appInfo;
    },
  };
}
