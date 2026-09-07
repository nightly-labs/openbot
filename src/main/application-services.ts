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
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
  AppVariant,
  BrowserDisplayState,
  CentralAuthState,
  ProviderRuntimeSnapshot,
  VoiceModelStatus,
} from "@openbot/contracts/ipc";
import { IPC_CHANNELS } from "@openbot/contracts/ipc";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { app, type BrowserWindow, safeStorage, screen, shell } from "electron";
import electronUpdater from "electron-updater";
import { AgentService } from "../backend/agent-service";
import { AgentStore } from "../backend/agent-store";
import { BrowserHost } from "../backend/browser-host";
import { MailboxStore } from "../backend/mailbox-store";
import { SidebarLayoutStore } from "../backend/sidebar-layout-store";
import { TeamChatStore } from "../backend/team-chat-store";
import { AgentInitializationGate } from "./agent-initialization";
import { AgentMarketplaceService } from "./agent-marketplace-service";
import { HostAnalytics } from "./analytics";
import { readAnalyticsPreference } from "./analytics-preference-store";
import { BrowserPictureInPicture } from "./browser-picture-in-picture";
import { CentralAuthManager, readCentralAuthApiUrl, readMobileConnectApiUrl } from "./central-auth-manager";
import { ComputerUseMacSetupService } from "./computer-use-mac-setup";
import { ComputerUseMacSetupWindowController } from "./computer-use-mac-setup-window";
import {
  applyDevelopmentRemoteAccount,
  type DevelopmentRemoteRole,
  startDevelopmentRemoteRole,
} from "./development-remote-bootstrap";
import { performDynamicIslandCriticalAction } from "./dynamic-island-actions";
import { DynamicIslandWindowController } from "./dynamic-island-window";
import { HostService } from "./host-service";
import { HostedSiteDesktopService } from "./hosted-site-service";
import type { MacHapticFeedback } from "./mac-haptic-feedback";
import {
  createDynamicIslandWindow,
  loadComputerUseMacSetupRenderer,
  loadDynamicIslandRenderer,
  type MainWindowController,
  showMainWindow,
} from "./main-window";
import { ManagedSkillService } from "./managed-skill-service";
import { ProviderRuntimeManager } from "./provider-runtime-manager";
import { RemoteDesktopManager } from "./remote-desktop-manager";
import { resolveRemoteDesktopRuntime } from "./remote-desktop-runtime-artifact";
import { loadOrCreateRemoteDesktopCredentials } from "./remote-desktop-secret-store";
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
import { supportsInstalledUpdates, UpdateService } from "./update-service";
import { WHISPER_MODEL_NAME, WHISPER_MODEL_URL } from "./voice-model-service";
import { VoiceTranscriptionService } from "./voice-transcription-service";

const logger = createOpenBotLogger("main");

const SETUP_FILE = "openbot-setup-v2.json";
const ANALYTICS_PREFERENCE_FILE = "openbot-analytics-preference-v1.json";
const UPDATE_PREFERENCE_FILE = "openbot-update-preference-v1.json";
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

/**
 * Where each service stops, as a position in the shutdown sequence rather than a position in the
 * construction sequence. The gaps leave room to insert one without renumbering.
 */
const TEARDOWN_ORDER = {
  updater: 10,
  dynamicIsland: 20,
  browser: 30,
  browserPictureInPicture: 40,
  providerRuntimes: 50,
  remoteServers: 60,
  voice: 70,
  remoteDesktop: 80,
  host: 90,
  teamWebRtcBridge: 100,
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
  mailbox: MailboxStore;
  browser: BrowserHost;
  browserPictureInPicture: BrowserPictureInPicture;
  updater: UpdateService;
  setupFile: string;
  analyticsPreferenceFile: string;
  updatePreferenceFile: string;
  agentInitialization: AgentInitializationGate;
  sidebarLayout: SidebarLayoutStore;
  host: HostService;
  remoteDesktop: RemoteDesktopManager;
  remoteServers: RemoteServerManager;
  centralAuth: CentralAuthManager;
  skills: SkillMarketplaceService;
  hostedSites: HostedSiteDesktopService;
  marketplaceAgents: AgentMarketplaceService;
  voice: VoiceTranscriptionService;
  dynamicIsland: DynamicIslandWindowController;
  computerUseMacSetup: ComputerUseMacSetupWindowController;
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
  const computerUseMacSetupService = new ComputerUseMacSetupService({
    getIconDataUrl: async (path) => (await app.getFileIcon(path, { size: "normal" })).toDataURL(),
  });
  const computerUseMacSetup = new ComputerUseMacSetupWindowController({
    service: computerUseMacSetupService,
    createWindow: windows.createComputerUseMacSetupWindow,
    loadWindow: loadComputerUseMacSetupRenderer,
    openExternal: (url) => shell.openExternal(url),
    revealPath: (path) => shell.showItemInFolder(path),
    loadDragIcon: (path) => app.getFileIcon(path, { size: "normal" }),
  });
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
  const store = new AgentStore(app.getPath("userData"), homedir());
  await store.initialize();
  const managedSkills = new ManagedSkillService(
    app.isPackaged
      ? join(process.resourcesPath, "managed-skills", "openbot-site-hosting", "SKILL.md")
      : resolve(__dirname, "../../resources/managed-skills/openbot-site-hosting/SKILL.md"),
  );
  await managedSkills.syncAll(store.list());
  const hostedSites = new HostedSiteDesktopService(centralAuth);
  const sidebarLayout = new SidebarLayoutStore(join(app.getPath("userData"), SIDEBAR_LAYOUT_FILE));
  await sidebarLayout.initialize();
  await sidebarLayout.reconcileAgents(new Set(store.list().map((agent) => agent.id)));
  const mailbox = new MailboxStore(app.getPath("userData"), store.sharedRoot, store.database);
  await mailbox.initialize();
  configureApplicationProtocol();
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const teamWebRtcBridge = new TeamWebRtcBridge({
    developmentUrl,
    iceTransportPolicy: developmentUrl && process.env.OPENBOT_DEV_ICE_TRANSPORT_POLICY === "relay" ? "relay" : "all",
  });
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
      sendToRenderer(window, IPC_CHANNELS.browserPictureInPictureEvent, event);
    },
  });
  teardown.push(TEARDOWN_ORDER.browserPictureInPicture, "picture in picture", () => browserPictureInPicture.destroy());
  browser.onChanged((tabs, activeTabId) => forwardBrowserDisplayState({ tabs, activeTabId }));
  const setupFile = join(app.getPath("userData"), SETUP_FILE);
  const analyticsPreferenceFile = join(app.getPath("userData"), ANALYTICS_PREFERENCE_FILE);
  const updatePreferenceFile = join(app.getPath("userData"), UPDATE_PREFERENCE_FILE);
  const setupState = await readSetupState(setupFile);
  const analyticsPreference = await readAnalyticsPreference(analyticsPreferenceFile);
  const updatePreference = await readUpdatePreference(updatePreferenceFile);
  const providerRuntimes = new ProviderRuntimeManager({
    root: join(app.getPath("userData"), "provider-runtimes"),
  });
  teardown.push(TEARDOWN_ORDER.providerRuntimes, "the provider runtimes", () => providerRuntimes.stop());
  // Before `new AgentService`, which reads every `executablePath` eagerly.
  await providerRuntimes.initialize();
  const service = new AgentService(
    store,
    mailbox,
    browser,
    30_000,
    setupState.preferredProvider ?? "codex",
    null,
    providerRuntimes.executablePath("codex"),
    providerRuntimes.executablePath("claude"),
    providerRuntimes.executablePath("grok"),
    (agent) => managedSkills.syncAgent(agent),
    hostedSites,
  );
  teardown.push(TEARDOWN_ORDER.service, "the agent service", () => service.stop());
  providerRuntimes.on("status", forwardProviderRuntimeStatus);
  providerRuntimes.on("ready", (provider) => {
    void service.refreshProvider(provider).catch((error) => {
      logger.error(`Unable to refresh ${provider} after runtime installation:`, toLogValue(error));
    });
  });
  const skills = new SkillMarketplaceService(
    centralAuth,
    () => service.listAgents(),
    async (agentId) => service.refreshAgentRuntime(agentId),
  );
  const marketplaceAgents = new AgentMarketplaceService(centralAuth, service, skills);
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
  const remoteDesktop = new RemoteDesktopManager(remoteServers);
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
  const { autoUpdater } = electronUpdater;
  const updater = new UpdateService(autoUpdater, {
    currentVersion: app.getVersion(),
    enabled:
      app.isPackaged &&
      supportsInstalledUpdates(process.platform) &&
      existsSync(join(process.resourcesPath, "app-update.yml")),
    autoDownload: updatePreference.autoDownload,
    beforeInstall: prepareForUpdateInstall,
    platform: process.platform,
    logDirectory: join(app.getPath("userData"), "logs", "update"),
    shipItDirectory: join(homedir(), "Library", "Caches", "app.openbot.desktop.ShipIt"),
  });
  teardown.push(TEARDOWN_ORDER.updater, "the update service", () => updater.stop());

  return {
    service,
    providerRuntimes,
    mailbox,
    browser,
    browserPictureInPicture,
    updater,
    setupFile,
    analyticsPreferenceFile,
    updatePreferenceFile,
    agentInitialization: new AgentInitializationGate(() => service.initialize()),
    sidebarLayout,
    host,
    remoteDesktop,
    remoteServers,
    centralAuth,
    skills,
    hostedSites,
    marketplaceAgents,
    voice,
    dynamicIsland,
    computerUseMacSetup,
    analytics,
    teamStore,
    appliedAccount: signedInState,
    centralAuthInitialization,
  };
}
