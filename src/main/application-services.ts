import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import {
  isKeyOnlyProvider,
  isManagedRuntimeProvider,
  type ManagedProviderId,
} from "@openbot/contracts/agent-providers";
import { leadingAddress } from "@openbot/contracts/chat-tag-references";
import { selfHostedApiOrigin } from "@openbot/contracts/invite-links";
import type {
  AgentProviderStatus,
  AgentStatus,
  AppVariant,
  BrowserDisplayState,
  CapabilityState,
  CentralAuthState,
  CentralAuthUser,
  ComputerUseState,
  ProviderRuntimeSnapshot,
  SpeechModelStatus,
  VoiceModelStatus,
  VoiceServerSettings,
  VoiceStreamTranscript,
} from "@openbot/contracts/ipc";
import {
  agentBrowserProfile,
  agentMemoryEnabled,
  type ChannelCommand,
  DEFAULT_APP_LANGUAGE,
  DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
  decodeChannel,
  defaultVoiceSettings,
  IPC_ENDPOINTS,
  isGroqVoiceModelId,
  isLocalVoiceModelId,
  isManagedToolRuntime,
  isUpdateBusyPhase,
  LOCAL_SERVER_ID,
  latestTurnAnswer,
} from "@openbot/contracts/ipc";
import { decodeRecord, requiredString } from "@openbot/contracts/ipc-decoding";
import { isValidSemver } from "@openbot/contracts/release-version";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { localeDirection } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactSecrets, registerSecretValue, toLogValue } from "@openbot/logging";
import { REMOTE_ACCOUNT_CHECK_INTERVAL_MS } from "@openbot/team-client";
import { installRemoteSyncProfileSink } from "@openbot/team-client/sync-profile";
import { ANALYTICS_GENERATIONS, openPanelTransport, ReportQueue } from "@openbot/telemetry";
import { fileReportStorage } from "@openbot/telemetry/node";
import { makeWASocket } from "@openbot/whatsapp/baileys";
import { makeOpenBotSignalRepository } from "@openbot/whatsapp/signal-repository";
import { Effect, Fiber, Schema } from "effect";
import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  Menu,
  Notification,
  nativeImage,
  net,
  powerMonitor,
  powerSaveBlocker,
  screen,
  shell,
  systemPreferences,
  webContents,
} from "electron";
import { toAgentRemovalFailed } from "../backend/agent/agent-removal";
import { pasteCodeLoginSupported } from "../backend/agent/cli-code-login";
import { toHostedSiteOperationFailed } from "../backend/agent/hosted-site-coordinator";
import { toMcpGatewayFailed } from "../backend/agent/mcp-gateway";
import { ProviderAccountStore } from "../backend/agent/provider-account-store";
import { toToolOperationFailed } from "../backend/agent/tool-operation";
import { AgentApiKeys } from "../backend/agent-api-keys";
import { AgentDatabaseSupervisor } from "../backend/agent-data/agent-database-supervisor";
import { AgentTables } from "../backend/agent-data/agent-tables";
import { AgentMemoryStore } from "../backend/agent-memory-store";
import { AgentRoutineStore } from "../backend/agent-routine-store";
import { AgentLifecycleFailed, AgentService } from "../backend/agent-service";
import { AgentStore } from "../backend/agent-store";
import { AgentThreadStore } from "../backend/agent-threads/agent-thread-store";
import { type BrowserAgentChat, BrowserHost } from "../backend/browser-host";
import { BrowserProfileStore } from "../backend/browser-profiles/browser-profile-store";
import { BrowserProxyStore } from "../backend/browser-profiles/browser-proxy-store";
import { CodexCliError, resolveClaudeCli, resolveCodexCli } from "../backend/cli";
import { type CrmHandle, createCrm } from "../backend/crm/crm";
import { CrmError } from "../backend/crm/crm-handle";
import { stripeSource } from "../backend/crm/crm-stripe";
import { diskRestoreEnded, diskRestoring } from "../backend/disk-restore";
import { runCauseEffect } from "../backend/effect-boundary";
import { LIBRARY_FOLDERS_FILE, LibraryFoldersStore } from "../backend/library-folders-store";
import { MailboxStore } from "../backend/mailbox-store";
import { McpOAuth } from "../backend/mcp-oauth-provider";
import { DiscordConnectFailed, toDiscordConnectFailed } from "../backend/messaging/discord/discord-connect";
import { discordDriver, downloadDiscordAttachment } from "../backend/messaging/discord/discord-driver";
import { MessagingOperationFailed, MessagingService } from "../backend/messaging/messaging-service";
import { SlackConnectFailed, toSlackConnectFailed } from "../backend/messaging/slack/slack-connect";
import { slackDriver } from "../backend/messaging/slack/slack-driver";
import { telegramDriver } from "../backend/messaging/telegram/telegram-driver";
import { whatsAppDriver } from "../backend/messaging/whatsapp/whatsapp-driver";
import { WhatsAppRuntime } from "../backend/messaging/whatsapp/whatsapp-runtime";
import { OpenBotDatabase } from "../backend/openbot-database";
import { PASSWORD_MANAGER_BRANDS } from "../backend/password-vault";
import { passwordVaultRouter } from "../backend/password-vault-router";
import { perfTime } from "../backend/perf-probe-hooks";
import { sweepProviderTemp } from "../backend/provider-temp";
import { routineFlowRoutines } from "../backend/routine-flows/routine-flow-routines";
import { RoutineFlowStore } from "../backend/routine-flows/routine-flow-store";
import { createRoutineFlows, routineFlowNoticeEvent } from "../backend/routine-flows/routine-flows";
import { RoutineResultStore } from "../backend/routine-results/routine-result-store";
import {
  createRoutineResults,
  type RoutineResultsHandle,
  routineResultNoticeEvent,
} from "../backend/routine-results/routine-results";
import { SidebarLayoutStore } from "../backend/sidebar-layout-store";
import { StorageUsageScanner, StorageUsageService } from "../backend/storage-usage";
import { TeamChatStore } from "../backend/team-chat-store";
import { UserBrowsingLog } from "../backend/user-browsing-log";
import { UserFilesBytes } from "../backend/user-files-bytes";
import { WORKFLOW_FOLDERS_FILE, WorkflowFoldersStore } from "../backend/workflow-folders-store";
import { clearFlatBackground } from "../backend/workflows/flat-background";
import { workflowFileOwners } from "../backend/workflows/workflow-file-owners";
import { WorkflowGitHubStore } from "../backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../backend/workflows/workflow-run-store";
import { WorkflowStore } from "../backend/workflows/workflow-store";
import { WorkflowTriggers, workflowScheduleDueAt } from "../backend/workflows/workflow-triggers";
import {
  createWorkflows,
  type WorkflowNotice,
  type WorkflowsHandle,
  workflowNoticeEvent,
} from "../backend/workflows/workflows";
import { centralAuthApiUrl, createCentralAuthManager, safeStorageCipher } from "./account-service-access";
import { type AcpRegistry, createAcpRegistry } from "./acp-registry";
import { AGENT_ACCESS_FILE, AgentAccessStore } from "./agent-access-store";
import { type AgentAdminSettingsService, createAgentAdminSettings } from "./agent-admin-settings";
import { checkDatabaseIntegrityInHost, spawnAgentDatabaseHost } from "./agent-database-host-process";
import {
  type AgentDefaultsPreferenceStore,
  createAgentDefaultsPreferenceStore,
} from "./agent-defaults-preference-store";
import { type AgentDefaultsSettingsService, createAgentDefaultsSettings } from "./agent-defaults-settings";
import { agentDisplayEnvironment, hasSeparateAgentDisplay } from "./agent-display";
import { AgentDockFailed, AgentDockWindowController, toAgentDockFailed } from "./agent-dock-window";
import { type AgentFolders, createAgentFolders } from "./agent-folders";
import { type AgentHostSettingsService, createAgentHostSettings } from "./agent-host-settings";
import { fitImageForAgent } from "./agent-image-fit";
import { AgentImportService } from "./agent-import-service";
import { AgentInitializationGate } from "./agent-initialization";
import { type AgentInstructionsFiles, createAgentInstructionsFiles } from "./agent-instructions-files";
import { AgentMarketplaceService } from "./agent-marketplace-service";
import {
  AgentMemoryLimitPreferenceStore,
  type AgentMemoryLimitSetting,
  reloadingAgentMemoryLimit,
} from "./agent-memory-limit-preference-store";
import { AgentNotificationLevelStore, OWNER_NOTIFICATION_KEY } from "./agent-notification-level-store";
import { AgentTemplateService } from "./agent-template-service";
import { HostAnalytics } from "./analytics";
import { readAnalyticsInstallId } from "./analytics-install-id";
import { analyticsInventoryDayStore, collectAnalyticsInventory } from "./analytics-inventory";
import { catalogPluginSlug, isReportedMcpServerName, loadCatalogPluginServers } from "./analytics-plugin-catalog";
import { AnalyticsPreferenceService } from "./analytics-preference-service";
import { readAnalyticsPreference, saveAnalyticsDefault } from "./analytics-preference-store";
import { providerAuthKind } from "./analytics-provider-auth";
import { AppBehaviorService } from "./app-behavior-service";
import { AppearanceService } from "./appearance-service";
import { ApprovalAutomation, readApprovalAutomation } from "./approval-automation-store";
import { AttachmentPreviews } from "./attachment-previews";
import { AutomationServer } from "./automation-server";
import { listBackgroundProcesses, stopBackgroundProcess } from "./background-processes";
import { BillingDesktopService } from "./billing-service";
import { managedBitwardenCli } from "./bitwarden-cli-installer";
import { BitwardenConnectorService } from "./bitwarden-connector-service";
import { BitwardenConnectorStore } from "./bitwarden-connector-store";
import { BrowserDockOverlay } from "./browser-dock-overlay";
import { BrowserEgressClient } from "./browser-egress-client";
import { BrowserEgressHost } from "./browser-egress-host";
import { BrowserPictureInPicture } from "./browser-picture-in-picture";
import {
  type BrowserProfileService,
  browserProxyConnection,
  createBrowserProfileService,
} from "./browser-profile-service";
import { BrowserViewClient } from "./browser-view-client";
import { BrowsingMemoryPreferenceStore } from "./browsing-memory-preference-store";
import { BusyMessageModePreferenceStore } from "./busy-message-mode-preference-store";
import { type CentralAuthManager, isHostNotOnAccount } from "./central-auth-manager";
import { type ChannelFolders, createChannelFolders } from "./channel-folders";
import { ChatVisualPreviewer } from "./chat-visual-preview";
import {
  type ClaudeCompactWindowControl,
  claudeCompactWindowControl,
  createClaudeCompactWindowPreferenceStore,
} from "./claude-compact-window-preference-store";
import {
  type ClaudeUserSetupControl,
  claudeUserSetupControl,
  createClaudeUserSetupPreferenceStore,
} from "./claude-user-setup-preference-store";
import { createComputerIdle } from "./computer-idle";
import { ComputerUseDisplayAwake } from "./computer-use-display-awake";
import { ComputerUseHighlightController } from "./computer-use-highlight-window";
import { applicationBundlePath, applicationIconName } from "./computer-use-permission-app";
import { ComputerUsePermissionHelpWindowController } from "./computer-use-permission-help-window";
import {
  COMPUTER_USE_ACTION_MAX_AGE_MS,
  COMPUTER_USE_CURSOR_MAX_AGE_MS,
  chooseTarget,
  liveSession,
  pointerOnDesktop,
} from "./computer-use-target-window";
import { createCrmPreferenceStore, crmSettingsStore } from "./crm-preference-store";
import { isSupportedCuaDriverTarget, resolveCuaDriver } from "./cua-driver-artifact";
import { CuaDriverDaemonClient } from "./cua-driver-daemon-client";
import {
  CuaDriverRuntime,
  cuaDriverCommandAlias,
  cuaDriverDrivesWayland,
  resolveCuaDriverEndpoint,
} from "./cua-driver-runtime";
import { type CustomAgentChanges, createCustomAgentChanges } from "./custom-agent-changes";
import { CUSTOM_AGENTS_FILE, CustomAgentStore } from "./custom-agent-store";
import { type CustomProviderChanges, createCustomProviderChanges } from "./custom-provider-changes";
import { CustomProviderStore } from "./custom-provider-store";
import { MCP_OAUTH_REDIRECT_URL } from "./deep-link-router";
import { desktopShowsAgentEvent } from "./desktop-notifications";
import { DetachedBrowserWindow } from "./detached-browser-window";
import { shouldAutoStartHost } from "./development-profile";
import {
  applyDevelopmentRemoteAccount,
  type DevelopmentRemoteRole,
  readDevelopmentClientTransport,
  readDevelopmentHostEmail,
  startDevelopmentRemoteRole,
} from "./development-remote-bootstrap";
import { performDynamicIslandCriticalAction } from "./dynamic-island-actions";
import { DynamicIslandFailed, DynamicIslandWindowController, toDynamicIslandFailed } from "./dynamic-island-window";
import {
  createExternalLinkPreferenceStore,
  ExternalLinkOpener,
  type ExternalLinkPreferenceStore,
} from "./external-link-opener";
import { feedbackFacts, feedbackSender } from "./feedback";
import { githubAppConfig } from "./github-connector-config";
import { GitHubConnectorService } from "./github-connector-service";
import { GitHubConnectorStore } from "./github-connector-store";
import { GitHubRelay, receiveGitHubDelivery } from "./github-relay";
import { createGitHubRest, type WorkflowGitHubDirectory, workflowGitHubDirectory } from "./github-rest";
import { githubSkillSource } from "./github-skill-source";
import { hermesRoot } from "./hermes-import-reader";
import { HermesImportService } from "./hermes-import-service";
import { HermesInstaller } from "./hermes-installer";
import { HostEventsRuntime } from "./host-events-runtime";
import {
  agentWebhookRoutineWriter,
  HostEventsService,
  hostAgentWebhookKeys,
  type WebhookDeliveryReport,
} from "./host-events-service";
import { HostReleaseService, readInstallationMode } from "./host-release-service";
import { HostService } from "./host-service";
import { HostTurnLimitsPreferenceStore } from "./host-turn-limits-preference-store";
import { HostUpdateCoordinator } from "./host-update-coordinator";
import { CLIENT_USE_WINDOW_MS, HostedServerActivity } from "./hosted-server-activity";
import {
  applyHostedServerAccount,
  type HostedServerEnvironment,
  hostedServerStorageGb,
} from "./hosted-server-bootstrap";
import { HostedServerDesktopService, withHostingDeveloperKey } from "./hosted-server-service";
import { HostedServerStartRetry } from "./hosted-server-start-retry";
import { HostedSiteDesktopService } from "./hosted-site-service";
import {
  CONTAINER_UPDATE_PATHS,
  CONTAINER_UPDATE_TRIGGER,
  HOSTED_UPDATE_TRIGGER,
  HostedUpdateAdapter,
} from "./hosted-update-adapter";
import { IdleRestart } from "./idle-restart";
import { loadIngressQueueKey } from "./ingress-queue-key";
import { InstanceTransferService } from "./instance-transfer-service";
import { InterfaceSizeService } from "./interface-size-service";
import { prepareToolRuntimeForTest } from "./ipc/mcp-server-handlers";
import { LanguageService } from "./language-service";
import { LibraryFoldersService } from "./library-folders-service";
import { LicenseDesktopService } from "./license-service";
import { LinkAccountService } from "./link-account-service";
import { LinkAccountStore } from "./link-account-store";
import { relaunchApp } from "./linux-appimage-relaunch";
import {
  aboveAppsWindowKind,
  ozonePlatformArguments,
  setAboveAppsXWayland,
  usesX11Windows,
} from "./linux-wayland-output";
import { localRoutineFeedDocument } from "./local-routine-calendar";
import {
  formatLocalServerMembersRequest,
  type LocalServerChildEnvironment,
  LocalServerMarketplace,
  LocalServerMembers,
  reportLocalServerWorkingAgents,
  startLocalServerChild,
} from "./local-server-child";
import { LOCAL_SERVERS_FILE } from "./local-servers/local-server-registry";
import { LocalServers, sandboxArguments } from "./local-servers/local-servers";
import { LocalSignInWindows } from "./local-sign-in-window";
import { localSkillLearner } from "./local-skill-learner";
import { LocalSkillLibrary } from "./local-skill-library";
import { localSkillTools } from "./local-skill-tools";
import { createLoginItem } from "./login-item";
import { LogoColorService } from "./logo-color-service";
import type { MacHapticFeedback } from "./mac-haptic-feedback";
import { restartFromInstalledCopy } from "./mac-installed-copy";
import { hidePanelFromWindowSwitchers } from "./mac-panel-activation";
import { MAC_PERMISSION_URLS } from "./mac-permission-urls";
import { MACHINE_ALERTS_PREFERENCE_FILE, MachineAlertMonitor, MachineAlertPreferenceStore } from "./machine-alerts";
import { MachineMetricsSampler } from "./machine-metrics";
import {
  computerUseCoveringWindowIds,
  computerUseDesktopPoint,
  computerUseDesktopRect,
  computerUseDisplays,
  createAgentDockWindow,
  createComputerUseHighlightWindow,
  createComputerUsePermissionHelpWindow,
  createDynamicIslandWindow,
  loadAgentDockRenderer,
  loadBrowserDockRenderer,
  loadComputerUseHighlightRenderer,
  loadComputerUsePermissionHelpRenderer,
  loadDynamicIslandRenderer,
  type MainWindowController,
  sendComputerUseHighlightPlacement,
  showMainWindow,
} from "./main-window";
import { DATA_SKILL_SLUG, ManagedSkillService, SKILL_CREATOR_SKILL_SLUG } from "./managed-skill-service";
import { MCP_ACCESS_FILE, type McpAccessControl, McpAccessStore, sameMcpAgents } from "./mcp-access-store";
import { McpHostSignIns } from "./mcp-host-sign-ins";
import { McpOAuthProxySettingsFile } from "./mcp-oauth-proxy-store";
import {
  MCP_OAUTH_REDIRECT_PATHS,
  MCP_OAUTH_REDIRECT_PORT,
  startMcpOAuthRedirectServer,
} from "./mcp-oauth-redirect-server";
import { McpOAuthStore } from "./mcp-oauth-store";
import { MCP_SERVER_OWNERS_FILE, McpServerOwnersStore } from "./mcp-server-owners-store";
import { MemoryReviewPreferenceStore } from "./memory-review-preference-store";
import { MessagingCredentialStore } from "./messaging-credential-store";
import { createModelReasoningSupport, MODEL_REASONING_RETRY_WAITS_MS } from "./model-reasoning-probe";
import { ModelReleaseCatalog, ModelVisibility } from "./model-visibility";
import { NotificationPreferenceStore } from "./notification-preference-store";
import { OnePasswordConnectorService } from "./onepassword-connector-service";
import { OnePasswordConnectorStore } from "./onepassword-connector-store";
import { EncryptedRecordStore } from "./password-managers/encrypted-record-store";
import { PasswordManagersService } from "./password-managers/password-managers-service";
import { managedProtonPassCli } from "./password-managers/proton-pass-cli-installer";
import { ProtonPassDriver, protonPassRecordSchema } from "./password-managers/proton-pass-driver";
import { PointerForwardingGate } from "./pointer-forwarding-gate";
import { PromptCacheTtlPreferenceStore } from "./prompt-cache-ttl-preference-store";
import { ProviderAccountsHost } from "./provider-accounts-host";
import { ProviderCredentialStore } from "./provider-credential-store";
import { createProviderDetection, type ProviderDetection } from "./provider-detection";
import { PROVIDER_DETECTION_SETTINGS_FILE, ProviderDetectionSettingsStore } from "./provider-detection-settings-store";
import {
  createProviderEnvironmentPreferenceStore,
  type ProviderEnvironmentControl,
  providerEnvironmentControl,
} from "./provider-environment-store";
import { ProviderHostSignIns } from "./provider-host-sign-ins";
import { startAccountLog, startAgentLog, startProviderLog } from "./provider-log";
import { toProviderRuntimeFailure } from "./provider-runtime-effects";
import { ProviderRuntimeManager, providerRuntimeRoot, runtimeTarget } from "./provider-runtime-manager";
import { ProviderUseSettingsStore } from "./provider-use-settings-store";
import { PushNotificationStore } from "./push-notification-store";
import { DESKTOP_USE_MS } from "./push-notifications";
import { ReferralDesktopService } from "./referral-service";
import { RelayedMessagingInstalls } from "./relayed-messaging-installs";
import { decodeQueuedMessageReceipt } from "./remote-agent-decoding";
import { RemoteConnectTrace } from "./remote-connect-trace";
import { createRemoteControlPolicyStore } from "./remote-control-policy-store";
import { createRemoteControlQuestion } from "./remote-control-question";
import { RemoteDesktopManager } from "./remote-desktop-manager";
import { resolveRemoteDesktopRuntime } from "./remote-desktop-runtime-artifact";
import { appendRemoteDiagnosticLog } from "./remote-diagnostics";
import { decodeVoid } from "./remote-host-decoding";
import {
  createRemoteNetworkRoutePreferenceStore,
  type RemoteNetworkRoutePreferenceStore,
} from "./remote-network-route-preference-store";
import { watchServerClaims } from "./remote-server-host-directory";
import { RemoteServerManager } from "./remote-server-manager";
import { RemoteWorkflowError, toRemoteWorkflowError } from "./remote-service-effects";
import { RemoteSessionCache } from "./remote-session-cache";
import {
  createRemoteSessionReusePreferenceStore,
  type RemoteSessionReusePreferenceStore,
} from "./remote-session-reuse-preference-store";
import { remoteSyncProfileFile } from "./remote-sync-profile-file";
import { sendToRenderer } from "./renderer-ipc";
import { HOSTED_UPDATE_MAXIMUM_IDLE_WAIT_MS, RequestedUpdate, RequestedUpdateRefusal } from "./requested-update";
import { RequiredUpdate } from "./required-update";
import { ResourceMonitor } from "./resource-monitor";
import { StatementTimings } from "./resource-summary";
import { RoutineFeedServer } from "./routine-feed-server";
import { clearRoutineHold, ROUTINE_HOLD_FILE, takeRoutineHold, writeRoutineHold } from "./routine-hold-file";
import type { UncleanExitProperties } from "./run-marker";
import { ScreenCapturer } from "./screen-capture";
import type { SecretStorageCipher } from "./secret-storage-cipher";
import { SERVER_AUDIT_FILE, ServerAuditStore, serverAuditNames } from "./server-audit-store";
import { AGENT_PROCESS_VARIABLE, agentProcessEnvironment, ServerMemory } from "./server-memory";
import { ServerMode, type ServerModeEnvironment } from "./server-mode";
import { ServerPersonalityPreferenceStore } from "./server-personality-preference-store";
import { ServerSetupPage } from "./server-setup-page";
import { SERVER_TIMEZONE_PREFERENCE_FILE, ServerTimezonePreferenceStore } from "./server-timezone-preference-store";
import {
  configureApplicationProtocol,
  configureAttachmentProtocol,
  configureServerLogoProtocols,
} from "./session-configuration";
import { readSetupState, writeSetupState } from "./setup-store";
import { OWNER_PIN_KEY, SidebarPinStore } from "./sidebar-pin-store";
import { SignInRelayClient } from "./sign-in-relay-client";
import { agentPrintedLink, SignInRelayHost } from "./sign-in-relay-host";
import { SignalIngress } from "./signal-ingress";
import { SkillLearningPreferenceStore } from "./skill-learning-preference-store";
import { SkillMarketplaceService } from "./skill-marketplace-service";
import { SLACK_DEV_CALLBACK_PATH, startSlackDevCallbackServer } from "./slack-dev-callback-server";
import { SpeechPreferenceStore } from "./speech-preference-store";
import { StartupTiming } from "./startup-timing";
import { AGENT_CERTIFICATES_FILE, agentCertificateEnvironment } from "./system-certificates";
import { LEGACY_TEAM_STORE_FILE, TEAM_STORE_FILE, TeamStore } from "./team-store";
import { TeamWebRtcBridge } from "./team-webrtc-bridge";
import { TeamWebRtcClientTransport } from "./team-webrtc-client-transport";
import type { TeardownRegistry } from "./teardown-registry";
import { THEME_PALETTE_DIRECTORY } from "./theme-palette-files";
import { TraceFile } from "./trace-file";
import {
  macShipItDirectory,
  readNotInstalledUpdate,
  UPDATE_HANDOVER_FILE,
  UPDATE_INSTALL_RECORD_FILE,
} from "./update-install-guard";
import { readUpdatePreference, UPDATE_PREFERENCE_FILE, writeUpdatePreference } from "./update-preference-store";
import { checkRestartReadiness, type RestartReadiness } from "./update-readiness";
import {
  createDisabledUpdateAdapter,
  electronUpdaterCacheDirectory,
  isNixStoreInstall,
  loadElectronUpdater,
  supportsInstalledUpdates,
  type UpdateAdapter,
  UpdateService,
} from "./update-service";
import { listSiblingOpenBotInstances } from "./update-sibling-instances";
import { VaultService } from "./vault-service";
import { VaultStore } from "./vault-store";
import { VideoReader } from "./video-reader";
import { VoiceApiKeyStore } from "./voice-api-key-store";
import { openScribeSocket } from "./voice-cloud-stream";
import {
  BARK_PLUS_MODEL_DIRECTORY,
  COHERE_TRANSCRIBE_MODEL_DIRECTORY,
  PARAKEET_MODEL_DIRECTORY,
  PARAKEET_UNIFIED_MODEL_DIRECTORY,
  removeLegacyWhisperCache,
  SUPERTONIC_MODEL_DIRECTORY,
  VoiceOperationError,
  WHISPER_TURBO_MODEL_DIRECTORY,
} from "./voice-model-service";
import { VoicePreferenceStore } from "./voice-preference-store";
import { createVoiceServerPreferenceStore, VoiceServerService } from "./voice-server-service";
import { spawnVoiceSpeechHost } from "./voice-speech-host-process";
import { VoiceSpeechService } from "./voice-speech-service";
import { spawnVoiceTranscriptionHost } from "./voice-transcription-host-process";
import { VoiceTranscriptionService } from "./voice-transcription-service";
import { WebhookRelay } from "./webhook-relay";
import { WindowsTopmostKeeper } from "./windows-topmost-keeper";
import { WorkflowFoldersService } from "./workflow-folders-service";
import { sizeWorkflowPicture } from "./workflow-picture-size";

const logger = createOpenBotLogger("application-services");
const SETUP_FILE = "openbot-setup-v2.json";
const ANALYTICS_PREFERENCE_FILE = "openbot-analytics-preference-v1.json";
const ANALYTICS_INVENTORY_FILE = "openbot-analytics-inventory-v1.json";
const ANALYTICS_INSTALL_ID_FILE = "openbot-analytics-install-id-v1.json";
const APPROVAL_AUTOMATION_FILE = "openbot-approval-automation-v3.json";
const V2_APPROVAL_AUTOMATION_FILE = "openbot-approval-automation-v2.json";
const ROUTINE_FEED_FILE = "openbot-routine-feed-v1.json";
const LEGACY_APPROVAL_AUTOMATION_FILE = "openbot-approval-automation-v1.json";
const LANGUAGE_PREFERENCE_FILE = "openbot-language-preference-v1.json";
const LOGO_COLOR_PREFERENCE_FILE = "openbot-logo-color-preference-v1.json";
export const APPEARANCE_PREFERENCE_FILE = "openbot-appearance-preference-v1.json";
const INTERFACE_SIZE_PREFERENCE_FILE = "openbot-interface-size-preference-v1.json";
const NOTIFICATION_PREFERENCE_FILE = "openbot-notification-preference-v1.json";
const PUSH_NOTIFICATION_FILE = "openbot-push-notifications-v1.json";
const BUSY_MESSAGE_MODE_PREFERENCE_FILE = "openbot-busy-message-mode-v1.json";
const AGENT_DEFAULTS_PREFERENCE_FILE = "openbot-agent-defaults-v1.json";
const AGENT_MEMORY_LIMIT_PREFERENCE_FILE = "openbot-agent-memory-limit-v1.json";
const MEMORY_REVIEW_PREFERENCE_FILE = "openbot-memory-review-v1.json";
const SKILL_LEARNING_PREFERENCE_FILE = "openbot-skill-learning-v1.json";
const BROWSING_MEMORY_PREFERENCE_FILE = "openbot-browsing-memory-v1.json";
const USER_BROWSING_FILE = "openbot-browsing-steps-v1.json";
const AGENT_NOTIFICATION_LEVELS_FILE = "openbot-agent-notification-levels-v1.json";
const SIDEBAR_PINS_FILE = "openbot-sidebar-pins-v1.json";
const HOST_TURN_LIMITS_PREFERENCE_FILE = "openbot-host-turn-limits-v1.json";
const SERVER_PERSONALITY_PREFERENCE_FILE = "openbot-server-personality-v1.json";
const PROMPT_CACHE_TTL_PREFERENCE_FILE = "openbot-prompt-cache-ttl-v1.json";
const CLAUDE_USER_SETUP_PREFERENCE_FILE = "openbot-claude-user-setup-v1.json";
const CRM_PREFERENCE_FILE = "openbot-crm-v1.json";
const CLAUDE_COMPACT_WINDOW_PREFERENCE_FILE = "openbot-claude-compact-window-v1.json";
const PROVIDER_ENVIRONMENT_PREFERENCE_FILE = "openbot-provider-environment-v1.json";
const MODEL_VISIBILITY_PREFERENCE_FILE = "openbot-model-visibility-v1.json";
const REMOTE_SESSION_REUSE_PREFERENCE_FILE = "openbot-remote-session-reuse-preference-v1.json";
const EXTERNAL_LINK_PREFERENCE_FILE = "openbot-external-link-preference-v1.json";
const REMOTE_NETWORK_ROUTE_PREFERENCE_FILE = "openbot-remote-network-route-v1.json";
const REMOTE_CONTROL_POLICY_FILE = "openbot-remote-control-policy-v1.json";
const APP_BEHAVIOR_PREFERENCE_FILE = "openbot-app-behavior-preference-v1.json";
const DYNAMIC_ISLAND_PREFERENCE_FILE = "openbot-dynamic-island-preference-v1.json";
const BROWSER_STATE_FILE = "openbot-browser-state-v1.json";
const SIDEBAR_LAYOUT_FILE = "openbot-sidebar-layout-v1.json";
const REMOTE_SERVERS_FILE = "openbot-remote-servers-v1.json";
const REMOTE_SESSIONS_FILE = "openbot-remote-sessions-v1.bin";
const LEGACY_REMOTE_DESKTOP_CREDENTIAL_FILE = "openbot-remote-desktop-credential-v1.json";
const CUSTOM_PROVIDERS_FILE = "openbot-custom-providers-v1.json";
const PROVIDER_CREDENTIAL_FILE = "openbot-provider-credentials-v1.json";
const MESSAGING_CREDENTIAL_FILE = "openbot-messaging-credentials-v1.json";
const INGRESS_QUEUE_KEY_FILE = "openbot-ingress-queue-key-v1.json";
const MCP_OAUTH_FILE = "openbot-mcp-oauth-v1.json";
const MCP_OAUTH_PROXY_FILE = "openbot-mcp-oauth-proxy-v1.json";
const GITHUB_CONNECTOR_FILE = "openbot-github-connector-v1.json";
const LINK_ACCOUNT_FILE = "openbot-link-account-v1.json";
const ONEPASSWORD_CONNECTOR_FILE = "openbot-onepassword-connector-v1.json";
const BITWARDEN_CONNECTOR_FILE = "openbot-bitwarden-connector-v1.json";
const PROTONPASS_CONNECTOR_FILE = "openbot-protonpass-connector-v1.json";
const VAULT_FILE = "openbot-vault-v1.json";
const HERMES_IMPORT_LINKS_FILE = "openbot-hermes-imports-v1.json";

const PACKAGED_BUNDLE_IDENTIFIER = "app.openbot.desktop";
const DEVELOPMENT_BUNDLE_IDENTIFIER = "com.github.Electron";

const TEARDOWN_ORDER = {
  resourceMonitor: 9,
  startupTiming: 9.5,
  requiredUpdate: 9.8,
  updater: 10,
  idleRestart: 11,
  hostUpdateCoordinator: 12,
  requestedUpdate: 13,
  hostedServerStartRetry: 14,
  launchPublishRetry: 14.5,
  hostedServerActivity: 15,
  serverMemory: 16,
  serverMode: 17,
  computerUseHighlight: 18,
  computerUsePermissionHelp: 19,
  dynamicIsland: 20,
  agentDock: 20.5,
  machineAlerts: 21,
  themePalettes: 22,
  providerAccountsHost: 27,
  providerHostSignIns: 28,
  mcpHostSignIns: 29,
  browser: 30,
  browserPictureInPicture: 40,
  detachedBrowserWindow: 40.5,
  localSignIn: 41,
  browserDock: 42,
  browserView: 45,
  providerDetection: 48,
  providerRuntimes: 50,
  localServers: 57,
  remoteServers: 60,
  voice: 70,
  speech: 71,
  remoteDesktop: 80,
  routineResults: 84,
  messaging: 85,
  hostEvents: 85.5,
  signalIngress: 86,
  host: 90,
  browserEgress: 99,
  teamWebRtcBridge: 100,
  routineFlows: 103,
  workflows: 103.5,
  crm: 103.75,
  routineFeed: 104,
  mcpOAuthRedirect: 105,
  onePasswordConnector: 106,
  bitwardenConnector: 106.5,
  passwordManagers: 106.75,
  githubConnector: 107,
  linkAccount: 107.5,
  automation: 108,
  storageUsage: 109,
  service: 110,
  cuaDriver: 110.5,
  mcpOAuth: 111,
  analytics: 112,
  centralAuth: 115,
  trace: 120,
  providerLog: 121,
  agentLog: 122,
  accountLog: 123,
  database: 130,
} as const;

export interface ApplicationServiceContext {
  mainWindow: BrowserWindow;
  windows: MainWindowController;
  appIconPath: string;
  appVariant: AppVariant;
  analyticsCaptureUrl: string | null;
  developmentRemoteRole: DevelopmentRemoteRole | null;
  developmentTestClientEnabled: boolean;
  hostedServer: HostedServerEnvironment | null;
  serverMode: ServerModeEnvironment | null;
  hostingDeveloperKey: string | null;
  localServerChild: LocalServerChildEnvironment | null;
  localServerControl: Readable | null;
  systemTimezone: () => string;
  previousUncleanExit: UncleanExitProperties | null;
  macHapticFeedback: MacHapticFeedback;
  teardown: TeardownRegistry;
  forwardCentralAuth: (state: CentralAuthState) => void;
  forwardBrowserDisplayState: (serverId: string, state: BrowserDisplayState) => void;
  forwardProviderRuntimeStatus: (snapshot: ProviderRuntimeSnapshot) => void;
  forwardVoiceModelStatus: (status: VoiceModelStatus) => void;
  forwardVoiceStreamTranscript: (transcript: VoiceStreamTranscript) => void;
  forwardSpeechModelStatus: (status: SpeechModelStatus) => void;
  forwardVoiceServerSettings: (settings: VoiceServerSettings | null) => void;
  forwardWorkflowNotice: (notice: WorkflowNotice) => void;
  prepareForUpdateInstall: () => Promise<void>;
  quitting: () => boolean;
}

export interface ApplicationServices {
  service: AgentService;
  workflows: WorkflowsHandle;
  workflowGitHub: WorkflowGitHubDirectory;
  crm: CrmHandle;
  routineResults: RoutineResultsHandle;
  providerRuntimes: ProviderRuntimeManager;
  providerCredentials: ProviderCredentialStore;
  messaging: MessagingService;
  teamWebRtcBridge: TeamWebRtcBridge;
  mcpOAuth: McpOAuth;
  signInRelayClient: SignInRelayClient;
  relayedMessagingInstalls: RelayedMessagingInstalls;
  githubConnector: GitHubConnectorService;
  linkAccount: LinkAccountService;
  onePasswordConnector: OnePasswordConnectorService;
  bitwardenConnector: BitwardenConnectorService;
  passwordManagers: PasswordManagersService;
  vault: VaultService;
  mailbox: MailboxStore;
  storageUsage: StorageUsageService;
  libraryFoldersService: LibraryFoldersService;
  workflowFoldersService: WorkflowFoldersService;
  browser: BrowserHost;
  browserPictureInPicture: BrowserPictureInPicture;
  detachedBrowserWindow: DetachedBrowserWindow;
  localSignIn: LocalSignInWindows;
  browserDock: BrowserDockOverlay;
  browserView: BrowserViewClient;
  updater: UpdateService;
  describeRestartReadiness: () => RestartReadiness;
  hostUpdateCoordinator: HostUpdateCoordinator;
  requestedUpdate: RequestedUpdate;
  idleRestart: IdleRestart;
  requiredUpdate: RequiredUpdate | null;
  setupFile: string;
  analyticsPreferences: AnalyticsPreferenceService;
  analyticsInstallId: string | null;
  updatePreferenceFile: string;
  approvalAutomation: ApprovalAutomation;
  agentAdminSettings: AgentAdminSettingsService;
  agentHostSettings: AgentHostSettingsService;
  agentDefaultsSettings: AgentDefaultsSettingsService;
  agentFolders: AgentFolders;
  channelFolders: ChannelFolders;
  agentInstructions: AgentInstructionsFiles;
  browserProfiles: BrowserProfileService;
  language: LanguageService;
  logoColor: LogoColorService;
  appearance: AppearanceService;
  interfaceSize: InterfaceSizeService;
  notificationPreference: NotificationPreferenceStore;
  busyMessageMode: BusyMessageModePreferenceStore;
  agentDefaults: AgentDefaultsPreferenceStore;
  agentMemoryLimit: AgentMemoryLimitSetting;
  memoryReview: MemoryReviewPreferenceStore;
  skillLearning: SkillLearningPreferenceStore;
  browsingMemory: BrowsingMemoryPreferenceStore;
  agentNotificationLevels: AgentNotificationLevelStore;
  sidebarPins: SidebarPinStore;
  agentAccess: AgentAccessStore;
  mcpAccess: McpAccessControl;
  serverAudit: ServerAuditStore;
  serverTimezone: ServerTimezonePreferenceStore;
  hostTurnLimits: HostTurnLimitsPreferenceStore;
  serverPersonality: ServerPersonalityPreferenceStore;
  promptCacheTtl: PromptCacheTtlPreferenceStore;
  claudeUserSetup: ClaudeUserSetupControl;
  claudeCompactWindow: ClaudeCompactWindowControl;
  providerEnvironment: ProviderEnvironmentControl;
  modelVisibility: ModelVisibility;
  remoteSessionReuse: RemoteSessionReusePreferenceStore;
  externalLinkPreference: ExternalLinkPreferenceStore;
  externalLinks: ExternalLinkOpener;
  openLink: (url: string) => Promise<void>;
  remoteNetworkRoute: RemoteNetworkRoutePreferenceStore;
  remoteSessionCache: RemoteSessionCache;
  appBehavior: AppBehaviorService;
  agentInitialization: AgentInitializationGate<AgentLifecycleFailed>;
  sidebarLayout: SidebarLayoutStore;
  host: HostService;
  remoteDesktop: RemoteDesktopManager;
  remoteServers: RemoteServerManager;
  localServers: LocalServers | null;
  centralAuth: CentralAuthManager;
  skills: SkillMarketplaceService;
  hostedSites: HostedSiteDesktopService;
  billing: BillingDesktopService;
  referral: ReferralDesktopService;
  license: LicenseDesktopService;
  hostedServers: HostedServerDesktopService;
  routineFeed: RoutineFeedServer;
  events: HostEventsService;
  eventsRuntime: HostEventsRuntime;
  webhookPrincipal: () => string | null;
  serverMode: ServerMode | null;
  customProviders: CustomProviderStore;
  customProviderChanges: CustomProviderChanges;
  customAgentChanges: CustomAgentChanges;
  acpRegistry: AcpRegistry;
  providerDetection: ProviderDetection;
  providerDetectionSettings: ProviderDetectionSettingsStore;
  marketplaceAgents: AgentMarketplaceService;
  agentTemplates: AgentTemplateService;
  agentImport: AgentImportService;
  hermesImport: HermesImportService;
  instanceTransfer: InstanceTransferService;
  voice: VoiceTranscriptionService;
  speech: VoiceSpeechService;
  voiceServer: VoiceServerService;
  dynamicIsland: DynamicIslandWindowController;
  agentDock: AgentDockWindowController;
  cuaDriver: CuaDriverRuntime;
  computerUseHighlight: ComputerUseHighlightController;
  computerUsePermissionHelp: ComputerUsePermissionHelpWindowController;
  analytics: HostAnalytics;
  prewarmAgentDatabase: Effect.Effect<void>;
  trace: TraceFile;
  resourceMonitor: ResourceMonitor;
  startup: StartupTiming | null;
  machineAlerts: MachineAlertMonitor;
  teamStore: TeamStore;
  appliedAccount: CentralAuthState;
  centralAuthInitialization: Effect.Effect<CentralAuthState, RemoteWorkflowError>;
}

function computerUseCapability(state: ComputerUseState): CapabilityState {
  if (state.status === "ready") return "ready";
  if (state.status === "permissions-required" || state.status === "restart-required") return "setup-required";
  return "unavailable";
}

interface MessagingServicesContext {
  teardown: TeardownRegistry;
  secretCipher: SecretStorageCipher;
  centralAuth: CentralAuthManager;
  accountSession: Pick<CentralAuthManager, "requestAuthorized">;
  service: AgentService;
  sidebarLayout: SidebarLayoutStore;
  readHostId: () => string | null;
  issueGitHubRoute: (hostId: string) => Effect.Effect<string, RemoteWorkflowError>;
  openLink: (url: string) => Promise<void>;
}

async function createMessagingServices({
  teardown,
  secretCipher,
  centralAuth,
  accountSession,
  service,
  sidebarLayout,
  readHostId,
  issueGitHubRoute,
  openLink,
}: MessagingServicesContext): Promise<{ messaging: MessagingService; signalIngress: SignalIngress }> {
  const messagingCredentials = new MessagingCredentialStore(
    join(app.getPath("userData"), MESSAGING_CREDENTIAL_FILE),
    secretCipher,
  );
  const messagingCredentialLoadError = await Effect.runPromise(messagingCredentials.load());
  if (messagingCredentialLoadError)
    logger.warn(
      `OpenBot could not read the messaging token file (${messagingCredentialLoadError.name}). It was left unchanged.`,
    );
  const signalIngress = new SignalIngress({
    hostId: readHostId,
    signedIn: () => {
      const hostId = readHostId();
      if (hostId && centralAuth.hostSiteCredential(hostId)) return true;
      try {
        centralAuth.getSignedInUser();
        return true;
      } catch {
        return false;
      }
    },
    issueTicket: (hostId) => centralAuth.issueRemoteHostTicket(hostId).pipe(toRemoteWorkflowError),
    issueSlackRoute: (hostId) => centralAuth.issueSlackRoute(hostId).pipe(toRemoteWorkflowError),
    issueDiscordRoute: (hostId) => centralAuth.issueDiscordRoute(hostId).pipe(toRemoteWorkflowError),
    issueWebhookRoute: (hostId) => centralAuth.issueWebhookRoute(hostId).pipe(toRemoteWorkflowError),
    issueTelegramRoute: (hostId) => centralAuth.issueTelegramRoute(hostId).pipe(toRemoteWorkflowError),
    issueGitHubRoute,
    queueKey: () => loadIngressQueueKey(join(app.getPath("userData"), INGRESS_QUEUE_KEY_FILE), secretCipher),
  });
  teardown.push(TEARDOWN_ORDER.signalIngress, "the Signal ingress socket", () =>
    Effect.runPromise(signalIngress.dispose()),
  );
  const developmentSlackCallbackPort = app.isPackaged ? 0 : Number(process.env.OPENBOT_DEV_SLACK_CALLBACK_PORT ?? 0);
  const whatsapp = new WhatsAppRuntime({
    root: join(app.getPath("userData"), "whatsapp"),
    createSocket: (config) => makeWASocket(config),
    makeSignalRepository: makeOpenBotSignalRepository,
  });
  const messaging = new MessagingService({
    threads: service.messaging,
    agents: {
      listAgents: () => service.listAgents(),
      respondToApproval: (input) => service.respondToApproval(input, { owner: false }),
      approvalExecutionThreadId: (requestId) => service.approvalExecutionThreadId(requestId),
      onEvent: (listener) => {
        service.on("event", listener);
        return () => service.off("event", listener);
      },
      createAgentProfile: (input) => service.createAgentProfile(input),
      createMemory: (input) => service.createMemory(input),
      ensureDeletable: (agentId) => service.ensureAgentDeletable(agentId),
      deleteAgent: (agentId) => service.deleteAgent(agentId),
      sidebarChatIds: () => service.sidebarChatIds(),
    },
    credentials: messagingCredentials,
    drivers: [
      slackDriver({ ingress: signalIngress }),
      discordDriver({ ingress: signalIngress }),
      telegramDriver({ ingress: signalIngress, history: service.messaging.history }),
      whatsAppDriver({ runtime: whatsapp }),
    ],
    downloadsRoot: join(app.getPath("userData"), "messaging-downloads"),
    statusPath: join(app.getPath("userData"), "openbot-messaging-status-v1.json"),
    ingress: signalIngress,
    whatsapp,
    sidebar: sidebarLayout,
    slackApp: {
      authorize: (input) =>
        Effect.suspend(() => {
          const hostId = readHostId();
          if (!hostId)
            return Effect.fail(
              new SlackConnectFailed({ cause: new Error(sourceText("error.messaging.relayUnavailable")) }),
            );
          return accountSession
            .requestAuthorized(
              "/v2/slack/authorize",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  hostId,
                  ...input,
                  ...(developmentSlackCallbackPort > 0
                    ? { returnUrl: `http://127.0.0.1:${developmentSlackCallbackPort}${SLACK_DEV_CALLBACK_PATH}` }
                    : {}),
                }),
              },
              (value) => requiredString(decodeRecord(value, "Slack sign-in"), "authorizeUrl"),
            )
            .pipe(toSlackConnectFailed);
        }),
      unlink: (workspaceId) =>
        Effect.suspend(() => {
          const hostId = readHostId();
          return hostId
            ? centralAuth.unlinkSlackWorkspace(hostId, workspaceId).pipe(toSlackConnectFailed)
            : Effect.void;
        }),
      openExternal: openLink,
    },
    discordApp: {
      authorize: (input) =>
        Effect.suspend(() => {
          const hostId = readHostId();
          if (!hostId)
            return Effect.fail(
              new DiscordConnectFailed({ cause: new Error(sourceText("error.messaging.discordRelayUnavailable")) }),
            );
          return accountSession
            .requestAuthorized(
              "/v2/discord/authorize",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ hostId, ...input }),
              },
              (value) => requiredString(decodeRecord(value, "Discord sign-in"), "authorizeUrl"),
            )
            .pipe(toDiscordConnectFailed);
        }),
      unlink: (guildId) =>
        Effect.suspend(() => {
          const hostId = readHostId();
          return hostId ? centralAuth.unlinkDiscordGuild(hostId, guildId).pipe(toDiscordConnectFailed) : Effect.void;
        }),
      openExternal: openLink,
    },
    telegramApp: {
      createLink: () =>
        Effect.suspend(() => {
          const hostId = readHostId();
          if (!hostId)
            return Effect.fail(
              new MessagingOperationFailed({
                cause: new Error(sourceText("error.messaging.telegramRelayUnavailable")),
              }),
            );
          return centralAuth.createTelegramLink(hostId).pipe(
            Effect.mapError(({ cause }) => {
              const notConfigured =
                cause instanceof Error && "code" in cause && cause.code === "telegram_not_configured";
              return new MessagingOperationFailed({
                cause: notConfigured ? new Error(sourceText("error.messaging.telegramServiceUnavailable")) : cause,
              });
            }),
          );
        }),
      unlink: (chatId) =>
        Effect.suspend(() => {
          const hostId = readHostId();
          return hostId
            ? centralAuth
                .unlinkTelegramChat(hostId, chatId)
                .pipe(Effect.mapError((error) => new MessagingOperationFailed({ cause: error.cause })))
            : Effect.void;
        }),
      openExternal: openLink,
    },
  });
  void runCauseEffect(messaging.start()).catch((error) =>
    logger.warn("Messaging connections did not start.", toLogValue(error)),
  );
  teardown.push(TEARDOWN_ORDER.messaging, "the messaging connections", () => Effect.runPromise(messaging.stop()));
  if (developmentSlackCallbackPort > 0) {
    const callback = await startSlackDevCallbackServer(developmentSlackCallbackPort, async (nonce, grant) => {
      const received = await runCauseEffect(messaging.completeSlackWorkspace(nonce, grant));
      if (received) app.focus({ steal: true });
      return received;
    });
    teardown.push(TEARDOWN_ORDER.signalIngress, "the Slack development callback", () => callback.close());
  }
  return { messaging, signalIngress };
}

export async function createApplicationServices({
  mainWindow,
  windows,
  appIconPath,
  appVariant,
  analyticsCaptureUrl,
  developmentRemoteRole,
  developmentTestClientEnabled,
  hostedServer,
  serverMode: serverModeEnvironment,
  hostingDeveloperKey,
  localServerChild,
  localServerControl,
  systemTimezone,
  previousUncleanExit,
  macHapticFeedback,
  teardown,
  forwardCentralAuth,
  forwardBrowserDisplayState,
  forwardProviderRuntimeStatus,
  forwardVoiceModelStatus,
  forwardVoiceStreamTranscript,
  forwardSpeechModelStatus,
  forwardVoiceServerSettings,
  forwardWorkflowNotice,
  prepareForUpdateInstall,
  quitting,
}: ApplicationServiceContext): Promise<ApplicationServices> {
  performance.mark("openbot:services.start");
  teardown.push(
    TEARDOWN_ORDER.providerLog,
    "the provider log",
    startProviderLog(join(app.getPath("userData"), "logs")),
  );
  teardown.push(TEARDOWN_ORDER.agentLog, "the agent log", startAgentLog(join(app.getPath("userData"), "logs")));
  teardown.push(TEARDOWN_ORDER.accountLog, "the account log", startAccountLog(join(app.getPath("userData"), "logs")));
  const externalLinkPreference = createExternalLinkPreferenceStore(
    join(app.getPath("userData"), EXTERNAL_LINK_PREFERENCE_FILE),
  );
  const externalLinks = new ExternalLinkOpener({
    preference: externalLinkPreference,
    platform: process.platform,
    openDefault: (url) => shell.openExternal(url),
    onFallback: (fallback) =>
      sendToRenderer(
        BrowserWindow.getFocusedWindow() ?? windows.getMainWindow(),
        IPC_ENDPOINTS.app.externalLinkFallback,
        fallback,
      ),
  });
  const openLink = (url: string) => runCauseEffect(externalLinks.open(url));
  let criticalActionTargets: { agents: AgentService; host: HostService; remoteServers: RemoteServerManager } | null =
    null;
  const windowKind = aboveAppsWindowKind(Boolean(hostedServer || serverModeEnvironment || localServerChild));
  const language = new LanguageService({
    path: join(app.getPath("userData"), LANGUAGE_PREFERENCE_FILE),
    systemLocale: app.getLocale(),
  });
  const pointerForwarding =
    windowKind === "tool" ? new PointerForwardingGate(() => screen.getCursorScreenPoint()) : null;
  const topmost = windowKind === "tool" ? new WindowsTopmostKeeper() : null;
  const dynamicIsland = new DynamicIslandWindowController({
    windowKind,
    preferencePath: join(app.getPath("userData"), DYNAMIC_ISLAND_PREFERENCE_FILE),
    ...(process.env.ELECTRON_RENDERER_URL
      ? { defaultPreference: { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE, enabled: false } }
      : {}),
    createWindow: createDynamicIslandWindow,
    loadWindow: (window, display) => loadDynamicIslandRenderer(window, display, appVariant),
    getDisplays: () => screen.getAllDisplays(),
    getPrimaryDisplay: () => screen.getPrimaryDisplay(),
    getMainWindow: windows.getMainWindow,
    getFocusedWindow: () => BrowserWindow.getFocusedWindow(),
    ensureMainWindow: windows.ensureMainWindow,
    presentMainWindow: showMainWindow,
    performHaptic: () => macHapticFeedback.performAlignment(),
    showContextMenu: (window) =>
      Menu.buildFromTemplate([
        {
          label: language.translate("menu.hideDynamicIsland"),
          click: () =>
            void runCauseEffect(
              dynamicIsland
                .hide()
                .pipe(
                  Effect.andThen(
                    setAboveAppsXWayland(app.getPath("userData"), "dynamic-island", false).pipe(Effect.ignore),
                  ),
                ),
            ).catch((error: unknown) => logger.warn("The Dynamic Island did not turn off.", toLogValue(error))),
        },
      ]).popup({ window }),
    pointerForwarding,
    topmost,
    performCriticalAction: (action) =>
      Effect.suspend(() => {
        if (!criticalActionTargets) {
          return Effect.fail(new DynamicIslandFailed({ cause: new Error(sourceText("error.app.notReady")) }));
        }
        const { agents, host, remoteServers } = criticalActionTargets;
        return performDynamicIslandCriticalAction(
          action,
          agents,
          remoteServers,
          { decodeVoid, decodeQueuedMessageReceipt },
          () => host.conversationSender(),
        ).pipe(toDynamicIslandFailed);
      }),
  });
  teardown.push(TEARDOWN_ORDER.dynamicIsland, "the Dynamic Island", () => dynamicIsland.destroy());
  const agentDock = new AgentDockWindowController({
    windowKind,
    createWindow: createAgentDockWindow,
    loadWindow: loadAgentDockRenderer,
    screen,
    getMainWindow: windows.getMainWindow,
    ensureMainWindow: windows.ensureMainWindow,
    presentMainWindow: showMainWindow,
    pointerForwarding,
    topmost,
    sendMessage: (action) =>
      Effect.suspend(() => {
        if (!criticalActionTargets) {
          return Effect.fail(new AgentDockFailed({ cause: new Error(sourceText("error.app.notReady")) }));
        }
        const { agents, host, remoteServers } = criticalActionTargets;
        if (action.seat.kind === "channel") {
          const command: ChannelCommand = {
            type: "send",
            operationId: action.clientMessageId,
            channelId: action.seat.id,
            text: action.text,
            recipientAgentId: leadingAddress(action.text).mentions[0]?.id ?? null,
            replyToMessageId: null,
            attachmentDraftIds: [],
          };
          const sent =
            action.serverId === LOCAL_SERVER_ID
              ? agents.channels.command(command, host.channelActor()).pipe(Effect.asVoid)
              : remoteServers
                  .request(action.serverId, CHANNEL_ROUTES.command, decodeChannel, { method: "POST", body: command })
                  .pipe(Effect.asVoid);
          return sent.pipe(toAgentDockFailed);
        }
        return performDynamicIslandCriticalAction(
          {
            type: "send-message",
            serverId: action.serverId,
            agentId: action.seat.id,
            text: action.text,
            clientMessageId: action.clientMessageId,
          },
          agents,
          remoteServers,
          { decodeVoid, decodeQueuedMessageReceipt },
          () => host.conversationSender(),
        ).pipe(toAgentDockFailed);
      }),
  });
  teardown.push(TEARDOWN_ORDER.agentDock, "the agent dock", () => agentDock.destroy());
  const centralAuth = createCentralAuthManager({
    companySignInBrowser: { open: (url) => shell.openExternal(url), language: () => language },
    confirmSessionAtStart: hostedServer !== null && hostedServer !== undefined,
  });
  teardown.push(TEARDOWN_ORDER.centralAuth, "the account runtime", () => Effect.runPromise(centralAuth.dispose()));
  centralAuth.on("changed", forwardCentralAuth);
  const centralAuthInitialization = Effect.runSync(Effect.cached(centralAuth.initialize().pipe(toRemoteWorkflowError)));
  void Effect.runPromise(centralAuthInitialization).catch((error) =>
    logger.warn("The account did not initialize.", toLogValue(error)),
  );

  let profileRefreshActive = true;
  let profileRefreshing = false;
  let profileRefreshAgain = false;
  const refreshAccountProfile = async () => {
    if (!profileRefreshActive) return;
    if (profileRefreshing) {
      profileRefreshAgain = true;
      return;
    }
    profileRefreshing = true;
    try {
      do {
        profileRefreshAgain = false;
        await runCauseEffect(centralAuth.refreshProfile());
      } while (profileRefreshAgain && profileRefreshActive);
    } finally {
      profileRefreshing = false;
    }
  };
  let profileTimer: ReturnType<typeof setInterval> | null = null;
  const stopProfileTimer = () => {
    if (profileTimer !== null) clearInterval(profileTimer);
    profileTimer = null;
  };
  const startProfileTimer = () => {
    stopProfileTimer();
    profileTimer = setInterval(() => void refreshAccountProfile(), REMOTE_ACCOUNT_CHECK_INTERVAL_MS);
    profileTimer.unref();
  };
  if (mainWindow.isFocused()) startProfileTimer();
  mainWindow.on("focus", startProfileTimer);
  mainWindow.on("blur", stopProfileTimer);
  teardown.push(TEARDOWN_ORDER.updater, "account profile refresh", () => {
    profileRefreshActive = false;
    stopProfileTimer();
    mainWindow.removeListener("focus", startProfileTimer);
    mainWindow.removeListener("blur", stopProfileTimer);
    centralAuth.stopProfileRefresh();
  });
  const agentDefaults = createAgentDefaultsPreferenceStore(
    join(app.getPath("userData"), AGENT_DEFAULTS_PREFERENCE_FILE),
  );
  await runCauseEffect(agentDefaults.load());
  const store = new AgentStore(
    app.getPath("userData"),
    homedir(),
    new OpenBotDatabase(app.getPath("userData"), checkDatabaseIntegrityInHost),
    () => agentDefaults.get(),
    localServerChild?.agentRoot,
  );
  performance.mark("openbot:services.pre-store");
  await runCauseEffect(store.initialize());
  performance.mark("openbot:services.store");
  teardown.push(TEARDOWN_ORDER.database, "the database", () => store.database.close(), { afterAbandonedSteps: true });
  const managedSkills = new ManagedSkillService(
    app.isPackaged
      ? join(process.resourcesPath, "managed-skills", "openbot-site-hosting", "SKILL.md")
      : resolve(__dirname, "../../resources/managed-skills/openbot-site-hosting/SKILL.md"),
  );
  const skillCreator = new ManagedSkillService(
    app.isPackaged
      ? join(process.resourcesPath, "managed-skills", "openbot-skill-creator", "SKILL.md")
      : resolve(__dirname, "../../resources/managed-skills/openbot-skill-creator/SKILL.md"),
    undefined,
    undefined,
    SKILL_CREATOR_SKILL_SLUG,
  );
  const dataSkill = new ManagedSkillService(
    app.isPackaged
      ? join(process.resourcesPath, "managed-skills", "openbot-data", "SKILL.md")
      : resolve(__dirname, "../../resources/managed-skills/openbot-data/SKILL.md"),
    undefined,
    undefined,
    DATA_SKILL_SLUG,
  );
  await Effect.runPromise(
    Effect.all(
      [managedSkills, skillCreator, dataSkill].map((skill) => skill.syncAll(store.list())),
      {
        concurrency: "unbounded",
        discard: true,
      },
    ),
  );
  performance.mark("openbot:services.skills");
  const hostedSites = new HostedSiteDesktopService(centralAuth, () => {
    const hostId = teamStore.getIdentity()?.serverId;
    return hostId ? centralAuth.hostSiteCredential(hostId) : null;
  });
  const billing = new BillingDesktopService(centralAuth, openLink);
  const referral = new ReferralDesktopService(centralAuth, openLink);
  const license = new LicenseDesktopService(centralAuth, openLink);
  const hostedServers = new HostedServerDesktopService(
    withHostingDeveloperKey(centralAuth, hostingDeveloperKey),
    openLink,
    Date.now,
    (serverId) => {
      if (!remoteServers.list().some((server) => server.id === serverId))
        void Effect.runPromise(remoteServers.invalidateDirectory());
    },
    (serverId, server) => remoteServers.hostedServerStarting(serverId, server),
    (expiresAt) => serverClaimWatch.add(expiresAt),
  );
  const serverClaimWatch = watchServerClaims({
    serverIds: () =>
      remoteServers
        .list()
        .filter((server) => server.kind === "remote")
        .map((server) => server.id),
    refresh: () => remoteServers.requestDirectoryRefresh(),
  });
  const sidebarLayout = new SidebarLayoutStore(join(app.getPath("userData"), SIDEBAR_LAYOUT_FILE));
  await runCauseEffect(sidebarLayout.initialize());
  const libraryFolders = new LibraryFoldersStore(join(app.getPath("userData"), LIBRARY_FOLDERS_FILE));
  await runCauseEffect(libraryFolders.initialize());
  const workflowFolders = new WorkflowFoldersStore(join(app.getPath("userData"), WORKFLOW_FOLDERS_FILE));
  await runCauseEffect(workflowFolders.initialize());
  const mailbox = new MailboxStore(app.getPath("userData"), store.sharedRoot, store.database);
  await runCauseEffect(mailbox.initialize());
  configureApplicationProtocol();
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const teamWebRtcBridge = new TeamWebRtcBridge({
    developmentUrl: developmentUrl ?? null,
    iceTransportPolicy: developmentUrl && process.env.OPENBOT_DEV_ICE_TRANSPORT_POLICY === "relay" ? "relay" : "all",
  });
  teamWebRtcBridge.on("accountProfileChanged", refreshAccountProfile);
  teardown.push(TEARDOWN_ORDER.teamWebRtcBridge, "the team WebRTC bridge", () =>
    runCauseEffect(teamWebRtcBridge.stop()),
  );
  const browserEgress = new BrowserEgressHost(teamWebRtcBridge);
  teardown.push(TEARDOWN_ORDER.browserEgress, "the computer proxies of members", () => browserEgress.dispose());
  const hostMemory =
    hostedServer || serverModeEnvironment
      ? new ServerMemory({
          hostedPlan: hostedServer !== null,
          onError: (message, error) => logger.warn(message, toLogValue(error)),
          onAgentProcessStopped: (stopped) =>
            logger.warn("Stopped a leftover agent process to free memory.", { ...stopped }),
        })
      : null;
  const cpuLimitModule = app.isPackaged
    ? join(process.resourcesPath, "agent-runtime", "cpu-limit.cjs")
    : resolve(__dirname, "../../resources/agent-runtime/cpu-limit.cjs");
  const certificateEnvironment = await Effect.runPromise(
    agentCertificateEnvironment(join(app.getPath("userData"), AGENT_CERTIFICATES_FILE)).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          logger.warn("Could not give the system root certificates to agent processes:", toLogValue(error));
          return {};
        }),
      ),
    ),
  );
  const serverEnvironment = {
    ...(hostMemory
      ? agentProcessEnvironment(existsSync(cpuLimitModule) ? cpuLimitModule : null)
      : { [AGENT_PROCESS_VARIABLE]: "1" }),
    ...certificateEnvironment,
  };
  if (hostMemory) {
    hostMemory.start();
    teardown.push(TEARDOWN_ORDER.serverMemory, "the server memory reading", () => Effect.runPromise(hostMemory.stop()));
  }
  const browserProfileStore = new BrowserProfileStore(store.database);
  const browserProxyStore = new BrowserProxyStore(store.database);
  const siteMemoryStore = new AgentMemoryStore(store.database);
  const browserProxyCipher = safeStorageCipher("error.app.secretStorageUnavailable");
  const browsingMemory = new BrowsingMemoryPreferenceStore(
    join(app.getPath("userData"), BROWSING_MEMORY_PREFERENCE_FILE),
  );
  await runCauseEffect(browsingMemory.load());
  const userBrowsing = new UserBrowsingLog(join(app.getPath("userData"), USER_BROWSING_FILE));
  await Effect.runPromise(userBrowsing.load());
  browsingMemory.onChange(({ enabled }) => {
    if (!enabled) Effect.runFork(userBrowsing.clear());
  });
  let browserProxyStatusChanged = () => {};
  let agentBrowserProfiles: BrowserProfileService | null = null;
  let crmHandle: CrmHandle | null = null;
  const agentThreads = new AgentThreadStore(store.database);
  const agentMemoryOn = (agentId: string) => {
    const agent = store.get(agentId);
    return agent === undefined || agentMemoryEnabled(agent);
  };
  const browser = new BrowserHost(mainWindow, store.downloadsRoot, join(app.getPath("userData"), BROWSER_STATE_FILE), {
    memoryLow: () => (hostMemory?.level() ?? "ok") !== "ok",
    ...(hostMemory ? { tabLimit: () => hostMemory.browserTabLimit() } : {}),
    browserProfile: (agentId) => {
      const agent = store.get(agentId);
      return agent ? agentBrowserProfile(agent) : { kind: "shared" };
    },
    profileExists: (profileId) => browserProfileStore.get(profileId) !== undefined,
    agentChat: (threadId) => browserAgentChat(store, agentThreads, threadId),
    profileProxy: (profileId) => browserProxyConnection(browserProxyStore, browserProxyCipher, profileId),
    onProxyStatusChanged: () => browserProxyStatusChanged(),
    computerExit: (memberId) => browserEgress.exit(memberId),
    quitShortcut: (input) => windows.handleQuitShortcut(mainWindow, input),
    pagePreload: join(__dirname, "../preload/browserPage.cjs"),
    siteMemories: (agentId, hostname) =>
      agentMemoryOn(agentId)
        ? siteMemoryStore
            .forHost(agentId, hostname)
            .flatMap(({ id, site, text }) => (site ? [{ id, site, text: redactSecrets(text) }] : []))
        : [],
    userBrowsing: {
      enabled: () => browsingMemory.get().enabled,
      record: (agentId, step) => {
        if (agentMemoryOn(agentId)) Effect.runFork(userBrowsing.record(agentId, step));
      },
    },
    hideFromWindowSwitchers: hidePanelFromWindowSwitchers,
  });
  teardown.push(TEARDOWN_ORDER.browser, "the browser", () => runCauseEffect(browser.destroy()));
  await runCauseEffect(browser.restore(store.list().map((agent) => ({ id: agent.id, threadId: agent.threadId }))));
  performance.mark("openbot:services.browser");
  const browserPictureInPicture = new BrowserPictureInPicture({
    mainWindow,
    browser,
    preloadPath: join(__dirname, "../preload/index.cjs"),
    iconPath: appIconPath,
    ...(developmentUrl === undefined ? {} : { developmentUrl }),
    onEvent: (event) => {
      const window = windows.getMainWindow();
      if (!window || window.isDestroyed()) return;
      sendToRenderer(window, IPC_ENDPOINTS.browser.pictureInPictureEvent, event);
    },
  });
  teardown.push(TEARDOWN_ORDER.browserPictureInPicture, "picture in picture", () => browserPictureInPicture.destroy());
  const detachedBrowserWindow = new DetachedBrowserWindow({
    mainWindow,
    browser,
    preloadPath: join(__dirname, "../preload/index.cjs"),
    iconPath: appIconPath,
    title: () => language.translate("browser.panel.label"),
    ...(developmentUrl === undefined ? {} : { developmentUrl }),
    onEvent: (event) => {
      const window = windows.getMainWindow();
      if (!window || window.isDestroyed()) return;
      sendToRenderer(window, IPC_ENDPOINTS.browser.windowEvent, event);
    },
    onModel: (window, model) => {
      sendToRenderer(window, IPC_ENDPOINTS.browser.windowModel, model);
    },
  });
  teardown.push(TEARDOWN_ORDER.detachedBrowserWindow, "the browser window", () => detachedBrowserWindow.destroy());
  const localSignIn = new LocalSignInWindows();
  teardown.push(TEARDOWN_ORDER.localSignIn, "the local sign-in window", () => Effect.runPromise(localSignIn.discard()));
  const browserDock = new BrowserDockOverlay({
    mainWindow,
    preloadPath: join(__dirname, "../preload/index.cjs"),
    load: loadBrowserDockRenderer,
    forwardShortcut: (input) => windows.handleQuitShortcut(mainWindow, input) || browser.forwardDockShortcut(input),
  });
  browser.setMainPageListener((page) => browserDock.setPage(page));
  teardown.push(TEARDOWN_ORDER.browserDock, "the browser dock", () => {
    browser.setMainPageListener(null);
    browserDock.destroy();
  });
  browser.onChanged((tabs, activeTabId) => forwardBrowserDisplayState(LOCAL_SERVER_ID, { tabs, activeTabId }));
  const setupFile = join(app.getPath("userData"), SETUP_FILE);
  const analyticsPreferenceFile = join(app.getPath("userData"), ANALYTICS_PREFERENCE_FILE);
  const updatePreferenceFile = join(app.getPath("userData"), UPDATE_PREFERENCE_FILE);
  const routineHoldFile = join(app.getPath("userData"), ROUTINE_HOLD_FILE);
  const logoColor = new LogoColorService({ path: join(app.getPath("userData"), LOGO_COLOR_PREFERENCE_FILE) });
  const appearance = new AppearanceService({
    path: join(app.getPath("userData"), APPEARANCE_PREFERENCE_FILE),
    paletteDirectory: join(app.getPath("userData"), THEME_PALETTE_DIRECTORY),
    supportsTransparentWindow: process.platform === "darwin",
  });
  const interfaceSize = new InterfaceSizeService({
    path: join(app.getPath("userData"), INTERFACE_SIZE_PREFERENCE_FILE),
  });
  const notificationPreference = new NotificationPreferenceStore(
    join(app.getPath("userData"), NOTIFICATION_PREFERENCE_FILE),
  );
  const busyMessageMode = new BusyMessageModePreferenceStore(
    join(app.getPath("userData"), BUSY_MESSAGE_MODE_PREFERENCE_FILE),
  );
  const agentMemoryLimit = new AgentMemoryLimitPreferenceStore(
    join(app.getPath("userData"), AGENT_MEMORY_LIMIT_PREFERENCE_FILE),
  );
  const memoryReview = new MemoryReviewPreferenceStore(join(app.getPath("userData"), MEMORY_REVIEW_PREFERENCE_FILE));
  const agentNotificationLevels = new AgentNotificationLevelStore(
    join(app.getPath("userData"), AGENT_NOTIFICATION_LEVELS_FILE),
  );
  const sidebarPins = new SidebarPinStore(join(app.getPath("userData"), SIDEBAR_PINS_FILE));
  const skillLearning = new SkillLearningPreferenceStore(join(app.getPath("userData"), SKILL_LEARNING_PREFERENCE_FILE));
  const serverAudit = new ServerAuditStore(join(app.getPath("userData"), SERVER_AUDIT_FILE));
  const agentAccess = new AgentAccessStore(join(app.getPath("userData"), AGENT_ACCESS_FILE), {
    audit: (serverId, before, after, actor) =>
      serverAudit.recordAgentAccess(serverId, actor, before, after, () =>
        serverAuditNames(teamStore.configured ? teamStore.listMembers() : [], service.listAgents()),
      ),
  });
  const mcpServerOwners = new McpServerOwnersStore(join(app.getPath("userData"), MCP_SERVER_OWNERS_FILE));
  const mcpAccessStore = new McpAccessStore(join(app.getPath("userData"), MCP_ACCESS_FILE));
  const serverTimezone = new ServerTimezonePreferenceStore(
    join(app.getPath("userData"), SERVER_TIMEZONE_PREFERENCE_FILE),
    systemTimezone,
  );
  const hostTurnLimits = new HostTurnLimitsPreferenceStore(
    join(app.getPath("userData"), HOST_TURN_LIMITS_PREFERENCE_FILE),
    () => hostMemory?.turnLimit() ?? null,
  );
  const serverPersonality = new ServerPersonalityPreferenceStore(
    join(app.getPath("userData"), SERVER_PERSONALITY_PREFERENCE_FILE),
  );
  const promptCacheTtl = new PromptCacheTtlPreferenceStore(
    join(app.getPath("userData"), PROMPT_CACHE_TTL_PREFERENCE_FILE),
  );
  const claudeUserSetup = createClaudeUserSetupPreferenceStore(
    join(app.getPath("userData"), CLAUDE_USER_SETUP_PREFERENCE_FILE),
  );
  const crmPreference = createCrmPreferenceStore(join(app.getPath("userData"), CRM_PREFERENCE_FILE));
  const claudeCompactWindow = createClaudeCompactWindowPreferenceStore(
    join(app.getPath("userData"), CLAUDE_COMPACT_WINDOW_PREFERENCE_FILE),
  );
  const providerEnvironment = createProviderEnvironmentPreferenceStore(
    join(app.getPath("userData"), PROVIDER_ENVIRONMENT_PREFERENCE_FILE),
  );
  const remoteSessionReuse = createRemoteSessionReusePreferenceStore(
    join(app.getPath("userData"), REMOTE_SESSION_REUSE_PREFERENCE_FILE),
  );
  const remoteNetworkRoute = createRemoteNetworkRoutePreferenceStore(
    join(app.getPath("userData"), REMOTE_NETWORK_ROUTE_PREFERENCE_FILE),
  );
  const remoteControlPolicy = createRemoteControlPolicyStore(join(app.getPath("userData"), REMOTE_CONTROL_POLICY_FILE));
  const appBehavior = new AppBehaviorService({
    path: join(app.getPath("userData"), APP_BEHAVIOR_PREFERENCE_FILE),
    loginItem: createLoginItem({
      appVariant,
      server: Boolean(hostedServer || serverModeEnvironment || localServerChild),
    }),
    offersBackground: !hostedServer && !serverModeEnvironment && !localServerChild,
    menuBar: process.platform === "darwin",
    offersKeepAwake: process.platform !== "linux" && !hostedServer && !serverModeEnvironment && !localServerChild,
    offersQuitGuard: process.platform === "darwin" && !hostedServer && !serverModeEnvironment && !localServerChild,
  });
  const loadPreferences = Effect.all(
    [
      language.load(),
      logoColor.load(),
      interfaceSize.load(),
      notificationPreference.load(),
      busyMessageMode.load(),
      agentMemoryLimit.load(),
      agentNotificationLevels.load(),
      sidebarPins.load(),
      memoryReview.load(),
      skillLearning.load(),
      serverAudit.load(),
      mcpServerOwners.load(),
      serverTimezone.load(),
      hostTurnLimits.load(),
      serverPersonality.load(),
      promptCacheTtl.load(),
      claudeUserSetup.load(),
      crmPreference.load(),
      claudeCompactWindow.load(),
      providerEnvironment.load(),
      remoteSessionReuse.load(),
      externalLinkPreference.load(),
      remoteNetworkRoute.load(),
      remoteControlPolicy.load(),
      appBehavior.load(),
    ],
    { concurrency: "unbounded", discard: true },
  );
  const [setupState, palettesWatch, rolesLoaded, mcpAccessLoaded] = await Promise.all([
    runCauseEffect(readSetupState(setupFile)),
    runCauseEffect(appearance.load()).then(() => Effect.runPromise(appearance.followPalettes())),
    runCauseEffect(agentAccess.load()),
    runCauseEffect(mcpAccessStore.load()),
    runCauseEffect(loadPreferences),
  ]);
  const analyticsPreference = await Effect.runPromise(
    readAnalyticsPreference(analyticsPreferenceFile, setupState.completed),
  );
  teardown.push(TEARDOWN_ORDER.themePalettes, "the theme palette watch", palettesWatch);
  if (!rolesLoaded)
    logger.warn("The roles file did not load. Members get no access to agents until an admin saves the roles.");
  if (!mcpAccessLoaded)
    logger.warn(
      "The MCP access file did not load. No agent or member gets an MCP server until an admin saves its access.",
    );
  void Effect.runPromise(appBehavior.refreshLoginItem()).catch((error) =>
    logger.warn("The login item did not refresh.", toLogValue(error)),
  );
  const remoteSessionCache = new RemoteSessionCache({
    path: join(app.getPath("userData"), REMOTE_SESSIONS_FILE),
    enabled: remoteSessionReuse.get().keepBetweenRuns,
    ...safeStorageCipher("error.app.macSecureStorageUnavailable"),
  });
  const forgetSignedOutSessions = (state: CentralAuthState) => {
    if (state.status === "signed_out") void Effect.runPromise(remoteSessionCache.clear());
  };
  forgetSignedOutSessions(centralAuth.getState());
  centralAuth.on("changed", forgetSignedOutSessions);
  const updatePreference = await runCauseEffect(readUpdatePreference(updatePreferenceFile));
  const approvalAutomationFile = join(app.getPath("userData"), APPROVAL_AUTOMATION_FILE);
  const approvalAutomation = new ApprovalAutomation({
    path: approvalAutomationFile,
    initial: await runCauseEffect(
      readApprovalAutomation(
        approvalAutomationFile,
        store.list().map((agent) => agent.id),
        [V2_APPROVAL_AUTOMATION_FILE, LEGACY_APPROVAL_AUTOMATION_FILE].map((file) =>
          join(app.getPath("userData"), file),
        ),
      ),
    ),
    knownAgentIds: () => store.list().map((agent) => agent.id),
  });
  const providerUse = new ProviderUseSettingsStore(join(app.getPath("userData"), "openbot-provider-use-v1.json"));
  const providerAccounts = new ProviderAccountStore(
    join(app.getPath("userData"), "openbot-provider-accounts-v1.json"),
    join(app.getPath("userData"), "provider-accounts"),
  );
  await Promise.all([runCauseEffect(providerUse.load()), runCauseEffect(providerAccounts.load())]);
  const providerRuntimesRoot =
    localServerChild?.runtimeRoot ??
    providerRuntimeRoot({
      appData: app.getPath("appData"),
      userDataOverride: app.commandLine.getSwitchValue("user-data-dir"),
    });
  const providerDownloads = join(app.getPath("userData"), "provider-runtimes", ".downloads");
  const hermesInstaller = new HermesInstaller({
    downloadRoot: providerDownloads,
    refreshProvider: () => service.refreshProvider("hermes"),
  });
  const providerRuntimes = new ProviderRuntimeManager({
    isProviderOn: (provider) => !providerUse.off().includes(provider),
    root: providerRuntimesRoot,
    downloadRoot: providerDownloads,
    hermesInstaller,
    updateRuntime: (runtime, install, signal, onWait) => {
      if (isManagedToolRuntime(runtime)) return install().pipe(Effect.asVoid);
      return service
        .updateProviderCli(
          runtime,
          () =>
            install().pipe(
              Effect.mapError(
                (error) => new AgentLifecycleFailed({ operation: "updateProviderCli.install", cause: error.cause }),
              ),
            ),
          signal,
          onWait,
        )
        .pipe(Effect.asVoid, toProviderRuntimeFailure);
    },
  });
  let updateCheckWait: Fiber.Fiber<void> | null = null;
  let modelReasoningWait: Fiber.Fiber<void> | null = null;
  teardown.push(TEARDOWN_ORDER.providerRuntimes, "the provider runtimes", () =>
    runCauseEffect(
      Effect.gen(function* () {
        if (updateCheckWait) yield* Fiber.interrupt(updateCheckWait);
        if (modelReasoningWait) yield* Fiber.interrupt(modelReasoningWait);
        yield* providerRuntimes.stop();
      }),
    ),
  );
  const secretCipher = safeStorageCipher("error.app.secretStorageUnavailable");
  const customProviders = new CustomProviderStore({
    path: join(app.getPath("userData"), CUSTOM_PROVIDERS_FILE),
    cipher: secretCipher,
  });
  const modelReasoning = createModelReasoningSupport(() => customProviders.configs());
  const customAgents = new CustomAgentStore({
    path: join(app.getPath("userData"), CUSTOM_AGENTS_FILE),
    cipher: secretCipher,
  });
  await Promise.all([
    runCauseEffect(providerRuntimes.initialize()),
    runCauseEffect(customProviders.load()),
    runCauseEffect(customAgents.load()),
  ]);
  const providerDetectionSettings = new ProviderDetectionSettingsStore(
    join(app.getPath("userData"), PROVIDER_DETECTION_SETTINGS_FILE),
  );
  performance.mark("openbot:services.preferences");
  await runCauseEffect(providerDetectionSettings.load());
  const modelReleaseCatalog = new ModelReleaseCatalog();
  const providerDetection = await Effect.runPromise(
    createProviderDetection({
      settings: providerDetectionSettings,
      customProviders,
      customAgents,
      catalog: modelReleaseCatalog,
    }),
  );
  teardown.push(TEARDOWN_ORDER.providerDetection, "model server discovery", () =>
    Effect.runPromise(providerDetection.close()),
  );
  const providerCredentials = new ProviderCredentialStore(
    join(app.getPath("userData"), PROVIDER_CREDENTIAL_FILE),
    secretCipher,
  );
  performance.mark("openbot:services.provider-detection");
  const credentialLoadError = await Effect.runPromise(providerCredentials.load());
  if (credentialLoadError) {
    logger.warn(`OpenBot could not read the provider key file (${credentialLoadError.name}). It was left unchanged.`);
  }
  const providerEnvironmentSetting = providerEnvironmentControl(providerEnvironment, providerCredentials, (provider) =>
    service.providerSpawnSettingsChanged(provider).pipe(
      Effect.catch((failure) =>
        Effect.sync(() =>
          logger.warn(`${provider} did not restart after its variables changed.`, toLogValue(failure.cause)),
        ),
      ),
      Effect.tap(() => Effect.sync(() => service.notifyProviderSettingsChanged())),
      Effect.asVoid,
    ),
  );
  const mcpOAuthStore = new McpOAuthStore(join(app.getPath("userData"), MCP_OAUTH_FILE), secretCipher);
  const mcpOAuthLoadError = await Effect.runPromise(mcpOAuthStore.load());
  if (mcpOAuthLoadError) {
    logger.warn(`OpenBot could not read the MCP sign-in file (${mcpOAuthLoadError.name}). It was left unchanged.`);
  }
  const mcpOAuthProxySettings = new McpOAuthProxySettingsFile(
    join(app.getPath("userData"), MCP_OAUTH_PROXY_FILE),
    secretCipher,
  );
  const mcpOAuthProxyLoadError = await Effect.runPromise(mcpOAuthProxySettings.load());
  if (mcpOAuthProxyLoadError) {
    logger.warn(
      `OpenBot could not read the MCP sign-in proxy file (${mcpOAuthProxyLoadError.name}). A new port is used.`,
    );
  }
  let mcpOAuthAuthority: McpOAuth | null = null;
  const mcpOAuthDeepLink = () =>
    (process.platform === "linux" || app.isPackaged) && app.isDefaultProtocolClient("openbot")
      ? MCP_OAUTH_REDIRECT_URL
      : undefined;
  const signInRelayClient = new SignInRelayClient({
    openExternal: openLink,
    language,
    deepLinkRedirectUrl: mcpOAuthDeepLink,
    ownListener: () =>
      mcpOAuthRedirect
        ? { port: Number(new URL(mcpOAuthRedirect.redirectUrl).port), paths: MCP_OAUTH_REDIRECT_PATHS }
        : null,
  });
  performance.mark("openbot:services.mcp-sign-in-file");
  const mcpOAuthRedirect = await startMcpOAuthRedirectServer({
    language,
    preferredPort: MCP_OAUTH_REDIRECT_PORT,
    deliver: (state, code, query) => {
      const elsewhere = mcpOAuthAuthority?.openedElsewhere(state) ?? false;
      const exchange = elsewhere ? null : (mcpOAuthAuthority?.grantExchange(state) ?? null);
      if (!mcpOAuthAuthority?.receiveAuthorizationCode(state, code))
        return signInRelayClient.deliver(state, query) ? "relayed" : false;
      if (elsewhere) return true;
      const current = windows.getMainWindow();
      if (current && !current.isDestroyed()) showMainWindow(current);
      return exchange ? Effect.runPromise(exchange) : true;
    },
    relayRefusal: (state, query) => {
      signInRelayClient.deliver(state, query);
    },
  }).catch((error: unknown) => {
    logger.warn(
      "OpenBot could not listen for MCP sign-ins on this machine, so the openbot:// link is used instead. Servers that refuse it cannot be signed in to:",
      toLogValue(error),
    );
    return null;
  });
  if (mcpOAuthRedirect) {
    teardown.push(TEARDOWN_ORDER.mcpOAuthRedirect, "the MCP sign-in listener", () => mcpOAuthRedirect.close());
  }
  const mcpOAuth = new McpOAuth({
    storage: mcpOAuthStore,
    openExternal: openLink,
    redirectUrl: mcpOAuthRedirect?.redirectUrl ?? MCP_OAUTH_REDIRECT_URL,
    deepLinkRedirectUrl: mcpOAuthDeepLink,
    logger: createOpenBotLogger("mcp-oauth"),
  });
  mcpOAuthAuthority = mcpOAuth;
  teardown.push(TEARDOWN_ORDER.mcpOAuth, "MCP token refresh", () => Effect.runPromise(mcpOAuth.close()));
  const githubConnector = new GitHubConnectorService({
    app: githubAppConfig(),
    store: new GitHubConnectorStore(join(app.getPath("userData"), GITHUB_CONNECTOR_FILE), secretCipher),
    toolDirectory: join(app.getPath("userData"), "provider-state", "github"),
    apiUrl: centralAuthApiUrl(),
    openExternal: openLink,
  });
  await runCauseEffect(githubConnector.load());
  teardown.push(TEARDOWN_ORDER.githubConnector, "the GitHub connection", () =>
    runCauseEffect(githubConnector.dispose()),
  );
  const linkAccount = new LinkAccountService({
    store: new LinkAccountStore(join(app.getPath("userData"), LINK_ACCOUNT_FILE), secretCipher),
    openExternal: openLink,
  });
  await Effect.runPromise(linkAccount.load());
  teardown.push(TEARDOWN_ORDER.linkAccount, "the Link account", () => Effect.runPromise(linkAccount.dispose()));
  const bitwardenCliTarget = runtimeTarget(process.platform, process.arch);
  const bitwardenConnector = new BitwardenConnectorService({
    host: {
      store: new BitwardenConnectorStore(join(app.getPath("userData"), BITWARDEN_CONNECTOR_FILE), secretCipher),
      dataDirectory: join(app.getPath("userData"), "provider-state", "bitwarden-host"),
      installCli: bitwardenCliTarget
        ? (signal) =>
            managedBitwardenCli({
              directory: join(app.getPath("userData"), "provider-state", "bitwarden-cli"),
              target: bitwardenCliTarget,
              signal,
            })
        : null,
    },
  });
  await runCauseEffect(bitwardenConnector.load());
  teardown.push(TEARDOWN_ORDER.bitwardenConnector, "the Bitwarden connection", async () => {
    await runCauseEffect(bitwardenConnector.dispose());
  });

  const vault = new VaultService({
    store: new VaultStore(join(app.getPath("userData"), VAULT_FILE), secretCipher),
    canPersist: secretCipher.canPersist,
  });
  await Effect.runPromise(vault.load());

  const onePasswordCliTarget = runtimeTarget(process.platform, process.arch);
  const onePasswordConnector = new OnePasswordConnectorService({
    store: new OnePasswordConnectorStore(join(app.getPath("userData"), ONEPASSWORD_CONNECTOR_FILE), secretCipher),
    hostName: hostname(),
    appVersion: app.getVersion(),
    cliInstall: onePasswordCliTarget
      ? { directory: join(app.getPath("userData"), "provider-state", "1password-cli"), target: onePasswordCliTarget }
      : null,
    openExternal: openLink,
  });
  await runCauseEffect(onePasswordConnector.load());
  performance.mark("openbot:services.connectors");
  teardown.push(TEARDOWN_ORDER.onePasswordConnector, "the 1Password connection", () =>
    runCauseEffect(onePasswordConnector.dispose()),
  );
  const protonPassCliTarget = runtimeTarget(process.platform, process.arch);
  const passwordManagers = new PasswordManagersService([
    new ProtonPassDriver({
      store: new EncryptedRecordStore({
        path: join(app.getPath("userData"), PROTONPASS_CONNECTOR_FILE),
        cipher: secretCipher,
        decode: Schema.decodeUnknownSync(protonPassRecordSchema),
        unreadable: sourceText("error.connector.protonPassFileUnreadable"),
      }),
      dataDirectory: join(app.getPath("userData"), "provider-state", "protonpass-host"),
      hostName: hostname(),
      installCli: protonPassCliTarget
        ? (signal) =>
            managedProtonPassCli({
              directory: join(app.getPath("userData"), "provider-state", "protonpass-cli"),
              target: protonPassCliTarget,
              signal,
            })
        : null,
    }),
  ]);
  await runCauseEffect(passwordManagers.load());
  teardown.push(TEARDOWN_ORDER.passwordManagers, "the password managers", () =>
    runCauseEffect(passwordManagers.dispose()),
  );
  const statementTimings = new StatementTimings();
  const tables = new AgentTables({
    sharedRoot: store.sharedRoot,
    supervisor: new AgentDatabaseSupervisor({
      spawnHost: spawnAgentDatabaseHost,
      onStatementSettled: (durationMs, request) => {
        statementTimings.record(durationMs);
        perfTime(`agentdb.${request}`, durationMs);
      },
      onHostStartFailed: ({ reason, output, consecutiveFailures, retryAfterMs }) =>
        logger.warn(
          `The shared data process ${reason} (failed starts in a row: ${consecutiveFailures}, next start after ${retryAfterMs} ms).`,
          output.length > 0 ? `Its last output: ${output}` : "It wrote no output.",
        ),
    }),
  });
  const resolveCuaDriverExecutable = () => {
    const installDirectory = process.env.CUA_DRIVER_RS_INSTALL_DIR ?? process.env.CUA_DRIVER_BIN_DIR;
    const localAppDataDirectory = process.env.LOCALAPPDATA;
    return resolveCuaDriver({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      sourceRoot: resolve(__dirname, "../.."),
      platform: process.platform,
      architecture: process.arch,
      homeDirectory: homedir(),
      pathVariable: process.env.PATH ?? null,
      overrides: [process.env.OPENBOT_CUA_DRIVER_PATH, process.env.CUA_DRIVER_PATH],
      ...(installDirectory === undefined ? {} : { installDirectory }),
      ...(localAppDataDirectory === undefined ? {} : { localAppDataDirectory }),
      applicationsDirectory: "/Applications",
    });
  };
  const cuaDriver = new CuaDriverRuntime({
    executable: await Effect.runPromise(resolveCuaDriverExecutable()),
    resolveExecutable: resolveCuaDriverExecutable,
    commandAlias: cuaDriverCommandAlias({
      platform: process.platform,
      isPackaged: app.isPackaged,
      appImagePath: process.env.APPIMAGE ?? null,
      userDataPath: app.getPath("userData"),
    }),
    endpoint: await runCauseEffect(
      resolveCuaDriverEndpoint({
        platform: process.platform,
        userDataPath: app.getPath("userData"),
        temporaryDirectory: tmpdir(),
        runtimeDirectory: process.env.XDG_RUNTIME_DIR ?? null,
      }),
    ),
    supported: isSupportedCuaDriverTarget(process.platform, process.arch),
    hostBundleId: app.isPackaged ? PACKAGED_BUNDLE_IDENTIFIER : DEVELOPMENT_BUNDLE_IDENTIFIER,
    platform: process.platform,
    onDiagnostic: (message) => {
      Effect.runFork(appendRemoteDiagnosticLog(join(app.getPath("userData"), "logs", "remote"), "cua-driver", message));
    },
    quitting,
  });
  teardown.push(TEARDOWN_ORDER.cuaDriver, "the Computer Use driver", () => runCauseEffect(cuaDriver.stop()));
  const computerUseDisplayAwake = new ComputerUseDisplayAwake({
    turnRunning: () => service.earliestRunningTurnStartedAt() !== null,
    start: () => powerSaveBlocker.start("prevent-display-sleep"),
    stop: (id) => powerSaveBlocker.stop(id),
  });
  if (process.platform === "darwin") cuaDriver.onToolCall(() => computerUseDisplayAwake.noteToolCall());
  teardown.push(TEARDOWN_ORDER.cuaDriver, "the Computer Use display hold", () => computerUseDisplayAwake.release());
  const computerUseReads = new CuaDriverDaemonClient(() =>
    cuaDriver.mcpServerForProviders() ? cuaDriver.socketPath() : null,
  );
  let computerUseWindows: unknown = null;
  const computerUseHighlight = new ComputerUseHighlightController({
    createWindow: createComputerUseHighlightWindow,
    loadWindow: loadComputerUseHighlightRenderer,
    place: sendComputerUseHighlightPlacement,
    displays: computerUseDisplays,
    idle: () => service.earliestRunningTurnStartedAt() === null,
    readPointer: () => {
      const pointer = cuaDriver.lastPointer(COMPUTER_USE_CURSOR_MAX_AGE_MS);
      const point = pointer ? pointerOnDesktop(pointer, computerUseWindows) : null;
      return point ? computerUseDesktopPoint(point) : null;
    },
    readTarget: (previous) =>
      Effect.gen(function* () {
        if (!cuaDriver.mcpServerForProviders()) return null;
        const turnStartedAt = service.earliestRunningTurnStartedAt();
        if (turnStartedAt === null) return null;
        const session = liveSession(yield* computerUseReads.sessions(), (Date.now() - turnStartedAt) / 1000);
        if (!session) return null;
        const windows = yield* computerUseReads.listWindows();
        computerUseWindows = windows;
        const action = cuaDriver.lastAction(COMPUTER_USE_ACTION_MAX_AGE_MS);
        return chooseTarget({
          windows,
          session,
          action,
          ownPid: process.pid,
          ownCoveringWindowIds: computerUseCoveringWindowIds(),
          previous,
          toDesktop: computerUseDesktopRect,
        });
      }),
  });
  teardown.push(TEARDOWN_ORDER.computerUseHighlight, "the Computer Use highlight", async () => {
    computerUseHighlight.destroy();
    await Effect.runPromise(computerUseReads.close());
  });
  const agentsShareDisplay = !hasSeparateAgentDisplay(process.platform);
  const drawsComputerUseHighlight = agentsShareDisplay && (process.platform !== "linux" || usesX11Windows());
  const computerUsePermissionHelp = new ComputerUsePermissionHelpWindowController({
    createWindow: () =>
      createComputerUsePermissionHelpWindow(language.translate, () => localeDirection(language.locale)),
    loadWindow: loadComputerUsePermissionHelpRenderer,
    bundlePath: () => applicationBundlePath(app.getPath("exe"), process.platform),
    bundleIcon: async (path) => {
      const resources = join(path, "Contents", "Resources");
      const names: string[] = await readdir(resources).catch(() => []);
      const iconName = applicationIconName(path, names);
      const icon = iconName ? nativeImage.createFromPath(join(resources, iconName)) : nativeImage.createEmpty();
      return (icon.isEmpty() ? nativeImage.createFromPath(appIconPath) : icon).resize({ width: 32, height: 32 });
    },
    revealPath: (path) => shell.showItemInFolder(path),
  });
  teardown.push(TEARDOWN_ORDER.computerUsePermissionHelp, "the Computer Use permission help", () => {
    computerUsePermissionHelp.close();
  });
  const providerTempDirectory = join(app.getPath("userData"), "provider-temp");
  performance.mark("openbot:services.computer-use");
  if (process.platform === "win32") await Effect.runPromise(sweepProviderTemp(providerTempDirectory));
  const agentApiKeys = new AgentApiKeys(join(app.getPath("userData"), "agent-api-keys"), vault.items);
  await Effect.runPromise(agentApiKeys.registerSaved());
  await Effect.runPromise(agentApiKeys.syncVault().pipe(Effect.ignore));
  let workflowTriggers: WorkflowTriggers | null = null;
  const catalogPluginServers = await Effect.runPromise(
    loadCatalogPluginServers(
      app.isPackaged
        ? join(process.resourcesPath, "plugin-catalog")
        : resolve(__dirname, "../../resources/plugin-catalog"),
    ),
  );
  providerRuntimes.setCatalogNpxApps(
    (config) =>
      config.transport === "stdio" &&
      config.command === "npx" &&
      catalogPluginSlug(config, catalogPluginServers, homedir()) !== null,
  );
  const workflowStore = new WorkflowStore({
    database: store.database,
    nextDueAt: workflowScheduleDueAt(() => serverTimezone.effective()),
  });
  const workflowRuns = new WorkflowRunStore({ database: store.database });
  const userData = app.getPath("userData");
  const storageSources = {
    roots: {
      database: store.database.path,
      downloads: store.downloadsRoot,
      caches: ["remote-attachments", "remote-shared-files", "remote-workspace-files"].map((name) =>
        join(userData, name),
      ),
      logs: [
        join(userData, "logs", "remote"),
        join(userData, "logs", "update"),
        join(userData, "logs", "providers"),
        join(userData, "logs", "agents"),
        join(userData, "logs", "main"),
      ],
      runtimes: providerRuntimesRoot,
      data: userData,
    },
    database: () => store.database.connection,
    mailbox,
    agents: () => service.listAgents(),
    channelFiles: (channelId: string) =>
      service.channels.store.exists(channelId)
        ? service.channels.store.messages(channelId).flatMap((entry) =>
            (entry.message.attachments ?? []).map((attachment) => ({
              attachmentId: attachment.id,
              messageId: entry.id,
            })),
          )
        : null,
    ...(hostedServer ? { userFiles: new UserFilesBytes(userData, homedir()) } : {}),
    workflowFiles: () =>
      workflowFileOwners({
        outputs: () => workflowRuns.mediaOutputs(),
        workflows: () => workflowStore.list(),
        folders: (workflowIds) => workflowFolders.getSnapshot({ workflowIds }),
      }),
  };
  const storageUsage = new StorageUsageService(new StorageUsageScanner(storageSources), storageSources);
  teardown.push(TEARDOWN_ORDER.storageUsage, "storage scans", () => Effect.runPromise(storageUsage.dispose()));
  const libraryFoldersService = new LibraryFoldersService({
    store: libraryFolders,
    storage: storageUsage,
    agents: () => service.listAgents(),
  });
  let hostedStorageGb: number | null = null;
  const service: AgentService = new AgentService({
    store,
    mailbox,
    browser,
    finishCheck: true,
    visualPreview: new ChatVisualPreviewer(),
    avatarDecoder: (bytes) => !nativeImage.createFromBuffer(Buffer.from(bytes)).isEmpty(),
    setCommitCoAuthor: (enabled) => agentDefaultsSettings.update({ commitCoAuthor: enabled }),
    clearPictureBackground: (bytes) => {
      const picture = nativeImage.createFromBuffer(Buffer.from(bytes));
      if (picture.isEmpty()) return null;
      const size = picture.getSize();
      const pixels = picture.toBitmap();
      if (!clearFlatBackground(pixels, size.width, size.height)) return null;
      return nativeImage.createFromBitmap(pixels, size).toPNG();
    },
    fitImage: fitImageForAgent,
    videoReader: new VideoReader({
      runtimeDirectory: join(app.getPath("userData"), "runtimes", "yt-dlp"),
      target: runtimeTarget(process.platform, process.arch),
      transcribe: (audio) => {
        if (voiceServer.dictates()) return voiceServer.transcribe(audio, voice.getSettings().language);
        return voice.getModelStatus().pipe(
          Effect.flatMap((status) =>
            status.phase === "ready" && (isLocalVoiceModelId(status.modelId) || isGroqVoiceModelId(status.modelId))
              ? voice.transcribe(audio)
              : Effect.fail(
                  new VoiceOperationError({
                    cause: new Error("No speech recognition model for recordings is set up in Settings → Voice."),
                  }),
                ),
          ),
        );
      },
    }),
    feedbackFacts: feedbackFacts(
      hostedServer ? "Hosted server" : serverModeEnvironment || localServerChild ? "Server" : "Desktop app",
    ),
    feedback: feedbackSender(centralAuth),
    serverClaims: {
      signedIn: () => centralAuth.getState().status === "signed_in",
      create: () => hostedServers.createServerClaim().pipe(toToolOperationFailed),
    },
    marketplaceAppServer: (appId) => {
      const listed = catalogPluginServers.filter((server) => server.slug === appId);
      const [server] = listed;
      if (!server || listed.length !== 1) return null;
      const config = service.listMcpServers().find((saved) => catalogPluginSlug(saved, listed, homedir()) === appId);
      return config ? { config, setupSteps: server.setupSteps } : null;
    },
    mcpAgentAccess: (mcpServerId, agentId) => mcpAccessStore.allowsAgent(mcpServerId, agentId),
    prepareMcpTest: (config) =>
      prepareToolRuntimeForTest(config, {
        startToolRuntimes: () => {
          Effect.runFork(providerRuntimes.ensureToolRuntimes());
        },
        ensureToolRuntimesReady: () => providerRuntimes.ensureToolRuntimesReady(),
        toolRuntimes: () => providerRuntimes.mcpToolRuntimes(),
      }),
    screenCapture: hasSeparateAgentDisplay(process.platform)
      ? null
      : new ScreenCapturer({
          platform: process.platform,
          screenAccess: () => systemPreferences.getMediaAccessStatus("screen"),
          displays: () => screen.getAllDisplays(),
          primaryDisplayId: () => screen.getPrimaryDisplay().id,
          getSources: (options) => desktopCapturer.getSources(options),
        }),
    hostMemory,
    hostTurnLimits,
    hostedStorageGb: () => hostedStorageGb,
    agentCursorDrawn: drawsComputerUseHighlight,
    computerUseOnWayland: agentsShareDisplay && cuaDriverDrivesWayland(process.platform),
    computerUseInputRefused: () => agentsShareDisplay && cuaDriver.waylandInputRefused(),
    requestTimeoutMs: 30_000,
    offProviders: providerUse.off(),
    providerAccounts,
    saveProviderUse: (provider, on) =>
      providerUse.set(provider, on).pipe(
        Effect.tap(() => providerRuntimes.providerUseChanged()),
        Effect.mapError((error) => new AgentLifecycleFailed({ operation: "saveProviderUse", cause: error.cause })),
      ),
    installedCliProviders: providerUse.installed(),
    saveInstalledCliChoice: (provider, installed) =>
      isManagedRuntimeProvider(provider)
        ? providerUse
            .setInstalled(provider, installed)
            .pipe(
              Effect.mapError(
                (error) => new AgentLifecycleFailed({ operation: "saveInstalledCliChoice", cause: error.cause }),
              ),
            )
        : Effect.void,
    preferredProvider: setupState.preferredProvider ?? "codex",
    bundledExecutables: providerRuntimes.bundledExecutables(),
    prepareAgentWorkspace: (agent) =>
      Effect.gen(function* () {
        yield* managedSkills.syncAgent(agent);
        yield* skillCreator.syncAgent(agent);
        yield* dataSkill.syncAgent(agent);
      }),
    hostedSites: {
      list: () => hostedSites.list().pipe(toHostedSiteOperationFailed),
      publish: (input, roots) => hostedSites.publish(input, roots).pipe(toHostedSiteOperationFailed),
      replace: (input, roots) => hostedSites.replace(input, roots).pipe(toHostedSiteOperationFailed),
      delete: (siteId) => hostedSites.delete(siteId).pipe(toHostedSiteOperationFailed),
    },
    sidebarLayout,
    libraryFolders: libraryFoldersService.forAgents(),
    preferredModel: setupState.preferredModel,
    developmentDefaults: appVariant === "dev",
    credentials: {
      apiKey: (provider) => providerCredentials.get(provider),
      accountKeys: {
        get: (provider, accountId) => providerCredentials.accountKey(provider, accountId),
        set: (provider, accountId, key) => providerCredentials.setAccountKey(provider, accountId, key),
      },
      promptCacheTtl: () => promptCacheTtl.get().ttl,
      claudeUserSetup: () => claudeUserSetup.get().enabled,
      claudeCompactWindow: () => claudeCompactWindow.get().tokens,
      providerEnvironment: (provider) => providerEnvironmentSetting.resolve(provider),
      customProviders: () => modelReasoning.configs(),
      customAgents: () => customAgents.configs(),
      mcpServers: () => service.enabledMcpServers(),
      mcpToolRuntimes: () => providerRuntimes.mcpToolRuntimes(),
      mcpOAuth,
      mcpOAuthProxySettings,
      systemProxyFetch: (url, init) => net.fetch(url, { ...init, credentials: "omit", cache: "no-store" }),
      appVersion: app.getVersion(),
      providerStateDirectory: join(app.getPath("userData"), "provider-state"),
      ...(process.platform === "win32" ? { providerTempDirectory } : {}),
      serverEnvironment,
      agentEnvironment: (inherited) => ({
        ...agentDisplayEnvironment(process.platform),
        ...githubConnector.agentEnvironment(inherited),
      }),
    },
    computerUseMcpServer: () => cuaDriver.mcpServerForProviders(),
    githubConnector: {
      mcpServer: () => githubConnector.mcpServer(),
      mcpAuthorization: () => githubConnector.mcpAuthorization().pipe(toMcpGatewayFailed),
    },
    passwordVault: passwordVaultRouter([
      { prefix: "", name: PASSWORD_MANAGER_BRANDS.onepassword, vault: onePasswordConnector },
      { prefix: "bitwarden:", name: PASSWORD_MANAGER_BRANDS.bitwarden, vault: bitwardenConnector },
      ...passwordManagers.routes(),
      { prefix: "openbot:", name: "the OpenBot Vault", vault: vault.logins },
    ]),
    vaultItems: vault.items,
    linkWallet: linkAccount,
    agentApiKeys,
    localSkillTools: () => localSkillTools(skills),
    browserProfiles: () => agentBrowserProfiles,
    crm: () => crmHandle,
    crmAgentVisibleToMembers: (agentId) => host.agentVisibleToMembers(agentId),
    personCanAdminister: (personId) => host.personCanAdminister(personId),
    reviewSkills: (agentId) => skills.listInstalledForChatTags(agentId),
    routineFlowTools: () => routineFlowRuntime,
    workflowTools: () => workflowRuntime,
    webhookRoutines: () => agentWebhookRoutineWriter(events),
    approvalAutomation,
    busyMessageMode: () => busyMessageMode.get().mode,
    agentMemoryLimit: () => agentMemoryLimit.get().limit,
    memoryReviewInterval: () => memoryReview.get().interval,
    skillLearning: () => skillLearning.get().mode,
    userBrowsing: {
      pending: (agentId) => (browsingMemory.get().enabled ? userBrowsing.pending(agentId) : Effect.succeed([])),
      reviewed: (agentId, through) => userBrowsing.reviewed(agentId, through),
      forgetAgent: (agentId) => userBrowsing.forgetAgent(agentId),
    },
    skillLearner: () => localSkillLearner(skills),
    responseStyle: () => serverPersonality.responseStyle(),
    timezone: () => serverTimezone.effective(),
    extraRoutineSources: () => (workflowTriggers ? [workflowTriggers] : []),
    channelPersonAgentLevel: (personId, agentId) => host.channelPersonAgentLevel(personId, agentId),
    channelRemotePerson: (personId) => host.channelPersonIsRemote(personId),
    deleteWithRevokedApproval: (agentId, remove) =>
      Effect.suspend(() => {
        const workflowIds = workflowStore.workflowsOfAgent(agentId);
        return approvalAutomation.deleteAgent(agentId, remove).pipe(
          toAgentRemovalFailed,
          Effect.tap(() =>
            Effect.sync(() => {
              for (const workflowId of workflowIds) service.notifyWorkflowsChanged(workflowId);
            }),
          ),
        );
      }),
    tables,
  });
  teardown.push(TEARDOWN_ORDER.service, "the agent service", () => runCauseEffect(service.stop()));
  serverPersonality.onChange(() => service.responseStyleChanged());
  hostTurnLimits.onChange(() => service.turnLimitsChanged());
  let skillRevision = skillLearning.get().mode === "automatic";
  skillLearning.onChange(({ mode }) => {
    if ((mode === "automatic") === skillRevision) return;
    skillRevision = mode === "automatic";
    service.skillRevisionChanged();
  });
  const agentMemoryLimitSetting = reloadingAgentMemoryLimit(agentMemoryLimit, service);
  promptCacheTtl.onChange(() => service.notifyProviderSettingsChanged());
  const claudeUserSetupSetting = claudeUserSetupControl(claudeUserSetup, () => service.notifyProviderSettingsChanged());
  const claudeCompactWindowSetting = claudeCompactWindowControl(claudeCompactWindow, () =>
    service.notifyProviderSettingsChanged(),
  );
  const modelVisibility = new ModelVisibility({
    path: join(app.getPath("userData"), MODEL_VISIBILITY_PREFERENCE_FILE),
    catalog: modelReleaseCatalog,
    listModels: () => service.listModels(),
    listAgents: () => service.listAgents(),
    customEndpoints: () => customProviders.list(),
    modelsChanged: () => service.notifyProviderSettingsChanged(),
  });
  await runCauseEffect(modelVisibility.load());
  const turnAnswer = (agentId: string, turnId: string): string | null =>
    latestTurnAnswer(store.database.readTurnAssistantMessages(agentId, turnId), turnId)?.text ?? null;
  const automation = new AutomationServer({
    root: store.automationRoot,
    listAgents: () => service.listAgents(),
    agentDefaults: () => agentDefaults.get(),
    listModels: () => service.listModels(),
    listRoutines: (agentId) => service.listRoutines(agentId),
    runRoutine: (input) => service.runRoutineFromAutomation(input),
    sendMessage: (input) => service.sendMessage(input),
    getLocalAttention: (agentId) => service.getLocalAttention(agentId),
    respondToLocalAttention: (agentId, input) => service.respondToLocalAttention(agentId, input),
    delivery: (deliveryId) => mailbox.getDelivery(deliveryId)?.delivery ?? null,
    turnAnswer,
    updateAgent: (input) => service.updateAgent(input),
    clearAgentContext: (agentId) => service.clearAgentContext(agentId),
  });
  service.on("event", (event) => {
    if (event.type === "agents-changed") Effect.runFork(automation.requestSync());
  });
  teardown.push(TEARDOWN_ORDER.automation, "the automation server", () => Effect.runPromise(automation.stop()));
  const stopHandoff = (agentId: string, deliveryId: string) => {
    const found = mailbox.getDelivery(deliveryId)?.delivery;
    if (
      !found ||
      found.status === "completed" ||
      found.status === "failed" ||
      found.status === "interrupted" ||
      found.status === "cancelled"
    )
      return Effect.void;
    return found.status !== "queued" && found.turnId
      ? service.interrupt(agentId, found.turnId)
      : service.cancelQueuedMessage(agentId, deliveryId);
  };
  const routineFlowRuntime = await Effect.runPromise(
    createRoutineFlows({
      store: new RoutineFlowStore({ database: store.database }),
      routines: routineFlowRoutines(new AgentRoutineStore(store.database)),
      delivery: (deliveryId) => {
        const found = mailbox.getDelivery(deliveryId)?.delivery;
        return found ? { status: found.status, turnId: found.turnId, error: found.error } : null;
      },
      turnAnswer,
      agentName: (agentId) => store.list().find((agent) => agent.id === agentId)?.name ?? agentId,
      sendHandoff: (input) => service.enqueueRoutineHandoff(input),
      stopRoutineRun: (input) => service.stopRoutineRun(input),
      stopDelivery: stopHandoff,
      changed: (agentIds) => {
        for (const agentId of agentIds) service.notifyRoutineFlowsChanged(agentId);
      },
    }),
  );
  teardown.push(TEARDOWN_ORDER.routineFlows, "the routine flows", () => Effect.runPromise(routineFlowRuntime.close()));
  const githubRest = createGitHubRest({
    fetch: (url, init) => fetch(url, init),
    tokens: (repository) => githubConnector.repositoryTokens(repository),
    download: (url, maxBytes) => downloadDiscordAttachment(url, maxBytes),
  });
  const workflowGitHub = workflowGitHubDirectory(() => githubConnector.workflowCatalog(), githubRest);
  const workflowRuntime = await Effect.runPromise(
    createWorkflows({
      store: workflowStore,
      runs: workflowRuns,
      github: new WorkflowGitHubStore({ database: store.database }),
      githubApp: () => githubAppConfig()?.slug ?? null,
      watchGitHub: (repositories) => githubRelay.setRepositories(repositories),
      githubApi: githubRest,
      delivery: (deliveryId) => {
        const found = mailbox.getDelivery(deliveryId)?.delivery;
        return found ? { status: found.status, turnId: found.turnId, error: found.error } : null;
      },
      turnAnswer,
      sendHandoff: (input) => service.enqueueRoutineHandoff(input),
      filePath: (attachmentId) =>
        mailbox.resolveAttachment(attachmentId).pipe(Effect.map((file) => file?.path ?? null)),
      stopDelivery: stopHandoff,
      generateText: (request) =>
        service.generateWorkflowText(request).pipe(
          Effect.mapError((failure) => ({
            message: failure.cause instanceof Error ? failure.cause.message : sourceText("error.workflow.modelFailed"),
          })),
        ),
      chooseTextModel: (request) =>
        service.chooseWorkflowModel(request).pipe(
          Effect.mapError((failure) => ({
            message: failure.cause instanceof Error ? failure.cause.message : sourceText("error.workflow.modelFailed"),
          })),
        ),
      generateMedia: (request) =>
        service.generateWorkflowMedia(request).pipe(
          Effect.mapError((failure) => ({
            message: failure.cause instanceof Error ? failure.cause.message : sourceText("error.workflow.mediaFailed"),
          })),
        ),
      sizePicture: (attachmentId, size) =>
        Effect.gen(function* () {
          const file = yield* mailbox.resolveAttachment(attachmentId);
          if (!file) return yield* Effect.fail(new Error("The generated picture is gone."));
          const source = yield* Effect.tryPromise(() => readFile(file.path));
          const bytes = yield* Effect.try(() => sizeWorkflowPicture(source, size));
          if (!bytes) return yield* Effect.fail(new Error("The generated picture could not be decoded."));
          const stored = yield* mailbox.storeGeneratedAttachment({
            bytes,
            name: "generated-image.png",
            mimeType: "image/png",
          });
          yield* mailbox.deleteStoredFile(attachmentId).pipe(Effect.ignore);
          return stored.id;
        }).pipe(
          Effect.mapError((failure) => ({
            message: failure instanceof Error ? failure.message : String(failure),
          })),
        ),
      mediaProviders: () => service.workflowMediaProviders(),
      mediaCredits: (only) => service.workflowMediaCredits(only),
      mediaCatalog: (only) => service.workflowMediaCatalog(only),
      mediaPrice: (request) => service.workflowMediaPrice(request),
      keepPicture: (draftId, types) =>
        mailbox.keepDraft(draftId, types).pipe(
          Effect.map((kept) => (typeof kept === "string" ? kept : kept.id)),
          Effect.ensuring(Effect.sync(() => storageUsage.invalidate())),
        ),
      notify: forwardWorkflowNotice,
      connectionOn: (connectionId) => service.messaging.store.connection(connectionId)?.enabled === true,
      post: (connectionId, placeId, markdown) => service.messaging.deliver(connectionId, placeId, markdown),
      channelPost: (input) => service.channels.postNote(input),
      discordSend: (connectionId, send) => service.messaging.discordSend(connectionId, send),
      telegramSend: (connectionId, send) => service.messaging.telegramSend(connectionId, send),
      slackSend: (connectionId, send) => service.messaging.slackSend(connectionId, send),
      changed: (workflowId, agentId) => service.notifyWorkflowsChanged(workflowId, agentId),
      rearm: () => service.armRoutines(),
      timezone: () => serverTimezone.effective(),
      runEnded: (end) => service.notifyWorkflowRunEnded(end),
    }),
  );
  const workflowFoldersService = new WorkflowFoldersService({ store: workflowFolders, workflows: workflowRuntime });
  workflowTriggers = new WorkflowTriggers({
    store: workflowStore,
    timezone: () => serverTimezone.effective(),
    start: (start) => workflowRuntime.startScheduled(start),
    changed: (workflowId) => service.notifyWorkflowsChanged(workflowId),
  });
  service.armRoutines();
  vault.onChanged(() => service.notifyVaultChanged());
  vault.onChanged(() => void Effect.runPromise(agentApiKeys.syncVault().pipe(Effect.ignore)));
  service.messaging.setMentionHandler((mention) =>
    workflowRuntime.receiveDiscord(mention).pipe(
      Effect.catch((failure) =>
        Effect.sync(() => {
          logger.warn("A Discord mention could not reach the workflows.", { cause: String(failure.cause) });
          return "none" as const;
        }),
      ),
    ),
  );
  service.messaging.setTelegramMentionHandler((mention) =>
    workflowRuntime.receiveTelegram(mention).pipe(
      Effect.catch((failure) =>
        Effect.sync(() => {
          logger.warn("A Telegram message could not reach the workflows.", { cause: String(failure.cause) });
          return "none" as const;
        }),
      ),
    ),
  );
  service.messaging.setSlackMentionHandler((mention) =>
    workflowRuntime.receiveSlack(mention).pipe(
      Effect.catch((failure) =>
        Effect.sync(() => {
          logger.warn("A Slack mention could not reach the workflows.", { cause: String(failure.cause) });
          return "none" as const;
        }),
      ),
    ),
  );
  teardown.push(TEARDOWN_ORDER.workflows, "the workflows", () => {
    service.messaging.setMentionHandler(null);
    service.messaging.setTelegramMentionHandler(null);
    service.messaging.setSlackMentionHandler(null);
    return Effect.runPromise(workflowRuntime.close());
  });
  const stripeCrmKey = new VoiceApiKeyStore({
    path: join(app.getPath("userData"), "crm-stripe-key.json"),
    cipher: secretCipher,
  });
  await runCauseEffect(stripeCrmKey.load());
  const crm = await Effect.runPromise(
    createCrm({
      database: store.database,
      changed: () => service.notifyCrmChanged(),
      settings: crmSettingsStore(crmPreference),
      sources: {
        keys: {
          get: () => stripeCrmKey.get(),
          set: (_kind, key) =>
            stripeCrmKey.set(key).pipe(
              Effect.mapError(
                (failure) =>
                  new CrmError({
                    code: "refused",
                    message:
                      failure.cause instanceof Error &&
                      failure.cause.message === sourceText("error.app.secretStorageUnavailable")
                        ? failure.cause.message
                        : sourceText("error.crm.sourceKeySaveFailed"),
                  }),
              ),
            ),
        },
        adapters: [
          stripeSource({
            fetch: (input, init) => net.fetch(input.href, init),
            ...(app.isPackaged || !process.env.OPENBOT_DEV_STRIPE_API_BASE
              ? {}
              : { apiBase: process.env.OPENBOT_DEV_STRIPE_API_BASE }),
          }),
        ],
      },
    }),
  );
  crmHandle = crm;
  teardown.push(TEARDOWN_ORDER.crm, "the CRM", () => {
    crmHandle = null;
    return Effect.runPromise(crm.close());
  });
  const routineResultRuntime = await Effect.runPromise(
    createRoutineResults({
      store: new RoutineResultStore(store.database),
      runTurns: (deliveryId) => mailbox.routineRunTurns(deliveryId),
      turnAnswer,
      connection: (connectionId) => {
        const record = service.messaging.store.connection(connectionId);
        return record?.enabled ? { platform: record.platform, name: record.workspaceName } : null;
      },
      options: () => service.messaging.destinationOptions(),
      post: (connectionId, placeId, markdown) => service.messaging.deliver(connectionId, placeId, markdown),
      changed: (agentIds) => {
        for (const agentId of agentIds) service.notifyRoutineResultsChanged(agentId);
      },
    }),
  );
  service.on("event", (event) => {
    if (routineFlowNoticeEvent(event)) Effect.runFork(routineFlowRuntime.notice(event));
    if (routineResultNoticeEvent(event)) Effect.runFork(routineResultRuntime.notice(event));
    if (workflowNoticeEvent(event)) Effect.runFork(workflowRuntime.notice(event));
  });
  teardown.push(TEARDOWN_ORDER.routineResults, "the routine results", () =>
    Effect.runPromise(routineResultRuntime.close()),
  );
  const routineFeed = new RoutineFeedServer({
    path: join(app.getPath("userData"), ROUTINE_FEED_FILE),
    cipher: secretCipher,
    document: localRoutineFeedDocument(service, language.translate),
  });
  await Effect.runPromise(routineFeed.start());
  teardown.push(TEARDOWN_ORDER.routineFeed, "the routine feed", () => Effect.runPromise(routineFeed.stop()));
  let ingressHostId: () => string | null = () => null;
  performance.mark("openbot:services.routines");
  const githubRelay = new GitHubRelay({
    account: centralAuth,
    githubToken: () => githubConnector.accessToken(),
    ingress: () => signalIngress,
  });
  const localServerMarketplace = new LocalServerMarketplace(
    (line) => process.stdout.write(line),
    (path) => centralAuth.resolveApiUrl(path),
  );
  const { messaging, signalIngress } = await createMessagingServices({
    teardown,
    secretCipher,
    centralAuth,
    accountSession: localServerChild ? localServerMarketplace : centralAuth,
    service,
    sidebarLayout,
    readHostId: () => ingressHostId(),
    issueGitHubRoute: (hostId) => githubRelay.issueRoute(hostId),
    openLink,
  });
  githubConnector.onAgentAccessChanged(() => {
    void runCauseEffect(service.notifyGitHubConnectorChanged()).catch((error) =>
      logger.warn("Provider tools did not refresh.", toLogValue(error)),
    );
  });
  service.setComputerUseCapability(computerUseCapability(cuaDriver.lastState));
  cuaDriver.onStateChanged((state) => service.setComputerUseCapability(computerUseCapability(state)));
  cuaDriver.onMcpServerChanged(() => {
    void runCauseEffect(service.notifyComputerUseChanged()).catch((error) =>
      logger.warn("Provider tools did not refresh.", toLogValue(error)),
    );
  });
  const startComputerUseHighlight = () => {
    if (drawsComputerUseHighlight && cuaDriver.mcpServerForProviders()) computerUseHighlight.start();
  };
  cuaDriver.onMcpServerChanged(() => {
    if (cuaDriver.mcpServerForProviders()) {
      startComputerUseHighlight();
    } else {
      computerUseHighlight.stop();
      void Effect.runPromise(computerUseReads.close());
    }
  });
  const computerUseWarmUp = Effect.runFork(
    cuaDriver.warmUp().pipe(
      Effect.tap(() => Effect.sync(startComputerUseHighlight)),
      Effect.exit,
    ),
  );
  service.on("event", (event) => {
    if (event.type === "turn-started") startComputerUseHighlight();
    if (event.type === "turn-completed" && !event.continues) computerUseDisplayAwake.turnEnded();
  });
  if (!setupState.completed || service.enabledMcpServers().length > 0)
    Effect.runFork(providerRuntimes.ensureToolRuntimes());
  performance.mark("openbot:services.messaging");
  await runCauseEffect(sidebarLayout.reconcileAgents(service.sidebarChatIds()));
  libraryFolders.onChanged(() => service.notifyLibraryFoldersChanged());
  workflowFolders.onChanged(() => service.notifyWorkflowFoldersChanged());
  await runCauseEffect(libraryFolders.reconcileAgents(new Set(service.listAgents().map((agent) => agent.id))));
  await runCauseEffect(
    libraryFolders.reconcileFiles(new Set(mailbox.listStoredFiles().map((stored) => stored.attachment.id))),
  );

  const hostedCliDownloads = new Set<ManagedProviderId>();
  const resolvesAsMissing = (provider: "claude" | "codex") =>
    (provider === "claude" ? resolveClaudeCli : resolveCodexCli)({
      bundledExecutable: providerRuntimes.executablePath(provider),
    }).pipe(
      Effect.as(false),
      Effect.catch((failure) =>
        Effect.succeed(failure.cause instanceof CodexCliError && failure.cause.code === "missing"),
      ),
    );
  const hostedCliDownload = (provider: AgentProviderStatus, agentProviders: ReadonlySet<string>) => {
    if (provider.state === "outdated") return Effect.succeed(true);
    if (!agentProviders.has(provider.id) || provider.cliSource !== undefined || provider.version !== null) return null;
    if (provider.state === "not-installed") return Effect.succeed(true);
    if (provider.state === "error" && (provider.id === "claude" || provider.id === "codex"))
      return resolvesAsMissing(provider.id);
    return null;
  };
  const trackSystemCliVersions = (status: AgentStatus): void => {
    let copyInUse = false;
    const agentProviders =
      hostedServer === null
        ? null
        : new Set(service.listAgents().map((agent) => (isKeyOnlyProvider(agent.provider) ? "pi" : agent.provider)));
    for (const provider of status.providers ?? []) {
      if (!isManagedRuntimeProvider(provider.id)) continue;
      const version = provider.cliSource === "system" ? (provider.version ?? null) : null;
      if (providerRuntimes.setSystemVersion(provider.id, version, provider.cliIncomplete === true)) copyInUse = true;
      const needsDownload = agentProviders === null ? null : hostedCliDownload(provider, agentProviders);
      if (needsDownload !== null && !hostedCliDownloads.has(provider.id) && !providerUse.off().includes(provider.id)) {
        hostedCliDownloads.add(provider.id);
        const runtime = provider.id;
        Effect.runFork(
          needsDownload.pipe(
            Effect.flatMap((download) => (download ? providerRuntimes.download(runtime) : Effect.void)),
            Effect.ignore,
          ),
        );
      }
    }
    if (copyInUse) Effect.runFork(providerRuntimes.providerUseChanged());
    hermesInstaller.setProvider(status.providers?.find((provider) => provider.id === "hermes"));
  };
  trackSystemCliVersions(service.getStatus());
  service.on("event", (event) => {
    if (event.type === "status") trackSystemCliVersions(event.status);
  });
  providerRuntimes.on("status", forwardProviderRuntimeStatus);
  if (diskRestoring()) {
    updateCheckWait = Effect.runFork(
      diskRestoreEnded.pipe(Effect.andThen(Effect.sync(() => providerRuntimes.startUpdateChecks()))),
    );
  } else {
    providerRuntimes.startUpdateChecks();
  }
  providerRuntimes.on("ready", (runtime) => {
    if (isManagedToolRuntime(runtime)) Effect.runFork(service.refreshAllAgentRuntimes());
  });
  service.on("event", (event) => {
    if (event.type === "agents-changed") storageUsage.invalidate();
  });
  approvalAutomation.subscribe(() => service.notifyAgentsChanged());
  const marketplaceAuth = localServerChild ? localServerMarketplace : centralAuth;
  const skills = new SkillMarketplaceService(
    marketplaceAuth,
    () => service.listAgents(),
    (agentId) =>
      service
        .refreshAgentRuntime(agentId)
        .pipe(Effect.ensuring(Effect.sync(() => service.notifySkillsChanged(agentId)))),
    new LocalSkillLibrary(join(app.getPath("userData"), "local-skills"), () => service.listAgents()),
    githubSkillSource((url, init) => fetch(url, init)),
  );
  const marketplaceAgents = new AgentMarketplaceService(marketplaceAuth, service, skills);
  const agentTemplates = new AgentTemplateService(centralAuth, service, {
    listTemplateSkills: (agentId) => skills.listTemplateSkills(agentId),
    installVersion: (input) => skills.installVersion(input),
    library: () => skills.requireLocalLibrary(),
    installLocal: (input) => skills.installLocal(input),
  });
  const teamStore = new TeamStore(
    join(app.getPath("userData"), TEAM_STORE_FILE),
    join(app.getPath("userData"), LEGACY_TEAM_STORE_FILE),
  );
  await runCauseEffect(teamStore.initialize());
  performance.mark("openbot:services.team");
  const machineAlertStore = new MachineAlertPreferenceStore(
    join(app.getPath("userData"), MACHINE_ALERTS_PREFERENCE_FILE),
  );
  await runCauseEffect(machineAlertStore.load());
  const machineMetrics = new MachineMetricsSampler(storageSources.roots.data);
  const machineAlertMetrics = new MachineMetricsSampler(storageSources.roots.data);
  const machineAlerts = new MachineAlertMonitor({
    read: () => machineAlertMetrics.read(),
    display: () => machineMetrics.read(),
    store: machineAlertStore,
    members: () => (teamStore.configured ? teamStore.listMembers() : []),
    onError: (message, error) => logger.warn(message, toLogValue(error)),
  });
  teardown.push(TEARDOWN_ORDER.machineAlerts, "the machine alert check", () => machineAlerts.close());
  ingressHostId = () => teamStore.getIdentity()?.serverId ?? null;
  signalIngress.reconnect();
  const webhookRelay = new WebhookRelay({
    account: centralAuth,
    ingress: signalIngress,
    hostId: () => teamStore.getIdentity()?.serverId ?? null,
    ensureHost: () => {
      const hostId = teamStore.getIdentity()?.serverId;
      if (hostId && centralAuth.hostSiteCredential(hostId)) return Effect.void;
      return host
        .register()
        .pipe(
          Effect.catch((failure) =>
            Effect.sync(() =>
              logger.warn("This host could not be registered for webhooks.", toLogValue(failure.cause)),
            ),
          ),
        );
    },
  });
  const webhookPrincipal = (): string | null => {
    if (localServerChild) {
      const hostId = teamStore.getIdentity()?.serverId;
      return hostId && centralAuth.hostSiteCredential(hostId) ? hostId : null;
    }
    const state = centralAuth.getState();
    return state.status === "signed_in" ? state.user.id : null;
  };
  let reportWebhookDelivery: ((report: WebhookDeliveryReport) => void) | null = null;
  const events = new HostEventsService({
    routines: service.routineRecords,
    agentKeys: hostAgentWebhookKeys(
      agentApiKeys,
      (agentId) => store.list().find((agent) => agent.id === agentId)?.name,
    ),
    workflows: {
      receive: (delivery) => workflowRuntime.receiveWebhook(delivery),
      changed: (workflowId) => service.notifyWorkflowsChanged(workflowId),
    },
    cipher: secretCipher,
    relay: webhookRelay,
    accountPrincipal: webhookPrincipal,
    onDelivery: (report) => reportWebhookDelivery?.(report),
  });
  const eventsRuntime = new HostEventsRuntime(events);
  signalIngress.handleWebhooks((input) => events.receive(input));
  githubRelay.handle({
    deliver: (delivery) => receiveGitHubDelivery(workflowRuntime, delivery),
    offline: (from, to) =>
      workflowRuntime
        .githubOffline(new Date(from), new Date(to))
        .pipe(
          Effect.catch((failure) =>
            Effect.sync(() =>
              logger.warn("The time without GitHub events was not recorded.", { cause: String(failure.cause) }),
            ),
          ),
        ),
  });
  await Effect.runPromise(
    workflowRuntime.githubRepositories().pipe(
      Effect.tap((repositories) => Effect.sync(() => githubRelay.setRepositories(repositories))),
      Effect.catch((failure) =>
        Effect.sync(() => logger.warn("The GitHub triggers were not read.", { cause: String(failure.cause) })),
      ),
    ),
  );
  teardown.push(TEARDOWN_ORDER.hostEvents, "the event service", async () => {
    webhookRelay.stop();
    githubRelay.stop();
    await Effect.runPromise(eventsRuntime.stop());
  });
  if (developmentRemoteRole) {
    await runCauseEffect(
      applyDevelopmentRemoteAccount({
        role: developmentRemoteRole,
        testClientEnabled: developmentTestClientEnabled,
        clientTransport: readDevelopmentClientTransport(process.env.OPENBOT_DEV_CLIENT_TRANSPORT),
        hostEmail: readDevelopmentHostEmail(process.env.OPENBOT_DEV_HOST_EMAIL),
        centralAuth,
        teamStore,
        setupFile,
        setupCompleted: setupState.completed,
      }),
    );
  }
  let hostedServerSignedIn = false;
  const signInHostedServer = (
    environment: HostedServerEnvironment,
    initialization: Effect.Effect<CentralAuthState, RemoteWorkflowError>,
  ) =>
    applyHostedServerAccount({ environment, centralAuth, centralAuthInitialization: initialization, teamStore }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          hostedServerSignedIn = true;
        }),
      ),
      Effect.tap(() =>
        Effect.forkDetach(
          hostedServerStorageGb(centralAuth, environment.hostId).pipe(
            Effect.tap((storageGb) =>
              Effect.sync(() => {
                hostedStorageGb = storageGb;
              }),
            ),
            Effect.catch((error) =>
              Effect.sync(() =>
                logger.warn("Could not read the plan storage of the hosted server.", toLogValue(error)),
              ),
            ),
          ),
        ),
      ),
    );
  if (hostedServer) {
    await runCauseEffect(signInHostedServer(hostedServer, centralAuthInitialization)).catch((error) =>
      logger.error("The hosted server could not sign in:", toLogValue(error)),
    );
  }

  const teamChatStore = new TeamChatStore(store.database);
  performance.mark("openbot:services.hosted");
  const remoteDesktopRuntime = await Effect.runPromise(
    resolveRemoteDesktopRuntime({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      sourceRoot: resolve(__dirname, "../.."),
      platform: process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux",
      architecture: process.arch,
      ...(process.env.OPENBOT_REMOTE_DESKTOP_RUNTIME_PATH === undefined
        ? {}
        : { overrideRoot: process.env.OPENBOT_REMOTE_DESKTOP_RUNTIME_PATH }),
    }),
  );
  const agentAdminSettings = createAgentAdminSettings({ agents: service, approvalAutomation });
  const agentHostSettings = createAgentHostSettings({ agents: service, busyMessageMode, agentDefaults });
  const agentDefaultsSettings = createAgentDefaultsSettings({ agents: service, agentDefaults, busyMessageMode });
  const agentFolders = createAgentFolders({ service, userDataPath: app.getPath("userData") });
  const channelFolders = createChannelFolders({
    service,
    userDataPath: app.getPath("userData"),
    browse: agentFolders.browse,
  });
  const agentInstructions = createAgentInstructionsFiles(service);
  const browserProfiles = createBrowserProfileService({
    store: browserProfileStore,
    proxies: browserProxyStore,
    cipher: browserProxyCipher,
    agents: service,
    browser,
    memberName: (memberId) => {
      const member = teamStore.getMember(memberId);
      return member ? (member.name ?? member.username) : null;
    },
    computerOnline: (memberId) => browserEgress.online(memberId),
    onChanged: () => service.notifyBrowserProfilesChanged(),
  });
  browserProxyStatusChanged = () => service.notifyBrowserProfilesChanged();
  agentBrowserProfiles = browserProfiles;
  browserEgress.on("connected", (memberId) => browser.forgetComputerFailures(memberId));
  browserEgress.on("changed", () => service.notifyBrowserProfilesChanged());
  const customProviderChanges = createCustomProviderChanges({
    service,
    customProviders,
    providerRuntimes,
    refreshModelReasoning: () => modelReasoning.refresh().pipe(Effect.map(({ changed }) => changed)),
  });
  modelReasoningWait = Effect.runFork(
    Effect.gen(function* () {
      for (const wait of MODEL_REASONING_RETRY_WAITS_MS) {
        yield* Effect.sleep(wait);
        const { changed, unreachable } = yield* modelReasoning.refresh();
        if (changed) yield* service.reloadCustomProviderConfig("opencode").pipe(Effect.ignore);
        if (!unreachable) return;
      }
    }),
  );
  const customAgentChanges = createCustomAgentChanges({ service, customAgents });
  const acpRegistry = createAcpRegistry({
    directory: app.getPath("userData"),
    customAgentChanges,
    withRuntimeRemoval: (ids, operation) =>
      service
        .withCustomAgentRuntimeRemoval(ids, () =>
          operation.pipe(
            Effect.mapError(
              (failure) => new AgentLifecycleFailed({ operation: "removeCustomAgentRuntime", cause: failure.cause }),
            ),
          ),
        )
        .pipe(toProviderRuntimeFailure),
  });
  teardown.push(TEARDOWN_ORDER.providerRuntimes - 1, "ACP registry installations", () =>
    runCauseEffect(acpRegistry.close()),
  );
  let requestedUpdate: RequestedUpdate | undefined;
  const installationMode =
    app.isPackaged && process.platform === "linux" ? await runCauseEffect(readInstallationMode()) : null;
  const hostRelease = new HostReleaseService({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    environment: process.env,
    installationMode,
    updateStatus: () => ({
      phase: requestedUpdate?.snapshot().phase ?? "unsupported",
      managedByHost: requestedUpdate?.snapshot().remoteUpdates === "managed",
    }),
  });
  const scheduledUpdate = (): RequestedUpdate => {
    if (!requestedUpdate) throw new RequestedUpdateRefusal("unsupported");
    return requestedUpdate;
  };
  const agentImport = new AgentImportService(
    service,
    {
      library: () => skills.requireLocalLibrary(),
      installLocal: (input) => skills.installLocal(input),
    },
    () => host.channelActor(),
    () => serverTimezone.effective(),
    join(app.getPath("userData"), "agent-import-uploads"),
  );
  const hermesImport = new HermesImportService(
    {
      listAgents: () => service.listAgents(),
      createAgentProfile: (input) => service.createAgentProfile(input),
      updateAgent: (input) => service.updateAgent(input),
      deleteAgent: (agentId) => service.deleteAgent(agentId),
      createRoutine: (input, options) => service.createRoutine(input, options),
      listRoutines: (agentId) => service.listRoutines(agentId),
      createMemory: (input) => service.createMemory(input),
      listMemories: (agentId) => service.listMemories(agentId),
      memoryLimit: () => service.memoryLimit(),
      initializeMemorySelection: (agentId) => service.initializeMemorySelection(agentId),
      listMcpServers: () => service.listMcpServers(),
      saveMcpServer: (config) => service.saveMcpServer({ config }),
    },
    { library: () => skills.requireLocalLibrary(), installLocal: (input) => skills.installLocal(input) },
    join(app.getPath("userData"), HERMES_IMPORT_LINKS_FILE),
    () => serverTimezone.effective(),
  );
  const instanceTransfer = new InstanceTransferService({
    agents: service,
    skills: { library: () => skills.requireLocalLibrary(), installLocal: (input) => skills.installLocal(input) },
    sharedRoot: store.sharedRoot,
    channelActor: () => host.channelActor(),
    webhookRoutines: {
      list: (owner) => events.listRoutines({ owner }),
      save: (input) => events.saveRoutine(input),
    },
    preferences: {
      notificationLevel: (agentId) => agentNotificationLevels.levels(OWNER_NOTIFICATION_KEY).get(agentId) ?? null,
      setNotificationLevel: (agentId, level) => agentNotificationLevels.set(OWNER_NOTIFICATION_KEY, { agentId, level }),
      pinned: (agentId) =>
        sidebarPins.snapshot(OWNER_PIN_KEY).items.some((pin) => pin.kind === "agent" && pin.id === agentId),
      pin: (agentId) =>
        sidebarPins.set(OWNER_PIN_KEY, [...sidebarPins.snapshot(OWNER_PIN_KEY).items, { kind: "agent", id: agentId }]),
      autoApproves: (agentId) => approvalAutomation.autoApproves(agentId),
      setAutoApprove: (agentId, autoApprove) => approvalAutomation.set({ agentId, autoApprove }),
      apiKeyNames: (agentId) =>
        agentApiKeys
          .list(agentId)
          .pipe(Effect.map((keys) => keys.filter((key) => key.source !== "vault").map((key) => key.name))),
    },
    ownerMemberId: () => (teamStore.configured ? teamStore.getOwnerMemberId() : null),
    memberPreferences: {
      read: () =>
        (teamStore.configured ? teamStore.memberAccounts() : [])
          .filter((member) => !member.owner)
          .map(({ memberId, accountId }) => ({
            accountId,
            server: agentNotificationLevels.serverLevel(memberId),
            agents: [...agentNotificationLevels.levels(memberId)].map(([agentId, level]) => ({ agentId, level })),
            pins: sidebarPins.snapshot(memberId).items,
          })),
      apply: (preferences, owner) =>
        Effect.gen(function* () {
          const member = (teamStore.configured ? teamStore.memberAccounts() : []).find(
            (candidate) => candidate.accountId === preferences.accountId,
          );
          if (!member || (member.owner && !owner)) return false;
          const levelKey = member.owner ? OWNER_NOTIFICATION_KEY : member.memberId;
          const pinKey = member.owner ? OWNER_PIN_KEY : member.memberId;
          if (preferences.server !== null) yield* agentNotificationLevels.setServer(levelKey, preferences.server);
          for (const choice of preferences.agents) yield* agentNotificationLevels.set(levelKey, choice);
          const current = sidebarPins.snapshot(pinKey).items;
          const added = preferences.pins.filter(
            (pin) => !current.some((item) => item.kind === pin.kind && item.id === pin.id),
          );
          if (added.length > 0) yield* sidebarPins.set(pinKey, [...current, ...added]);
          return true;
        }),
    },
    sharedSkills: (() => {
      const library = Effect.try({ try: () => skills.requireLocalLibrary(), catch: (cause) => cause });
      return {
        list: () =>
          library.pipe(
            Effect.flatMap((local) => local.listWithUnreadable()),
            Effect.map(({ skills, unreadable }) => ({
              skills: skills.map(({ id, slug, name, version }) => ({ id, slug, name, version })),
              unreadable: unreadable.map(({ skillId }) => skillId),
            })),
          ),
        assigned: (agentIds: readonly string[]) =>
          Effect.forEach(agentIds, (agentId) =>
            skills.lockedSkillIds(agentId).pipe(Effect.orElseSucceed(() => [])),
          ).pipe(Effect.map((ids) => new Set(ids.flat()))),
        bundle: (id: string, version: number) => library.pipe(Effect.flatMap((local) => local.bundle(id, version))),
        add: (bytes: Uint8Array) => library.pipe(Effect.flatMap((local) => local.createFromBundle(bytes))),
      };
    })(),
    serverIdentity: {
      read: () => {
        const identity = teamStore.configured ? teamStore.getIdentity() : null;
        if (!identity) return null;
        const logo = teamStore.resolveLogo();
        return { name: identity.serverName, logo: logo ? { path: logo.path, mimeType: logo.mimeType } : null };
      },
      save: (input) => host.updateIdentity(input),
    },
    serverPreferences: {
      timezone: { get: () => serverTimezone.get().timezone, set: (timezone) => serverTimezone.set(timezone) },
      personality: { get: () => serverPersonality.get(), set: (personality) => serverPersonality.set(personality) },
      busyMessageMode: { get: () => busyMessageMode.get(), set: (mode) => busyMessageMode.set(mode) },
      agentDefaults: {
        get: () => agentDefaults.get(),
        set: (defaults) => {
          const previous = agentDefaults.get();
          return agentDefaults
            .set(defaults)
            .pipe(Effect.tap(() => Effect.sync(() => service.agentDefaultsChanged(previous))));
        },
      },
      memoryLimit: { get: () => agentMemoryLimit.get(), set: (limit) => agentMemoryLimit.set(limit) },
      memoryReview: { get: () => memoryReview.get(), set: (review) => memoryReview.set(review) },
      skillLearning: { get: () => skillLearning.get(), set: (mode) => skillLearning.set(mode) },
      promptCacheTtl: { get: () => promptCacheTtl.get().ttl, set: (ttl) => promptCacheTtl.set(ttl) },
      ownerNotificationLevel: {
        get: () => agentNotificationLevels.serverLevel(OWNER_NOTIFICATION_KEY),
        set: (level) => agentNotificationLevels.setServer(OWNER_NOTIFICATION_KEY, level),
      },
      browsingMemory: { get: () => browsingMemory.get(), set: (value) => browsingMemory.set(value) },
      claudeUserSetup: {
        get: () => claudeUserSetupSetting.get().enabled,
        set: (enabled) => claudeUserSetupSetting.set(enabled),
      },
      claudeCompactWindow: {
        get: () => claudeCompactWindowSetting.get().tokens,
        set: (tokens) => claudeCompactWindowSetting.set(tokens),
      },
      machineAlerts: { get: () => machineAlerts.alerts(), set: (settings) => machineAlerts.setAlerts(settings) },
      modelVisibility: {
        get: () => modelVisibility.hiddenModels(),
        set: (models) => modelVisibility.replaceHidden(models),
      },
      turnLimits: {
        get: () => {
          const { turnLimit, agentTaskLimit } = hostTurnLimits.get();
          return { turnLimit, agentTaskLimit };
        },
        set: (limits) => hostTurnLimits.set(limits),
      },
    },
    appVersion: app.getVersion(),
    uploadDirectory: join(app.getPath("userData"), "instance-transfer-uploads"),
    timezone: () => serverTimezone.effective(),
    settings: {
      mcpServers: () => service.listMcpServers(),
      saveMcpServer: (config) => service.saveMcpServer({ config }),
      customProviders: () => customProviderChanges.list(),
      saveCustomProvider: (input) => customProviderChanges.save(input),
      customAgents: () => customAgentChanges.list(),
      providersOff: () => providerUse.off(),
      sidebar: () => sidebarLayout.getSnapshot(),
      mutateSidebar: (action) => sidebarLayout.mutate(action, service.sidebarChatIds()),
      routineFlowLinks: (agentId) => routineFlowRuntime.canvas(agentId).pipe(Effect.map((canvas) => canvas.links)),
      connectRoutineFlow: (input) => routineFlowRuntime.connect(input),
      routineFlowPositions: (agentId) =>
        routineFlowRuntime.canvas(agentId).pipe(Effect.map((canvas) => canvas.positions)),
      saveRoutineFlowPosition: (input) => routineFlowRuntime.savePosition(input),
      workflows: {
        workflows: () =>
          workflowRuntime
            .listWithGraphs()
            .pipe(Effect.map((list) => list.map(({ summary, graph }) => ({ title: summary.title, graph })))),
        createWorkflow: (input) => workflowRuntime.create(input),
      },
      signedInProviders: () =>
        (service.getStatus().providers ?? [])
          .filter((provider) => provider.state === "available" && !provider.off)
          .map((provider) => provider.id),
    },
  });
  const mcpHostSignIns = new McpHostSignIns({ service, browser });
  const providerSignIns = new ProviderHostSignIns({ service, browser });
  const providerAccountsHost = new ProviderAccountsHost({ service, browser });
  const signInRelayHost = new SignInRelayHost({
    mcp: mcpHostSignIns,
    providers: providerSignIns,
    accounts: providerAccountsHost,
    receiveMcpGrant: (state, code) => mcpOAuth.receiveAuthorizationCode(state, code),
    receiveMcpRefusal: (state) => mcpOAuth.refuseAuthorization(state),
    printedLink: (agentId, url) =>
      agentPrintedLink(
        service.searchConversationMessages(url, agentId, undefined, 20).results.map(({ message }) => message),
        url,
        Date.now(),
      ),
    atHost: (sessionId) => localServerChild !== null && teamStore.isStoredOwnerSession(sessionId),
  });
  teardown.push(TEARDOWN_ORDER.mcpHostSignIns, "MCP sign-ins of joined servers", () =>
    Effect.runPromise(mcpHostSignIns.close()),
  );
  teardown.push(TEARDOWN_ORDER.providerAccountsHost, "Provider account sign-ins of joined servers", () =>
    Effect.runPromise(providerAccountsHost.close()),
  );
  teardown.push(TEARDOWN_ORDER.providerHostSignIns, "Provider sign-ins of joined servers", () =>
    Effect.runPromise(providerSignIns.close()),
  );
  const providerHostSignIns = process.platform === "linux" ? providerSignIns : undefined;
  const pushNotificationStore = new PushNotificationStore(join(app.getPath("userData"), PUSH_NOTIFICATION_FILE));
  await runCauseEffect(pushNotificationStore.load());
  let localServersForTeam: LocalServers | null = null;
  const availableLocalServers = () =>
    Effect.suspend(() =>
      localServersForTeam
        ? Effect.succeed(localServersForTeam)
        : Effect.fail(new RemoteWorkflowError({ cause: new Error(sourceText("error.team.localServersUnsupported")) })),
    );
  const awaySeconds = app.isPackaged ? Number.NaN : Number(process.env.OPENBOT_DEV_AWAY_SECONDS);
  const awayAfterMs = Number.isInteger(awaySeconds) && awaySeconds > 0 ? awaySeconds * 1_000 : DESKTOP_USE_MS;
  const computerIdle = createComputerIdle(
    (contents) =>
      windows.getMainWindow()?.webContents === contents ||
      windows.getChatWindows().some((chat) => chat.webContents === contents),
  );
  const localServerMembers = new LocalServerMembers(() => process.stdout.write(formatLocalServerMembersRequest()));
  const mcpAccess: McpAccessControl = {
    revision: () => mcpAccessStore.revision(),
    get: (mcpServerId) => mcpAccessStore.get(mcpServerId),
    set: (change, existing) =>
      Effect.suspend(() => {
        const before = mcpAccessStore.get(change.mcpServerId).agents;
        return mcpAccessStore
          .set(change, existing)
          .pipe(
            Effect.andThen(
              sameMcpAgents(before, change.access.agents) ? Effect.void : service.refreshAllAgentRuntimes(),
            ),
          );
      }),
    remove: (mcpServerId) => mcpAccessStore.remove(mcpServerId),
  };
  const remoteDesktopRuntimeCredentials = { username: "openbot", password: randomBytes(32).toString("base64url") };
  const attachmentPreviews = new AttachmentPreviews(join(app.getPath("userData"), "attachment-previews"));
  const host = new HostService({
    appVersion: app.getVersion(),
    store: teamStore,
    agents: service,
    signInWaits: service.signInWaits,
    agentsReady: () => agentInitialization.awaitRoster(),
    events,
    skills,
    sidebarLayout,
    mailbox,
    attachmentPreviews,
    browser,
    chat: teamChatStore,
    channels: service.channels,
    mcpServers: service,
    mcpServerOwners,
    mcpAccess,
    mcpSignIns: mcpHostSignIns,
    signInRelay: signInRelayHost,
    connectors: { github: githubConnector, messaging },
    onePasswordConnector,
    bitwardenConnector,
    passwordManagers,
    vault,
    providerHostSignIns,
    providerAccounts: providerAccountsHost,
    providerUsageResets: service,
    providerSignOut: service,
    storage: storageUsage,
    libraryFolders: libraryFoldersService,
    workflowFolders: workflowFoldersService,
    machine: machineAlerts,
    backgroundProcesses: {
      list: () => listBackgroundProcesses(process.platform, service.listAgents()),
      stop: (id) => stopBackgroundProcess(process.platform, id),
    },
    liveVoice: {
      startLiveVoice: (input, voice, owner) => service.startLiveVoice(input, voice, owner),
      stopLiveVoice: (sessionId, memberId) => service.stopLiveVoice(sessionId, memberId),
      subscribe: (listener) => {
        service.on("liveVoice", listener);
        return () => service.off("liveVoice", listener);
      },
    },
    hostedSites,
    agentImport,
    hermesImport: {
      read: () => hermesImport.stage(hermesRoot()),
      apply: (input) => hermesImport.apply(input),
      discard: (token) => hermesImport.discard(token),
    },
    instanceTransfer,
    routineFlows: routineFlowRuntime,
    workflows: {
      ...workflowRuntime,
      rotateWorkflowSecret: (input) => events.rotateWorkflowSecret(input),
      github: workflowGitHub,
    },
    crm,
    hiddenAgents: service,
    routineRunPlaces: service.routineRecords,
    agentNotificationLevels,
    sidebarPins,
    agentAccess,
    serverAudit,
    agentTasks: service,
    browserProfiles,
    focusUse: hostedServer !== null,
    admin: {
      agents: agentAdminSettings,
      agentHost: agentHostSettings,
      agentDefaults: agentDefaultsSettings,
      folders: agentFolders,
      channelFolders,
      instructions: agentInstructions,
      sessionSettings: service,
      acpRegistry,
      customAgents: customAgentChanges,
      skills,
      sharedTables: service,
      marketplaceAgents,
      agentTemplates,
      providers: {
        service,
        credentials: providerCredentials,
        runtimes: providerRuntimes,
        customProviders: customProviderChanges,
        pasteSignIn: pasteCodeLoginSupported(),
      },
      release: hostRelease,
      update: {
        snapshot: () => scheduledUpdate().snapshot(),
        check: () => scheduledUpdate().check(),
        start: (member, mode) => scheduledUpdate().start(member, mode),
        requestWhenIdle: (member) => scheduledUpdate().requestWhenIdle(member),
        cancel: () => scheduledUpdate().cancel(),
        changeSettings: (change) => scheduledUpdate().changeSettings(change),
      },
      timezone: serverTimezone,
      turnLimits: hostTurnLimits,
      ...(serverModeEnvironment
        ? {
            restart: {
              request: (memberId) => {
                logger.info(`Member ${memberId} asked this server to restart.`);
                setImmediate(() => app.quit());
              },
            },
          }
        : {}),
      ...(serverModeEnvironment && !hostedServer ? { ownerTransfer: true as const } : {}),
      personality: serverPersonality,
      memoryLimit: agentMemoryLimitSetting,
      memoryReview,
      skillLearning,
      browsingMemory,
      promptCacheTtl,
      claudeUserSetup: claudeUserSetupSetting,
      claudeCompactWindow: claudeCompactWindowSetting,
      providerEnvironment: providerEnvironmentSetting,
      providerDetection: { detection: providerDetection, settings: providerDetectionSettings },
      modelVisibility,
      defaultProvider: {
        get: () =>
          readSetupState(setupFile).pipe(
            Effect.map((state) => ({
              provider: service.preferredProvider(),
              model: state.preferredProvider === service.preferredProvider() ? state.preferredModel : null,
            })),
          ),
        set: (input) =>
          readSetupState(setupFile).pipe(
            Effect.flatMap((before) => saveAnalyticsDefault(analyticsPreferenceFile, before.completed)),
            Effect.flatMap(() => writeSetupState(setupFile, input)),
            Effect.tap(() => service.setPreferredProvider(input.preferredProvider, input.preferredModel)),
            Effect.tap((state) =>
              Effect.sync(() => {
                for (const window of BrowserWindow.getAllWindows())
                  sendToRenderer(window, IPC_ENDPOINTS.app.setupState, state);
              }),
            ),
            Effect.map((state) => ({ provider: state.preferredProvider, model: state.preferredModel })),
          ),
      },
      routineResults: routineResultRuntime,
      routineRunCommand: service,
      ...(localServerChild || serverModeEnvironment || hostedServer
        ? {}
        : {
            localServers: {
              list: () => Effect.suspend(() => availableLocalServers().pipe(Effect.map((servers) => servers.list()))),
              create: (name: string) =>
                availableLocalServers().pipe(
                  Effect.flatMap((servers) =>
                    servers.create(name, "device").pipe(
                      Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })),
                      Effect.map(
                        (summary) =>
                          servers.list().servers.find((server) => server.serverId === summary.id) ?? {
                            serverId: summary.id,
                            name: summary.name,
                            published: false,
                          },
                      ),
                    ),
                  ),
                ),
              delete: (serverId: string) =>
                availableLocalServers().pipe(
                  Effect.flatMap((servers) =>
                    servers
                      .delete(serverId, "device")
                      .pipe(Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause }))),
                  ),
                ),
            },
          }),
    },
    mcpToolRuntimePreparation: {
      startToolRuntimes: () => {
        Effect.runFork(providerRuntimes.ensureToolRuntimes());
      },
      ensureToolRuntimesReady: () => providerRuntimes.ensureToolRuntimesReady(),
      toolRuntimes: () => providerRuntimes.mcpToolRuntimes(),
    },
    teamWebRtcBridge,
    peerMemberChanged: browserEgress.peerMemberChanged,
    privateNetwork: () => remoteNetworkRoute.get().route === "private",
    registerRemoteHost: (input) => centralAuth.registerRemoteHost(input).pipe(toRemoteWorkflowError),
    handOverRemoteHostKey: (hostId, handover) =>
      centralAuth.handOverRemoteHostKey(hostId, handover).pipe(toRemoteWorkflowError),
    onKeyRotated: () => remoteServers.requestDirectoryRefresh(),
    issueRemoteHostTicket: (hostId, home) =>
      centralAuth.issueRemoteHostTicket(hostId, home).pipe(toRemoteWorkflowError),
    ...(serverModeEnvironment && !hostedServer
      ? {
          requestTransferredOwnerSession: (hostId: string) =>
            centralAuth.requestTransferredOwnerSession(hostId).pipe(toRemoteWorkflowError),
          applyTransferredOwnerSession: (hostId: string, session: { sessionToken: string; user: CentralAuthUser }) =>
            centralAuth.applyTransferredOwnerSession(hostId, session).pipe(toRemoteWorkflowError),
        }
      : {}),
    sendLiveActivityPush: (hostId, push) => centralAuth.sendLiveActivityPush(hostId, push).pipe(toRemoteWorkflowError),
    sendPushNotification: (hostId, push) => centralAuth.sendPushNotification(hostId, push).pipe(toRemoteWorkflowError),
    pushNotificationStore,
    awayAfterMs,
    hostComputerInUse: (event) => {
      const window = windows.getMainWindow();
      if (!window || window.isDestroyed()) return false;
      if (powerMonitor.getSystemIdleState(awayAfterMs / 1_000) !== "active") return false;
      if (computerIdle.seconds() * 1_000 >= awayAfterMs) return false;
      if (window.isFocused()) return true;
      if (!event || !Notification.isSupported()) return false;
      const local = remoteServers.list().find((server) => server.id === LOCAL_SERVER_ID);
      return desktopShowsAgentEvent(
        event,
        local,
        notificationPreference.get().desktopNotifications,
        agentNotificationLevels.levels(OWNER_NOTIFICATION_KEY),
      );
    },
    verifyRemoteSessionTicket: (ticket) => centralAuth.verifyRemoteSessionTicket(ticket).pipe(toRemoteWorkflowError),
    endRemoteSession: (sessionId) => centralAuth.endRemoteSession(sessionId).pipe(toRemoteWorkflowError),
    remoteControlPlaneUrl: centralAuth.resolveApiUrl("/"),
    createRemoteInvite: (hostId, input) => centralAuth.createRemoteInvite(hostId, input).pipe(toRemoteWorkflowError),
    listRemoteInvites: (hostId) => centralAuth.listRemoteInvites(hostId).pipe(toRemoteWorkflowError),
    revokeRemoteInvite: (inviteId) => centralAuth.revokeRemoteInvite(inviteId).pipe(toRemoteWorkflowError),
    listRemoteMembers: localServerChild
      ? () => localServerMembers.list()
      : (hostId) => centralAuth.listRemoteMembers(hostId).pipe(toRemoteWorkflowError),
    updateRemoteMember: (hostId, membershipId, role, reactivate) =>
      centralAuth.updateRemoteMember(hostId, membershipId, role, reactivate).pipe(toRemoteWorkflowError),
    removeRemoteMember: (hostId, membershipId) =>
      centralAuth.removeRemoteMember(hostId, membershipId).pipe(toRemoteWorkflowError),
    updateRemoteHostLogo: (hostId, image, version) =>
      centralAuth.updateRemoteHostLogo(hostId, image, version).pipe(toRemoteWorkflowError),
    updateRemoteHostAppearance: (hostId, appearance) =>
      centralAuth.updateRemoteHostAppearance(hostId, appearance).pipe(toRemoteWorkflowError),
    localDevelopmentHost: developmentRemoteRole === "host",
    passwordOwner: localServerChild !== null,
    logDirectory: join(app.getPath("userData"), "logs", "remote"),
    removeLegacyRemoteDesktopCredential: () =>
      Effect.tryPromise({
        try: async () => {
          const credentialPath = join(app.getPath("userData"), LEGACY_REMOTE_DESKTOP_CREDENTIAL_FILE);
          await Promise.all([rm(credentialPath, { force: true }), rm(`${credentialPath}.tmp`, { force: true })]);
        },
        catch: (cause) => new RemoteWorkflowError({ cause }),
      }),
    getSignedInUser: () => centralAuth.getSignedInUser(),
    redeemCentralTicket: (ticket, serverId) =>
      centralAuth.redeemTeamAuthTicket(ticket, serverId).pipe(toRemoteWorkflowError),
    sendTeamInviteEmail: (input) => centralAuth.sendTeamInviteEmail(input).pipe(toRemoteWorkflowError),
    platform: process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux",
    unattended: false,
    remoteDesktopRuntimePaths: remoteDesktopRuntime,
    remoteControlPolicy,
    ...(hostedServer || serverModeEnvironment || localServerChild
      ? {}
      : {
          askRemoteControl: createRemoteControlQuestion({
            translate: language.translate,
            ensureMainWindow: windows.ensureMainWindow,
            presentMainWindow: showMainWindow,
          }),
        }),
    openRemoteDesktopSetup: (action, appPath) =>
      Effect.tryPromise({
        try: async () => {
          if (action === "reveal") shell.showItemInFolder(appPath);
          else {
            await shell.openExternal(MAC_PERMISSION_URLS[action]);
            await computerUsePermissionHelp.show(action, appPath);
          }
        },
        catch: (cause) => new RemoteWorkflowError({ cause }),
      }),
    remoteDesktopStateDirectory: join(app.getPath("userData"), "remote-desktop-runtime"),
    getRemoteDesktopRuntimeCredentials: () => Effect.succeed(remoteDesktopRuntimeCredentials),
    remoteDesktopScreenLocked: () => powerMonitor.getSystemIdleState(1) === "locked",
    getRemoteDesktopDisplays: () => {
      const primaryId = screen.getPrimaryDisplay().id;
      return screen.getAllDisplays().map((display, index) => ({
        id: String(display.id),
        label: display.label || `Display ${index + 1}`,
        width: display.size.width,
        height: display.size.height,
        primary: display.id === primaryId,
      }));
    },
    getRemoteDesktopDisplayScreenOrigin: (displayId) => {
      if (process.platform !== "win32") return undefined;
      const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === displayId);
      return display ? screen.dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y }) : undefined;
    },
    writeRemoteDesktopClipboard: (text) => clipboard.writeText(text),
    getRemoteDesktopIceServers: () =>
      Effect.try({
        try: () => {
          if (developmentRemoteRole === "host" || remoteNetworkRoute.get().route === "private") return [];
          const identity = teamStore.getIdentity();
          if (!identity) throw new Error(sourceText("error.app.remoteIdentityUnavailable"));
          const iceServers = teamWebRtcBridge.getIceServers(identity.serverId);
          if (iceServers.length === 0) throw new Error(sourceText("error.app.iceServersMissing"));
          return iceServers;
        },
        catch: (cause) => new RemoteWorkflowError({ cause }),
      }),
  });
  teardown.push(TEARDOWN_ORDER.host, "the local host", () => runCauseEffect(host.shutdown()));
  const signedInState = centralAuth.getState();
  if (localServerChild) {
  } else if (signedInState.status === "signed_in") {
    await runCauseEffect(host.applySignedInAccount(signedInState.user));
  } else if (signedInState.status === "signed_out") {
    await runCauseEffect(host.applySignedInAccount(null));
  }
  const analyticsPlatform = process.platform;
  if (analyticsPlatform !== "darwin" && analyticsPlatform !== "win32" && analyticsPlatform !== "linux") {
    throw new Error(`Unsupported analytics platform: ${analyticsPlatform}`);
  }
  performance.mark("openbot:services.remote-desktop");
  const analyticsEnabled = (app.isPackaged && appVariant === "production") || analyticsCaptureUrl !== null;
  const analyticsInstallId = analyticsEnabled
    ? await Effect.runPromise(
        readAnalyticsInstallId(join(app.getPath("userData"), ANALYTICS_INSTALL_ID_FILE), Date.now()),
      )
    : null;
  const failureReports = analyticsEnabled
    ? new ReportQueue(
        fileReportStorage(join(app.getPath("userData"), "openbot-error-reports-v1.json")),
        openPanelTransport({
          clientId: "6c989975-87ef-4f0c-857e-ab449a65b5c2",
          origin: "openbot-app://app",
          ...(analyticsCaptureUrl ? { endpoint: `${analyticsCaptureUrl}/track` } : {}),
        }),
        {
          surface: "desktop_host",
          app_version: app.getVersion(),
          platform: analyticsPlatform,
          event_schema_version: ANALYTICS_GENERATIONS.desktop_host,
        },
      )
    : undefined;
  const trace = new TraceFile({ directory: join(app.getPath("userData"), "logs") });
  teardown.push(TEARDOWN_ORDER.trace, "the trace file", () => Effect.runPromise(trace.close()));
  const resourceMonitor = new ResourceMonitor({
    userDataPath: app.getPath("userData"),
    server: hostedServer !== null || serverModeEnvironment !== null,
    trace,
    statementTimings,
    tabProcessIds: () => browser.tabProcessIds(),
    appWindowContents: () => BrowserWindow.getAllWindows().map((window) => window.webContents),
    turnRunning: () => service.earliestRunningTurnStartedAt() !== null,
    appPath: app.getAppPath(),
  });
  teardown.push(TEARDOWN_ORDER.resourceMonitor, "the resource monitor", () =>
    Effect.runPromise(resourceMonitor.close()),
  );
  service.on("event", (event) => resourceMonitor.observeAgentEvent(event));
  const analytics = new HostAnalytics({
    ...(failureReports ? { reports: failureReports } : {}),
    enabled: analyticsEnabled,
    ...(analyticsCaptureUrl ? { apiUrl: analyticsCaptureUrl } : {}),
    trackingEnabled: analyticsPreference.enabled,
    installId: analyticsInstallId,
    appVersion: app.getVersion(),
    platform: analyticsPlatform,
    resolveOwner: () => {
      const state = centralAuth.getState();
      if (state.status !== "signed_in") return null;
      const storedOwner = teamStore.getOwnerAnalyticsIdentity();
      if (storedOwner) return storedOwner.id === state.user.id ? storedOwner : null;
      const ownerEmail = teamStore.getOwnerEmail();
      return !teamStore.configured || ownerEmail?.trim().toLowerCase() === state.user.email.trim().toLowerCase()
        ? state.user
        : null;
    },
    resolveAgent: (agentId) => service.listAgents().find((agent) => agent.id === agentId) ?? null,
    resolveProviderAuth: (agent) =>
      providerAuthKind(agent, {
        account: (provider) => service.getProviderAccountKind(provider),
        hasApiKey: (provider) => providerCredentials.status(provider) === "saved",
        customProviderIds: () => customProviders.list().map((provider) => provider.id),
        envKey: (name) => Boolean(process.env[name]?.trim()),
      }),
    resolveTurnUsage: (agentId, turnId, since) => service.getTurnUsage(agentId, turnId, since),
    resolveTurnTiming: (turnId) => service.takeTurnTiming(turnId),
    resolveMcpServer: (name) => {
      const configs = service.listMcpServers().filter((server) => isReportedMcpServerName(server.name, name));
      if (configs.length === 0) return null;
      const slugs = new Set(configs.map((config) => catalogPluginSlug(config, catalogPluginServers, homedir())));
      const [slug] = slugs;
      return { slug: slugs.size === 1 && slug ? slug : null };
    },
    resolveRoutineRun: (agentId, routineId, runId) => {
      const run = service.listRoutineRuns({ agentId, routineId }).find((item) => item.id === runId);
      const routine = service.routineRecords.get({ kind: "agent", id: agentId }, routineId);
      if (!run || !routine) return null;
      return {
        runKind: run.kind,
        runSource: run.source ?? null,
        triggerType: routine.trigger.kind === "webhook" ? "webhook" : routine.trigger.schedule.kind,
      };
    },
    resolveInventory: () =>
      collectAnalyticsInventory({
        agents: () => service.listAgents(),
        routines: (agentId) => service.listRoutines(agentId),
        enabledWebhookRoutineCount: (agentId) =>
          service.routineRecords
            .list({ kind: "agent", id: agentId })
            .filter((routine) => routine.active && routine.trigger.kind === "webhook").length,
        webhookRouteCount: () => service.routineRecords.routes.list().length,
        workflowCount: () => workflowStore.list().length,
        skills: (agentId) => skills.listInstalledForChatTags(agentId),
        mcpServers: () => service.listMcpServers(),
        pluginSlug: (config) => catalogPluginSlug(config, catalogPluginServers, homedir()),
        computerUseEnabled: () => cuaDriver.mcpServerForProviders() !== null,
      }),
    inventoryDay: analyticsInventoryDayStore(join(app.getPath("userData"), ANALYTICS_INVENTORY_FILE)),
    resources: resourceMonitor,
    uncleanExit: previousUncleanExit,
  });
  teardown.push(TEARDOWN_ORDER.analytics, "host analytics", () => Effect.runPromise(analytics.close()));
  const analyticsPreferences = new AnalyticsPreferenceService({
    path: analyticsPreferenceFile,
    account: centralAuth,
    setTrackingEnabled: (enabled) => analytics.setTrackingEnabled(enabled),
    followed: (enabled) => {
      for (const window of BrowserWindow.getAllWindows())
        sendToRenderer(window, IPC_ENDPOINTS.app.analyticsPreference, { enabled });
    },
  });
  analytics.flushPending();
  service.on("failure", (failure) => analytics.handleFailure(failure));
  reportWebhookDelivery = (report) => analytics.handleWebhookDelivery(report);
  resourceMonitor.start(
    () => analytics.checkResources(),
    (profile) => analytics.handleMainLoopProfile(profile),
  );
  const startup = localServerChild
    ? null
    : new StartupTiming({
        userDataPath: app.getPath("userData"),
        appVersion: app.getVersion(),
        server: hostedServer !== null || serverModeEnvironment !== null,
        send: (properties) => analytics.handleStartup(properties),
      });
  if (startup) {
    Effect.runFork(startup.recordStart());
    teardown.push(TEARDOWN_ORDER.startupTiming, "the startup timing", () => startup.dispose());
  }
  const connectTrace = new RemoteConnectTrace(
    (span) => trace.record(span),
    (summary) => analytics.handleRemoteConnect(summary),
  );
  const developmentRoundTripMs = app.isPackaged ? 0 : Math.max(0, Number(process.env.OPENBOT_DEV_RTT_MS) || 0);
  const developmentDownlinkKbps = app.isPackaged ? 0 : Math.max(0, Number(process.env.OPENBOT_DEV_DOWNLINK_KBPS) || 0);
  installRemoteSyncProfileSink(
    remoteSyncProfileFile({
      isPackaged: app.isPackaged,
      setting: process.env.OPENBOT_DEV_SYNC_PROFILE,
      userData: app.getPath("userData"),
      roundTripMs: developmentRoundTripMs,
    }),
  );
  const remoteServers = new RemoteServerManager(
    join(app.getPath("userData"), REMOTE_SERVERS_FILE),
    safeStorageCipher("error.app.macSecureStorageUnavailable"),
    {
      createTeamAuthTicket: (serverId) => centralAuth.createTeamAuthTicket(serverId),
      getEmail: () => centralAuth.getSignedInUser().email,
      sendTeamInviteEmail: (input) => centralAuth.sendTeamInviteEmail(input),
    },
    {
      allowLocalDevelopmentInvites: developmentRemoteRole !== null,
      selfHostedApiOrigin: selfHostedApiOrigin(centralAuthApiUrl()),
      appVersion: app.getVersion(),
      connectTrace,
      localNotificationLevels: {
        snapshot: () => agentNotificationLevels.snapshot(OWNER_NOTIFICATION_KEY),
        setServer: (level) => agentNotificationLevels.setServer(OWNER_NOTIFICATION_KEY, level),
        setAgent: (input) => agentNotificationLevels.set(OWNER_NOTIFICATION_KEY, input),
        subscribe: (listener) =>
          agentNotificationLevels.subscribe((key) => {
            if (key === OWNER_NOTIFICATION_KEY) listener();
          }),
      },
      accountReady: centralAuthInitialization,
      ...(hostedServer || serverModeEnvironment || localServerChild
        ? {}
        : {
            computerActivity: {
              awayAfterMs,
              idleSeconds: () => computerIdle.seconds(),
              showsEvents: (server) => {
                const window = windows.getMainWindow();
                if (!window || window.isDestroyed()) return false;
                if (window.isFocused() || windows.getChatWindows().some((chat) => chat.isFocused())) return true;
                return (
                  Notification.isSupported() &&
                  notificationPreference.get().desktopNotifications &&
                  !server.notificationsMuted &&
                  server.notificationLevel !== "nothing"
                );
              },
            },
          }),
      getLocalHostId: () => teamStore.getIdentity()?.serverId ?? null,
      hostedServers: {
        unavailable: (serverId, wake) => hostedServers.unavailableHost(serverId, wake),
        wake: (serverId) => hostedServers.wake(serverId),
        status: (serverId) => hostedServers.status(serverId),
      },
      webrtcTransport: new TeamWebRtcClientTransport({
        bridge: teamWebRtcBridge,
        listHosts: () => centralAuth.listRemoteHosts(),
        startSession: (hostId) => centralAuth.startRemoteSession(hostId),
        issueTicket: (sessionId, clientPublicKey) => centralAuth.issueRemoteSessionTicket(sessionId, clientPublicKey),
        endSession: (sessionId) => centralAuth.endRemoteSession(sessionId),
        createInvite: (hostId, input) => centralAuth.createRemoteInvite(hostId, input),
        listInvites: (hostId) => centralAuth.listRemoteInvites(hostId),
        previewInvite: (token) => centralAuth.previewRemoteInvite(token),
        acceptInvite: (token) => centralAuth.acceptRemoteInvite(token),
        revokeInvite: (inviteId) => centralAuth.revokeRemoteInvite(inviteId),
        listMembers: (hostId) => centralAuth.listRemoteMembers(hostId),
        updateMember: (hostId, membershipId, role, reactivate) =>
          centralAuth.updateRemoteMember(hostId, membershipId, role, reactivate),
        removeMember: (hostId, membershipId) => centralAuth.removeRemoteMember(hostId, membershipId),
        removeOwnedHost: (hostId) => centralAuth.removeOwnedRemoteHost(hostId),
        getPrincipalId: () => centralAuth.getSignedInUser().id,
        controlPlaneUrl: centralAuth.resolveApiUrl("/"),
        downloadHostLogo: (hostId, version) => centralAuth.downloadRemoteHostLogo(hostId, version),
        transferDirectory: join(app.getPath("userData"), "remote-transfers"),
        connectTrace,
        sessionCache: remoteSessionCache,
        developmentRoundTripMs,
        developmentDownlinkKbps,
      }),
    },
  );
  teamWebRtcBridge.on("accountServersChanged", () => void Effect.runPromise(remoteServers.invalidateDirectory()));
  teardown.push(TEARDOWN_ORDER.remoteServers, "the remote servers", () => {
    serverClaimWatch.stop();
    return runCauseEffect(remoteServers.stop());
  });
  const browserEgressClient = new BrowserEgressClient(teamWebRtcBridge, {
    serverIds: () => remoteServers.list().map((server) => server.id),
    browserEgressWanted: (serverId) => remoteServers.browserEgressWanted(serverId),
  });
  remoteServers.on("changed", browserEgressClient.reconcile);
  teardown.push(TEARDOWN_ORDER.browserEgress, "the computer proxy of this computer", () => {
    remoteServers.off("changed", browserEgressClient.reconcile);
    browserEgressClient.dispose();
  });
  performance.mark("openbot:services.plugin-catalog");
  const localServers =
    localServerChild || serverModeEnvironment || hostedServer
      ? null
      : new LocalServers({
          registryPath: join(app.getPath("userData"), LOCAL_SERVERS_FILE),
          userDataRoot: join(app.getPath("userData"), "local-servers"),
          agentRoot: join(homedir(), "OpenBot", "Servers"),
          runtimeRoot: providerRuntimesRoot,
          cipher: safeStorageCipher("error.app.macSecureStorageUnavailable"),
          remoteServers,
          command: {
            executable: process.execPath,
            args: [
              ...(app.isPackaged ? [] : [app.getAppPath()]),
              ...ozonePlatformArguments(),
              ...sandboxArguments(process.argv.slice(1)),
            ],
          },
          trash: (path) => shell.trashItem(path),
          account: {
            accountId: () => {
              const state = centralAuth.getState();
              return state.status === "signed_in" ? state.user.id : null;
            },
            register: (input) => centralAuth.registerRemoteHost(input).pipe(Effect.asVoid, toRemoteWorkflowError),
            credential: (hostId) => centralAuth.hostSiteCredential(hostId)?.machineToken ?? null,
            listMembers: (hostId) => centralAuth.listRemoteMembers(hostId).pipe(toRemoteWorkflowError),
            remove: (hostId) =>
              centralAuth.removeOwnedRemoteHost(hostId).pipe(
                Effect.catch((error) => (isHostNotOnAccount(error.cause) ? Effect.void : Effect.fail(error))),
                toRemoteWorkflowError,
              ),
            apiOrigin: new URL(centralAuth.resolveApiUrl("/")).origin,
            requestAuthorized: (path, init) =>
              centralAuth.requestAuthorized(path, init, (value) => value).pipe(toRemoteWorkflowError),
            downloadAuthorized: (path) => centralAuth.downloadAuthorized(path).pipe(toRemoteWorkflowError),
          },
          log: {
            info: (message) => logger.info(message),
            warn: (message, detail) => logger.warn(message, detail === undefined ? "" : toLogValue(detail)),
          },
          platform: process.platform,
        });
  if (localServers) {
    localServersForTeam = localServers;
    teardown.push(TEARDOWN_ORDER.localServers, "the servers on this computer", () =>
      Effect.runPromise(localServers.stop()),
    );
    centralAuth.on("changed", () => {
      Effect.runFork(localServers.accountChanged());
    });
    remoteServers.setThisComputerMembersListener((serverId) => localServers.sendMembers(serverId));
    await Effect.runPromise(localServers.load());
  }
  await runCauseEffect(remoteServers.initialize());
  performance.mark("openbot:services.remote-servers");
  criticalActionTargets = { agents: service, host, remoteServers };
  if (developmentRemoteRole) {
    await runCauseEffect(remoteServers.awaitHostDirectory());
    await runCauseEffect(
      startDevelopmentRemoteRole({
        role: developmentRemoteRole,
        testClientEnabled: developmentTestClientEnabled,
        clientTransport: readDevelopmentClientTransport(process.env.OPENBOT_DEV_CLIENT_TRANSPORT),
        host,
        remoteServers,
      }),
    );
  }
  if (localServers) {
    await Effect.runPromise(localServers.initialize());
    Effect.runFork(localServers.accountChanged());
  }
  if (localServerChild) {
    await runCauseEffect(
      startLocalServerChild({
        environment: localServerChild,
        teamStore,
        host,
        writeReady: (line) => process.stdout.write(line),
        members: localServerMembers,
        marketplace: localServerMarketplace,
        readCommands: (onLine) => {
          if (localServerControl) createInterface({ input: localServerControl }).on("line", onLine);
        },
        publisher: {
          publish: (machineToken) =>
            Effect.suspend(() => {
              const serverId = teamStore.getIdentity()?.serverId;
              if (!serverId)
                return Effect.fail(
                  new RemoteWorkflowError({ cause: new Error(sourceText("error.app.remoteIdentityUnavailable")) }),
                );
              registerSecretValue(machineToken);
              centralAuth.useHostCredential(serverId, machineToken);
              signalIngress.reconnect();
              eventsRuntime.setAccountPrincipal(webhookPrincipal());
              eventsRuntime.syncRoutes({ all: true });
              return host.publishLocalServer();
            }),
          unpublish: () =>
            host.unpublishLocalServer().pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  const serverId = teamStore.getIdentity()?.serverId;
                  if (serverId) centralAuth.useHostCredential(serverId, null);
                  eventsRuntime.setAccountPrincipal(webhookPrincipal());
                  signalIngress.reconnect();
                }),
              ),
            ),
        },
        warn: (message, cause) => logger.warn(message, toLogValue(cause)),
      }),
    );
    reportLocalServerWorkingAgents({
      read: () => service.workingAgents(),
      subscribe: (listener) => service.on("event", listener),
      write: (line) => process.stdout.write(line),
    });
  }
  configureAttachmentProtocol({ mailbox, agents: service, remoteServers });
  configureServerLogoProtocols({ teamStore, remoteServers });
  const browserView = new BrowserViewClient({
    servers: remoteServers,
    onEvent: (event, owner) => {
      const contents = webContents.fromId(owner);
      sendToRenderer(contents && BrowserWindow.fromWebContents(contents), IPC_ENDPOINTS.browser.liveViewEvent, event);
    },
    writeClipboard: (text) => clipboard.writeText(text),
  });
  teardown.push(TEARDOWN_ORDER.browserView, "the live browser view", () => runCauseEffect(browserView.stop()));
  const remoteDesktop = new RemoteDesktopManager({
    createRemoteDesktopSession: (serverId) =>
      serverId === "local"
        ? host.createLocalRemoteDesktopTestSession()
        : remoteServers.createRemoteDesktopSession(serverId),
    closeRemoteDesktopSession: (serverId, sessionId) =>
      serverId === "local"
        ? host.closeLocalRemoteDesktopTestSession(sessionId)
        : remoteServers.closeRemoteDesktopSession(serverId, sessionId),
    selectRemoteDesktopDisplay: (serverId, displayId) => {
      if (serverId === "local")
        return Effect.fail(new RemoteWorkflowError({ cause: new Error(sourceText("error.app.finishLocalTest")) }));
      return remoteServers.selectRemoteDesktopDisplay(serverId, displayId);
    },
  });
  teardown.push(TEARDOWN_ORDER.remoteDesktop, "remote desktop", () => Effect.runPromise(remoteDesktop.stop()));
  const voicePreferences = new VoicePreferenceStore(join(app.getPath("userData"), "voice-preference.json"), () => {
    const chosen = language.preference.language;
    return defaultVoiceSettings(chosen === DEFAULT_APP_LANGUAGE ? app.getLocale() : chosen);
  });
  await runCauseEffect(voicePreferences.load());
  const voiceApiKeys = new VoiceApiKeyStore({
    path: join(app.getPath("userData"), "voice-api-key.json"),
    cipher: secretCipher,
  });
  await runCauseEffect(voiceApiKeys.load());
  const groqVoiceKeys = new VoiceApiKeyStore({
    path: join(app.getPath("userData"), "groq-api-key.json"),
    cipher: secretCipher,
  });
  await runCauseEffect(groqVoiceKeys.load());
  const voiceModelFetch = (input: string | URL | Request, init?: RequestInit) =>
    net.fetch(input instanceof URL ? input.href : input, init);
  const voice = new VoiceTranscriptionService({
    resourcesRoot: app.isPackaged ? join(process.resourcesPath, "voice") : resolve(".openbot-build/voice"),
    modelDirectories: {
      "parakeet-tdt-0.6b-v3": app.isPackaged
        ? join(app.getPath("userData"), "runtimes", PARAKEET_MODEL_DIRECTORY)
        : resolve(".openbot-build/voice/model"),
      "parakeet-unified-en-0.6b": app.isPackaged
        ? join(app.getPath("userData"), "runtimes", PARAKEET_UNIFIED_MODEL_DIRECTORY)
        : resolve(".openbot-build/voice", PARAKEET_UNIFIED_MODEL_DIRECTORY),
      "bark-3.0-plus": app.isPackaged
        ? join(app.getPath("userData"), "runtimes", BARK_PLUS_MODEL_DIRECTORY)
        : resolve(".openbot-build/voice", BARK_PLUS_MODEL_DIRECTORY),
      "whisper-turbo": app.isPackaged
        ? join(app.getPath("userData"), "runtimes", WHISPER_TURBO_MODEL_DIRECTORY)
        : resolve(".openbot-build/voice", WHISPER_TURBO_MODEL_DIRECTORY),
      "cohere-transcribe-03-2026": app.isPackaged
        ? join(app.getPath("userData"), "runtimes", COHERE_TRANSCRIBE_MODEL_DIRECTORY)
        : resolve(".openbot-build/voice", COHERE_TRANSCRIBE_MODEL_DIRECTORY),
    },
    preferences: voicePreferences,
    apiKeys: { elevenlabs: voiceApiKeys, groq: groqVoiceKeys },
    spawnHost: spawnVoiceTranscriptionHost,
    openStreamSocket: openScribeSocket,
    modelFetch: voiceModelFetch,
  });
  if (app.isPackaged) {
    void Effect.runPromise(removeLegacyWhisperCache(join(app.getPath("userData"), "runtimes", "whisper"))).catch(
      (error) => logger.warn("Could not remove the old Whisper model cache.", toLogValue(error)),
    );
  }
  void Effect.runPromise(voice.removeRetiredModelFiles()).catch((error) =>
    logger.warn("Could not remove the old voice model files.", toLogValue(error)),
  );
  teardown.push(TEARDOWN_ORDER.voice, "voice transcription", () => Effect.runPromise(voice.shutdown()));
  voice.on("modelStatus", forwardVoiceModelStatus);
  voice.on("streamTranscript", forwardVoiceStreamTranscript);
  const speechPreferences = new SpeechPreferenceStore(join(app.getPath("userData"), "speech-preference.json"));
  await runCauseEffect(speechPreferences.load());
  const xaiSpeechKeys = new VoiceApiKeyStore({
    path: join(app.getPath("userData"), "xai-api-key.json"),
    cipher: secretCipher,
  });
  await runCauseEffect(xaiSpeechKeys.load());
  const speech = new VoiceSpeechService({
    resourcesRoot: app.isPackaged ? join(process.resourcesPath, "voice") : resolve(".openbot-build/voice"),
    modelDirectory: app.isPackaged
      ? join(app.getPath("userData"), "runtimes", SUPERTONIC_MODEL_DIRECTORY)
      : resolve(".openbot-build/voice", SUPERTONIC_MODEL_DIRECTORY),
    preferences: speechPreferences,
    spawnHost: spawnVoiceSpeechHost,
    apiKeys: { elevenlabs: voiceApiKeys, xai: xaiSpeechKeys },
    modelFetch: voiceModelFetch,
  });
  teardown.push(TEARDOWN_ORDER.speech, "speech", () => Effect.runPromise(speech.shutdown()));
  speech.on("modelStatus", forwardSpeechModelStatus);
  const voiceServerPreferences = createVoiceServerPreferenceStore(join(app.getPath("userData"), "voice-server.json"));
  await runCauseEffect(voiceServerPreferences.load());
  const voiceServerKeys = new VoiceApiKeyStore({
    path: join(app.getPath("userData"), "voice-server-key.json"),
    cipher: secretCipher,
  });
  await runCauseEffect(voiceServerKeys.load());
  const voiceServer = new VoiceServerService({ preferences: voiceServerPreferences, apiKeys: voiceServerKeys });
  voiceServer.on("settings", forwardVoiceServerSettings);
  const currentVersion = app.getVersion();
  const updateMetadataAvailable = app.isPackaged && existsSync(join(process.resourcesPath, "app-update.yml"));
  const containerInstaller =
    app.isPackaged &&
    process.platform === "linux" &&
    installationMode === "container" &&
    existsSync(CONTAINER_UPDATE_TRIGGER);
  const hostedInstaller =
    containerInstaller ||
    (app.isPackaged &&
      process.platform === "linux" &&
      (process.env.OPENBOT_HOSTED_SERVER === "1" || (serverModeEnvironment !== null && installationMode === "self")) &&
      existsSync(HOSTED_UPDATE_TRIGGER));
  const updatesEnabled =
    !localServerChild &&
    app.isPackaged &&
    !isNixStoreInstall() &&
    (hostedInstaller || (supportsInstalledUpdates(process.platform) && updateMetadataAvailable)) &&
    isValidSemver(currentVersion);
  if (app.isPackaged && updateMetadataAvailable && !isValidSemver(currentVersion)) {
    logger.warn(`OpenBot updates are disabled because the application version is not valid SemVer: ${currentVersion}`);
  }
  let updateAdapter: UpdateAdapter = createDisabledUpdateAdapter();
  let updaterEnabled = updatesEnabled;
  let updaterCacheDirectory: string | undefined;
  let appImagePath: string | undefined;
  if (updatesEnabled && hostedInstaller) {
    updateAdapter = new HostedUpdateAdapter({
      currentVersion,
      arch: process.arch,
      ...(containerInstaller ? { paths: CONTAINER_UPDATE_PATHS } : {}),
    });
  } else if (updatesEnabled) {
    const realAdapter = await loadElectronUpdater();
    if (realAdapter) {
      updateAdapter = realAdapter;
      updaterCacheDirectory = electronUpdaterCacheDirectory();
      appImagePath = process.env.APPIMAGE?.trim() || undefined;
    } else {
      updaterEnabled = false;
    }
  }
  const updater = new UpdateService(updateAdapter, {
    currentVersion,
    enabled: updaterEnabled,
    autoDownload: updatePreference.autoDownload,
    beforeInstall: prepareForUpdateInstall,
    ...(app.isPackaged
      ? {
          checkSiblingInstances: () =>
            listSiblingOpenBotInstances({
              executablePath: app.getPath("exe"),
              currentPid: process.pid,
              platform: process.platform,
              ...(localServers ? { excludedPids: () => localServers.pids() } : {}),
            }).pipe(
              Effect.tap((siblings) =>
                Effect.sync(() => {
                  if (siblings.length === 0) return;
                  const list = siblings.map(({ pid, uid }) => `pid ${pid} (uid ${uid})`).join(", ");
                  logger.warn(
                    `OpenBot update install refused: other OpenBot processes run from this application: ${list}`,
                  );
                }),
              ),
            ),
        }
      : {}),
    ...(typeof process.getuid === "function" ? { currentUid: process.getuid() } : {}),
    platform: process.platform,
    logDirectory: join(app.getPath("userData"), "logs", "update"),
    ...(process.platform === "darwin"
      ? {
          shipItDirectory: macShipItDirectory(),
          handoverPath: join(app.getPath("userData"), UPDATE_HANDOVER_FILE),
          installRecordPath: join(app.getPath("userData"), UPDATE_INSTALL_RECORD_FILE),
          notInstalledVersion: Effect.runSync(
            readNotInstalledUpdate(join(app.getPath("userData"), UPDATE_INSTALL_RECORD_FILE), app.getVersion()),
          ),
          appBundlePath: join(app.getPath("exe"), "..", "..", ".."),
          restartFromInstalledCopy: (bundlePath: string) => restartFromInstalledCopy(app, bundlePath, currentVersion),
        }
      : {}),
    appImagePath,
    updaterCacheDirectory,
  });
  teardown.push(TEARDOWN_ORDER.updater, "the update service", () => Effect.runPromise(updater.stop()));
  const agentInitialization = new AgentInitializationGate((rosterLoaded) =>
    Effect.gen(function* () {
      yield* service.initialize({
        heldRoutines: takeRoutineHold(routineHoldFile, (message) => logger.warn(message)),
        rosterLoaded,
        beforeProviderStart: Fiber.join(computerUseWarmUp).pipe(Effect.asVoid),
      });
      yield* eventsRuntime.start();
      yield* automation.sync();
      yield* routineFlowRuntime.sweep();
      yield* workflowRuntime.sweep();
      yield* routineResultRuntime.recover();
    }),
  );
  const describeRestartReadiness = (): RestartReadiness =>
    checkRestartReadiness({
      agentWork: [
        ...service.hasActiveWork(),
        ...(workflowRuntime.working() ? ["routine-run"] : []),
        ...(localServers && localServers.workingAgents().length > 0 ? ["agent-turn"] : []),
      ],
      hostBlockers: host.describeRestartBlockers(),
      activeBrowserControls: browser.getControlState().sessions.length,
      activeFileTransfers: remoteServers.hasActiveTransfers(),
      updaterBusy: !updater.getStatus().managedByHost && isUpdateBusyPhase(updater.getStatus().phase),
      initializationPending: !agentInitialization.succeeded,
    });
  const hostUpdateCoordinator = new HostUpdateCoordinator({
    uid: typeof process.getuid === "function" ? process.getuid() : 0,
    pid: process.pid,
    currentVersion,
    describeReadiness: describeRestartReadiness,
    setManagedByHost: (managed) => updater.setManagedByHost(managed),
    setHostState: (state) => updater.setHostState(state),
    onDiagnostic: (message) => logger.warn(message),
    checkHealth: () =>
      Effect.sync(() => {
        if (!agentInitialization.succeeded) return { ok: false, checks: ["initialization-not-ready"] };
        try {
          service.listAgents();
        } catch {
          return { ok: false, checks: ["agent-list-failed"] };
        }
        return { ok: true, checks: ["initialization-succeeded", "agent-list"] };
      }),
  });
  const clientInUse = () =>
    host.connectedClientCount() > 0 && Date.now() - (host.lastClientUseAt() ?? 0) < CLIENT_USE_WINDOW_MS;
  const startedAt = Date.now();
  const clientInUseSinceStart = () =>
    clientInUse() || (host.connectedClientCount() > 0 && Date.now() - startedAt < CLIENT_USE_WINDOW_MS);
  requestedUpdate = new RequestedUpdate({
    updater,
    describeReadiness: describeRestartReadiness,
    preference: updatePreference,
    savePreference: (change) => writeUpdatePreference(updatePreferenceFile, change),
    log: (message) => logger.info(message),
    announce: (state, version) => host.announceRestart(state, version),
    clientInUse: hostedServer ? clientInUseSinceStart : undefined,
    maximumIdleWait: hostedServer
      ? { afterMs: HOSTED_UPDATE_MAXIMUM_IDLE_WAIT_MS, providerOperationPending: () => service.hasProviderOperation() }
      : undefined,
  });
  const remoteUpdate = requestedUpdate;
  teardown.push(TEARDOWN_ORDER.requestedUpdate, "the requested update", () =>
    Effect.runPromise(remoteUpdate.dispose()),
  );
  const idleRestart = new IdleRestart({
    updater,
    describeReadiness: describeRestartReadiness,
    holdRoutines: () => service.holdRoutines(),
    releaseRoutines: () => service.releaseRoutines(),
    recordHold: (window) => {
      try {
        if (window) writeRoutineHold(routineHoldFile, window);
        else clearRoutineHold(routineHoldFile);
      } catch (error) {
        logger.warn("The routine hold could not be saved.", toLogValue(error));
      }
    },
    relaunch: () => {
      if (app.isPackaged) relaunchApp(app, process.argv.slice(1));
      app.quit();
    },
    log: (message) => logger.info(message),
  });
  teardown.push(TEARDOWN_ORDER.idleRestart, "the restart when idle", () => idleRestart.dispose());
  const requiredUpdate =
    app.isPackaged && !localServerChild
      ? new RequiredUpdate({
          surface: hostedServer || serverModeEnvironment ? "host" : "desktop",
          currentVersion,
          resolveApiUrl: (path) => centralAuth.resolveApiUrl(path),
          updater,
          setRequired: (required) => remoteUpdate.setRequired(required),
          log: (message) => logger.info(message),
        })
      : null;
  if (requiredUpdate) {
    teardown.push(TEARDOWN_ORDER.requiredUpdate, "the minimum version check", () =>
      Effect.runPromise(requiredUpdate.dispose()),
    );
  }
  if (hostedServer) {
    const hostedServerStartRetry = new HostedServerStartRetry({
      hostPhase: () => host.getStatus().phase,
      startHost: () =>
        Effect.gen(function* () {
          if (centralAuth.getState().status !== "signed_in") yield* centralAuth.retry().pipe(toRemoteWorkflowError);
          if (!hostedServerSignedIn) yield* signInHostedServer(hostedServer, Effect.succeed(centralAuth.getState()));
          return yield* host.start();
        }),
      onError: (message, error) => logger.warn(message, toLogValue(error)),
    });
    hostedServerStartRetry.start();
    teardown.push(TEARDOWN_ORDER.hostedServerStartRetry, "the hosted server start retry", () =>
      Effect.runPromise(hostedServerStartRetry.stop()),
    );
    const hostedServerActivity = new HostedServerActivity({
      hostId: hostedServer.hostId,
      inUse: () =>
        service.hasActiveWork().length > 0 ||
        (messaging.hasLiveConnection() && !signalIngress.queueReady()) ||
        host.describeRestartBlockers().some((reason) => reason !== "browser-view") ||
        clientInUse(),
      nextRunAt: () => {
        const dueAt = service.nextRoutineDueAt();
        return dueAt ? Date.parse(dueAt) : null;
      },
      report: (path, report) =>
        centralAuth
          .requestAuthorized(
            path,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) },
            () => undefined,
          )
          .pipe(toRemoteWorkflowError),
      onError: (message, error) => logger.warn(message, toLogValue(error)),
    });
    hostedServerActivity.start();
    teardown.push(TEARDOWN_ORDER.hostedServerActivity, "the hosted server activity report", () =>
      Effect.runPromise(hostedServerActivity.stop()),
    );
  } else if (!serverModeEnvironment && !localServerChild) {
    const launchPublishRetry = new HostedServerStartRetry({
      hostPhase: () => host.getStatus().phase,
      startHost: () =>
        Effect.gen(function* () {
          if (!shouldAutoStartHost({ ...host.getStatus(), remoteRole: developmentRemoteRole })) return;
          const auth = centralAuth.getState();
          if (auth.status === "error" && auth.issue.code === "auth_api_unavailable")
            yield* centralAuth.retry().pipe(toRemoteWorkflowError);
          if (centralAuth.getState().status !== "signed_in") return;
          return yield* host.start(true);
        }),
      onError: (message, error) => logger.warn(message, toLogValue(error)),
    });
    launchPublishRetry.start();
    teardown.push(TEARDOWN_ORDER.launchPublishRetry, "the launch publish retry", () =>
      Effect.runPromise(launchPublishRetry.stop()),
    );
  }
  const serverMode = serverModeEnvironment
    ? new ServerMode({
        environment: serverModeEnvironment,
        version: app.getVersion(),
        centralAuth,
        host,
        memory: hostMemory && {
          level: () => hostMemory.level(),
          sample: () => hostMemory.sample(),
          turnLimit: () => hostTurnLimits.turnLimit() ?? hostMemory.turnLimit(),
        },
        onError: (message, error) => logger.warn(message, toLogValue(error)),
      })
    : null;
  if (serverMode) {
    await runCauseEffect(serverMode.listen()).catch((error) =>
      logger.error("The server control socket did not start:", toLogValue(error)),
    );
    const serverStartRetry = new HostedServerStartRetry({
      hostPhase: () => host.getStatus().phase,
      startHost: () =>
        Effect.gen(function* () {
          if (host.getStatus().message === sourceText("status.host.removed")) return;
          if (centralAuth.getState().status === "error") yield* centralAuth.retry().pipe(toRemoteWorkflowError);
          yield* serverMode.publish(true);
        }),
      onError: (message, error) => logger.warn(message, toLogValue(error)),
    });
    serverStartRetry.start();
    const setupPagePort = serverModeEnvironment?.setupPagePort ?? null;
    let setupPage: ServerSetupPage | null = null;
    if (setupPagePort !== null && installationMode !== "container") {
      logger.warn("OPENBOT_SETUP_PAGE_PORT works only in the OpenBot container. The setup page did not start.");
    } else if (setupPagePort !== null) {
      const page = new ServerSetupPage({
        port: setupPagePort,
        address: "0.0.0.0",
        rendererRoot: resolve(__dirname, "../renderer"),
        request: serverMode.setupRequest,
        onError: (message, error) => logger.warn(message, toLogValue(error)),
      });
      await runCauseEffect(page.listen()).then(
        () => {
          setupPage = page;
        },
        (error) => logger.error("The server setup page did not start:", toLogValue(error)),
      );
    }
    teardown.push(TEARDOWN_ORDER.serverMode, "the server control socket", async () => {
      await Effect.runPromise(serverStartRetry.stop());
      if (setupPage) await Effect.runPromise(setupPage.close());
      await Effect.runPromise(serverMode.close());
    });
  }
  performance.mark("openbot:services.updates");
  await runCauseEffect(hostUpdateCoordinator.tick());
  performance.mark("openbot:services.host-update");
  hostUpdateCoordinator.start();
  teardown.push(TEARDOWN_ORDER.hostUpdateCoordinator, "the host update coordinator", () =>
    Effect.runPromise(hostUpdateCoordinator.stop()),
  );

  return {
    service,
    workflows: workflowRuntime,
    workflowGitHub,
    crm,
    routineResults: routineResultRuntime,
    providerRuntimes,
    providerCredentials,
    messaging,
    teamWebRtcBridge,
    mcpOAuth,
    signInRelayClient,
    relayedMessagingInstalls: new RelayedMessagingInstalls(remoteServers),
    githubConnector,
    linkAccount,
    onePasswordConnector,
    bitwardenConnector,
    passwordManagers,
    vault,
    mailbox,
    storageUsage,
    libraryFoldersService,
    workflowFoldersService,
    browser,
    browserPictureInPicture,
    detachedBrowserWindow,
    localSignIn,
    browserDock,
    browserView,
    updater,
    setupFile,
    analyticsPreferences,
    analyticsInstallId,
    updatePreferenceFile,
    approvalAutomation,
    agentAdminSettings,
    agentHostSettings,
    agentDefaultsSettings,
    agentFolders,
    channelFolders,
    agentInstructions,
    browserProfiles,
    language,
    logoColor,
    appearance,
    interfaceSize,
    notificationPreference,
    busyMessageMode,
    agentDefaults,
    agentMemoryLimit: agentMemoryLimitSetting,
    memoryReview,
    skillLearning,
    browsingMemory,
    agentNotificationLevels,
    sidebarPins,
    agentAccess,
    mcpAccess,
    serverAudit,
    serverTimezone,
    hostTurnLimits,
    serverPersonality,
    promptCacheTtl,
    claudeUserSetup: claudeUserSetupSetting,
    claudeCompactWindow: claudeCompactWindowSetting,
    providerEnvironment: providerEnvironmentSetting,
    modelVisibility,
    remoteSessionReuse,
    externalLinkPreference,
    externalLinks,
    openLink,
    remoteNetworkRoute,
    remoteSessionCache,
    appBehavior,
    agentInitialization,
    hostUpdateCoordinator,
    requestedUpdate: remoteUpdate,
    idleRestart,
    requiredUpdate,
    describeRestartReadiness,
    sidebarLayout,
    host,
    remoteDesktop,
    remoteServers,
    localServers,
    centralAuth,
    skills,
    hostedSites,
    billing,
    referral,
    license,
    hostedServers,
    routineFeed,
    events,
    eventsRuntime,
    webhookPrincipal,
    serverMode,
    customProviders,
    customProviderChanges,
    customAgentChanges,
    acpRegistry,
    providerDetection,
    providerDetectionSettings,
    marketplaceAgents,
    agentTemplates,
    agentImport,
    hermesImport,
    instanceTransfer,
    voice,
    speech,
    voiceServer,
    dynamicIsland,
    agentDock,
    cuaDriver,
    computerUseHighlight,
    computerUsePermissionHelp,
    analytics,
    prewarmAgentDatabase: tables.prewarm(),
    trace,
    resourceMonitor,
    startup,
    machineAlerts,
    teamStore,
    appliedAccount: signedInState,
    centralAuthInitialization,
  };
}

function browserAgentChat(store: AgentStore, threads: AgentThreadStore, threadId: string): BrowserAgentChat | null {
  const mainAgentId = store.mainThreadAgentId(threadId);
  if (mainAgentId !== null) return { agentId: mainAgentId, sideThread: null };
  const thread = threads.taskForThread(threadId);
  return thread ? { agentId: thread.agentId, sideThread: { taskId: thread.taskId, title: thread.title } } : null;
}
