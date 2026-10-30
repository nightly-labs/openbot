import { isManagedRuntimeProvider } from "@openbot/contracts/agent-providers";
import { ANALYTICS_GENERATIONS, openPanelTransport, ReportQueue } from "@openbot/telemetry";
import { fileReportStorage } from "@openbot/telemetry/node";
import { Effect, Fiber } from "effect";
import { toAgentRemovalFailed } from "../backend/agent/agent-removal";
import { toHostedSiteOperationFailed } from "../backend/agent/hosted-site-coordinator";
import { AgentApiKeys } from "../backend/agent-api-keys";
import { AgentDatabaseSupervisor } from "../backend/agent-data/agent-database-supervisor";
import { AgentTables } from "../backend/agent-data/agent-tables";
import { AgentRoutineStore } from "../backend/agent-routine-store";
import { DiscordConnectFailed, toDiscordConnectFailed } from "../backend/messaging/discord/discord-connect";
import { SlackConnectFailed, toSlackConnectFailed } from "../backend/messaging/slack/slack-connect";
import { routineFlowRoutines } from "../backend/routine-flows/routine-flow-routines";
import { RoutineFlowStore } from "../backend/routine-flows/routine-flow-store";
import { createRoutineFlows, type RoutineFlowsHandle } from "../backend/routine-flows/routine-flows";
import { RoutineResultStore } from "../backend/routine-results/routine-result-store";
import { createRoutineResults, type RoutineResultsHandle } from "../backend/routine-results/routine-results";
import { WorkflowRunStore } from "../backend/workflows/workflow-run-store";
import { WorkflowStore } from "../backend/workflows/workflow-store";
import { WorkflowTriggers, workflowScheduleDueAt } from "../backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowNotice, type WorkflowsHandle } from "../backend/workflows/workflows";
import { type AcpRegistry, createAcpRegistry } from "./acp-registry";
import { type AgentAdminSettingsService, createAgentAdminSettings } from "./agent-admin-settings";
import { spawnAgentDatabaseHost } from "./agent-database-host-process";
import { agentDisplayEnvironment, hasSeparateAgentDisplay } from "./agent-display";
import { type AgentHostSettingsService, createAgentHostSettings } from "./agent-host-settings";
import { type BrowserProfileService, createBrowserProfileService } from "./browser-profile-service";
import { HostReleaseService, readInstallationMode } from "./host-release-service";
import {
  CONTAINER_UPDATE_PATHS,
  CONTAINER_UPDATE_TRIGGER,
  HOSTED_UPDATE_TRIGGER,
  HostedUpdateAdapter,
} from "./hosted-update-adapter";
import { LicenseDesktopService } from "./license-service";
import { LocalSignInWindows } from "./local-sign-in-window";
import { LocalSkillLibrary } from "./local-skill-library";
import { localSkillTools } from "./local-skill-tools";
import { MAC_PERMISSION_URLS } from "./mac-permission-urls";
import { PushNotificationStore } from "./push-notification-store";
import { DESKTOP_USE_MS } from "./push-notifications";
import { RemoteWorkflowError, toRemoteWorkflowError } from "./remote-service-effects";
/**
 * The composition root. Every long-lived service the desktop app owns is built here, in one
 * function, in dependency order, and handed back as a single record.
 *
 * **One function on purpose.** Most of these services take their dependencies by value, and a value
 * only type-checks because `tsc` narrows a local across the statements of one function body. Split
 * this into stages and `mainWindow`, `browser`, `teamWebRtcBridge` and the rest would each have to
 * cross a boundary as `T | null`, which is how the entry point ended up with seventeen
 * `() => X | null` accessors and twenty-three unreachable "not ready" guards. A local built above
 * the line that reads it needs neither.
 *
 * **Construct only.** This function does not subscribe the renderer forwarders, register IPC
 * handlers, load the renderer or open event connections - the entry point does, after this returns.
 * The rule keeps the direction of the dependency honest: pull the wiring in here too and the
 * parameter object grows larger than the return value, at which point this is a service locator.
 *
 * **Every step is registered for teardown as it is built**, so a quit that arrives mid-startup
 * stops exactly what exists. `TEARDOWN_ORDER` below, not the order of the pushes, decides what runs
 * when - see `teardown-registry.ts` for why shutdown here is not the reverse of construction.
 */

import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { selfHostedApiOrigin } from "@openbot/contracts/invite-links";
import type {
  AgentStatus,
  AppVariant,
  BrowserDisplayState,
  CapabilityState,
  CentralAuthState,
  ComputerUseState,
  ProviderRuntimeSnapshot,
  SpeechModelStatus,
  VoiceModelStatus,
  VoiceServerSettings,
  VoiceStreamTranscript,
} from "@openbot/contracts/ipc";
import {
  agentBrowserProfile,
  IPC_ENDPOINTS,
  isManagedToolRuntime,
  isUpdateBusyPhase,
  LOCAL_SERVER_ID,
  latestTurnAnswer,
} from "@openbot/contracts/ipc";
import { decodeRecord, requiredString } from "@openbot/contracts/ipc-decoding";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { REMOTE_ACCOUNT_CHECK_INTERVAL_MS } from "@openbot/team-client";
import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  Notification,
  nativeImage,
  powerMonitor,
  safeStorage,
  screen,
  shell,
  systemPreferences,
} from "electron";
import { pasteCodeLoginSupported } from "../backend/agent/cli-code-login";
import { toMcpGatewayFailed } from "../backend/agent/mcp-gateway";
import { ProviderAccountStore } from "../backend/agent/provider-account-store";
import { AgentLifecycleFailed, AgentService } from "../backend/agent-service";
import { AgentStore } from "../backend/agent-store";
import { BrowserHost } from "../backend/browser-host";
import { BrowserProfileStore } from "../backend/browser-profiles/browser-profile-store";
import { runCauseEffect } from "../backend/effect-boundary";
import { MailboxStore } from "../backend/mailbox-store";
import { McpOAuth } from "../backend/mcp-oauth-provider";
import { discordDriver } from "../backend/messaging/discord/discord-driver";
import { MessagingOperationFailed, MessagingService } from "../backend/messaging/messaging-service";
import { slackDriver } from "../backend/messaging/slack/slack-driver";
import { telegramDriver } from "../backend/messaging/telegram/telegram-driver";
import { OpenBotDatabase } from "../backend/openbot-database";
import { passwordVaultRouter } from "../backend/password-vault-router";
import { sweepProviderTemp } from "../backend/provider-temp";
import { SidebarLayoutStore } from "../backend/sidebar-layout-store";
import { StorageUsageScanner, StorageUsageService } from "../backend/storage-usage";
import { TeamChatStore } from "../backend/team-chat-store";
import { AGENT_ACCESS_FILE, AgentAccessStore } from "./agent-access-store";
import {
  type AgentDefaultsPreferenceStore,
  createAgentDefaultsPreferenceStore,
} from "./agent-defaults-preference-store";
import { AgentImportService } from "./agent-import-service";
import { AgentInitializationGate } from "./agent-initialization";
import { AgentMarketplaceService } from "./agent-marketplace-service";
import {
  AgentMemoryLimitPreferenceStore,
  type AgentMemoryLimitSetting,
  reloadingAgentMemoryLimit,
} from "./agent-memory-limit-preference-store";
import { AgentTemplateService } from "./agent-template-service";
import { HostAnalytics } from "./analytics";
import { analyticsInventoryDayStore, collectAnalyticsInventory } from "./analytics-inventory";
import { catalogPluginSlug, isReportedMcpServerName, loadCatalogPluginServers } from "./analytics-plugin-catalog";
import { readAnalyticsPreference } from "./analytics-preference-store";
import { providerAuthKind } from "./analytics-provider-auth";
import { AppBehaviorService } from "./app-behavior-service";
import { AppearanceService } from "./appearance-service";
import { ApprovalAutomation, readApprovalAutomation } from "./approval-automation-store";
import { AutomationServer } from "./automation-server";
import { BillingDesktopService } from "./billing-service";
import { managedBitwardenCli } from "./bitwarden-cli-installer";
import { BitwardenConnectorService } from "./bitwarden-connector-service";
import { BitwardenConnectorStore } from "./bitwarden-connector-store";
import { BrowserDockOverlay } from "./browser-dock-overlay";
import { BrowserPictureInPicture } from "./browser-picture-in-picture";
import { BrowserViewClient } from "./browser-view-client";
import { BusyMessageModePreferenceStore } from "./busy-message-mode-preference-store";
import { CentralAuthManager, readCentralAuthApiUrl, readMobileConnectApiUrl } from "./central-auth-manager";
import { ChatVisualPreviewer } from "./chat-visual-preview";
import { ComputerUseHighlightController } from "./computer-use-highlight-window";
import { applicationBundlePath, applicationIconName } from "./computer-use-permission-app";
import { ComputerUsePermissionHelpWindowController } from "./computer-use-permission-help-window";
import {
  COMPUTER_USE_ACTION_MAX_AGE_MS,
  COMPUTER_USE_CURSOR_MAX_AGE_MS,
  chooseTarget,
  liveSession,
} from "./computer-use-target-window";
import { isSupportedCuaDriverTarget, resolveCuaDriver } from "./cua-driver-artifact";
import { CuaDriverDaemonClient } from "./cua-driver-daemon-client";
import { CuaDriverRuntime, cuaDriverCommandAlias, resolveCuaDriverEndpoint } from "./cua-driver-runtime";
import { type CustomAgentChanges, createCustomAgentChanges } from "./custom-agent-changes";
import { CUSTOM_AGENTS_FILE, CustomAgentStore } from "./custom-agent-store";
import { type CustomProviderChanges, createCustomProviderChanges } from "./custom-provider-changes";
import { CustomProviderStore } from "./custom-provider-store";
import { MCP_OAUTH_REDIRECT_URL } from "./deep-link-router";
import { desktopShowsAgentEvent } from "./desktop-notifications";
import { shouldAutoStartHost } from "./development-profile";
import {
  applyDevelopmentRemoteAccount,
  type DevelopmentRemoteRole,
  startDevelopmentRemoteRole,
} from "./development-remote-bootstrap";
import { performDynamicIslandCriticalAction } from "./dynamic-island-actions";
import { DynamicIslandFailed, DynamicIslandWindowController, toDynamicIslandFailed } from "./dynamic-island-window";
import {
  createExternalLinkPreferenceStore,
  ExternalLinkOpener,
  type ExternalLinkPreferenceStore,
} from "./external-link-opener";
import { githubAppConfig } from "./github-connector-config";
import { GitHubConnectorService } from "./github-connector-service";
import { GitHubConnectorStore } from "./github-connector-store";
import { HermesImportService } from "./hermes-import-service";
import { HostEventsRuntime } from "./host-events-runtime";
import { agentWebhookRoutineWriter, HostEventsService } from "./host-events-service";
import { HostService } from "./host-service";
import { HostUpdateCoordinator } from "./host-update-coordinator";
import { CLIENT_USE_WINDOW_MS, HostedServerActivity } from "./hosted-server-activity";
import { applyHostedServerAccount, type HostedServerEnvironment } from "./hosted-server-bootstrap";
import { HostedServerDesktopService, withHostingDeveloperKey } from "./hosted-server-service";
import { HostedServerStartRetry } from "./hosted-server-start-retry";
import { HostedSiteDesktopService } from "./hosted-site-service";
import { IdleRestart } from "./idle-restart";
import { loadIngressQueueKey } from "./ingress-queue-key";
import { InstanceTransferService } from "./instance-transfer-service";
import { InterfaceSizeService } from "./interface-size-service";
import { prepareToolRuntimeForTest } from "./ipc/mcp-server-handlers";
import { LanguageService } from "./language-service";
import { localRoutineFeedDocument } from "./local-routine-calendar";
import { type LocalServerChildEnvironment, startLocalServerChild } from "./local-server-child";
import { LOCAL_SERVERS_FILE } from "./local-servers/local-server-registry";
import { LocalServers } from "./local-servers/local-servers";
import { createLoginItem } from "./login-item";
import { LogoColorService } from "./logo-color-service";
import type { MacHapticFeedback } from "./mac-haptic-feedback";
import { MACHINE_ALERTS_PREFERENCE_FILE, MachineAlertMonitor, MachineAlertPreferenceStore } from "./machine-alerts";
import { MachineMetricsSampler } from "./machine-metrics";
import {
  computerUseCoveringWindowIds,
  computerUseDesktopPoint,
  computerUseDesktopRect,
  computerUseDisplays,
  createComputerUseHighlightWindow,
  createComputerUsePermissionHelpWindow,
  createDynamicIslandWindow,
  loadBrowserDockRenderer,
  loadComputerUseHighlightRenderer,
  loadComputerUsePermissionHelpRenderer,
  loadDynamicIslandRenderer,
  type MainWindowController,
  sendComputerUseHighlightPlacement,
  showMainWindow,
} from "./main-window";
import { DATA_SKILL_SLUG, ManagedSkillService, SKILL_CREATOR_SKILL_SLUG } from "./managed-skill-service";
import { McpHostSignIns } from "./mcp-host-sign-ins";
import { McpOAuthProxySettingsFile } from "./mcp-oauth-proxy-store";
import {
  MCP_OAUTH_REDIRECT_PATH,
  MCP_OAUTH_REDIRECT_PORT,
  startMcpOAuthRedirectServer,
} from "./mcp-oauth-redirect-server";
import { McpOAuthStore } from "./mcp-oauth-store";
import { MemoryReviewPreferenceStore } from "./memory-review-preference-store";
import { MessagingCredentialStore } from "./messaging-credential-store";
import { NotificationPreferenceStore } from "./notification-preference-store";
import { OnePasswordConnectorService } from "./onepassword-connector-service";
import { OnePasswordConnectorStore } from "./onepassword-connector-store";
import { PromptCacheTtlPreferenceStore } from "./prompt-cache-ttl-preference-store";
import { ProviderAccountsHost } from "./provider-accounts-host";
import { createProviderCliAppVersionStore } from "./provider-cli-app-version-store";
import { ProviderCredentialStore } from "./provider-credential-store";
import { createProviderDetection, type ProviderDetection } from "./provider-detection";
import { PROVIDER_DETECTION_SETTINGS_FILE, ProviderDetectionSettingsStore } from "./provider-detection-settings-store";
import { ProviderHostSignIns } from "./provider-host-sign-ins";
import { startAccountLog, startAgentLog, startProviderLog } from "./provider-log";
import { toProviderRuntimeFailure } from "./provider-runtime-effects";
import { ProviderRuntimeManager, providerRuntimeRoot, runtimeTarget } from "./provider-runtime-manager";
import { ProviderUseSettingsStore } from "./provider-use-settings-store";
import { RelayedMessagingInstalls } from "./relayed-messaging-installs";
import { decodeQueuedMessageReceipt } from "./remote-agent-decoding";
import { RemoteConnectTrace } from "./remote-connect-trace";
import { RemoteDesktopManager } from "./remote-desktop-manager";
import { resolveRemoteDesktopRuntime } from "./remote-desktop-runtime-artifact";
import { loadOrCreateRemoteDesktopCredentials } from "./remote-desktop-secret-store";
import { appendRemoteDiagnosticLog } from "./remote-diagnostics";
import { decodeVoid } from "./remote-host-decoding";
import {
  createRemoteNetworkRoutePreferenceStore,
  type RemoteNetworkRoutePreferenceStore,
} from "./remote-network-route-preference-store";
import { RemoteServerManager } from "./remote-server-manager";
import { RemoteSessionCache } from "./remote-session-cache";
import {
  createRemoteSessionReusePreferenceStore,
  type RemoteSessionReusePreferenceStore,
} from "./remote-session-reuse-preference-store";
import { sendToRenderer } from "./renderer-ipc";
import { RequestedUpdate, RequestedUpdateRefusal } from "./requested-update";
import { ResourceMonitor } from "./resource-monitor";
import { StatementTimings } from "./resource-summary";
import { RoutineFeedServer } from "./routine-feed-server";
import { clearRoutineHold, ROUTINE_HOLD_FILE, takeRoutineHold, writeRoutineHold } from "./routine-hold-file";
import { ScreenCapturer } from "./screen-capture";
import { AGENT_PROCESS_VARIABLE, agentProcessEnvironment, ServerMemory } from "./server-memory";
import { ServerMode, type ServerModeEnvironment } from "./server-mode";
import { ServerTimezonePreferenceStore } from "./server-timezone-preference-store";
import {
  configureApplicationProtocol,
  configureAttachmentProtocol,
  configureServerLogoProtocols,
} from "./session-configuration";
import { readSetupState, writeSetupState } from "./setup-store";
import { SignInRelayClient } from "./sign-in-relay-client";
import { agentPrintedLink, SignInRelayHost } from "./sign-in-relay-host";
import { SignalIngress } from "./signal-ingress";
import { SkillMarketplaceService } from "./skill-marketplace-service";
import { SLACK_DEV_CALLBACK_PATH, startSlackDevCallbackServer } from "./slack-dev-callback-server";
import { SpeechPreferenceStore } from "./speech-preference-store";
import { TeamStore } from "./team-store";
import { TeamWebRtcBridge } from "./team-webrtc-bridge";
import { TeamWebRtcClientTransport } from "./team-webrtc-client-transport";
import type { TeardownRegistry } from "./teardown-registry";
import { TraceFile } from "./trace-file";
import { readUpdatePreference, writeUpdatePreference } from "./update-preference-store";
import { checkRestartReadiness, type RestartReadiness } from "./update-readiness";
import {
  createDisabledUpdateAdapter,
  isNixStoreInstall,
  isValidSemver,
  supportsInstalledUpdates,
  type UpdateAdapter,
  UpdateService,
} from "./update-service";
import { listSiblingOpenBotInstances } from "./update-sibling-instances";
import { VaultService } from "./vault-service";
import { VaultStore } from "./vault-store";
import { VoiceApiKeyStore } from "./voice-api-key-store";
import { openScribeSocket } from "./voice-cloud-stream";
import {
  BARK_PLUS_MODEL_DIRECTORY,
  PARAKEET_MODEL_DIRECTORY,
  removeLegacyWhisperCache,
  SUPERTONIC_MODEL_DIRECTORY,
  WHISPER_TURBO_MODEL_DIRECTORY,
} from "./voice-model-service";
import { VoicePreferenceStore } from "./voice-preference-store";
import { createVoiceServerPreferenceStore, VoiceServerService } from "./voice-server-service";
import { spawnVoiceSpeechHost } from "./voice-speech-host-process";
import { VoiceSpeechService } from "./voice-speech-service";
import { spawnVoiceTranscriptionHost } from "./voice-transcription-host-process";
import { VoiceTranscriptionService } from "./voice-transcription-service";
import { WebhookRelay } from "./webhook-relay";

const logger = createOpenBotLogger("application-services");
const SETUP_FILE = "openbot-setup-v2.json";
const ANALYTICS_PREFERENCE_FILE = "openbot-analytics-preference-v1.json";
const ANALYTICS_INVENTORY_FILE = "openbot-analytics-inventory-v1.json";
const APPROVAL_AUTOMATION_FILE = "openbot-approval-automation-v3.json";
const V2_APPROVAL_AUTOMATION_FILE = "openbot-approval-automation-v2.json";
const ROUTINE_FEED_FILE = "openbot-routine-feed-v1.json";
const LEGACY_APPROVAL_AUTOMATION_FILE = "openbot-approval-automation-v1.json";
const LANGUAGE_PREFERENCE_FILE = "openbot-language-preference-v1.json";
const LOGO_COLOR_PREFERENCE_FILE = "openbot-logo-color-preference-v1.json";
const APPEARANCE_PREFERENCE_FILE = "openbot-appearance-preference-v1.json";
const INTERFACE_SIZE_PREFERENCE_FILE = "openbot-interface-size-preference-v1.json";
const UPDATE_PREFERENCE_FILE = "openbot-update-preference-v1.json";
const NOTIFICATION_PREFERENCE_FILE = "openbot-notification-preference-v1.json";
const PUSH_NOTIFICATION_FILE = "openbot-push-notifications-v1.json";
const BUSY_MESSAGE_MODE_PREFERENCE_FILE = "openbot-busy-message-mode-v1.json";
const PROVIDER_CLI_APP_VERSION_FILE = "openbot-provider-cli-app-version-v1.json";
const AGENT_DEFAULTS_PREFERENCE_FILE = "openbot-agent-defaults-v1.json";
const AGENT_MEMORY_LIMIT_PREFERENCE_FILE = "openbot-agent-memory-limit-v1.json";
const MEMORY_REVIEW_PREFERENCE_FILE = "openbot-memory-review-v1.json";
const SERVER_TIMEZONE_PREFERENCE_FILE = "openbot-server-timezone-v1.json";
const PROMPT_CACHE_TTL_PREFERENCE_FILE = "openbot-prompt-cache-ttl-v1.json";
const REMOTE_SESSION_REUSE_PREFERENCE_FILE = "openbot-remote-session-reuse-preference-v1.json";
const EXTERNAL_LINK_PREFERENCE_FILE = "openbot-external-link-preference-v1.json";
const REMOTE_NETWORK_ROUTE_PREFERENCE_FILE = "openbot-remote-network-route-v1.json";
const APP_BEHAVIOR_PREFERENCE_FILE = "openbot-app-behavior-preference-v1.json";
const DYNAMIC_ISLAND_PREFERENCE_FILE = "openbot-dynamic-island-preference-v1.json";
const BROWSER_STATE_FILE = "openbot-browser-state-v1.json";
const SIDEBAR_LAYOUT_FILE = "openbot-sidebar-layout-v1.json";
const TEAM_FILE = "openbot-team-server-v1.json";
/** One host per account. The v1 file above stays as the last build without accounts left it. */
const TEAM_FILE_V2 = "openbot-team-server-v2.json";
const REMOTE_SERVERS_FILE = "openbot-remote-servers-v1.json";
const CENTRAL_AUTH_FILE = "openbot-central-auth-v1.bin";
const REMOTE_SESSIONS_FILE = "openbot-remote-sessions-v1.bin";
const LEGACY_REMOTE_DESKTOP_CREDENTIAL_FILE = "openbot-remote-desktop-credential-v1.json";
const REMOTE_DESKTOP_RUNTIME_SECRET_FILE = "openbot-remote-desktop-runtime-v1.json";
const CUSTOM_PROVIDERS_FILE = "openbot-custom-providers-v1.json";
const PROVIDER_CREDENTIAL_FILE = "openbot-provider-credentials-v1.json";
const MESSAGING_CREDENTIAL_FILE = "openbot-messaging-credentials-v1.json";
const INGRESS_QUEUE_KEY_FILE = "openbot-ingress-queue-key-v1.json";
/** The MCP sign-ins. Separate from the keys above: a key is typed by the user, a token is not. */
const MCP_OAUTH_FILE = "openbot-mcp-oauth-v1.json";
const MCP_OAUTH_PROXY_FILE = "openbot-mcp-oauth-proxy-v1.json";
/** The one GitHub sign-in of this computer, with the same cipher as the MCP sign-ins. */
const GITHUB_CONNECTOR_FILE = "openbot-github-connector-v1.json";
/** The 1Password service account token of this computer, with the same cipher. */
const ONEPASSWORD_CONNECTOR_FILE = "openbot-onepassword-connector-v1.json";
/** The Bitwarden API key and master password of a host connection (`bitwarden-connector-v1`), with the same cipher. */
const BITWARDEN_CONNECTOR_FILE = "openbot-bitwarden-connector-v1.json";
/** The logins, payment cards and contact info of the Vault in Server settings, with the same cipher. */
const VAULT_FILE = "openbot-vault-v1.json";
/** Which agent each imported Hermes profile made, so a second import updates that agent. */
const HERMES_IMPORT_LINKS_FILE = "openbot-hermes-imports-v1.json";

/**
 * Where each service stops, as a position in the shutdown sequence rather than a position in the
 * construction sequence. The gaps leave room to insert one without renumbering.
 */
/**
 * What the Computer Use driver is told to record as its host, for its own logs.
 *
 * Advisory only: `cua-driver` does not treat it as a trust signal, and it cannot, because any
 * process can set the variable. The development value is honest about the fact that a dev run is
 * the Electron binary - which is also the name macOS shows in the Privacy & Security panes, and the
 * reason a dev grant does not carry over to a packaged build.
 */
const PACKAGED_BUNDLE_IDENTIFIER = "app.openbot.desktop";
const DEVELOPMENT_BUNDLE_IDENTIFIER = "com.github.Electron";

const TEARDOWN_ORDER = {
  // First, so a process that the teardown ends does not count as a crash.
  resourceMonitor: 9,
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
  machineAlerts: 21,
  // Before the browser, so no sign-in opens a tab while it stops.
  providerAccountsHost: 27,
  providerHostSignIns: 28,
  mcpHostSignIns: 29,
  browser: 30,
  browserPictureInPicture: 40,
  localSignIn: 41,
  browserDock: 42,
  browserView: 45,
  providerDetection: 48,
  providerRuntimes: 50,
  cuaDriver: 55,
  /** Before the remote servers: each child detaches from its entry when it stops. */
  localServers: 57,
  remoteServers: 60,
  voice: 70,
  speech: 71,
  remoteDesktop: 80,
  // Before messaging, so no routine answer starts a post while the connections stop.
  routineResults: 84,
  // Before the host and the service: no new external message arrives while they stop.
  messaging: 85,
  hostEvents: 85.5,
  // After the connections that hold it.
  signalIngress: 86,
  host: 90,
  teamWebRtcBridge: 100,
  // Before the agent service, so no handoff is sent to an agent while the service stops.
  routineFlows: 103,
  // Before the agent service, so no workflow step is sent to an agent while the service stops.
  workflows: 103.5,
  // Before the agent service, so no calendar read finds it stopping.
  routineFeed: 104,
  mcpOAuthRedirect: 105,
  // Before the agent service. It holds no file an agent reads; only a CLI run that waits is stopped.
  onePasswordConnector: 106,
  bitwardenConnector: 106.5,
  // Before the agent service, so no agent is handed a token file that is being removed.
  githubConnector: 107,
  // Before the agent service, so no script starts a run while the service stops.
  automation: 108,
  storageUsage: 109,
  service: 110,
  mcpOAuth: 111,
  analytics: 112,
  // After all account consumers have stopped.
  centralAuth: 115,
  // After the service, so the turns that end while the services stop are still written.
  trace: 120,
  // After the service, so the lines its providers write while they stop are kept.
  providerLog: 121,
  // After the service, so a deletion that fails while the service stops is kept.
  agentLog: 122,
  // After the account, so a session write that fails while it stops is kept.
  accountLog: 123,
  // Last: every step above can still write.
  database: 130,
} as const;

export interface ApplicationServiceContext {
  /**
   * The window that exists now, by value. Anything that must survive a macOS close-and-rebuild
   * reads `windows.getMainWindow()` instead - the two type-check identically, so only the call
   * site says which one is correct.
   */
  mainWindow: BrowserWindow;
  windows: MainWindowController;
  appIconPath: string;
  appVariant: AppVariant;
  /** A local server that receives analytics in an unpackaged build. See `readAnalyticsCaptureUrl`. */
  analyticsCaptureUrl: string | null;
  developmentRemoteRole: DevelopmentRemoteRole | null;
  developmentTestClientEnabled: boolean;
  /** Set only in a hosted server VM. */
  hostedServer: HostedServerEnvironment | null;
  /** Set only in a self-hosted server that `install-server.sh` installed. */
  serverMode: ServerModeEnvironment | null;
  /** Set only by `bun run dev --hosting=test`. */
  hostingDeveloperKey: string | null;
  /** Set only in a local server that the desktop app started as its child. See `local-server-child.ts`. */
  localServerChild: LocalServerChildEnvironment | null;
  macHapticFeedback: MacHapticFeedback;
  teardown: TeardownRegistry;
  forwardCentralAuth: (state: CentralAuthState) => void;
  forwardBrowserDisplayState: (state: BrowserDisplayState) => void;
  forwardProviderRuntimeStatus: (snapshot: ProviderRuntimeSnapshot) => void;
  forwardVoiceModelStatus: (status: VoiceModelStatus) => void;
  forwardVoiceStreamTranscript: (transcript: VoiceStreamTranscript) => void;
  forwardSpeechModelStatus: (status: SpeechModelStatus) => void;
  forwardVoiceServerSettings: (settings: VoiceServerSettings | null) => void;
  forwardWorkflowNotice: (notice: WorkflowNotice) => void;
  prepareForUpdateInstall: () => Promise<void>;
  /** True once a quit starts, also before this function returns. See `CuaDriverRuntimeOptions.quitting`. */
  quitting: () => boolean;
}

/** Everything the entry point wires up, registers IPC handlers against, and shuts down. */
export interface ApplicationServices {
  service: AgentService;
  routineFlows: RoutineFlowsHandle;
  workflows: WorkflowsHandle;
  routineResults: RoutineResultsHandle;
  providerRuntimes: ProviderRuntimeManager;
  providerCredentials: ProviderCredentialStore;
  /** The Slack and Telegram connections of the agents on this host. */
  messaging: MessagingService;
  /** Reached by the entry point for one thing only: handing a returning grant to its sign-in. */
  mcpOAuth: McpOAuth;
  /** The sign-ins of joined servers that wait in this computer's browser, and the callbacks they take. */
  signInRelayClient: SignInRelayClient;
  /** The Slack and Discord installs that this computer opened for a joined server. */
  relayedMessagingInstalls: RelayedMessagingInstalls;
  githubConnector: GitHubConnectorService;
  onePasswordConnector: OnePasswordConnectorService;
  bitwardenConnector: BitwardenConnectorService;
  vault: VaultService;
  mailbox: MailboxStore;
  storageUsage: StorageUsageService;
  browser: BrowserHost;
  browserPictureInPicture: BrowserPictureInPicture;
  localSignIn: LocalSignInWindows;
  browserDock: BrowserDockOverlay;
  browserView: BrowserViewClient;
  updater: UpdateService;
  /** Point-in-time restart safety for host-managed updates. Nothing holds the instance when empty. */
  describeRestartReadiness: () => RestartReadiness;
  hostUpdateCoordinator: HostUpdateCoordinator;
  /** The update restart that an admin of a joined server asked for (`host-update-v1`). */
  requestedUpdate: RequestedUpdate;
  /** The restart that the user of this computer asked for, when no work runs. */
  idleRestart: IdleRestart;
  setupFile: string;
  analyticsPreferenceFile: string;
  updatePreferenceFile: string;
  approvalAutomation: ApprovalAutomation;
  agentAdminSettings: AgentAdminSettingsService;
  agentHostSettings: AgentHostSettingsService;
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
  agentAccess: AgentAccessStore;
  serverTimezone: ServerTimezonePreferenceStore;
  promptCacheTtl: PromptCacheTtlPreferenceStore;
  remoteSessionReuse: RemoteSessionReusePreferenceStore;
  externalLinkPreference: ExternalLinkPreferenceStore;
  externalLinks: ExternalLinkOpener;
  /** Opens a web page in the program that the user chose in Settings. */
  openLink: (url: string) => Promise<void>;
  remoteNetworkRoute: RemoteNetworkRoutePreferenceStore;
  remoteSessionCache: RemoteSessionCache;
  appBehavior: AppBehaviorService;
  agentInitialization: AgentInitializationGate<AgentLifecycleFailed>;
  sidebarLayout: SidebarLayoutStore;
  host: HostService;
  remoteDesktop: RemoteDesktopManager;
  remoteServers: RemoteServerManager;
  /** Null in a local server, in server mode and on a hosted server. */
  localServers: LocalServers | null;
  centralAuth: CentralAuthManager;
  skills: SkillMarketplaceService;
  hostedSites: HostedSiteDesktopService;
  billing: BillingDesktopService;
  license: LicenseDesktopService;
  hostedServers: HostedServerDesktopService;
  routineFeed: RoutineFeedServer;
  events: HostEventsService;
  eventsRuntime: HostEventsRuntime;
  /** The terminal control of a self-hosted server. Null in every other build. */
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
  cuaDriver: CuaDriverRuntime;
  computerUseHighlight: ComputerUseHighlightController;
  computerUsePermissionHelp: ComputerUsePermissionHelpWindowController;
  analytics: HostAnalytics;
  trace: TraceFile;
  resourceMonitor: ResourceMonitor;
  machineAlerts: MachineAlertMonitor;
  teamStore: TeamStore;
  /**
   * The account state this function read part-way through, and bound the local host to. The
   * entry point compares it against the current state to find an account that settled after
   * that read, while `forwardCentralAuth` still had no services to apply it to.
   */
  appliedAccount: CentralAuthState;
  /** Left un-awaited on purpose: the account settles in the background while the app opens. */
  centralAuthInitialization: Effect.Effect<CentralAuthState, RemoteWorkflowError>;
}

/** How the driver's own state reads as the capability the Team API projects. */
/** The Electron secret storage cipher that every encrypted file in userData uses. */
function safeStorageCipher(
  unavailableKey: "error.app.secretStorageUnavailable" | "error.app.macSecureStorageUnavailable",
) {
  return {
    canPersist: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value: string) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error(sourceText(unavailableKey));
      return safeStorage.encryptString(value);
    },
    decrypt: (value: Buffer) => safeStorage.decryptString(value),
  };
}

function computerUseCapability(state: ComputerUseState): CapabilityState {
  if (state.status === "ready") return "ready";
  if (state.status === "permissions-required") return "setup-required";
  return "unavailable";
}

/** The base cache path of electron-updater 6.8.9 (`getAppCacheDir`), which differs from Electron's. */
function electronUpdaterCacheRoot(): string {
  if (process.platform === "win32") return process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches");
  return process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
}

interface MessagingServicesContext {
  teardown: TeardownRegistry;
  secretCipher: ReturnType<typeof safeStorageCipher>;
  centralAuth: CentralAuthManager;
  service: AgentService;
  sidebarLayout: SidebarLayoutStore;
  /** Read on each call: the team store that names this host is built after messaging. */
  readHostId: () => string | null;
  openLink: (url: string) => Promise<void>;
}

/**
 * The Slack, Discord and Telegram connections. Awaited in place, so start and teardown order stay as they were
 * inline.
 */
async function createMessagingServices({
  teardown,
  secretCipher,
  centralAuth,
  service,
  sidebarLayout,
  readHostId,
  openLink,
}: MessagingServicesContext): Promise<{ messaging: MessagingService; signalIngress: SignalIngress }> {
  /*
   * The Slack workspaces, Discord guilds and Telegram chats where the agents answer. The tokens use the same cipher as every other
   * secret; an unreadable file is reported, not fatal, and each workspace then connects again.
   */
  const messagingCredentials = new MessagingCredentialStore(
    join(app.getPath("userData"), MESSAGING_CREDENTIAL_FILE),
    secretCipher,
  );
  const messagingCredentialLoadError = await Effect.runPromise(messagingCredentials.load());
  if (messagingCredentialLoadError)
    logger.warn(
      `OpenBot could not read the messaging token file (${messagingCredentialLoadError.name}). It was left unchanged.`,
    );
  // The Signal socket that brings the events of the Slack workspaces, Discord guilds and Telegram chats
  // linked to this host, and makes its Discord and Telegram calls.
  const signalIngress = new SignalIngress({
    hostId: readHostId,
    signedIn: () => {
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
    queueKey: () => loadIngressQueueKey(join(app.getPath("userData"), INGRESS_QUEUE_KEY_FILE), secretCipher),
  });
  teardown.push(TEARDOWN_ORDER.signalIngress, "the Signal ingress socket", () =>
    Effect.runPromise(signalIngress.dispose()),
  );
  // Development only: `bun run dev:slack` names this loopback port, so a Slack install returns to this
  // dev app and not to an installed OpenBot that owns `openbot://`.
  const developmentSlackCallbackPort = app.isPackaged ? 0 : Number(process.env.OPENBOT_DEV_SLACK_CALLBACK_PORT ?? 0);
  const messaging = new MessagingService({
    threads: service.messaging,
    agents: {
      listAgents: () => service.listAgents(),
      // A chat app user is not the owner, even when the owner links the chat.
      respondToApproval: (input) => service.respondToApproval(input, { owner: false }),
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
      telegramDriver({ ingress: signalIngress }),
    ],
    downloadsRoot: join(app.getPath("userData"), "messaging-downloads"),
    statusPath: join(app.getPath("userData"), "openbot-messaging-status-v1.json"),
    ingress: signalIngress,
    sidebar: sidebarLayout,
    slackApp: {
      authorize: (input) =>
        Effect.suspend(() => {
          const hostId = readHostId();
          if (!hostId)
            return Effect.fail(
              new SlackConnectFailed({ cause: new Error(sourceText("error.messaging.relayUnavailable")) }),
            );
          return centralAuth
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
          return centralAuth
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
              // The account service has no Telegram bot. The user can only wait, so they get catalog
              // text, which a joined server can show to its client.
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
  // Not awaited: a connection waits for Slack, and the app does not wait for it.
  void runCauseEffect(messaging.start()).catch((error) =>
    logger.warn("Messaging connections did not start.", toLogValue(error)),
  );
  teardown.push(TEARDOWN_ORDER.messaging, "the messaging connections", () => Effect.runPromise(messaging.stop()));
  if (developmentSlackCallbackPort > 0) {
    // As `openbot://` does for a packaged build, a finished install brings OpenBot to the front.
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
  // First, so the provider lines of the whole startup reach the file.
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
  // The store loads below with the other preferences. Until then, a page opens in the default browser.
  const externalLinks = new ExternalLinkOpener({
    preference: externalLinkPreference,
    platform: process.platform,
    openDefault: (url) => shell.openExternal(url),
    // The user clicked the link in the focused window, which can be a chat window.
    onFallback: (fallback) =>
      sendToRenderer(
        BrowserWindow.getFocusedWindow() ?? windows.getMainWindow(),
        IPC_ENDPOINTS.app.externalLinkFallback,
        fallback,
      ),
  });
  const openLink = (url: string) => runCauseEffect(externalLinks.open(url));
  // The one forward reference left in this function: the controller is built at the top of
  // startup because its window must be able to appear immediately, but the two services its
  // critical actions drive are built hundreds of lines below. A single named local rather than
  // two lazy getters, so the gap is visible and bounded.
  let criticalActionTargets: { agents: AgentService; host: HostService; remoteServers: RemoteServerManager } | null =
    null;
  const dynamicIsland = new DynamicIslandWindowController({
    platform: process.platform,
    preferencePath: join(app.getPath("userData"), DYNAMIC_ISLAND_PREFERENCE_FILE),
    createWindow: createDynamicIslandWindow,
    loadWindow: (window, display) => loadDynamicIslandRenderer(window, display, appVariant),
    getDisplays: () => screen.getAllDisplays(),
    getMainWindow: windows.getMainWindow,
    ensureMainWindow: windows.ensureMainWindow,
    presentMainWindow: showMainWindow,
    performHaptic: () => macHapticFeedback.performAlignment(),
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
  const centralAuthApiUrl = readCentralAuthApiUrl(
    process.env.OPENBOT_AUTH_API_URL,
    app.isPackaged ? "https://api.openbot.run" : "http://127.0.0.1:3100",
  );
  const centralAuth = new CentralAuthManager({
    apiUrl: centralAuthApiUrl,
    mobileConnectApiUrl: readMobileConnectApiUrl(process.env.OPENBOT_MOBILE_AUTH_API_URL, centralAuthApiUrl),
    storagePath: join(app.getPath("userData"), CENTRAL_AUTH_FILE),
    ...safeStorageCipher("error.app.macSecureStorageUnavailable"),
  });
  // Registered before `initialize()`, which publishes `{ status: "loading" }` synchronously: the
  // listener therefore runs on the next line with most of this function's services still unbuilt.
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
  // Before the agents load, so the first check of an agent that follows a default reads the saved one.
  const agentDefaults = createAgentDefaultsPreferenceStore(
    join(app.getPath("userData"), AGENT_DEFAULTS_PREFERENCE_FILE),
  );
  await runCauseEffect(agentDefaults.load());
  const store = new AgentStore(
    app.getPath("userData"),
    homedir(),
    new OpenBotDatabase(app.getPath("userData")),
    () => agentDefaults.get(),
    localServerChild?.agentRoot,
  );
  // Phase marks for `dev:bench`, so a slow start shows which group of awaits it waited on. They
  // change nothing.
  performance.mark("openbot:services.pre-store");
  await runCauseEffect(store.initialize());
  performance.mark("openbot:services.store");
  // Closing copies the write-ahead log into the database file and removes it. A step that passed its
  // limit, such as a slow agent stop, still writes, so the close waits a short time for it.
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
  await Effect.runPromise(managedSkills.syncAll(store.list()));
  await Effect.runPromise(skillCreator.syncAll(store.list()));
  await Effect.runPromise(dataSkill.syncAll(store.list()));
  performance.mark("openbot:services.skills");
  const hostedSites = new HostedSiteDesktopService(centralAuth, () => {
    // Read at request time: the team store is created later, and the server can register after launch.
    const hostId = teamStore.getIdentity()?.serverId;
    return hostId ? centralAuth.hostSiteCredential(hostId) : null;
  });
  const billing = new BillingDesktopService(centralAuth, openLink);
  const license = new LicenseDesktopService(centralAuth, openLink);
  const hostedServers = new HostedServerDesktopService(
    withHostingDeveloperKey(centralAuth, hostingDeveloperKey),
    openLink,
    Date.now,
    // A new server is running, but the joined list has no entry for it yet: read the list again.
    (serverId) => {
      if (!remoteServers.list().some((server) => server.id === serverId))
        void Effect.runPromise(remoteServers.invalidateDirectory());
    },
    (serverId, server) => remoteServers.hostedServerStarting(serverId, server),
  );
  const sidebarLayout = new SidebarLayoutStore(join(app.getPath("userData"), SIDEBAR_LAYOUT_FILE));
  await runCauseEffect(sidebarLayout.initialize());
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
  // Only a hosted, self-hosted or container server: one unit or container holds OpenBot and every
  // agent process. The desktop app does not hold turns for memory.
  const hostMemory =
    hostedServer || serverModeEnvironment
      ? new ServerMemory({
          hostedPlan: hostedServer !== null,
          onError: (message, error) => logger.warn(message, toLogValue(error)),
          onAgentProcessStopped: (stopped) =>
            logger.warn("Stopped a leftover agent process to free memory.", { ...stopped }),
        })
      : null;
  // Every provider process on a server gets the marker of leftover agent processes and the CPU limit
  // module for Node. The module must exist: Node does not start when a `--require` file is missing.
  // On the desktop it gets the marker only, so Settings › Agents can list what agents left running.
  const cpuLimitModule = app.isPackaged
    ? join(process.resourcesPath, "agent-runtime", "cpu-limit.cjs")
    : resolve(__dirname, "../../resources/agent-runtime/cpu-limit.cjs");
  const serverEnvironment = hostMemory
    ? agentProcessEnvironment(existsSync(cpuLimitModule) ? cpuLimitModule : null)
    : { [AGENT_PROCESS_VARIABLE]: "1" };
  if (hostMemory) {
    hostMemory.start();
    teardown.push(TEARDOWN_ORDER.serverMemory, "the server memory reading", () => Effect.runPromise(hostMemory.stop()));
  }
  const browserProfileStore = new BrowserProfileStore(store.database);
  const browser = new BrowserHost(mainWindow, store.downloadsRoot, join(app.getPath("userData"), BROWSER_STATE_FILE), {
    memoryLow: () => (hostMemory?.level() ?? "ok") !== "ok",
    browserProfile: (agentId) => {
      const agent = store.list().find((candidate) => candidate.id === agentId);
      return agent ? agentBrowserProfile(agent) : { kind: "shared" };
    },
    profileExists: (profileId) => browserProfileStore.get(profileId) !== undefined,
  });
  teardown.push(TEARDOWN_ORDER.browser, "the browser", () => runCauseEffect(browser.destroy()));
  await runCauseEffect(browser.restore(store.list().map((agent) => ({ id: agent.id, threadId: agent.threadId }))));
  performance.mark("openbot:services.browser");
  const browserPictureInPicture = new BrowserPictureInPicture({
    // A value, deliberately: the window this is docked to is the one that exists now. The event
    // callback below is the opposite case and re-reads, because it fires long after a macOS window
    // close and rebuild would have made this reference stale.
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
  const localSignIn = new LocalSignInWindows();
  teardown.push(TEARDOWN_ORDER.localSignIn, "the local sign-in window", () => Effect.runPromise(localSignIn.discard()));
  // A value, as for Picture in Picture: the overlay is a view in the window that the browser shows its pages in.
  const browserDock = new BrowserDockOverlay({
    mainWindow,
    preloadPath: join(__dirname, "../preload/index.cjs"),
    load: loadBrowserDockRenderer,
    forwardShortcut: (input) => browser.forwardDockShortcut(input),
  });
  browser.setMainPageListener((page) => browserDock.setPage(page));
  teardown.push(TEARDOWN_ORDER.browserDock, "the browser dock", () => {
    browser.setMainPageListener(null);
    browserDock.destroy();
  });
  browser.onChanged((tabs, activeTabId) => forwardBrowserDisplayState({ tabs, activeTabId }));
  const setupFile = join(app.getPath("userData"), SETUP_FILE);
  const analyticsPreferenceFile = join(app.getPath("userData"), ANALYTICS_PREFERENCE_FILE);
  const updatePreferenceFile = join(app.getPath("userData"), UPDATE_PREFERENCE_FILE);
  const routineHoldFile = join(app.getPath("userData"), ROUTINE_HOLD_FILE);
  const setupState = await runCauseEffect(readSetupState(setupFile));
  const analyticsPreference = await Effect.runPromise(readAnalyticsPreference(analyticsPreferenceFile));
  // Loaded before the first window and before the application menu is built, so every native
  // surface draws in the saved language on the first frame rather than switching after startup.
  const language = new LanguageService({
    path: join(app.getPath("userData"), LANGUAGE_PREFERENCE_FILE),
    systemLocale: app.getLocale(),
  });
  await runCauseEffect(language.load());
  const logoColor = new LogoColorService({ path: join(app.getPath("userData"), LOGO_COLOR_PREFERENCE_FILE) });
  await runCauseEffect(logoColor.load());
  // Before the renderer loads, so the window background takes the saved colors.
  const appearance = new AppearanceService({
    path: join(app.getPath("userData"), APPEARANCE_PREFERENCE_FILE),
    supportsTransparentWindow: process.platform === "darwin",
  });
  await runCauseEffect(appearance.load());
  // Before the renderer loads, so its first navigation applies the saved size.
  const interfaceSize = new InterfaceSizeService({
    path: join(app.getPath("userData"), INTERFACE_SIZE_PREFERENCE_FILE),
  });
  await runCauseEffect(interfaceSize.load());
  const notificationPreference = new NotificationPreferenceStore(
    join(app.getPath("userData"), NOTIFICATION_PREFERENCE_FILE),
  );
  await runCauseEffect(notificationPreference.load());
  const busyMessageMode = new BusyMessageModePreferenceStore(
    join(app.getPath("userData"), BUSY_MESSAGE_MODE_PREFERENCE_FILE),
  );
  await runCauseEffect(busyMessageMode.load());
  const agentMemoryLimit = new AgentMemoryLimitPreferenceStore(
    join(app.getPath("userData"), AGENT_MEMORY_LIMIT_PREFERENCE_FILE),
  );
  await runCauseEffect(agentMemoryLimit.load());
  const memoryReview = new MemoryReviewPreferenceStore(join(app.getPath("userData"), MEMORY_REVIEW_PREFERENCE_FILE));
  await runCauseEffect(memoryReview.load());
  const agentAccess = new AgentAccessStore(join(app.getPath("userData"), AGENT_ACCESS_FILE));
  if (!(await runCauseEffect(agentAccess.load())))
    logger.warn("The roles file did not load. Members get no access to agents until an admin saves the roles.");
  const serverTimezone = new ServerTimezonePreferenceStore(
    join(app.getPath("userData"), SERVER_TIMEZONE_PREFERENCE_FILE),
  );
  await runCauseEffect(serverTimezone.load());
  const promptCacheTtl = new PromptCacheTtlPreferenceStore(
    join(app.getPath("userData"), PROMPT_CACHE_TTL_PREFERENCE_FILE),
  );
  await runCauseEffect(promptCacheTtl.load());
  const remoteSessionReuse = createRemoteSessionReusePreferenceStore(
    join(app.getPath("userData"), REMOTE_SESSION_REUSE_PREFERENCE_FILE),
  );
  await runCauseEffect(remoteSessionReuse.load());
  await runCauseEffect(externalLinkPreference.load());
  const remoteNetworkRoute = createRemoteNetworkRoutePreferenceStore(
    join(app.getPath("userData"), REMOTE_NETWORK_ROUTE_PREFERENCE_FILE),
  );
  await runCauseEffect(remoteNetworkRoute.load());
  const appBehavior = new AppBehaviorService({
    path: join(app.getPath("userData"), APP_BEHAVIOR_PREFERENCE_FILE),
    loginItem: createLoginItem({
      appVariant,
      server: Boolean(hostedServer || serverModeEnvironment || localServerChild),
    }),
    offersBackground: process.platform !== "darwin" && !hostedServer && !serverModeEnvironment && !localServerChild,
    offersKeepAwake: process.platform !== "linux" && !hostedServer && !serverModeEnvironment && !localServerChild,
  });
  await runCauseEffect(appBehavior.load());
  void Effect.runPromise(appBehavior.refreshLoginItem()).catch((error) =>
    logger.warn("The login item did not refresh.", toLogValue(error)),
  );
  const remoteSessionCache = new RemoteSessionCache({
    path: join(app.getPath("userData"), REMOTE_SESSIONS_FILE),
    enabled: remoteSessionReuse.get().keepBetweenRuns,
    ...safeStorageCipher("error.app.macSecureStorageUnavailable"),
  });
  // A kept session is useless without an account, and it names the last one. The listener also
  // covers a sign-out that settles before the remote services exist.
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
  /*
   * The installed CLIs are the computer's, the partial downloads are this profile's.
   *
   * Development gives every renderer port and every `--isolated` worktree a `userData` of its own,
   * so a store kept there started empty each time: OpenBot fell back to the user's own CLI, offered
   * the pinned version against it, and downloaded 144 MB again for a profile that would be replaced
   * by the next port. The packaged app's `userData` is `appData/OpenBot` already, so the shared
   * store is the path it always used. The switch is read here rather than imported from the entry
   * point, which this file may not reach into; both readers read the same immutable value.
   */
  const providerUse = new ProviderUseSettingsStore(join(app.getPath("userData"), "openbot-provider-use-v1.json"));
  await runCauseEffect(providerUse.load());
  const providerAccounts = new ProviderAccountStore(
    join(app.getPath("userData"), "openbot-provider-accounts-v1.json"),
    join(app.getPath("userData"), "provider-accounts"),
  );
  await runCauseEffect(providerAccounts.load());
  const providerCliAppVersion = createProviderCliAppVersionStore(
    join(app.getPath("userData"), PROVIDER_CLI_APP_VERSION_FILE),
  );
  await runCauseEffect(providerCliAppVersion.load());
  // A server on this computer has its own user data, but uses the CLI store of the app that started it.
  const providerRuntimesRoot =
    localServerChild?.runtimeRoot ??
    providerRuntimeRoot({
      appData: app.getPath("appData"),
      userDataOverride: app.commandLine.getSwitchValue("user-data-dir"),
    });
  const providerRuntimes = new ProviderRuntimeManager({
    isProviderOn: (provider) => !providerUse.off().includes(provider),
    root: providerRuntimesRoot,
    downloadRoot: join(app.getPath("userData"), "provider-runtimes", ".downloads"),
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
  teardown.push(TEARDOWN_ORDER.providerRuntimes, "the provider runtimes", () =>
    runCauseEffect(providerRuntimes.stop()),
  );
  // Before `new AgentService`, which reads every `executablePath` eagerly.
  await runCauseEffect(providerRuntimes.initialize());
  const secretCipher = safeStorageCipher("error.app.secretStorageUnavailable");
  const customProviders = new CustomProviderStore({
    path: join(app.getPath("userData"), CUSTOM_PROVIDERS_FILE),
    cipher: secretCipher,
  });
  // Before the service, which reads the endpoints at its first provider spawn. A file this build
  // cannot read leaves the list empty and every write refused; it does not stop the app.
  await runCauseEffect(customProviders.load());
  // The same reasons as the endpoints: before the service, and a file this build cannot read only
  // refuses the writes.
  const customAgents = new CustomAgentStore({
    path: join(app.getPath("userData"), CUSTOM_AGENTS_FILE),
    cipher: secretCipher,
  });
  await runCauseEffect(customAgents.load());
  const providerDetectionSettings = new ProviderDetectionSettingsStore(
    join(app.getPath("userData"), PROVIDER_DETECTION_SETTINGS_FILE),
  );
  performance.mark("openbot:services.preferences");
  await runCauseEffect(providerDetectionSettings.load());
  const providerDetection = await Effect.runPromise(
    createProviderDetection({
      settings: providerDetectionSettings,
      customProviders,
      customAgents,
    }),
  );
  teardown.push(TEARDOWN_ORDER.providerDetection, "model server discovery", () =>
    Effect.runPromise(providerDetection.close()),
  );
  /*
   * Loaded before the service, not on first use: a provider spawn reads its key synchronously, so
   * the decrypted map has to already exist by the time any client is built. A machine with no
   * secret storage keeps working on the free tier -- only saving a key needs the cipher.
   */
  const providerCredentials = new ProviderCredentialStore(
    join(app.getPath("userData"), PROVIDER_CREDENTIAL_FILE),
    secretCipher,
  );
  // An unreadable key file is reported, not fatal: the app starts, OpenCode runs on the free models,
  // and Settings tells the user to save the key again. Only the error's class is logged, because a
  // parse message quotes the file.
  performance.mark("openbot:services.provider-detection");
  const credentialLoadError = await Effect.runPromise(providerCredentials.load());
  if (credentialLoadError) {
    logger.warn(`OpenBot could not read the provider key file (${credentialLoadError.name}). It was left unchanged.`);
  }
  /*
   * The MCP sign-ins, in their own file with the same cipher. `mcp-remote` used to keep these where
   * OpenBot could not redact them; here they are covered by the same rule as every other secret.
   *
   * Unreadable is not fatal, for the same reason as the keys above: every signed-in server asks for
   * a sign-in again, and nothing else on this machine stops working.
   */
  const mcpOAuthStore = new McpOAuthStore(join(app.getPath("userData"), MCP_OAUTH_FILE), secretCipher);
  const mcpOAuthLoadError = await Effect.runPromise(mcpOAuthStore.load());
  if (mcpOAuthLoadError) {
    logger.warn(`OpenBot could not read the MCP sign-in file (${mcpOAuthLoadError.name}). It was left unchanged.`);
  }
  // The OAuth proxy port, so a Codex session resumed after a restart reaches the same address.
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
  /*
   * Where a returning grant lands. The loopback listener is the address RFC 8252 gives a native
   * app and the only one some authorization servers accept - Canva refuses `openbot://mcp-auth`
   * on its own authorization page, where OpenBot cannot see the failure or explain it.
   *
   * A port that cannot be bound is not fatal: the deep link is still registered with the
   * operating system, and the servers that accept it keep working. It is logged because it
   * decides which address every later sign-in registers, and a sign-in that a server then
   * refuses is otherwise a mystery in a support thread.
   */
  // The listener is bound before the authority that answers it exists, and a request can arrive
  // in between - a browser tab left open on a previous run reaches this port on its own. It is
  // held rather than closed over, so that request is refused instead of raising in the listener.
  let mcpOAuthAuthority: McpOAuth | null = null;
  // A joined server's sign-in can send its callback to this same port: the host's own listener
  // uses the same port number. A `state` that no local sign-in started goes to the relay.
  const signInRelayClient = new SignInRelayClient({
    openExternal: openLink,
    language,
    ownListener: () =>
      mcpOAuthRedirect
        ? { port: Number(new URL(mcpOAuthRedirect.redirectUrl).port), path: MCP_OAUTH_REDIRECT_PATH }
        : null,
  });
  performance.mark("openbot:services.mcp-sign-in-file");
  const mcpOAuthRedirect = await startMcpOAuthRedirectServer({
    language,
    preferredPort: MCP_OAUTH_REDIRECT_PORT,
    deliver: (state, code, query) => {
      const elsewhere = mcpOAuthAuthority?.openedElsewhere(state) ?? false;
      if (!mcpOAuthAuthority?.receiveAuthorizationCode(state, code))
        return signInRelayClient.deliver(state, query) ? "relayed" : false;
      if (elsewhere) return true;
      const current = windows.getMainWindow();
      if (current && !current.isDestroyed()) showMainWindow(current);
      return true;
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
    logger: createOpenBotLogger("mcp-oauth"),
  });
  mcpOAuthAuthority = mcpOAuth;
  teardown.push(TEARDOWN_ORDER.mcpOAuth, "MCP token refresh", () => Effect.runPromise(mcpOAuth.close()));
  /*
   * The built-in GitHub connection. Loaded before the agent service, because the first spawn reads
   * its MCP server and its `gh` and `git` files. An unreadable file is logged by the service and
   * treated as no sign-in.
   */
  const githubConnector = new GitHubConnectorService({
    app: githubAppConfig(),
    store: new GitHubConnectorStore(join(app.getPath("userData"), GITHUB_CONNECTOR_FILE), secretCipher),
    toolDirectory: join(app.getPath("userData"), "provider-state", "github"),
    apiUrl: centralAuthApiUrl,
    openExternal: openLink,
  });
  await runCauseEffect(githubConnector.load());
  teardown.push(TEARDOWN_ORDER.githubConnector, "the GitHub connection", () =>
    runCauseEffect(githubConnector.dispose()),
  );
  /*
   * The Bitwarden connection. A host connection's API key and master password are stored, so the
   * host unlocks again after a restart; its CLI data and OpenBot's copy of `bw` stay outside every
   * root an agent can write.
   */
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

  /*
   * The Vault in Server settings. Every agent fills its logins, cards and contact info; the file
   * holds no resource, so nothing is torn down.
   */
  const vault = new VaultService({
    store: new VaultStore(join(app.getPath("userData"), VAULT_FILE), secretCipher),
    canPersist: secretCipher.canPersist,
  });
  await Effect.runPromise(vault.load());

  /*
   * The 1Password connection. The browser fills logins from it, so the agent service reads it. The
   * login list is read from 1Password in the background; startup does not wait for it.
   */
  const onePasswordCliTarget = runtimeTarget(process.platform, process.arch);
  const onePasswordConnector = new OnePasswordConnectorService({
    store: new OnePasswordConnectorStore(join(app.getPath("userData"), ONEPASSWORD_CONNECTOR_FILE), secretCipher),
    hostName: hostname(),
    appVersion: app.getVersion(),
    // Outside every root an agent can write, like the GitHub tool files.
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
  // Read by the resource monitor, which starts after the analytics that needs the services.
  const statementTimings = new StatementTimings();
  const tables = new AgentTables({
    sharedRoot: store.sharedRoot,
    supervisor: new AgentDatabaseSupervisor({
      spawnHost: spawnAgentDatabaseHost,
      onStatementSettled: (durationMs) => statementTimings.record(durationMs),
    }),
  });
  // Looked up again on demand, because a user may install the driver while OpenBot runs, and the
  // panel's "Check again" has to see it.
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
    // Linux ships as an AppImage, whose mount is somewhere else at each launch, so the command the
    // proxies are given is a link below the profile rather than the path inside the mount.
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
  // After the provider runtimes, which hold the `cua-driver mcp` children that talk to this
  // daemon: stopping it first would leave them reading a socket nothing answers.
  teardown.push(TEARDOWN_ORDER.cuaDriver, "the Computer Use driver", () => runCauseEffect(cuaDriver.stop()));
  /*
   * The rim OpenBot draws over the window an agent works in.
   *
   * It asks the daemon two read-only questions over a connection of its own: whether any agent
   * holds a live session, and where every window is. Both answers come from the daemon's own view,
   * which an MCP client of OpenBot's could not see: the tools report only the sessions of the lease
   * that asks, and the agent's lease is its own.
   */
  const computerUseReads = new CuaDriverDaemonClient(() =>
    cuaDriver.mcpServerForProviders() ? cuaDriver.socketPath() : null,
  );
  const computerUseHighlight = new ComputerUseHighlightController({
    createWindow: createComputerUseHighlightWindow,
    loadWindow: loadComputerUseHighlightRenderer,
    place: sendComputerUseHighlightPlacement,
    displays: computerUseDisplays,
    // The driver's own cursor on one screen, OpenBot's inside this overlay on more than one. The
    // runtime answers `null` for the screen it draws itself, so only one cursor is ever drawn.
    readPointer: () => {
      const pointer = cuaDriver.lastPointer(COMPUTER_USE_CURSOR_MAX_AGE_MS);
      return pointer ? computerUseDesktopPoint(pointer) : null;
    },
    readTarget: (previous) =>
      Effect.gen(function* () {
        if (!cuaDriver.mcpServerForProviders()) return null;
        // The rim marks work in progress, so it goes down with the last turn: completed, failed or
        // cancelled. The driver's lease outlives the turn, so only an action made while a turn that
        // still runs was running counts: a lease left by the turn before would put the rim over a
        // turn that does not touch the desktop. Neither a lease nor an action names its agent, so the
        // oldest running turn is the bound: a newer turn of another agent does not hide this one's
        // rim. `service` is built below; the controller starts only after it.
        const turnStartedAt = service.earliestRunningTurnStartedAt();
        if (turnStartedAt === null) return null;
        const session = liveSession(yield* computerUseReads.sessions(), (Date.now() - turnStartedAt) / 1000);
        if (!session) return null;
        const windows = yield* computerUseReads.listWindows();
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
  // Before the daemon stops, so the rim is gone rather than left over a window nothing drives, and
  // so the read connection lets its lease go while there is still a daemon to tell.
  teardown.push(TEARDOWN_ORDER.computerUseHighlight, "the Computer Use highlight", async () => {
    computerUseHighlight.destroy();
    await Effect.runPromise(computerUseReads.close());
  });
  // The overlays are OpenBot windows, so they can mark only the display OpenBot is on. With an agent
  // display of its own, the driver works where they cannot be drawn.
  const drawsComputerUseHighlight = !hasSeparateAgentDisplay(process.platform);
  const computerUsePermissionHelp = new ComputerUsePermissionHelpWindowController({
    createWindow: () => createComputerUsePermissionHelpWindow(language.translate),
    loadWindow: loadComputerUsePermissionHelpRenderer,
    // The bundle that owns this process, which is the one macOS attributes every click and capture
    // to. In a development build that is Electron itself, and the window says so.
    bundlePath: () => applicationBundlePath(app.getPath("exe"), process.platform),
    // `large` is 32 points, which is the size a drag image is drawn at.
    // Read out of the bundle rather than asked of macOS: `app.getFileIcon` ends the main process
    // on this Electron. The app's own icon stands in for a bundle that carries none, because a drag
    // with no image is refused and would leave the user with a card that does nothing.
    bundleIcon: async (path) => {
      const resources = join(path, "Contents", "Resources");
      const names: string[] = await readdir(resources).catch(() => []);
      const iconName = applicationIconName(path, names);
      const icon = iconName ? nativeImage.createFromPath(join(resources, iconName)) : nativeImage.createEmpty();
      // A bundle icon is drawn at up to 1024 points, and a drag carries the image at its own size:
      // unresized it covers the pane the user is dragging onto.
      return (icon.isEmpty() ? nativeImage.createFromPath(appIconPath) : icon).resize({ width: 32, height: 32 });
    },
    revealPath: (path) => shell.showItemInFolder(path),
  });
  // An always-on-top window that outlived the quit would be the last thing on the desktop.
  teardown.push(TEARDOWN_ORDER.computerUsePermissionHelp, "the Computer Use permission help", () => {
    computerUsePermissionHelp.close();
  });
  // Windows only: there the Antigravity server unpacks about 310 MB at each start, and the process
  // tree stop ends every command it started, so none outlives its folder. Elsewhere the system
  // folder stays: a macOS path in userData has a space and is too long for a Unix socket.
  const providerTempDirectory = join(app.getPath("userData"), "provider-temp");
  performance.mark("openbot:services.computer-use");
  if (process.platform === "win32") await Effect.runPromise(sweepProviderTemp(providerTempDirectory));
  // Outside every workspace. Each saved key is masked in the logs before the first agent starts. The
  // Vault's keys are written only when an agent lists its keys; a file left from the last run that the
  // Vault no longer holds is removed here.
  const agentApiKeys = new AgentApiKeys(join(app.getPath("userData"), "agent-api-keys"), () => vault.items.apiKeys());
  await Effect.runPromise(agentApiKeys.registerSaved());
  await Effect.runPromise(agentApiKeys.syncVault().pipe(Effect.ignore));
  // The schedule triggers of workflows share the routine timer; built after the workflows below.
  let workflowTriggers: WorkflowTriggers | null = null;
  const service: AgentService = new AgentService({
    store,
    mailbox,
    browser,
    visualPreview: new ChatVisualPreviewer(),
    prepareMcpTest: (config) =>
      prepareToolRuntimeForTest(config, {
        startToolRuntimes: () => {
          Effect.runFork(providerRuntimes.ensureToolRuntimes());
        },
        ensureToolRuntimesReady: () => providerRuntimes.ensureToolRuntimesReady(),
        toolRuntimes: () => providerRuntimes.mcpToolRuntimes(),
      }),
    // `desktopCapturer` captures the display OpenBot is on. With an agent display of its own, that
    // is only the OpenBot window, so agents take their screenshots with the Computer Use driver.
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
    requestTimeoutMs: 30_000,
    offProviders: providerUse.off(),
    providerAccounts,
    saveProviderUse: (provider, on) =>
      providerUse.set(provider, on).pipe(
        Effect.tap(() => providerRuntimes.providerUseChanged()),
        Effect.mapError((error) => new AgentLifecycleFailed({ operation: "saveProviderUse", cause: error.cause })),
      ),
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
    preferredModel: setupState.preferredModel,
    // Only a dev build leads with the OpenCode development model; a packaged app keeps the
    // built-in default.
    developmentDefaults: appVariant === "dev",
    credentials: {
      apiKey: (provider) => providerCredentials.get(provider),
      // Read at each Claude spawn, so a change from Server settings applies to the next process.
      promptCacheTtl: () => promptCacheTtl.get().ttl,
      // `configs()`, not `list()`: this is the one path the API keys travel, and it ends at the
      // spawned provider process. The IPC handlers are given `list()`.
      customProviders: () => customProviders.configs(),
      // The same rule: `configs()`, with the environment values, goes to the agent process only.
      customAgents: () => customAgents.configs(),
      // The enabled MCP servers, read at each spawn. The service owns the store, so this reads back
      // into the object being constructed; nothing calls it before the constructor returns.
      mcpServers: () => service.enabledMcpServers(),
      // The floor under those servers: the `bin` of every managed tool runtime, appended after the
      // user's own `PATH`, so a machine with no Node can still start `npx some-server` and a machine
      // that has one keeps the build it installed.
      mcpToolRuntimes: () => providerRuntimes.mcpToolRuntimes(),
      // The sign-ins of the http servers. The service hands a provider a route of its OAuth proxy,
      // never the token; only a test the user pressed may open a browser.
      mcpOAuth,
      mcpOAuthProxySettings,
      appVersion: app.getVersion(),
      providerStateDirectory: join(app.getPath("userData"), "provider-state"),
      ...(process.platform === "win32" ? { providerTempDirectory } : {}),
      serverEnvironment,
      // The GitHub entries are paths only: `gh` and `git` read the token from the files the connection
      // keeps current. On a server with an agent display, `DISPLAY` names it, so a program an agent
      // starts opens where the driver sees it.
      agentEnvironment: (inherited) => ({
        ...agentDisplayEnvironment(process.platform),
        ...githubConnector.agentEnvironment(inherited),
      }),
    },
    // Appended to the stored servers at each spawn, so the same tools reach Codex, Claude and the
    // ACP providers. Null until the daemon runs, which is what keeps a machine with no driver from
    // handing every provider a command it cannot start.
    computerUseMcpServer: () => cuaDriver.mcpServerForProviders(),
    githubConnector: {
      mcpServer: () => githubConnector.mcpServer(),
      mcpAuthorization: () => githubConnector.mcpAuthorization().pipe(toMcpGatewayFailed),
    },
    passwordVault: passwordVaultRouter([
      { prefix: "", vault: onePasswordConnector },
      { prefix: "bitwarden:", vault: bitwardenConnector },
      { prefix: "openbot:", vault: vault.logins },
    ]),
    vaultItems: vault.items,
    agentApiKeys,
    localSkillTools: () => localSkillTools(skills),
    routineFlowTools: () => routineFlowRuntime,
    // `events` is built later, after the account service and the relay.
    webhookRoutines: () => agentWebhookRoutineWriter(events),
    approvalAutomation,
    busyMessageMode: () => busyMessageMode.get().mode,
    agentMemoryLimit: () => agentMemoryLimit.get().limit,
    memoryReviewInterval: () => memoryReview.get().interval,
    timezone: () => serverTimezone.effective(),
    // `workflowTriggers` is built later, after the workflows.
    extraRoutineSources: () => (workflowTriggers ? [workflowTriggers] : []),
    // `host` is built later, after the agent service; a channel tool reads it when it runs.
    channelPersonAgentLevel: (personId, agentId) => host.channelPersonAgentLevel(personId, agentId),
    channelRemotePerson: (personId) => host.channelPersonIsRemote(personId),
    // The delete also clears the agent from workflow nodes, so the editors of those workflows load
    // the new graph. `workflowStore` is built later, after the agent service.
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
  const agentMemoryLimitSetting = reloadingAgentMemoryLimit(agentMemoryLimit, service);
  /** The answer an agent gave in one turn, for routine flows, routine results and local scripts. */
  const turnAnswer = (agentId: string, turnId: string): string | null => {
    const threadId = store.list().find((agent) => agent.id === agentId)?.threadId;
    if (!threadId) return null;
    return latestTurnAnswer(store.database.readTurnAssistantMessages(agentId, threadId, turnId), turnId)?.text ?? null;
  };
  // Listens only while an agent allows local scripts; see `AutomationServer`.
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
  // An agent routine's answer handed on from agent to agent; see `routine-flows.ts`.
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
      // An agent event, so this window, joined clients and the web app hear it the same way.
      changed: (agentIds) => {
        for (const agentId of agentIds) service.notifyRoutineFlowsChanged(agentId);
      },
    }),
  );
  teardown.push(TEARDOWN_ORDER.routineFlows, "the routine flows", () => Effect.runPromise(routineFlowRuntime.close()));
  // Graphs of steps drawn on a canvas; see `workflows.ts`.
  const workflowStore = new WorkflowStore({
    database: store.database,
    nextDueAt: workflowScheduleDueAt(() => serverTimezone.effective()),
  });
  const workflowRuntime = await Effect.runPromise(
    createWorkflows({
      store: workflowStore,
      runs: new WorkflowRunStore({ database: store.database }),
      delivery: (deliveryId) => {
        const found = mailbox.getDelivery(deliveryId)?.delivery;
        return found ? { status: found.status, turnId: found.turnId, error: found.error } : null;
      },
      turnAnswer,
      // A workflow step is a routine handoff whose routine is the workflow.
      sendHandoff: (input) => service.enqueueRoutineHandoff(input),
      stopDelivery: (agentId, deliveryId) => {
        const found = mailbox.getDelivery(deliveryId)?.delivery;
        if (!found) return Effect.void;
        return found.status === "running" && found.turnId
          ? service.interrupt(agentId, found.turnId)
          : service.cancelQueuedMessage(agentId, deliveryId);
      },
      generateText: (request) =>
        service.generateWorkflowText(request).pipe(
          Effect.mapError((failure) => ({
            message: failure.cause instanceof Error ? failure.cause.message : sourceText("error.workflow.modelFailed"),
          })),
        ),
      notify: forwardWorkflowNotice,
      connectionOn: (connectionId) => service.messaging.store.connection(connectionId)?.enabled === true,
      post: (connectionId, placeId, markdown) => service.messaging.deliver(connectionId, placeId, markdown),
      // An agent event, so this window, joined clients and the web app hear it the same way.
      changed: (workflowId) => service.notifyWorkflowsChanged(workflowId),
      rearm: () => service.armRoutines(),
      timezone: () => serverTimezone.effective(),
      runEnded: (end) => service.notifyWorkflowRunEnded(end),
    }),
  );
  workflowTriggers = new WorkflowTriggers({
    store: workflowStore,
    timezone: () => serverTimezone.effective(),
    start: (start) => workflowRuntime.startScheduled(start),
    changed: (workflowId) => service.notifyWorkflowsChanged(workflowId),
  });
  service.armRoutines();
  // An agent event too, so joined admins and the web app read the Vault again. It carries no item.
  vault.onChanged(() => service.notifyVaultChanged());
  // A changed or deleted Vault API key reaches the file that an agent reads at once.
  vault.onChanged(() => void Effect.runPromise(agentApiKeys.syncVault().pipe(Effect.ignore)));
  teardown.push(TEARDOWN_ORDER.workflows, "the workflows", () => Effect.runPromise(workflowRuntime.close()));
  // An agent routine's answer sent on to a messaging place; see `routine-results.ts`.
  const routineResultRuntime = await Effect.runPromise(
    createRoutineResults({
      store: new RoutineResultStore(store.database),
      delivery: (deliveryId) => {
        const found = mailbox.getDelivery(deliveryId)?.delivery;
        return found ? { turnId: found.turnId } : null;
      },
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
    Effect.runFork(routineFlowRuntime.notice(event));
    Effect.runFork(routineResultRuntime.notice(event));
    Effect.runFork(workflowRuntime.notice(event));
  });
  teardown.push(TEARDOWN_ORDER.routineResults, "the routine results", () =>
    Effect.runPromise(routineResultRuntime.close()),
  );
  // Listens only after the user turns the feed on in Server Settings > Routines.
  const routineFeed = new RoutineFeedServer({
    path: join(app.getPath("userData"), ROUTINE_FEED_FILE),
    cipher: secretCipher,
    document: localRoutineFeedDocument(service, language.translate),
  });
  await Effect.runPromise(routineFeed.start());
  teardown.push(TEARDOWN_ORDER.routineFeed, "the routine feed", () => Effect.runPromise(routineFeed.stop()));
  // The host id is read when the Signal socket opens, and the team store is built further down, so
  // it starts as "no name yet".
  let ingressHostId: () => string | null = () => null;
  performance.mark("openbot:services.routines");
  const { messaging, signalIngress } = await createMessagingServices({
    teardown,
    secretCipher,
    centralAuth,
    service,
    sidebarLayout,
    readHostId: () => ingressHostId(),
    openLink,
  });
  // A connect, a disconnect or an expiry changes the tools and the `gh` sign-in of every agent.
  githubConnector.onAgentAccessChanged(() => {
    void runCauseEffect(service.notifyGitHubConnectorChanged()).catch((error) =>
      logger.warn("Provider tools did not refresh.", toLogValue(error)),
    );
  });
  // The capability and the tool list both follow the daemon, and nothing else can tell them: no
  // provider probe reaches the driver, because the driver is this process's child.
  // The held state first: the providers start at `unavailable`, and a listener hears only what
  // changes, so a computer that has the driver and neither grant would keep reporting a driver it
  // has until a grant moved.
  service.setComputerUseCapability(computerUseCapability(cuaDriver.lastState));
  cuaDriver.onStateChanged((state) => service.setComputerUseCapability(computerUseCapability(state)));
  // Only when a live session would hold the wrong tool set: this deactivates every agent's stored
  // provider session, so the driver stays quiet for a grant, for the warm-up below, and from the
  // moment OpenBot quits, where the sessions are being left for the next run.
  cuaDriver.onMcpServerChanged(() => {
    void runCauseEffect(service.notifyComputerUseChanged()).catch((error) =>
      logger.warn("Provider tools did not refresh.", toLogValue(error)),
    );
  });
  // The rim follows the daemon: it can show nothing while the agents hold no tools, and polling a
  // socket nothing answers would only log failures.
  cuaDriver.onMcpServerChanged(() => {
    if (cuaDriver.mcpServerForProviders()) {
      if (drawsComputerUseHighlight) computerUseHighlight.start();
    } else {
      computerUseHighlight.stop();
      // The daemon this connection was opened to is gone, so the socket behind it is too.
      void Effect.runPromise(computerUseReads.close());
    }
  });
  // A user who granted the permissions expects the tools after a restart without opening the panel,
  // and a remote request or a scheduled task opens no window at all. This starts the daemon once and
  // keeps it only when the grants are there; it raises no prompt, so a user who granted nothing sees
  // nothing. It also tells no listener, because the sessions read back from the database were
  // written by a run that had this same entry.
  //
  // The warm-up tells no listener on purpose, so the rim has to read the result itself: a user who
  // granted the permissions has a running daemon from here on, and nothing else would start it.
  // The fiber ends with an exit rather than a failure, because agent initialization waits for it
  // whether it worked or not.
  const computerUseWarmUp = Effect.runFork(
    cuaDriver.warmUp().pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          if (drawsComputerUseHighlight && cuaDriver.mcpServerForProviders()) computerUseHighlight.start();
        }),
      ),
      Effect.exit,
    ),
  );
  /*
   * Where the decision put the download: onboarding, which is the screen this start is about to
   * show. A user who finished onboarding before OpenBot downloaded a runtime at all is asked for
   * one here too, but only when this machine already has an MCP server to start.
   *
   * Nothing waits for it and nothing reports it. MCP is optional, so a failed download must not
   * reach onboarding; a server that cannot start is reported at hand-off like any other.
   */
  if (!setupState.completed || service.enabledMcpServers().length > 0)
    Effect.runFork(providerRuntimes.ensureToolRuntimes());
  // After `new AgentService`, which owns the channels: the layout files channels beside agents, and
  // reconciling against the agents alone would read every channel as gone and drop where it sits.
  performance.mark("openbot:services.messaging");
  await runCauseEffect(sidebarLayout.reconcileAgents(service.sidebarChatIds()));

  /*
   * The runtime manager decides which provider has an update waiting, by comparing against the
   * latest upstream release. It knows the copies it downloaded itself; a CLI the user installed is
   * only ever reported in the agent status, so it is passed on from here. Its update offer installs
   * a managed copy and leaves the system installation untouched.
   */
  const trackSystemCliVersions = (status: AgentStatus): void => {
    for (const provider of status.providers ?? []) {
      const version = provider.cliSource === "system" ? (provider.version ?? null) : null;
      if (isManagedRuntimeProvider(provider.id)) providerRuntimes.setSystemVersion(provider.id, version);
    }
  };
  trackSystemCliVersions(service.getStatus());
  service.on("event", (event) => {
    if (event.type === "status") trackSystemCliVersions(event.status);
  });
  providerRuntimes.on("status", forwardProviderRuntimeStatus);
  // After the status forward, so the offer a check finds reaches the renderer.
  const appUpgraded = providerCliAppVersion.get().appVersion !== app.getVersion();
  providerRuntimes.startUpdateChecks({ updateInstalled: appUpgraded });
  if (appUpgraded)
    void runCauseEffect(providerCliAppVersion.set({ appVersion: app.getVersion() })).catch((error) =>
      logger.warn("The provider CLI app version did not save.", toLogValue(error)),
    );
  // A tool runtime that becomes ready changes what the MCP servers resolve to, for every
  // provider: sessions that dropped their stdio servers before it finished downloading are
  // marked for refresh, and the deferred mechanism spends the mark before each agent's next
  // turn. Provider CLI updates change no MCP resolution, so only tool runtimes refresh.
  providerRuntimes.on("ready", (runtime) => {
    if (isManagedToolRuntime(runtime)) Effect.runFork(service.refreshAllAgentRuntimes());
  });
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
  };
  const storageUsage = new StorageUsageService(new StorageUsageScanner(storageSources), storageSources);
  teardown.push(TEARDOWN_ORDER.storageUsage, "storage scans", () => Effect.runPromise(storageUsage.dispose()));
  // A deleted or renamed agent changes every scope, so no surface keeps its old answer.
  service.on("event", (event) => {
    if (event.type === "agents-changed") storageUsage.invalidate();
  });
  // A grant changed on this computer must reach the phones and web clients that show it.
  approvalAutomation.subscribe(() => service.notifyAgentsChanged());
  const skills = new SkillMarketplaceService(
    centralAuth,
    () => service.listAgents(),
    // Every skill change ends here: install, update, uninstall, turning one on or off, and a skill
    // an agent creates. The event reaches this computer's windows and the joined clients.
    (agentId) =>
      service
        .refreshAgentRuntime(agentId)
        .pipe(Effect.ensuring(Effect.sync(() => service.notifySkillsChanged(agentId)))),
    new LocalSkillLibrary(join(app.getPath("userData"), "local-skills"), () => service.listAgents()),
  );
  const marketplaceAgents = new AgentMarketplaceService(centralAuth, service, skills);
  const agentTemplates = new AgentTemplateService(centralAuth, service, {
    listTemplateSkills: (agentId) => skills.listTemplateSkills(agentId),
    installVersion: (input) => skills.installVersion(input),
    library: () => skills.requireLocalLibrary(),
    installLocal: (input) => skills.installLocal(input),
  });
  const teamStore = new TeamStore(
    join(app.getPath("userData"), TEAM_FILE_V2),
    join(app.getPath("userData"), TEAM_FILE),
  );
  await runCauseEffect(teamStore.initialize());
  performance.mark("openbot:services.team");
  const machineAlertStore = new MachineAlertPreferenceStore(
    join(app.getPath("userData"), MACHINE_ALERTS_PREFERENCE_FILE),
  );
  await runCauseEffect(machineAlertStore.load());
  // The same disk as the sidebar storage card: the one that holds the data folder.
  const machineMetrics = new MachineMetricsSampler(storageSources.roots.data);
  // Its own sampler, so a Storage panel that reads in between does not shorten its one-minute CPU window.
  const machineAlertMetrics = new MachineMetricsSampler(storageSources.roots.data);
  const machineAlerts = new MachineAlertMonitor({
    read: () => machineAlertMetrics.read(),
    display: () => machineMetrics.read(),
    store: machineAlertStore,
    members: () => teamStore.listMembers(),
    onError: (message, error) => logger.warn(message, toLogValue(error)),
  });
  teardown.push(TEARDOWN_ORDER.machineAlerts, "the machine alert check", () => machineAlerts.close());
  ingressHostId = () => teamStore.getIdentity()?.serverId ?? null;
  signalIngress.reconnect();
  const webhookRelay = new WebhookRelay({
    account: centralAuth,
    ingress: signalIngress,
    hostId: () => teamStore.getIdentity()?.serverId ?? null,
  });
  const events = new HostEventsService({
    routines: service.routineRecords,
    workflows: {
      receive: (delivery) => workflowRuntime.receiveWebhook(delivery),
      changed: (workflowId) => service.notifyWorkflowsChanged(workflowId),
    },
    cipher: secretCipher,
    relay: webhookRelay,
    accountPrincipal: () => {
      const state = centralAuth.getState();
      return state.status === "signed_in" ? state.user.id : null;
    },
  });
  const eventsRuntime = new HostEventsRuntime(events);
  signalIngress.handleWebhooks((input) => events.receive(input));
  teardown.push(TEARDOWN_ORDER.hostEvents, "the event service", async () => {
    webhookRelay.stop();
    await Effect.runPromise(eventsRuntime.stop());
  });
  // After `teamStore.initialize()` and before `HostService`, which reads the account it activates.
  if (developmentRemoteRole) {
    await runCauseEffect(
      applyDevelopmentRemoteAccount({
        role: developmentRemoteRole,
        testClientEnabled: developmentTestClientEnabled,
        centralAuth,
        teamStore,
        setupFile,
        setupCompleted: setupState.completed,
      }),
    );
  }
  // At the same position. A failure leaves the host unconfigured and the app running, so the log
  // shows why; a throw here would make systemd restart the app with a claim that may be spent.
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
  const browserProfiles = createBrowserProfileService({ store: browserProfileStore, agents: service, browser });
  const customProviderChanges = createCustomProviderChanges({ service, customProviders });
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
  // The host comes before the updater, and the restart readiness reads the host. The routes reach
  // the schedule through this, and a request that arrives before it exists is refused.
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
  // Imported channels are created by the local user, as when they create one by hand. A member who
  // imports from a joined client is named by the route instead. The host is read only on apply.
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
  // Hermes profiles become agents through the same services; MCP servers through the MCP settings.
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
  // The same owners the Settings screens write through, so an import has their checks and restarts.
  const instanceTransfer = new InstanceTransferService({
    agents: service,
    skills: { library: () => skills.requireLocalLibrary(), installLocal: (input) => skills.installLocal(input) },
    sharedRoot: store.sharedRoot,
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
      signedInProviders: () =>
        (service.getStatus().providers ?? [])
          .filter((provider) => provider.state === "available" && !provider.off)
          .map((provider) => provider.id),
    },
  });
  const mcpHostSignIns = new McpHostSignIns({ service, browser });
  const providerSignIns = new ProviderHostSignIns({ service, browser });
  const providerAccountsHost = new ProviderAccountsHost({ service, browser });
  // The flows end with the sign-ins they relay, which `mcpHostSignIns`, `providerSignIns` and
  // `providerAccountsHost` close.
  const signInRelayHost = new SignInRelayHost({
    mcp: mcpHostSignIns,
    providers: providerSignIns,
    accounts: providerAccountsHost,
    receiveMcpGrant: (state, code) => mcpOAuth.receiveAuthorizationCode(state, code),
    // The search ignores case, so the exact address is checked again on each agent message it finds.
    printedLink: (agentId, url) =>
      agentPrintedLink(
        service.searchConversationMessages(url, agentId, undefined, 20).results.map(({ message }) => message),
        url,
        Date.now(),
      ),
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
  // The live view of a sign-in page in this host's browser: only on Linux, where the Gemini CLI has
  // always printed its page. The relay takes the page on every platform.
  const providerHostSignIns = process.platform === "linux" ? providerSignIns : undefined;
  const pushNotificationStore = new PushNotificationStore(join(app.getPath("userData"), PUSH_NOTIFICATION_FILE));
  await runCauseEffect(pushNotificationStore.load());
  const host = new HostService({
    appVersion: app.getVersion(),
    store: teamStore,
    agents: service,
    // Defined below with the startup it waits for; a request runs only after this returns.
    agentsReady: () => agentInitialization.awaitSettled(),
    events,
    skills,
    sidebarLayout,
    mailbox,
    browser,
    chat: teamChatStore,
    channels: service.channels,
    // Present, so the host advertises `mcp-servers-v1`. The routes are admin-only.
    mcpServers: service,
    // Present, so the host advertises `mcp-sign-in-v1`. The routes are admin-only.
    mcpSignIns: mcpHostSignIns,
    // Present, so the host advertises `sign-in-relay-v1`. The routes are admin-only.
    signInRelay: signInRelayHost,
    // Present, so the host advertises `connectors-v1`. GitHub answers `available: false` when this
    // build has no GitHub App. The routes are admin-only.
    connectors: { github: githubConnector, messaging },
    // Present, so the host advertises `onepassword-connector-v1`. An owner or admin connects it with
    // a service account token, as a host with no screen cannot approve the 1Password app.
    onePasswordConnector,
    // Present, so the host advertises `bitwarden-connector-v1`. An owner or admin connects it with an
    // API key and the master password: a session key from their computer cannot open this vault.
    bitwardenConnector,
    // Present, so the host advertises `vault-v1`. The routes are admin-only.
    vault,
    // Present on Linux, so the host advertises `provider-host-sign-in-v1`. The routes are admin-only.
    providerHostSignIns,
    // Present, so the host advertises `provider-accounts-v1`. The routes are admin-only.
    providerAccounts: providerAccountsHost,
    // Present, so the host advertises `provider-usage-reset-v1`. The routes are admin-only.
    providerUsageResets: service,
    // Present, so the host advertises `provider-sign-out-v1`. The route is admin-only.
    providerSignOut: service,
    // Present, so the host advertises `storage-v1`. Members read; only admins delete or clear.
    storage: storageUsage,
    // Present, so the host advertises `machine-resources-v1`. The routes are admin-only.
    machine: machineAlerts,
    // Present, so the host advertises `hosted-sites-v1`. Members list; only admins delete.
    hostedSites,
    // Present, so the host advertises `agent-import-v1`. Any member can import.
    agentImport,
    // Present, so the host advertises `instance-transfer-v1`. Only owners and admins.
    instanceTransfer,
    // Present, so the host advertises `routine-flows-v1`. Any member who can see the agents.
    routineFlows: routineFlowRuntime,
    // Present, so the host advertises `workflows-v1`. Any member who can see and talk to the agents.
    workflows: { ...workflowRuntime, rotateWorkflowSecret: (input) => events.rotateWorkflowSecret(input) },
    // Present, so the host advertises `agent-hidden-v1`. Any member can hide or restore an agent that they can see.
    hiddenAgents: service,
    // Present, so the host advertises `agent-access-v1`. Only owners and admins change the roles.
    agentAccess,
    // Present, so the host advertises `agent-tasks-v1`. Any member who can send a message to the agent.
    agentTasks: service,
    // Present, so the host advertises `browser-profiles-v1`. Only owners and admins change profiles;
    // any member reads the profile labels of the tabs they can see.
    browserProfiles,
    // True on a hosted server, so the host advertises `focus-use-v1`. Any member can send it.
    focusUse: hostedServer !== null,
    // Each member present advertises its admin capability. Every admin route requires an owner or admin.
    admin: {
      agents: agentAdminSettings,
      agentHost: agentHostSettings,
      sessionSettings: service,
      acpRegistry,
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
      memoryLimit: agentMemoryLimitSetting,
      memoryReview,
      promptCacheTtl,
      // The local Settings save does the same two steps (`saveSetup`).
      defaultProvider: {
        // The provider that a new agent starts on now, also before a setup choice: `preferredProvider` above.
        get: () =>
          readSetupState(setupFile).pipe(
            Effect.map((state) => ({
              provider: service.preferredProvider(),
              model: state.preferredProvider === service.preferredProvider() ? state.preferredModel : null,
            })),
          ),
        set: (input) =>
          writeSetupState(setupFile, input).pipe(
            Effect.tap(() => service.setPreferredProvider(input.preferredProvider, input.preferredModel)),
            // The window read the setup once at start, so it gets the new choice.
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
    },
    // The host's Team API routes share the IPC handlers' runtime preparation: a first server
    // saved, enabled, or tested remotely must start and await the managed download like a local one.
    mcpToolRuntimePreparation: {
      startToolRuntimes: () => {
        Effect.runFork(providerRuntimes.ensureToolRuntimes());
      },
      ensureToolRuntimesReady: () => providerRuntimes.ensureToolRuntimesReady(),
      toolRuntimes: () => providerRuntimes.mcpToolRuntimes(),
    },
    teamWebRtcBridge,
    privateNetwork: () => remoteNetworkRoute.get().route === "private",
    registerRemoteHost: (input) => centralAuth.registerRemoteHost(input).pipe(toRemoteWorkflowError),
    handOverRemoteHostKey: (hostId, handover) =>
      centralAuth.handOverRemoteHostKey(hostId, handover).pipe(toRemoteWorkflowError),
    issueRemoteHostTicket: (hostId) => centralAuth.issueRemoteHostTicket(hostId).pipe(toRemoteWorkflowError),
    sendLiveActivityPush: (hostId, push) => centralAuth.sendLiveActivityPush(hostId, push).pipe(toRemoteWorkflowError),
    sendPushNotification: (hostId, push) => centralAuth.sendPushNotification(hostId, push).pipe(toRemoteWorkflowError),
    pushNotificationStore,
    // The owner is at this computer only with recent input, also when the window was left in focus.
    // Then the focused window shows the event, or the desktop notifies. When mute or the level of
    // this server keeps the desktop quiet about the event, the phone tells the owner.
    hostComputerInUse: (event) => {
      const window = windows.getMainWindow();
      if (!window || window.isDestroyed()) return false;
      if (powerMonitor.getSystemIdleState(DESKTOP_USE_MS / 1_000) !== "active") return false;
      if (window.isFocused()) return true;
      // Without a notification service, as on Linux without a daemon, the desktop shows nothing.
      if (!Notification.isSupported()) return false;
      // Read when an event arrives, after the manager below exists.
      const local = remoteServers.list().find((server) => server.id === LOCAL_SERVER_ID);
      return desktopShowsAgentEvent(event, local, notificationPreference.get().desktopNotifications);
    },
    verifyRemoteSessionTicket: (ticket) => centralAuth.verifyRemoteSessionTicket(ticket).pipe(toRemoteWorkflowError),
    endRemoteSession: (sessionId) => centralAuth.endRemoteSession(sessionId).pipe(toRemoteWorkflowError),
    remoteControlPlaneUrl: centralAuth.resolveApiUrl("/"),
    createRemoteInvite: (hostId, input) => centralAuth.createRemoteInvite(hostId, input).pipe(toRemoteWorkflowError),
    listRemoteInvites: (hostId) => centralAuth.listRemoteInvites(hostId).pipe(toRemoteWorkflowError),
    revokeRemoteInvite: (inviteId) => centralAuth.revokeRemoteInvite(inviteId).pipe(toRemoteWorkflowError),
    listRemoteMembers: (hostId) => centralAuth.listRemoteMembers(hostId).pipe(toRemoteWorkflowError),
    updateRemoteMember: (hostId, membershipId, role, reactivate) =>
      centralAuth.updateRemoteMember(hostId, membershipId, role, reactivate).pipe(toRemoteWorkflowError),
    removeRemoteMember: (hostId, membershipId) =>
      centralAuth.removeRemoteMember(hostId, membershipId).pipe(toRemoteWorkflowError),
    updateRemoteHostLogo: (hostId, image, version) =>
      centralAuth.updateRemoteHostLogo(hostId, image, version).pipe(toRemoteWorkflowError),
    localDevelopmentHost: developmentRemoteRole === "host",
    logDirectory: join(app.getPath("userData"), "logs", "remote"),
    removeLegacyRemoteDesktopCredential: () =>
      Effect.tryPromise({
        try: async () => {
          const credentialPath = join(app.getPath("userData"), LEGACY_REMOTE_DESKTOP_CREDENTIAL_FILE);
          await Promise.all([rm(credentialPath, { force: true }), rm(`${credentialPath}.tmp`, { force: true })]);
        },
        catch: (cause) => new RemoteWorkflowError({ cause }),
      }),
    // Still a function, and still throws when nobody is signed in: the account is a lifetime
    // state of the running app, not a startup-ordering artifact.
    getSignedInUser: () => centralAuth.getSignedInUser(),
    redeemCentralTicket: (ticket, serverId) =>
      centralAuth.redeemTeamAuthTicket(ticket, serverId).pipe(toRemoteWorkflowError),
    sendTeamInviteEmail: (input) => centralAuth.sendTeamInviteEmail(input).pipe(toRemoteWorkflowError),
    platform: process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux",
    unattended: false,
    remoteDesktopRuntimePaths: remoteDesktopRuntime,
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
    getRemoteDesktopRuntimeCredentials: () =>
      Effect.suspend(() => {
        if (!safeStorage.isEncryptionAvailable())
          return Effect.fail(
            new RemoteWorkflowError({ cause: new Error(sourceText("error.app.secretStorageUnavailable")) }),
          );
        return loadOrCreateRemoteDesktopCredentials(
          join(app.getPath("userData"), REMOTE_DESKTOP_RUNTIME_SECRET_FILE),
          secretCipher,
        ).pipe(toRemoteWorkflowError);
      }),
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
    // A member's paste in the remote desktop replaces this computer's clipboard, as a copy they make
    // on it does.
    writeRemoteDesktopClipboard: (text) => clipboard.writeText(text),
    getRemoteDesktopIceServers: () =>
      Effect.try({
        try: () => {
          // The private route has no relay, so the remote desktop also connects only over a direct path.
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
    // A local server has no account. Its owner is a password member, and binding an account here
    // would unbind that host.
  } else if (signedInState.status === "signed_in") {
    await runCauseEffect(host.applySignedInAccount(signedInState.user));
  } else if (signedInState.status === "signed_out") {
    // Sign-out can settle before this service exists, leaving `forwardCentralAuth`
    // nothing to deactivate. Unbinding here is what stops a persisted
    // `activeAccountId` from keeping the last account's host configured - and
    // unconfigurable - while nobody is signed in. A still-loading or failed account
    // service keeps its host, and the event listener settles it.
    await runCauseEffect(host.applySignedInAccount(null));
  }
  const analyticsPlatform = process.platform;
  if (analyticsPlatform !== "darwin" && analyticsPlatform !== "win32" && analyticsPlatform !== "linux") {
    throw new Error(`Unsupported analytics platform: ${analyticsPlatform}`);
  }
  // Load the local catalog before telemetry starts so tool steps and inventory use the same names.
  performance.mark("openbot:services.remote-desktop");
  const catalogPluginServers = await Effect.runPromise(
    loadCatalogPluginServers(
      app.isPackaged
        ? join(process.resourcesPath, "plugin-catalog")
        : resolve(__dirname, "../../resources/plugin-catalog"),
    ),
  );
  const analyticsEnabled = (app.isPackaged && appVariant === "production") || analyticsCaptureUrl !== null;
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
    appVersion: app.getVersion(),
    platform: analyticsPlatform,
    // A function for a lifetime reason, not an ordering one: the signed-in account changes
    // while the app runs, and the analytics identity has to follow it.
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
    resolveMcpServer: (name) => {
      const configs = service.listMcpServers().filter((server) => isReportedMcpServerName(server.name, name));
      if (configs.length === 0) return null;
      const slugs = new Set(configs.map((config) => catalogPluginSlug(config, catalogPluginServers, homedir())));
      const [slug] = slugs;
      return { slug: slugs.size === 1 && slug ? slug : null };
    },
    resolveRoutineRun: (agentId, routineId, runId) => {
      const run = service.listRoutineRuns({ agentId, routineId }).find((item) => item.id === runId);
      const routine = service.listRoutines(agentId).find((item) => item.id === routineId);
      return run && routine ? { runKind: run.kind, triggerType: routine.trigger.schedule.kind } : null;
    },
    resolveInventory: () =>
      collectAnalyticsInventory({
        agents: () => service.listAgents(),
        routines: (agentId) => service.listRoutines(agentId),
        workflowCount: () => workflowStore.list().length,
        // The local read: `listInstalled` asks the marketplace for each skill's latest version.
        skills: (agentId) => skills.listInstalledForChatTags(agentId),
        mcpServers: () => service.listMcpServers(),
        pluginSlug: (config) => catalogPluginSlug(config, catalogPluginServers, homedir()),
        computerUseEnabled: () => cuaDriver.mcpServerForProviders() !== null,
      }),
    inventoryDay: analyticsInventoryDayStore(join(app.getPath("userData"), ANALYTICS_INVENTORY_FILE)),
    resources: resourceMonitor,
  });
  teardown.push(TEARDOWN_ORDER.analytics, "host analytics", () => Effect.runPromise(analytics.close()));
  // Immediately after construction: this attributes buffered events to the current owner rather
  // than flushing a queue, so a later call would attribute them to nobody.
  analytics.flushPending();
  service.on("failure", (failure) => analytics.handleFailure(failure));
  resourceMonitor.start(() => analytics.checkResources());
  const connectTrace = new RemoteConnectTrace((span) => trace.record(span));
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
      selfHostedApiOrigin: selfHostedApiOrigin(centralAuthApiUrl),
      appVersion: app.getVersion(),
      connectTrace,
      accountReady: centralAuthInitialization,
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
      }),
    },
  );
  // A server joined or revoked on another device of this account. Signal carries it to every socket
  // the account holds, so the phone's join reaches this computer in the second it happens rather
  // than at the next account check. The refresh itself belongs to the entry point, which owns the
  // account check and its coalescing; this only forwards the notice to it.
  teamWebRtcBridge.on("accountServersChanged", () => void Effect.runPromise(remoteServers.invalidateDirectory()));
  teardown.push(TEARDOWN_ORDER.remoteServers, "the remote servers", () => runCauseEffect(remoteServers.stop()));
  performance.mark("openbot:services.plugin-catalog");
  // Not on a server: a local server is a workspace of the desktop app.
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
          command: { executable: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] },
          trash: (path) => shell.trashItem(path),
          log: {
            info: (message) => logger.info(message),
            warn: (message, detail) => logger.warn(message, detail === undefined ? "" : toLogValue(detail)),
          },
          platform: process.platform,
        });
  if (localServers) {
    teardown.push(TEARDOWN_ORDER.localServers, "the servers on this computer", () =>
      Effect.runPromise(localServers.stop()),
    );
    // Before `remoteServers.initialize()`: the account's directory sync keeps only the entries of the
    // servers on this computer that it knows.
    await Effect.runPromise(localServers.load());
  }
  await runCauseEffect(remoteServers.initialize());
  performance.mark("openbot:services.remote-servers");
  criticalActionTargets = { agents: service, host, remoteServers };
  // After `remoteServers.initialize()`. The client half polls for the host's connection file and
  // throws when it never appears, before any window is shown - see the module it lives in. It reads
  // the joined servers to choose between WebRTC and HTTP, so it waits for the account's host list.
  if (developmentRemoteRole) {
    await runCauseEffect(remoteServers.awaitHostDirectory());
    await runCauseEffect(
      startDevelopmentRemoteRole({
        role: developmentRemoteRole,
        testClientEnabled: developmentTestClientEnabled,
        host,
        remoteServers,
      }),
    );
  }
  if (localServers) await Effect.runPromise(localServers.initialize());
  if (localServerChild) {
    await runCauseEffect(
      startLocalServerChild({
        environment: localServerChild,
        teamStore,
        host,
        writeReady: (line) => process.stdout.write(line),
      }),
    );
  }
  configureAttachmentProtocol({ mailbox, agents: service, remoteServers });
  configureServerLogoProtocols({ teamStore, remoteServers });
  // After the servers: the view it opens belongs to one of them, and it has to stop before they do.
  const browserView = new BrowserViewClient({
    servers: remoteServers,
    onEvent: (event) => {
      const window = windows.getMainWindow();
      if (!window || window.isDestroyed()) return;
      sendToRenderer(window, IPC_ENDPOINTS.browser.liveViewEvent, event);
    },
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
  const voicePreferences = new VoicePreferenceStore(join(app.getPath("userData"), "voice-preference.json"));
  await runCauseEffect(voicePreferences.load());
  const voiceApiKeys = new VoiceApiKeyStore({
    path: join(app.getPath("userData"), "voice-api-key.json"),
    cipher: secretCipher,
  });
  await runCauseEffect(voiceApiKeys.load());
  const voice = new VoiceTranscriptionService({
    resourcesRoot: app.isPackaged ? join(process.resourcesPath, "voice") : resolve(".openbot-build/voice"),
    // `voice:prepare` puts Parakeet in `.openbot-build/voice/model` for development. In development
    // the other models download to `.openbot-build/voice` when you select them.
    modelDirectories: {
      "parakeet-tdt-0.6b-v3": app.isPackaged
        ? join(app.getPath("userData"), "runtimes", PARAKEET_MODEL_DIRECTORY)
        : resolve(".openbot-build/voice/model"),
      "bark-3.0-plus": app.isPackaged
        ? join(app.getPath("userData"), "runtimes", BARK_PLUS_MODEL_DIRECTORY)
        : resolve(".openbot-build/voice", BARK_PLUS_MODEL_DIRECTORY),
      "whisper-turbo": app.isPackaged
        ? join(app.getPath("userData"), "runtimes", WHISPER_TURBO_MODEL_DIRECTORY)
        : resolve(".openbot-build/voice", WHISPER_TURBO_MODEL_DIRECTORY),
    },
    preferences: voicePreferences,
    apiKeys: voiceApiKeys,
    spawnHost: spawnVoiceTranscriptionHost,
    openStreamSocket: openScribeSocket,
  });
  if (app.isPackaged) {
    // Parakeet replaced Whisper. The Whisper model is an application download, not user data.
    void Effect.runPromise(removeLegacyWhisperCache(join(app.getPath("userData"), "runtimes", "whisper"))).catch(
      (error) => logger.warn("Could not remove the old Whisper model cache.", toLogValue(error)),
    );
  }
  teardown.push(TEARDOWN_ORDER.voice, "voice transcription", () => Effect.runPromise(voice.shutdown()));
  voice.on("modelStatus", forwardVoiceModelStatus);
  voice.on("streamTranscript", forwardVoiceStreamTranscript);
  const speechPreferences = new SpeechPreferenceStore(join(app.getPath("userData"), "speech-preference.json"));
  await runCauseEffect(speechPreferences.load());
  const speech = new VoiceSpeechService({
    resourcesRoot: app.isPackaged ? join(process.resourcesPath, "voice") : resolve(".openbot-build/voice"),
    modelDirectory: app.isPackaged
      ? join(app.getPath("userData"), "runtimes", SUPERTONIC_MODEL_DIRECTORY)
      : resolve(".openbot-build/voice", SUPERTONIC_MODEL_DIRECTORY),
    preferences: speechPreferences,
    spawnHost: spawnVoiceSpeechHost,
  });
  teardown.push(TEARDOWN_ORDER.speech, "speech", () => Effect.runPromise(speech.shutdown()));
  speech.on("modelStatus", forwardSpeechModelStatus);
  // The user's own server for either route. Its key is a file of its own, apart from the ElevenLabs key.
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
  // Skip the file check in dev: unpacked runs never enable updates, so avoid touching resourcesPath.
  const updateMetadataAvailable = app.isPackaged && existsSync(join(process.resourcesPath, "app-update.yml"));
  // A hosted or self-installed server runs a release that root owns. Root installs updates for it
  // when openbot-hosted-update has installed its request units. A container of openbot-instance asks
  // the host instead, which pulls the image. Other containers have neither.
  const containerInstaller =
    app.isPackaged &&
    process.platform === "linux" &&
    installationMode === "container" &&
    existsSync(CONTAINER_UPDATE_TRIGGER);
  const hostedInstaller =
    containerInstaller ||
    (app.isPackaged &&
      process.platform === "linux" &&
      (process.env.OPENBOT_HOSTED_SERVER === "1" || installationMode === "self") &&
      existsSync(HOSTED_UPDATE_TRIGGER));
  // A local server is the same application as its parent, which installs the update for both.
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
  if (updatesEnabled && hostedInstaller) {
    updateAdapter = new HostedUpdateAdapter({
      currentVersion,
      arch: process.arch,
      ...(containerInstaller ? { paths: CONTAINER_UPDATE_PATHS } : {}),
    });
  } else if (updatesEnabled) {
    try {
      const updaterModule = await import("electron-updater");
      const realAdapter = updaterModule.autoUpdater ?? updaterModule.default?.autoUpdater ?? updaterModule.default;
      if (realAdapter) {
        updateAdapter = realAdapter;
        updaterCacheDirectory = join(electronUpdaterCacheRoot(), "openbot-updater");
      } else {
        updaterEnabled = false;
        logger.warn("OpenBot updates are disabled: electron-updater did not export autoUpdater");
      }
    } catch {
      updaterEnabled = false;
      logger.warn("OpenBot updates are disabled: electron-updater failed to load");
    }
  }
  const updater = new UpdateService(updateAdapter, {
    currentVersion,
    enabled: updaterEnabled,
    autoDownload: updatePreference.autoDownload,
    beforeInstall: prepareForUpdateInstall,
    // Packaged runs share one application bundle across macOS users. Installing while another
    // login session runs OpenBot from that bundle would replace it underneath that session, so
    // the service refuses the install until every sibling session stopped. Unpackaged runs never
    // enable updates, so there is nothing to guard there.
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
    // Squirrel.Mac only. The path is meaningless under a Linux or Windows home directory.
    ...(process.platform === "darwin"
      ? { shipItDirectory: join(homedir(), "Library", "Caches", "app.openbot.desktop.ShipIt") }
      : {}),
    updaterCacheDirectory,
  });
  teardown.push(TEARDOWN_ORDER.updater, "the update service", () => Effect.runPromise(updater.stop()));
  const agentInitialization = new AgentInitializationGate(() =>
    Effect.gen(function* () {
      yield* Fiber.join(computerUseWarmUp);
      yield* service.initialize({ heldRoutines: takeRoutineHold(routineHoldFile, (message) => logger.warn(message)) });
      yield* eventsRuntime.start();
      yield* automation.sync();
      // Picks up the flows a restart stopped between one agent's answer and the next agent's message.
      yield* routineFlowRuntime.sweep();
      // Ends the workflow steps a restart cut off, and moves the runs on.
      yield* workflowRuntime.sweep();
      // Marks the posts a restart cut off, and sends the answers that ended while OpenBot was closed.
      yield* routineResultRuntime.recover();
    }),
  );
  const describeRestartReadiness = (): RestartReadiness =>
    checkRestartReadiness({
      // A workflow model step lives in this process only; agent steps are queued deliveries.
      agentWork: [...service.hasActiveWork(), ...(workflowRuntime.working() ? ["routine-run"] : [])],
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
  // A client that used the server in the last minutes still uses it.
  const clientInUse = () =>
    host.connectedClientCount() > 0 && Date.now() - (host.lastClientUseAt() ?? 0) < CLIENT_USE_WINDOW_MS;
  // A client wakes a hosted server, and reading is not use. Without this, a member who only reads
  // would see the restart at the end of the disk restore.
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
    // boat restores the disk of a woken server lazily, so its start no longer applies a release.
    clientInUse: hostedServer ? clientInUseSinceStart : undefined,
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
        // The restart goes on: the next start then skips the held routines as missed.
        logger.warn("The routine hold could not be saved.", toLogValue(error));
      }
    },
    relaunch: () => {
      // A development build only quits: its supervisor stops the stack, and a relaunched Electron
      // would run outside it with no renderer server.
      if (app.isPackaged) app.relaunch();
      app.quit();
    },
    log: (message) => logger.info(message),
  });
  teardown.push(TEARDOWN_ORDER.idleRestart, "the restart when idle", () => idleRestart.dispose());
  if (hostedServer) {
    const hostedServerStartRetry = new HostedServerStartRetry({
      hostPhase: () => host.getStatus().phase,
      startHost: () =>
        Effect.gen(function* () {
          // A start with no answer from the account server ends in the auth error state, and only a
          // retry reads the stored session again.
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
      // A live Slack, Discord or Telegram connection counts only when Signal cannot start the server for
      // the next message and keep it (an older Signal, or no queue key): stopped, the server could not
      // hear it. An open browser view does not count: a view that the user forgot would keep the server
      // running. Input in the view counts as client use.
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
    // A server that was published at the last quit is published again at launch, once (`index.ts`).
    // That start can fail when the network is not ready yet, such as at login after an update, and
    // the server then stayed private until the user published it again. A published server that a
    // Signal failure puts in the error phase later is published again in the same way.
    const launchPublishRetry = new HostedServerStartRetry({
      hostPhase: () => host.getStatus().phase,
      startHost: () =>
        Effect.gen(function* () {
          // A server that the user stopped is not published again: Stop clears `enabledOnLaunch`.
          if (!shouldAutoStartHost({ ...host.getStatus(), remoteRole: developmentRemoteRole })) return;
          const auth = centralAuth.getState();
          // Only a start with no answer from the account server; any other auth error is the user's.
          if (auth.status === "error" && auth.issue.code === "auth_api_unavailable")
            yield* centralAuth.retry().pipe(toRemoteWorkflowError);
          if (centralAuth.getState().status !== "signed_in") return;
          return yield* host.start();
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
        memory: hostMemory,
        onError: (message, error) => logger.warn(message, toLogValue(error)),
      })
    : null;
  if (serverMode) {
    // Without the socket the server still runs, and the log says why nobody can sign it in.
    await runCauseEffect(serverMode.listen()).catch((error) =>
      logger.error("The server control socket did not start:", toLogValue(error)),
    );
    // Nobody presses Retry on a server either. A server that is signed out has nothing to publish.
    const serverStartRetry = new HostedServerStartRetry({
      hostPhase: () => host.getStatus().phase,
      startHost: () =>
        Effect.gen(function* () {
          if (centralAuth.getState().status === "error") yield* centralAuth.retry().pipe(toRemoteWorkflowError);
          yield* serverMode.publish();
        }),
      onError: (message, error) => logger.warn(message, toLogValue(error)),
    });
    serverStartRetry.start();
    teardown.push(TEARDOWN_ORDER.serverMode, "the server control socket", async () => {
      await Effect.runPromise(serverStartRetry.stop());
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
    routineFlows: routineFlowRuntime,
    workflows: workflowRuntime,
    routineResults: routineResultRuntime,
    providerRuntimes,
    providerCredentials,
    messaging,
    mcpOAuth,
    signInRelayClient,
    relayedMessagingInstalls: new RelayedMessagingInstalls(remoteServers),
    githubConnector,
    onePasswordConnector,
    bitwardenConnector,
    vault,
    mailbox,
    storageUsage,
    browser,
    browserPictureInPicture,
    localSignIn,
    browserDock,
    browserView,
    updater,
    setupFile,
    analyticsPreferenceFile,
    updatePreferenceFile,
    approvalAutomation,
    agentAdminSettings,
    agentHostSettings,
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
    agentAccess,
    serverTimezone,
    promptCacheTtl,
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
    license,
    hostedServers,
    routineFeed,
    events,
    eventsRuntime,
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
    cuaDriver,
    computerUseHighlight,
    computerUsePermissionHelp,
    analytics,
    trace,
    resourceMonitor,
    machineAlerts,
    teamStore,
    appliedAccount: signedInState,
    centralAuthInitialization,
  };
}
