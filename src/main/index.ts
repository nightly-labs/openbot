import { uptime } from "node:os";
import { join, resolve } from "node:path";
import { parseInviteUrl, selfHostedApiOrigin } from "@openbot/contracts/invite-links";
import {
  type AgentEvent,
  type AgentSummary,
  type AppLogoColor,
  type CentralAuthState,
  DEFAULT_QUIT_GUARD,
  type HostStatus,
  IPC_ENDPOINTS,
  type QuitGuard,
} from "@openbot/contracts/ipc";
import { createFormat, localeDirection, resolveLocale, translateFor, withHourCycle } from "@openbot/i18n";
import { localizeSourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { createRemoteDirectoryRefresh } from "@openbot/team-client/remote-directory";
import { Effect, Semaphore } from "effect";
import {
  app,
  BrowserWindow,
  clipboard,
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
  session,
  shell,
  systemPreferences,
} from "electron";
import { localTimezone } from "../backend/agent/routine-tools";
import { replaceInvalidLinuxSystemLanguages } from "../backend/browser-policy";
import { setDiskRestoreProbe } from "../backend/disk-restore";
import { runCauseEffect } from "../backend/effect-boundary";
import { LATEST_SCHEMA_VERSION, NewerDatabaseError } from "../backend/openbot-database-schema";
import { perfTime } from "../backend/perf-probe-hooks";
import { OWNER_NOTIFICATION_KEY } from "./agent-notification-level-store";
import { watchAppArchive } from "./app-archive-watch";
import { readAppVariant, resolveAppIconPath, resolveLogoColorIconPath, resolveMenuBarIconPath } from "./app-icon";
import { readSavedTransparentWindow } from "./appearance-service";
import {
  APPEARANCE_PREFERENCE_FILE,
  type ApplicationServices,
  createApplicationServices,
} from "./application-services";
import { type BackgroundTray, createBackgroundTray } from "./background-tray";
import { removeClaudeCodeSessionEnvironment } from "./claude-session-environment";
import { guardConsoleOutput } from "./console-output";
import { type DeepLink, findDeepLink, parseDeepLink } from "./deep-link-router";
import { requestNotificationPermission, showRetainedNotification } from "./desktop-notifications";
import {
  developmentUserDataName,
  developmentWorktreeColor,
  readAnalyticsCaptureUrl,
  readDevelopmentInstanceId,
  readDevelopmentProfile,
  readDevelopmentRemoteDebuggingPort,
  shouldAutoStartHost,
} from "./development-profile";
import { tintDevelopmentIcon } from "./development-worktree-icon";
import { stopStuckExitAfterLimit } from "./exit-watchdog";
import { filePreviewPages } from "./file-preview-pages";
import { hostAllowsTenantLaunch } from "./host-update-coordinator";
import { hostedDiskRestoreProbe, takeHostedServerEnvironment } from "./hosted-server-bootstrap";
import { takeHostingDeveloperKey } from "./hosted-server-service";
import { accountIpcHandlers } from "./ipc/account-handlers";
import { acpRegistryIpcHandlers } from "./ipc/acp-registry-handlers";
import { agentAdminIpcHandlers } from "./ipc/agent-admin-handlers";
import { agentDockIpcHandlers } from "./ipc/agent-dock-handlers";
import { agentFolderIpcHandlers } from "./ipc/agent-folder-handlers";
import { agentIpcHandlers } from "./ipc/agent-handlers";
import { agentImportIpcHandlers } from "./ipc/agent-import-handlers";
import { agentInstructionsIpcHandlers } from "./ipc/agent-instructions-handlers";
import { agentTemplateIpcHandlers } from "./ipc/agent-template-handlers";
import { appIpcHandlers } from "./ipc/app-handlers";
import { attachmentIpcHandlers } from "./ipc/attachment-handlers";
import { backgroundProcessIpcHandlers } from "./ipc/background-process-handlers";
import { billingIpcHandlers } from "./ipc/billing-handlers";
import { bitwardenConnectorIpcHandlers } from "./ipc/bitwarden-connector-handlers";
import { browserDockIpcHandlers } from "./ipc/browser-dock-handlers";
import { browserIpcHandlers } from "./ipc/browser-handlers";
import { channelFolderIpcHandlers } from "./ipc/channel-folder-handlers";
import { channelMemoryIpcHandlers } from "./ipc/channel-memory-handlers";
import { channelRoutineIpcHandlers } from "./ipc/channel-routine-handlers";
import { computerUseIpcHandlers } from "./ipc/computer-use-handlers";
import { creditsIpcHandlers } from "./ipc/credits-handlers";
import { crmIpcHandlers } from "./ipc/crm-handlers";
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
import { linkAccountIpcHandlers } from "./ipc/link-account-handlers";
import { localServerIpcHandlers } from "./ipc/local-server-handlers";
import { macAutomationIpcHandlers } from "./ipc/mac-automation-handlers";
import { marketplaceAgentIpcHandlers } from "./ipc/marketplace-agent-handlers";
import { marketplaceLinkIpcHandlers } from "./ipc/marketplace-link-handlers";
import { mcpServerIpcHandlers } from "./ipc/mcp-server-handlers";
import { memoryIpcHandlers } from "./ipc/memory-handlers";
import { messagingIpcHandlers } from "./ipc/messaging-handlers";
import { notificationIpcHandlers } from "./ipc/notification-handlers";
import { onePasswordConnectorIpcHandlers } from "./ipc/onepassword-connector-handlers";
import { passwordManagersIpcHandlers } from "./ipc/password-managers-handlers";
import { pluginIpcHandlers } from "./ipc/plugin-handlers";
import { providerAdminIpcHandlers } from "./ipc/provider-admin-handlers";
import { providerDetectionIpcHandlers } from "./ipc/provider-detection-handlers";
import { providerIpcHandlers } from "./ipc/provider-handlers";
import { referralIpcHandlers } from "./ipc/referral-handlers";
import { routineFeedIpcHandlers } from "./ipc/routine-feed-handlers";
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
import { relaunchApp } from "./linux-appimage-relaunch";
import { installLinuxDesktopEntry } from "./linux-desktop-entry";
import { configureLinuxGpu, readLinuxGpuMode } from "./linux-gpu-mode";
import { configureLinuxPasswordStore } from "./linux-password-store";
import {
  keepAboveAppsXWayland,
  restartOnXWaylandForAboveApps,
  restartOnXWaylandForSoftwareRendering,
  restartOnXWaylandWithoutMonitor,
  setAboveAppsXWayland,
  takeXWaylandRestartMarker,
} from "./linux-wayland-output";
import { openLocalServerControl, takeLocalServerChildEnvironment } from "./local-server-child";
import { MacHapticFeedback } from "./mac-haptic-feedback";
import {
  configureApplicationMenu,
  createMainWindowController,
  createMainWindowHolder,
  hideWindowsForQuit,
  keepWindowsHidden,
  openWindowsInBackground,
  showMainWindow,
  windowsOpenInBackground,
} from "./main-window";
import { ensureMacApplicationPresence, secondLaunchResponse } from "./main-window-state";
import { MessageLinkRelay, openMessageLink } from "./message-link-relay";
import { recoverFromNewerDatabase } from "./newer-database-recovery";
import { removeOrcaPaneEnvironment } from "./orca-pane-environment";
import { flushMainLog, startMainLog } from "./provider-log";
import { notifyRemoteControlStarted } from "./remote-control-question";
import { watchRemoteHostDirectory } from "./remote-server-host-directory";
import { createRendererForwarders } from "./renderer-forwarders";
import { sendToRenderer } from "./renderer-ipc";
import { RoutineWake } from "./routine-wake";
import { RunMarker, type UncleanExitProperties } from "./run-marker";
import { memberAuditName } from "./server-audit-store";
import { takeServerModeEnvironment } from "./server-mode";
import { type ServerSafeMode, safeModeMarkerDirectory, startServerSafeMode } from "./server-safe-mode";
import {
  START_LOOP_EXIT_CODE,
  type StartHaltReason,
  type StartHaltRecord,
  startHaltReason,
  takeServerStartGuardTest,
  takeStartHalt,
  writeStartHalt,
} from "./server-start-halt";
import { applyServerTimezone, SERVER_TIMEZONE_PREFERENCE_FILE } from "./server-timezone-preference-store";
import { configureContentSecurityPolicy, configureRendererPermissions } from "./session-configuration";
import { OWNER_PIN_KEY } from "./sidebar-pin-store";
import { singleInstanceExitMessage, singleInstanceOwnerPid } from "./single-instance-owner";
import { StartAttempts, takeForcedStartFailure } from "./start-attempts";
import { compatiblePreviousRelease, readDatabaseSchemaVersion } from "./start-recovery-release";
import { openStartRecoveryWindow, type StartRecovery } from "./start-recovery-window";
import { trustSystemCertificates } from "./system-certificates";
import { systemHourCycle } from "./system-hour-cycle";
import { TeardownRegistry } from "./teardown-registry";
import type { TraceFile } from "./trace-file";
import { setIpcCallObserver } from "./trusted-ipc";
import { macShipItDirectory, shipItInstallInProgress } from "./update-install-guard";
import { UPDATE_INSTALL_TIMEOUT_MS } from "./update-service";
import { setInitialWindowGlass, setWindowAppearance } from "./window-appearance";
import { placeWindowButtons } from "./window-buttons";
import { restartOutsideWindowsPackage } from "./windows-package-restart";

guardConsoleOutput([process.stdout, process.stderr], () => {
  if (!app.isPackaged) app.quit();
});
const logger = createOpenBotLogger("main");

let crashTrace: TraceFile | null = null;
let runMarker: RunMarker | null = null;
let previousUncleanExit: UncleanExitProperties | null = null;
let startAttempts: StartAttempts | null = null;
let previousStartHalt: StartHaltRecord | null = null;
let startHaltExitCode: number | null = null;
let serverSafeMode: ServerSafeMode | null = null;
const SERVER_SAFE_MODE_LIFETIME_MS = 60 * 60 * 1_000;
process.on("unhandledRejection", (reason) => reportMainProcessFailure("unhandledRejection", reason));
process.on("uncaughtExceptionMonitor", (error, origin) => reportMainProcessFailure(origin, error));

let exceptionErrorBoxHidden = false;

function hideExceptionErrorBox(): void {
  if (exceptionErrorBoxHidden) return;
  exceptionErrorBoxHidden = true;
  process.on("uncaughtException", () => {});
}

type ExitReason =
  | "main_window_closed"
  | "signal"
  | "session_end"
  | "menu"
  | "shortcut"
  | "tray"
  | "update"
  | "quit"
  | "start_loop";
let exitRecorded = false;

function recordExit(reason: ExitReason): void {
  if (exitRecorded) return;
  exitRecorded = true;
  startAttempts?.quitting();
  logger.info(`Quitting: ${reason}.`);
  runMarker?.quitting(reason);
  if (!crashTrace) return;
  crashTrace.record({ kind: "exit", name: reason, durationMs: 0, outcome: "requested" });
  Effect.runFork(crashTrace.flush());
}

function quitFor(reason: ExitReason): void {
  recordExit(reason);
  app.quit();
}

function reportMainProcessFailure(origin: "uncaughtException" | "unhandledRejection", error: unknown): void {
  logger.error(`Main process ${origin}:`, toLogValue(error));
  if (origin === "uncaughtException") startAttempts?.failed("exception");
  if (!crashTrace) return;
  crashTrace.record({ kind: "crash", name: origin, durationMs: 0, outcome: "reported" });
  Effect.runFork(crashTrace.flush());
}

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
removeClaudeCodeSessionEnvironment(process.env);
removeOrcaPaneEnvironment(process.env);
const hostedServer = takeHostedServerEnvironment(process.env, app.isPackaged, process.platform);
if (hostedServer) setDiskRestoreProbe(hostedDiskRestoreProbe());
const hostingDeveloperKey = takeHostingDeveloperKey(process.env, app.isPackaged);
const serverMode = takeServerModeEnvironment(process.env, app.isPackaged, process.platform);
const localServerChildEnvironment = takeLocalServerChildEnvironment(process.env, commandLineUserDataDirectory);
const localServerChild = serverMode || hostedServer ? null : localServerChildEnvironment;
const forcedStartFailure = takeForcedStartFailure(process.env, app.isPackaged);
const serverStartGuard =
  serverMode !== null || hostedServer !== null || takeServerStartGuardTest(process.env, app.isPackaged);
const localServerControl = localServerChild
  ? openLocalServerControl(process.platform, (cause) =>
      logger.error("The local server has no control pipe from the desktop app:", toLogValue(cause)),
    )
  : null;
if (serverMode || hostedServer || localServerChild) hideExceptionErrorBox();
if (serverMode || hostedServer || localServerChild) keepWindowsHidden();
if (developmentProfile && process.env.OPENBOT_DEV_WINDOW_FOCUS === "background") openWindowsInBackground();
if (localServerChild && process.platform === "darwin") app.dock?.hide();
const inviteLinkOptions = {
  allowLocalDevelopmentApiUrl: developmentRemoteRole !== null,
  selfHostedApiOrigin: selfHostedApiOrigin(process.env.OPENBOT_AUTH_API_URL),
};
const developmentRemoteDebuggingPort = !app.isPackaged
  ? readDevelopmentRemoteDebuggingPort(process.env.OPENBOT_DEV_REMOTE_DEBUGGING_PORT)
  : null;
const analyticsCaptureUrl = !app.isPackaged ? readAnalyticsCaptureUrl(process.env.OPENBOT_ANALYTICS_CAPTURE_URL) : null;
app.commandLine.appendSwitch("disable-features", "FedCm");
if (developmentRemoteDebuggingPort) {
  app.commandLine.appendSwitch("remote-debugging-port", developmentRemoteDebuggingPort);
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
}
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
const systemTimezone =
  serverMode || hostedServer || localServerChild
    ? applyServerTimezone(join(app.getPath("userData"), SERVER_TIMEZONE_PREFERENCE_FILE), process.env)
    : localTimezone;
app.enableSandbox();
if (process.platform === "win32")
  app.setAppUserModelId(app.isPackaged ? "app.openbot.desktop" : "app.openbot.desktop.dev");
if (
  app.isPackaged &&
  !(serverMode || hostedServer || localServerChildEnvironment) &&
  (await Effect.runPromise(
    restartOutsideWindowsPackage(
      process.env,
      process.argv,
      (value) => parseDeepLink(value, inviteLinkOptions) !== null,
    ),
  ))
)
  process.exit(0);
const startedOnXWayland = takeXWaylandRestartMarker(process.env, process.argv);
if (
  app.isPackaged &&
  !(serverMode || hostedServer || localServerChildEnvironment) &&
  ((await Effect.runPromise(restartOnXWaylandForAboveApps(process.env, app.getPath("userData")))) ||
    (await Effect.runPromise(
      restartOnXWaylandForSoftwareRendering(
        process.env,
        !readLinuxGpuMode(app.getPath("userData"), false).hardwareAcceleration,
      ),
    )) ||
    (await Effect.runPromise(restartOnXWaylandWithoutMonitor(process.env))))
)
  app.exit(0);
if (
  process.platform === "darwin" &&
  app.isPackaged &&
  !(serverMode || hostedServer || localServerChildEnvironment) &&
  Effect.runSync(
    shipItInstallInProgress({
      userDataPath: app.getPath("userData"),
      shipItDirectory: macShipItDirectory(),
      currentVersion: app.getVersion(),
      now: Date.now(),
    }),
  )
)
  process.exit(0);
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (hasSingleInstanceLock) {
  startMainLog(join(app.getPath("userData"), "logs"));
  crashReporter.start({ uploadToServer: false });
  if (!localServerChild)
    ({ marker: runMarker, previous: previousUncleanExit } = RunMarker.start({
      userDataPath: app.getPath("userData"),
      crashDumpsPath: app.getPath("crashDumps"),
      appVersion: app.getVersion(),
      server: hostedServer !== null || serverMode !== null,
      now: Date.now(),
      bootedAt: Date.now() - uptime() * 1_000,
    }));
  if (previousUncleanExit)
    logger.warn(
      `The previous run did not quit cleanly (${previousUncleanExit.phase}, ${previousUncleanExit.uptime_class}, ${previousUncleanExit.crash_dump_count} crash dumps).`,
    );
  if (!localServerChild) {
    startAttempts = StartAttempts.begin({
      userDataPath: app.getPath("userData"),
      crashDumpsPath: app.getPath("crashDumps"),
      appVersion: app.getVersion(),
      schemaVersion: LATEST_SCHEMA_VERSION,
      now: Date.now(),
      bootedAt: Date.now() - uptime() * 1_000,
    });
    const attempts = startAttempts.summary();
    if (serverStartGuard) {
      previousStartHalt = takeStartHalt(app.getPath("userData"));
      if (previousStartHalt)
        logger.warn(
          `The previous run of OpenBot ${previousStartHalt.appVersion} stopped its start loop (${previousStartHalt.reason}). This start tries again.`,
        );
    }
    if (attempts.consecutiveFailures > 0)
      logger.warn(
        `OpenBot ${attempts.appVersion} did not finish its start ${attempts.consecutiveFailures} times in a row (previous start: ${attempts.previousOutcome}, last failure: ${attempts.lastFailure ?? "none"}).`,
      );
    if (process.platform === "darwin" && (attempts.consecutiveFailures > 0 || forcedStartFailure !== null))
      systemPreferences.registerDefaults({ ApplePersistenceIgnoreState: true });
  }
  stopAppImageCrashpadHandlerAtExit();
  stopStuckExitAfterLimit(join(app.getPath("userData"), "logs"));
  if (startedOnXWayland === "monitor")
    logger.warn("The Wayland session had no monitor, so OpenBot uses XWayland until the next start.");
  if (startedOnXWayland === "above-apps")
    logger.info("The agent dock or the Dynamic Island shows above other apps, so OpenBot uses XWayland.");
  if (startedOnXWayland === "software-rendering")
    logger.info("Software rendering is on, so OpenBot uses XWayland: on Wayland its window can stay empty.");
}
configureLinuxGpu({
  userDataPath: app.getPath("userData"),
  ownsInstance: hasSingleInstanceLock,
  server: hostedServer !== null || serverMode !== null,
});
const appVariant = readAppVariant(process.env.OPENBOT_APP_VARIANT, app.isPackaged);
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
  {
    scheme: "openbot-attachment",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
  {
    scheme: "openbot-remote-attachment",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
  {
    scheme: "openbot-visual",
    privileges: { standard: true, secure: true },
  },
  {
    scheme: "openbot-remote-visual",
    privileges: { standard: true, secure: true },
  },
  {
    scheme: "openbot-video",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
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

let services: ApplicationServices | null = null;
let activeRemotePrincipalId: string | null = null;
let centralAuthGeneration = 0;
let activeAnalyticsPrincipalId: string | null = null;
let previousCentralAuthStatus: CentralAuthState["status"] | null = null;
const remoteAccountGate = Semaphore.makeUnsafe(1);
const macHapticFeedback = new MacHapticFeedback();
let isQuitting = false;
let shutdownStarted = false;
let shutdownDone = false;
let systemSessionEnding = false;
let systemSessionEndFlushStarted = false;
let relaunchRequested = false;
let quitStarted = false;
type RendererDeepLink = Exclude<DeepLink, { kind: "mcp-auth" | "slack-workspace" | "discord-guild" }>;

let pendingDeepLink: RendererDeepLink | null = takeRendererDeepLink(findDeepLink(process.argv, inviteLinkOptions));
let deepLinkReceiverReady = false;

const MAIN_WINDOW_STATE_FILE = "openbot-main-window-state-v1.json";
const WM_ENDSESSION = 0x0016;

{
  const quitAfterSignal = () => {
    quitStarted = true;
    quitFor("signal");
  };
  process.once("SIGINT", quitAfterSignal);
  process.once("SIGTERM", quitAfterSignal);
  process.once("SIGHUP", quitAfterSignal);
  if (localServerChild) {
    if (localServerControl) {
      localServerControl.once("end", quitAfterSignal);
      localServerControl.once("error", quitAfterSignal);
      localServerControl.resume();
    } else quitAfterSignal();
  }
}

const teardown = new TeardownRegistry({
  reportError: (name, error) => logger.error(`Unable to shut down ${name}:`, toLogValue(error)),
});

const windowHolder = createMainWindowHolder();

const {
  closeChatNotifications,
  forwardAgentEvent,
  withdrawSettledNotifications,
  forwardWorkflowNotice,
  forwardBrowserDisplayState,
  forwardUpdateStatus,
  forwardUpdatePreference,
  forwardVoiceModelStatus,
  forwardVoiceStreamTranscript,
  forwardVoiceLiveEvent,
  forwardSpeechModelStatus,
  forwardVoiceServerSettings,
  forwardProviderRuntimeStatus,
  forwardGitHubConnectorStatus,
  forwardLinkAccountStatus,
  forwardOnePasswordConnectorStatus,
  forwardBitwardenConnectorStatus,
  forwardPasswordManagerStatus,
  forwardVaultState,
  forwardHostStatus,
  forwardRemoteDesktopSessions,
  forwardServers,
  forwardTeamPresence,
  forwardDirectMessage,
  forwardDirectTyping,
  forwardAttachmentDownload,
  forwardAttachmentImportProgress,
  forwardInstanceTransferUploadProgress,
  forwardOwnerTransfersChanged,
} = createRendererForwarders({
  getMainWindow: () => windowHolder.current,
  getChatWindows: () => windows.getChatWindows(),
  chatWindowTarget: (window) => windows.chatWindowTarget(window),
  getAgentService: () => services?.service ?? null,
  getHostService: () => services?.host ?? null,
  getHostAnalytics: () => services?.analytics ?? null,
  getRemoteServerManager: () => services?.remoteServers ?? null,
  showMainWindow,
  getTranslate: () => services?.language.translate ?? translateFor("en"),
  getFormat: () => {
    const locale = services?.language.locale ?? "en";
    return createFormat(locale, withHourCycle(locale, systemHourCycle()));
  },
  desktopNotificationsEnabled: () =>
    !localServerChild && (services?.notificationPreference.get().desktopNotifications ?? true),
  notificationPreviewEnabled: () => services?.notificationPreference.get().messagePreview ?? true,
  ownAgentNotificationLevels: () => services?.agentNotificationLevels.levels(OWNER_NOTIFICATION_KEY) ?? new Map(),
});

function workingAgents(): AgentSummary[] {
  if (!services) return [];
  return [...services.service.workingAgents(), ...(services.localServers?.workingAgents() ?? [])];
}

function quitGuard(): QuitGuard {
  return services?.appBehavior.quitGuard ?? DEFAULT_QUIT_GUARD;
}

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
  getLayoutDirection: () => localeDirection(services?.language.locale ?? resolveLocale("system", app.getLocale())),
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
  quitFromShortcut: () => quitFor("shortcut"),
  workingAgents,
  quitGuard,
  onHiddenWhileWorking: (hidden) => backgroundTray?.setHiddenWhileWorking(hidden),
});

let appIconColorImage: NativeImage | undefined;
const dockShowsBundleIcon = process.platform === "darwin" && app.isPackaged && appVariant === "production";
let backgroundTray: BackgroundTray | null = null;

function applyAppIconColor(color: AppLogoColor, chosen: boolean): void {
  const worktreeIcon = developmentWorktreeIcon();
  if (worktreeIcon) {
    showAppIcon(worktreeIcon);
    return;
  }
  if (appVariant !== "production") return;
  if (dockShowsBundleIcon && !chosen) return;
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
  showAppIcon(icon);
}

let developmentIcon: NativeImage | null | undefined;
function developmentWorktreeIcon(): NativeImage | null {
  if (developmentIcon !== undefined) return developmentIcon;
  const icon = appVariant === "dev" && !app.isPackaged ? nativeImage.createFromPath(appIconPath) : null;
  developmentIcon =
    icon && !icon.isEmpty() ? tintDevelopmentIcon(icon, developmentWorktreeColor(resolve(__dirname, "../.."))) : null;
  return developmentIcon;
}

function showAppIcon(icon: NativeImage): void {
  if (process.platform === "darwin") {
    app.dock?.setIcon(icon);
    return;
  }
  if (!appIconColorImage)
    app.on("browser-window-created", (_event, window) => window.setIcon(appIconColorImage ?? icon));
  appIconColorImage = icon;
  for (const window of BrowserWindow.getAllWindows()) window.setIcon(icon);
  backgroundTray?.setIcon(icon);
}

function attachQuitOnMainWindowClose(window: BrowserWindow): void {
  if (process.platform === "darwin") return;
  window.on("closed", () => {
    recordExit("main_window_closed");
    app.quit();
  });
}

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
  window.hookWindowMessage(WM_ENDSESSION, (wParam) => {
    if (quitStarted || !systemSessionEnding || wParam.some((byte) => byte !== 0)) return;
    systemSessionEnding = false;
    systemSessionEndFlushStarted = false;
    isQuitting = false;
    services?.updater.resume();
  });
  window.on("session-end", () => {
    recordExit("session_end");
    systemSessionEnding = true;
    isQuitting = true;
    quitStarted = true;
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
  detachedBrowserWindow,
  localSignIn,
  browserDock,
  browserView,
  updater,
  setupFile,
  analyticsPreferences,
  analyticsInstallId,
  updatePreferenceFile,
  requestedUpdate,
  idleRestart,
  describeRestartReadiness,
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
  agentMemoryLimit,
  memoryReview,
  skillLearning,
  browsingMemory,
  agentAccess,
  mcpAccess,
  serverAudit,
  teamStore,
  serverTimezone,
  hostTurnLimits,
  serverPersonality,
  promptCacheTtl,
  claudeUserSetup,
  cacheExpiryCompaction,
  claudeCompactWindow,
  providerEnvironment,
  modelVisibility,
  remoteSessionReuse,
  externalLinkPreference,
  externalLinks,
  openLink,
  remoteNetworkRoute,
  remoteSessionCache,
  appBehavior,
  agentInitialization,
  sidebarLayout,
  sidebarPins,
  host,
  remoteDesktop,
  remoteServers,
  centralAuth,
  skills,
  hostedSites,
  githubConnector,
  linkAccount,
  onePasswordConnector,
  bitwardenConnector,
  passwordManagers,
  vault,
  billing,
  referral,
  license,
  credits,
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
  hostVoiceModel,
  hostSignalHome,
  speech,
  voiceServer,
  dynamicIsland,
  agentDock,
  cuaDriver,
  computerUsePermissionHelp,
  storageUsage,
  libraryFoldersService,
  workflowFoldersService,
  workflowFiles,
  machineAlerts,
  trace,
  resourceMonitor,
  startup,
  workflows,
  workflowGitHub,
  crm,
  routineResults,
}: ApplicationServices): void {
  const getDialogParent = () => windows.getChatWindows().find((window) => window.isFocused()) ?? windowHolder.current;

  registerIpcGroups({
    ...appIpcHandlers({
      service,
      mailbox,
      browser,
      updater,
      setupFile,
      analyticsPreferences,
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
      analyticsInstallId,
      dynamicIslandAvailable: dynamicIsland.available,
      getMainWindow: getDialogParent,
      isMainWindow: (sender) => {
        const window = windowHolder.current;
        return window !== null && !window.isDestroyed() && window.webContents === sender;
      },
      openChatWindow: windows.openChatWindow,
      chatWindowTargets: windows.chatWindowTargets,
      trace,
      resources: resourceMonitor,
      startup,
    }),
    ...dynamicIslandIpcHandlers({
      dynamicIsland,
      chatRendererIds: () => new Set(windows.getChatWindows().map((window) => window.webContents.id)),
      setXWayland: (enabled) => setAboveAppsXWayland(app.getPath("userData"), "dynamic-island", enabled),
      keepXWayland: () => keepAboveAppsXWayland(app.getPath("userData"), "dynamic-island"),
    }),
    ...agentDockIpcHandlers({
      agentDock,
      setXWayland: (enabled) => setAboveAppsXWayland(app.getPath("userData"), "agent-dock", enabled),
    }),
    ...browserDockIpcHandlers({ browserDock }),
    ...computerUseIpcHandlers({
      cuaDriver,
      openExternal: (url) => shell.openExternal(url),
      permissionHelp: computerUsePermissionHelp,
    }),
    ...macAutomationIpcHandlers({ platform: process.platform }),
    ...backgroundProcessIpcHandlers({
      platform: process.platform,
      agents: () => service.listAgents(),
      remoteServers,
    }),
    ...providerIpcHandlers({
      service,
      providerRuntimes,
      credentials: providerCredentials,
      openLink,
    }),
    ...voiceIpcHandlers({
      voice,
      speech,
      server: voiceServer,
      service,
      remoteServers,
      forwardLiveEvent: forwardVoiceLiveEvent,
    }),
    ...accountIpcHandlers({ centralAuth, host, refreshServers: () => remoteServers.requestDirectoryRefresh() }),
    ...skillIpcHandlers({ skills, getMainWindow: getDialogParent, translate: language.translate }),
    ...agentFolderIpcHandlers({
      folders: agentFolders,
      remoteServers,
      getMainWindow: getDialogParent,
      translate: language.translate,
    }),
    ...channelFolderIpcHandlers({
      folders: channelFolders,
      remoteServers,
      getMainWindow: getDialogParent,
      translate: language.translate,
    }),
    ...agentInstructionsIpcHandlers({ files: agentInstructions, remoteServers }),
    ...hostedSiteIpcHandlers({
      hostedSites,
      remoteServers,
      getMainWindow: getDialogParent,
      translate: language.translate,
    }),
    ...githubConnectorIpcHandlers({ githubConnector, remoteServers, openExternal: openLink }),
    ...linkAccountIpcHandlers({ linkAccount }),
    ...onePasswordConnectorIpcHandlers({ onePasswordConnector, remoteServers }),
    ...bitwardenConnectorIpcHandlers({ bitwardenConnector, remoteServers }),
    ...passwordManagersIpcHandlers({ passwordManagers, remoteServers, openExternal: openLink }),
    ...vaultIpcHandlers({ vault, getMainWindow: getDialogParent, translate: language.translate, remoteServers }),
    ...billingIpcHandlers({ billing }),
    ...referralIpcHandlers({ referral }),
    ...licenseIpcHandlers({ license }),
    ...creditsIpcHandlers({ credits }),
    ...routineFeedIpcHandlers({ routineFeed }),
    ...eventsIpcHandlers({ events, remoteServers }),
    ...hostedServerIpcHandlers({ hostedServers }),
    ...localServerIpcHandlers({ localServers }),
    ...customProviderIpcHandlers(customProviderChanges),
    ...customAgentIpcHandlers({ changes: customAgentChanges, remoteServers }),
    ...acpRegistryIpcHandlers(acpRegistry, remoteServers),
    ...providerDetectionIpcHandlers({
      detection: providerDetection,
      settings: providerDetectionSettings,
      remoteServers,
    }),
    ...marketplaceAgentIpcHandlers({ marketplaceAgents }),
    ...agentTemplateIpcHandlers({
      agentTemplates,
      takePendingLink: () => takePendingDeepLink("agent-template")?.id ?? null,
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
      reportUploadProgress: forwardInstanceTransferUploadProgress,
    }),
    ...updateIpcHandlers({
      updater,
      updatePreferenceFile,
      requestedUpdate,
      idleRestart,
      describeReadiness: describeRestartReadiness,
    }),
    ...notificationIpcHandlers({
      notificationPreference,
      translate: language.translate,
      requestPermission: () => requestDesktopNotificationPermission(notificationPreference, language.translate),
      openExternal: (url) => shell.openExternal(url),
    }),
    ...teamIpcHandlers({
      host,
      localServers,
      ownerTransfers: centralAuth,
      remoteDesktop,
      remoteServers,
      takePendingInvite: () => takePendingDeepLink("invite")?.url ?? null,
    }),
    ...pluginIpcHandlers({
      takePendingPluginSlug: () => takePendingDeepLink("plugin")?.slug ?? null,
    }),
    ...marketplaceLinkIpcHandlers({
      takePendingListing: () => takePendingDeepLink("marketplace")?.link ?? null,
    }),
    ...memoryIpcHandlers({ service, remoteServers }),
    ...sharedTableIpcHandlers({ service, remoteServers }),
    ...routineIpcHandlers({ service, remoteServers }),
    ...workflowIpcHandlers({
      workflows,
      events,
      github: workflowGitHub,
      workflowFolders: workflowFoldersService,
      remoteServers,
      workflowFiles,
      getMainWindow: getDialogParent,
      translate: language.translate,
    }),
    ...crmIpcHandlers({ crm, remoteServers }),
    ...routineResultIpcHandlers({ routineResults, remoteServers }),
    ...channelMemoryIpcHandlers({ service, remoteServers }),
    ...channelRoutineIpcHandlers({ service, remoteServers }),
    ...agentAdminIpcHandlers({
      settings: agentAdminSettings,
      hostSettings: agentHostSettings,
      defaultsSettings: agentDefaultsSettings,
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
      voiceModel: hostVoiceModel,
      signalHome: hostSignalHome,
      hostTurnLimits,
      serverPersonality,
      agentMemoryLimit,
      memoryReview,
      skillLearning,
      browsingMemory,
      machineAlerts,
      promptCacheTtl,
      claudeUserSetup,
      cacheExpiryCompaction,
      claudeCompactWindow,
      providerEnvironment,
      modelVisibility,
      agentAccess,
      serverAudit,
      localServerId: () => teamStore.getIdentity()?.serverId,
      localAgentIds: () => service.listAgents().map((agent) => agent.id),
      localOwner: () => {
        const owner = teamStore.configured
          ? teamStore.listMembers().find((member) => member.role === "owner")
          : undefined;
        return owner ? memberAuditName(owner) : null;
      },
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
      mcpAccess,
      remoteServers,
      startToolRuntimes: () => {
        Effect.runFork(providerRuntimes.ensureToolRuntimes());
      },
      ensureToolRuntimesReady: () => providerRuntimes.ensureToolRuntimesReady(),
      toolRuntimes: () => providerRuntimes.mcpToolRuntimes(),
      relay: signInRelayClient,
      writeClipboard: (text) => clipboard.writeText(text),
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
      libraryFolders: libraryFoldersService,
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
      libraryFolders: libraryFoldersService,
      sidebarPins,
      host,
      remoteServers,
      skills,
      messageLinks: new MessageLinkRelay({
        remoteServers,
        relay: signInRelayClient,
        openUrl: (url) => openMessageLink(url, openLink),
      }),
      openExternal: openLink,
      modelVisibility,
      closeChatNotifications,
    }),
    ...browserIpcHandlers({
      browserPictureInPicture,
      detachedBrowserWindow,
      browser,
      remoteServers,
      browserView,
      localSignIn,
    }),
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

function haltServerStart(reason: StartHaltReason): Omit<StartHaltRecord, "version"> {
  const appVersion = app.getVersion();
  logger.error(
    `OpenBot ${appVersion} stopped its start loop (${reason}). It starts again after an update or a restart of the server or of the service.`,
  );
  const record = { reason, appVersion, haltedAt: Date.now() };
  writeStartHalt(app.getPath("userData"), record);
  startHaltExitCode = START_LOOP_EXIT_CODE;
  recordExit("start_loop");
  return record;
}

async function enterServerSafeMode(halt: Omit<StartHaltRecord, "version">): Promise<void> {
  if (shutdownStarted) return;
  const markerDirectory = safeModeMarkerDirectory(process.env, process.platform);
  try {
    serverSafeMode = await runCauseEffect(
      startServerSafeMode({ userDataPath: app.getPath("userData"), reason: halt, markerDirectory }),
    );
    if (shutdownStarted) await Effect.runPromise(serverSafeMode.stop);
  } catch (error) {
    logger.warn("The safe mode did not start. OpenBot quits.", toLogValue(error));
    app.quit();
    return;
  }
  if (markerDirectory === null) setTimeout(() => app.quit(), SERVER_SAFE_MODE_LIFETIME_MS);
}

async function recoverFromStartLoop(): Promise<
  StartRecovery | "quit" | { halt: Omit<StartHaltRecord, "version"> } | null
> {
  if (!startAttempts?.loopDetected) return null;
  const summary = startAttempts.summary();
  if (serverStartGuard) {
    if (previousStartHalt) {
      logger.warn(`OpenBot ${summary.appVersion} is in a start loop. It stopped the loop before, so it tries again.`);
      return null;
    }
    return { halt: haltServerStart("start_failed") };
  }
  logger.warn(`OpenBot ${summary.appVersion} is in a start loop. Showing the recovery window.`);
  const databaseSchemaVersion = readDatabaseSchemaVersion(app.getPath("userData"));
  const previousRelease = compatiblePreviousRelease({
    summary,
    databaseSchemaVersion,
    appSchemaVersion: LATEST_SCHEMA_VERSION,
  });
  logger.info(
    `Recovery window: database schema ${databaseSchemaVersion ?? "unknown"}, last good version ${summary.lastGoodVersion ?? "none"} (schema ${summary.lastGoodSchemaVersion ?? "unknown"}), offered release: ${previousRelease ?? "latest"}.`,
  );
  const locale = resolveLocale("system", app.getLocale());
  const recovery = openStartRecoveryWindow({
    summary,
    previousRelease,
    locale,
    translate: translateFor(locale),
    iconPath: appIconPath,
    showWithoutFocus: windowsOpenInBackground(),
  });
  const choice = await recovery.choice;
  logger.info(`Recovery window choice: ${choice}.`);
  return choice === "quit" ? "quit" : recovery;
}

async function presentApplication(): Promise<void> {
  await ensureMacApplicationPresence(
    process.platform,
    (policy) => app.setActivationPolicy(policy),
    () => (windowsOpenInBackground() ? Promise.resolve() : (app.dock?.show() ?? Promise.resolve())),
  );
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
  if (localServerChild) return;
  const automaticSignIn =
    previousCentralAuthStatus === null ||
    previousCentralAuthStatus === "loading" ||
    previousCentralAuthStatus === "error" ||
    previousCentralAuthStatus === "signed_in";
  previousCentralAuthStatus = state.status;
  if (state.status === "signed_in") {
    if (activeAnalyticsPrincipalId && activeAnalyticsPrincipalId !== state.user.id) services?.analytics.clear();
    activeAnalyticsPrincipalId = state.user.id;
    services?.analyticsPreferences.followAccount(state.user);
  } else if (state.status === "signed_out") {
    if (activeAnalyticsPrincipalId) services?.analytics.clear();
    activeAnalyticsPrincipalId = null;
  }
  services?.host.unbindChangedAccount(state.status === "signed_in" ? state.user : null);
  const generation = ++centralAuthGeneration;
  void runCauseEffect(
    remoteAccountGate.withPermit(
      Effect.gen(function* () {
        if (generation !== centralAuthGeneration) return;
        const nextPrincipalId = state.status === "signed_in" ? state.user.id : null;
        if (activeRemotePrincipalId && activeRemotePrincipalId !== nextPrincipalId && services) {
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
        if (generation !== centralAuthGeneration) return;
        activeRemotePrincipalId = nextPrincipalId;
        if (state.status !== "signed_in") {
          if (state.status === "signed_out" && services) {
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
            yield* services.remoteServers.forgetSavedPictures();
          }
          return;
        }
        const host = services?.host ?? null;
        if (host) {
          yield* host.applySignedInAccount(state.user);
          if (generation !== centralAuthGeneration) {
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
        if (host && services?.serverMode) yield* services.serverMode.publish(automaticSignIn);
        else if (host && shouldAutoStartHost({ ...host.getStatus(), remoteRole: developmentRemoteRole }))
          yield* host.start(true);
      }),
    ),
  ).catch((error) => {
    logger.error("Unable to synchronize the signed-in account:", toLogValue(error));
  });
  for (const chatWindow of windows.getChatWindows()) sendToRenderer(chatWindow, IPC_ENDPOINTS.auth.event, state);
  const window = windowHolder.current;
  if (!window || window.isDestroyed()) return;
  sendToRenderer(window, IPC_ENDPOINTS.auth.event, state);
}

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
  if (sendDeepLink(window, link)) pendingDeepLink = null;
}

function sendDeepLink(window: BrowserWindow, link: RendererDeepLink): boolean {
  switch (link.kind) {
    case "invite":
      return sendToRenderer(window, IPC_ENDPOINTS.servers.invite, link.url);
    case "plugin":
      return sendToRenderer(window, IPC_ENDPOINTS.plugins.openListing, link.slug);
    case "agent-template":
      return sendToRenderer(window, IPC_ENDPOINTS.agentTemplates.openLink, link.id);
    case "marketplace":
      return sendToRenderer(window, IPC_ENDPOINTS.marketplace.openListing, link.link);
  }
}

function takePendingDeepLink<Kind extends RendererDeepLink["kind"]>(
  kind: Kind,
): Extract<RendererDeepLink, { kind: Kind }> | null {
  deepLinkReceiverReady = true;
  const link = pendingDeepLink;
  if (!link || !isDeepLinkKind(link, kind)) return null;
  pendingDeepLink = null;
  return link;
}

function isDeepLinkKind<Kind extends RendererDeepLink["kind"]>(
  link: RendererDeepLink,
  kind: Kind,
): link is Extract<RendererDeepLink, { kind: Kind }> {
  return link.kind === kind;
}

function takeRendererDeepLink(link: DeepLink | null): RendererDeepLink | null {
  return link && link.kind !== "mcp-auth" && link.kind !== "slack-workspace" && link.kind !== "discord-guild"
    ? link
    : null;
}

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
      if (!accepted) {
        logger.warn(
          `A ${platform} install link was not accepted: no install of this run waits for it, or the joined server refused it.`,
        );
        return;
      }
      const window = windowHolder.current;
      if (window && !window.isDestroyed()) showMainWindow(window);
    })
    .catch((error: unknown) => {
      logger.error(`Unable to finish the ${platform} install:`, toLogValue(error));
    });
}

function receiveMcpAuthorizationCode(state: string, code: string): void {
  const elsewhere = services?.mcpOAuth.openedElsewhere(state) ?? false;
  if (!services?.mcpOAuth.receiveAuthorizationCode(state, code)) {
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
  logger.warn(singleInstanceExitMessage(singleInstanceOwnerPid(app.getPath("userData"))));
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
      const isLink = (value: string) => parseDeepLink(value, inviteLinkOptions) !== null;
      const link = argv.find(isLink);
      const args = process.argv.slice(1).filter((value) => !isLink(value));
      relaunchApp(app, link ? [...args, link] : args);
    }
  });

  void app
    .whenReady()
    .then(async () => {
      performance.mark("openbot:when-ready");
      replaceInvalidLinuxSystemLanguages();
      powerMonitor.on("suspend", () => runMarker?.suspend());
      powerMonitor.on("resume", () => runMarker?.resume());
      powerMonitor.on("shutdown", () => {
        runMarker?.osShutdown();
        startAttempts?.osShutdown();
      });
      if (process.platform === "darwin" && !localServerChild && !dockShowsBundleIcon)
        app.dock?.setIcon(developmentWorktreeIcon() ?? appIconPath);
      if (!(await runCauseEffect(hostAllowsTenantLaunch()))) {
        app.quit();
        return;
      }
      if (!localServerChild && !serverMode && !hostedServer) await presentApplication();
      const recovery = await recoverFromStartLoop();
      if (recovery === "quit") {
        quitFor("quit");
        return;
      }
      if (recovery && "halt" in recovery) {
        configureContentSecurityPolicy();
        configureRendererPermissions();
        await enterServerSafeMode(recovery.halt);
        return;
      }
      if (forcedStartFailure === "crash") process.crash();
      if (forcedStartFailure === "hang") await new Promise<never>(() => {});
      configureContentSecurityPolicy();
      configureRendererPermissions();
      if (!localServerChild) await Effect.runPromise(windows.restoreMainWindowBounds());
      if (process.platform === "darwin" && !localServerChild)
        setInitialWindowGlass(
          await runCauseEffect(readSavedTransparentWindow(join(app.getPath("userData"), APPEARANCE_PREFERENCE_FILE))),
        );
      const mainWindow = windows.openMainWindow();
      recovery?.close();

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
        quitting: () => quitStarted,
      });
      services = built;
      performance.mark("openbot:services-built");
      placeWindowButtons(BrowserWindow.getAllWindows());
      if (app.isPackaged && !serverMode && !hostedServer && !localServerChild) {
        teardown.push(0, "app archive watch", watchAppArchive(process.resourcesPath, built.language.translate));
      }
      const appliedAccount = built.appliedAccount;
      activeAnalyticsPrincipalId = centralAuthPrincipalId(appliedAccount);
      activeRemotePrincipalId = centralAuthPrincipalId(appliedAccount);
      const currentAccount = built.centralAuth.getState();
      if (currentAccount.status === "signed_out" && !localServerChild)
        void runCauseEffect(built.remoteServers.forgetSavedPictures());
      if (
        currentAccount.status !== appliedAccount.status ||
        centralAuthPrincipalId(currentAccount) !== centralAuthPrincipalId(appliedAccount)
      ) {
        forwardCentralAuth(currentAccount);
      } else if (currentAccount.status === "signed_in") {
        built.analyticsPreferences.followAccount(currentAccount.user);
      }
      const {
        service,
        sidebarLayout,
        host,
        remoteDesktop,
        remoteServers,
        updater,
        dynamicIsland,
        agentDock,
        teamStore,
        language,
        logoColor,
        appearance,
        interfaceSize,
        trace,
        appBehavior,
      } = built;

      crashTrace = trace;
      setIpcCallObserver((call) => {
        trace.record({ kind: "ipc", ...call });
        perfTime(`ipc.invoke ${call.name}`, call.durationMs);
      });
      service.on("event", (event) => trace.observeAgentEvent(event));
      service.on("event", (event) => forwardAgentEvent("local", event));
      let webhookAgentIds = new Set(service.listAgents().map((agent) => agent.id));
      const onRoutineEvent = (event: AgentEvent): void => {
        switch (event.type) {
          case "routines-changed":
          case "channel-routines-changed":
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
      let webhookPrincipalId = built.webhookPrincipal();
      built.eventsRuntime.setAccountPrincipal(webhookPrincipalId);
      const refreshWebhookRoutes = (): void => {
        const principalId = built.webhookPrincipal();
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
        const principalId = built.webhookPrincipal();
        if (hostIdentityChanged && principalId !== null && status.serverId !== null)
          built.eventsRuntime.syncRoutes({ all: true });
      };
      teardown.push(0, "event service listeners", () => {
        service.off("event", onRoutineEvent);
        built.centralAuth.off("changed", refreshWebhookRoutes);
        host.off("changed", onHostChanged);
      });
      service.on("toolUsage", (usage) => built.analytics.handleToolUsage(usage));
      service.on("workflowRun", (end) => built.analytics.handleWorkflowRun(end));
      service.on("liveVoice", forwardVoiceLiveEvent);
      built.browser.onSiteVisited((visit) => built.analytics.handleSiteVisit(visit));
      sidebarLayout.on("changed", (layout) => forwardAgentEvent("local", { type: "sidebar-layout-changed", layout }));
      built.sidebarPins.subscribe((key) => {
        if (key === OWNER_PIN_KEY)
          forwardAgentEvent("local", { type: "sidebar-pins-changed", ...built.sidebarPins.snapshot(OWNER_PIN_KEY) });
      });
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
      built.linkAccount.onChanged(forwardLinkAccountStatus);
      built.onePasswordConnector.onChanged(forwardOnePasswordConnectorStatus);
      built.bitwardenConnector.onChanged(forwardBitwardenConnectorStatus);
      built.passwordManagers.onChanged(forwardPasswordManagerStatus);
      built.vault.onChanged(forwardVaultState);
      remoteServers.on("changed", forwardServers);
      remoteServers.on("directoryInvalidated", forwardOwnerTransfersChanged);
      remoteServers.on("agent", (serverId, event, bufferedLive) => {
        forwardAgentEvent(serverId, event, bufferedLive);
      });
      remoteServers.on("receivedRuntimeSnapshot", withdrawSettledNotifications);
      remoteServers.on("presence", forwardTeamPresence);
      remoteServers.on("directMessage", forwardDirectMessage);
      remoteServers.on("directTyping", forwardDirectTyping);
      remoteServers.on("attachmentDownload", forwardAttachmentDownload);
      remoteServers.on("attachmentImportProgress", forwardAttachmentImportProgress);
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
      updater.on("status", (status) => {
        if (!shutdownStarted || status.errorCode !== "install_failed") return;
        logger.error("OpenBot update install failed after shutdown preparation and will exit now.");
        exitAfterLogFlush();
      });
      built.requestedUpdate.on("preference", forwardUpdatePreference);
      updater.start();
      built.requiredUpdate?.start();
      built.hostUpdateCoordinator.setStopHandler(async () => {
        await prepareForUpdateInstall(SHUTDOWN_DEADLINE_MS);
        app.quit();
      });
      registerIpcHandlers(built);
      const renewHostSignal = () =>
        void runCauseEffect(built.teamWebRtcBridge.renewHostSignal()).catch((error) =>
          logger.warn("Unable to renew the host Signal connection after sleep:", toLogValue(error)),
        );
      if (localServerChild) {
        const childRoutineWake = new RoutineWake({ routines: service, isOnline: () => net.isOnline() });
        powerMonitor.on("suspend", () => childRoutineWake.suspend());
        powerMonitor.on("resume", () => childRoutineWake.resume());
        powerMonitor.on("resume", () => built.messaging.resume());
        powerMonitor.on("resume", renewHostSignal);
        teardown.push(0, "routine wake", () => childRoutineWake.dispose());
        void runCauseEffect(built.agentInitialization.start()).catch((error) => {
          logger.error("Unable to initialize the local agent backend:", toLogValue(error));
        });
        return;
      }
      const publishOnLaunch = () => {
        const teamIdentity = teamStore.getIdentity();
        if (built.serverMode) {
          const serverModeControl = built.serverMode;
          void runCauseEffect(
            built.centralAuthInitialization.pipe(Effect.flatMap(() => serverModeControl.publish(true))),
          ).catch((error) => logger.error("Unable to publish this server:", toLogValue(error)));
        } else if (
          shouldAutoStartHost({
            configured: Boolean(teamIdentity),
            enabledOnLaunch: teamIdentity?.enabledOnLaunch ?? false,
            remoteRole: developmentRemoteRole,
          })
        ) {
          void runCauseEffect(built.centralAuthInitialization.pipe(Effect.flatMap(() => host.start(true)))).catch(
            (error) => logger.error("Unable to republish this OpenBot:", toLogValue(error)),
          );
        }
      };
      const publishesBeforeRenderer = Boolean(built.serverMode || hostedServer);
      if (publishesBeforeRenderer) publishOnLaunch();
      void requestDesktopNotificationPermission(built.notificationPreference, language.translate).catch((error) =>
        logger.warn("Unable to ask for notification permission:", toLogValue(error)),
      );
      configureApplicationMenu(
        service,
        updater,
        interfaceSize,
        language.translate,
        () => windowHolder.current,
        workingAgents,
        quitGuard,
        quitFor,
      );
      backgroundTray = createBackgroundTray({
        icon: appIconColorImage ?? nativeImage.createFromPath(appIconPath),
        menuBarIcon: loadMenuBarIcon(),
        translate: language.translate,
        open: reopenMainWindow,
        quit: () => quitFor("tray"),
        stopRemoteControl: () => {
          void runCauseEffect(host.stopRemoteControl()).catch((error) =>
            logger.warn("Unable to stop remote control:", toLogValue(error)),
          );
        },
      });
      const tray = backgroundTray;
      tray.sync(appBehavior.keepRunningInBackground);
      const unsubscribeBackgroundTray = appBehavior.subscribe(() => tray.sync(appBehavior.keepRunningInBackground));
      const showRemoteControl = (memberNames: string[]) => tray.setRemoteControl(memberNames);
      const announceRemoteControl = (memberName: string) => notifyRemoteControlStarted(language.translate, memberName);
      host.on("remoteControlChanged", showRemoteControl);
      host.on("remoteControlStarted", announceRemoteControl);
      teardown.push(0, "background tray", () => {
        unsubscribeBackgroundTray();
        host.off("remoteControlChanged", showRemoteControl);
        host.off("remoteControlStarted", announceRemoteControl);
        tray.destroy();
      });
      language.subscribe((preference) => {
        configureApplicationMenu(
          service,
          updater,
          interfaceSize,
          language.translate,
          () => windowHolder.current,
          workingAgents,
          quitGuard,
          quitFor,
        );
        tray.relabel();
        for (const window of BrowserWindow.getAllWindows()) {
          sendToRenderer(window, IPC_ENDPOINTS.app.appLanguagePreference, preference);
        }
        placeWindowButtons(BrowserWindow.getAllWindows());
      });
      applyAppIconColor(logoColor.preference.color, logoColor.chosen);
      logoColor.subscribe((preference) => {
        applyAppIconColor(preference.color, logoColor.chosen);
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
        windows.applyInterfaceSize(interfaceSize.zoomFactor);
        for (const window of BrowserWindow.getAllWindows()) {
          sendToRenderer(window, IPC_ENDPOINTS.app.appInterfaceSizePreference, preference);
        }
      });
      await runCauseEffect(dynamicIsland.initialize()).catch((error) =>
        logger.error("Unable to initialize Dynamic Island:", toLogValue(error)),
      );
      const reconcileDynamicIsland = () =>
        void Effect.runPromise(dynamicIsland.reconcileWindow()).catch((error) =>
          logger.error("Unable to reconcile Dynamic Island displays:", toLogValue(error)),
        );
      reconcileDynamicIsland();
      await windows.loadRenderer(mainWindow);
      performance.mark("openbot:renderer-loaded");
      startAttempts?.finished();
      built.startup?.rendererLoaded();
      Effect.runFork(built.prewarmAgentDatabase);
      await Effect.runPromise(remoteServers.startEventConnections());
      screen.on("display-added", reconcileDynamicIsland);
      screen.on("display-removed", reconcileDynamicIsland);
      screen.on("display-metrics-changed", reconcileDynamicIsland);
      powerMonitor.on("resume", reconcileDynamicIsland);
      const reconcileAgentDock = () =>
        void Effect.runPromise(agentDock.reconcileWindow()).catch((error) =>
          logger.error("Unable to place the agent dock:", toLogValue(error)),
        );
      screen.on("display-added", reconcileAgentDock);
      screen.on("display-removed", reconcileAgentDock);
      screen.on("display-metrics-changed", reconcileAgentDock);
      powerMonitor.on("resume", reconcileAgentDock);
      powerMonitor.on("resume", () => void Effect.runPromise(remoteServers.wake()));
      powerMonitor.on("resume", () => built.messaging.resume());
      powerMonitor.on("resume", renewHostSignal);
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
      if (!publishesBeforeRenderer) publishOnLaunch();
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
      if (shutdownStarted) {
        logger.warn("The quit stopped the start:", toLogValue(error));
        return;
      }
      const message = (error instanceof Error ? error.message : String(error)).replace(/[^\P{Cc}\n\t]/gu, "�");
      logger.error("OpenBot failed to start:", toLogValue(error));
      if (!(error instanceof NewerDatabaseError)) startAttempts?.failed("error");
      if (serverStartGuard) {
        const reason = startHaltReason(error);
        if (reason !== "newer_database" && !startAttempts?.failureLimitReached) {
          app.quit();
          return;
        }
        const halt = haltServerStart(reason);
        void teardown
          .runAll()
          .then(() => enterServerSafeMode(halt))
          .catch((teardownError) => {
            logger.error("The teardown before the safe mode failed:", toLogValue(teardownError));
            app.quit();
          });
        return;
      }
      if (!serverMode && !hostedServer && !localServerChild) {
        const locale = services?.language.locale ?? resolveLocale("system", app.getLocale());
        const translate = services?.language.translate ?? translateFor(locale);
        if (error instanceof NewerDatabaseError) {
          recoverFromNewerDatabase({
            window: windowHolder.current,
            translate,
            beforeInstall: prepareForUpdateInstall,
            loopVersion: startAttempts?.summary().loopVersion ?? null,
          }).catch((recoveryError) => {
            logger.error("The update over newer data failed:", toLogValue(recoveryError));
            app.quit();
          });
          return;
        }
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
  if (systemSessionEnding) recordExit("session_end");
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
  if (shutdownDone) return;
  event.preventDefault();
  if (shutdownStarted) return;
  void prepareForShutdown().finally(() => (startHaltExitCode === null ? app.quit() : exitAfterLogFlush()));
});

function loadMenuBarIcon(): NativeImage | null {
  if (process.platform !== "darwin") return null;
  const icon = nativeImage.createFromPath(
    resolveMenuBarIconPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      sourceRoot: resolve(__dirname, "../.."),
    }),
  );
  if (!icon.isEmpty()) return icon;
  logger.warn("The menu bar icon is missing.");
  return null;
}

function reopenMainWindow(): void {
  void windows
    .ensureMainWindow()
    .then(showMainWindow)
    .catch((error) => logger.error("Unable to open the main window:", toLogValue(error)));
}

const SHUTDOWN_DEADLINE_MS = 30_000;

function forceExitAfterShutdownDeadline(deadlineMs: number): void {
  setTimeout(() => {
    logger.error(`OpenBot did not quit within ${deadlineMs} ms and will exit now.`);
    runMarker?.quitTimedOut();
    exitAfterLogFlush();
  }, deadlineMs);
}

const LOG_FLUSH_DEADLINE_MS = 2_000;

function exitAfterLogFlush(): void {
  void Effect.runPromise(
    Effect.all([flushMainLog(), services ? services.updater.flushLog() : Effect.void], {
      concurrency: "unbounded",
    }).pipe(Effect.timeoutOption(LOG_FLUSH_DEADLINE_MS)),
  ).finally(() => app.exit(startHaltExitCode ?? 0));
}

async function prepareForUpdateInstall(deadlineMs = UPDATE_INSTALL_TIMEOUT_MS): Promise<void> {
  recordExit("update");
  if (services) await runCauseEffect(services.browser.flushPersistentStorage());
  await prepareForShutdown(deadlineMs);
}

async function prepareForShutdown(deadlineMs = SHUTDOWN_DEADLINE_MS): Promise<void> {
  if (shutdownStarted) return;
  recordExit("quit");
  shutdownStarted = true;
  isQuitting = true;
  hideExceptionErrorBox();
  forceExitAfterShutdownDeadline(deadlineMs);
  try {
    if (services) Effect.runFork(services.updater.stop());
    await runCauseEffect(windows.flushMainWindowBounds()).catch((error) =>
      logger.error("Unable to save the main window position:", toLogValue(error)),
    );
    session.defaultSession.flushStorageData();
    hideWindowsForQuit();
    services?.dynamicIsland.destroy();
    services?.agentDock.destroy();
    macHapticFeedback.destroy();
    await teardown.runAll();
    if (serverSafeMode) await Effect.runPromise(serverSafeMode.stop);
    runMarker?.clean();
  } finally {
    shutdownDone = true;
  }
}
