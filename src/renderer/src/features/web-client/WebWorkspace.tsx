import { isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import type { AppAppearance } from "@openbot/contracts/app-appearance";
import type { AppLanguage } from "@openbot/contracts/app-language";
import { HOSTED_SERVER_CONTACT_URL } from "@openbot/contracts/hosted-servers";
import {
  type AddedAgent,
  type AgentModelChoice,
  type AgentProviderId,
  type AgentStatus,
  type AgentWaitsSnapshot,
  type AppInfo,
  type AvatarColor,
  agentFastModeSettings,
  CHANNEL_CHATS_CAPABILITY,
  CHANNEL_TASK_CANCEL_CAPABILITY,
  type ChannelSummary,
  type ClientAgentModelOption,
  canAdministerServer,
  decodeAgentBackupModelSettings,
  decodeAgentBuiltinMemorySettings,
  decodeAgentDefaultsOverview,
  decodeAgentFastModeSettings,
  decodeAgentHostSettings,
  decodeAgentNewChatSettings,
  decodeAgentPlanCardSettings,
  decodeAgentSpeedSettings,
  decodeHostTurnLimits,
  decodeHostVoiceModel,
  LEGACY_RESPONSE_STYLE,
  type McpSignInState,
  type RoutineFields,
  type ServerConnectionState,
  type ServerSummary,
  STORAGE_CAPABILITY,
} from "@openbot/contracts/ipc";
import type { PricingOrder } from "@openbot/contracts/license";
import type { MarketplaceListingLink } from "@openbot/contracts/marketplace-links";
import { AGENT_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-access-v1";
import { AGENT_BACKUP_MODELS_ROUTES } from "@openbot/contracts/team-protocol/agent-backup-models-v1";
import { AGENT_BUILTIN_MEMORY_ROUTES } from "@openbot/contracts/team-protocol/agent-builtin-memory-v1";
import { AGENT_DEFAULTS_ROUTES } from "@openbot/contracts/team-protocol/agent-defaults-v1";
import { AGENT_FAST_MODE_ROUTES } from "@openbot/contracts/team-protocol/agent-fast-mode-v1";
import { AGENT_HOST_SETTINGS_ROUTES } from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import { AGENT_IMPORT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-import-v1";
import { AGENT_IMPORT_V2_CAPABILITY } from "@openbot/contracts/team-protocol/agent-import-v2";
import { AGENT_NEW_CHAT_ROUTES } from "@openbot/contracts/team-protocol/agent-new-chat-v1";
import { AGENT_NOTIFICATION_LEVELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { AGENT_PLAN_CARD_ROUTES } from "@openbot/contracts/team-protocol/agent-plan-card-v1";
import { AGENT_SPEED_CAPABILITY, AGENT_SPEED_ROUTES } from "@openbot/contracts/team-protocol/agent-speed-v1";
import { AGENT_TASKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import { AGENT_THREAD_FILES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-files-v1";
import { AGENT_USAGE_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-usage-limit-v1";
import { AGENT_WAITS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-waits-v1";
import { BROWSER_PROFILES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { BROWSER_PROXIES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-proxies-v1";
import { TEAM_BROWSER_VIEW_CAPABILITY } from "@openbot/contracts/team-protocol/browser-view-v1";
import { CHANNEL_BROWSER_CAPABILITY } from "@openbot/contracts/team-protocol/channel-browser-v1";
import { CHANNEL_FOLDERS_CAPABILITY } from "@openbot/contracts/team-protocol/channel-folders-v1";
import { CHANNEL_ISOLATION_CAPABILITY } from "@openbot/contracts/team-protocol/channel-isolation-v1";
import { CHANNEL_PICTURE_CAPABILITY } from "@openbot/contracts/team-protocol/channel-picture-v1";
import { CHAT_HISTORY_CAPABILITY } from "@openbot/contracts/team-protocol/chat-history-v1";
import {
  CLAUDE_USER_SETUP_ROUTES,
  decodeClaudeUserSetupResponse,
} from "@openbot/contracts/team-protocol/claude-user-setup-v1";
import { CONNECTORS_CAPABILITY } from "@openbot/contracts/team-protocol/connectors-v1";
import { CONTEXT_COMPACT_CAPABILITY } from "@openbot/contracts/team-protocol/context-compact-v1";
import { CONTEXT_RESET_CAPABILITY } from "@openbot/contracts/team-protocol/context-reset-v1";
import { CONVERSATION_FILE_SEARCH_CAPABILITY } from "@openbot/contracts/team-protocol/conversation-file-search-v1";
import { CONVERSATION_UNREAD_FROM_CAPABILITY } from "@openbot/contracts/team-protocol/conversation-unread-from-v1";
import { CRM_CAPABILITY } from "@openbot/contracts/team-protocol/crm-v1";
import { AGENT_HIDDEN_CAPABILITY, AGENT_HIDDEN_WORK_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { DISCORD_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/discord-access-v1";
import { EVENTS_CAPABILITY } from "@openbot/contracts/team-protocol/events-v1";
import { HOST_PERSONALITY_CAPABILITY } from "@openbot/contracts/team-protocol/host-personality-v1";
import { HOST_RELEASE_CAPABILITY } from "@openbot/contracts/team-protocol/host-release-v1";
import { HOST_TURN_LIMITS_ROUTES } from "@openbot/contracts/team-protocol/host-turn-limits-v1";
import { HOST_VOICE_MODEL_ROUTES } from "@openbot/contracts/team-protocol/host-voice-model-v1";
import { HOSTED_SITES_CAPABILITY } from "@openbot/contracts/team-protocol/hosted-sites-v1";
import { INSTANCE_TRANSFER_CHUNKS_CAPABILITY } from "@openbot/contracts/team-protocol/instance-transfer-chunks-v1";
import { INSTANCE_TRANSFER_FULL_COPY_CAPABILITY } from "@openbot/contracts/team-protocol/instance-transfer-full-copy-v1";
import { INSTANCE_TRANSFER_CAPABILITY } from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { MCP_SIGN_IN_CAPABILITY } from "@openbot/contracts/team-protocol/mcp-sign-in-v1";
import { MESSAGE_DELETE_CAPABILITY } from "@openbot/contracts/team-protocol/message-delete-v1";
import { MESSAGE_PINS_CAPABILITY } from "@openbot/contracts/team-protocol/message-pins-v1";
import { OWNER_TRANSFER_CAPABILITY } from "@openbot/contracts/team-protocol/owner-transfer-v1";
import { PROVIDER_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { ROUTINE_RECOVERY_CAPABILITY } from "@openbot/contracts/team-protocol/routine-recovery-v1";
import { ROUTINE_RUN_PLACE_CAPABILITY } from "@openbot/contracts/team-protocol/routine-run-place-v1";
import { ROUTINES_ONCE_CAPABILITY } from "@openbot/contracts/team-protocol/routines-once-v1";
import { SIDE_QUESTION_CAPABILITY } from "@openbot/contracts/team-protocol/side-question-v1";
import { SIGN_IN_RELAY_CAPABILITY } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { SKILL_LEARNING_CAPABILITY } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { STORAGE_CHANNEL_CAPABILITY } from "@openbot/contracts/team-protocol/storage-channel-v1";
import { THREAD_MESSAGE_SEARCH_CAPABILITY } from "@openbot/contracts/team-protocol/thread-message-search-v1";
import { VAULT_IMPORT_CAPABILITY } from "@openbot/contracts/team-protocol/vault-import-v1";
import { VAULT_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v2";
import { VAULT_V3_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v3";
import { VAULT_V4_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v4";
import { WEBHOOK_AGENT_SECRET_CAPABILITY } from "@openbot/contracts/team-protocol/webhook-agent-secret-v1";
import { WEBHOOK_SENDER_SECRET_CAPABILITY } from "@openbot/contracts/team-protocol/webhook-sender-secret-v1";
import { WEBHOOK_TESTS_CAPABILITY } from "@openbot/contracts/team-protocol/webhook-tests-v1";
import { WHATSAPP_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/whatsapp-connector-v1";
import { WORKFLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-v1";
import { runTeamEffect } from "@openbot/team-client";
import { channelForThread } from "@openbot/team-client/channel-notifications";
import {
  cancelHostUpdate,
  checkHostForUpdate,
  checkHostRelease,
  clearStorage,
  deleteHostedSite,
  deleteStoredFile,
  getAgentAdminSettings,
  getHostAgentAccess,
  getHostAgentMemoryLimit,
  getHostAuditLog,
  getHostBrowsingMemory,
  getHostCacheExpiryCompaction,
  getHostClaudeCompactWindow,
  getHostMemoryReview,
  getHostModelVisibility,
  getHostPersonality,
  getHostPromptCacheTtl,
  getHostProviderEnvironment,
  getHostReleaseStatus,
  getHostSkillLearning,
  getHostTimezone,
  getHostUpdateStatus,
  getStorageUsage,
  listHostBackgroundProcesses,
  listHostedSites,
  requestHostRestart,
  setHostAgentAccess,
  setHostAgentMemoryLimit,
  setHostBrowsingMemory,
  setHostCacheExpiryCompaction,
  setHostClaudeCompactWindow,
  setHostMemoryReview,
  setHostModelVisibility,
  setHostPersonality,
  setHostPromptCacheTtl,
  setHostProviderEnvironment,
  setHostSkillLearning,
  setHostTimezone,
  setHostUpdateSettings,
  startHostUpdate,
  stopHostBackgroundProcess,
  updateAgentAdminSettings,
} from "@openbot/team-client/team-admin-requests";
import { clearAgentContext, type TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { classifyFailure } from "@openbot/telemetry";
import { toast } from "@openbot/ui";
import type { GlobalSearchRoutine } from "@openbot/ui/components/GlobalSearch";
import type { AgentMessage, ComposerThreadMessageMatch } from "@openbot/ui/data";
import { accountUsageProviderRows } from "@openbot/ui/features/account/account-usage-view";
import { computeAgentAvatarMoods } from "@openbot/ui/features/agents/agent-avatar-mood";
import { createFirstAgentDraft, type FirstAgentDraft } from "@openbot/ui/features/agents/FirstAgentSetup";
import { BillingDialog } from "@openbot/ui/features/billing/BillingDialog";
import { createBillingStore } from "@openbot/ui/features/billing/billing-store";
import { LicenseSection } from "@openbot/ui/features/billing/LicenseSection";
import { createLicenseStore } from "@openbot/ui/features/billing/license-store";
import { unloadedHistory } from "@openbot/ui/features/conversation/ChatScrollRail";
import { MAIN_THREAD_ID } from "@openbot/ui/features/conversation/threads/thread-types";
import { BuyCreditsPage } from "@openbot/ui/features/credits/BuyCreditsPage";
import { CreditActivitySection } from "@openbot/ui/features/credits/CreditActivitySection";
import { CreditsSection } from "@openbot/ui/features/credits/CreditsSection";
import { type CreditsMenu, createCreditsStore, createCreditsSummary } from "@openbot/ui/features/credits/credits-store";
import { LeaveServerDialog } from "@openbot/ui/features/servers/LeaveServerDialog";
import { RestartServerDialog } from "@openbot/ui/features/servers/RestartServerDialog";
import type { ServerActionCallbacks } from "@openbot/ui/features/servers/ServerActionItems";
import {
  ConversationLoadNotice,
  ServerConnectionNotice,
  ServerPanelLoadNotice,
  serverWorkspacePhase,
} from "@openbot/ui/features/servers/ServerConnectionNotice";
import { ServerMenu } from "@openbot/ui/features/servers/ServerMenu";
import { createServerPaywall } from "@openbot/ui/features/servers/ServerPaywall";
import { serverPlanBlocks, serverPlanScreenShown } from "@openbot/ui/features/servers/ServerPlanEnd";
import { ServerRail } from "@openbot/ui/features/servers/ServerRail";
import type { SettingsPagePlacement } from "@openbot/ui/features/settings/SettingsDialogShell";
import { createSettingsHostedServersStore } from "@openbot/ui/features/settings/stores/hosted-servers-store";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import { SidebarCommunityCard } from "@openbot/ui/features/sidebar/SidebarCommunityCard";
import { sidebarAgentOrder } from "@openbot/ui/features/sidebar/sidebar-agent-order";
import {
  computeSidebarAgentStates,
  sidebarAgentWaits,
  sidebarChannelWaits,
} from "@openbot/ui/features/sidebar/sidebar-agent-states";
import { PageRail, type PageRailPage } from "@openbot/ui/features/window/PageRail";
import { useText } from "@openbot/ui/text";
import { Effect } from "effect";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  Loading,
  lazy,
  Match,
  onCleanup,
  onSettled,
  Show,
  Switch,
  untrack,
} from "solid-js";
import { matchesShortcut } from "../../keyboard-shortcut-preference";
import { queuedDeliveriesInOrder } from "../../queue-reconciliation";
import { backgroundWorkKey } from "../conversation/background-work-key";
import "katex/contrib/copy-tex";
import "../../selection-copy";
import { actionToast } from "../../action-toast";
import { desktopAnalytics } from "../../analytics";
import { collectThreadMessageMatches, formatMessageTime, toAgentMessage } from "../../app-message-projection";
import { ProviderSignInDialogs } from "../../components/ProviderSignInDialogs";
import { LayoutProvider, useLayout } from "../../layout";
import {
  AgentUsagePanel,
  CrmScreen,
  ScheduleView,
  ServerLibrary,
  ServerOnboarding,
  ServerSettingsModal,
  TasksView,
  WorkflowsCanvas,
} from "../../lazy-views";
import { PlatformProvider } from "../../platform";
import { deviceSendShortcut } from "../../send-shortcut-preference";
import { startupLoadingScene } from "../../startup-animation-preference";
import { WorkspaceFrame } from "../../WorkspaceFrame";
import {
  ChannelCreateOverlay,
  GlobalSearchOverlay,
  JoinServerOverlay,
  MarketplaceOverlay,
  ServerSettingsOverlay,
  SharedAgentInstallOverlay,
} from "../../WorkspaceOverlayViews";
import { createUsageRefreshPoll } from "../account/usage-refresh-poll";
import { conversationThreads } from "../agent-threads/conversation-threads";
import { sidebarAgentThreads } from "../agent-threads/sidebar-agent-threads";
import type { CreationPreference } from "../agents/agent-creation-model";
import {
  agentErrorDetails,
  claimErrorToast,
  createTurnErrorBanners,
  readableAgentError,
} from "../agents/agent-error-text";
import { agentTakeoverTabIds } from "../agents/agent-thread-attention";
import { withHostAccountUsage, withHostProfileAccount } from "../agents/host-provider-accounts";
import { createRemoteAgentAdmin, updateRemoteAgent } from "../agents/remote-agent-admin";
import type { ServerBrowserProfilesOptions } from "../browser/ServerBrowserProfilesPanel";
import { createBrowserProfilesStore } from "../browser/stores/browser-profiles-store";
import { ChannelErrorNotice } from "../channels/ChannelConversationParts";
import { createChannelConversation } from "../channels/channel-conversation";
import { readChannelSelection, writeChannelSelection } from "../channels/channel-selection";
import { ChannelsControllerProvider } from "../channels/channels-context";
import { createChannelsController } from "../channels/channels-controller";
import { globalSearchChannels } from "../channels/global-search-channels";
import { createConnectorRegistry, createConnectorSet } from "../connectors/connector-registry";
import { hostMessagingApi } from "../connectors/host-messaging-port";
import { hostWhatsAppPort } from "../connectors/whatsapp-connector";
import { Conversation, createConversationController } from "../conversation/Conversation";
import { clearStoredQueueEdit } from "../conversation/composer-draft";
import { ConversationControllerProvider } from "../conversation/conversation-controller-context";
import { composerDraftKey } from "../conversation/conversation-keys";
import type {
  AgentSettingsRequest,
  ConversationThreads,
  PromptAnswerOptions,
} from "../conversation/conversation-types";
import {
  type AgentLevelsSource,
  createAgentMessageDeleteAccess,
  readerCanDeleteMessage,
} from "../conversation/message-delete-access";
import { webEventRoutinesApi } from "../conversation/routine-webhooks-api";
import { trackUsageLimitShown, usageLimitAskFrom } from "../conversation/usage-limit-ask";
import { createCrmEnabled } from "../crm/crm-enabled";
import type { FilesPort } from "../files/files-port";
import { hostSetupProviderProps } from "../onboarding/host-setup-provider-props";
import { createRoutineTimezonePrompt } from "../schedule/routine-timezone-prompt";
import type { ScheduleRoutine } from "../schedule/SchedulePanel";
import { scheduleRoutinePorts } from "../schedule/schedule-routine-create";
import { AddServerOverlay, type AddServerResume } from "../servers/AddServerOverlay";
import { createHostedUpsellOffline, HostedServerUpsell } from "../servers/hosted-server-upsell-controller";
import { mcpSignInRecord } from "../servers/mcp-servers";
import { OwnerTransferPrompt } from "../servers/OwnerTransferPrompt";
import { saveRemoteFrameChannels } from "../servers/remote-workspace-frame";
import type { HostAgentDefaultsCalls } from "../servers/ServerAgentsSection";
import type { HostServerAuditCalls } from "../servers/ServerAuditSection";
import type { HostBrowsingMemoryCalls } from "../servers/ServerBrowsingMemorySetting";
import type { HostMemoryLimitCalls } from "../servers/ServerMemoryLimitSetting";
import type { HostMemoryReviewCalls } from "../servers/ServerMemoryReviewSetting";
import type { OwnerTransferCalls } from "../servers/ServerOwnerTransferSection";
import { ServerPlanReminder } from "../servers/ServerPlanReminder";
import type { HostAgentAccessCalls } from "../servers/ServerRolesSection";
import type { ServerHostedSitesOptions, ServerSettingsSection } from "../servers/ServerSettingsModal";
import type { HostSkillLearningCalls } from "../servers/ServerSkillLearningSetting";
import type { HostTimezoneCalls } from "../servers/ServerTimezoneSetting";
import type { HostTurnLimitsCalls } from "../servers/ServerTurnLimitsSetting";
import type { HostUpdateCalls } from "../servers/ServerUpdatePanel";
import type { HostVoiceModelCalls } from "../servers/ServerVoiceModelSetting";
import {
  remoteAdminServer,
  remoteMcpSignIn,
  remoteUpdateServer,
  serverCanAdminister,
  serverCanManageMcp,
  serverRoleCanAdminister,
  serverRotatesHostKey,
} from "../servers/server-capabilities";
import { createServerConnectionToast } from "../servers/server-connection-toast";
import { type HostPersonalityCalls, loadServerPersonality, serverResponseStyle } from "../servers/server-personality";
import {
  offerServerUpdate,
  ServerUpdateDialogHost,
  serverUpdateBadge,
  showServerUpdate,
} from "../servers/server-update-flow";
import { licenseContactUs, trackLicenseEvent } from "../settings/license-analytics";
import type { HostClaudeCompactWindowCalls } from "../settings/provider-claude-compact-window";
import type { HostClaudeUserSetupCalls } from "../settings/provider-claude-user-setup";
import type { HostProviderEnvironmentCalls } from "../settings/provider-environment";
import type { HostModelVisibilityCalls } from "../settings/provider-model-visibility";
import type { HostPromptCacheTtlCalls } from "../settings/provider-prompt-cache";
import { createCommunityCardVisibility } from "../sidebar/community-card";
import { createSidebarAlertCards, SidebarAlertCards } from "../sidebar/SidebarAlertCards";
import { ServerUpgradeOffer } from "../sidebar/server-upgrade-offer";
import { isReaderAuthor } from "../team/reader-identity";
import type { ServerVaultOptions } from "../vault/ServerVaultPanel";
import { createVaultStore } from "../vault/stores/vault-store";
import { RailHelpMenu } from "../window/RailHelpMenu";
import {
  openFirstSettingsSection,
  PersonalSettingsLink,
  ServerSettingsLink,
  ServerSettingsPageTitle,
  SettingsPageFrame,
  SettingsSearchField,
} from "../window/SettingsPageFrame";
import { WindowBackdrop } from "../window/WindowBackdrop";
import type { SettingsKind, WindowPage } from "../window/window-page-context";
import { useWorkspaceShortcuts } from "../window/workspace-shortcuts";
import { workflowAgentProgress } from "../workflows/workflow-agent-progress";
import { createWorkflowMediaCredits } from "../workflows/workflow-media-credits";
import { WebAgentSettings } from "./WebAgentSettings";
import { WebConnectComputer } from "./WebConnectComputer";
import { WebMobileNavigation, type WebMobilePane } from "./WebMobileNavigation";
import { WebServerOtherTab } from "./WebServerOtherTab";
import { createWebAccountCalls } from "./web-account";
import { createWebAccountUsage } from "./web-account-usage";
import { createWebAgentImportCalls } from "./web-agent-import";
import { createWebAgentThreads } from "./web-agent-threads";
import { createWebAttachmentMedia } from "./web-attachment-media";
import { openWebLink } from "./web-attachments";
import {
  createWebBillingCalls,
  createWebCreditsCalls,
  createWebLicenseCalls,
  createWebReferralCalls,
  type WebAppStart,
} from "./web-billing";
import { webBitwardenConnectorPort } from "./web-bitwarden-connector";
import { createWebChannelsPort } from "./web-channels-runtime";
import { createWebChatHistory, type WebChatHistoryEntry } from "./web-chat-history";
import { createWebWorkspace, type WebRuntimeFactory } from "./web-client-context";
import { createWebConversationRuntime } from "./web-conversation-runtime";
import { createWebConversationView } from "./web-conversation-view";
import { webCrmHost } from "./web-crm";
import { createWebFileSaver } from "./web-file-download";
import { webGitHubConnectorPort } from "./web-github-connector";
import { createWebHostedServers } from "./web-hosted-server-state";
import { createWebInstanceTransferCalls } from "./web-instance-transfer";
import { webMachineCalls } from "./web-machine-calls";
import { createWebAgentTemplateCalls, createWebMarketplaceCalls } from "./web-marketplace";
import { webHostMessaging } from "./web-messaging-connector";
import { createWebServerNotifications } from "./web-notification-preferences";
import { createWebNotificationRouting } from "./web-notification-routing";
import { createWebNotificationSettings } from "./web-notification-settings";
import { requestWebNotificationPermission } from "./web-notifications";
import { webOnePasswordConnectorPort } from "./web-onepassword-connector";
import { webPasswordManagersPort } from "./web-password-managers";
import { createWebProviderSettings, openWebDestination } from "./web-provider-admin";
import type { WebAdminRuntime } from "./web-runtime";
import { webScheduleSource } from "./web-schedule";
import { createWebServerSettings } from "./web-server-settings";
import { webTasksSource } from "./web-tasks";
import { createWebUsageLimits } from "./web-usage-limits";
import { createWebUsagePort } from "./web-usage-port";
import { webVaultCalls } from "./web-vault";
import { webHostWhatsApp } from "./web-whatsapp-connector";
import { webWorkflowHost } from "./web-workflows";

const CONNECTING_STATUS: AgentStatus = {
  phase: "starting",
  cliVersion: null,
  auth: { kind: "unknown" },
  capabilities: { chat: "unavailable", browser: "unavailable", computerUse: "unavailable" },
  message: null,
  fullAccess: true,
};
const WEB_APP_INFO: AppInfo = { name: "OpenBot", version: "web", platform: "darwin", variant: "production" };
const PHONE_QUERY = "(max-width: 720px)";
const QUEUE_EDIT_ACCOUNT_KEY = "openbot.web.queue-edit-account";
const SEARCH_ROUTINE_REQUESTS = 4;
const SIDEBAR_WAIT_MS = 5000;

function newAgentAvatar(): Pick<FirstAgentDraft, "avatarSeed" | "avatarHue" | "avatarColor"> {
  const { avatarSeed, avatarHue } = createFirstAgentDraft();
  return { avatarSeed, avatarHue, avatarColor: null };
}

async function reportedFailure(send: () => Promise<unknown>, options: PromptAnswerOptions | undefined) {
  try {
    await send();
    return true;
  } catch (error) {
    if (!options?.onError) throw error;
    options.onError(error);
    return false;
  }
}

type HostPageView = "usage" | "schedule" | "tasks" | "workflows" | "library" | "crm";

type WebWorkspaceProps = {
  accountId: string;
  accountEmail?: string;
  accountName?: string | null;
  accountAvatarUrl?: string | null;
  accountChatColor?: AvatarColor | null;
  accountFetch: typeof fetch;
  onSessionCheck: () => Promise<void>;
  accountSessionEnded?: () => boolean;
  onLogout: () => Promise<void>;
  createRuntime?: WebRuntimeFactory | undefined;
  agentTemplateId?: string | null;
  onAgentTemplateClose?: () => void;
  inviteUrl?: string | null;
  onInviteClose?: () => void;
  pluginSlug?: string | null;
  onPluginSlugConsumed?: () => void;
  marketplaceListing?: MarketplaceListingLink | null;
  onMarketplaceListingConsumed?: () => void;
  start?: WebAppStart | null;
  onStartConsumed?: () => void;
  billingReturn?: boolean;
  onBillingReturnConsumed?: () => void;
  hostingReturn?: AddServerResume | null;
  onHostingReturnConsumed?: () => void;
  language: AppLanguage;
  onChangeLanguage: (language: AppLanguage) => void;
  appearance: AppAppearance;
  onChangeAppearance: (appearance: AppAppearance) => void;
};

const WebAccountSettings = lazy(() => import("./WebAccountSettings"));

export function WebWorkspace(props: WebWorkspaceProps) {
  return (
    <PlatformProvider appInfo={WEB_APP_INFO}>
      <LayoutProvider>
        <WebWorkspaceFrame {...props} />
      </LayoutProvider>
    </PlatformProvider>
  );
}

function WebWorkspaceFrame(props: WebWorkspaceProps) {
  const text = useText();
  const { t, sourceText } = text;
  const layout = useLayout();
  const [status, setStatus] = createSignal<AgentStatus>(CONNECTING_STATUS);
  const [models, setModels] = createSignal<ClientAgentModelOption[]>([]);
  let modelsRequest = 0;
  let modelsShown = 0;
  function showModels(request: number, list: ClientAgentModelOption[]): void {
    if (request <= modelsShown) return;
    modelsShown = request;
    setModels(list);
  }
  const workspace = createWebWorkspace(props, {
    onStatus: (next) => {
      setStatus(next);
      if (next.phase !== "ready") return;
      const request = ++modelsRequest;
      workspace.runtime.models().then(
        (list) => showModels(request, list),
        () => undefined,
      );
    },
  });
  const notifications = createWebServerNotifications(props.accountId);
  try {
    if (window.localStorage.getItem(QUEUE_EDIT_ACCOUNT_KEY) !== props.accountId) clearStoredQueueEdit();
    window.localStorage.setItem(QUEUE_EDIT_ACCOUNT_KEY, props.accountId);
  } catch {
    clearStoredQueueEdit();
  }
  function setTyping(agentId: string, typing: boolean): void {
    workspace.runtime.setTyping(typing ? agentId : null, typing);
  }
  const controller = createConversationController({ onTypingChange: setTyping });
  async function signOut() {
    const agentId = controller.editingAgentId();
    const deliveryId = controller.editingDeliveryId();
    const editId = controller.editingEditId();
    if (
      agentId &&
      deliveryId &&
      editId &&
      workspace.state.status === "online" &&
      controller.editingServerId() === workspace.state.host?.hostId
    ) {
      try {
        await workspace.runtime.editQueue({ agentId, action: "cancel", deliveryId, editId });
        controller.setEditingEditId(null);
        clearStoredQueueEdit();
      } catch {}
    }
    await props.onLogout();
  }
  const noHost = () => !workspace.state.host && (workspace.state.hostsLoaded || Boolean(workspace.state.hostsError));
  const hostOffline = () => !noHost() && !workspace.state.workspaceLoaded;
  const conversationConnecting = () =>
    !workspace.state.hostedSleep &&
    (workspace.state.status === "connecting" ||
      (workspace.state.status === "online" &&
        Boolean(workspace.conversation()) &&
        !workspace.conversation()?.page &&
        !workspace.conversation()?.error));
  const hostUpdating = () => workspace.state.hostRestart?.state === "restarting";
  createServerConnectionToast(() => {
    const host = workspace.state.host;
    return host
      ? {
          id: host.hostId,
          name: host.name,
          ready: workspace.state.status === "online",
          quiet: Boolean(
            !workspace.state.workspaceLoaded ||
              workspace.state.otherTab ||
              workspace.state.hostedSleep ||
              workspace.state.hostRestart?.state === "restarting" ||
              workspace.state.incompatibility,
          ),
        }
      : null;
  });
  let resetRevocation = workspace.state.revocationRevision;
  createEffect(
    () => ({ host: workspace.state.host?.hostId, revocation: workspace.state.revocationRevision }),
    ({ revocation }) => {
      const revoked = revocation !== resetRevocation;
      resetRevocation = revocation;
      controller.setComposerErrors({});
      controller.setConversationErrors({});
      controller.setChannelDrafts({});
      controller.setThreadDrafts({});
      const editAgentId = untrack(controller.editingAgentId);
      const editServerId = untrack(controller.editingServerId);
      if (!revoked && editAgentId && editServerId) {
        const key = composerDraftKey({ agentId: editAgentId, serverId: editServerId });
        controller.setDrafts((drafts) => (drafts[key] ? { [key]: drafts[key] } : {}));
        return;
      }
      clearStoredQueueEdit();
      controller.setDrafts({});
      controller.setEditingDraftBackup(null);
      controller.setEditingOriginalAttachmentIds([]);
      controller.setEditingPendingSave(null);
      controller.setEditingAgentId(null);
      controller.setEditingServerId(null);
      controller.setEditingEditId(null);
      controller.setEditingDeliveryId(null);
    },
  );
  const [joinOpen, setJoinOpen] = createSignal(false);
  const hostedServers = createWebHostedServers({
    accountFetch: props.accountFetch,
    hosts: () => workspace.state.hosts,
    hostingReturn: () => props.hostingReturn,
    onHostingReturnConsumed: () => props.onHostingReturnConsumed?.(),
    onJoin: () => setJoinOpen(true),
  });
  const [creating, setCreating] = createSignal(false);
  const [agentAvatar, setAgentAvatar] = createSignal(newAgentAvatar());
  const [mobilePane, setMobilePane] = createSignal<WebMobilePane>("conversation");
  const [settingsRequest, setSettingsRequest] = createSignal<AgentSettingsRequest | null>(null);
  const account = createMemo(() => ({
    id: props.accountId,
    email: props.accountEmail ?? "",
    name: props.accountName ?? null,
    avatarUrl: props.accountAvatarUrl ?? null,
    chatColor: props.accountChatColor ?? null,
  }));
  const accountCalls = createWebAccountCalls(props.accountFetch, props.onSessionCheck);
  const [accountSettingsOpen, setAccountSettingsOpen] = createSignal(false);
  const [accountSettingsLoaded, setAccountSettingsLoaded] = createSignal(false);
  const [serverSettingsLoaded, setServerSettingsLoaded] = createSignal(false);
  const usageReading = createWebAccountUsage({
    workspace,
    status,
    t,
  });
  function hostState(hostId: string): ServerConnectionState {
    if (hostId === workspace.state.host?.hostId && !workspace.state.otherTab) return workspace.state.status;
    const state = workspace.state.hostStates[hostId];
    if (!workspace.runtime.hosts) return "offline";
    return !state || state === "unknown" ? "connecting" : state;
  }
  const servers = createMemo<ServerSummary[]>(() =>
    workspace.orderedHosts().map((host) => {
      const active = host.hostId === workspace.state.host?.hostId;
      const incompatibility =
        active && workspace.state.incompatibility?.hostId === host.hostId ? workspace.state.incompatibility : null;
      const notice = notifications.state(host.hostId);
      const connected = active ? workspace.state.host : null;
      const appearance = connected?.appearance !== undefined ? connected.appearance : host.appearance;
      return {
        id: host.hostId,
        name: host.name,
        kind: "remote",
        role: host.role,
        apiUrl: null,
        logoUrl: host.logoKey
          ? `/api/browser/v2/remote/hosts/${encodeURIComponent(host.hostId)}/logo?v=${encodeURIComponent(host.logoKey)}`
          : null,
        active,
        state: incompatibility ? "incompatible" : hostState(host.hostId),
        hostedSleep: active ? workspace.state.hostedSleep : null,
        hostedIssue: active ? workspace.state.hostedIssue : null,
        hostedStart: active ? workspace.state.hostedStart : null,
        notificationsMuted: notice.muted,
        notificationsMutedUntil: notice.mutedUntil,
        notificationLevel: notice.level,
        remoteDesktopAvailable: false,
        ...(appearance === undefined ? {} : { appearance }),
        ...(host.memberLimit === undefined ? {} : { memberLimit: host.memberLimit }),
        ...(host.hosted === undefined ? {} : { hosted: host.hosted }),
        ...(host.restartAvailable === undefined ? {} : { restartAvailable: host.restartAvailable }),
        ...(host.storageGb === undefined ? {} : { storageGb: host.storageGb }),
        ...(host.paymentRequired ? { paymentRequired: host.paymentRequired } : {}),
        ...(host.customPlan ? { customPlan: host.customPlan } : {}),
        compatibility: {
          localAppVersion: "web",
          hostAppVersion: incompatibility?.hostAppVersion ?? null,
          localProtocol: { minimum: 3, maximum: 3 },
          hostProtocol: incompatibility?.hostProtocol ?? null,
          negotiatedProtocol: incompatibility ? null : 3,
          capabilities: workspace.state.capabilities,
        },
        issue: incompatibility
          ? { code: incompatibility.code, message: incompatibility.message, retryable: true }
          : null,
      };
    }),
  );
  const server = createMemo(() => servers().find((item) => item.active));
  const paywall = createServerPaywall({
    server,
    subscribe: (request) => hostedServers.calls.openCustomCheckout(request),
    billingDetails: createWebBillingCalls(props.accountFetch),
    errorMessage: (error) => text.errorMessage(error, t("server.paywall.checkoutFailed")),
  });
  const blockedServer = createMemo(() => {
    const paywallServer = paywall.server();
    if (paywallServer) return paywallServer;
    const current = server();
    if (!current) return null;
    return current.state === "incompatible" || serverPlanBlocks(current, hostedServers.planDeletesAt(current.id))
      ? current
      : null;
  });
  const planScreenShown = () => serverPlanScreenShown(blockedServer(), hostedServers.planDeletesAt);
  createEffect(
    () =>
      hostedServers.loaded() &&
      servers().some((item) => item.hostedIssue === "plan_ended" && hostedServers.planDeletesAt(item.id) === null),
    (dateMissing) => {
      if (dateMissing) void hostedServers.refresh();
    },
  );
  const connectionShown = () => !noHost() && workspace.state.status !== "online" && !blockedServer();
  const frameFirstLoad = () =>
    workspace.state.workspaceLoaded &&
    !workspace.state.synced &&
    !workspace.state.hostOffline &&
    !workspace.state.connectionError;
  const connectionPhase = () =>
    serverWorkspacePhase({
      hostedSleep: workspace.state.hostedSleep,
      updating: hostUpdating(),
      blocked: workspace.state.recovery?.phase === "suspended",
      // Signal holds the attempt of a host that is offline. As on desktop, that is not a load: the notice
      // shows the connect step, not "Loading" with Connect done.
      loading: workspace.state.status === "connecting" && !workspace.state.hostOffline,
      hasContent: workspace.state.workspaceLoaded && !frameFirstLoad(),
    });
  const [pageLoad, setPageLoad] = createSignal(true);
  const fullWindowLoading = () =>
    (connectionShown() &&
      (!workspace.state.workspaceLoaded || pageLoad()) &&
      !workspace.state.hostOffline &&
      !(workspace.state.status === "offline" && workspace.state.connectionError) &&
      (connectionPhase() === "loading" || connectionPhase() === "connecting")) ||
    (pageLoad() && workspace.state.status === "online" && sidebarLoading());
  createEffect(fullWindowLoading, (loading) => {
    if (!loading) setPageLoad(false);
  });
  const [loadingCover, setLoadingCover] = createSignal<boolean>(untrack(fullWindowLoading));
  const [loadingWaitedLong, setLoadingWaitedLong] = createSignal(false);
  createEffect(
    () => fullWindowLoading() && !loadingCover(),
    (show) => {
      if (show) setLoadingCover(true);
    },
  );
  const phoneQuery = window.matchMedia?.(PHONE_QUERY);
  const [phone, setPhone] = createSignal(phoneQuery?.matches ?? false);
  onSettled(() => {
    const update = (event: MediaQueryListEvent) => setPhone(event.matches);
    phoneQuery?.addEventListener("change", update);
    return () => phoneQuery?.removeEventListener("change", update);
  });
  const compact = () => !phone() && layout.leftPanelCompact();
  const closeSidebar = () => layout.setSidebarClosed(true);
  const collapseSidebar = () => (phone() ? undefined : closeSidebar);
  const [marketplaceOpen, setMarketplaceOpen] = createSignal(false);
  const [creditsOpen, setCreditsOpen] = createSignal<{ serverId: string | null } | null>(null);
  const [hostPage, setHostPage] = createSignal<{ view: HostPageView; trigger: HTMLElement | null } | null>(null);
  const [crmConnectorsRequest, setCrmConnectorsRequest] = createSignal<string>();
  function canOfferServerPlans(): boolean {
    return (
      hostedServers.available() && hostedServers.loaded() && server()?.role === "owner" && server()?.hosted !== true
    );
  }
  function openServerPlans(): void {
    serverSettings.setOpen(false);
    hostedServers.openAddServer("upsell");
  }
  async function openHostPage(serverId: string, view: HostPageView, trigger: HTMLElement | null) {
    if (server()?.id !== serverId) {
      const host = workspace.state.hosts.find((item) => item.hostId === serverId);
      if (!host) return;
      chatHistory.userOpensServer(serverId);
      await workspace.connect(host);
      if (server()?.id !== serverId) return;
    }
    setMobilePane("conversation");
    setAccountSettingsOpen(false);
    serverSettings.setOpen(false);
    setMarketplaceOpen(false);
    setHostPage({ view, trigger });
  }
  function closeHostPage() {
    const trigger = hostPage()?.trigger;
    setHostPage(null);
    setCrmConnectorsRequest(undefined);
    queueMicrotask(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  }
  const usageCalls = createWebUsagePort(workspace, hostRequest, servers);
  async function openNotified(hostId: string, agentId: string) {
    setMobilePane("conversation");
    if (hostId !== workspace.state.host?.hostId) {
      const host = workspace.state.hosts.find((item) => item.hostId === hostId);
      if (!host) return;
      chatHistory.userOpens({ hostId, kind: "agent", id: agentId });
      await workspace.connect(host);
    }
    if (workspace.state.host?.hostId === hostId && workspace.state.agents.some((agent) => agent.id === agentId))
      await select(agentId);
  }
  async function openNotifiedChannel(hostId: string, channelId: string) {
    setMobilePane("conversation");
    chatHistory.userOpens({ hostId, kind: "channel", id: channelId });
    if (hostId !== workspace.state.host?.hostId) {
      const host = workspace.state.hosts.find((item) => item.hostId === hostId);
      if (!host) return;
      await workspace.connect(host);
    }
    if (workspace.state.host?.hostId === hostId) await channels.open(channelId);
  }
  const hiddenAgentIds = createMemo(() => new Set(workspace.state.userHiddenAgents.map((entry) => entry.agentId)));
  const noAgentIds: ReadonlySet<string> = new Set();
  const hiddenAgentsWork = () => workspace.state.capabilities.includes(AGENT_HIDDEN_WORK_CAPABILITY);
  const {
    setMuted,
    setNotificationLevel,
    notifyChannelReplies,
    refreshLevels,
    applyLevels: applyAgentLevels,
    mutedAgentIds,
  } = createWebNotificationRouting({
    workspace,
    notifications,
    t,
    onOpen: (hostId, agentId) => void openNotified(hostId, agentId),
    onOpenChannel: (hostId, channelId) => void openNotifiedChannel(hostId, channelId),
    channelForThread: (hostId, threadId) =>
      hostId === workspace.state.host?.hostId
        ? channelForThread(
            untrack(() => channels.state.channels),
            threadId,
          )
        : null,
    readAgentLevels: workspace.runtime.listAgentNotificationLevels,
    hiddenAgentIds: (hostId) =>
      hostId === workspace.state.host?.hostId && hiddenAgentsWork() ? hiddenAgentIds() : noAgentIds,
  });
  const onlineHostIds = createMemo(() =>
    servers()
      .filter((server) => server.state === "online")
      .map((server) => server.id)
      .join("\n"),
  );
  createEffect(onlineHostIds, (ids, previous) => {
    const before = new Set(previous ? previous.split("\n") : []);
    for (const hostId of ids ? ids.split("\n") : []) if (!before.has(hostId)) refreshLevels(hostId);
  });
  const notificationSettings = createWebNotificationSettings({
    visible: accountSettingsOpen,
    servers,
    runtime: workspace.runtime,
    notifications,
    setLocalLevel: setNotificationLevel,
    setMuted,
    onLevelsWritten: applyAgentLevels,
    openHostId: () => server()?.id ?? null,
  });
  const [notificationFocusRequest, setNotificationFocusRequest] = createSignal<{
    serverId: string;
    nonce: number;
  } | null>(null);
  let notificationFocusNonce = 0;
  const [keyboardFocusRequest, setKeyboardFocusRequest] = createSignal<number | null>(null);
  let keyboardFocusNonce = 0;
  createEffect(accountSettingsOpen, (open) => {
    if (open) return;
    setNotificationFocusRequest(null);
    setKeyboardFocusRequest(null);
  });
  function openNotificationSettings(serverId: string): void {
    setNotificationFocusRequest({ serverId, nonce: ++notificationFocusNonce });
    openAccountSettings();
  }
  const [searchOpen, setSearchOpen] = createSignal(false);
  const pausedAgentIds = createMemo(() => (hiddenAgentsWork() ? noAgentIds : hiddenAgentIds()));
  const searchAgents = createMemo(() =>
    sidebarAgentOrder(workspace.profiles(), {
      layout: workspace.state.sidebarLayout,
      pinnedItems: workspace.preferences.pinnedSidebarItems(),
      hiddenAgentIds: hiddenAgentIds(),
    }),
  );
  const communityCard = createCommunityCardVisibility();
  const [messageFocusRequest, setMessageFocusRequest] = createSignal<{
    agentId: string;
    messageId: string;
    nonce: number;
  } | null>(null);
  onSettled(() => {
    const toggleSearch = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, "globalSearch")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setSearchOpen((open) => !open);
    };
    window.addEventListener("keydown", toggleSearch);
    return () => window.removeEventListener("keydown", toggleSearch);
  });
  const searchHitThreads = new Map<string, string>();
  const searchHitKey = (agentId: string, messageId: string) => `${agentId}\n${messageId}`;
  async function searchAllMessages(query: string, cursor?: string) {
    if (workspace.state.status !== "online") return { results: [], nextCursor: null };
    const page = await workspace.runtime.search(undefined, query, cursor, true);
    if (cursor === undefined) searchHitThreads.clear();
    for (const result of page.results) {
      if (result.taskId) searchHitThreads.set(searchHitKey(result.agentId, result.message.id), result.taskId);
    }
    return {
      results: page.results.map((result) => ({
        agentId: result.agentId,
        message: toAgentMessage(result.message, result.agentId),
      })),
      total: page.total,
      nextCursor: page.nextCursor,
    };
  }
  async function searchAllFiles(query: string, cursor?: string) {
    const searchFiles = workspace.runtime.searchFiles;
    if (workspace.state.status !== "online" || !searchFiles) return { results: [], nextCursor: null };
    const page = await searchFiles(query, cursor);
    return {
      results: page.results.map((result) => ({
        id: result.attachment.id,
        name: result.attachment.name,
        agentId: result.agentId,
        messageId: result.messageId,
        time: formatMessageTime(result.createdAt),
      })),
      nextCursor: page.nextCursor,
    };
  }
  function fileSearch() {
    return workspace.state.capabilities.includes(CONVERSATION_FILE_SEARCH_CAPABILITY) ? searchAllFiles : undefined;
  }
  function searchAgentThreadMessages(query: string): Promise<ComposerThreadMessageMatch[]> {
    const id = workspace.state.selectedId;
    if (!id || workspace.state.status !== "online") return Promise.resolve([]);
    return collectThreadMessageMatches((cursor) => workspace.runtime.search(id, query, cursor, true));
  }
  function threadSearch() {
    return workspace.state.capabilities.includes(THREAD_MESSAGE_SEARCH_CAPABILITY)
      ? searchAgentThreadMessages
      : undefined;
  }
  function openSearchHit(agentId: string, messageId: string) {
    const taskId = searchHitThreads.get(searchHitKey(agentId, messageId));
    if (!taskId) {
      void openMessage(agentId, messageId);
      return;
    }
    agentThreads()?.tabs.open(agentId, taskId);
    setMobilePane("conversation");
    void select(agentId);
  }
  async function openMessage(agentId: string, messageId: string) {
    setMobilePane("conversation");
    await workspace.run(async () => {
      await select(agentId);
      if (workspace.state.selectedId !== agentId) return;
      await openSelectedMessage(agentId, messageId);
    });
  }
  async function openSelectedMessage(agentId: string, messageId: string): Promise<boolean> {
    if (workspace.state.selectedId !== agentId) return false;
    const found = await workspace.openSearchMessage(messageId);
    if (found) setMessageFocusRequest({ agentId, messageId, nonce: Date.now() });
    return found;
  }
  function hostAdmin(serverId?: string): WebAdminRuntime {
    const admin = workspace.runtime.admin;
    const current = untrack(server);
    if (!admin || !current || (serverId !== undefined && serverId !== current.id))
      throw new Error(t("webClient.error.connectServerFirst"));
    return admin;
  }
  function hostRequest(serverId?: string): TeamApiRequest {
    return hostAdmin(serverId).request;
  }
  const eventsEnabled = () =>
    workspace.state.capabilities.includes(EVENTS_CAPABILITY) && canAdministerServer(workspace.state.host?.role);
  const routineRecoveryEnabled = () =>
    eventsEnabled() && workspace.state.capabilities.includes(ROUTINE_RECOVERY_CAPABILITY);
  const webhookTestsEnabled = () => eventsEnabled() && workspace.state.capabilities.includes(WEBHOOK_TESTS_CAPABILITY);
  const webhookSenderSecretEnabled = () =>
    eventsEnabled() && workspace.state.capabilities.includes(WEBHOOK_SENDER_SECRET_CAPABILITY);
  const webhookAgentSecretEnabled = () =>
    eventsEnabled() && workspace.state.capabilities.includes(WEBHOOK_AGENT_SECRET_CAPABILITY);
  const routinesOnceEnabled = () => workspace.state.capabilities.includes(ROUTINES_ONCE_CAPABILITY);
  const providerAdmin = createWebProviderSettings({
    server: () => (workspace.runtime.admin ? server() : undefined),
    request: hostRequest,
    status,
    setStatus,
    readStatus: () => workspace.runtime.status(),
    browser: workspace.runtime.browser,
    agents: () => workspace.profiles(),
  });
  const providerSettings = providerAdmin.settings;
  const liveVoiceAccount = () => {
    const choose = providerSettings()?.accountActions?.setLiveVoiceAccount;
    const codex = providerAdmin.status().providers?.find((row) => row.id === "codex");
    if (!choose || !codex?.accounts) return undefined;
    return {
      accounts: codex.accounts,
      accountId: codex.liveVoiceAccount ?? null,
      defaultUsesKey: codex.apiKeyInUse === true,
      choose,
    };
  };
  const accountUsage = () => withHostAccountUsage(usageReading.accountUsage(), providerAdmin.hostAccounts.limits());
  const agentAccountChoice = createMemo(
    () => workspace.runtime.admin !== undefined && serverCanAdminister(server(), PROVIDER_ACCOUNTS_CAPABILITY),
  );
  function agentAccountUsage() {
    return agentAccountChoice() ? accountUsage() : undefined;
  }
  const usageRows = createMemo(() => accountUsageProviderRows(accountUsage(), providerAdmin.status().providers, text));
  createUsageRefreshPoll({
    target: () => (usageReading.usageReady() ? usageReading.usageTargetKey() : null),
    refreshAtStart: false,
    refresh: () => {
      void providerAdmin.hostAccounts.refreshUsage().catch(() => undefined);
      void usageReading.refreshUsage().catch(() => undefined);
    },
  });
  const connectFromComposer = (provider: AgentProviderId) =>
    providerSettings()?.connection?.connect(provider, "composer");
  const composerSignIn = () => {
    const provider = conversationAgent()?.provider;
    return (
      provider !== undefined &&
      isKnownAgentProvider(provider) &&
      (providerSettings()?.connection?.connectKind(provider) ?? null) !== null
    );
  };
  const runtime = createWebConversationRuntime(
    workspace.runtime,
    () => workspace.state.host?.hostId ?? "",
    workspace.runtime.admin ? () => hostRequest() : undefined,
    workspace.onHostEvent,
    eventsEnabled,
    () =>
      workspace.state.capabilities.includes("agent-session-settings-v1") &&
      canAdministerServer(workspace.state.host?.role),
    () =>
      workspace.state.capabilities.includes(SIGN_IN_RELAY_CAPABILITY) &&
      canAdministerServer(workspace.state.host?.role),
    routineRecoveryEnabled,
    () => workspace.state.capabilities.includes(SIDE_QUESTION_CAPABILITY),
    webhookTestsEnabled,
    () => workspace.state.capabilities.includes(BROWSER_PROFILES_CAPABILITY),
    webhookSenderSecretEnabled,
    () => workspace.state.capabilities.includes(BROWSER_PROXIES_CAPABILITY),
    () => workspace.state.capabilities.includes(ROUTINE_RUN_PLACE_CAPABILITY),
    () => workspace.state.capabilities.includes(SKILL_LEARNING_CAPABILITY),
    (capability) => workspace.state.capabilities.includes(capability),
    (capability) =>
      workspace.state.capabilities.includes(capability) && canAdministerServer(workspace.state.host?.role),
    () => storageCalls,
    () => marketplaceCalls.skills,
  );
  const [searchRoutineList, setSearchRoutineList] = createSignal<GlobalSearchRoutine[]>([]);
  const [searchRoutinesLoading, setSearchRoutinesLoading] = createSignal(false);
  let searchRoutinesRequest = 0;
  createEffect(
    () => searchOpen() && workspace.state.status === "online" && runtime.routines !== undefined,
    (load) => {
      const request = ++searchRoutinesRequest;
      const api = runtime.routines;
      if (!load || !api) {
        setSearchRoutinesLoading(false);
        return;
      }
      setSearchRoutinesLoading(true);
      const agents = untrack(searchAgents);
      const names = new Map(agents.map((agent) => [agent.id, agent.name]));
      void Effect.runPromise(
        Effect.forEach(agents, (agent) => Effect.promise(() => api.listRoutines(agent.id).catch(() => [])), {
          concurrency: SEARCH_ROUTINE_REQUESTS,
        }),
      ).then((lists) => {
        if (request !== searchRoutinesRequest) return;
        setSearchRoutineList(() =>
          lists.flat().map((routine) => ({
            id: routine.id,
            name: routine.name,
            agentId: routine.agentId,
            detail: names.get(routine.agentId) ?? "",
          })),
        );
        setSearchRoutinesLoading(false);
      });
    },
  );
  const searchRoutines = (): GlobalSearchRoutine[] | undefined => (runtime.routines ? searchRoutineList() : undefined);
  function selectSearchRoutine(routine: GlobalSearchRoutine): void {
    const agentId = routine.agentId;
    if (!agentId) return;
    setMobilePane("conversation");
    void select(agentId);
    setSettingsRequest({ agentId, nonce: Date.now(), routine: { routineId: routine.id, name: routine.name } });
  }
  const remoteAgentAdmin = createRemoteAgentAdmin(
    () => {
      const current = server();
      const agent = workspace.selected();
      return current && agent ? { server: current, agentId: agent.id, updatedAt: agent.updatedAt ?? null } : null;
    },
    () => ({
      getAgentHostSettings: (agentId, serverId) =>
        hostRequest(serverId)("POST", AGENT_HOST_SETTINGS_ROUTES.settings, decodeAgentHostSettings, { agentId }),
      updateAgentHostSettings: (input, serverId) =>
        hostRequest(serverId)("POST", AGENT_HOST_SETTINGS_ROUTES.update, decodeAgentHostSettings, { ...input }),
      getAgentBackupModels: (agentId, serverId) =>
        hostRequest(serverId)("POST", AGENT_BACKUP_MODELS_ROUTES.settings, decodeAgentBackupModelSettings, {
          agentId,
        }),
      updateAgentBackupModels: ({ agentId, backupModels }, serverId) =>
        hostRequest(serverId)("POST", AGENT_BACKUP_MODELS_ROUTES.update, decodeAgentBackupModelSettings, {
          agentId,
          backupModels: backupModels && {
            automatic: backupModels.automatic,
            order: backupModels.order.map(({ provider, model, providerAccountId }) => {
              const choice: Record<string, string> = { provider, model };
              if (providerAccountId !== undefined) choice.providerAccountId = providerAccountId;
              return choice;
            }),
          },
        }),
      getAgentNewChat: (agentId, serverId) =>
        hostRequest(serverId)("POST", AGENT_NEW_CHAT_ROUTES.settings, decodeAgentNewChatSettings, { agentId }),
      updateAgentNewChat: ({ agentId, allowNewChat }, serverId) =>
        hostRequest(serverId)("POST", AGENT_NEW_CHAT_ROUTES.update, decodeAgentNewChatSettings, {
          agentId,
          allowNewChat,
        }),
      getAgentPlanCard: (agentId, serverId) =>
        hostRequest(serverId)("POST", AGENT_PLAN_CARD_ROUTES.settings, decodeAgentPlanCardSettings, { agentId }),
      updateAgentPlanCard: ({ agentId, quickAcknowledgement }, serverId) =>
        hostRequest(serverId)("POST", AGENT_PLAN_CARD_ROUTES.update, decodeAgentPlanCardSettings, {
          agentId,
          quickAcknowledgement,
        }),
      getAgentBuiltinMemory: (agentId, serverId) =>
        hostRequest(serverId)("POST", AGENT_BUILTIN_MEMORY_ROUTES.settings, decodeAgentBuiltinMemorySettings, {
          agentId,
        }),
      updateAgentBuiltinMemory: ({ agentId, memory }, serverId) =>
        hostRequest(serverId)("POST", AGENT_BUILTIN_MEMORY_ROUTES.update, decodeAgentBuiltinMemorySettings, {
          agentId,
          memory,
        }),
      getAgentFastMode: async (agentId, serverId) =>
        workspace.state.capabilities.includes(AGENT_SPEED_CAPABILITY)
          ? agentFastModeSettings(
              await hostRequest(serverId)("POST", AGENT_SPEED_ROUTES.settings, decodeAgentSpeedSettings, { agentId }),
            )
          : hostRequest(serverId)("POST", AGENT_FAST_MODE_ROUTES.settings, decodeAgentFastModeSettings, { agentId }),
      updateAgentFastMode: async ({ agentId, fastMode, ultrafast }, serverId) => {
        if (workspace.state.capabilities.includes(AGENT_SPEED_CAPABILITY))
          return agentFastModeSettings(
            await hostRequest(serverId)("POST", AGENT_SPEED_ROUTES.update, decodeAgentSpeedSettings, {
              agentId,
              speed: fastMode ? (ultrafast ? "ultrafast" : "fast") : "standard",
            }),
          );
        if (ultrafast) throw new Error(t("error.agent.settingsLocalOnly"));
        return hostRequest(serverId)("POST", AGENT_FAST_MODE_ROUTES.update, decodeAgentFastModeSettings, {
          agentId,
          fastMode,
        });
      },
      getAgentAdminSettings: (agentId, serverId) =>
        runTeamEffect(
          getAgentAdminSettings(hostRequest(serverId), agentId).pipe(Effect.mapError((error) => error.cause)),
        ),
      updateAgentAdminSettings: (input, serverId) =>
        runTeamEffect(
          updateAgentAdminSettings(hostRequest(serverId), input).pipe(Effect.mapError((error) => error.cause)),
        ),
    }),
  );
  const conversationAgent = createMemo(() => {
    const selected = workspace.selected();
    const host = providerAdmin.hostAccounts.host();
    const agent = selected && host ? withHostProfileAccount(selected, host) : selected;
    const settings = remoteAgentAdmin.settings();
    const automation = remoteAgentAdmin.automation();
    const busyMessageMode = remoteAgentAdmin.busyMessageMode();
    const backupModels = remoteAgentAdmin.backupModels();
    const usageLimitReturn = remoteAgentAdmin.usageLimitReturn();
    const quickAcknowledgement = remoteAgentAdmin.quickAcknowledgement();
    const memory = remoteAgentAdmin.memory();
    const fastMode = remoteAgentAdmin.fastMode();
    const ultrafast = remoteAgentAdmin.ultrafast();
    const computerUse = remoteAgentAdmin.computerUse();
    const allowNewChat = remoteAgentAdmin.allowNewChat();
    return agent
      ? {
          ...agent,
          ...(settings ? { access: settings.access } : {}),
          ...(automation === undefined ? {} : { allowAutomation: automation }),
          ...(busyMessageMode ? { busyMessageMode } : {}),
          ...(backupModels ? { backupModels } : {}),
          ...(usageLimitReturn ? { usageLimitReturn } : {}),
          ...(quickAcknowledgement === undefined ? {} : { quickAcknowledgement }),
          ...(memory === undefined ? {} : { memory }),
          ...(typeof fastMode === "boolean" ? { fastMode, ultrafast } : {}),
          ...(computerUse === undefined ? {} : { computerUse }),
          ...(allowNewChat === undefined ? {} : { allowNewChat }),
        }
      : agent;
  });
  const serverSettings = createWebServerSettings({
    server,
    admin: () => workspace.runtime.admin,
    presence: () => workspace.state.presence,
    refreshHosts: () => workspace.refreshHosts(),
    setAppearance: (hostId, appearance) => workspace.setHostAppearance(hostId, appearance),
  });
  function rotateHostKeyAction() {
    return serverRotatesHostKey(server()) ? serverSettings.rotateHostKey : undefined;
  }
  const page = createMemo<WindowPage>(() => {
    if (serverSettings.state.open && server()) return "server-settings";
    if (accountSettingsOpen()) return "settings";
    if (marketplaceOpen()) return "marketplace";
    const host = hostPage();
    if (host && server() && !blockedServer()) return host.view;
    return creditsOpen() ? "credits" : "agents";
  });
  createEffect(
    () => Boolean(serverSettings.state.open || accountSettingsOpen() || marketplaceOpen() || hostPage()),
    (otherPage) => {
      if (otherPage) setCreditsOpen(null);
    },
  );
  const pageCovered = () => page() !== "agents";
  const tasksOpen = () => page() === "tasks";
  function showAgents() {
    setAccountSettingsOpen(false);
    serverSettings.setOpen(false);
    setMarketplaceOpen(false);
    setHostPage(null);
    setCreditsOpen(null);
  }
  function openCredits(serverId: string | null) {
    setMobilePane("conversation");
    setAccountSettingsOpen(false);
    serverSettings.setOpen(false);
    setMarketplaceOpen(false);
    setHostPage(null);
    setCreditsOpen({ serverId });
  }
  function openMarketplace() {
    setMobilePane("conversation");
    setAccountSettingsOpen(false);
    serverSettings.setOpen(false);
    setHostPage(null);
    setMarketplaceOpen(true);
  }
  function openAccountSettings() {
    setMobilePane("conversation");
    setHostPage(null);
    setMarketplaceOpen(false);
    serverSettings.setOpen(false);
    setAccountSettingsLoaded(true);
    setAccountSettingsOpen(true);
  }
  createEffect(
    () => workspace.state.status === "online",
    (online) => {
      if (!online) return;
      void WebAccountSettings.preload();
      void ServerSettingsModal.preload();
    },
  );
  const [settingsMounts, setSettingsMounts] = createSignal<SettingsPagePlacement | undefined>();
  const [serverSettingsQuery, setServerSettingsQuery] = createSignal("");
  const [openFirstServerSectionRequest, setOpenFirstServerSectionRequest] = createSignal(0);
  function settingsPlacement(kind: SettingsKind): SettingsPagePlacement | undefined {
    const mounts = settingsMounts();
    if (!mounts || page() !== (kind === "personal" ? "settings" : "server-settings")) return undefined;
    return mounts;
  }
  const scheduleSource = webScheduleSource(workspace, hostRequest);
  const tasksSource = webTasksSource(workspace, hostRequest);
  const tasksSupported = () => workspace.state.capabilities.includes(AGENT_TASKS_CAPABILITY);
  createEffect(
    () => tasksOpen() && workspace.state.status === "online" && !tasksSupported(),
    (unsupported) => {
      if (unsupported) setHostPage(null);
    },
  );
  const marketplaceCalls = createWebMarketplaceCalls(props.accountFetch, hostRequest, {
    canAdminister: () => serverRoleCanAdminister(server()),
    hostTab: () =>
      workspace.state.capabilities.includes(MCP_SIGN_IN_CAPABILITY) &&
      workspace.state.capabilities.includes(TEAM_BROWSER_VIEW_CAPABILITY),
  });
  const connectorTarget = createMemo(() => remoteAdminServer(server(), CONNECTORS_CAPABILITY));
  const githubPort = webGitHubConnectorPort(() => hostRequest());
  const workflowsSupported = () => workspace.state.capabilities.includes(WORKFLOWS_CAPABILITY);
  createEffect(
    () => page() === "workflows" && workspace.state.status === "online" && !workflowsSupported(),
    (unsupported) => {
      if (unsupported) setHostPage(null);
    },
  );
  const hostOnlineListeners = new Set<() => void>();
  createEffect(
    () => workspace.state.status === "online",
    (online, wasOnline) => {
      if (online && wasOnline === false) for (const listener of hostOnlineListeners) listener();
    },
  );
  const workflowPreviews = createWebAttachmentMedia(
    { download: (id) => workspace.runtime.downloadPreview(id) },
    () => workspace.state.host?.hostId ?? "",
  );
  onCleanup(workflowPreviews.dispose);
  const workflowHost = webWorkflowHost({
    request: () => hostRequest(),
    capabilities: () => workspace.state.capabilities,
    admin: () => canAdministerServer(workspace.state.host?.role),
    hostName: () => server()?.name,
    onHostEvent: workspace.onHostEvent,
    onReconnect(listener) {
      hostOnlineListeners.add(listener);
      return () => {
        hostOnlineListeners.delete(listener);
      };
    },
    githubConnector: githubPort,
    attachmentMedia: runtime.attachmentMedia,
    previewMedia: workflowPreviews,
  });
  const mediaCredits = createWorkflowMediaCredits(
    () => (page() === "workflows" && workspace.state.status === "online" ? (server()?.id ?? null) : null),
    () => workflowHost.workflows.mediaCredits(),
  );
  const librarySupported = () => workspace.state.capabilities.includes(STORAGE_CAPABILITY);
  createEffect(
    () => page() === "library" && workspace.state.status === "online" && !librarySupported(),
    (unsupported) => {
      if (unsupported) setHostPage(null);
    },
  );
  function libraryRailAction(): ((button: HTMLElement) => void) | undefined {
    if (!librarySupported()) return undefined;
    return (button) => {
      const id = server()?.id;
      if (id) void openHostPage(id, "library", button);
    };
  }
  function providersRailAction(): ((button: HTMLElement) => void) | undefined {
    if (!providerSettings()) return undefined;
    return (button) => {
      const id = server()?.id;
      if (id) void openServerSettings(id, button, "providers");
    };
  }
  const crmAllowed = () =>
    canAdministerServer(workspace.state.host?.role) && workspace.state.capabilities.includes(CRM_CAPABILITY);
  const crmHost = webCrmHost({ request: () => hostRequest(), onHostEvent: workspace.onHostEvent });
  const crmServerId = createMemo(() => (crmAllowed() ? server()?.id : undefined));
  const crmSwitch = createCrmEnabled(createMemo(() => (crmServerId() === undefined ? undefined : { ...crmHost })));
  const crmEnabled = crmSwitch.enabled;
  const crmSupported = () => crmAllowed() && crmEnabled() === true;
  createEffect(
    () => page() === "crm" && workspace.state.status === "online" && (!crmAllowed() || crmEnabled() === false),
    (unsupported) => {
      if (unsupported) setHostPage(null);
    },
  );
  function crmRailAction(): ((button: HTMLElement) => void) | undefined {
    if (!crmSupported()) return undefined;
    return (button) => {
      const id = server()?.id;
      if (!id) return;
      setCrmConnectorsRequest(undefined);
      void openHostPage(id, "crm", button);
    };
  }
  function crmConnectorsAction(): ((button: HTMLElement) => void) | undefined {
    if (!crmSupported()) return undefined;
    return (button) => {
      const id = server()?.id;
      if (!id) return;
      setCrmConnectorsRequest(id);
      void openHostPage(id, "crm", button);
    };
  }
  function workflowsRailAction(): (() => void) | undefined {
    if (!workflowsSupported()) return undefined;
    return () => {
      const id = server()?.id;
      if (id) void openHostPage(id, "workflows", null);
    };
  }
  const onePasswordPort = webOnePasswordConnectorPort(() => hostRequest());
  const bitwardenPort = webBitwardenConnectorPort(() => hostRequest());
  const passwordManagersPort = webPasswordManagersPort(() => hostRequest());
  const webMessaging = webHostMessaging(hostRequest, () =>
    workspace.state.capabilities.includes(DISCORD_ACCESS_CAPABILITY),
  );
  onCleanup(webMessaging.dispose);
  const webWhatsApp = webHostWhatsApp(hostRequest, (capability) => workspace.state.capabilities.includes(capability));
  const whatsappPort = hostWhatsAppPort(
    () => remoteAdminServer(server(), WHATSAPP_CONNECTOR_CAPABILITY)?.id,
    () => webWhatsApp,
  );
  const connectors = createConnectorRegistry(server, {
    computer: {},
    server: createConnectorSet(
      {
        github: () => githubPort,
        onePassword: () => onePasswordPort,
        bitwarden: () => bitwardenPort,
        passwordManagers: () => passwordManagersPort,
        messaging: hostMessagingApi(
          () => connectorTarget()?.id,
          () => webMessaging.api,
        ),
        whatsapp: () => whatsappPort,
      },
      { agents: workspace.profiles, hostName: () => server()?.name },
    ),
  });
  const [suggestedApp, setSuggestedApp] = createSignal<{ appId: string; connect: boolean } | null>(null);
  const agentTemplateCalls = createWebAgentTemplateCalls(props.accountFetch, hostRequest);
  createEffect(marketplaceOpen, (open) => {
    if (open) connectors.reload();
  });
  createEffect(
    () => props.inviteUrl,
    (inviteUrl) => {
      if (inviteUrl) setJoinOpen(true);
    },
  );
  createEffect(
    () => props.pluginSlug,
    (slug) => {
      if (slug) openMarketplace();
    },
  );
  createEffect(
    () => props.marketplaceListing,
    (link) => {
      if (link) openMarketplace();
    },
  );
  const [billingOpen, setBillingOpen] = createSignal(false);
  const [licenseStart, setLicenseStart] = createSignal<{ order: PricingOrder | null } | null>(null);
  const billingCalls = createWebBillingCalls(props.accountFetch);
  const billing = createBillingStore(() => billingCalls, billingOpen);
  const licenseCalls = createWebLicenseCalls(props.accountFetch);
  const license = createLicenseStore(() => licenseCalls, billingOpen, trackLicenseEvent);
  const referralCalls = createWebReferralCalls(props.accountFetch);
  const creditsCalls = createWebCreditsCalls(props.accountFetch);
  const credits = createCreditsStore(
    () => creditsCalls,
    () => billingOpen() || creditsOpen() !== null,
    (state) => creditsSummary.adopt(state),
    { activity: true },
  );
  const creditsSummary = createCreditsSummary(
    () => creditsCalls,
    () => props.accountId,
  );
  function creditsRailAction(): (() => void) | undefined {
    return creditsSummary.available() ? () => openCredits(null) : undefined;
  }
  function creditsMenu(): CreditsMenu {
    return { state: creditsSummary.state(), onOpen: openCredits, onRefresh: creditsSummary.refresh };
  }
  const billingHostedServers = createSettingsHostedServersStore(
    {
      get open() {
        return billingOpen();
      },
      hostedServersApi: hostedServers.calls,
    },
    billingOpen,
  );
  function deleteHostedServer(serverId: string): void {
    setBillingOpen(true);
    billingHostedServers.requestDeleteById(serverId);
  }
  const [leaveRequest, setLeaveRequest] = createSignal<{
    hostId: string;
    trigger: HTMLElement | null;
    removeOwned?: boolean;
  } | null>(null);
  const leaveServer = createMemo(() => servers().find((item) => item.id === leaveRequest()?.hostId) ?? null);
  createEffect(
    () => leaveRequest() !== null && leaveServer() === null,
    (gone) => {
      if (gone) setLeaveRequest(null);
    },
  );
  async function leaveHost(): Promise<void> {
    const request = leaveRequest();
    if (request) await departHost(request.hostId, request.removeOwned === true);
  }
  async function departHost(hostId: string, removeOwned: boolean): Promise<void> {
    const host = workspace.state.hosts.find((item) => item.hostId === hostId);
    if (!host) return;
    if (removeOwned) await workspace.removeOwnedHost(host);
    else await workspace.leaveHost(host);
  }
  async function leaveFromSettings(hostId: string, removeOwned: boolean): Promise<void> {
    await departHost(hostId, removeOwned);
    serverSettings.setOpen(false);
  }
  function removeFromSettings(hostId: string): (() => Promise<void>) | undefined {
    if (!workspace.runtime.removeOwnedHost || !hostedServers.loaded() || hostedServers.isHosted(hostId))
      return undefined;
    return () => leaveFromSettings(hostId, true);
  }
  const [restartRequest, setRestartRequest] = createSignal<{ hostId: string; trigger: HTMLElement | null } | null>(
    null,
  );
  const restartServer = createMemo(() => servers().find((item) => item.id === restartRequest()?.hostId) ?? null);
  createEffect(
    () => restartRequest() !== null && restartServer() === null,
    (gone) => {
      if (gone) setRestartRequest(null);
    },
  );
  function restartsItself(serverId: string): boolean {
    return (
      !hostedServers.isHosted(serverId) &&
      server()?.id === serverId &&
      workspace.state.restartReady &&
      workspace.runtime.admin !== undefined
    );
  }
  async function restartHost(): Promise<void> {
    const hostId = restartRequest()?.hostId;
    if (!hostId) return;
    if (hostedServers.isHosted(hostId)) await hostedServers.calls.restart(hostId);
    else {
      await runTeamEffect(requestHostRestart(hostRequest(hostId)).pipe(Effect.mapError((error) => error.cause)));
      workspace.restartRequested();
    }
  }
  createEffect(
    () => props.billingReturn,
    (billingReturn) => {
      if (!billingReturn) return;
      setBillingOpen(true);
      props.onBillingReturnConsumed?.();
    },
  );
  createEffect(
    () => (props.start?.kind === "server" && !hostedServers.loaded() ? null : props.start),
    (start) => {
      if (!start) return;
      if (start.kind === "server") hostedServers.openAddServer("pricing_page", start.order);
      else {
        setLicenseStart({ order: start.order });
        setBillingOpen(true);
      }
      props.onStartConsumed?.();
    },
  );
  const saveFile = createWebFileSaver();
  const machineCalls = webMachineCalls(hostRequest, (capability) => workspace.state.capabilities.includes(capability));
  const storageCalls: FilesPort = {
    agent: { listAgents: () => workspace.runtime.listAgents() },
    hostAdmin: machineCalls.hostAdmin,
    onLibraryFoldersChanged: (_serverId, listener) =>
      workspace.onHostEvent((event) => {
        if (event.type === "library-folders-changed") listener();
      }),
    storage: {
      getMachineMetrics: machineCalls.storage.getMachineMetrics,
      getLibraryFolders: machineCalls.storage.getLibraryFolders,
      changeLibraryFolders: machineCalls.storage.changeLibraryFolders,
      getUsage: async (input, serverId) => {
        if (input.scope === "channel" && !workspace.state.capabilities.includes(STORAGE_CHANNEL_CAPABILITY))
          return null;
        const usage = await runTeamEffect(
          getStorageUsage(hostRequest(serverId), input).pipe(Effect.mapError((error) => error.cause)),
        );
        return { ...usage, files: usage.files.map((file) => ({ ...file, previewUrl: null })) };
      },
      deleteFile: (input, serverId) =>
        runTeamEffect(deleteStoredFile(hostRequest(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      clear: (input, serverId) =>
        runTeamEffect(clearStorage(hostRequest(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      openFile: async (input, serverId) => {
        hostRequest(serverId);
        saveFile(await workspace.runtime.download(input.fileId));
      },
    },
    backgroundProcesses: {
      list: (serverId) =>
        runTeamEffect(listHostBackgroundProcesses(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause))),
      stop: (id, serverId) =>
        runTeamEffect(
          stopHostBackgroundProcess(hostRequest(serverId), id).pipe(Effect.mapError((error) => error.cause)),
        ),
    },
  };
  const alertCards = createSidebarAlertCards(server, () => machineCalls);
  createEffect(
    () => serverSettings.state.open,
    (open, wasOpen) => {
      if (!open && wasOpen) alertCards.refresh();
    },
  );
  const hostedSiteCalls: ServerHostedSitesOptions["api"] = {
    list: async (serverId) =>
      runTeamEffect(listHostedSites(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause))),
    delete: async ({ siteId }, serverId) =>
      runTeamEffect(deleteHostedSite(hostRequest(serverId), siteId).pipe(Effect.mapError((error) => error.cause))),
  };
  const ownerTransferCalls = (): OwnerTransferCalls | undefined => {
    const transfers = workspace.runtime.ownerTransfers;
    const target = server();
    if (
      !transfers ||
      !target ||
      target.hosted === true ||
      !hostedServers.loaded() ||
      hostedServers.isHosted(target.id) ||
      !workspace.state.capabilities.includes(OWNER_TRANSFER_CAPABILITY)
    )
      return undefined;
    return {
      getOwnerTransfer: (serverId) => transfers.pending(serverId),
      startOwnerTransfer: (email, serverId) => transfers.start(serverId, email),
      cancelOwnerTransfer: (serverId) => transfers.cancel(serverId),
    };
  };
  const agentImportCalls = createWebAgentImportCalls({
    request: hostRequest,
    sendsParts: () => workspace.state.capabilities.includes(AGENT_IMPORT_V2_CAPABILITY),
    listAgents: () => workspace.runtime.listAgents(),
    saveFile,
  });
  const instanceTransferCalls = createWebInstanceTransferCalls({
    request: hostRequest,
    download: (serverId) => hostAdmin(serverId).download,
    listAgents: () => workspace.runtime.listAgents(),
    saveFile,
    fullCopy: () => instanceTransferFullCopy(),
    sendsParts: () => workspace.state.capabilities.includes(INSTANCE_TRANSFER_CHUNKS_CAPABILITY),
  });
  const instanceTransferFullCopy = () =>
    workspace.state.capabilities.includes(INSTANCE_TRANSFER_CHUNKS_CAPABILITY) &&
    workspace.state.capabilities.includes(INSTANCE_TRANSFER_FULL_COPY_CAPABILITY);
  const instanceTransferEnabled = () =>
    workspace.state.capabilities.includes(INSTANCE_TRANSFER_CAPABILITY) &&
    canAdministerServer(workspace.state.host?.role);
  const instanceTransferSettings = () =>
    instanceTransferEnabled()
      ? {
          calls: instanceTransferCalls,
          history: instanceTransferFullCopy(),
          fullCopy: instanceTransferFullCopy(),
        }
      : undefined;
  const memberUpdateAccess = () => !serverRoleCanAdminister(server());
  const hostUpdateCalls: HostUpdateCalls = {
    getReleaseStatus: async (serverId) =>
      workspace.state.capabilities.includes(HOST_RELEASE_CAPABILITY)
        ? runTeamEffect(getHostReleaseStatus(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause)))
        : null,
    checkRelease: async (serverId) =>
      runTeamEffect(checkHostRelease(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause))),
    getUpdateStatus: async (serverId) =>
      runTeamEffect(
        getHostUpdateStatus(hostRequest(serverId), memberUpdateAccess()).pipe(Effect.mapError((error) => error.cause)),
      ),
    checkForUpdate: async (serverId) =>
      runTeamEffect(
        checkHostForUpdate(hostRequest(serverId), memberUpdateAccess()).pipe(Effect.mapError((error) => error.cause)),
      ),
    startUpdate: async (restart, serverId) =>
      runTeamEffect(
        startHostUpdate(hostRequest(serverId), restart, memberUpdateAccess()).pipe(
          Effect.mapError((error) => error.cause),
        ),
      ),
    cancelUpdate: async (serverId) =>
      runTeamEffect(cancelHostUpdate(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause))),
    setUpdateSettings: async (settings, serverId) =>
      runTeamEffect(
        setHostUpdateSettings(hostRequest(serverId), settings).pipe(Effect.mapError((error) => error.cause)),
      ),
  };
  const hostTimezoneCalls: HostTimezoneCalls = {
    getTimezone: async (serverId) =>
      runTeamEffect(getHostTimezone(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause))),
    setTimezone: async (timezone, serverId) =>
      runTeamEffect(setHostTimezone(hostRequest(serverId), timezone).pipe(Effect.mapError((error) => error.cause))),
  };
  const hostVoiceModelCalls: HostVoiceModelCalls = {
    getVoiceModel: async (serverId) =>
      hostRequest(serverId)("POST", HOST_VOICE_MODEL_ROUTES.settings, decodeHostVoiceModel, {}),
    changeVoiceModel: async ({ action, modelId }, serverId) =>
      hostRequest(serverId)("POST", HOST_VOICE_MODEL_ROUTES.change, decodeHostVoiceModel, { action, modelId }),
  };
  const hostTurnLimitsCalls: HostTurnLimitsCalls = {
    getTurnLimits: async (serverId) =>
      hostRequest(serverId)("POST", HOST_TURN_LIMITS_ROUTES.settings, decodeHostTurnLimits, {}),
    setTurnLimits: async ({ turnLimit, agentTaskLimit }, serverId) =>
      hostRequest(serverId)("POST", HOST_TURN_LIMITS_ROUTES.update, decodeHostTurnLimits, {
        turnLimit,
        agentTaskLimit,
      }),
  };
  const hostPersonalityCalls: HostPersonalityCalls = {
    getPersonality: async (serverId) =>
      workspace.state.capabilities.includes(HOST_PERSONALITY_CAPABILITY)
        ? runTeamEffect(getHostPersonality(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause)))
        : { responseStyle: LEGACY_RESPONSE_STYLE },
    setPersonality: async (personality, serverId) =>
      runTeamEffect(
        setHostPersonality(hostRequest(serverId), personality).pipe(Effect.mapError((error) => error.cause)),
      ),
  };
  createEffect(
    () => (workspace.state.status === "online" ? server()?.id : undefined),
    (serverId) => {
      if (serverId) loadServerPersonality(serverId, hostPersonalityCalls);
    },
  );
  const responseStyle = () => {
    const serverId = server()?.id;
    return serverId ? serverResponseStyle(serverId) : undefined;
  };
  const hostMemoryLimitCalls: HostMemoryLimitCalls = {
    getAgentMemoryLimit: async (serverId) =>
      runTeamEffect(getHostAgentMemoryLimit(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause))),
    setAgentMemoryLimit: async (limit, serverId) =>
      runTeamEffect(
        setHostAgentMemoryLimit(hostRequest(serverId), limit).pipe(Effect.mapError((error) => error.cause)),
      ),
  };
  const hostMemoryReviewCalls: HostMemoryReviewCalls = {
    getMemoryReview: async (serverId) =>
      runTeamEffect(getHostMemoryReview(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause))),
    setMemoryReview: async (interval, serverId) =>
      runTeamEffect(setHostMemoryReview(hostRequest(serverId), interval).pipe(Effect.mapError((error) => error.cause))),
  };
  const hostSkillLearningCalls: HostSkillLearningCalls = {
    getSkillLearning: async (serverId) =>
      runTeamEffect(getHostSkillLearning(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause))),
    setSkillLearning: async (mode, serverId) =>
      runTeamEffect(setHostSkillLearning(hostRequest(serverId), mode).pipe(Effect.mapError((error) => error.cause))),
  };
  const hostBrowsingMemoryCalls: HostBrowsingMemoryCalls = {
    getBrowsingMemory: async (serverId) =>
      runTeamEffect(getHostBrowsingMemory(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause))),
    setBrowsingMemory: async (enabled, serverId) =>
      runTeamEffect(
        setHostBrowsingMemory(hostRequest(serverId), enabled).pipe(Effect.mapError((error) => error.cause)),
      ),
  };
  const hostPromptCacheTtlCalls: HostPromptCacheTtlCalls = {
    getPromptCacheTtl: async (serverId) =>
      runTeamEffect(getHostPromptCacheTtl(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause))),
    setPromptCacheTtl: async (ttl, serverId) =>
      runTeamEffect(setHostPromptCacheTtl(hostRequest(serverId), ttl).pipe(Effect.mapError((error) => error.cause))),
    getCacheExpiryCompaction: async (serverId) =>
      runTeamEffect(getHostCacheExpiryCompaction(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause))),
    setCacheExpiryCompaction: async (enabled, serverId) =>
      runTeamEffect(
        setHostCacheExpiryCompaction(hostRequest(serverId), enabled).pipe(Effect.mapError((error) => error.cause)),
      ),
  };
  const hostClaudeUserSetupCalls: HostClaudeUserSetupCalls = {
    getClaudeUserSetup: (serverId) =>
      hostRequest(serverId)("POST", CLAUDE_USER_SETUP_ROUTES.settings, decodeClaudeUserSetupResponse, {}),
    setClaudeUserSetup: (enabled, serverId) =>
      hostRequest(serverId)("POST", CLAUDE_USER_SETUP_ROUTES.update, decodeClaudeUserSetupResponse, { enabled }),
  };
  const hostClaudeCompactWindowCalls: HostClaudeCompactWindowCalls = {
    getClaudeCompactWindow: async (serverId) =>
      runTeamEffect(getHostClaudeCompactWindow(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause))),
    setClaudeCompactWindow: async (tokens, serverId) =>
      runTeamEffect(
        setHostClaudeCompactWindow(hostRequest(serverId), tokens).pipe(Effect.mapError((error) => error.cause)),
      ),
  };
  const hostProviderEnvironmentCalls: HostProviderEnvironmentCalls = {
    getProviderEnvironment: async (provider, serverId) =>
      runTeamEffect(
        getHostProviderEnvironment(hostRequest(serverId), provider).pipe(Effect.mapError((error) => error.cause)),
      ),
    setProviderEnvironment: async (update, serverId) =>
      runTeamEffect(
        setHostProviderEnvironment(hostRequest(serverId), update).pipe(Effect.mapError((error) => error.cause)),
      ),
  };
  const hostModelVisibilityCalls: HostModelVisibilityCalls = {
    getModelVisibility: async (provider, serverId) =>
      runTeamEffect(
        getHostModelVisibility(hostRequest(serverId), provider).pipe(Effect.mapError((error) => error.cause)),
      ),
    setModelVisibility: async (change, serverId) =>
      runTeamEffect(
        setHostModelVisibility(hostRequest(serverId), change).pipe(Effect.mapError((error) => error.cause)),
      ),
  };
  const hostAgentAccessCalls: HostAgentAccessCalls = {
    getAgentAccess: async (serverId) =>
      runTeamEffect(getHostAgentAccess(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause))),
    setAgentAccess: async (change, serverId) =>
      runTeamEffect(setHostAgentAccess(hostRequest(serverId), change).pipe(Effect.mapError((error) => error.cause))),
  };
  const isOwnAgentChatSender = (senderId: string) =>
    isReaderAuthor(senderId, {
      memberId: workspace.state.memberId,
      accountUserId: props.accountId,
      onOwnComputer: false,
    });
  const hostAgentLevels: Pick<AgentLevelsSource, "readLevels" | "onLevelsChanged"> = {
    readLevels: (serverId) => hostAgentAccessCalls.getAgentAccess(serverId),
    onLevelsChanged: (_serverId, listener) =>
      workspace.onHostEvent((event) => {
        if (event.type === "agent-access-changed") listener();
      }),
  };
  const messageDeleteSupported = () => workspace.state.capabilities.includes(MESSAGE_DELETE_CAPABILITY);
  const deletesAnyAgentMessage = createAgentMessageDeleteAccess({
    deletesAny: () => canAdministerServer(workspace.state.host?.role),
    levelsServerId: () => {
      const hostId = server()?.id;
      if (!hostId || workspace.state.status !== "online" || canAdministerServer(workspace.state.host?.role))
        return null;
      return messageDeleteSupported() && workspace.state.capabilities.includes(AGENT_ACCESS_CAPABILITY) ? hostId : null;
    },
    ...hostAgentLevels,
  });
  const canDeleteAgentMessage = (message: AgentMessage) =>
    readerCanDeleteMessage(message, {
      deleteAny: deletesAnyAgentMessage(workspace.state.selectedId ?? undefined),
      isOwnSender: isOwnAgentChatSender,
    });
  const deleteOpenAgentMessage = (messageId: string) => {
    const agentId = workspace.state.selectedId;
    return agentId ? workspace.deleteMessage(agentId, messageId) : Promise.resolve();
  };
  const messagePinsSupported = createMemo(() => workspace.state.capabilities.includes(MESSAGE_PINS_CAPABILITY));
  const agentMessagePins = createMemo(() => {
    const { listPinnedMessages: list, setMessagePinned: set } = workspace.runtime;
    if (!list || !set || !messagePinsSupported()) return undefined;
    return {
      list,
      set,
      subscribe: (agentId: string, changed: () => void) =>
        workspace.onHostEvent((event) => {
          if (event.type === "message-pins-changed" && event.agentId === agentId) changed();
        }),
    };
  });
  const agentDeleteMessageAction = () => (messageDeleteSupported() ? deleteOpenAgentMessage : undefined);
  const hostServerAuditCalls: HostServerAuditCalls = {
    getAuditLog: async (serverId) =>
      runTeamEffect(getHostAuditLog(hostRequest(serverId)).pipe(Effect.mapError((error) => error.cause))),
  };
  const hostAgentDefaultsCalls: HostAgentDefaultsCalls = {
    getAgentDefaultsOverview: (serverId) =>
      hostRequest(serverId)("POST", AGENT_DEFAULTS_ROUTES.settings, decodeAgentDefaultsOverview, {}),
    updateAgentDefaultsOverview: (input, serverId) =>
      hostRequest(serverId)("POST", AGENT_DEFAULTS_ROUTES.update, decodeAgentDefaultsOverview, { ...input }),
    setAgentDefaultChoice: ({ agentIds, setting, choice }, serverId) =>
      hostRequest(serverId)("POST", AGENT_DEFAULTS_ROUTES.choice, decodeAgentDefaultsOverview, {
        agentIds,
        setting,
        choice,
      }),
  };
  const [serverSettingsSection, setServerSettingsSection] = createSignal<ServerSettingsSection | null>(null);
  const [serverSettingsRequest, setServerSettingsRequest] = createSignal(0);
  const [serverSettingsShownSection, setServerSettingsShownSection] = createSignal<ServerSettingsSection | null>(null);
  const [mcpSignInRequest, setMcpSignInRequest] = createSignal<string | null>(null);
  createEffect(marketplaceOpen, (open) => {
    if (!open) setMcpSignInRequest(null);
  });
  const [mcpSignIns, setMcpSignIns] = createSignal<{
    serverId: string;
    states: Readonly<Record<string, McpSignInState>>;
  } | null>(null);
  async function openServerSettings(
    serverId: string,
    trigger: HTMLElement | null,
    section: ServerSettingsSection | null = null,
  ): Promise<void> {
    if (server()?.id !== serverId || workspace.state.status !== "online") {
      const host = workspace.state.hosts.find((item) => item.hostId === serverId);
      if (!host) return;
      if (server()?.id !== serverId) chatHistory.userOpensServer(serverId);
      await workspace.connect(host);
      if (server()?.id !== serverId || workspace.state.status !== "online") return;
    }
    setServerSettingsSection(section);
    setServerSettingsRequest((count) => count + 1);
    setMobilePane("conversation");
    setHostPage(null);
    setMarketplaceOpen(false);
    setAccountSettingsOpen(false);
    setServerSettingsLoaded(true);
    serverSettings.open(trigger);
  }
  const serverActionCallbacks = {
    onOpenSettings: (serverId, trigger) => void openServerSettings(serverId, trigger),
    onSetMuted: setMuted,
    onOpenNotificationSettings: (serverId) => openNotificationSettings(serverId),
    onLeave: (hostId, trigger) => setLeaveRequest({ hostId, trigger }),
    onRemove: (hostId, trigger) => setLeaveRequest({ hostId, trigger, removeOwned: true }),
    canRemove: (serverId) =>
      Boolean(workspace.runtime.removeOwnedHost) && hostedServers.loaded() && !hostedServers.isHosted(serverId),
    onDelete: deleteHostedServer,
    canDelete: hostedServers.isHosted,
    onRestart: (hostId, trigger) => setRestartRequest({ hostId, trigger }),
    canRestart: (serverId) => hostedServers.isHosted(serverId) || restartsItself(serverId),
    planDeletesAt: hostedServers.planDeletesAt,
    onRenewPlan: hostedServers.renewPlan,
  } satisfies ServerActionCallbacks;
  let entry: { id: string; offered: boolean } | null = null;
  createEffect(
    () => {
      const current = server();
      return current ? { id: current.id, online: current.state === "online" } : null;
    },
    (current) => {
      if (current?.id !== entry?.id) {
        entry = current ? { id: current.id, offered: false } : null;
        void offerServerUpdate(null);
      }
      if (!current?.online || !entry || entry.offered) return;
      entry.offered = true;
      const active = untrack(server);
      void offerServerUpdate(
        active && remoteUpdateServer(active)
          ? {
              serverId: active.id,
              name: active.name,
              canManage: serverRoleCanAdminister(active),
              calls: hostUpdateCalls,
            }
          : null,
      );
    },
  );
  const channelsPort = createWebChannelsPort(
    workspace.runtime,
    workspace.onHostEvent,
    () => workspace.state.host?.hostId ?? "",
    eventsEnabled,
    routineRecoveryEnabled,
    webhookTestsEnabled,
    webhookSenderSecretEnabled,
    routinesOnceEnabled,
  );
  const channelsSupported = () =>
    workspace.state.status === "online" &&
    workspace.state.capabilities.includes(CHANNEL_CHATS_CAPABILITY) &&
    Boolean(workspace.runtime.channels);
  const channelsListed = () => channelsSupported();
  const sidebarChannels = () =>
    !channels.state.listed && (workspace.state.status !== "online" || channelsSupported())
      ? workspace.state.frameChannels
      : channelsListed()
        ? channels.state.channels
        : [];
  const [sidebarWaitOver, setSidebarWaitOver] = createSignal(false);
  createEffect(
    () => pageLoad() && workspace.state.status === "online",
    (waiting) => {
      if (!waiting) return;
      const timer = setTimeout(() => setSidebarWaitOver(true), SIDEBAR_WAIT_MS);
      return () => clearTimeout(timer);
    },
  );
  function sidebarLoading(): boolean {
    return (
      !sidebarWaitOver() &&
      (workspace.state.panelsLoading || (channelsSupported() && !channels.state.listed && !channels.state.error))
    );
  }
  const savedChannelId = () => {
    const hostId = workspace.state.host?.hostId;
    return hostId ? (readChannelSelection()[props.accountId]?.[hostId] ?? null) : null;
  };
  const canMarkRead = () => document.hasFocus() && mobilePane() === "conversation" && !pageCovered();
  let channelBaseline: { scope: string; channels: ChannelSummary[] } | null = null;
  const channels = createChannelsController({
    port: () => channelsPort,
    agents: workspace.profiles,
    scopeKey: () => `${workspace.state.host?.hostId ?? ""}:${workspace.state.revocationRevision}`,
    readSelection: savedChannelId,
    writeSelection: (channelId) => {
      const hostId = workspace.state.host?.hostId;
      if (hostId) writeChannelSelection(props.accountId, hostId, channelId);
    },
    supported: channelsSupported,
    deletionSupported: () => canAdministerServer(workspace.state.host?.role),
    taskCancelSupported: () => workspace.state.capabilities.includes(CHANNEL_TASK_CANCEL_CAPABILITY),
    isolationSupported: () => workspace.state.capabilities.includes(CHANNEL_ISOLATION_CAPABILITY),
    browserSupported: () => workspace.state.capabilities.includes(CHANNEL_BROWSER_CAPABILITY),
    messageDeletionSupported: () => workspace.state.capabilities.includes(MESSAGE_DELETE_CAPABILITY),
    deletesAnyMessage: () => canAdministerServer(workspace.state.host?.role),
    pictureSupported: () => workspace.state.capabilities.includes(CHANNEL_PICTURE_CAPABILITY),
    contextActionsSupported: () => workspace.state.capabilities.includes(CHAT_HISTORY_CAPABILITY),
    foldersMode: () =>
      workspace.state.capabilities.includes(CHANNEL_FOLDERS_CAPABILITY) &&
      canAdministerServer(workspace.state.host?.role)
        ? "remote"
        : null,
    beforeOpen: () => {
      setCreating(false);
      setHostPage(null);
      setCreditsOpen(null);
      setMessageFocusRequest(null);
    },
    canMarkRead,
    onList: (list, scope) => {
      const hostId = workspace.state.host?.hostId;
      const previous = channelBaseline?.scope === scope ? channelBaseline.channels : null;
      channelBaseline = { scope, channels: list };
      if (hostId) {
        notifyChannelReplies(hostId, previous, list);
        saveRemoteFrameChannels(props.accountId, hostId, list);
      }
    },
  });
  onCleanup(
    workspace.onHostEvent((event) => {
      if (event.type === "channels-changed") void channels.changed(event.channelId);
      else if (event.type === "runtime-snapshot") void channels.resync();
    }),
  );
  const stopChannelPictures = workspace.runtime.channels?.onPictures?.(() => void channels.refresh(undefined, false));
  if (stopChannelPictures) onCleanup(stopChannelPictures);
  onCleanup(
    workspace.onHostEvent((event) => {
      if (event.type !== "agent-notification-levels-changed") return;
      const hostId = server()?.id;
      if (!hostId) return;
      const levels = { server: event.server, agents: event.agents };
      notificationSettings.applyLevels(hostId, levels);
      applyAgentLevels(hostId, levels);
    }),
  );
  const errorBanners = createTurnErrorBanners();
  const isMainThread = (agentId: string, threadId: string) =>
    workspace.state.agents.some((agent) => agent.id === agentId && agent.threadId === threadId);
  onCleanup(
    workspace.onHostEvent((event) => {
      const serverId = server()?.id;
      if (event.type === "turn-started") {
        if (serverId && isMainThread(event.agentId, event.threadId))
          errorBanners.noteTurnStarted(composerDraftKey({ agentId: event.agentId, serverId }));
        return;
      }
      if (event.type === "turn-completed") {
        if (!serverId) return;
        const key = composerDraftKey({ agentId: event.agentId, serverId });
        errorBanners.clearAtTurnEnd(
          key,
          event.status === "completed" && !event.quiet && isMainThread(event.agentId, event.threadId),
          controller.setConversationErrors,
          controller.setConversationErrorRuns,
        );
        return;
      }
      if (event.type !== "error") return;
      if (event.agentId && serverId) {
        const key = composerDraftKey({ agentId: event.agentId, serverId });
        const message = readableAgentError(event.message);
        errorBanners.noteError(key, event.message, message);
        controller.setConversationErrors((current) => ({ ...current, [key]: message }));
        const details = agentErrorDetails(event.message, message);
        controller.setConversationErrorRuns((current) => {
          if (details) return { ...current, [key]: { message, run: null, details } };
          if (!(key in current)) return current;
          const { [key]: _replaced, ...next } = current;
          return next;
        });
        return;
      }
      const description = readableAgentError(event.message);
      if (!claimErrorToast(description)) return;
      if (event.code === "mcp_server_not_started") {
        toast.error(t("agent.error.mcpNotStarted"), {
          ...{ description },
          ...(serverCanManageMcp(server())
            ? { action: { label: t("agent.error.openMarketplace"), onClick: openMarketplace } }
            : {}),
          report: { operation: "provider", source: "provider", cause_code: classifyFailure(event.message) },
        });
        return;
      }
      toast.error(t("webClient.error.hostReported"), {
        ...{ description },
        report: { operation: "other", source: "system", cause_code: "unknown" },
      });
    }),
  );
  const channelOpen = () => channels.state.selectedId !== null;
  const createSupported = () => workspace.state.status === "online" && workspace.state.host !== null;
  const firstAgent = () => workspace.state.agentsLoaded && workspace.profiles().length === 0 && createSupported();
  const agentFormOpen = () => creating() || (firstAgent() && !channelOpen());
  const agentChatOpen = () => !tasksOpen() && !agentFormOpen() && !channelOpen() && !noHost() && !hostOffline();
  const [serverSetupChoices, setServerSetupChoices] = createSignal<Record<string, CreationPreference>>({});
  const serverSetupChoice = () => {
    const id = server()?.id;
    return id ? (serverSetupChoices()[id] ?? null) : null;
  };
  const serverOnboarding = () =>
    agentFormOpen() && firstAgent() && serverSetupChoice() === null ? providerSettings() : undefined;
  createEffect(firstAgent, (first) => {
    if (first && !untrack(channelOpen)) setCreating(true);
  });
  const chatHistory = createWebChatHistory({
    current: () => {
      const hostId = workspace.state.host?.hostId;
      if (!hostId || page() !== "agents" || agentFormOpen()) return null;
      const channelId = channels.state.selectedId;
      if (channelId) return { hostId, kind: "channel", id: channelId };
      const agentId = workspace.state.selectedId;
      return agentId ? { hostId, kind: "agent", id: agentId } : null;
    },
    open: openHistoryChat,
  });
  function userOpensChat(kind: WebChatHistoryEntry["kind"], id: string): void {
    const hostId = workspace.state.host?.hostId;
    if (hostId) chatHistory.userOpens({ hostId, kind, id });
  }
  const webhookRoutines = webEventRoutinesApi(
    (...args) => hostRequest()(...args),
    routineRecoveryEnabled,
    webhookTestsEnabled,
    webhookSenderSecretEnabled,
    undefined,
    routinesOnceEnabled,
    undefined,
    webhookAgentSecretEnabled,
  );
  createRoutineTimezonePrompt(() => {
    const current = server();
    if (current?.state !== "online" || !workspace.runtime.admin || !eventsEnabled()) return [];
    return [
      {
        id: current.id,
        name: current.name,
        calendar: (input) => scheduleSource.calendar(input, current.id),
        events: webhookRoutines,
        timezone: serverCanAdminister(current, "host-timezone-v1") ? hostTimezoneCalls : undefined,
      },
    ];
  });
  const openProviderSettings = (trigger: HTMLElement) => {
    const current = server();
    if (current) void openServerSettings(current.id, trigger, "providers");
  };
  const browserProfileHostId = createMemo(() => {
    const current = server();
    return serverCanAdminister(current, BROWSER_PROFILES_CAPABILITY) ? current?.id : undefined;
  });
  const browserProfiles = createMemo(() => {
    const calls = runtime.browserProfiles;
    return calls && browserProfileHostId() !== undefined ? createBrowserProfilesStore(() => calls) : undefined;
  });
  const browserProfileSettings = createMemo((): ServerBrowserProfilesOptions | undefined => {
    const store = browserProfiles();
    return store ? { store, listAgents: async () => workspace.profiles() } : undefined;
  });
  const vaultHostId = createMemo(() => {
    const current = server();
    return serverCanAdminister(current, VAULT_CAPABILITY) ? current?.id : undefined;
  });
  const vaultVersion = createMemo((): 1 | 2 | 3 | 4 => {
    const current = server();
    if (serverCanAdminister(current, VAULT_V4_CAPABILITY)) return 4;
    if (serverCanAdminister(current, VAULT_V3_CAPABILITY)) return 3;
    return serverCanAdminister(current, VAULT_V2_CAPABILITY) ? 2 : 1;
  });
  const vaultImport = createMemo(() => serverCanAdminister(server(), VAULT_IMPORT_CAPABILITY));
  const vaultSettings = createMemo((): ServerVaultOptions | undefined => {
    if (vaultHostId() === undefined) return undefined;
    const version = vaultVersion();
    return {
      store: createVaultStore(webVaultCalls(() => hostRequest(), workspace.onHostEvent, version, vaultImport())),
      apiKeys: version > 1,
      twoStep: version >= 3,
      listAgents: async () => workspace.profiles(),
    };
  });
  const openBrowserProfileSettings = (trigger: HTMLElement) => {
    const current = server();
    if (current) void openServerSettings(current.id, trigger, "browser-profiles");
  };
  const [heldUnreadAgentId, setHeldUnreadAgentId] = createSignal<string | null>(null);
  const readState = () => workspace.conversation()?.page?.readState;
  const readsOpenChat = () =>
    workspace.state.status === "online" &&
    !agentFormOpen() &&
    !channelOpen() &&
    canMarkRead() &&
    heldUnreadAgentId() !== workspace.state.selectedId;
  const shownReadState = createMemo<{ visit: string; seen: boolean; unreadCount: number; firstUnread: string | null }>(
    (previous) => {
      const conversation = workspace.conversation();
      const page = conversation?.page;
      const visit = `${workspace.state.host?.hostId ?? ""}:${workspace.state.selectedId ?? ""}:${page?.threadId ?? ""}`;
      const readable = readsOpenChat();
      const seenBefore = previous?.visit === visit && previous.seen;
      const seen = readable && (seenBefore || (Boolean(page) && conversation?.loading === false));
      if (seenBefore && readable) return { visit, seen, unreadCount: 0, firstUnread: null };
      return {
        visit,
        seen,
        unreadCount: page?.readState?.unreadCount ?? 0,
        firstUnread: page?.readState?.firstUnreadMessageId ?? null,
      };
    },
  );
  createEffect(
    () =>
      (readState()?.unreadCount ?? 0) > 0 && readsOpenChat()
        ? (workspace.conversation()?.page?.messages.at(-1)?.id ?? null)
        : null,
    (unread) => {
      if (unread)
        void workspace.markRead().catch(() =>
          toast.error(t("chat.unread.markReadFailed"), {
            report: { operation: "other", source: "system", cause_code: "unknown" },
          }),
        );
    },
  );
  const sidebarActivity = createMemo(() => {
    const agentThreads = new Map(workspace.state.agents.map((agent) => [agent.id, agent.threadId]));
    const inAgentThread = (item: { agentId: string; threadId?: string }) =>
      item.threadId !== undefined && agentThreads.get(item.agentId) === item.threadId;
    return {
      agentIds: workspace.state.agents.map((agent) => agent.id),
      activeTurns: Object.fromEntries(
        Object.entries(workspace.state.conversations).map(([id, conversation]) => [
          id,
          workspace.state.status === "online" ? (conversation.page?.activeTurnId ?? null) : null,
        ]),
      ),
      queues: workspace.state.queues,
      unreadReplies: Object.fromEntries(
        Object.entries(workspace.state.reads).map(([id, read]) => [id, read.unreadCount]),
      ),
      recentReplies: {},
      failedTurns: {},
      pendingPrompts: Object.fromEntries([
        ...workspace.state.takeovers
          .filter(inAgentThread)
          .map((request) => [request.agentId, { type: "browser-takeover-requested", request } as const] as const),
        ...workspace.state.prompts.filter(inAgentThread).map((prompt) => [prompt.agentId, prompt] as const),
      ]),
      pendingApprovals: Object.fromEntries(
        workspace.state.approvals.filter(inAgentThread).map((approval) => [approval.agentId, approval]),
      ),
    };
  });
  const sidebarAgentStates = createMemo(() => computeSidebarAgentStates(sidebarActivity()));
  const sidebarChannelWaitStates = createMemo(() =>
    sidebarChannelWaits({
      channels: channelsListed() ? channels.state.channels : [],
      prompts: workspace.state.prompts,
      takeovers: workspace.state.takeovers,
      approvals: workspace.state.approvals,
    }),
  );
  const agentWaits = createMemo(() => sidebarAgentWaits(sidebarActivity()));
  const agentTakeoverTabs = createMemo(() => agentTakeoverTabIds(workspace.state.agents, workspace.state.takeovers));
  const sidebarAgentMoods = createMemo(() => computeAgentAvatarMoods(sidebarActivity()));
  const browserEnabled = createMemo(
    () =>
      workspace.state.status === "online" &&
      workspace.state.capabilities.includes("browser-control") &&
      workspace.state.capabilities.includes("browser-view"),
  );
  const clearSelectedAgentContext = createMemo(() => {
    const agent = workspace.selected();
    if (!agent || !workspace.runtime.admin || !workspace.state.capabilities.includes(CONTEXT_RESET_CAPABILITY))
      return undefined;
    return () =>
      Effect.runPromise(clearAgentContext(hostRequest(), agent.id).pipe(Effect.mapError((error) => error.cause)));
  });
  const compactSelectedAgentContext = createMemo(() => {
    const agent = workspace.selected();
    const compactContext = workspace.runtime.compactContext;
    if (!agent || !compactContext || !workspace.state.capabilities.includes(CONTEXT_COMPACT_CAPABILITY))
      return undefined;
    return () => compactContext(agent.id);
  });
  const [selectedWaits, setSelectedWaits] = createSignal<AgentWaitsSnapshot | null>(null);
  let waitsRequest = 0;
  const loadSelectedWaits = (agentId: string | null, supported: boolean) => {
    waitsRequest += 1;
    const request = waitsRequest;
    const listWaits = workspace.runtime.listWaits;
    if (!agentId || !supported || !listWaits) {
      setSelectedWaits(null);
      return;
    }
    void listWaits(agentId).then(
      (snapshot) => {
        if (request === waitsRequest) setSelectedWaits(snapshot);
      },
      () => {
        if (request === waitsRequest) setSelectedWaits(null);
      },
    );
  };
  const waitsKey = createMemo(
    () => ({
      agentId: workspace.state.selectedId ?? null,
      turnId: workspace.conversation()?.page?.activeTurnId ?? null,
      supported: workspace.state.capabilities.includes(AGENT_WAITS_CAPABILITY),
    }),
    {
      equals: (before, after) =>
        before.agentId === after.agentId && before.turnId === after.turnId && before.supported === after.supported,
    },
  );
  createEffect(waitsKey, ({ agentId, supported }) => loadSelectedWaits(agentId, supported));
  const visibleWaits = () => {
    const snapshot = selectedWaits();
    return snapshot && snapshot.agentId === workspace.state.selectedId ? snapshot.waits : undefined;
  };
  const cancelSelectedWait = createMemo(() => {
    const cancelWait = workspace.runtime.cancelWait;
    if (!cancelWait || !workspace.state.capabilities.includes(AGENT_WAITS_CAPABILITY)) return undefined;
    return (waitId: string) => {
      const agentId = workspace.state.selectedId;
      if (!agentId) return;
      void workspace.run(async () => {
        try {
          await cancelWait(agentId, waitId);
        } finally {
          loadSelectedWaits(agentId, true);
        }
      });
    };
  });
  const compactSelectedTaskContext = createMemo(() => {
    const agent = workspace.selected();
    const compactContext = workspace.runtime.compactContext;
    if (!agent || !compactContext || !workspace.state.capabilities.includes(CONTEXT_COMPACT_CAPABILITY))
      return undefined;
    return (taskId: string) => compactContext(agent.id, taskId);
  });
  const deleteSelectedAgentHistory = createMemo(() => {
    const agent = workspace.selected();
    const deleteHistory = workspace.runtime.deleteHistory;
    if (!agent || !deleteHistory || !workspace.state.capabilities.includes(CHAT_HISTORY_CAPABILITY)) return undefined;
    if (!deletesAnyAgentMessage(agent.id)) return undefined;
    return async () => {
      await deleteHistory({ kind: "agent", agentId: agent.id });
      await workspace.refresh();
    };
  });
  const mentionAgents = createMemo(() => workspace.profiles().filter((agent) => !pausedAgentIds().has(agent.id)));
  const sendToChannel = () => {
    const hostId = server()?.id;
    if (!hostId || !channels.supported()) return;
    const open = channels.state.channels.filter((channel) => !channel.archived);
    if (open.length === 0) return;
    return {
      channels: open.map((channel) => ({ id: channel.id, name: channel.name })),
      onSend: (channelId: string, text: string) => {
        controller.appendChannelText({ serverId: hostId, channelId }, text);
        openChannel(channelId);
      },
    };
  };
  async function markAgentUnread(agentId: string, write: () => Promise<void>) {
    const holds = agentId === workspace.state.selectedId;
    if (holds) setHeldUnreadAgentId(agentId);
    try {
      await write();
    } catch (error) {
      if (holds) setHeldUnreadAgentId(null);
      actionToast.error(t("chat.errorStatus.readState"), {
        description: text.errorMessage(error, t("webClient.error.requestFailed")),
        report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
      });
    }
  }
  const unreadFromSupported = () =>
    workspace.state.status === "online" && workspace.state.capabilities.includes(CONVERSATION_UNREAD_FROM_CAPABILITY);
  const markUnreadFrom = createMemo(() => {
    if (!unreadFromSupported()) return undefined;
    return async (messageId: string) => {
      const agentId = workspace.state.selectedId;
      if (agentId) await markAgentUnread(agentId, () => workspace.markUnreadFrom(agentId, messageId));
    };
  });
  const sidebarUnreadAgentIds = createMemo(
    () => new Set(Object.entries(workspace.state.reads).flatMap(([id, read]) => (read.unreadCount > 0 ? [id] : []))),
  );
  const markSidebarAgentRead = () =>
    workspace.state.status === "online"
      ? (agentId: string) => {
          if (heldUnreadAgentId() === agentId) setHeldUnreadAgentId(null);
          void workspace.markAgentRead(agentId).catch(() =>
            actionToast.error(t("chat.unread.markReadFailed"), {
              report: { operation: "other", source: "action", cause_code: "unknown" },
            }),
          );
        }
      : undefined;
  const markSidebarAgentUnread = () =>
    unreadFromSupported()
      ? (agentId: string) => void markAgentUnread(agentId, () => workspace.markLatestReplyUnread(agentId))
      : undefined;
  function sendQueuedMessageNow(deliveryId: string): void {
    const agentId = workspace.state.selectedId;
    const turnId = workspace.conversation()?.page?.activeTurnId;
    if (!agentId || !turnId) return;
    const queued = queuedDeliveriesInOrder(workspace.state.queues[agentId]);
    const head = queued[0];
    if (head?.editing && head.id !== deliveryId) return;
    const ids = queued.map((delivery) => delivery.id);
    void workspace.run(async () => {
      if (ids[0] !== deliveryId)
        await workspace.runtime.reorderQueue({
          agentId,
          deliveryIds: [deliveryId, ...ids.filter((id) => id !== deliveryId)],
        });
      if (workspace.state.conversations[agentId]?.page?.activeTurnId !== turnId) return;
      await workspace.runtime.stop(agentId, turnId);
    });
  }
  const [selectedRoutines, setSelectedRoutines] = createSignal<{
    agentId: string;
    routines: RoutineFields[];
    current: boolean;
  } | null>(null);
  let routinesRequest = 0;
  function loadSelectedRoutines(agentId: string | null): void {
    routinesRequest += 1;
    const request = routinesRequest;
    const api = runtime.routines;
    if (!agentId || !api) {
      setSelectedRoutines(null);
      return;
    }
    setSelectedRoutines((snapshot) => (snapshot?.agentId === agentId ? { ...snapshot, current: false } : null));
    void api.listRoutines(agentId).then(
      (routines) => {
        if (request === routinesRequest) setSelectedRoutines({ agentId, routines, current: true });
      },
      () => undefined,
    );
  }
  createEffect(
    () => (workspace.state.status === "online" ? (workspace.state.selectedId ?? null) : null),
    (agentId) => loadSelectedRoutines(agentId),
  );
  onSettled(() =>
    runtime.routines?.onEvent((event) => {
      if (event.type === "routines-changed" && event.agentId === untrack(() => workspace.state.selectedId))
        loadSelectedRoutines(event.agentId);
    }),
  );
  const routineSnapshot = () => {
    const snapshot = selectedRoutines();
    return snapshot && snapshot.agentId === workspace.state.selectedId ? snapshot : undefined;
  };
  const availableRoutineIds = () => {
    const snapshot = routineSnapshot();
    return snapshot?.current ? snapshot.routines.map((routine) => routine.id) : undefined;
  };
  const openMcpSignInFromChat = () => {
    if (!remoteMcpSignIn(server())) return undefined;
    return (mcpServerId: string) => {
      setMcpSignInRequest(mcpServerId);
      openMarketplace();
    };
  };
  const mcpSignedIn = (mcpServerId: string) => {
    const known = mcpSignIns();
    return known?.serverId === server()?.id && known?.states[mcpServerId]?.signedIn === true;
  };
  const refreshMcpSignInsFromChat = () => {
    const serverId = mcpSignIns()?.serverId;
    if (!serverId || serverId !== server()?.id) return;
    void marketplaceCalls.mcp
      .listMcpSignIns(serverId)
      .then(mcpSignInRecord, () => null)
      .then((states) => {
        if (states && mcpSignIns()?.serverId === serverId) setMcpSignIns({ serverId, states });
      });
  };
  const offlineUpsell = createHostedUpsellOffline(() => workspace.state.hostOffline);
  const agentThreads = createMemo(() => {
    const hostId = workspace.state.host?.hostId;
    if (!hostId) return undefined;
    const root = untrack(() =>
      createRoot((dispose) => ({
        dispose,
        threads: createWebAgentThreads({ workspace, hostId, request: () => hostRequest(hostId) }),
      })),
    );
    onCleanup(root.dispose);
    return root.threads;
  });
  const hostUsageLimits = createMemo(() => {
    const hostId = workspace.state.host?.hostId;
    if (!hostId) return undefined;
    const root = untrack(() =>
      createRoot((dispose) => ({
        dispose,
        limits: createWebUsageLimits({ workspace, hostId, request: () => hostRequest(hostId) }),
      })),
    );
    onCleanup(root.dispose);
    return root.limits;
  });
  const usageLimitsShown = () => workspace.state.capabilities.includes(AGENT_USAGE_LIMIT_CAPABILITY);
  const usageLimited = (choice: AgentModelChoice) => hostUsageLimits()?.usageLimited(choice) === true;
  const providerFailed = (choice: AgentModelChoice) => hostUsageLimits()?.providerFailed(choice) === true;
  const usageLimitAskFor = usageLimitAskFrom({
    available: (agentId) => usageLimitsShown() && deletesAnyAgentMessage(agentId),
    rememberable: () => serverCanAdminister(server(), "agent-backup-models-v1"),
    usageLimits: () => hostUsageLimits()?.usageLimits() ?? {},
    waited: () => hostUsageLimits()?.waited() ?? {},
    wait: (agentId, resetsAt) => hostUsageLimits()?.wait(agentId, resetsAt),
    modelOptions: models,
    providers: () => providerAdmin.status().providers,
    limited: usageLimited,
    update: async (agentId, updates) => {
      await updateRemoteAgent(remoteAgentAdmin, { agentId, ...updates }, workspace.runtime.updateAgent);
      await workspace.refresh();
    },
  });
  const usageLimitAsk = createMemo(() => {
    const agent = conversationAgent();
    if (!agent || !workspace.state.queues[agent.id]?.deliveries.some((delivery) => delivery.status === "queued"))
      return undefined;
    return usageLimitAskFor(agent);
  });
  trackUsageLimitShown(() => {
    const ask = usageLimitAsk();
    const agent = conversationAgent();
    return ask && agent ? { agentId: agent.id, ask } : undefined;
  });
  const sidebarActiveAgentId = () => (tasksOpen() || channelOpen() ? "" : (workspace.state.selectedId ?? ""));
  const sidebarThreads = createMemo(() => {
    const current = agentThreads();
    if (!current) return undefined;
    const openChat = (agentId: string) => {
      setMobilePane("conversation");
      void select(agentId);
    };
    return sidebarAgentThreads({
      tasks: current.tasks,
      tabs: current.tabs,
      activeAgentId: sidebarActiveAgentId,
      waits: () => ({
        approvals: workspace.state.approvals,
        prompts: workspace.state.prompts,
        takeovers: workspace.state.takeovers,
      }),
      openThread: (agentId, threadId) => {
        current.tabs.open(agentId, threadId);
        openChat(agentId);
      },
      onNew: (agentId) => {
        openChat(agentId);
        current.tabs.startNew(agentId);
      },
    });
  });
  const threads = createMemo((): ConversationThreads | undefined => {
    const agent = workspace.selected();
    const current = agentThreads();
    if (!agent || !current?.tasks.available()) return undefined;
    return conversationThreads({
      agent: { id: agent.id, updatedAt: agent.updatedAt ?? agent.time },
      tasks: current.tasks,
      tabs: current.tabs,
      approvals: workspace.state.approvals,
      prompts: workspace.state.prompts,
      takeovers: workspace.state.takeovers,
      newThreadTitle: t("conversation.threads.new"),
      onRespondApproval: (item, decision, options) =>
        reportedFailure(() => workspace.approve({ requestId: item.requestId, decision }), options),
      contextStates: () => workspace.state.threadContextStates,
      onCompactContext: compactSelectedTaskContext(),
      onOpenMainMessage: (messageId) => openSelectedMessage(agent.id, messageId),
    });
  });
  const openThreadId = () => threads()?.open?.threadId;
  const browserTakeover = createMemo(() => {
    const agent = workspace.selected();
    if (!agent) return undefined;
    const open = threads()?.open;
    const threadId = open === undefined ? agent.threadId : open?.threadId;
    return workspace.state.takeovers.find((request) => request.agentId === agent.id && request.threadId === threadId);
  });
  const view = createWebConversationView({
    workspace,
    remoteAgentAdmin,
    hidden: () => creating() || channelOpen(),
    thread: () => {
      const current = threads();
      if (current?.open === undefined) return undefined;
      return current.open ? (current.conversation ?? null) : null;
    },
  });
  createEffect(
    () => workspace.state.error,
    (error) => {
      if (error)
        toast.error(sourceText(error.message), {
          error,
          report: { operation: "other", source: "system", cause_code: classifyFailure(error.message) },
        });
    },
  );
  createEffect(
    () => workspace.state.host?.hostId,
    () => {
      usageReading.reset();
      view.reset();
      setCreating(false);
      modelsShown = ++modelsRequest;
      setModels([]);
      setStatus(CONNECTING_STATUS);
    },
  );
  createEffect(
    () => ({ status: workspace.state.agentStatus, models: workspace.state.models }),
    (value) => {
      if (value.status) setStatus(value.status);
      showModels(++modelsRequest, value.models);
    },
  );
  function select(id: string) {
    userOpensChat("agent", id);
    return openAgentChat(id);
  }
  async function openAgentChat(id: string) {
    setCreating(false);
    setHeldUnreadAgentId(null);
    showAgents();
    setMessageFocusRequest(null);
    channels.close();
    await workspace.select(id);
  }
  function openChannel(id: string, edit = false) {
    userOpensChat("channel", id);
    setMobilePane("conversation");
    showAgents();
    void (edit ? channels.editChannel(id) : channels.open(id));
  }
  async function openAddedAgent(agent: AddedAgent) {
    setMobilePane("conversation");
    await workspace.run(async () => {
      await workspace.refresh();
      await select(agent.id);
    });
  }
  const [previousHostId, setPreviousHostId] = createSignal<string | null>(null);
  function selectServer(id: string) {
    if (workspace.state.host?.hostId !== id) chatHistory.userOpensServer(id);
    void connectServer(id);
  }
  async function connectServer(id: string): Promise<void> {
    const host = workspace.state.hosts.find((item) => item.hostId === id);
    if (!host) return;
    const current = workspace.state.host?.hostId;
    if (current && current !== id) setPreviousHostId(current);
    await workspace.connect(host);
  }
  function openHistoryChat(entry: WebChatHistoryEntry): boolean {
    if (entry.hostId !== workspace.state.host?.hostId) {
      if (!workspace.state.hosts.some((host) => host.hostId === entry.hostId)) return false;
      setMobilePane("conversation");
      writeChannelSelection(props.accountId, entry.hostId, entry.kind === "channel" ? entry.id : null);
      showAgents();
      void connectServer(entry.hostId).then(() => {
        const hostId = workspace.state.host?.hostId;
        chatHistory.reopen((pending) => pending.kind === "agent" && pending.hostId === hostId);
      });
      return true;
    }
    if (entry.kind === "channel") {
      if (!channels.state.channels.some((channel) => channel.id === entry.id && !channel.archived)) return false;
      setMobilePane("conversation");
      showAgents();
      void channels.open(entry.id);
      return true;
    }
    if (!workspace.state.agents.some((agent) => agent.id === entry.id)) return false;
    setMobilePane("conversation");
    void openAgentChat(entry.id);
    return true;
  }
  const returnHostId = () => {
    const current = workspace.state.host?.hostId;
    const others = workspace.state.hosts.filter((item) => item.hostId !== current);
    return others.find((item) => item.hostId === previousHostId())?.hostId ?? others[0]?.hostId;
  };
  function showAgentsPage() {
    showAgents();
    setMobilePane("workspace");
  }
  function setAgentHidden(agentId: string, hidden: boolean): void {
    const agent = workspace.state.agents.find((candidate) => candidate.id === agentId);
    if (!agent) return;
    const toastId = `agent-hide-${workspace.state.host?.hostId ?? ""}-${agentId}`;
    void workspace.setAgentHidden(agentId, hidden).then(
      (sent) => {
        if (!sent) return;
        if (!hidden) {
          toast.dismiss(toastId);
          return;
        }
        toast(t("agent.hideUndo.title", { name: agent.name }), {
          id: toastId,
          action: { label: t("agent.hideUndo.action"), onClick: () => setAgentHidden(agentId, false) },
        });
      },
      (error: unknown) => {
        actionToast.error(t(hidden ? "agent.error.hideFailed" : "agent.error.restoreFailed"), {
          description: text.errorMessage(error, t("agent.error.hiddenFailed")),
          report: { operation: "agent", source: "action", cause_code: classifyFailure(error) },
        });
      },
    );
  }
  const muteSupported = () =>
    workspace.state.status === "online" && workspace.state.capabilities.includes(AGENT_NOTIFICATION_LEVELS_CAPABILITY);
  function setAgentMuted(agentId: string, muted: boolean): void {
    const hostId = workspace.state.host?.hostId;
    const write = workspace.runtime.setHostAgentNotificationLevel;
    if (!hostId || !write) return;
    void write(hostId, { agentId, level: muted ? "nothing" : null }).then(
      (levels) => {
        notificationSettings.applyLevels(hostId, levels);
        applyAgentLevels(hostId, levels);
      },
      (error: unknown) => {
        actionToast.error(t("agent.error.muteFailed"), {
          description: text.errorMessage(error, t("agent.error.hiddenFailed")),
          report: { operation: "agent", source: "action", cause_code: classifyFailure(error) },
        });
      },
    );
  }
  const hideSupported = () =>
    workspace.state.status === "online" &&
    workspace.state.capabilities.includes(AGENT_HIDDEN_CAPABILITY) &&
    canAdministerServer(workspace.state.host?.role);
  function startCreate() {
    setMobilePane("conversation");
    channels.close();
    showAgents();
    setCreating(true);
  }
  useWorkspaceShortcuts({
    newAgent: () => {
      if (!createSupported()) return false;
      startCreate();
      return true;
    },
    toggleSidebar: () => {
      if (phone()) return false;
      if (layout.sidebarClosed()) layout.expandSidebar();
      else closeSidebar();
      return true;
    },
    showShortcuts: () => {
      setKeyboardFocusRequest(++keyboardFocusNonce);
      openAccountSettings();
      return true;
    },
  });
  const railPage = (): PageRailPage | null => {
    const current = page();
    if (current === "agents") return "agents";
    if (current === "server-settings") return serverSettingsShownSection() === "providers" ? "providers" : null;
    return current === "pricing" ? null : current;
  };
  const settingsKind = (): SettingsKind | null =>
    page() === "settings" ? "personal" : page() === "server-settings" ? "server" : null;
  function openRoutine(routine: ScheduleRoutine): void {
    setMobilePane("conversation");
    if (routine.owner.kind === "channel") {
      showAgents();
      userOpensChat("channel", routine.owner.channelId);
      void channels.editChannel(routine.owner.channelId);
      return;
    }
    const agentId = routine.owner.agentId;
    void select(agentId);
    setSettingsRequest({ agentId, nonce: Date.now(), routine: { routineId: routine.id, name: routine.name } });
  }
  function createRoutine(agentId: string): void {
    setMobilePane("conversation");
    void select(agentId);
    setSettingsRequest({ agentId, nonce: Date.now(), routine: "new" });
  }
  const unavailable = async (): Promise<never> => {
    throw new Error(t("webClient.error.desktopOnly"));
  };
  const connectionDetail = () => {
    if (workspace.state.hostedSleep === "sleeping" || workspace.state.hostedIssue || hostUpdating()) return null;
    if (workspace.state.hostOffline && workspace.state.host && workspace.state.host.hosted !== true)
      return {
        message: t("server.connection.computerOffline", { name: workspace.state.host.name }),
        reference: workspace.state.connectionError?.reference ?? null,
      };
    return workspace.state.connectionError ?? null;
  };
  const frameConnecting = () =>
    connectionShown() &&
    !fullWindowLoading() &&
    frameFirstLoad() &&
    agentChatOpen() &&
    (connectionPhase() === "loading" || connectionPhase() === "connecting");
  createEffect(frameConnecting, (frame) => {
    if (frame) setLoadingCover(false);
  });
  const conversationLoading = () =>
    workspace.state.status === "online" &&
    !workspace.conversation()?.page &&
    workspace.conversation()?.loading === true;
  const conversationError = () =>
    workspace.state.status === "online" ? (workspace.conversation()?.error ?? null) : null;
  const coverPhase = () => (workspace.state.status === "online" ? "loading" : connectionPhase());
  const connectionNotice = (cover = false) => {
    const phase = cover ? coverPhase : connectionPhase;
    return (
      <ServerConnectionNotice
        name={workspace.state.host?.name ?? t("webClient.notice.findingHosts")}
        initial={cover || !workspace.state.workspaceLoaded || frameFirstLoad()}
        ready={cover ? !fullWindowLoading() : undefined}
        onExited={cover ? () => setLoadingCover(false) : undefined}
        fullWindow={fullWindowLoading()}
        screen={!frameConnecting()}
        loadingScene={startupLoadingScene()}
        issue={workspace.state.hostedIssue}
        start={workspace.state.hostedStart}
        updateVersion={workspace.state.hostRestart?.version ?? null}
        detail={connectionDetail()?.message ?? null}
        reference={connectionDetail()?.reference ?? null}
        phase={phase()}
        remainingSeconds={
          workspace.state.recovery?.phase === "waiting" || workspace.state.recovery?.phase === "cooldown"
            ? workspace.state.recovery.remainingSeconds
            : 0
        }
        busy={workspace.state.status === "connecting" || !workspace.state.host}
        onRetry={() => void workspace.run(workspace.reconnect)}
        onWaitedLong={cover ? setLoadingWaitedLong : undefined}
        onManage={() => setBillingOpen(true)}
        upsell={offlineUpsell()}
      />
    );
  };
  return (
    <ConversationControllerProvider controller={controller}>
      <ChannelsControllerProvider controller={channels}>
        <Show
          when={!workspace.state.otherTab}
          fallback={
            <div class="web-other-tab-window">
              <Show when={servers().length > 1}>
                <ServerRail servers={servers()} onSelect={selectServer} onReorder={workspace.reorderHosts} />
              </Show>
              <WebServerOtherTab
                name={workspace.state.host?.name ?? ""}
                busy={workspace.state.status === "connecting"}
                onUseHere={() => void workspace.run(workspace.useHere)}
              />
            </div>
          }
        >
          <WindowBackdrop pages="srcdoc" />
          <div
            class="app-window web-app-window"
            data-loading-waited-long={loadingCover() && loadingWaitedLong() ? "" : undefined}
          >
            <PageRail
              hidden={false}
              logo={{ variant: "production", href: "/" }}
              current={railPage()}
              pinned={layout.railPinned()}
              onPinChange={layout.setRailPinned}
              usageRows={usageRows()}
              onAgents={showAgentsPage}
              onTasks={
                tasksSupported()
                  ? (button) => {
                      const id = server()?.id;
                      if (id) void openHostPage(id, "tasks", button);
                    }
                  : undefined
              }
              onSchedule={(button) => {
                const id = server()?.id;
                if (id) void openHostPage(id, "schedule", button);
              }}
              onWorkflows={workflowsRailAction()}
              onPreloadWorkflows={() => void WorkflowsCanvas.preload()}
              onLibrary={libraryRailAction()}
              onProviders={providersRailAction()}
              onCrm={crmRailAction()}
              onCrmConnectors={crmConnectorsAction()}
              onUsage={(button) => {
                const id = server()?.id;
                if (id) void openHostPage(id, "usage", button);
              }}
              mediaCredits={mediaCredits()}
              onMediaCredits={(provider) => {
                setSuggestedApp({ appId: provider, connect: false });
                openMarketplace();
              }}
              onCredits={creditsRailAction()}
              creditBalance={creditsMenu().state?.balance}
              onMarketplace={workspace.state.status === "online" ? openMarketplace : undefined}
              onSettings={openAccountSettings}
              server={
                <ServerMenu
                  rail
                  serverName={workspace.state.host?.name ?? "OpenBot"}
                  servers={servers()}
                  view={layout.serverView()}
                  onViewChange={layout.setServerView}
                  onSelect={selectServer}
                  onAdd={() => hostedServers.openAddServer("server_rail")}
                  addCreatesServer={hostedServers.available()}
                  credits={creditsMenu()}
                  {...serverActionCallbacks}
                />
              }
              help={
                <RailHelpMenu
                  version={null}
                  onOpenWhatsNew={() => void openWebDestination("changelog")}
                  onOpenLink={(destination) => void openWebDestination(destination)}
                />
              }
            />
            <WorkspaceFrame
              class="web-app-frame"
              data-web-mobile-pane={mobilePane()}
              compact={compact()}
              blockedServer={blockedServer()}
              paywall={paywall}
              planDeletesAt={hostedServers.planDeletesAt}
              onRenewPlan={hostedServers.renewPlan}
              initialLoading={hostOffline()}
              connection={
                <>
                  <Show when={connectionShown() && !fullWindowLoading()}>{connectionNotice()}</Show>
                  <Show when={workspace.state.status === "online" && workspace.state.panelsFailed}>
                    <ServerPanelLoadNotice
                      busy={workspace.state.panelsLoading}
                      onRetry={() => void workspace.retryPanels()}
                    />
                  </Show>
                  <Show
                    when={(workspace.state.status === "online" || workspace.state.workspaceLoaded) && agentChatOpen()}
                  >
                    <ConversationLoadNotice
                      name={workspace.selected()?.name ?? ""}
                      loading={frameConnecting() || conversationLoading()}
                      immediate={frameConnecting()}
                      error={conversationError()}
                      onRetry={() => {
                        const id = workspace.state.selectedId;
                        if (id) void workspace.select(id);
                      }}
                    />
                  </Show>
                </>
              }
              onRetryServer={(serverId) =>
                workspace.run(async () => {
                  void hostedServers.refresh();
                  const host = workspace.state.hosts.find((item) => item.hostId === serverId);
                  if (host) await workspace.connect(host);
                })
              }
              windowPage={page()}
              page={
                <Show
                  when={
                    page() === "usage" ||
                    page() === "schedule" ||
                    page() === "workflows" ||
                    page() === "library" ||
                    page() === "crm"
                      ? server()
                      : undefined
                  }
                  fallback={
                    <Show
                      when={settingsKind()}
                      keyed
                      fallback={
                        <Show
                          when={creditsOpen()}
                          keyed
                          fallback={
                            <MarketplaceOverlay
                              open={page() === "marketplace"}
                              onOpenChange={setMarketplaceOpen}
                              calls={marketplaceCalls}
                              browserRuntime={workspace.runtime.browser}
                              connectors={connectors}
                              server={server()}
                              agents={workspace.shownAgents()}
                              activeAgentId={workspace.state.selectedId ?? ""}
                              composerAvailable={status().phase === "ready" && !agentFormOpen()}
                              onOpenAgent={(agentId) => {
                                setMobilePane("conversation");
                                if (agentId !== workspace.state.selectedId) void select(agentId);
                                else {
                                  userOpensChat("agent", agentId);
                                  setCreating(false);
                                  showAgents();
                                  channels.close();
                                }
                              }}
                              onAgentInstalled={async (agent) => {
                                setMarketplaceOpen(false);
                                await openAddedAgent(agent);
                              }}
                              pluginSlug={suggestedApp()?.appId ?? props.pluginSlug}
                              pluginConnect={suggestedApp()?.connect ?? false}
                              onPluginSlugConsumed={() => {
                                if (suggestedApp()) setSuggestedApp(null);
                                else props.onPluginSlugConsumed?.();
                              }}
                              marketplaceListing={props.marketplaceListing}
                              onMarketplaceListingConsumed={props.onMarketplaceListingConsumed}
                              mcpSignInRequest={mcpSignInRequest()}
                              onMcpSignInRequestHandled={() => setMcpSignInRequest(null)}
                              onMcpSignIns={(serverId, states) => setMcpSignIns({ serverId, states })}
                            />
                          }
                        >
                          {(request) => (
                            <BuyCreditsPage
                              store={credits}
                              initialServerId={request.serverId}
                              headerFrame="window"
                              billingDetails={billingCalls}
                              onClose={showAgents}
                            />
                          )}
                        </Show>
                      }
                    >
                      {(kind) => (
                        <SettingsPageFrame
                          heading={
                            kind === "personal" ? (
                              <h1 class="settings-page-title" tabindex={-1}>
                                {t("app.settingsPage.title")}
                              </h1>
                            ) : (
                              <Show when={server()}>{(target) => <ServerSettingsPageTitle server={target()} />}</Show>
                            )
                          }
                          footer={
                            kind === "personal" ? (
                              <Show when={server()}>
                                {(target) => (
                                  <ServerSettingsLink
                                    server={target()}
                                    onOpen={() => void openServerSettings(target().id, null)}
                                  />
                                )}
                              </Show>
                            ) : (
                              <PersonalSettingsLink account={account()} onOpen={openAccountSettings} />
                            )
                          }
                          onMounts={(mounts) => {
                            setSettingsMounts(mounts);
                            if (!mounts) setServerSettingsQuery("");
                          }}
                          onEscape={() => {
                            if (kind === "server" && serverSettingsQuery()) setServerSettingsQuery("");
                            else showAgents();
                          }}
                          onClose={showAgents}
                        >
                          <Show when={kind === "server"}>
                            <SettingsSearchField
                              value={serverSettingsQuery()}
                              onInput={setServerSettingsQuery}
                              onEnter={() =>
                                openFirstSettingsSection(
                                  settingsMounts()?.nav,
                                  () => setOpenFirstServerSectionRequest((request) => request + 1),
                                  serverSettingsQuery,
                                )
                              }
                            />
                          </Show>
                        </SettingsPageFrame>
                      )}
                    </Show>
                  }
                >
                  {(target) => (
                    <Switch
                      fallback={
                        <Loading>
                          <AgentUsagePanel
                            port={usageCalls}
                            serverId={target().id}
                            hostName={target().name}
                            onBack={closeHostPage}
                          />
                        </Loading>
                      }
                    >
                      <Match when={page() === "workflows"}>
                        <Show when={target().id} keyed>
                          {(serverId) => (
                            <Loading>
                              <WorkflowsCanvas
                                host={workflowHost}
                                serverId={serverId}
                                admin={canAdministerServer(workspace.state.host?.role)}
                                agents={workspace.profiles()}
                                models={models()}
                                status={providerAdmin.status()}
                                self={account().name ?? undefined}
                                agentProgress={(agentId) =>
                                  workflowAgentProgress(
                                    agentId,
                                    workspace.state.progress[agentId],
                                    workspace.stepLines(),
                                  )
                                }
                              />
                            </Loading>
                          )}
                        </Show>
                      </Match>
                      <Match when={page() === "library"}>
                        <Show when={target().id} keyed>
                          {(serverId) => (
                            <Loading>
                              <ServerLibrary
                                serverId={serverId}
                                server={server()}
                                calls={() => storageCalls}
                                levels={hostAgentLevels}
                                onShowInChat={(agentId, messageId) => void openMessage(agentId, messageId)}
                                onOpenUrl={(url) => void openWebLink(url)}
                                mediaSource={runtime.attachmentMedia}
                                opensFiles={false}
                              />
                            </Loading>
                          )}
                        </Show>
                      </Match>
                      <Match when={page() === "crm"}>
                        <Show when={target().id} keyed>
                          {(serverId) => (
                            <Loading>
                              <CrmScreen
                                serverId={serverId}
                                host={crmHost}
                                agents={workspace.profiles()}
                                connectors={{
                                  requested: () => crmConnectorsRequest() === serverId,
                                  taken: () => setCrmConnectorsRequest(undefined),
                                }}
                              />
                            </Loading>
                          )}
                        </Show>
                      </Match>
                      <Match when={page() === "schedule"}>
                        <Loading>
                          <ScheduleView
                            serverId={target().id}
                            hostName={target().name}
                            onBack={closeHostPage}
                            source={scheduleSource}
                            agents={workspace.profiles()}
                            channels={channels.state.channels}
                            channelsSupported={channels.supported()}
                            onOpenAgent={(agentId) => {
                              setMobilePane("conversation");
                              void select(agentId);
                            }}
                            onOpenRoutine={openRoutine}
                            onCreateRoutine={createRoutine}
                            routinePorts={scheduleRoutinePorts(target(), runtime)}
                          />
                        </Loading>
                      </Match>
                    </Switch>
                  )}
                </Show>
              }
              left={
                <>
                  <Show when={layout.serverRailVisible()}>
                    <ServerRail
                      servers={servers()}
                      onSelect={selectServer}
                      onReorder={workspace.reorderHosts}
                      onAdd={() => hostedServers.openAddServer("server_rail")}
                      addCreatesServer={hostedServers.available()}
                      {...serverActionCallbacks}
                    />
                  </Show>
                  <Show when={!planScreenShown() && !paywall.server()}>
                    <Sidebar
                      agentsConnecting={!noHost() && !workspace.state.agentsLoaded}
                      channels={sidebarChannels().filter((channel) => !channel.archived)}
                      deletedChannels={sidebarChannels().filter((channel) => channel.archived)}
                      activeChannelId={tasksOpen() ? null : channels.state.selectedId}
                      onSelectChannel={openChannel}
                      onEditChannel={(id) => openChannel(id, true)}
                      onDeleteChannel={channels.deletionSupported() ? channels.remove : undefined}
                      onRestoreChannel={channels.deletionSupported() ? channels.restore : undefined}
                      showingArchivedChannels={channelsListed() && channels.state.archived}
                      onToggleArchivedChannels={channelsListed() ? channels.toggleArchived : undefined}
                      onCreateChannel={channelsListed() ? channels.create : undefined}
                      onMarkAllRead={
                        workspace.state.status === "online"
                          ? () => {
                              void workspace.markAllRead().catch(() =>
                                actionToast.error(t("chat.unread.markReadFailed"), {
                                  report: { operation: "other", source: "action", cause_code: "unknown" },
                                }),
                              );
                              if (channelsSupported()) void channels.markAllRead();
                            }
                          : undefined
                      }
                      unreadAgentIds={sidebarUnreadAgentIds()}
                      onMarkAgentRead={markSidebarAgentRead()}
                      onMarkAgentUnread={markSidebarAgentUnread()}
                      hasUnread={
                        workspace.state.agents.some(
                          (agent) =>
                            !pausedAgentIds().has(agent.id) && (workspace.state.reads[agent.id]?.unreadCount ?? 0) > 0,
                        ) || channels.hasUnread()
                      }
                      serverName={workspace.state.host?.name ?? "OpenBot"}
                      serverUpdate={(() => {
                        const id = server()?.id;
                        const badge = id ? serverUpdateBadge(id) : null;
                        return id && badge ? { ...badge, onOpen: () => void showServerUpdate(id) } : undefined;
                      })()}
                      serverMenu={{
                        servers: servers(),
                        view: layout.serverView(),
                        onViewChange: layout.setServerView,
                        onSelect: selectServer,
                        onAdd: () => hostedServers.openAddServer("server_rail"),
                        addCreatesServer: hostedServers.available(),
                        credits: creditsMenu(),
                        ...serverActionCallbacks,
                      }}
                      agents={workspace.profiles()}
                      activeAgentId={sidebarActiveAgentId()}
                      agentThreads={sidebarThreads()}
                      people={[]}
                      directThreads={[]}
                      activeDirectMemberId={null}
                      agentStates={sidebarAgentStates()}
                      channelWaits={sidebarChannelWaitStates()}
                      channelPreviewsPending={!channels.state.listed}
                      agentMoods={sidebarAgentMoods()}
                      layout={workspace.state.sidebarLayout}
                      layoutMutable={
                        workspace.state.status === "online" && workspace.state.capabilities.includes("sidebar-layout")
                      }
                      foldersSupported={
                        workspace.state.status === "online" &&
                        workspace.state.capabilities.includes("sidebar-folders-v1")
                      }
                      chatOrder={layout.sidebarChatOrder()}
                      onChatOrderChange={layout.setSidebarChatOrder}
                      collapsedSectionIds={workspace.preferences.collapsedSidebarSectionIds()}
                      onMutateLayout={workspace.mutateSidebarLayout}
                      sectionDuplicateSupported={
                        workspace.state.status === "online" &&
                        workspace.state.capabilities.includes("agent-duplication") &&
                        workspace.state.capabilities.includes("sidebar-layout")
                      }
                      duplicatingSectionIds={workspace.duplicatingSectionIds()}
                      onDuplicateSection={workspace.duplicateSection}
                      onToggleSection={workspace.preferences.toggleSidebarSection}
                      pinnedItems={workspace.preferences.pinnedSidebarItems()}
                      peopleOrder={[]}
                      onPin={workspace.preferences.pinSidebarItem}
                      onUnpin={workspace.preferences.unpinSidebarItem}
                      onReorderPinned={workspace.preferences.reorderPinnedSidebarItems}
                      onReorderPeople={() => {}}
                      onSelectAgent={(id) => {
                        if (id === sidebarActiveAgentId() && !pageCovered())
                          agentThreads()?.tabs.open(id, MAIN_THREAD_ID);
                        setMobilePane("conversation");
                        void select(id);
                      }}
                      onSelectPerson={() => {}}
                      onCreateAgent={startCreate}
                      createSupported={createSupported()}
                      onEditAgent={(id) => {
                        setMobilePane("conversation");
                        void select(id);
                        setSettingsRequest({ agentId: id, nonce: Date.now() });
                      }}
                      duplicateSupported={
                        workspace.state.status === "online" &&
                        workspace.state.capabilities.includes("agent-duplication")
                      }
                      duplicatingAgentIds={new Set(workspace.state.duplicatingAgentIds)}
                      onDuplicateAgent={workspace.duplicateAgent}
                      deleteSupported={
                        workspace.state.status === "online" && canAdministerServer(workspace.state.host?.role)
                      }
                      marketplaceSupported={workspace.state.status === "online"}
                      onDeleteAgent={workspace.deleteAgent}
                      userHiddenAgents={workspace.state.userHiddenAgents}
                      userHiddenAgentsWork={hiddenAgentsWork()}
                      mutedAgentIds={muteSupported() ? mutedAgentIds(workspace.state.host?.hostId) : undefined}
                      onSetAgentMuted={muteSupported() ? setAgentMuted : undefined}
                      onHideAgent={hideSupported() ? (agentId) => setAgentHidden(agentId, true) : undefined}
                      onRestoreAgent={hideSupported() ? (agentId) => setAgentHidden(agentId, false) : undefined}
                      compact={compact()}
                      onExpand={layout.expandSidebar}
                      onCollapse={collapseSidebar()}
                      onOpenSearch={() => setSearchOpen(true)}
                      onOpenMarketplace={openMarketplace}
                      footer={
                        <>
                          <SidebarAlertCards
                            cards={alertCards}
                            serverName={server()?.name ?? ""}
                            members={workspace.state.presence?.members ?? []}
                            onOpenStorage={(serverId) => void openServerSettings(serverId, null, "storage")}
                          />
                          <Show when={!alertCards.shown() && !communityCard.dismissed()}>
                            <SidebarCommunityCard
                              onJoinDiscord={() => void openWebDestination("discord")}
                              onFollowX={() => void openWebDestination("x")}
                              onDismiss={communityCard.dismiss}
                            />
                          </Show>
                        </>
                      }
                      emptyAction={
                        firstAgent()
                          ? {
                              label: t("sidebar.empty.firstAgent"),
                              avatarSeed: agentAvatar().avatarSeed,
                              avatarHue: agentAvatar().avatarHue,
                              avatarColor: agentAvatar().avatarColor ?? null,
                              onSelect: startCreate,
                            }
                          : undefined
                      }
                    />
                  </Show>
                  <WebMobileNavigation activePane={mobilePane()} onChange={setMobilePane} />
                </>
              }
              after={
                <>
                  <ServerUpdateDialogHost hosts={workspace.hostViews()} />
                  <ServerPlanReminder
                    servers={servers()}
                    planDeletesAt={hostedServers.planDeletesAt}
                    onRenew={hostedServers.renewPlan}
                  />
                  <HostedServerUpsell
                    accountId={props.accountId}
                    canOffer={
                      hostedServers.available() &&
                      hostedServers.loaded() &&
                      !hostedServers.ownsHostedServer() &&
                      server()?.role === "owner" &&
                      server()?.hosted !== true
                    }
                    serverId={server()?.id ?? ""}
                    host={{ name: server()?.name ?? "" }}
                    busy={(agentId) => Boolean(workspace.state.conversations[agentId]?.page?.activeTurnId)}
                    openPlans={() => hostedServers.openAddServer("upsell")}
                    track={(action, entryPoint) =>
                      desktopAnalytics.track("hosted_server_upsell", { action, entry_point: entryPoint })
                    }
                  />
                  <AddServerOverlay
                    open={hostedServers.addServer() !== null}
                    entryPoint={hostedServers.addServer()?.entryPoint}
                    order={hostedServers.addServer()?.order}
                    calls={hostedServers.calls}
                    servers={servers()}
                    onRefreshServers={workspace.retryHosts}
                    resume={hostedServers.addServer()?.resume}
                    license={licenseCalls}
                    billingDetails={billingCalls}
                    onOpenUrl={(url) => window.open(url, "_blank", "noopener")}
                    onClose={hostedServers.closeAddServer}
                    onOpenServer={(serverId) => {
                      hostedServers.closeAddServer();
                      setBillingOpen(false);
                      selectServer(serverId);
                    }}
                    onContactUs={() => window.location.assign(HOSTED_SERVER_CONTACT_URL)}
                    onJoinWithInvite={() => {
                      hostedServers.closeAddServer();
                      setJoinOpen(true);
                    }}
                    onManageServers={() => setBillingOpen(true)}
                  />
                  <Show when={workspace.runtime.ownerTransfers}>
                    {(transfers) => (
                      <OwnerTransferPrompt
                        calls={{
                          list: () => transfers().incoming(),
                          accept: (transferId) => transfers().accept(transferId),
                          decline: (transferId) => transfers().decline(transferId),
                        }}
                        reloadKey={workspace.state.hosts}
                        onAccepted={() => void workspace.refreshHosts().catch(() => undefined)}
                      />
                    )}
                  </Show>
                  <JoinServerOverlay
                    open={joinOpen()}
                    inviteUrl={props.inviteUrl ?? ""}
                    accountEmail={props.accountEmail ?? ""}
                    onClose={() => {
                      setJoinOpen(false);
                      props.onInviteClose?.();
                    }}
                    onPreview={({ inviteUrl }) => workspace.runtime.previewInvite(inviteUrl)}
                    onJoin={({ inviteUrl }) => workspace.joinInvite(inviteUrl)}
                  />
                  <Show when={accountSettingsLoaded()}>
                    <Loading>
                      <WebAccountSettings
                        open={accountSettingsOpen() && settingsPlacement("personal") !== undefined}
                        page={settingsPlacement("personal")}
                        onOpenChange={setAccountSettingsOpen}
                        account={account()}
                        calls={accountCalls}
                        liveVoiceAccount={liveVoiceAccount()}
                        language={props.language}
                        onChangeLanguage={props.onChangeLanguage}
                        appearance={props.appearance}
                        onChangeAppearance={props.onChangeAppearance}
                        onOpenBilling={() => setBillingOpen(true)}
                        referral={referralCalls}
                        onSignOut={signOut}
                        notifications={notificationSettings}
                        notificationFocusRequest={notificationFocusRequest()}
                        keyboardFocusRequest={keyboardFocusRequest()}
                      />
                    </Loading>
                  </Show>
                  <SharedAgentInstallOverlay
                    templateId={props.agentTemplateId}
                    server={server()}
                    calls={agentTemplateCalls}
                    onOpenLink={(url) => void openWebLink(url)}
                    onClose={() => props.onAgentTemplateClose?.()}
                    onInstalled={openAddedAgent}
                  />
                  <Show when={serverSettingsLoaded() && server()}>
                    {(target) => (
                      <ServerSettingsOverlay
                        open={serverSettings.state.open && settingsPlacement("server") !== undefined}
                        page={settingsPlacement("server")}
                        sectionQuery={serverSettingsQuery()}
                        openFirstSectionRequest={openFirstServerSectionRequest()}
                        onFirstSectionOpened={() => setServerSettingsQuery("")}
                        onOpenMarketplaceApps={() => {
                          setServerSettingsQuery("");
                          openMarketplace();
                        }}
                        restoreFocusTarget={serverSettings.restoreTarget()}
                        initialSection={serverSettingsSection()}
                        initialSectionRequest={serverSettingsRequest()}
                        onSectionChange={setServerSettingsShownSection}
                        platform="darwin"
                        remoteDesktopSupported={false}
                        server={target()}
                        hostStatus={null}
                        members={serverSettings.state.members}
                        invites={serverSettings.state.invites}
                        loading={serverSettings.state.loading}
                        loadError={serverSettings.state.error}
                        onRetry={serverSettings.refresh}
                        onSaveIdentity={serverSettings.saveIdentity}
                        onSaveAppearance={serverSettings.saveAppearance}
                        onSetPublished={unavailable}
                        onRotateHostKey={rotateHostKeyAction()}
                        onCreateInvite={serverSettings.createInvite}
                        ownerTransfer={ownerTransferCalls()}
                        license={licenseCalls}
                        onDownloadDesktopApp={() => void window.open("/download", "_blank", "noopener")}
                        onContactUs={() => window.location.assign(HOSTED_SERVER_CONTACT_URL)}
                        onUpdateMember={serverSettings.updateMember}
                        onRemoveMember={serverSettings.removeMember}
                        onRevokeInvite={serverSettings.revokeInvite}
                        onLeaveServer={() => leaveFromSettings(target().id, false)}
                        onRemoveServer={removeFromSettings(target().id)}
                        onOpenScreenRecordingSettings={unavailable}
                        onRecheckScreenRecording={unavailable}
                        storage={{
                          hostName: target().name,
                          calls: storageCalls,
                          onOpenAgent: (agentId) => {
                            serverSettings.setOpen(false);
                            setMobilePane("conversation");
                            void select(agentId);
                          },
                          onShowMessage: (agentId, messageId) => {
                            serverSettings.setOpen(false);
                            void openMessage(agentId, messageId);
                          },
                        }}
                        hostedSites={
                          workspace.state.capabilities.includes(HOSTED_SITES_CAPABILITY)
                            ? {
                                api: hostedSiteCalls,
                                onOpenSite: (url) => void openWebLink(url),
                                onSeePlans: canOfferServerPlans() ? openServerPlans : undefined,
                              }
                            : undefined
                        }
                        providers={providerSettings()}
                        hostUpdate={{ calls: hostUpdateCalls }}
                        hostTimezone={{ calls: hostTimezoneCalls }}
                        hostVoiceModel={{ calls: hostVoiceModelCalls }}
                        hostTurnLimits={{ calls: hostTurnLimitsCalls }}
                        hostPersonality={{ calls: hostPersonalityCalls }}
                        hostMemoryLimit={{ calls: hostMemoryLimitCalls }}
                        memoryReview={{ calls: hostMemoryReviewCalls }}
                        skillLearning={{ calls: hostSkillLearningCalls }}
                        browsingMemory={{ calls: hostBrowsingMemoryCalls }}
                        hostPromptCacheTtl={{ calls: hostPromptCacheTtlCalls }}
                        claudeUserSetup={{ calls: hostClaudeUserSetupCalls }}
                        claudeCompactWindow={{ calls: hostClaudeCompactWindowCalls }}
                        providerEnvironment={{ calls: hostProviderEnvironmentCalls }}
                        hostModelVisibility={{ calls: hostModelVisibilityCalls }}
                        hostDefaultProvider={{ calls: providerAdmin.hostDefaultProviderCalls }}
                        agentAccess={{ calls: hostAgentAccessCalls, listAgents: () => workspace.runtime.listAgents() }}
                        serverAudit={{ calls: hostServerAuditCalls, listAgents: () => workspace.runtime.listAgents() }}
                        agentDefaults={{
                          calls: hostAgentDefaultsCalls,
                          listAgents: () => workspace.runtime.listAgents(),
                          onAgentsChanged: (listener) =>
                            workspace.onHostEvent((event) => {
                              if (event.type === "agents-changed") listener(workspace.state.host?.hostId ?? "");
                            }),
                        }}
                        browserProfiles={browserProfileSettings()}
                        vault={vaultSettings()}
                        crm={crmHost}
                        instanceTransfer={instanceTransferSettings()}
                        agentImport={
                          workspace.state.capabilities.includes(AGENT_IMPORT_CAPABILITY)
                            ? {
                                calls: agentImportCalls,
                                onOpenAgent: (agentId) => {
                                  serverSettings.setOpen(false);
                                  setMobilePane("conversation");
                                  void select(agentId);
                                },
                                onClose: () => serverSettings.setOpen(false),
                              }
                            : undefined
                        }
                      />
                    )}
                  </Show>
                  <LeaveServerDialog
                    server={leaveServer()}
                    removeOwned={leaveRequest()?.removeOwned ?? false}
                    onClose={() => setLeaveRequest(null)}
                    onLeave={leaveHost}
                    restoreFocusTarget={leaveRequest()?.trigger}
                  />
                  <RestartServerDialog
                    server={restartServer()}
                    servers={servers()}
                    onClose={() => setRestartRequest(null)}
                    onRestart={restartHost}
                    restoreFocusTarget={restartRequest()?.trigger}
                  />
                  <BillingDialog
                    open={billingOpen()}
                    onOpenChange={(open) => {
                      setBillingOpen(open);
                      if (!open) setLicenseStart(null);
                    }}
                    store={billing}
                    hostedServers={billingHostedServers}
                    license={
                      <LicenseSection
                        store={license}
                        onManagePayment={() => void billing.openPortal({ flow: "manage" })}
                        onContactUs={licenseContactUs(() => window.location.assign(HOSTED_SERVER_CONTACT_URL))}
                        startBuying={licenseStart() !== null}
                        startOrder={licenseStart()?.order ?? undefined}
                        billingDetails={billingCalls}
                      />
                    }
                    credits={
                      <>
                        <CreditsSection
                          store={credits}
                          onBuy={(serverId) => {
                            setBillingOpen(false);
                            openCredits(serverId);
                          }}
                        />
                        <CreditActivitySection store={credits} />
                      </>
                    }
                  />
                  <ServerUpgradeOffer
                    billing={billingCalls}
                    card={alertCards.storageCard.card()}
                    server={server()}
                    blocked={serverSettings.state.open || billingOpen() || accountSettingsOpen()}
                    onFreeUpSpace={(serverId) => void openServerSettings(serverId, null, "storage")}
                  />
                  <ChannelCreateOverlay />
                  <GlobalSearchOverlay
                    open={searchOpen()}
                    agents={searchAgents()}
                    channels={
                      channels.supported() ? globalSearchChannels(channels.state.channels, text.sourceText) : undefined
                    }
                    onSearchMessages={searchAllMessages}
                    onSearchFiles={fileSearch()}
                    routines={searchRoutines()}
                    routinesLoading={searchRoutinesLoading()}
                    onSelectRoutine={selectSearchRoutine}
                    onOpenChange={setSearchOpen}
                    onSelectAgent={(id) => {
                      setMobilePane("conversation");
                      void select(id);
                    }}
                    onSelectChannel={openChannel}
                    onSelectMessage={openSearchHit}
                  />
                </>
              }
            >
              <Show when={tasksOpen() ? server() : undefined}>
                {(target) => (
                  <Loading>
                    <TasksView
                      serverId={target().id}
                      hostName={target().name}
                      onBack={closeHostPage}
                      source={tasksSource}
                      responseStyle={responseStyle()}
                      mediaSource={runtime.attachmentMedia}
                      files={{
                        accepted: () => workspace.state.capabilities.includes(AGENT_THREAD_FILES_CAPABILITY),
                        import: (data, serverId) => runtime.agent.importAttachmentData(data, serverId),
                        discard: (id, serverId) => runtime.agent.discardDraftAttachment(id, serverId),
                      }}
                      agents={workspace.profiles()}
                      onOpenLink={(url) => void openWebLink(url)}
                      onAttachmentAction={(attachment) =>
                        void runtime.agent
                          .openAttachment({ attachmentId: attachment.id, action: "download" })
                          .catch((error) => actionToast.error(text.errorMessage(error, t("attachment.error.download"))))
                      }
                      approvals={workspace.state.approvals}
                      onRespondApproval={async (approval, decision) => {
                        await workspace.approve({ requestId: approval.requestId, decision });
                        return true;
                      }}
                      onRead={(input, messageId) =>
                        agentThreads()?.tasks.markTaskRead(input.agentId, input.taskId, messageId)
                      }
                      waitsForAnswer={(task) =>
                        workspace.state.prompts.some(
                          (prompt) => prompt.agentId === task.agentId && prompt.threadId === task.threadId,
                        ) ||
                        workspace.state.takeovers.some(
                          (request) => request.agentId === task.agentId && request.threadId === task.threadId,
                        )
                      }
                      onOpenInChat={(task) => {
                        agentThreads()?.tabs.open(task.agentId, task.id);
                        setMobilePane("conversation");
                        void select(task.agentId);
                      }}
                      sendShortcut={deviceSendShortcut()}
                    />
                  </Loading>
                )}
              </Show>
              <Show when={tasksOpen() ? undefined : serverOnboarding()}>
                {(settings) => (
                  <Loading>
                    <ServerOnboarding
                      serverName={server()?.name ?? ""}
                      setup={hostSetupProviderProps(settings())}
                      onContinue={(provider, model) => {
                        const id = server()?.id;
                        if (id)
                          setServerSetupChoices((current) => ({
                            ...current,
                            [id]: { preferredProvider: provider, preferredModel: model },
                          }));
                      }}
                      onClose={
                        returnHostId()
                          ? () => {
                              const id = returnHostId();
                              if (id) selectServer(id);
                            }
                          : undefined
                      }
                    />
                  </Loading>
                )}
              </Show>
              <Show when={!tasksOpen() && agentFormOpen() && !serverOnboarding()}>
                <WebAgentSettings
                  runtime={workspace.runtime}
                  capabilities={workspace.state.capabilities}
                  first={firstAgent()}
                  preference={serverSetupChoice()}
                  customProviders={providerSettings()?.customProviders}
                  onManageProviders={providerSettings() ? openProviderSettings : undefined}
                  liveModels={models()}
                  liveStatus={providerAdmin.status()}
                  accountChoice={agentAccountChoice()}
                  accountUsage={agentAccountUsage()}
                  initialDraft={{ ...createFirstAgentDraft(), ...untrack(agentAvatar) }}
                  onDraftChange={({ avatarSeed, avatarHue, avatarColor }) =>
                    setAgentAvatar({ avatarSeed, avatarHue, avatarColor })
                  }
                  onClose={() => setCreating(false)}
                  onSaved={async (agentId) => {
                    await workspace.refresh();
                    setAgentAvatar(newAgentAvatar());
                    await select(agentId);
                  }}
                />
              </Show>
              <Show when={!tasksOpen() && !agentFormOpen() && channelOpen()}>
                <Show when={channels.state.selectedId} keyed>
                  {(channelId) => {
                    const isOwnSender = (senderId: string) =>
                      isReaderAuthor(senderId, {
                        memberId: workspace.state.memberId,
                        accountUserId: props.accountId,
                        onOwnComputer: false,
                      });
                    const channelView = createChannelConversation({
                      channelId,
                      isOwnSender,
                      connectionReady: () => workspace.state.status === "online",
                      routines: {
                        localHost: () => false,
                        onceSchedule: routinesOnceEnabled,
                        eventsServerId: () => undefined,
                        routineRecovery: () => false,
                        webhookTests: () => false,
                        webhookSenderSecret: () => false,
                      },
                      approvals: () => workspace.state.approvals,
                      takeovers: () => workspace.state.takeovers,
                      prompts: () => workspace.state.prompts,
                      pausedAgentIds,
                    });
                    return (
                      <Conversation
                        runtime={runtime}
                        channel={channelView.source}
                        notice={<ChannelErrorNotice />}
                        connectors={connectors}
                        agentStatus={workspace.state.status === "online" ? providerAdmin.status() : CONNECTING_STATUS}
                        agent={undefined}
                        agents={workspace.profiles()}
                        mentionAgents={channelView.mentionAgents()}
                        modelOptions={[]}
                        messages={channelView.messages()}
                        unreadCount={channelView.unreadCount()}
                        firstUnreadMessageId={channelView.firstUnreadMessageId()}
                        loaded={channelView.loaded()}
                        hasOlder={channelView.hasOlder()}
                        unloadedHistory={channelView.unloadedHistory()}
                        activeTurnId={channelView.activeTurnId()}
                        skillsMarketplaceOpen={marketplaceOpen()}
                        mcpSettingsOpen={marketplaceOpen()}
                        globalOverlayOpen={joinOpen() || serverSettings.state.open || searchOpen() || marketplaceOpen()}
                        settingsRequest={channelView.settingsRequest()}
                        messageFocusRequest={messageFocusRequest()}
                        queue={undefined}
                        browserRuntime={workspace.runtime.browser}
                        browserTabs={workspace.state.browserTabs}
                        activeBrowserTabId={workspace.state.activeBrowserTabId}
                        browserVisibilitySuspended={workspace.state.status !== "online" || pageCovered()}
                        workspaceCovered={pageCovered() || hostOffline()}
                        browserControlState={workspace.state.browserControlState}
                        server={server()}
                        presence={
                          workspace.state.presence ?? { serverId: server()?.id ?? null, members: [], updatedAt: "" }
                        }
                        currentUserEmail={props.accountEmail ?? ""}
                        isOwnSender={isOwnSender}
                        browserEnabled={browserEnabled()}
                        remoteDesktopEnabled={false}
                        remoteDesktopSessionActive={false}
                        remoteDesktopVisible={false}
                        prompt={channelView.prompt()}
                        promptUiBlock={channelView.promptUiBlock()}
                        approval={channelView.approval()}
                        browserTakeover={channelView.browserTakeover()}
                        onOpenMcpSignIn={openMcpSignInFromChat()}
                        mcpSignedIn={mcpSignedIn}
                        refreshMcpSignIns={refreshMcpSignInsFromChat}
                        onSelectAgent={(id) => {
                          setMobilePane("conversation");
                          void select(id);
                        }}
                        onUpdateAgent={async (agentId, updates) => {
                          await updateRemoteAgent(
                            remoteAgentAdmin,
                            { agentId, ...updates },
                            workspace.runtime.updateAgent,
                          );
                          await workspace.refresh();
                        }}
                        onSetAgentAvatar={async (agentId, image) => {
                          await workspace.runtime.setAvatar(agentId, image);
                          await workspace.refresh();
                        }}
                        onSendMessage={(text, attachments, replyTo, target, clientMessageId) => {
                          requestWebNotificationPermission();
                          return channelView.onSendMessage(text, attachments, replyTo, target, clientMessageId);
                        }}
                        onMarkRead={channelView.onMarkRead}
                        onLoadOlder={channelView.onLoadOlder}
                        onTypingChange={() => {}}
                        onAnswerPrompt={channelView.onAnswerPrompt}
                        onRespondToApproval={channelView.onRespondToApproval}
                        onRespondToBrowserTakeover={channelView.onRespondToBrowserTakeover}
                        onCancelQueuedMessage={() => {}}
                        onSteerQueuedMessage={() => {}}
                        onUpdateQueuedMessage={() => Promise.resolve(false)}
                        onReorderQueue={() => {}}
                        onActivateBrowserTab={workspace.activateBrowserTab}
                        onCloseBrowserTab={(tabId) => workspace.runtime.closeBrowserTab(tabId)}
                        onOpenRemoteDesktop={unavailable}
                        onStop={channelView.onStop}
                        onDeleteMessage={channelView.deleteMessageAction()}
                        canDeleteMessage={channelView.canDeleteMessage}
                      />
                    );
                  }}
                </Show>
              </Show>
              <Show when={!agentFormOpen() && !channelOpen() && noHost()}>
                <WebConnectComputer
                  loading={workspace.state.hostsLoading}
                  failed={Boolean(workspace.state.hostsError)}
                  reference={workspace.state.hostsError?.reference ?? null}
                  onJoin={() => setJoinOpen(true)}
                  onCreateServer={
                    hostedServers.available() && !hostedServers.ownsHostedServer()
                      ? () => hostedServers.openAddServer("empty_state")
                      : undefined
                  }
                  onRefresh={() => void workspace.run(workspace.refreshHosts)}
                />
              </Show>
              <Show when={agentChatOpen()}>
                <Conversation
                  runtime={runtime}
                  onOpenMarketplace={openMarketplace}
                  connectors={connectors}
                  onOpenMarketplaceApp={(request) => {
                    setSuggestedApp(request);
                    openMarketplace();
                  }}
                  agentStatus={
                    workspace.state.status === "online" && workspace.conversation()?.page
                      ? providerAdmin.status()
                      : CONNECTING_STATUS
                  }
                  agentsConnecting={conversationConnecting()}
                  accountUsage={accountUsage()}
                  providerRuntimeStatuses={providerSettings()?.providerRuntimeStatuses}
                  customProviders={providerSettings()?.customProviders}
                  onDownloadProvider={providerSettings()?.onDownloadProvider}
                  onCancelProviderDownload={providerSettings()?.onCancelProviderDownload}
                  onConnectProvider={providerSettings() ? connectFromComposer : undefined}
                  canConnectProvider={(provider) =>
                    (providerSettings()?.connection?.connectKind(provider) ?? null) !== null
                  }
                  onSignInProvider={composerSignIn() ? connectFromComposer : undefined}
                  onManageProviders={providerSettings() ? openProviderSettings : undefined}
                  onManageBrowserProfiles={browserProfiles() ? openBrowserProfileSettings : undefined}
                  onOpenNotificationSettings={(serverId) => openNotificationSettings(serverId)}
                  onOpenMcpSignIn={openMcpSignInFromChat()}
                  mcpSignedIn={mcpSignedIn}
                  refreshMcpSignIns={refreshMcpSignInsFromChat}
                  onOpenUsage={(trigger) => {
                    const id = server()?.id;
                    if (id) void openHostPage(id, "usage", trigger);
                  }}
                  agent={conversationAgent()}
                  agents={workspace.profiles()}
                  mentionAgents={mentionAgents()}
                  availableRoutineIds={availableRoutineIds()}
                  routines={routineSnapshot()?.routines}
                  modelOptions={models()}
                  threads={threads()}
                  messages={view.messages}
                  messageReferences={view.messageReferences()}
                  missingMessageReferences={view.missingMessageReferences()}
                  unreadCount={shownReadState().unreadCount}
                  firstUnreadMessageId={shownReadState().firstUnread}
                  loaded={Boolean(workspace.conversation()?.page)}
                  hasOlder={workspace.conversation()?.page?.pageInfo.hasOlder}
                  unloadedHistory={unloadedHistory(workspace.conversation()?.page?.pageInfo)}
                  loadingOlder={workspace.conversation()?.loading}
                  olderError={workspace.conversation()?.olderError ?? null}
                  activeTurnId={workspace.conversation()?.page?.activeTurnId}
                  activityDetail={
                    workspace.state.selectedId
                      ? workspace.state.progress[workspace.state.selectedId]?.detail
                      : undefined
                  }
                  activityRunning={
                    workspace.state.selectedId
                      ? workspace.state.progress[workspace.state.selectedId]?.running
                      : undefined
                  }
                  activityKind={
                    workspace.state.selectedId
                      ? workspace.state.progress[workspace.state.selectedId]?.activity
                      : undefined
                  }
                  backgroundWorkSince={(taskId) => {
                    const agentId = workspace.state.selectedId;
                    return agentId ? workspace.state.backgroundWork[backgroundWorkKey(agentId, taskId)] : undefined;
                  }}
                  turnStepLines={workspace.stepLines()}
                  skillsMarketplaceOpen={marketplaceOpen()}
                  mcpSettingsOpen={marketplaceOpen()}
                  globalOverlayOpen={joinOpen() || serverSettings.state.open || searchOpen() || marketplaceOpen()}
                  settingsRequest={settingsRequest()}
                  messageFocusRequest={messageFocusRequest()}
                  queue={workspace.state.selectedId ? workspace.state.queues[workspace.state.selectedId] : undefined}
                  browserRuntime={workspace.runtime.browser}
                  browserTabs={workspace.state.browserTabs}
                  activeBrowserTabId={workspace.state.activeBrowserTabId}
                  browserVisibilitySuspended={workspace.state.status !== "online" || pageCovered()}
                  workspaceCovered={pageCovered() || hostOffline()}
                  browserControlState={workspace.state.browserControlState}
                  server={server()}
                  responseStyle={responseStyle()}
                  presence={workspace.state.presence ?? { serverId: server()?.id ?? null, members: [], updatedAt: "" }}
                  currentUserEmail={props.accountEmail ?? ""}
                  isOwnSender={isOwnAgentChatSender}
                  browserEnabled={browserEnabled()}
                  remoteDesktopEnabled={false}
                  remoteDesktopSessionActive={false}
                  remoteDesktopVisible={false}
                  prompt={view.prompt()}
                  promptUiBlock={view.promptUiBlock()}
                  approval={view.approval()}
                  browserTakeover={browserTakeover()}
                  onSelectAgent={(id, tabId) => {
                    if (tabId !== undefined) agentThreads()?.tabs.open(id, tabId);
                    setMobilePane("conversation");
                    void select(id);
                  }}
                  agentWaits={agentWaits()}
                  agentTakeoverTabIds={agentTakeoverTabs()}
                  onUpdateAgent={async (agentId, updates) => {
                    await updateRemoteAgent(remoteAgentAdmin, { agentId, ...updates }, workspace.runtime.updateAgent);
                    await workspace.refresh();
                  }}
                  onSetAgentAvatar={async (agentId, image) => {
                    await workspace.runtime.setAvatar(agentId, image);
                    await workspace.refresh();
                  }}
                  onSendMessage={async (text, attachments, replyTo, target, clientMessageId) => {
                    requestWebNotificationPermission();
                    const id = target?.agentId ?? workspace.state.selectedId;
                    if (!id || (target && target.serverId !== server()?.id))
                      return { error: t("webClient.error.checkConversation") };
                    return workspace.send(id, text, attachments, replyTo, clientMessageId);
                  }}
                  onMarkRead={workspace.markRead}
                  onMarkUnread={markUnreadFrom()}
                  sendToChannel={sendToChannel()}
                  onDeleteMessage={agentDeleteMessageAction()}
                  canDeleteMessage={canDeleteAgentMessage}
                  messagePins={agentMessagePins()}
                  onLoadOlder={() => void workspace.older()}
                  discontinuous={workspace.conversation()?.around === true}
                  onLoadLatest={workspace.loadLatest}
                  onSearchMessages={async (query) => {
                    const id = workspace.state.selectedId;
                    if (!id) return { messageIds: [], total: 0 };
                    const result = await workspace.runtime.search(id, query);
                    return { messageIds: result.results.map((item) => item.message.id), total: result.total };
                  }}
                  onSearchThreads={threadSearch()}
                  onOpenSearchMessage={async (messageId) => {
                    await workspace.openSearchMessage(messageId);
                  }}
                  onTypingChange={setTyping}
                  onAnswerPrompt={view.answerPrompt}
                  onPromptResolutionPresented={(_agentId, turnId, requestId) =>
                    view.presentPromptResolution(turnId, requestId)
                  }
                  onRespondToApproval={view.respondToApproval}
                  onAlwaysAllowApproval={view.alwaysAllowApproval()}
                  agentAutoApproves={remoteAgentAdmin.autoApproves()}
                  remoteBackupModelsLoaded={remoteAgentAdmin.backupModels() !== undefined}
                  remotePlanCardLoaded={remoteAgentAdmin.quickAcknowledgement() !== undefined}
                  remoteBuiltinMemoryLoaded={remoteAgentAdmin.memory() !== undefined}
                  remoteComputerUseLoaded={remoteAgentAdmin.computerUse() !== undefined}
                  remoteNewChatLoaded={remoteAgentAdmin.allowNewChat() !== undefined}
                  remoteBusyMessageModeLoaded={remoteAgentAdmin.busyMessageMode() !== undefined}
                  defaultBusyMessageMode={remoteAgentAdmin.defaultBusyMessageMode()}
                  onUpdateAgentPermissions={remoteAgentAdmin.settings() ? remoteAgentAdmin.update : undefined}
                  onClearAgentContext={clearSelectedAgentContext()}
                  onDeleteAgentHistory={deleteSelectedAgentHistory()}
                  onCompactAgentContext={compactSelectedAgentContext()}
                  contextState={
                    workspace.state.selectedId ? workspace.state.contextStates[workspace.state.selectedId] : undefined
                  }
                  usageLimitAsk={usageLimitAsk()}
                  usageLimited={usageLimitsShown() ? usageLimited : undefined}
                  providerFailed={usageLimitsShown() ? providerFailed : undefined}
                  onRespondToBrowserTakeover={(decision, options) =>
                    workspace.respondToBrowserTakeover(decision, openThreadId(), options)
                  }
                  onCancelQueuedMessage={workspace.cancelQueued}
                  waits={visibleWaits()}
                  onCancelWait={cancelSelectedWait()}
                  onSteerQueuedMessage={workspace.steerQueued}
                  onSendQueuedMessageNow={sendQueuedMessageNow}
                  onUpdateQueuedMessage={workspace.updateQueued}
                  onReorderQueue={workspace.reorderQueue}
                  onActivateBrowserTab={workspace.activateBrowserTab}
                  onCloseBrowserTab={(tabId) => workspace.runtime.closeBrowserTab(tabId)}
                  onOpenRemoteDesktop={unavailable}
                  onStop={() => {
                    const page = workspace.conversation()?.page;
                    if (page?.activeTurnId)
                      void workspace.run(() => workspace.runtime.stop(page.agentId, page.activeTurnId ?? ""));
                  }}
                />
                <ProviderSignInDialogs api={providerSettings()?.connection} opener="composer" />
              </Show>
            </WorkspaceFrame>
            <Show when={loadingCover()}>{connectionNotice(true)}</Show>
          </div>
        </Show>
      </ChannelsControllerProvider>
    </ConversationControllerProvider>
  );
}
