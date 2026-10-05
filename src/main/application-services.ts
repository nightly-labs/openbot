import { isManagedRuntimeProvider } from "@openbot/contracts/agent-providers";
import { Effect } from "effect";
import { AgentRemovalFailed } from "../backend/agent/agent-removal";
import { HostedSiteOperationFailed } from "../backend/agent/hosted-site-coordinator";
import { AgentDatabaseSupervisor } from "../backend/agent-data/agent-database-supervisor";
import { AgentTables } from "../backend/agent-data/agent-tables";
import { SlackConnectFailed } from "../backend/messaging/slack/slack-connect";
import { type AgentAdminSettingsService, createAgentAdminSettings } from "./agent-admin-settings";
import { spawnAgentDatabaseHost } from "./agent-database-host-process";
import { LocalSkillLibrary } from "./local-skill-library";
import { localSkillTools } from "./local-skill-tools";
import { MAC_PERMISSION_URLS } from "./mac-permission-urls";
import { RemoteWorkflowError } from "./remote-service-effects";
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
  VoiceModelStatus,
} from "@openbot/contracts/ipc";
import { IPC_ENDPOINTS, isManagedToolRuntime, isUpdateBusyPhase } from "@openbot/contracts/ipc";
import { decodeRecord, requiredString } from "@openbot/contracts/ipc-decoding";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { REMOTE_ACCOUNT_CHECK_INTERVAL_MS } from "@openbot/team-client";
import { app, type BrowserWindow, nativeImage, safeStorage, screen, shell } from "electron";
import { pasteCodeLoginSupported } from "../backend/agent/cli-code-login";
import { McpGatewayFailed } from "../backend/agent/mcp-gateway";
import { AgentLifecycleFailed, AgentService } from "../backend/agent-service";
import { AgentStore } from "../backend/agent-store";
import { BrowserHost } from "../backend/browser-host";
import { runCauseEffect } from "../backend/effect-boundary";
import { MailboxStore } from "../backend/mailbox-store";
import { McpOAuth } from "../backend/mcp-oauth-provider";
import { MessagingService } from "../backend/messaging/messaging-service";
import { slackDriver } from "../backend/messaging/slack/slack-driver";
import { SidebarLayoutStore } from "../backend/sidebar-layout-store";
import { StorageUsageScanner, StorageUsageService } from "../backend/storage-usage";
import { TeamChatStore } from "../backend/team-chat-store";
import { AgentImportService } from "./agent-import-service";
import { AgentInitializationGate } from "./agent-initialization";
import { AgentMarketplaceService } from "./agent-marketplace-service";
import { AgentTemplateService } from "./agent-template-service";
import { HostAnalytics } from "./analytics";
import { analyticsInventoryDayStore, collectAnalyticsInventory } from "./analytics-inventory";
import { catalogPluginSlug, isReportedMcpServerName, loadCatalogPluginServers } from "./analytics-plugin-catalog";
import { readAnalyticsPreference } from "./analytics-preference-store";
import { ApprovalAutomation, readApprovalAutomation } from "./approval-automation-store";
import { AutomationServer } from "./automation-server";
import { BillingDesktopService } from "./billing-service";
import { BrowserPictureInPicture } from "./browser-picture-in-picture";
import { BrowserViewClient } from "./browser-view-client";
import { CentralAuthManager, readCentralAuthApiUrl, readMobileConnectApiUrl } from "./central-auth-manager";
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
import {
  applyDevelopmentRemoteAccount,
  type DevelopmentRemoteRole,
  startDevelopmentRemoteRole,
} from "./development-remote-bootstrap";
import { performDynamicIslandCriticalAction } from "./dynamic-island-actions";
import { DynamicIslandWindowController } from "./dynamic-island-window";
import { githubAppConfig } from "./github-connector-config";
import { GitHubConnectorService } from "./github-connector-service";
import { GitHubConnectorStore } from "./github-connector-store";
import { HostService } from "./host-service";
import { HostUpdateCoordinator } from "./host-update-coordinator";
import { CLIENT_USE_WINDOW_MS, HostedServerActivity } from "./hosted-server-activity";
import { applyHostedServerAccount, type HostedServerEnvironment } from "./hosted-server-bootstrap";
import { HostedServerMemory } from "./hosted-server-memory";
import { HostedServerDesktopService, withHostingDeveloperKey } from "./hosted-server-service";
import { HostedServerStartRetry } from "./hosted-server-start-retry";
import { HostedSiteDesktopService } from "./hosted-site-service";
import { IdleRestart } from "./idle-restart";
import { LanguageService } from "./language-service";
import { LogoColorService } from "./logo-color-service";
import type { MacHapticFeedback } from "./mac-haptic-feedback";
import {
  computerUseDesktopPoint,
  computerUseDesktopRect,
  computerUseDisplays,
  createComputerUseHighlightWindow,
  createComputerUsePermissionHelpWindow,
  createDynamicIslandWindow,
  loadComputerUseHighlightRenderer,
  loadComputerUsePermissionHelpRenderer,
  loadDynamicIslandRenderer,
  type MainWindowController,
  sendComputerUseHighlightPlacement,
  showMainWindow,
} from "./main-window";
import { ManagedSkillService } from "./managed-skill-service";
import { startMcpOAuthRedirectServer } from "./mcp-oauth-redirect-server";
import { McpOAuthStore } from "./mcp-oauth-store";
import { MessagingCredentialStore } from "./messaging-credential-store";
import { NotificationPreferenceStore } from "./notification-preference-store";
import { OnePasswordConnectorService } from "./onepassword-connector-service";
import { OnePasswordConnectorStore } from "./onepassword-connector-store";
import { ProviderCredentialStore } from "./provider-credential-store";
import { createProviderDetection, type ProviderDetection } from "./provider-detection";
import { PROVIDER_DETECTION_SETTINGS_FILE, ProviderDetectionSettingsStore } from "./provider-detection-settings-store";
import { startProviderLog } from "./provider-log";
import { ProviderRuntimeFailure } from "./provider-runtime-effects";
import { ProviderRuntimeManager, providerRuntimeRoot, runtimeTarget } from "./provider-runtime-manager";
import { RemoteDesktopManager } from "./remote-desktop-manager";
import { resolveRemoteDesktopRuntime } from "./remote-desktop-runtime-artifact";
import { loadOrCreateRemoteDesktopCredentials } from "./remote-desktop-secret-store";
import { appendRemoteDiagnosticLog } from "./remote-diagnostics";
import { decodeVoid } from "./remote-host-decoding";
import { RemoteServerManager } from "./remote-server-manager";
import { sendToRenderer } from "./renderer-ipc";
import { RequestedUpdate, RequestedUpdateRefusal } from "./requested-update";
import { clearRoutineHold, ROUTINE_HOLD_FILE, takeRoutineHold, writeRoutineHold } from "./routine-hold-file";
import { ServerMode, type ServerModeEnvironment } from "./server-mode";
import {
  configureApplicationProtocol,
  configureAttachmentProtocol,
  configureServerLogoProtocols,
} from "./session-configuration";
import { readSetupState } from "./setup-store";
import { SkillMarketplaceService } from "./skill-marketplace-service";
import { SLACK_DEV_CALLBACK_PATH, startSlackDevCallbackServer } from "./slack-dev-callback-server";
import { SlackIngress } from "./slack-ingress";
import { TeamStore } from "./team-store";
import { TeamWebRtcBridge } from "./team-webrtc-bridge";
import { TeamWebRtcClientTransport } from "./team-webrtc-client-transport";
import type { TeardownRegistry } from "./teardown-registry";
import { TraceFile } from "./trace-file";
import { readUpdatePreference, writeUpdatePreference } from "./update-preference-store";
import { checkRestartReadiness, type RestartReadiness } from "./update-readiness";
import {
  createDisabledUpdateAdapter,
  isValidSemver,
  supportsInstalledUpdates,
  type UpdateAdapter,
  UpdateService,
} from "./update-service";
import { listSiblingOpenBotInstances } from "./update-sibling-instances";
import { WHISPER_MODEL_NAME, WHISPER_MODEL_URL } from "./voice-model-service";
import { VoiceTranscriptionService } from "./voice-transcription-service";

const logger = createOpenBotLogger("application-services");
const SETUP_FILE = "openbot-setup-v2.json";
const ANALYTICS_PREFERENCE_FILE = "openbot-analytics-preference-v1.json";
const ANALYTICS_INVENTORY_FILE = "openbot-analytics-inventory-v1.json";
const APPROVAL_AUTOMATION_FILE = "openbot-approval-automation-v2.json";
const LEGACY_APPROVAL_AUTOMATION_FILE = "openbot-approval-automation-v1.json";
const LANGUAGE_PREFERENCE_FILE = "openbot-language-preference-v1.json";
const LOGO_COLOR_PREFERENCE_FILE = "openbot-logo-color-preference-v1.json";
const UPDATE_PREFERENCE_FILE = "openbot-update-preference-v1.json";
const NOTIFICATION_PREFERENCE_FILE = "openbot-notification-preference-v1.json";
const DYNAMIC_ISLAND_PREFERENCE_FILE = "openbot-dynamic-island-preference-v1.json";
const BROWSER_STATE_FILE = "openbot-browser-state-v1.json";
const SIDEBAR_LAYOUT_FILE = "openbot-sidebar-layout-v1.json";
const TEAM_FILE = "openbot-team-server-v1.json";
/** One host per account. The v1 file above stays as the last build without accounts left it. */
const TEAM_FILE_V2 = "openbot-team-server-v2.json";
const REMOTE_SERVERS_FILE = "openbot-remote-servers-v1.json";
const CENTRAL_AUTH_FILE = "openbot-central-auth-v1.bin";
const LEGACY_REMOTE_DESKTOP_CREDENTIAL_FILE = "openbot-remote-desktop-credential-v1.json";
const REMOTE_DESKTOP_RUNTIME_SECRET_FILE = "openbot-remote-desktop-runtime-v1.json";
const CUSTOM_PROVIDERS_FILE = "openbot-custom-providers-v1.json";
const PROVIDER_CREDENTIAL_FILE = "openbot-provider-credentials-v1.json";
const MESSAGING_CREDENTIAL_FILE = "openbot-messaging-credentials-v1.json";
/** The MCP sign-ins. Separate from the keys above: a key is typed by the user, a token is not. */
const MCP_OAUTH_FILE = "openbot-mcp-oauth-v1.json";
/** The one GitHub sign-in of this computer, with the same cipher as the MCP sign-ins. */
const GITHUB_CONNECTOR_FILE = "openbot-github-connector-v1.json";
/** The 1Password service account token of this computer, with the same cipher. */
const ONEPASSWORD_CONNECTOR_FILE = "openbot-onepassword-connector-v1.json";

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
  updater: 10,
  idleRestart: 11,
  hostUpdateCoordinator: 12,
  requestedUpdate: 13,
  hostedServerStartRetry: 14,
  hostedServerActivity: 15,
  hostedServerMemory: 16,
  serverMode: 17,
  computerUseHighlight: 18,
  computerUsePermissionHelp: 19,
  dynamicIsland: 20,
  browser: 30,
  browserPictureInPicture: 40,
  browserView: 45,
  providerDetection: 48,
  providerRuntimes: 50,
  cuaDriver: 55,
  remoteServers: 60,
  voice: 70,
  remoteDesktop: 80,
  // Before the host and the service: no new external message arrives while they stop.
  messaging: 85,
  // After the connections that hold it.
  slackIngress: 86,
  host: 90,
  teamWebRtcBridge: 100,
  mcpOAuthRedirect: 105,
  // Before the agent service. It holds no file an agent reads; only a CLI run that waits is stopped.
  onePasswordConnector: 106,
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
  // Last, so the turns that end while the services stop are still written.
  trace: 120,
  // After the service, so the lines its providers write while they stop are kept.
  providerLog: 121,
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
  developmentRemoteRole: DevelopmentRemoteRole | null;
  developmentTestClientEnabled: boolean;
  /** Set only in a hosted server VM. */
  hostedServer: HostedServerEnvironment | null;
  /** Set only in a self-hosted server that `install-server.sh` installed. */
  serverMode: ServerModeEnvironment | null;
  /** Set only by `bun run dev --hosting=test`. */
  hostingDeveloperKey: string | null;
  macHapticFeedback: MacHapticFeedback;
  teardown: TeardownRegistry;
  forwardCentralAuth: (state: CentralAuthState) => void;
  forwardBrowserDisplayState: (state: BrowserDisplayState) => void;
  forwardProviderRuntimeStatus: (snapshot: ProviderRuntimeSnapshot) => void;
  forwardVoiceModelStatus: (status: VoiceModelStatus) => void;
  prepareForUpdateInstall: () => Promise<void>;
}

/** Everything the entry point wires up, registers IPC handlers against, and shuts down. */
export interface ApplicationServices {
  service: AgentService;
  providerRuntimes: ProviderRuntimeManager;
  providerCredentials: ProviderCredentialStore;
  /** The Slack connections of the agents on this host. */
  messaging: MessagingService;
  /** Reached by the entry point for one thing only: handing a returning grant to its sign-in. */
  mcpOAuth: McpOAuth;
  githubConnector: GitHubConnectorService;
  onePasswordConnector: OnePasswordConnectorService;
  mailbox: MailboxStore;
  storageUsage: StorageUsageService;
  browser: BrowserHost;
  browserPictureInPicture: BrowserPictureInPicture;
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
  language: LanguageService;
  logoColor: LogoColorService;
  notificationPreference: NotificationPreferenceStore;
  agentInitialization: AgentInitializationGate<AgentLifecycleFailed>;
  sidebarLayout: SidebarLayoutStore;
  host: HostService;
  remoteDesktop: RemoteDesktopManager;
  remoteServers: RemoteServerManager;
  centralAuth: CentralAuthManager;
  skills: SkillMarketplaceService;
  hostedSites: HostedSiteDesktopService;
  billing: BillingDesktopService;
  hostedServers: HostedServerDesktopService;
  /** The terminal control of a self-hosted server. Null in every other build. */
  serverMode: ServerMode | null;
  customProviders: CustomProviderStore;
  customProviderChanges: CustomProviderChanges;
  customAgentChanges: CustomAgentChanges;
  providerDetection: ProviderDetection;
  providerDetectionSettings: ProviderDetectionSettingsStore;
  marketplaceAgents: AgentMarketplaceService;
  agentTemplates: AgentTemplateService;
  agentImport: AgentImportService;
  voice: VoiceTranscriptionService;
  dynamicIsland: DynamicIslandWindowController;
  cuaDriver: CuaDriverRuntime;
  computerUseHighlight: ComputerUseHighlightController;
  computerUsePermissionHelp: ComputerUsePermissionHelpWindowController;
  analytics: HostAnalytics;
  trace: TraceFile;
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

export async function createApplicationServices({
  mainWindow,
  windows,
  appIconPath,
  appVariant,
  developmentRemoteRole,
  developmentTestClientEnabled,
  hostedServer,
  serverMode: serverModeEnvironment,
  hostingDeveloperKey,
  macHapticFeedback,
  teardown,
  forwardCentralAuth,
  forwardBrowserDisplayState,
  forwardProviderRuntimeStatus,
  forwardVoiceModelStatus,
  prepareForUpdateInstall,
}: ApplicationServiceContext): Promise<ApplicationServices> {
  // First, so the provider lines of the whole startup reach the file.
  teardown.push(
    TEARDOWN_ORDER.providerLog,
    "the provider log",
    startProviderLog(join(app.getPath("userData"), "logs")),
  );
  // The one forward reference left in this function: the controller is built at the top of
  // startup because its window must be able to appear immediately, but the two services its
  // critical actions drive are built hundreds of lines below. A single named local rather than
  // two lazy getters, so the gap is visible and bounded.
  let criticalActionTargets: { agents: AgentService; remoteServers: RemoteServerManager } | null = null;
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
    performCriticalAction: async (action) => {
      if (!criticalActionTargets) throw new Error(sourceText("error.app.notReady"));
      const { agents, remoteServers } = criticalActionTargets;
      await runCauseEffect(performDynamicIslandCriticalAction(action, agents, remoteServers, decodeVoid));
    },
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
  const centralAuthInitialization = Effect.runSync(
    Effect.cached(
      centralAuth.initialize().pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
    ),
  );
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
  const store = new AgentStore(app.getPath("userData"), homedir());
  await runCauseEffect(store.initialize());
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
    "openbot-skill-creator",
  );
  const dataSkill = new ManagedSkillService(
    app.isPackaged
      ? join(process.resourcesPath, "managed-skills", "openbot-data", "SKILL.md")
      : resolve(__dirname, "../../resources/managed-skills/openbot-data/SKILL.md"),
    undefined,
    undefined,
    "openbot-data",
  );
  await Effect.runPromise(managedSkills.syncAll(store.list()));
  await Effect.runPromise(skillCreator.syncAll(store.list()));
  await Effect.runPromise(dataSkill.syncAll(store.list()));
  const hostedSites = new HostedSiteDesktopService(centralAuth, () => {
    // Read at request time: the team store is created later, and the server can register after launch.
    const hostId = teamStore.getIdentity()?.serverId;
    return hostId ? centralAuth.hostSiteCredential(hostId) : null;
  });
  const billing = new BillingDesktopService(centralAuth, (url) => shell.openExternal(url));
  const hostedServers = new HostedServerDesktopService(
    withHostingDeveloperKey(centralAuth, hostingDeveloperKey),
    (url) => shell.openExternal(url),
    Date.now,
    // A new server is running, but the joined list has no entry for it yet: read the list again.
    (serverId) => {
      if (!remoteServers.list().some((server) => server.id === serverId))
        void Effect.runPromise(remoteServers.invalidateDirectory());
    },
    (serverId) => remoteServers.hostedServerStarting(serverId),
  );
  const sidebarLayout = new SidebarLayoutStore(join(app.getPath("userData"), SIDEBAR_LAYOUT_FILE));
  await runCauseEffect(sidebarLayout.initialize());
  const mailbox = new MailboxStore(app.getPath("userData"), store.sharedRoot, store.database);
  await runCauseEffect(mailbox.initialize());
  configureApplicationProtocol();
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const teamWebRtcBridge = new TeamWebRtcBridge({
    developmentUrl,
    iceTransportPolicy: developmentUrl && process.env.OPENBOT_DEV_ICE_TRANSPORT_POLICY === "relay" ? "relay" : "all",
  });
  teamWebRtcBridge.on("accountProfileChanged", refreshAccountProfile);
  teardown.push(TEARDOWN_ORDER.teamWebRtcBridge, "the team WebRTC bridge", () =>
    runCauseEffect(teamWebRtcBridge.stop()),
  );
  // Only a hosted server: its machine is small, and one unit holds OpenBot and every agent process.
  const hostMemory = hostedServer
    ? new HostedServerMemory({
        onError: (message, error) => logger.warn(message, toLogValue(error)),
      })
    : null;
  if (hostMemory) {
    hostMemory.start();
    teardown.push(TEARDOWN_ORDER.hostedServerMemory, "the hosted server memory reading", () =>
      Effect.runPromise(hostMemory.stop()),
    );
  }
  const browser = new BrowserHost(mainWindow, store.downloadsRoot, join(app.getPath("userData"), BROWSER_STATE_FILE), {
    memoryLow: () => (hostMemory?.level() ?? "ok") !== "ok",
  });
  teardown.push(TEARDOWN_ORDER.browser, "the browser", () => runCauseEffect(browser.destroy()));
  await runCauseEffect(browser.restore(store.list().map((agent) => ({ id: agent.id, threadId: agent.threadId }))));
  const browserPictureInPicture = new BrowserPictureInPicture({
    // A value, deliberately: the window this is docked to is the one that exists now. The event
    // callback below is the opposite case and re-reads, because it fires long after a macOS window
    // close and rebuild would have made this reference stale.
    mainWindow,
    browser,
    preloadPath: join(__dirname, "../preload/index.cjs"),
    iconPath: appIconPath,
    developmentUrl: process.env.ELECTRON_RENDERER_URL,
    onEvent: (event) => {
      const window = windows.getMainWindow();
      if (!window || window.isDestroyed()) return;
      sendToRenderer(window, IPC_ENDPOINTS.browser.pictureInPictureEvent, event);
    },
  });
  teardown.push(TEARDOWN_ORDER.browserPictureInPicture, "picture in picture", () => browserPictureInPicture.destroy());
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
  const notificationPreference = new NotificationPreferenceStore(
    join(app.getPath("userData"), NOTIFICATION_PREFERENCE_FILE),
  );
  await runCauseEffect(notificationPreference.load());
  const updatePreference = await runCauseEffect(readUpdatePreference(updatePreferenceFile));
  const approvalAutomationFile = join(app.getPath("userData"), APPROVAL_AUTOMATION_FILE);
  const approvalAutomation = new ApprovalAutomation({
    path: approvalAutomationFile,
    initial: await runCauseEffect(
      readApprovalAutomation(
        approvalAutomationFile,
        store.list().map((agent) => agent.id),
        join(app.getPath("userData"), LEGACY_APPROVAL_AUTOMATION_FILE),
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
  const providerRuntimes = new ProviderRuntimeManager({
    root: providerRuntimeRoot({
      appData: app.getPath("appData"),
      userDataOverride: app.commandLine.getSwitchValue("user-data-dir"),
    }),
    downloadRoot: join(app.getPath("userData"), "provider-runtimes", ".downloads"),
    updateRuntime: (runtime, install) => {
      if (isManagedToolRuntime(runtime)) return install().pipe(Effect.asVoid);
      return service
        .updateProviderCli(runtime, () =>
          install().pipe(
            Effect.mapError(
              (error) => new AgentLifecycleFailed({ operation: "updateProviderCli.install", cause: error.cause }),
            ),
          ),
        )
        .pipe(
          Effect.asVoid,
          Effect.mapError((error) => new ProviderRuntimeFailure({ cause: error.cause })),
        );
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
  const mcpOAuthRedirect = await startMcpOAuthRedirectServer({
    language,
    deliver: (state, code) => {
      if (!mcpOAuthAuthority?.receiveAuthorizationCode(state, code)) return false;
      const current = windows.getMainWindow();
      if (current && !current.isDestroyed()) showMainWindow(current);
      return true;
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
    openExternal: (url) => shell.openExternal(url),
    redirectUrl: mcpOAuthRedirect?.redirectUrl ?? MCP_OAUTH_REDIRECT_URL,
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
    openExternal: (url) => shell.openExternal(url),
  });
  await runCauseEffect(githubConnector.load());
  teardown.push(TEARDOWN_ORDER.githubConnector, "the GitHub connection", () =>
    runCauseEffect(githubConnector.dispose()),
  );
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
    openExternal: (url) => shell.openExternal(url),
  });
  await runCauseEffect(onePasswordConnector.load());
  teardown.push(TEARDOWN_ORDER.onePasswordConnector, "the 1Password connection", () =>
    runCauseEffect(onePasswordConnector.dispose()),
  );
  const tables = new AgentTables({
    sharedRoot: store.sharedRoot,
    supervisor: new AgentDatabaseSupervisor({ spawnHost: spawnAgentDatabaseHost }),
  });
  // Looked up again on demand, because a user may install the driver while OpenBot runs, and the
  // panel's "Check again" has to see it.
  const resolveCuaDriverExecutable = () =>
    resolveCuaDriver({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      sourceRoot: resolve(__dirname, "../.."),
      platform: process.platform,
      architecture: process.arch,
      homeDirectory: homedir(),
      pathVariable: process.env.PATH ?? null,
      overrides: [process.env.OPENBOT_CUA_DRIVER_PATH, process.env.CUA_DRIVER_PATH],
      installDirectory: process.env.CUA_DRIVER_RS_INSTALL_DIR ?? process.env.CUA_DRIVER_BIN_DIR,
      localAppDataDirectory: process.env.LOCALAPPDATA,
      applicationsDirectory: "/Applications",
    });
  const cuaDriver = new CuaDriverRuntime({
    executable: await Effect.runPromise(resolveCuaDriverExecutable()),
    resolveExecutable: resolveCuaDriverExecutable,
    // Linux ships as an AppImage, whose mount is somewhere else at each launch, so the command the
    // proxies are given is a link below the profile rather than the path inside the mount.
    commandAlias: cuaDriverCommandAlias({
      platform: process.platform,
      isPackaged: app.isPackaged,
      appImagePath: process.env.APPIMAGE,
      userDataPath: app.getPath("userData"),
    }),
    endpoint: await runCauseEffect(
      resolveCuaDriverEndpoint({
        platform: process.platform,
        userDataPath: app.getPath("userData"),
        temporaryDirectory: tmpdir(),
        runtimeDirectory: process.env.XDG_RUNTIME_DIR,
      }),
    ),
    supported: isSupportedCuaDriverTarget(process.platform, process.arch),
    hostBundleId: app.isPackaged ? PACKAGED_BUNDLE_IDENTIFIER : DEVELOPMENT_BUNDLE_IDENTIFIER,
    platform: process.platform,
    onDiagnostic: (message) => {
      Effect.runFork(appendRemoteDiagnosticLog(join(app.getPath("userData"), "logs", "remote"), "cua-driver", message));
    },
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
    readTarget: async (previous) => {
      if (!cuaDriver.mcpServerForProviders()) return null;
      // The rim marks work in progress, so it goes down with the last turn: completed, failed or
      // cancelled. The driver's lease outlives the turn, so only an action made while a turn that
      // still runs was running counts: a lease left by the turn before would put the rim over a
      // turn that does not touch the desktop. Neither a lease nor an action names its agent, so the
      // oldest running turn is the bound: a newer turn of another agent does not hide this one's
      // rim. `service` is built below; the controller starts only after it.
      const turnStartedAt = service.earliestRunningTurnStartedAt();
      if (turnStartedAt === null) return null;
      const session = liveSession(
        await runCauseEffect(computerUseReads.sessions()),
        (Date.now() - turnStartedAt) / 1000,
      );
      if (!session) return null;
      const windows = await runCauseEffect(computerUseReads.listWindows());
      const action = cuaDriver.lastAction(COMPUTER_USE_ACTION_MAX_AGE_MS);
      return chooseTarget({
        windows,
        session,
        action,
        ownPid: process.pid,
        previous,
        toDesktop: computerUseDesktopRect,
      });
    },
  });
  // Before the daemon stops, so the rim is gone rather than left over a window nothing drives, and
  // so the read connection lets its lease go while there is still a daemon to tell.
  teardown.push(TEARDOWN_ORDER.computerUseHighlight, "the Computer Use highlight", async () => {
    computerUseHighlight.destroy();
    await Effect.runPromise(computerUseReads.close());
  });
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
  const service: AgentService = new AgentService({
    store,
    mailbox,
    browser,
    hostMemory,
    requestTimeoutMs: 30_000,
    preferredProvider: setupState.preferredProvider ?? "codex",
    bundledExecutables: providerRuntimes.bundledExecutables(),
    prepareAgentWorkspace: (agent) =>
      Effect.gen(function* () {
        yield* managedSkills.syncAgent(agent);
        yield* skillCreator.syncAgent(agent);
        yield* dataSkill.syncAgent(agent);
      }),
    hostedSites: {
      list: () =>
        hostedSites.list().pipe(Effect.mapError((error) => new HostedSiteOperationFailed({ cause: error.cause }))),
      publish: (input, roots) =>
        hostedSites
          .publish(input, roots)
          .pipe(Effect.mapError((error) => new HostedSiteOperationFailed({ cause: error.cause }))),
      replace: (input, roots) =>
        hostedSites
          .replace(input, roots)
          .pipe(Effect.mapError((error) => new HostedSiteOperationFailed({ cause: error.cause }))),
      delete: (siteId) =>
        hostedSites
          .delete(siteId)
          .pipe(Effect.mapError((error) => new HostedSiteOperationFailed({ cause: error.cause }))),
    },
    sidebarLayout,
    preferredModel: setupState.preferredModel,
    // Only a dev build leads with the OpenCode development model; a packaged app keeps the
    // built-in default.
    developmentDefaults: appVariant === "dev",
    credentials: {
      apiKey: (provider) => providerCredentials.get(provider),
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
      // The bearer token for an http server, minted here and spent by the provider process. The
      // service asks for one at each hand-off; only a test the user pressed may open a browser.
      mcpOAuth,
      providerStateDirectory: join(app.getPath("userData"), "provider-state"),
      // Paths only: `gh` and `git` read the token from the files the connection keeps current.
      agentEnvironment: (inherited) => githubConnector.agentEnvironment(inherited),
    },
    // Appended to the stored servers at each spawn, so the same tools reach Codex, Claude and the
    // ACP providers. Null until the daemon runs, which is what keeps a machine with no driver from
    // handing every provider a command it cannot start.
    computerUseMcpServer: () => cuaDriver.mcpServerForProviders(),
    githubConnector: {
      mcpServer: () => githubConnector.mcpServer(),
      mcpAuthorization: () =>
        githubConnector
          .mcpAuthorization()
          .pipe(Effect.mapError((error) => new McpGatewayFailed({ cause: error.cause }))),
    },
    passwordVault: onePasswordConnector,
    localSkillTools: () => localSkillTools(skills),
    approvalAutomation,
    deleteWithRevokedApproval: (agentId, remove) =>
      approvalAutomation
        .deleteAgent(agentId, remove)
        .pipe(Effect.mapError((error) => new AgentRemovalFailed({ cause: error.cause }))),
    tables,
  });
  teardown.push(TEARDOWN_ORDER.service, "the agent service", () => runCauseEffect(service.stop()));
  // Listens only while an agent allows local scripts; see `AutomationServer`.
  const automation = new AutomationServer({
    root: store.automationRoot,
    listAgents: () => service.listAgents(),
    listRoutines: (agentId) => service.listRoutines(agentId),
    runRoutine: (input) => service.runRoutineFromAutomation(input),
  });
  service.on("event", (event) => {
    if (event.type === "agents-changed") void automation.sync();
  });
  teardown.push(TEARDOWN_ORDER.automation, "the automation server", () => automation.stop());
  /*
   * The Slack workspaces where the agents answer. The tokens use the same cipher as every other
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
  // The Signal socket that brings the events of the Slack workspaces linked to this host. The host
  // id is read when the socket opens, and the team store is built further down, so it starts as "no
  // name yet".
  let slackIngressHostId: () => string | null = () => null;
  const slackIngress = new SlackIngress({
    hostId: () => slackIngressHostId(),
    signedIn: () => {
      try {
        centralAuth.getSignedInUser();
        return true;
      } catch {
        return false;
      }
    },
    issueTicket: (hostId) =>
      centralAuth
        .issueRemoteHostTicket(hostId)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
    issueSlackRoute: (hostId) =>
      centralAuth
        .issueSlackRoute(hostId)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
  });
  teardown.push(TEARDOWN_ORDER.slackIngress, "the Slack ingress socket", () =>
    Effect.runPromise(slackIngress.dispose()),
  );
  // Development only: `bun run dev:slack` names this loopback port, so a Slack install returns to this
  // dev app and not to an installed OpenBot that owns `openbot://`.
  const developmentSlackCallbackPort = app.isPackaged ? 0 : Number(process.env.OPENBOT_DEV_SLACK_CALLBACK_PORT ?? 0);
  const messaging = new MessagingService({
    threads: service.messaging,
    agents: {
      listAgents: () => service.listAgents(),
      respondToApproval: (input) => service.respondToApproval(input),
      onEvent: (listener) => {
        service.on("event", listener);
        return () => service.off("event", listener);
      },
      createAgentProfile: (input) => service.createAgentProfile(input),
      createMemory: (input) => service.createMemory(input),
    },
    credentials: messagingCredentials,
    drivers: [slackDriver({ ingress: slackIngress })],
    downloadsRoot: join(app.getPath("userData"), "messaging-downloads"),
    ingress: slackIngress,
    sidebar: sidebarLayout,
    slackApp: {
      authorize: (input) =>
        Effect.suspend(() => {
          const hostId = slackIngressHostId();
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
            .pipe(Effect.mapError((error) => new SlackConnectFailed({ cause: error.cause })));
        }),
      unlink: (workspaceId) =>
        Effect.suspend(() => {
          const hostId = slackIngressHostId();
          return hostId
            ? centralAuth
                .unlinkSlackWorkspace(hostId, workspaceId)
                .pipe(Effect.mapError((error) => new SlackConnectFailed({ cause: error.cause })))
            : Effect.void;
        }),
      openExternal: (url) => shell.openExternal(url),
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
    teardown.push(TEARDOWN_ORDER.slackIngress, "the Slack development callback", () => callback.close());
  }
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
  // provider session, so the driver stays quiet for a grant, for the warm-up below, and for the
  // stop at teardown, where the sessions are being left for the next run.
  cuaDriver.onMcpServerChanged(() => {
    void runCauseEffect(service.notifyComputerUseChanged()).catch((error) =>
      logger.warn("Provider tools did not refresh.", toLogValue(error)),
    );
  });
  // The rim follows the daemon: it can show nothing while the agents hold no tools, and polling a
  // socket nothing answers would only log failures.
  cuaDriver.onMcpServerChanged(() => {
    if (cuaDriver.mcpServerForProviders()) computerUseHighlight.start();
    else {
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
  const computerUseWarmUp = runCauseEffect(cuaDriver.warmUp());
  computerUseWarmUp.catch(() => undefined);
  // The warm-up tells no listener on purpose, so the rim has to read the result itself: a user who
  // granted the permissions has a running daemon from here on, and nothing else would start it.
  void computerUseWarmUp
    .then(() => {
      if (cuaDriver.mcpServerForProviders()) computerUseHighlight.start();
    })
    .catch(() => undefined);
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
  providerRuntimes.startUpdateChecks();
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
      logs: [join(userData, "logs", "remote"), join(userData, "logs", "update"), join(userData, "logs", "providers")],
      runtimes: providerRuntimeRoot({
        appData: app.getPath("appData"),
        userDataOverride: app.commandLine.getSwitchValue("user-data-dir"),
      }),
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
  slackIngressHostId = () => teamStore.getIdentity()?.serverId ?? null;
  slackIngress.reconnect();
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
  const remoteDesktopRuntime = await Effect.runPromise(
    resolveRemoteDesktopRuntime({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      sourceRoot: resolve(__dirname, "../.."),
      platform: process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux",
      architecture: process.arch,
      overrideRoot: process.env.OPENBOT_REMOTE_DESKTOP_RUNTIME_PATH,
    }),
  );
  const agentAdminSettings = createAgentAdminSettings({ agents: service, approvalAutomation });
  const customProviderChanges = createCustomProviderChanges({ service, customProviders });
  const customAgentChanges = createCustomAgentChanges({ service, customAgents });
  // The host comes before the updater, and the restart readiness reads the host. The routes reach
  // the schedule through this, and a request that arrives before it exists is refused.
  let requestedUpdate: RequestedUpdate | undefined;
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
    undefined,
    join(app.getPath("userData"), "agent-import-uploads"),
  );
  const host = new HostService({
    appVersion: app.getVersion(),
    store: teamStore,
    agents: service,
    skills,
    sidebarLayout,
    mailbox,
    browser,
    chat: teamChatStore,
    channels: service.channels,
    // Present, so the host advertises `mcp-servers-v1`. The routes are admin-only.
    mcpServers: service,
    // Present, so the host advertises `storage-v1`. Members read; only admins delete or clear.
    storage: storageUsage,
    // Present, so the host advertises `hosted-sites-v1`. Members list; only admins delete.
    hostedSites,
    // Present, so the host advertises `agent-import-v1`. Any member can import.
    agentImport,
    // Each member present advertises its admin capability. Every admin route requires an owner or admin.
    admin: {
      agents: agentAdminSettings,
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
      update: {
        snapshot: () => scheduledUpdate().snapshot(),
        check: () => scheduledUpdate().check(),
        start: (member, mode) => scheduledUpdate().start(member, mode),
        cancel: () => scheduledUpdate().cancel(),
        changeSettings: (change) => scheduledUpdate().changeSettings(change),
      },
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
    registerRemoteHost: (input) =>
      centralAuth
        .registerRemoteHost(input)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
    issueRemoteHostTicket: (hostId) =>
      centralAuth
        .issueRemoteHostTicket(hostId)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
    sendLiveActivityPush: (hostId, push) =>
      centralAuth
        .sendLiveActivityPush(hostId, push)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
    verifyRemoteSessionTicket: (ticket) =>
      centralAuth
        .verifyRemoteSessionTicket(ticket)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
    endRemoteSession: (sessionId) =>
      centralAuth
        .endRemoteSession(sessionId)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
    remoteControlPlaneUrl: centralAuth.resolveApiUrl("/"),
    createRemoteInvite: (hostId, input) =>
      centralAuth
        .createRemoteInvite(hostId, input)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
    listRemoteInvites: (hostId) =>
      centralAuth
        .listRemoteInvites(hostId)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
    revokeRemoteInvite: (inviteId) =>
      centralAuth
        .revokeRemoteInvite(inviteId)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
    listRemoteMembers: (hostId) =>
      centralAuth
        .listRemoteMembers(hostId)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
    updateRemoteMember: (hostId, membershipId, role, reactivate) =>
      centralAuth
        .updateRemoteMember(hostId, membershipId, role, reactivate)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
    removeRemoteMember: (hostId, membershipId) =>
      centralAuth
        .removeRemoteMember(hostId, membershipId)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
    updateRemoteHostLogo: (hostId, image, version) =>
      centralAuth
        .updateRemoteHostLogo(hostId, image, version)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
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
      centralAuth
        .redeemTeamAuthTicket(ticket, serverId)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
    sendTeamInviteEmail: (input) =>
      centralAuth
        .sendTeamInviteEmail(input)
        .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
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
        ).pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause })));
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
    getRemoteDesktopIceServers: () =>
      Effect.try({
        try: () => {
          if (developmentRemoteRole === "host") return [];
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
  if (signedInState.status === "signed_in") {
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
  const catalogPluginServers = await Effect.runPromise(
    loadCatalogPluginServers(
      app.isPackaged
        ? join(process.resourcesPath, "plugin-catalog")
        : resolve(__dirname, "../../resources/plugin-catalog"),
    ),
  );
  const analytics = new HostAnalytics({
    enabled: app.isPackaged && appVariant === "production",
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
        // The local read: `listInstalled` asks the marketplace for each skill's latest version.
        skills: (agentId) => skills.listInstalledForChatTags(agentId),
        mcpServers: () => service.listMcpServers(),
        pluginSlug: (config) => catalogPluginSlug(config, catalogPluginServers, homedir()),
        computerUseEnabled: () => cuaDriver.mcpServerForProviders() !== null,
      }),
    inventoryDay: analyticsInventoryDayStore(join(app.getPath("userData"), ANALYTICS_INVENTORY_FILE)),
  });
  teardown.push(TEARDOWN_ORDER.analytics, "host analytics", () => Effect.runPromise(analytics.close()));
  // Immediately after construction: this attributes buffered events to the current owner rather
  // than flushing a queue, so a later call would attribute them to nobody.
  analytics.flushPending();
  const trace = new TraceFile({ directory: join(app.getPath("userData"), "logs") });
  teardown.push(TEARDOWN_ORDER.trace, "the trace file", () => Effect.runPromise(trace.flush()));
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
      getLocalHostId: () => teamStore.getIdentity()?.serverId ?? null,
      hostedServers: {
        unavailable: (serverId, wake) => hostedServers.unavailableHost(serverId, wake),
        wake: (serverId) => hostedServers.wake(serverId),
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
        getPrincipalId: () => centralAuth.getSignedInUser().id,
        controlPlaneUrl: centralAuth.resolveApiUrl("/"),
        downloadHostLogo: (hostId, version) => centralAuth.downloadRemoteHostLogo(hostId, version),
        transferDirectory: join(app.getPath("userData"), "remote-transfers"),
      }),
    },
  );
  // A server joined or revoked on another device of this account. Signal carries it to every socket
  // the account holds, so the phone's join reaches this computer in the second it happens rather
  // than at the next account check. The refresh itself belongs to the entry point, which owns the
  // account check and its coalescing; this only forwards the notice to it.
  teamWebRtcBridge.on("accountServersChanged", () => void Effect.runPromise(remoteServers.invalidateDirectory()));
  teardown.push(TEARDOWN_ORDER.remoteServers, "the remote servers", () => runCauseEffect(remoteServers.stop()));
  await runCauseEffect(remoteServers.initialize());
  criticalActionTargets = { agents: service, remoteServers };
  // After `remoteServers.initialize()`. The client half polls for the host's connection file and
  // throws when it never appears, before any window is shown - see the module it lives in.
  if (developmentRemoteRole) {
    await runCauseEffect(
      startDevelopmentRemoteRole({
        role: developmentRemoteRole,
        testClientEnabled: developmentTestClientEnabled,
        host,
        remoteServers,
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
  const voice = new VoiceTranscriptionService({
    resourcesRoot: app.isPackaged ? join(process.resourcesPath, "whisper") : resolve(".openbot-build/whisper"),
    modelPath: app.isPackaged
      ? join(app.getPath("userData"), "runtimes", "whisper", WHISPER_MODEL_NAME)
      : resolve(".openbot-build/whisper/model", WHISPER_MODEL_NAME),
    modelDownloadUrl: WHISPER_MODEL_URL,
  });
  teardown.push(TEARDOWN_ORDER.voice, "voice transcription", () => Effect.runPromise(voice.shutdown()));
  voice.on("modelStatus", forwardVoiceModelStatus);
  const currentVersion = app.getVersion();
  // Skip the file check in dev: unpacked runs never enable updates, so avoid touching resourcesPath.
  const updateMetadataAvailable = app.isPackaged && existsSync(join(process.resourcesPath, "app-update.yml"));
  const updatesEnabled =
    app.isPackaged &&
    supportsInstalledUpdates(process.platform) &&
    updateMetadataAvailable &&
    isValidSemver(currentVersion);
  if (app.isPackaged && updateMetadataAvailable && !isValidSemver(currentVersion)) {
    logger.warn(`OpenBot updates are disabled because the application version is not valid SemVer: ${currentVersion}`);
  }
  let updateAdapter: UpdateAdapter = createDisabledUpdateAdapter();
  let updaterEnabled = updatesEnabled;
  if (updatesEnabled) {
    try {
      const updaterModule = await import("electron-updater");
      const realAdapter = updaterModule.autoUpdater ?? updaterModule.default?.autoUpdater ?? updaterModule.default;
      if (realAdapter) {
        updateAdapter = realAdapter;
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
    checkSiblingInstances: app.isPackaged
      ? async () => {
          const siblings = await listSiblingOpenBotInstances({
            executablePath: app.getPath("exe"),
            currentPid: process.pid,
            platform: process.platform,
          });
          if (siblings.length > 0) {
            const list = siblings.map(({ pid, uid }) => `pid ${pid} (uid ${uid})`).join(", ");
            logger.warn(`OpenBot update install refused: other OpenBot processes run from this application: ${list}`);
          }
          return siblings;
        }
      : undefined,
    currentUid: typeof process.getuid === "function" ? process.getuid() : undefined,
    platform: process.platform,
    logDirectory: join(app.getPath("userData"), "logs", "update"),
    // Squirrel.Mac only. The path is meaningless under a Linux or Windows home directory.
    shipItDirectory:
      process.platform === "darwin" ? join(homedir(), "Library", "Caches", "app.openbot.desktop.ShipIt") : undefined,
  });
  teardown.push(TEARDOWN_ORDER.updater, "the update service", () => Effect.runPromise(updater.stop()));
  const agentInitialization = new AgentInitializationGate(() =>
    Effect.gen(function* () {
      yield* Effect.promise(() => computerUseWarmUp.catch(() => undefined));
      yield* service.initialize({ heldRoutines: takeRoutineHold(routineHoldFile, (message) => logger.warn(message)) });
      yield* Effect.tryPromise({
        try: () => automation.sync(),
        catch: (cause) => new AgentLifecycleFailed({ operation: "automationListener", cause }),
      });
    }),
  );
  const describeRestartReadiness = (): RestartReadiness =>
    checkRestartReadiness({
      agentWork: service.hasActiveWork(),
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
  requestedUpdate = new RequestedUpdate({
    updater,
    describeReadiness: describeRestartReadiness,
    preference: updatePreference,
    savePreference: (change) => writeUpdatePreference(updatePreferenceFile, change),
    log: (message) => logger.info(message),
    announce: (state, version) => host.announceRestart(state, version),
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
          if (centralAuth.getState().status !== "signed_in")
            yield* centralAuth
              .retry()
              .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause })));
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
      // A live Slack connection counts: stopped, the server could not hear the next message. An open
      // browser view does not: a view that the user forgot would keep the server running. Input in
      // the view counts as client use.
      inUse: () =>
        service.hasActiveWork().length > 0 ||
        messaging.hasLiveConnection() ||
        host.describeRestartBlockers().some((reason) => reason !== "browser-view") ||
        (host.connectedClientCount() > 0 && Date.now() - (host.lastClientUseAt() ?? 0) < CLIENT_USE_WINDOW_MS),
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
          .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause }))),
      onError: (message, error) => logger.warn(message, toLogValue(error)),
    });
    hostedServerActivity.start();
    teardown.push(TEARDOWN_ORDER.hostedServerActivity, "the hosted server activity report", () =>
      Effect.runPromise(hostedServerActivity.stop()),
    );
  }
  const serverMode = serverModeEnvironment
    ? new ServerMode({
        environment: serverModeEnvironment,
        version: app.getVersion(),
        centralAuth,
        host,
        onError: (message, error) => logger.warn(message, toLogValue(error)),
      })
    : null;
  if (serverMode) {
    // Without the socket the server still runs, and the log says why nobody can sign it in.
    await serverMode
      .listen()
      .catch((error) => logger.error("The server control socket did not start:", toLogValue(error)));
    // Nobody presses Retry on a server either. A server that is signed out has nothing to publish.
    const serverStartRetry = new HostedServerStartRetry({
      hostPhase: () => host.getStatus().phase,
      startHost: () =>
        Effect.gen(function* () {
          if (centralAuth.getState().status === "error")
            yield* centralAuth
              .retry()
              .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause })));
          yield* serverMode.publish();
        }),
      onError: (message, error) => logger.warn(message, toLogValue(error)),
    });
    serverStartRetry.start();
    teardown.push(TEARDOWN_ORDER.serverMode, "the server control socket", async () => {
      await Effect.runPromise(serverStartRetry.stop());
      await serverMode.close();
    });
  }
  await runCauseEffect(hostUpdateCoordinator.tick());
  hostUpdateCoordinator.start();
  teardown.push(TEARDOWN_ORDER.hostUpdateCoordinator, "the host update coordinator", () =>
    Effect.runPromise(hostUpdateCoordinator.stop()),
  );

  return {
    service,
    providerRuntimes,
    providerCredentials,
    messaging,
    mcpOAuth,
    githubConnector,
    onePasswordConnector,
    mailbox,
    storageUsage,
    browser,
    browserPictureInPicture,
    browserView,
    updater,
    setupFile,
    analyticsPreferenceFile,
    updatePreferenceFile,
    approvalAutomation,
    agentAdminSettings,
    language,
    logoColor,
    notificationPreference,
    agentInitialization,
    hostUpdateCoordinator,
    requestedUpdate: remoteUpdate,
    idleRestart,
    describeRestartReadiness,
    sidebarLayout,
    host,
    remoteDesktop,
    remoteServers,
    centralAuth,
    skills,
    hostedSites,
    billing,
    hostedServers,
    serverMode,
    customProviders,
    customProviderChanges,
    customAgentChanges,
    providerDetection,
    providerDetectionSettings,
    marketplaceAgents,
    agentTemplates,
    agentImport,
    voice,
    dynamicIsland,
    cuaDriver,
    computerUseHighlight,
    computerUsePermissionHelp,
    analytics,
    trace,
    teamStore,
    appliedAccount: signedInState,
    centralAuthInitialization,
  };
}
