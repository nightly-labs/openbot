import { join, resolve } from "node:path";
import { parseInviteUrl, selfHostedApiOrigin } from "@openbot/contracts/invite-links";
import {
  type AgentEvent,
  type AppLogoColor,
  type CentralAuthState,
  type HostStatus,
  IPC_ENDPOINTS,
} from "@openbot/contracts/ipc";
import { createFormat, resolveLocale, translateFor } from "@openbot/i18n";
import { localizeSourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { createRemoteDirectoryRefresh } from "@openbot/team-client/remote-directory";
import { Effect, Semaphore } from "effect";
import {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  type NativeImage,
  Notification,
  nativeImage,
  net,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  screen,
  shell,
} from "electron";
import { runCauseEffect } from "../backend/effect-boundary";
import { readAppVariant, resolveAppIconPath, resolveLogoColorIconPath } from "./app-icon";
import { type ApplicationServices, createApplicationServices } from "./application-services";
import { type BackgroundTray, createBackgroundTray } from "./background-tray";
import { removeClaudeCodeSessionEnvironment } from "./claude-session-environment";
import { type DeepLink, findDeepLink, parseDeepLink } from "./deep-link-router";
import { requestNotificationPermission, showRetainedNotification } from "./desktop-notifications";
import { guardDevelopmentOutput } from "./development-output";
import {
  developmentUserDataName,
  readAnalyticsCaptureUrl,
  readDevelopmentInstanceId,
  readDevelopmentProfile,
  readDevelopmentRemoteDebuggingPort,
  shouldAutoStartHost,
} from "./development-profile";
import { stopStuckExitAfterLimit } from "./exit-watchdog";
import { filePreviewPages } from "./file-preview-pages";
import { hostAllowsTenantLaunch } from "./host-update-coordinator";
import { takeHostedServerEnvironment } from "./hosted-server-bootstrap";
import { takeHostingDeveloperKey } from "./hosted-server-service";
import { accountIpcHandlers } from "./ipc/account-handlers";
import { acpRegistryIpcHandlers } from "./ipc/acp-registry-handlers";
import { agentAdminIpcHandlers } from "./ipc/agent-admin-handlers";
import { agentFolderIpcHandlers } from "./ipc/agent-folder-handlers";
import { agentIpcHandlers } from "./ipc/agent-handlers";
import { agentImportIpcHandlers } from "./ipc/agent-import-handlers";
import { agentTemplateIpcHandlers } from "./ipc/agent-template-handlers";
import { appIpcHandlers } from "./ipc/app-handlers";
import { attachmentIpcHandlers } from "./ipc/attachment-handlers";
import { backgroundProcessIpcHandlers } from "./ipc/background-process-handlers";
import { billingIpcHandlers } from "./ipc/billing-handlers";
import { bitwardenConnectorIpcHandlers } from "./ipc/bitwarden-connector-handlers";
import { browserDockIpcHandlers } from "./ipc/browser-dock-handlers";
import { browserIpcHandlers } from "./ipc/browser-handlers";
import { channelMemoryIpcHandlers } from "./ipc/channel-memory-handlers";
import { channelRoutineIpcHandlers } from "./ipc/channel-routine-handlers";
import { computerUseIpcHandlers } from "./ipc/computer-use-handlers";
import { customAgentIpcHandlers } from "./ipc/custom-agent-handlers";
import { customProviderIpcHandlers } from "./ipc/custom-provider-handlers";
import { registerIpcGroups } from "./ipc/define-ipc-group";
import { dynamicIslandIpcHandlers } from "./ipc/dynamic-island-handlers";
import { eventsIpcHandlers } from "./ipc/events-handlers";
import { githubConnectorIpcHandlers } from "./ipc/github-connector-handlers";
import { hostAdminIpcHandlers } from "./ipc/host-admin-handlers";
import { hostedServerIpcHandlers } from "./ipc/hosted-server-handlers";
import { hostedSiteIpcHandlers } from "./ipc/hosted-site-handlers";
import { instanceTransferIpcHandlers } from "./ipc/instance-transfer-handlers";
import { licenseIpcHandlers } from "./ipc/license-handlers";
import { localServerIpcHandlers } from "./ipc/local-server-handlers";
import { macAutomationIpcHandlers } from "./ipc/mac-automation-handlers";
import { marketplaceAgentIpcHandlers } from "./ipc/marketplace-agent-handlers";
import { mcpServerIpcHandlers } from "./ipc/mcp-server-handlers";
import { memoryIpcHandlers } from "./ipc/memory-handlers";
import { messagingIpcHandlers } from "./ipc/messaging-handlers";
import { notificationIpcHandlers } from "./ipc/notification-handlers";
import { onePasswordConnectorIpcHandlers } from "./ipc/onepassword-connector-handlers";
import { pluginIpcHandlers } from "./ipc/plugin-handlers";
import { providerAdminIpcHandlers } from "./ipc/provider-admin-handlers";
import { providerDetectionIpcHandlers } from "./ipc/provider-detection-handlers";
import { providerIpcHandlers } from "./ipc/provider-handlers";
import { routineFeedIpcHandlers } from "./ipc/routine-feed-handlers";
import { routineFlowIpcHandlers } from "./ipc/routine-flow-handlers";
import { routineIpcHandlers } from "./ipc/routine-handlers";
import { routineResultIpcHandlers } from "./ipc/routine-result-handlers";
import { sharedTableIpcHandlers } from "./ipc/shared-table-handlers";
import { skillIpcHandlers } from "./ipc/skill-handlers";
import { storageIpcHandlers } from "./ipc/storage-handlers";
import { teamIpcHandlers } from "./ipc/team-handlers";
import { updateIpcHandlers } from "./ipc/update-handlers";
import { vaultIpcHandlers } from "./ipc/vault-handlers";
import { voiceIpcHandlers } from "./ipc/voice-handlers";
import { workflowIpcHandlers } from "./ipc/workflow-handlers";
import { KeepAwake } from "./keep-awake";
import { stopAppImageCrashpadHandlerAtExit } from "./linux-appimage-crashpad";
import { installLinuxDesktopEntry } from "./linux-desktop-entry";
import { configureLinuxGpu } from "./linux-gpu-mode";
import { configureLinuxPasswordStore } from "./linux-password-store";
import { takeLocalServerChildEnvironment } from "./local-server-child";
import { MacHapticFeedback } from "./mac-haptic-feedback";
import {
  configureApplicationMenu,
  createMainWindowController,
  createMainWindowHolder,
  hideWindowsForQuit,
  showMainWindow,
} from "./main-window";
import { ensureMacApplicationPresence, secondLaunchResponse } from "./main-window-state";
import { MessageLinkRelay, openHttpLink } from "./message-link-relay";
import { startMainLog } from "./provider-log";
import { watchRemoteHostDirectory } from "./remote-server-host-directory";
import { createRendererForwarders } from "./renderer-forwarders";
import { sendToRenderer } from "./renderer-ipc";
import { RoutineWake } from "./routine-wake";
import { takeServerModeEnvironment } from "./server-mode";
import { configureContentSecurityPolicy, configureRendererPermissions } from "./session-configuration";
import { trustSystemCertificates } from "./system-certificates";
import { TeardownRegistry } from "./teardown-registry";
import type { TraceFile } from "./trace-file";
import { setIpcCallObserver } from "./trusted-ipc";
import { setWindowAppearance } from "./window-appearance";

const logger = createOpenBotLogger("main");

// Electron keeps running after both events: an unhandled rejection only prints a warning, and a
// monitor leaves the default exception handling in place, except after `hideExceptionErrorBox`. These
// add a redacted log line and a trace span, so a diagnostics export shows that the main process failed
// and how often.
let crashTrace: TraceFile | null = null;
process.on("unhandledRejection", (reason) => reportMainProcessFailure("unhandledRejection", reason));
process.on("uncaughtExceptionMonitor", (error, origin) => reportMainProcessFailure(origin, error));

let exceptionErrorBoxHidden = false;

/**
 * Electron shows its error box for an uncaught exception only while no other listener handles it.
 * The box blocks the main thread: on a server nobody can close it, and during a quit it also holds
 * back the shutdown deadline (#3808). The monitor above still logs the exception.
 */
function hideExceptionErrorBox(): void {
  if (exceptionErrorBoxHidden) return;
  exceptionErrorBoxHidden = true;
  process.on("uncaughtException", () => {
    // Electron's own listener keeps the process running too.
  });
}

type ExitReason = "main_window_closed" | "signal" | "session_end" | "quit";
let exitRecorded = false;

/**
 * Records once why OpenBot quits, in the main log and in the trace, before the teardown closes the
 * trace. The first reason wins: closing the window then also quits. A process that ends with no such
 * line and no crash dump stopped from outside, such as Task Manager.
 */
function recordExit(reason: ExitReason): void {
  if (exitRecorded) return;
  exitRecorded = true;
  logger.info(`Quitting: ${reason}.`);
  if (!crashTrace) return;
  crashTrace.record({ kind: "exit", name: reason, durationMs: 0, outcome: "requested" });
  Effect.runFork(crashTrace.flush());
}

function reportMainProcessFailure(origin: "uncaughtException" | "unhandledRejection", error: unknown): void {
  logger.error(`Main process ${origin}:`, toLogValue(error));
  if (!crashTrace) return;
  crashTrace.record({ kind: "crash", name: origin, durationMs: 0, outcome: "reported" });
  Effect.runFork(crashTrace.flush());
}

// Before any network call: a TLS-inspecting company network needs the roots that IT installed.
try {
  trustSystemCertificates();
} catch (error) {
  logger.warn("Could not read the system certificate store; Node uses its bundled roots only:", toLogValue(error));
}

const commandLineUserDataDirectory = app.commandLine.getSwitchValue("user-data-dir").trim();
const developmentProfile = !app.isPackaged ? readDevelopmentProfile(process.env.OPENBOT_DEV_PROFILE) : null;
const developmentRemoteRole =
  !app.isPackaged &&
  (process.env.OPENBOT_DEV_REMOTE_ROLE === "host" || process.env.OPENBOT_DEV_REMOTE_ROLE === "client")
    ? process.env.OPENBOT_DEV_REMOTE_ROLE
    : null;
const developmentTestClientEnabled = !app.isPackaged && process.env.OPENBOT_DEV_TEST_CLIENT_ENABLED === "1";
// Before any child process starts: agents must not run as part of a Claude Code session that started OpenBot.
removeClaudeCodeSessionEnvironment(process.env);
// Before any child process starts: this removes the single-use claim from the environment they inherit.
const hostedServer = takeHostedServerEnvironment(process.env, app.isPackaged, process.platform);
const hostingDeveloperKey = takeHostingDeveloperKey(process.env, app.isPackaged);
const serverMode = takeServerModeEnvironment(process.env, app.isPackaged, process.platform);
// Always taken, so the owner password leaves the environment also when the flag is refused.
const localServerChildEnvironment = takeLocalServerChildEnvironment(process.env, commandLineUserDataDirectory);
const localServerChild = serverMode || hostedServer ? null : localServerChildEnvironment;
if (serverMode || hostedServer || localServerChild) hideExceptionErrorBox();
// A local server has no window, so it has no Dock tile either.
if (localServerChild && process.platform === "darwin") app.dock?.hide();
const inviteLinkOptions = {
  allowLocalDevelopmentApiUrl: developmentRemoteRole !== null,
  selfHostedApiOrigin: selfHostedApiOrigin(process.env.OPENBOT_AUTH_API_URL),
};
const developmentRemoteDebuggingPort = !app.isPackaged
  ? readDevelopmentRemoteDebuggingPort(process.env.OPENBOT_DEV_REMOTE_DEBUGGING_PORT)
  : null;
const analyticsCaptureUrl = !app.isPackaged ? readAnalyticsCaptureUrl(process.env.OPENBOT_ANALYTICS_CAPTURE_URL) : null;
// Electron exposes FedCM without an account chooser, so every request fails with a NetworkError.
// Sites such as Google Sign-In use FedCM when it exists and fall back to their popup when it does not.
app.commandLine.appendSwitch("disable-features", "FedCm");
if (developmentRemoteDebuggingPort) {
  app.commandLine.appendSwitch("remote-debugging-port", developmentRemoteDebuggingPort);
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
}
// Linux #2374: name the Secret Service where Chromium would keep no sign-in.
if (configureLinuxPasswordStore())
  logger.info(`No Chromium keyring for "${process.env.XDG_CURRENT_DESKTOP ?? ""}"; using gnome-libsecret.`);
if (commandLineUserDataDirectory) {
  app.setPath("userData", resolve(commandLineUserDataDirectory));
} else if (!app.isPackaged) {
  app.setPath(
    "userData",
    join(
      app.getPath("appData"),
      developmentUserDataName(
        developmentProfile ?? "app",
        readDevelopmentInstanceId(process.env.OPENBOT_DEV_INSTANCE_ID),
      ),
    ),
  );
}
app.setName("OpenBot");
app.enableSandbox();
if (process.platform === "win32") app.setAppUserModelId("app.openbot.desktop");
const hasSingleInstanceLock = app.requestSingleInstanceLock();
// A second launch exits at once and must not write into the files of the instance that runs.
if (hasSingleInstanceLock) {
  startMainLog(join(app.getPath("userData"), "logs"));
  // Crash dumps stay in `crashDumps` on this computer. Crashpad removes old reports itself. Without
  // them, a window that disappeared on Windows left nothing to tell a crash from a quit (#2675).
  crashReporter.start({ uploadToServer: false });
  // Linux AppImage: the handler must stop before the AppImage unmounts (#3066).
  stopAppImageCrashpadHandlerAtExit();
  // A file request that never finishes must not keep the process and its lock after an exit.
  stopStuckExitAfterLimit(join(app.getPath("userData"), "logs"));
}
// Linux: the GPU stays on until it fails on this computer (#992). `userData` has its final path here.
configureLinuxGpu({
  userDataPath: app.getPath("userData"),
  ownsInstance: hasSingleInstanceLock,
  server: hostedServer !== null || serverMode !== null,
});
const appVariant = readAppVariant(process.env.OPENBOT_APP_VARIANT, app.isPackaged);
if (!app.isPackaged) guardDevelopmentOutput([process.stdout, process.stderr], () => app.quit());
const appIconPath = resolveAppIconPath({
  variant: appVariant,
  platform: process.platform,
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  sourceRoot: resolve(__dirname, "../.."),
});
protocol.registerSchemesAsPrivileged([
  {
    scheme: "openbot-app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  // `stream` lets an <audio> or <video> element play a file from the scheme: without it the
  // element cannot make the range requests that playback needs.
  {
    scheme: "openbot-attachment",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
  {
    scheme: "openbot-remote-attachment",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
  // A visual reply page. It needs no fetch or CORS support: only a frame loads it.
  {
    scheme: "openbot-visual",
    privileges: { standard: true, secure: true },
  },
  {
    scheme: "openbot-remote-visual",
    privileges: { standard: true, secure: true },
  },
  {
    scheme: "openbot-avatar",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: "openbot-remote-avatar",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: "openbot-server-logo",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: "openbot-remote-server-logo",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

/**
 * The one handle that replaces the fourteen module-scope service `let`s this file used to keep.
 * Null until `createApplicationServices` returns, and never null again - which is why nothing below
 * treats a null as a recoverable state beyond the startup window it really is.
 */
let services: ApplicationServices | null = null;
let activeRemotePrincipalId: string | null = null;
/** Counts account transitions, so queued work for a superseded one is dropped rather than applied. */
let centralAuthGeneration = 0;
let activeAnalyticsPrincipalId: string | null = null;
const remoteAccountGate = Semaphore.makeUnsafe(1);
const macHapticFeedback = new MacHapticFeedback();
let isQuitting = false;
let shutdownStarted = false;
let systemSessionEnding = false;
let systemSessionEndFlushStarted = false;
let relaunchRequested = false;
/**
 * Set by a quit signal, by `before-quit` and by a Windows `session-end`, and never cleared. Not
 * `isQuitting`: a Windows session end that another app cancels also sets that, and then OpenBot
 * keeps running.
 */
let quitStarted = false;
/**
 * The link kinds a renderer is ever told about.
 *
 * `mcp-auth` is not one of them. It carries an OAuth grant for an MCP server, which is a secret,
 * and the sign-in waiting for that grant lives in this process. It is also never held: a grant is
 * answered by the sign-in that started it, and there is no such sign-in before the app is running.
 */
type RendererDeepLink = Exclude<DeepLink, { kind: "mcp-auth" | "slack-workspace" | "discord-guild" }>;

// One link at a time, of whichever kind: a second replaces the first, because what a user opened
// last is what they meant. `deepLinkReceiverReady` says a window has asked for it, which is what
// tells a link that arrives now to be sent rather than held.
let pendingDeepLink: RendererDeepLink | null = takeRendererDeepLink(findDeepLink(process.argv, inviteLinkOptions));
let deepLinkReceiverReady = false;

const MAIN_WINDOW_STATE_FILE = "openbot-main-window-state-v1.json";

// A server is stopped with SIGTERM (systemd, Docker). Without a handler, Electron ends at once and its
// services do not stop. A hosted server's boat pre-stop hook stops it this way before the disk save
// (`scripts/hosting/openbot-boat-pre-stop`).
if (!app.isPackaged || hostedServer || serverMode || localServerChild) {
  const quitAfterSignal = () => {
    recordExit("signal");
    // Before `app.quit()`: the same signal can stop the Computer Use driver first.
    quitStarted = true;
    app.quit();
  };
  process.once("SIGINT", quitAfterSignal);
  process.once("SIGTERM", quitAfterSignal);
  process.once("SIGHUP", quitAfterSignal);
  // The desktop app holds the other end of stdin. Its end means that the app stopped, also by a crash.
  if (localServerChild) {
    process.stdin.once("end", quitAfterSignal);
    process.stdin.once("error", quitAfterSignal);
    process.stdin.resume();
  }
}

/**
 * Filled in as `createApplicationServices` builds, so a quit that arrives part-way through stops
 * exactly what exists. Each step's position in the sequence is declared where the service is built.
 */
const teardown = new TeardownRegistry({
  reportError: (name, error) => logger.error(`Unable to shut down ${name}:`, toLogValue(error)),
});

// Declared before the forwarders and the window surface because both read it, and it outlives any
// one window: macOS destroys the main window on close and `activate` rebuilds it into this slot.
const windowHolder = createMainWindowHolder();

// Destructured so every `service.on("event", forwardX)` registration below reads as it always has.
const {
  forwardAgentEvent,
  forwardWorkflowNotice,
  forwardBrowserDisplayState,
  forwardUpdateStatus,
  forwardUpdatePreference,
  forwardVoiceModelStatus,
  forwardVoiceStreamTranscript,
  forwardSpeechModelStatus,
  forwardVoiceServerSettings,
  forwardProviderRuntimeStatus,
  forwardGitHubConnectorStatus,
  forwardOnePasswordConnectorStatus,
  forwardBitwardenConnectorStatus,
  forwardVaultState,
  forwardHostStatus,
  forwardRemoteDesktopSessions,
  forwardServers,
  forwardTeamPresence,
  forwardDirectMessage,
  forwardDirectTyping,
} = createRendererForwarders({
  getMainWindow: () => windowHolder.current,
  // A function: the window controller is made after the forwarders, and no event comes before it.
  getChatWindows: () => windows.getChatWindows(),
  getAgentService: () => services?.service ?? null,
  getHostService: () => services?.host ?? null,
  getHostAnalytics: () => services?.analytics ?? null,
  getRemoteServerManager: () => services?.remoteServers ?? null,
  showMainWindow,
  // An agent event cannot arrive before the services that raise it, so the fallback stands only so
  // that this module-level value needs no null check on the notification path.
  getTranslate: () => services?.language.translate ?? translateFor("en"),
  getFormat: () => createFormat(services?.language.locale ?? "en"),
  // The desktop app shows the notifications of a local server, as it does for every joined server.
  desktopNotificationsEnabled: () =>
    !localServerChild && (services?.notificationPreference.get().desktopNotifications ?? true),
  notificationPreviewEnabled: () => services?.notificationPreference.get().messagePreview ?? true,
});

// Resolved once, safely: every `app.setPath("userData", ...)` above has already run.
const windows = createMainWindowController({
  holder: windowHolder,
  statePath: join(app.getPath("userData"), MAIN_WINDOW_STATE_FILE),
  appIconPath,
  developmentProfile,
  developmentRemoteRole,
  developmentTestClientEnabled,
  isQuitting: () => isQuitting,
  keepRunningInBackground: () => services?.appBehavior.keepRunningInBackground ?? false,
  getServices: () => services,
  getTranslate: () => services?.language.translate ?? translateFor(resolveLocale("system", app.getLocale())),
  onRendererLoadStarted: () => {
    deepLinkReceiverReady = false;
    filePreviewPages.clear();
  },
  onRendererGone: () => {
    deepLinkReceiverReady = false;
    filePreviewPages.clear();
    services?.browser.releaseUserControlHeldBy({ kind: "local" });
  },
  onMainWindowCreated: (window) => {
    attachWindowsSessionEndHandlers(window);
    attachQuitOnMainWindowClose(window);
  },
  reportError: (message, error) => logger.error(message, toLogValue(error)),
});

let appIconColorImage: NativeImage | undefined;
let backgroundTray: BackgroundTray | null = null;

/**
 * Shows the chosen logo color on the Dock icon, or on each window icon where there is no Dock. A dev
 * or preview build keeps the icon of its build, so it is not mistaken for the release. macOS has no
 * alternate app icon API, so when the app is closed the Dock shows the icon inside the app bundle:
 * changing that file would break the code signature.
 */
function applyAppIconColor(color: AppLogoColor): void {
  if (appVariant !== "production") return;
  const icon = nativeImage.createFromPath(
    resolveLogoColorIconPath({
      color,
      platform: process.platform,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      sourceRoot: resolve(__dirname, "../.."),
    }),
  );
  if (icon.isEmpty()) return;
  if (process.platform === "darwin") {
    app.dock?.setIcon(icon);
    return;
  }
  // A window takes `appIconPath` when it is created, so a window opened after the choice gets the
  // chosen icon here.
  if (!appIconColorImage)
    app.on("browser-window-created", (_event, window) => window.setIcon(appIconColorImage ?? icon));
  appIconColorImage = icon;
  for (const window of BrowserWindow.getAllWindows()) window.setIcon(icon);
  backgroundTray?.setIcon(icon);
}

/**
 * Outside macOS, closing the main window ends OpenBot, unless the user chose to keep it running in
 * the background. The window is then hidden, not closed, so this event does not come.
 *
 * `window-all-closed` cannot carry that on its own any more. The Computer Use overlays are hidden
 * between actions and closed only after a minute of idle, and a hidden window is still a window,
 * so the event may never arrive: the user would close the last window they can see and leave OpenBot
 * and the driver running with no way back to them.
 */
function attachQuitOnMainWindowClose(window: BrowserWindow): void {
  if (process.platform === "darwin") return;
  window.on("closed", () => {
    recordExit("main_window_closed");
    // `quit`, not a teardown of its own: `before-quit` below is what OpenBot shuts down through,
    // and it already ignores a second request while the first one runs.
    app.quit();
  });
}

/**
 * Windows gives an application a few seconds between announcing a session end and killing it, so
 * these two handlers flush rather than shut down: they deliberately do not call
 * `prepareForShutdown`, which awaits network teardown the deadline has no room for. They are
 * registered when the first window is built, long before any service exists, which is why every
 * read below goes through `services?.`.
 *
 * Another app can cancel a session end after the query, and OpenBot then keeps running. Provider
 * runtimes stop only on `session-end`: a stopped manager does not start again, so stopping it on the
 * query left every later Download failing with "OpenBot is closing." (#2518).
 */
function attachWindowsSessionEndHandlers(window: BrowserWindow): void {
  if (process.platform !== "win32") return;
  window.on("query-session-end", () => {
    systemSessionEnding = true;
    isQuitting = true;
    if (systemSessionEndFlushStarted) return;
    systemSessionEndFlushStarted = true;
    if (services) void Effect.runPromise(services.updater.stop());
    void runCauseEffect(windows.flushMainWindowBounds()).catch((error) =>
      logger.error("Unable to save the main window position before Windows session end:", toLogValue(error)),
    );
    if (services)
      void runCauseEffect(services.browser.flushPersistentStorage()).catch((error) =>
        logger.error("Unable to flush browser storage before Windows session end:", toLogValue(error)),
      );
  });
  window.on("session-end", () => {
    recordExit("session_end");
    systemSessionEnding = true;
    isQuitting = true;
    // Windows can stop the Computer Use driver first, and sends no `before-quit` for a session end.
    quitStarted = true;
    // An error box would hold back the flushes below until Windows ends the process.
    hideExceptionErrorBox();
    void runCauseEffect(windows.flushMainWindowBounds()).catch((error) =>
      logger.error("Unable to save the main window position during Windows session end:", toLogValue(error)),
    );
    if (services)
      void runCauseEffect(services.browser.flushPersistentStorage()).catch((error) =>
        logger.error("Unable to flush browser storage during Windows session end:", toLogValue(error)),
      );
    if (services)
      void Effect.runPromise(services.providerRuntimes.stop()).catch((error) =>
        logger.warn("Provider runtimes did not stop.", toLogValue(error)),
      );
  });
}

function registerIpcHandlers({
  service,
  signInRelayClient,
  relayedMessagingInstalls,
  providerRuntimes,
  providerCredentials,
  messaging,
  mailbox,
  browser,
  browserPictureInPicture,
  localSignIn,
  browserDock,
  browserView,
  updater,
  setupFile,
  analyticsPreferenceFile,
  updatePreferenceFile,
  requestedUpdate,
  idleRestart,
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
  agentMemoryLimit,
  memoryReview,
  agentAccess,
  teamStore,
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
  sidebarLayout,
  host,
  remoteDesktop,
  remoteServers,
  centralAuth,
  skills,
  hostedSites,
  githubConnector,
  onePasswordConnector,
  bitwardenConnector,
  vault,
  billing,
  license,
  hostedServers,
  localServers,
  routineFeed,
  events,
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
  computerUsePermissionHelp,
  analytics,
  storageUsage,
  machineAlerts,
  trace,
  resourceMonitor,
  routineFlows,
  workflows,
  routineResults,
}: ApplicationServices): void {
  // Every renderer-to-main endpoint is bound by one of these, one file per domain under ./ipc.
  // Nothing is bound inline here: this is the trust boundary, and a reviewer should be able to read
  // a domain's whole surface in one file rather than find it interleaved with window and lifecycle
  // code. `registerIpcGroups` takes one entry per group in `IPC_ENDPOINTS`, so a group no registrar
  // covers - or a registrar that stops covering one - fails to compile here, naming the group.
  // Every handler below reads this only as the parent of a native dialog. A dialog opens on the
  // window that the user works in: when a chat window has focus, the main window can be hidden.
  const getDialogParent = () => windows.getChatWindows().find((window) => window.isFocused()) ?? windowHolder.current;

  registerIpcGroups({
    ...appIpcHandlers({
      service,
      mailbox,
      browser,
      updater,
      setupFile,
      analyticsPreferenceFile,
      approvalAutomation,
      busyMessageMode,
      agentDefaults,
      agentMemoryLimit,
      remoteSessionReuse,
      externalLinkPreference,
      externalLinks,
      openLink,
      remoteNetworkRoute,
      applyRemoteNetworkRoute: () => runCauseEffect(host.applyNetworkRoute()),
      remoteSessionCache,
      appBehavior,
      language,
      logoColor,
      appearance,
      interfaceSize,
      initializeAgent: () => runCauseEffect(agentInitialization.start()),
      appVariant,
      analyticsCaptureUrl,
      getMainWindow: getDialogParent,
      openChatWindow: windows.openChatWindow,
      chatWindowTargets: windows.chatWindowTargets,
      setAnalyticsTrackingEnabled: (enabled) => analytics.setTrackingEnabled(enabled),
      trace,
      resources: resourceMonitor,
    }),
    ...dynamicIslandIpcHandlers({ dynamicIsland }),
    ...browserDockIpcHandlers({ browserDock }),
    ...computerUseIpcHandlers({
      cuaDriver,
      openExternal: (url) => shell.openExternal(url),
      permissionHelp: computerUsePermissionHelp,
    }),
    ...macAutomationIpcHandlers({ platform: process.platform }),
    ...backgroundProcessIpcHandlers({ platform: process.platform, agents: () => service.listAgents() }),
    ...providerIpcHandlers({ service, providerRuntimes, credentials: providerCredentials, openLink }),
    ...voiceIpcHandlers({ voice, speech, server: voiceServer, service }),
    ...accountIpcHandlers({ centralAuth, host }),
    ...skillIpcHandlers({ skills, getMainWindow: getDialogParent, translate: language.translate }),
    ...agentFolderIpcHandlers({
      service,
      userDataPath: app.getPath("userData"),
      getMainWindow: getDialogParent,
      translate: language.translate,
    }),
    ...hostedSiteIpcHandlers({
      hostedSites,
      remoteServers,
      getMainWindow: getDialogParent,
      translate: language.translate,
    }),
    ...githubConnectorIpcHandlers({ githubConnector, remoteServers, openExternal: openLink }),
    ...onePasswordConnectorIpcHandlers({ onePasswordConnector, remoteServers }),
    ...bitwardenConnectorIpcHandlers({ bitwardenConnector, remoteServers }),
    ...vaultIpcHandlers({ vault, getMainWindow: getDialogParent, translate: language.translate, remoteServers }),
    ...billingIpcHandlers({ billing }),
    ...licenseIpcHandlers({ license }),
    ...routineFeedIpcHandlers({ routineFeed }),
    ...eventsIpcHandlers({ events, remoteServers }),
    ...hostedServerIpcHandlers({ hostedServers }),
    ...localServerIpcHandlers({ localServers }),
    ...customProviderIpcHandlers(customProviderChanges),
    ...customAgentIpcHandlers(customAgentChanges),
    ...acpRegistryIpcHandlers(acpRegistry, remoteServers),
    ...providerDetectionIpcHandlers({ detection: providerDetection, settings: providerDetectionSettings }),
    ...marketplaceAgentIpcHandlers({ marketplaceAgents }),
    ...agentTemplateIpcHandlers({
      agentTemplates,
      takePendingLink: () => takePendingDeepLink("agent-template"),
    }),
    ...agentImportIpcHandlers({
      agentImport,
      hermesImport,
      remoteServers,
      getMainWindow: getDialogParent,
      translate: language.translate,
      exportSkillDirectory: app.isPackaged
        ? join(process.resourcesPath, "agent-import")
        : resolve(__dirname, "../../resources/agent-import"),
    }),
    ...instanceTransferIpcHandlers({
      instanceTransfer,
      remoteServers,
      getMainWindow: getDialogParent,
      translate: language.translate,
    }),
    ...updateIpcHandlers({ updater, updatePreferenceFile, requestedUpdate, idleRestart }),
    ...notificationIpcHandlers({
      notificationPreference,
      translate: language.translate,
      requestPermission: () => requestDesktopNotificationPermission(notificationPreference, language.translate),
      openExternal: (url) => shell.openExternal(url),
    }),
    ...teamIpcHandlers({
      host,
      remoteDesktop,
      remoteServers,
      takePendingInvite: () => takePendingDeepLink("invite"),
    }),
    ...pluginIpcHandlers({
      takePendingPluginSlug: () => takePendingDeepLink("plugin"),
    }),
    ...memoryIpcHandlers({ service, remoteServers }),
    ...sharedTableIpcHandlers({ service, remoteServers }),
    ...routineIpcHandlers({ service, remoteServers }),
    ...routineFlowIpcHandlers({ routineFlows, remoteServers }),
    ...workflowIpcHandlers({ workflows, events, remoteServers }),
    ...routineResultIpcHandlers({ routineResults }),
    ...channelMemoryIpcHandlers({ service, remoteServers }),
    ...channelRoutineIpcHandlers({ service, remoteServers }),
    ...agentAdminIpcHandlers({
      settings: agentAdminSettings,
      hostSettings: agentHostSettings,
      browserProfiles,
      skills,
      marketplaceAgents,
      agentTemplates,
      remoteServers,
    }),
    ...hostAdminIpcHandlers({
      host,
      remoteServers,
      serverTimezone,
      agentMemoryLimit,
      memoryReview,
      machineAlerts,
      promptCacheTtl,
      agentAccess,
      localServerId: () => teamStore.getIdentity()?.serverId,
      localAgentIds: () => service.listAgents().map((agent) => agent.id),
    }),
    ...providerAdminIpcHandlers({
      service,
      credentials: providerCredentials,
      runtimes: providerRuntimes,
      customProviders: customProviderChanges,
      remoteServers,
      relay: signInRelayClient,
    }),
    ...messagingIpcHandlers({
      messaging,
      remoteServers,
      relayedInstalls: relayedMessagingInstalls,
      openExternal: openLink,
    }),
    ...mcpServerIpcHandlers({
      service,
      remoteServers,
      startToolRuntimes: () => {
        Effect.runFork(providerRuntimes.ensureToolRuntimes());
      },
      ensureToolRuntimesReady: () => providerRuntimes.ensureToolRuntimesReady(),
      toolRuntimes: () => providerRuntimes.mcpToolRuntimes(),
      relay: signInRelayClient,
    }),
    ...attachmentIpcHandlers({
      service,
      mailbox,
      remoteServers,
      getMainWindow: getDialogParent,
      translate: language.translate,
    }),
    ...storageIpcHandlers({
      storage: storageUsage,
      machine: machineAlerts,
      providerRuntimes,
      mailbox,
      remoteServers,
      getMainWindow: getDialogParent,
      translate: language.translate,
      agents: () => service.listAgents(),
      openPath: (path) => shell.openPath(path),
    }),
    ...agentIpcHandlers({
      service,
      sidebarLayout,
      host,
      remoteServers,
      skills,
      messageLinks: new MessageLinkRelay({
        remoteServers,
        relay: signInRelayClient,
        openUrl: (url) => openHttpLink(url, openLink),
      }),
      openExternal: openLink,
    }),
    ...browserIpcHandlers({ browserPictureInPicture, browser, remoteServers, browserView, localSignIn }),
  });
}

function requestDesktopNotificationPermission(
  preference: ApplicationServices["notificationPreference"],
  translate: ApplicationServices["language"]["translate"],
): Promise<void> {
  return runCauseEffect(
    requestNotificationPermission({
      platform: process.platform,
      preference,
      showWelcome: () => {
        if (!Notification.isSupported()) return;
        showRetainedNotification(new Notification({ title: "OpenBot", body: translate("notification.welcome") }));
      },
    }),
  );
}

/** `null` for every state but a signed-in one, matching what the two principal trackers store. */
/** The Dock tile, the Linux desktop entry and the `openbot://` scheme. A local server has none of them. */
async function presentApplication(): Promise<void> {
  await ensureMacApplicationPresence(
    process.platform,
    (policy) => app.setActivationPolicy(policy),
    () => app.dock?.show() ?? Promise.resolve(),
  );
  // Linux registers the scheme through xdg-settings, which can only name a desktop entry that
  // exists, so an AppImage writes its own first. On Windows the NSIS installer writes the scheme
  // (`build/installer.nsh`), and each start writes it again for installs from before that script.
  // A Windows development build does not register: the handler would be bare `electron.exe`.
  // A macOS development build does not register either: macOS ignores the path and arguments and
  // names the `com.github.Electron` bundle, so the link took `openbot://` from an installed
  // OpenBot and opened some worktree's bare Electron.app. `bun run dev:slack` has a loopback return.
  await Effect.runPromise(
    installLinuxDesktopEntry({ platform: process.platform, environment: process.env, iconPath: appIconPath }),
  );
  if (
    process.platform === "linux" ||
    ((process.platform === "darwin" || process.platform === "win32") && app.isPackaged)
  ) {
    if (!app.setAsDefaultProtocolClient("openbot")) {
      logger.warn("Unable to register the openbot:// scheme. Invitation links will not open OpenBot.");
    }
  }
}

function centralAuthPrincipalId(state: CentralAuthState): string | null {
  return state.status === "signed_in" ? state.user.id : null;
}

function forwardCentralAuth(state: CentralAuthState): void {
  // A local server has no account: its owner is a password member that a sign-out must not unbind.
  if (localServerChild) return;
  if (state.status === "signed_in") {
    if (activeAnalyticsPrincipalId && activeAnalyticsPrincipalId !== state.user.id) services?.analytics.clear();
    activeAnalyticsPrincipalId = state.user.id;
  } else if (state.status === "signed_out") {
    if (activeAnalyticsPrincipalId) services?.analytics.clear();
    activeAnalyticsPrincipalId = null;
  }
  // The renderer is told about the new account at the end of this function, before the
  // queued work below can finish, so the host stops answering for the previous account now.
  // The file is left alone until `applySignedInAccount` records the switch.
  services?.host.unbindChangedAccount(state.status === "signed_in" ? state.user : null);
  const generation = ++centralAuthGeneration;
  void runCauseEffect(
    remoteAccountGate.withPermit(
      Effect.gen(function* () {
        // Sign-outs and sign-ins can queue up behind one slow teardown. Only the account the
        // renderer was last told about may be activated; an earlier one would put a host the
        // user has already left back within reach.
        if (generation !== centralAuthGeneration) return;
        const nextPrincipalId = state.status === "signed_in" ? state.user.id : null;
        if (activeRemotePrincipalId && activeRemotePrincipalId !== nextPrincipalId && services) {
          // Best-effort, like every other network step here: a bridge disconnect that
          // rejects must not stop the local host from leaving the previous account.
          yield* services.remoteServers
            .disconnectRemoteSessions()
            .pipe(
              Effect.catch((error) =>
                Effect.sync(() =>
                  logger.error("Unable to disconnect the previous account's remote sessions:", toLogValue(error.cause)),
                ),
              ),
            );
        }
        // Rechecked after the disconnect: another account can be announced while it awaits,
        // and activating this one now would put its host back within the newer account's reach.
        if (generation !== centralAuthGeneration) return;
        activeRemotePrincipalId = nextPrincipalId;
        if (state.status !== "signed_in") {
          if (state.status === "signed_out" && services) {
            // Stopping is best-effort; unbinding the host is not, so a failed teardown
            // must not leave the signed-out account's host bound.
            yield* services.host
              .stop(false)
              .pipe(
                Effect.catch((error) =>
                  Effect.sync(() =>
                    logger.error("Unable to stop the host while signing out:", toLogValue(error.cause)),
                  ),
                ),
              );
            yield* services.host.applySignedInAccount(null);
          }
          return;
        }
        const host = services?.host ?? null;
        // The local host is rebound before the joined-server list is synchronized, and the
        // network failure is contained: this account must not end up signed in while the
        // previous account's host is still selected and possibly online.
        if (host) {
          yield* host.applySignedInAccount(state.user);
          if (generation !== centralAuthGeneration) {
            // Another account was announced while this one was being activated. Its own queued
            // callback binds it; until then no host answers for either.
            host.unbindChangedAccount(null);
            return;
          }
          services?.analytics.flushPending();
        }
        if (services)
          yield* services.remoteServers
            .syncRemoteHosts()
            .pipe(
              Effect.catch((error) =>
                Effect.sync(() => logger.error("Unable to synchronize the joined servers:", toLogValue(error.cause))),
              ),
            );
        // A self-hosted server exists to be a host, so its first sign-in names and starts it too.
        if (host && services?.serverMode) yield* services.serverMode.publish();
        else if (host && shouldAutoStartHost({ ...host.getStatus(), remoteRole: developmentRemoteRole }))
          yield* host.start();
      }),
    ),
  ).catch((error) => {
    logger.error("Unable to synchronize the signed-in account:", toLogValue(error));
  });
  // A chat window shows the workspace only while the account is signed in, as the main window does.
  for (const chatWindow of windows.getChatWindows()) sendToRenderer(chatWindow, IPC_ENDPOINTS.auth.event, state);
  const window = windowHolder.current;
  if (!window || window.isDestroyed()) return;
  sendToRenderer(window, IPC_ENDPOINTS.auth.event, state);
}

/**
 * Holds the link, and hands it over when there is a window listening for that kind.
 *
 * A link the renderer never received stays pending rather than being dropped, which is what makes a
 * cold start work: the window that the link itself opened asks for it once it is ready.
 */
function acceptDeepLink(link: DeepLink): void {
  if (link.kind === "mcp-auth") {
    receiveMcpAuthorizationCode(link.state, link.code);
    return;
  }
  if (link.kind === "slack-workspace" || link.kind === "discord-guild") {
    receiveMessagingInstall(link);
    return;
  }
  pendingDeepLink = link;
  const window = windowHolder.current;
  if (!window || window.isDestroyed() || !deepLinkReceiverReady) return;
  showMainWindow(window);
  const delivered =
    link.kind === "invite"
      ? sendToRenderer(window, IPC_ENDPOINTS.servers.invite, link.url)
      : link.kind === "plugin"
        ? sendToRenderer(window, IPC_ENDPOINTS.plugins.openListing, link.slug)
        : sendToRenderer(window, IPC_ENDPOINTS.agentTemplates.openLink, link.id);
  if (delivered) pendingDeepLink = null;
}

/**
 * The pending link, if it is the kind that asked. Any request marks the receiver ready, because
 * the renderer subscribes to every kind before it asks for any.
 */
function takePendingDeepLink(kind: RendererDeepLink["kind"]): string | null {
  deepLinkReceiverReady = true;
  const link = pendingDeepLink;
  if (link?.kind !== kind) return null;
  pendingDeepLink = null;
  return link.kind === "invite" ? link.url : link.kind === "plugin" ? link.slug : link.id;
}

/** A link of a kind a renderer can be sent, or null for one it cannot - which includes no link. */
function takeRendererDeepLink(link: DeepLink | null): RendererDeepLink | null {
  return link && link.kind !== "mcp-auth" && link.kind !== "slack-workspace" && link.kind !== "discord-guild"
    ? link
    : null;
}

/**
 * Hands a Slack or Discord install the sealed grant it is waiting for. An install that this computer
 * opened for a joined server sends the grant on to that server. As with an MCP grant, a link this run
 * did not start does nothing and raises no window.
 */
function receiveMessagingInstall(link: Extract<DeepLink, { kind: "slack-workspace" | "discord-guild" }>): void {
  const current = services;
  if (!current) return;
  const platform = link.kind === "slack-workspace" ? "slack" : "discord";
  const completed =
    platform === "slack"
      ? current.messaging.completeSlackWorkspace(link.nonce, link.grant)
      : current.messaging.completeDiscordGuild(link.nonce, link.grant);
  void Effect.runPromise(
    completed.pipe(
      Effect.flatMap((accepted) =>
        accepted ? Effect.succeed(true) : current.relayedMessagingInstalls.forward(platform, link.nonce, link.grant),
      ),
    ),
  )
    .then((accepted) => {
      const window = windowHolder.current;
      if (accepted && window && !window.isDestroyed()) showMainWindow(window);
    })
    .catch(() => {
      // The connector settings show the connection's state. The error can quote Slack or Discord.
    });
}

/**
 * Hands one MCP sign-in the grant it is waiting for, and shows the window that asked for it.
 *
 * The grant travels no further, except to the joined server whose relayed sign-in waits for that
 * `state`. A `state` that nothing started finds no sign-in and does nothing, which is what makes a
 * forged or replayed link inert - so an unknown one raises no window either.
 */
function receiveMcpAuthorizationCode(state: string, code: string): void {
  const elsewhere = services?.mcpOAuth.openedElsewhere(state) ?? false;
  if (!services?.mcpOAuth.receiveAuthorizationCode(state, code)) {
    // A joined server's sign-in that waits on this computer; it ends on the host, so no window shows.
    services?.signInRelayClient.deliver(state, new URLSearchParams({ code, state }).toString());
    return;
  }
  if (elsewhere) return;
  const window = windowHolder.current;
  if (window && !window.isDestroyed()) showMainWindow(window);
}

app.on("open-url", (event, url) => {
  const link = parseDeepLink(url, inviteLinkOptions);
  if (!link) return;
  event.preventDefault();
  acceptDeepLink(link);
});

app.on("continue-activity", (event, type, _userInfo, details) => {
  if (type !== "NSUserActivityTypeBrowsingWeb" || !details.webpageURL) return;
  try {
    parseInviteUrl(details.webpageURL, inviteLinkOptions);
  } catch {
    return;
  }
  event.preventDefault();
  acceptDeepLink({ kind: "invite", url: details.webpageURL });
});

if (!hasSingleInstanceLock) {
  // No application services exist yet, so the secondary process can exit without shutdown work.
  process.exit(0);
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLink = findDeepLink(argv, inviteLinkOptions);
    if (deepLink) acceptDeepLink(deepLink);
    const window = windowHolder.current;
    const hasMainWindow = Boolean(window && !window.isDestroyed());
    const response = secondLaunchResponse({
      sessionEnding: systemSessionEnding,
      quitting: isQuitting,
      hasMainWindow,
      started: services !== null,
    });
    if (response === "present" && window) showMainWindow(window);
    else if (response === "reopen") reopenMainWindow();
    else if (response === "relaunch" && !relaunchRequested) {
      relaunchRequested = true;
      // The new instance takes this launch's link, not the one this process may have started with.
      const isLink = (value: string) => parseDeepLink(value, inviteLinkOptions) !== null;
      const link = argv.find(isLink);
      const args = process.argv.slice(1).filter((value) => !isLink(value));
      app.relaunch({ args: link ? [...args, link] : args });
    }
  });

  void app
    .whenReady()
    .then(async () => {
      // Startup marks for `dev:bench`, which reads them over the inspector. They change nothing.
      performance.mark("openbot:when-ready");
      // Set the Dock icon before `dock.show()` below. A development build runs the stock Electron.app,
      // so until this call its Dock tile shows the Electron logo.
      if (process.platform === "darwin" && !localServerChild) app.dock?.setIcon(appIconPath);
      if (!(await runCauseEffect(hostAllowsTenantLaunch()))) {
        app.quit();
        return;
      }
      if (!localServerChild) await presentApplication();
      configureContentSecurityPolicy();
      configureRendererPermissions();
      // A local server keeps a window that never loads: the agent browser and the services attach to it.
      if (!localServerChild) await Effect.runPromise(windows.restoreMainWindowBounds());
      const mainWindow = windows.openMainWindow();

      const built = await createApplicationServices({
        mainWindow,
        windows,
        appIconPath,
        appVariant,
        analyticsCaptureUrl,
        developmentRemoteRole,
        developmentTestClientEnabled,
        hostedServer,
        serverMode,
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
        quitting: () => quitStarted,
      });
      services = built;
      performance.mark("openbot:services-built");
      // `forwardCentralAuth` reaches the host, the remote servers and analytics only through
      // `services`, so every account change announced during construction was dropped.
      // `createApplicationServices` bound the local host to the one state it read and attributed the
      // queued analytics to it, so adopt that as the active principal; then apply the current state
      // if the account moved on after that read - a sign-in settling while `remoteServers.initialize()`
      // awaits would otherwise leave the previous account's host selected, with nothing to replay it.
      const appliedAccount = built.appliedAccount;
      activeAnalyticsPrincipalId = centralAuthPrincipalId(appliedAccount);
      activeRemotePrincipalId = centralAuthPrincipalId(appliedAccount);
      const currentAccount = built.centralAuth.getState();
      if (
        currentAccount.status !== appliedAccount.status ||
        centralAuthPrincipalId(currentAccount) !== centralAuthPrincipalId(appliedAccount)
      ) {
        forwardCentralAuth(currentAccount);
      }
      const {
        service,
        sidebarLayout,
        host,
        remoteDesktop,
        remoteServers,
        updater,
        dynamicIsland,
        teamStore,
        language,
        logoColor,
        appearance,
        interfaceSize,
        trace,
        appBehavior,
      } = built;

      crashTrace = trace;
      setIpcCallObserver((call) => trace.record({ kind: "ipc", ...call }));
      service.on("event", (event) => trace.observeAgentEvent(event));
      service.on("event", (event) => forwardAgentEvent("local", event));
      // A routine or its owner can be deleted outside the events API. Its route is then revoked here.
      // Turns and channel messages also send these events, so only a deleted owner starts a sync.
      let webhookAgentIds = new Set(service.listAgents().map((agent) => agent.id));
      const onRoutineEvent = (event: AgentEvent): void => {
        switch (event.type) {
          case "routines-changed":
          case "channel-routines-changed":
          // A save or a delete can remove a webhook trigger, and a new secret can add a route.
          case "workflows-changed":
            built.eventsRuntime.syncRoutes({ all: false });
            return;
          case "agents-changed": {
            const previous = webhookAgentIds;
            webhookAgentIds = new Set(event.agents.map((agent) => agent.id));
            if ([...previous].some((id) => !webhookAgentIds.has(id))) built.eventsRuntime.syncRoutes({ all: false });
            return;
          }
          case "channels-changed":
            if (!service.routineRecords.ownerExists({ kind: "channel", id: event.channelId }))
              built.eventsRuntime.syncRoutes({ all: false });
            return;
        }
      };
      // Routes belong to the signed-in account. A token refresh does not change them.
      let webhookPrincipalId = centralAuthPrincipalId(built.centralAuth.getState());
      built.eventsRuntime.setAccountPrincipal(webhookPrincipalId);
      const refreshWebhookRoutes = (state: CentralAuthState): void => {
        const principalId = centralAuthPrincipalId(state);
        if (principalId === webhookPrincipalId) return;
        webhookPrincipalId = principalId;
        built.eventsRuntime.setAccountPrincipal(principalId);
        if (principalId !== null) built.eventsRuntime.syncRoutes({ all: true });
      };
      service.on("event", onRoutineEvent);
      built.centralAuth.on("changed", refreshWebhookRoutes);
      let webhookHostId = host.getStatus().serverId;
      const onHostChanged = (status: HostStatus): void => {
        const hostIdentityChanged = status.serverId !== webhookHostId;
        webhookHostId = status.serverId;
        forwardHostStatus(status);
        const principalId = centralAuthPrincipalId(built.centralAuth.getState());
        if (hostIdentityChanged && principalId !== null && status.serverId !== null)
          built.eventsRuntime.syncRoutes({ all: true });
      };
      teardown.push(0, "event service listeners", () => {
        service.off("event", onRoutineEvent);
        built.centralAuth.off("changed", refreshWebhookRoutes);
        host.off("changed", onHostChanged);
      });
      // Internal usage signals for analytics only. They are not agent events, so the renderer and
      // Team API clients never receive them.
      service.on("toolUsage", (usage) => built.analytics.handleToolUsage(usage));
      service.on("workflowRun", (end) => built.analytics.handleWorkflowRun(end));
      built.browser.onSiteVisited((visit) => built.analytics.handleSiteVisit(visit));
      sidebarLayout.on("changed", (layout) => forwardAgentEvent("local", { type: "sidebar-layout-changed", layout }));
      built.approvalAutomation.subscribe((preference) => {
        for (const window of BrowserWindow.getAllWindows()) {
          sendToRenderer(window, IPC_ENDPOINTS.app.approvalAutomation, preference);
        }
      });
      built.agentMemoryLimit.subscribe((preference) => {
        for (const window of BrowserWindow.getAllWindows()) {
          sendToRenderer(window, IPC_ENDPOINTS.app.agentMemoryLimitPreference, preference);
        }
      });
      host.on("changed", onHostChanged);
      host.on("presence", (snapshot) => forwardTeamPresence("local", snapshot));
      host.on("directMessage", (event) => forwardDirectMessage("local", event));
      host.on("directTyping", (event) => forwardDirectTyping("local", event));
      remoteDesktop.on("changed", forwardRemoteDesktopSessions);
      built.githubConnector.onChanged(forwardGitHubConnectorStatus);
      built.onePasswordConnector.onChanged(forwardOnePasswordConnectorStatus);
      built.bitwardenConnector.onChanged(forwardBitwardenConnectorStatus);
      built.vault.onChanged(forwardVaultState);
      remoteServers.on("changed", forwardServers);
      remoteServers.on("agent", (serverId, event, bufferedLive) => {
        forwardAgentEvent(serverId, event, bufferedLive);
      });
      remoteServers.on("presence", forwardTeamPresence);
      remoteServers.on("directMessage", forwardDirectMessage);
      remoteServers.on("directTyping", forwardDirectTyping);
      // Machine alerts are hidden for now: the check does not start, and no alert notification shows.
      // The selected server connects while the window loads. Its WebRTC setup takes seconds, and
      // the first screen waits for it. The other servers start after the load, below. The connection
      // needs the signed-in account, so it starts only after the account loads. A failed account
      // load is logged where it starts, and the event connections try again later.
      void Effect.runPromise(
        built.centralAuthInitialization.pipe(
          Effect.flatMap(() =>
            Effect.sync(() => {
              if (built.centralAuth.getState().status === "signed_in") remoteServers.connectActiveServer();
            }),
          ),
          Effect.catch(() => Effect.void),
        ),
      ).catch((error) => logger.warn("Unable to start the selected server's connection:", toLogValue(error)));
      updater.on("status", forwardUpdateStatus);
      built.requestedUpdate.on("preference", forwardUpdatePreference);
      updater.start();
      // Each tenant quits only itself. The host verifies process exit independently.
      built.hostUpdateCoordinator.setStopHandler(async () => {
        await prepareForUpdateInstall();
        app.quit();
      });
      // Before the renderer loads: the trust boundary and every protocol it fetches through have to
      // be in place before the first request can arrive.
      registerIpcHandlers(built);
      if (localServerChild) {
        // No window, menu, tray, Dynamic Island or renderer: the desktop app is the interface.
        const childRoutineWake = new RoutineWake({ routines: service, isOnline: () => net.isOnline() });
        powerMonitor.on("suspend", () => childRoutineWake.suspend());
        powerMonitor.on("resume", () => childRoutineWake.resume());
        powerMonitor.on("resume", () => built.messaging.resume());
        teardown.push(0, "routine wake", () => childRoutineWake.dispose());
        void runCauseEffect(built.agentInitialization.start()).catch((error) => {
          logger.error("Unable to initialize the local agent backend:", toLogValue(error));
        });
        return;
      }
      void requestDesktopNotificationPermission(built.notificationPreference, language.translate).catch((error) =>
        logger.warn("Unable to ask for notification permission:", toLogValue(error)),
      );
      configureApplicationMenu(service, updater, interfaceSize, language.translate, () => windowHolder.current);
      // The way back to a window hidden in the background on Windows and Linux.
      backgroundTray = createBackgroundTray({
        icon: appIconColorImage ?? nativeImage.createFromPath(appIconPath),
        translate: language.translate,
        open: reopenMainWindow,
        quit: () => app.quit(),
      });
      const tray = backgroundTray;
      tray.sync(appBehavior.keepRunningInBackground);
      const unsubscribeBackgroundTray = appBehavior.subscribe(() => tray.sync(appBehavior.keepRunningInBackground));
      teardown.push(0, "background tray", () => {
        unsubscribeBackgroundTray();
        tray.destroy();
      });
      // One place turns a language change into every visible consequence: the menu is built again
      // because a native label cannot be changed in place, and every window is told, including the
      // Dynamic Island, which has no Settings of its own to read the new value from.
      language.subscribe((preference) => {
        configureApplicationMenu(service, updater, interfaceSize, language.translate, () => windowHolder.current);
        tray.relabel();
        for (const window of BrowserWindow.getAllWindows()) {
          sendToRenderer(window, IPC_ENDPOINTS.app.appLanguagePreference, preference);
        }
      });
      applyAppIconColor(logoColor.preference.color);
      logoColor.subscribe((preference) => {
        applyAppIconColor(preference.color);
        for (const window of BrowserWindow.getAllWindows()) {
          sendToRenderer(window, IPC_ENDPOINTS.app.appLogoColorPreference, preference);
        }
      });
      setWindowAppearance(appearance.preference);
      appearance.subscribe((preference) => {
        setWindowAppearance(preference);
        for (const window of BrowserWindow.getAllWindows()) {
          sendToRenderer(window, IPC_ENDPOINTS.app.appAppearancePreference, preference);
        }
      });
      interfaceSize.subscribe((preference) => {
        windows.getMainWindow()?.webContents.setZoomFactor(interfaceSize.zoomFactor);
        for (const chatWindow of windows.getChatWindows())
          chatWindow.webContents.setZoomFactor(interfaceSize.zoomFactor);
        for (const window of BrowserWindow.getAllWindows()) {
          sendToRenderer(window, IPC_ENDPOINTS.app.appInterfaceSizePreference, preference);
        }
      });
      await runCauseEffect(dynamicIsland.initialize()).catch((error) =>
        logger.error("Unable to initialize Dynamic Island:", toLogValue(error)),
      );
      await windows.loadRenderer(mainWindow);
      performance.mark("openbot:renderer-loaded");
      // `sendToRenderer` dropped the server changes made while the window loaded: the host list and
      // the connection of the selected server. The renderer can have read the list before them.
      forwardServers(remoteServers.list());
      // After the load: `sendToRenderer` drops events aimed at a window that is still loading.
      await Effect.runPromise(remoteServers.startEventConnections());
      const reconcileDynamicIsland = () =>
        void Effect.runPromise(dynamicIsland.reconcileWindow()).catch((error) =>
          logger.error("Unable to reconcile Dynamic Island displays:", toLogValue(error)),
        );
      screen.on("display-added", reconcileDynamicIsland);
      screen.on("display-removed", reconcileDynamicIsland);
      screen.on("display-metrics-changed", reconcileDynamicIsland);
      powerMonitor.on("resume", reconcileDynamicIsland);
      powerMonitor.on("resume", () => void Effect.runPromise(remoteServers.wake()));
      // A Slack socket can be dead after sleep without knowing it; reconnect instead of waiting for a ping.
      powerMonitor.on("resume", () => built.messaging.resume());
      const routineWake = new RoutineWake({ routines: service, isOnline: () => net.isOnline() });
      powerMonitor.on("suspend", () => routineWake.suspend());
      powerMonitor.on("resume", () => routineWake.resume());
      teardown.push(0, "routine wake", () => routineWake.dispose());
      const keepAwake = new KeepAwake({
        enabled: () => appBehavior.keepAwake,
        onBatteryToo: () => appBehavior.keepAwakeOnBattery,
        onBattery: () => powerMonitor.isOnBatteryPower(),
        start: () => powerSaveBlocker.start("prevent-app-suspension"),
        stop: (id) => powerSaveBlocker.stop(id),
        log: (message) => logger.info(message),
      });
      const syncKeepAwake = () => keepAwake.sync();
      syncKeepAwake();
      const unsubscribeKeepAwake = appBehavior.subscribe(syncKeepAwake);
      powerMonitor.on("on-ac", syncKeepAwake);
      powerMonitor.on("on-battery", syncKeepAwake);
      teardown.push(0, "keep awake", () => {
        unsubscribeKeepAwake();
        powerMonitor.off("on-ac", syncKeepAwake);
        powerMonitor.off("on-battery", syncKeepAwake);
        keepAwake.dispose();
      });
      const teamIdentity = teamStore.getIdentity();
      if (built.serverMode) {
        const serverModeControl = built.serverMode;
        void runCauseEffect(
          built.centralAuthInitialization.pipe(Effect.flatMap(() => serverModeControl.publish())),
        ).catch((error) => logger.error("Unable to publish this server:", toLogValue(error)));
      } else if (
        shouldAutoStartHost({
          configured: Boolean(teamIdentity),
          enabledOnLaunch: teamIdentity?.enabledOnLaunch ?? false,
          remoteRole: developmentRemoteRole,
        })
      ) {
        void runCauseEffect(built.centralAuthInitialization.pipe(Effect.flatMap(() => host.start()))).catch((error) =>
          logger.error("Unable to republish this OpenBot:", toLogValue(error)),
        );
      }
      void runCauseEffect(built.agentInitialization.start()).catch((error) => {
        logger.error("Unable to initialize the local agent backend:", toLogValue(error));
      });

      const directoryRefresh = createRemoteDirectoryRefresh(() => {
        const generation = centralAuthGeneration;
        return remoteAccountGate
          .withPermit(
            Effect.gen(function* () {
              if (generation !== centralAuthGeneration || built.centralAuth.getState().status !== "signed_in") return;
              yield* remoteServers.syncRemoteHosts();
            }),
          )
          .pipe(
            Effect.catch((error) =>
              Effect.sync(() => logger.error("Unable to refresh joined servers:", toLogValue(error.cause))),
            ),
          );
      });
      // A chat window is the app too (#2964): the user can move focus straight into it.
      const isAppWindow = (window: BrowserWindow | null) =>
        window !== null && (window === windowHolder.current || windows.getChatWindows().includes(window));
      app.on("browser-window-focus", (_event, window) => {
        if (isAppWindow(window)) {
          startDirectoryWatch();
          void Effect.runPromise(remoteServers.setAppFocused(true));
        }
      });
      app.on(
        "browser-window-blur",
        () => void Effect.runPromise(remoteServers.setAppFocused(BrowserWindow.getFocusedWindow() !== null)),
      );
      // A window that has no focus at start sends no blur event, and focus keeps a hosted server on.
      void Effect.runPromise(remoteServers.setAppFocused(BrowserWindow.getFocusedWindow() !== null));
      const refreshMemberships = () => void Effect.runPromise(directoryRefresh.refresh(true));
      remoteServers.on("directoryInvalidated", refreshMemberships);
      let stopDirectoryWatch = () => {};
      const startDirectoryWatch = () => {
        stopDirectoryWatch();
        stopDirectoryWatch = watchRemoteHostDirectory({
          isActive: () =>
            isAppWindow(BrowserWindow.getFocusedWindow()) && built.centralAuth.getState().status === "signed_in",
          refresh: () => directoryRefresh.refresh(),
        });
      };
      startDirectoryWatch();
      teardown.push(0, "joined-server directory refresh", () => {
        stopDirectoryWatch();
        remoteServers.off("directoryInvalidated", refreshMemberships);
      });

      app.on("activate", () => {
        const window = windowHolder.current;
        if (window && !window.isDestroyed()) {
          showMainWindow(window);
          return;
        }
        reopenMainWindow();
      });
    })
    .catch((error) => {
      // A quit during the start, such as `docker stop`, closes the window that is still loading.
      // The quit is already running: an error box would block it, and the shutdown deadline with it.
      // Not `isQuitting`: a Windows session end that another app cancels also sets it, and then no quit runs.
      if (shutdownStarted) {
        logger.warn("The quit stopped the start:", toLogValue(error));
        return;
      }
      // The Windows error box ends the text at a NUL character, so control characters are replaced.
      const message = (error instanceof Error ? error.message : String(error)).replace(/[^\P{Cc}\n\t]/gu, "�");
      logger.error("OpenBot failed to start:", toLogValue(error));
      // A server has nobody at its virtual display to close the box, and the box blocks the quit. A
      // server on this computer has no window: the app that started it reports the failed start.
      if (!serverMode && !hostedServer && !localServerChild) {
        // The services, and with them the saved language, may not exist yet. Then the system language applies.
        const locale = services?.language.locale ?? resolveLocale("system", app.getLocale());
        const translate = services?.language.translate ?? translateFor(locale);
        dialog.showErrorBox(
          translate("startup.failedTitle"),
          translate("startup.failedBody", { message: localizeSourceText(message, locale) }),
        );
      }
      app.quit();
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  // Any other quit is recorded by `prepareForShutdown`.
  if (systemSessionEnding) recordExit("session_end");
  // A quit after a Windows session-end query does not run `prepareForShutdown`.
  hideExceptionErrorBox();
  isQuitting = true;
  quitStarted = true;
  if (systemSessionEnding) {
    if (services) void Effect.runPromise(services.updater.stop());
    if (services)
      void Effect.runPromise(services.providerRuntimes.stop()).catch((error) =>
        logger.warn("Provider runtimes did not stop.", toLogValue(error)),
      );
    return;
  }
  if (shutdownStarted) return;
  event.preventDefault();
  void prepareForShutdown().finally(() => app.quit());
});

function reopenMainWindow(): void {
  void windows
    .ensureMainWindow()
    .then(showMainWindow)
    .catch((error) => logger.error("Unable to open the main window:", toLogValue(error)));
}

/**
 * The teardown gives up on each step after its own limit, but steps run one after another, and
 * something outside it can still hold the quit. A process that outlives its window keeps the
 * single-instance lock, so every later launch exits without opening anything.
 */
const SHUTDOWN_DEADLINE_MS = 30_000;

function forceExitAfterShutdownDeadline(): void {
  setTimeout(() => {
    logger.error(`OpenBot did not quit within ${SHUTDOWN_DEADLINE_MS} ms and will exit now.`);
    app.exit(0);
  }, SHUTDOWN_DEADLINE_MS);
}

async function prepareForUpdateInstall(): Promise<void> {
  if (services) await runCauseEffect(services.browser.flushPersistentStorage());
  await prepareForShutdown();
}

/**
 * The five steps ahead of `teardown.runAll()` are pinned here rather than registered: the windows,
 * the notch windows and the haptic process have to disappear the moment the user asks to quit, not
 * behind a remote host that can take seconds to stop. The two service calls among them are
 * registered as well, for the case where the quit arrives before those services exist; both are
 * idempotent, so running twice costs nothing.
 */
async function prepareForShutdown(): Promise<void> {
  if (shutdownStarted) return;
  // An update install runs this before its `app.quit()`, and the teardown closes the trace.
  recordExit("quit");
  shutdownStarted = true;
  isQuitting = true;
  hideExceptionErrorBox();
  forceExitAfterShutdownDeadline();
  if (services) Effect.runFork(services.updater.stop());
  await runCauseEffect(windows.flushMainWindowBounds()).catch((error) =>
    logger.error("Unable to save the main window position:", toLogValue(error)),
  );
  // After the bounds are saved.
  hideWindowsForQuit();
  services?.dynamicIsland.destroy();
  macHapticFeedback.destroy();
  await teardown.runAll();
}
