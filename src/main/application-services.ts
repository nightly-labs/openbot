import { isManagedRuntimeProvider } from "@openbot/contracts/agent-providers";
import { AgentDatabaseSupervisor } from "../backend/agent-data/agent-database-supervisor";
import { AgentTables } from "../backend/agent-data/agent-tables";
import { spawnAgentDatabaseHost } from "./agent-database-host-process";
import { LocalSkillLibrary } from "./local-skill-library";
import { localSkillTools } from "./local-skill-tools";
import { MAC_PERMISSION_URLS } from "./mac-permission-urls";
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
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { REMOTE_ACCOUNT_CHECK_INTERVAL_MS } from "@openbot/team-client";
import { app, type BrowserWindow, nativeImage, safeStorage, screen, shell } from "electron";
import { AgentService } from "../backend/agent-service";
import { AgentStore } from "../backend/agent-store";
import { BrowserHost } from "../backend/browser-host";
import { MailboxStore } from "../backend/mailbox-store";
import { McpOAuth } from "../backend/mcp-oauth-provider";
import { SidebarLayoutStore } from "../backend/sidebar-layout-store";
import { StorageUsageScanner, StorageUsageService } from "../backend/storage-usage";
import { TeamChatStore } from "../backend/team-chat-store";
import { AgentImportService } from "./agent-import-service";
import { AgentInitializationGate } from "./agent-initialization";
import { AgentMarketplaceService } from "./agent-marketplace-service";
import { HostAnalytics } from "./analytics";
import { readAnalyticsPreference } from "./analytics-preference-store";
import { ApprovalAutomation, readApprovalAutomation } from "./approval-automation-store";
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
import { CustomProviderStore } from "./custom-provider-store";
import { MCP_OAUTH_REDIRECT_URL } from "./deep-link-router";
import {
  applyDevelopmentRemoteAccount,
  type DevelopmentRemoteRole,
  startDevelopmentRemoteRole,
} from "./development-remote-bootstrap";
import { performDynamicIslandCriticalAction } from "./dynamic-island-actions";
import { DynamicIslandWindowController } from "./dynamic-island-window";
import { HostService } from "./host-service";
import { HostUpdateCoordinator } from "./host-update-coordinator";
import { HostedSiteDesktopService } from "./hosted-site-service";
import { LanguageService } from "./language-service";
import type { MacHapticFeedback } from "./mac-haptic-feedback";
import {
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
import { NotificationPreferenceStore } from "./notification-preference-store";
import { ProviderCredentialStore } from "./provider-credential-store";
import { ProviderRuntimeManager, providerRuntimeRoot } from "./provider-runtime-manager";
import { RemoteDesktopManager } from "./remote-desktop-manager";
import { resolveRemoteDesktopRuntime } from "./remote-desktop-runtime-artifact";
import { loadOrCreateRemoteDesktopCredentials } from "./remote-desktop-secret-store";
import { appendRemoteDiagnosticLog } from "./remote-diagnostics";
import { decodeVoid } from "./remote-host-decoding";
import { RemoteServerManager } from "./remote-server-manager";
import { sendToRenderer } from "./renderer-ipc";
import {
  configureApplicationProtocol,
  configureAttachmentProtocol,
  configureServerLogoProtocols,
} from "./session-configuration";
import { readSetupState } from "./setup-store";
import { SkillMarketplaceService } from "./skill-marketplace-service";
import { TeamStore } from "./team-store";
import { TeamWebRtcBridge } from "./team-webrtc-bridge";
import { TeamWebRtcClientTransport } from "./team-webrtc-client-transport";
import type { TeardownRegistry } from "./teardown-registry";
import { readUpdatePreference } from "./update-preference-store";
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
const APPROVAL_AUTOMATION_FILE = "openbot-approval-automation-v2.json";
const LEGACY_APPROVAL_AUTOMATION_FILE = "openbot-approval-automation-v1.json";
const LANGUAGE_PREFERENCE_FILE = "openbot-language-preference-v1.json";
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
/** The MCP sign-ins. Separate from the keys above: a key is typed by the user, a token is not. */
const MCP_OAUTH_FILE = "openbot-mcp-oauth-v1.json";

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
  hostUpdateCoordinator: 12,
  computerUseHighlight: 18,
  computerUsePermissionHelp: 19,
  dynamicIsland: 20,
  browser: 30,
  browserPictureInPicture: 40,
  browserView: 45,
  providerRuntimes: 50,
  cuaDriver: 55,
  remoteServers: 60,
  voice: 70,
  remoteDesktop: 80,
  host: 90,
  teamWebRtcBridge: 100,
  mcpOAuthRedirect: 105,
  service: 110,
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
  /** Reached by the entry point for one thing only: handing a returning grant to its sign-in. */
  mcpOAuth: McpOAuth;
  mailbox: MailboxStore;
  storageUsage: StorageUsageService;
  browser: BrowserHost;
  browserPictureInPicture: BrowserPictureInPicture;
  browserView: BrowserViewClient;
  updater: UpdateService;
  /** Point-in-time restart safety for host-managed updates. Nothing holds the instance when empty. */
  describeRestartReadiness: () => RestartReadiness;
  hostUpdateCoordinator: HostUpdateCoordinator;
  setupFile: string;
  analyticsPreferenceFile: string;
  updatePreferenceFile: string;
  approvalAutomation: ApprovalAutomation;
  language: LanguageService;
  notificationPreference: NotificationPreferenceStore;
  agentInitialization: AgentInitializationGate;
  sidebarLayout: SidebarLayoutStore;
  host: HostService;
  remoteDesktop: RemoteDesktopManager;
  remoteServers: RemoteServerManager;
  centralAuth: CentralAuthManager;
  skills: SkillMarketplaceService;
  hostedSites: HostedSiteDesktopService;
  customProviders: CustomProviderStore;
  marketplaceAgents: AgentMarketplaceService;
  agentImport: AgentImportService;
  voice: VoiceTranscriptionService;
  dynamicIsland: DynamicIslandWindowController;
  cuaDriver: CuaDriverRuntime;
  computerUseHighlight: ComputerUseHighlightController;
  computerUsePermissionHelp: ComputerUsePermissionHelpWindowController;
  analytics: HostAnalytics;
  teamStore: TeamStore;
  /**
   * The account state this function read part-way through, and bound the local host to. The
   * entry point compares it against the current state to find an account that settled after
   * that read, while `forwardCentralAuth` still had no services to apply it to.
   */
  appliedAccount: CentralAuthState;
  /** Left un-awaited on purpose: the account settles in the background while the app opens. */
  centralAuthInitialization: Promise<CentralAuthState>;
}

/** How the driver's own state reads as the capability the Team API projects. */
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
  macHapticFeedback,
  teardown,
  forwardCentralAuth,
  forwardBrowserDisplayState,
  forwardProviderRuntimeStatus,
  forwardVoiceModelStatus,
  prepareForUpdateInstall,
}: ApplicationServiceContext): Promise<ApplicationServices> {
  // The one forward reference left in this function: the controller is built at the top of
  // startup because its window must be able to appear immediately, but the two services its
  // critical actions drive are built hundreds of lines below. A single named local rather than
  // two lazy getters, so the gap is visible and bounded.
  let criticalActionTargets: { agents: AgentService; remoteServers: RemoteServerManager } | null = null;
  const dynamicIsland = new DynamicIslandWindowController({
    platform: process.platform,
    preferencePath: join(app.getPath("userData"), DYNAMIC_ISLAND_PREFERENCE_FILE),
    createWindow: createDynamicIslandWindow,
    loadWindow: loadDynamicIslandRenderer,
    getDisplays: () => screen.getAllDisplays(),
    getMainWindow: windows.getMainWindow,
    ensureMainWindow: windows.ensureMainWindow,
    presentMainWindow: showMainWindow,
    performHaptic: () => macHapticFeedback.performAlignment(),
    performCriticalAction: async (action) => {
      if (!criticalActionTargets) throw new Error("OpenBot is not ready.");
      const { agents, remoteServers } = criticalActionTargets;
      await performDynamicIslandCriticalAction(action, agents, remoteServers, decodeVoid);
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
    canPersist: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("macOS secure storage is unavailable.");
      }
      return safeStorage.encryptString(value);
    },
    decrypt: (value) => safeStorage.decryptString(value),
  });
  // Registered before `initialize()`, which publishes `{ status: "loading" }` synchronously: the
  // listener therefore runs on the next line with most of this function's services still unbuilt.
  centralAuth.on("changed", forwardCentralAuth);
  const centralAuthInitialization = centralAuth.initialize();
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
        await centralAuth.refreshProfile();
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
  await store.initialize();
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
  await managedSkills.syncAll(store.list());
  await skillCreator.syncAll(store.list());
  await dataSkill.syncAll(store.list());
  const hostedSites = new HostedSiteDesktopService(centralAuth);
  const sidebarLayout = new SidebarLayoutStore(join(app.getPath("userData"), SIDEBAR_LAYOUT_FILE));
  await sidebarLayout.initialize();
  const mailbox = new MailboxStore(app.getPath("userData"), store.sharedRoot, store.database);
  await mailbox.initialize();
  configureApplicationProtocol();
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const teamWebRtcBridge = new TeamWebRtcBridge({
    developmentUrl,
    iceTransportPolicy: developmentUrl && process.env.OPENBOT_DEV_ICE_TRANSPORT_POLICY === "relay" ? "relay" : "all",
  });
  teamWebRtcBridge.on("accountProfileChanged", refreshAccountProfile);
  teardown.push(TEARDOWN_ORDER.teamWebRtcBridge, "the team WebRTC bridge", () => teamWebRtcBridge.stop());
  const browser = new BrowserHost(mainWindow, store.downloadsRoot, join(app.getPath("userData"), BROWSER_STATE_FILE));
  teardown.push(TEARDOWN_ORDER.browser, "the browser", () => browser.destroy());
  await browser.restore(store.list().map((agent) => ({ id: agent.id, threadId: agent.threadId })));
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
  const setupState = await readSetupState(setupFile);
  const analyticsPreference = await readAnalyticsPreference(analyticsPreferenceFile);
  // Loaded before the first window and before the application menu is built, so every native
  // surface draws in the saved language on the first frame rather than switching after startup.
  const language = new LanguageService({
    path: join(app.getPath("userData"), LANGUAGE_PREFERENCE_FILE),
    systemLocale: app.getLocale(),
  });
  await language.load();
  const notificationPreference = new NotificationPreferenceStore(
    join(app.getPath("userData"), NOTIFICATION_PREFERENCE_FILE),
  );
  await notificationPreference.load();
  const updatePreference = await readUpdatePreference(updatePreferenceFile);
  const approvalAutomationFile = join(app.getPath("userData"), APPROVAL_AUTOMATION_FILE);
  const approvalAutomation = new ApprovalAutomation({
    path: approvalAutomationFile,
    initial: await readApprovalAutomation(
      approvalAutomationFile,
      store.list().map((agent) => agent.id),
      join(app.getPath("userData"), LEGACY_APPROVAL_AUTOMATION_FILE),
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
    updateRuntime: async (runtime, install) => {
      // A tool runtime has no client to swap: the MCP servers are started per thread and read the
      // managed path at the next spawn, so installing it is the whole of the update.
      if (isManagedToolRuntime(runtime)) {
        await install();
        return;
      }
      await service.updateProviderCli(runtime, install);
    },
  });
  teardown.push(TEARDOWN_ORDER.providerRuntimes, "the provider runtimes", () => providerRuntimes.stop());
  // Before `new AgentService`, which reads every `executablePath` eagerly.
  await providerRuntimes.initialize();
  const customProviders = new CustomProviderStore({
    path: join(app.getPath("userData"), CUSTOM_PROVIDERS_FILE),
    cipher: {
      canPersist: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("System secret storage is unavailable.");
        return safeStorage.encryptString(value);
      },
      decrypt: (value) => safeStorage.decryptString(value),
    },
  });
  // Before the service, which reads the endpoints at its first provider spawn. A file this build
  // cannot read leaves the list empty and every write refused; it does not stop the app.
  await customProviders.load();
  /*
   * Loaded before the service, not on first use: a provider spawn reads its key synchronously, so
   * the decrypted map has to already exist by the time any client is built. A machine with no
   * secret storage keeps working on the free tier -- only saving a key needs the cipher.
   */
  const providerCredentials = new ProviderCredentialStore(join(app.getPath("userData"), PROVIDER_CREDENTIAL_FILE), {
    encrypt: (value) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("System secret storage is unavailable.");
      return safeStorage.encryptString(value);
    },
    decrypt: (value) => safeStorage.decryptString(value),
  });
  // An unreadable key file is reported, not fatal: the app starts, OpenCode runs on the free models,
  // and Settings tells the user to save the key again. Only the error's class is logged, because a
  // parse message quotes the file.
  const credentialLoadError = await providerCredentials.load();
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
  const mcpOAuthStore = new McpOAuthStore(join(app.getPath("userData"), MCP_OAUTH_FILE), {
    encrypt: (value) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("System secret storage is unavailable.");
      return safeStorage.encryptString(value);
    },
    decrypt: (value) => safeStorage.decryptString(value),
  });
  const mcpOAuthLoadError = await mcpOAuthStore.load();
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
  const tables = new AgentTables({
    sharedRoot: store.sharedRoot,
    supervisor: new AgentDatabaseSupervisor({ spawnHost: spawnAgentDatabaseHost }),
  });
  // Looked up again on demand, because a user may install the driver while OpenBot runs, and the
  // panel's "Check again" has to see it.
  const resolveCuaDriverExecutable = (): Promise<string | null> =>
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
    executable: await resolveCuaDriverExecutable(),
    resolveExecutable: resolveCuaDriverExecutable,
    // Linux ships as an AppImage, whose mount is somewhere else at each launch, so the command the
    // proxies are given is a link below the profile rather than the path inside the mount.
    commandAlias: cuaDriverCommandAlias({
      platform: process.platform,
      isPackaged: app.isPackaged,
      appImagePath: process.env.APPIMAGE,
      userDataPath: app.getPath("userData"),
    }),
    endpoint: await resolveCuaDriverEndpoint({
      platform: process.platform,
      userDataPath: app.getPath("userData"),
      temporaryDirectory: tmpdir(),
      runtimeDirectory: process.env.XDG_RUNTIME_DIR,
    }),
    supported: isSupportedCuaDriverTarget(process.platform, process.arch),
    hostBundleId: app.isPackaged ? PACKAGED_BUNDLE_IDENTIFIER : DEVELOPMENT_BUNDLE_IDENTIFIER,
    platform: process.platform,
    onDiagnostic: (message) => {
      void appendRemoteDiagnosticLog(join(app.getPath("userData"), "logs", "remote"), "cua-driver", message);
    },
  });
  // After the provider runtimes, which hold the `cua-driver mcp` children that talk to this
  // daemon: stopping it first would leave them reading a socket nothing answers.
  teardown.push(TEARDOWN_ORDER.cuaDriver, "the Computer Use driver", () => cuaDriver.stop());
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
    readPointer: () => cuaDriver.lastPointer(COMPUTER_USE_CURSOR_MAX_AGE_MS),
    readTarget: async (previous) => {
      if (!cuaDriver.mcpServerForProviders()) return null;
      const session = liveSession(await computerUseReads.sessions());
      if (!session) return null;
      const windows = await computerUseReads.listWindows();
      const action = cuaDriver.lastAction(COMPUTER_USE_ACTION_MAX_AGE_MS);
      return chooseTarget({ windows, session, action, ownPid: process.pid, previous });
    },
  });
  // Before the daemon stops, so the rim is gone rather than left over a window nothing drives, and
  // so the read connection lets its lease go while there is still a daemon to tell.
  teardown.push(TEARDOWN_ORDER.computerUseHighlight, "the Computer Use highlight", async () => {
    computerUseHighlight.destroy();
    await computerUseReads.close();
  });
  const computerUsePermissionHelp = new ComputerUsePermissionHelpWindowController({
    createWindow: createComputerUsePermissionHelpWindow,
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
    requestTimeoutMs: 30_000,
    preferredProvider: setupState.preferredProvider ?? "codex",
    bundledExecutables: providerRuntimes.bundledExecutables(),
    prepareAgentWorkspace: async (agent) => {
      await managedSkills.syncAgent(agent);
      await skillCreator.syncAgent(agent);
      await dataSkill.syncAgent(agent);
    },
    hostedSites,
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
    },
    // Appended to the stored servers at each spawn, so the same tools reach Codex, Claude and the
    // ACP providers. Null until the daemon runs, which is what keeps a machine with no driver from
    // handing every provider a command it cannot start.
    computerUseMcpServer: () => cuaDriver.mcpServerForProviders(),
    localSkillTools: () => localSkillTools(skills),
    approvalAutomation,
    deleteWithRevokedApproval: (agentId, remove) => approvalAutomation.deleteAgent(agentId, remove),
    tables,
  });
  teardown.push(TEARDOWN_ORDER.service, "the agent service", () => service.stop());
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
  cuaDriver.onMcpServerChanged(() => service.notifyComputerUseChanged());
  // The rim follows the daemon: it can show nothing while the agents hold no tools, and polling a
  // socket nothing answers would only log failures.
  cuaDriver.onMcpServerChanged(() => {
    if (cuaDriver.mcpServerForProviders()) computerUseHighlight.start();
    else {
      computerUseHighlight.stop();
      // The daemon this connection was opened to is gone, so the socket behind it is too.
      void computerUseReads.close();
    }
  });
  // A user who granted the permissions expects the tools after a restart without opening the panel,
  // and a remote request or a scheduled task opens no window at all. This starts the daemon once and
  // keeps it only when the grants are there; it raises no prompt, so a user who granted nothing sees
  // nothing. It also tells no listener, because the sessions read back from the database were
  // written by a run that had this same entry.
  const computerUseWarmUp = cuaDriver.warmUp();
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
  if (!setupState.completed || service.enabledMcpServers().length > 0) providerRuntimes.ensureToolRuntimes();
  // After `new AgentService`, which owns the channels: the layout files channels beside agents, and
  // reconciling against the agents alone would read every channel as gone and drop where it sits.
  await sidebarLayout.reconcileAgents(service.sidebarChatIds());

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
    if (isManagedToolRuntime(runtime)) service.refreshAllAgentRuntimes();
  });
  const userData = app.getPath("userData");
  const storageSources = {
    roots: {
      database: store.database.path,
      downloads: store.downloadsRoot,
      caches: ["remote-attachments", "remote-shared-files", "remote-workspace-files"].map((name) =>
        join(userData, name),
      ),
      logs: [join(userData, "logs", "remote"), join(userData, "logs", "update")],
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
  // A deleted or renamed agent changes every scope, so no surface keeps its old answer.
  service.on("event", (event) => {
    if (event.type === "agents-changed") storageUsage.invalidate();
  });
  const skills = new SkillMarketplaceService(
    centralAuth,
    () => service.listAgents(),
    async (agentId) => service.refreshAgentRuntime(agentId),
    new LocalSkillLibrary(join(app.getPath("userData"), "local-skills"), () => service.listAgents()),
  );
  const marketplaceAgents = new AgentMarketplaceService(centralAuth, service, skills);
  const agentImport = new AgentImportService(service, {
    library: () => skills.requireLocalLibrary(),
    installLocal: (input) => skills.installLocal(input),
  });
  const teamStore = new TeamStore(
    join(app.getPath("userData"), TEAM_FILE_V2),
    join(app.getPath("userData"), TEAM_FILE),
  );
  await teamStore.initialize();
  // After `teamStore.initialize()` and before `HostService`, which reads the account it activates.
  if (developmentRemoteRole) {
    await applyDevelopmentRemoteAccount({
      role: developmentRemoteRole,
      testClientEnabled: developmentTestClientEnabled,
      centralAuth,
      teamStore,
      setupFile,
      setupCompleted: setupState.completed,
    });
  }
  const teamChatStore = new TeamChatStore(store.database);
  const remoteDesktopRuntime = await resolveRemoteDesktopRuntime({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    sourceRoot: resolve(__dirname, "../.."),
    platform: process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux",
    architecture: process.arch,
    overrideRoot: process.env.OPENBOT_REMOTE_DESKTOP_RUNTIME_PATH,
  });
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
    // The host's Team API routes share the IPC handlers' runtime preparation: a first server
    // saved, enabled, or tested remotely must start and await the managed download like a local one.
    mcpToolRuntimePreparation: {
      startToolRuntimes: () => providerRuntimes.ensureToolRuntimes(),
      ensureToolRuntimesReady: () => providerRuntimes.ensureToolRuntimesReady(),
      toolRuntimes: () => providerRuntimes.mcpToolRuntimes(),
    },
    teamWebRtcBridge,
    registerRemoteHost: (input) => centralAuth.registerRemoteHost(input),
    issueRemoteHostTicket: (hostId) => centralAuth.issueRemoteHostTicket(hostId),
    verifyRemoteSessionTicket: (ticket) => centralAuth.verifyRemoteSessionTicket(ticket),
    endRemoteSession: (sessionId) => centralAuth.endRemoteSession(sessionId),
    remoteControlPlaneUrl: centralAuth.resolveApiUrl("/"),
    createRemoteInvite: (hostId, input) => centralAuth.createRemoteInvite(hostId, input),
    listRemoteInvites: (hostId) => centralAuth.listRemoteInvites(hostId),
    revokeRemoteInvite: (inviteId) => centralAuth.revokeRemoteInvite(inviteId),
    listRemoteMembers: (hostId) => centralAuth.listRemoteMembers(hostId),
    updateRemoteMember: (hostId, membershipId, role, reactivate) =>
      centralAuth.updateRemoteMember(hostId, membershipId, role, reactivate),
    removeRemoteMember: (hostId, membershipId) => centralAuth.removeRemoteMember(hostId, membershipId),
    updateRemoteHostLogo: (hostId, image, version) => centralAuth.updateRemoteHostLogo(hostId, image, version),
    allowLocalDevelopmentInvites: developmentRemoteRole === "host",
    logDirectory: join(app.getPath("userData"), "logs", "remote"),
    removeLegacyRemoteDesktopCredential: async () => {
      const credentialPath = join(app.getPath("userData"), LEGACY_REMOTE_DESKTOP_CREDENTIAL_FILE);
      await Promise.all([rm(credentialPath, { force: true }), rm(`${credentialPath}.tmp`, { force: true })]);
    },
    // Still a function, and still throws when nobody is signed in: the account is a lifetime
    // state of the running app, not a startup-ordering artifact.
    getSignedInUser: () => centralAuth.getSignedInUser(),
    redeemCentralTicket: (ticket, serverId) => centralAuth.redeemTeamAuthTicket(ticket, serverId),
    sendTeamInviteEmail: (input) => centralAuth.sendTeamInviteEmail(input),
    platform: process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux",
    unattended: false,
    remoteDesktopRuntimePaths: remoteDesktopRuntime,
    openRemoteDesktopSetup: async (action, appPath) => {
      if (action === "reveal") shell.showItemInFolder(appPath);
      else {
        await shell.openExternal(MAC_PERMISSION_URLS[action]);
        await computerUsePermissionHelp.show(action, appPath);
      }
    },
    remoteDesktopStateDirectory: join(app.getPath("userData"), "remote-desktop-runtime"),
    getRemoteDesktopRuntimeCredentials: () => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("System secret storage is unavailable.");
      return loadOrCreateRemoteDesktopCredentials(join(app.getPath("userData"), REMOTE_DESKTOP_RUNTIME_SECRET_FILE), {
        encrypt: (value) => safeStorage.encryptString(value),
        decrypt: (value) => safeStorage.decryptString(value),
      });
    },
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
    getRemoteDesktopIceServers: () => {
      if (developmentRemoteRole === "host") return Promise.resolve([]);
      const identity = teamStore.getIdentity();
      if (!identity) throw new Error("The remote host identity is unavailable.");
      const iceServers = teamWebRtcBridge.getIceServers(identity.serverId);
      if (iceServers.length === 0) throw new Error("Remote Signal has not supplied ICE servers yet.");
      return Promise.resolve(iceServers);
    },
  });
  teardown.push(TEARDOWN_ORDER.host, "the local host", () => host.shutdown());
  const signedInState = centralAuth.getState();
  if (signedInState.status === "signed_in") {
    await host.applySignedInAccount(signedInState.user);
  } else if (signedInState.status === "signed_out") {
    // Sign-out can settle before this service exists, leaving `forwardCentralAuth`
    // nothing to deactivate. Unbinding here is what stops a persisted
    // `activeAccountId` from keeping the last account's host configured - and
    // unconfigurable - while nobody is signed in. A still-loading or failed account
    // service keeps its host, and the event listener settles it.
    await host.applySignedInAccount(null);
  }
  const analyticsPlatform = process.platform;
  if (analyticsPlatform !== "darwin" && analyticsPlatform !== "win32" && analyticsPlatform !== "linux") {
    throw new Error(`Unsupported analytics platform: ${analyticsPlatform}`);
  }
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
  });
  // Immediately after construction: this attributes buffered events to the current owner rather
  // than flushing a queue, so a later call would attribute them to nobody.
  analytics.flushPending();
  const remoteServers = new RemoteServerManager(
    join(app.getPath("userData"), REMOTE_SERVERS_FILE),
    {
      encrypt: (value) => {
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error("macOS secure storage is unavailable.");
        }
        return safeStorage.encryptString(value);
      },
      decrypt: (value) => safeStorage.decryptString(value),
    },
    {
      createTeamAuthTicket: (serverId) => centralAuth.createTeamAuthTicket(serverId),
      getEmail: () => centralAuth.getSignedInUser().email,
      sendTeamInviteEmail: (input) => centralAuth.sendTeamInviteEmail(input),
    },
    {
      allowLocalDevelopmentInvites: developmentRemoteRole !== null,
      appVersion: app.getVersion(),
      getLocalHostId: () => teamStore.getIdentity()?.serverId ?? null,
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
  teamWebRtcBridge.on("accountServersChanged", () => remoteServers.invalidateDirectory());
  teardown.push(TEARDOWN_ORDER.remoteServers, "the remote servers", () => remoteServers.stop());
  await remoteServers.initialize();
  criticalActionTargets = { agents: service, remoteServers };
  // After `remoteServers.initialize()`. The client half polls for the host's connection file and
  // throws when it never appears, before any window is shown - see the module it lives in.
  if (developmentRemoteRole) {
    await startDevelopmentRemoteRole({
      role: developmentRemoteRole,
      testClientEnabled: developmentTestClientEnabled,
      host,
      remoteServers,
    });
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
  teardown.push(TEARDOWN_ORDER.browserView, "the live browser view", () => browserView.stop());
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
      if (serverId === "local") return Promise.reject(new Error("Finish the local test before switching displays."));
      return remoteServers.selectRemoteDesktopDisplay(serverId, displayId);
    },
  });
  teardown.push(TEARDOWN_ORDER.remoteDesktop, "remote desktop", () => remoteDesktop.stop());
  const voice = new VoiceTranscriptionService({
    resourcesRoot: app.isPackaged ? join(process.resourcesPath, "whisper") : resolve(".openbot-build/whisper"),
    modelPath: app.isPackaged
      ? join(app.getPath("userData"), "runtimes", "whisper", WHISPER_MODEL_NAME)
      : resolve(".openbot-build/whisper/model", WHISPER_MODEL_NAME),
    modelDownloadUrl: WHISPER_MODEL_URL,
  });
  teardown.push(TEARDOWN_ORDER.voice, "voice transcription", () => voice.shutdown());
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
      ? () =>
          listSiblingOpenBotInstances({
            executablePath: app.getPath("exe"),
            currentPid: process.pid,
            platform: process.platform,
          })
      : undefined,
    platform: process.platform,
    logDirectory: join(app.getPath("userData"), "logs", "update"),
    // Squirrel.Mac only. The path is meaningless under a Linux or Windows home directory.
    shipItDirectory:
      process.platform === "darwin" ? join(homedir(), "Library", "Caches", "app.openbot.desktop.ShipIt") : undefined,
  });
  teardown.push(TEARDOWN_ORDER.updater, "the update service", () => updater.stop());
  const agentInitialization = new AgentInitializationGate(async () => {
    // The warm-up first: it decides whether the entry is there, and a session created while it
    // still probes would hold a command the warm-up may stop a moment later, silently. It runs
    // from the moment the runtime exists, so this waits only for what is left of it, and a
    // failure here must not keep the agents down.
    await computerUseWarmUp.catch(() => undefined);
    await service.initialize();
  });
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
    checkHealth: async () => {
      if (!agentInitialization.succeeded) return { ok: false, checks: ["initialization-not-ready"] };
      try {
        service.listAgents();
      } catch {
        return { ok: false, checks: ["agent-list-failed"] };
      }
      return { ok: true, checks: ["initialization-succeeded", "agent-list"] };
    },
  });
  await hostUpdateCoordinator.tick();
  hostUpdateCoordinator.start();
  teardown.push(TEARDOWN_ORDER.hostUpdateCoordinator, "the host update coordinator", () =>
    hostUpdateCoordinator.stop(),
  );

  return {
    service,
    providerRuntimes,
    providerCredentials,
    mcpOAuth,
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
    language,
    notificationPreference,
    agentInitialization,
    hostUpdateCoordinator,
    describeRestartReadiness,
    sidebarLayout,
    host,
    remoteDesktop,
    remoteServers,
    centralAuth,
    skills,
    hostedSites,
    customProviders,
    marketplaceAgents,
    agentImport,
    voice,
    dynamicIsland,
    cuaDriver,
    computerUseHighlight,
    computerUsePermissionHelp,
    analytics,
    teamStore,
    appliedAccount: signedInState,
    centralAuthInitialization,
  };
}
