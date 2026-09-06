import { join, resolve } from "node:path";
import { parseInviteUrl } from "@openbot/contracts/invite-links";
import { type CentralAuthState, IPC_CHANNELS } from "@openbot/contracts/ipc";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { app, type BrowserWindow, dialog, powerMonitor, protocol, screen } from "electron";
import { readAppVariant, resolveAppIconPath } from "./app-icon";
import { type ApplicationServices, createApplicationServices } from "./application-services";
import { guardDevelopmentOutput } from "./development-output";
import {
  developmentUserDataName,
  readDevelopmentInstanceId,
  readDevelopmentProfile,
  readDevelopmentRemoteDebuggingPort,
  shouldAutoStartHost,
} from "./development-profile";
import { registerAccountIpcHandlers } from "./ipc/register-account-handlers";
import { registerAgentIpcHandlers } from "./ipc/register-agent-handlers";
import { registerAppIpcHandlers } from "./ipc/register-app-handlers";
import { registerAttachmentIpcHandlers } from "./ipc/register-attachment-handlers";
import { registerBrowserIpcHandlers } from "./ipc/register-browser-handlers";
import { registerComputerUseIpcHandlers } from "./ipc/register-computer-use-handlers";
import { registerDynamicIslandIpcHandlers } from "./ipc/register-dynamic-island-handlers";
import { registerHostedSiteIpcHandlers } from "./ipc/register-hosted-site-handlers";
import { registerMarketplaceAgentIpcHandlers } from "./ipc/register-marketplace-agent-handlers";
import { registerMemoryIpcHandlers } from "./ipc/register-memory-handlers";
import { registerProviderIpcHandlers } from "./ipc/register-provider-handlers";
import { registerRoutineIpcHandlers } from "./ipc/register-routine-handlers";
import { registerSkillIpcHandlers } from "./ipc/register-skill-handlers";
import { registerTeamIpcHandlers } from "./ipc/register-team-handlers";
import { registerUpdateIpcHandlers } from "./ipc/register-update-handlers";
import { registerVoiceIpcHandlers } from "./ipc/register-voice-handlers";
import { MacHapticFeedback } from "./mac-haptic-feedback";
import {
  configureApplicationMenu,
  createMainWindowController,
  createMainWindowHolder,
  showMainWindow,
} from "./main-window";
import { ensureMacApplicationPresence } from "./main-window-state";
import { createRendererForwarders } from "./renderer-forwarders";
import { sendToRenderer } from "./renderer-ipc";
import { configureContentSecurityPolicy, configureRendererPermissions } from "./session-configuration";
import { TeardownRegistry } from "./teardown-registry";

const logger = createOpenBotLogger("main");

const commandLineUserDataDirectory = app.commandLine.getSwitchValue("user-data-dir").trim();
const developmentProfile = !app.isPackaged ? readDevelopmentProfile(process.env.OPENBOT_DEV_PROFILE) : null;
const developmentRemoteRole =
  !app.isPackaged &&
  (process.env.OPENBOT_DEV_REMOTE_ROLE === "host" || process.env.OPENBOT_DEV_REMOTE_ROLE === "client")
    ? process.env.OPENBOT_DEV_REMOTE_ROLE
    : null;
const developmentTestClientEnabled = !app.isPackaged && process.env.OPENBOT_DEV_TEST_CLIENT_ENABLED === "1";
const developmentInviteLinkOptions = {
  allowLocalDevelopmentApiUrl: developmentRemoteRole !== null,
};
const developmentRemoteDebuggingPort = !app.isPackaged
  ? readDevelopmentRemoteDebuggingPort(process.env.OPENBOT_DEV_REMOTE_DEBUGGING_PORT)
  : null;
if (developmentRemoteDebuggingPort) {
  app.commandLine.appendSwitch("remote-debugging-port", developmentRemoteDebuggingPort);
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
}
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
  {
    scheme: "openbot-attachment",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
  {
    scheme: "openbot-remote-attachment",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
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
let remoteAccountSync = Promise.resolve();
const macHapticFeedback = new MacHapticFeedback();
let isQuitting = false;
let shutdownStarted = false;
let systemSessionEnding = false;
let systemSessionEndFlushStarted = false;
let pendingInviteUrl: string | null = findInviteUrl(process.argv);
let inviteReceiverReady = false;

const MAIN_WINDOW_STATE_FILE = "openbot-main-window-state-v1.json";

if (!app.isPackaged) {
  const quitAfterDevelopmentSignal = () => app.quit();
  process.once("SIGINT", quitAfterDevelopmentSignal);
  process.once("SIGTERM", quitAfterDevelopmentSignal);
  process.once("SIGHUP", quitAfterDevelopmentSignal);
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
  forwardBrowserDisplayState,
  forwardUpdateStatus,
  forwardVoiceModelStatus,
  forwardProviderRuntimeStatus,
  forwardHostStatus,
  forwardRemoteDesktopSessions,
  forwardServers,
  forwardTeamPresence,
  forwardDirectMessage,
  forwardDirectTyping,
} = createRendererForwarders({
  getMainWindow: () => windowHolder.current,
  getAgentService: () => services?.service ?? null,
  getHostService: () => services?.host ?? null,
  getHostAnalytics: () => services?.analytics ?? null,
  getRemoteServerManager: () => services?.remoteServers ?? null,
  showMainWindow,
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
  getServices: () => services,
  forwardAgentEvent,
  onRendererLoadStarted: () => {
    inviteReceiverReady = false;
  },
  onMainWindowCreated: attachWindowsSessionEndHandlers,
  reportError: (message, error) => logger.error(message, toLogValue(error)),
});

/**
 * Windows gives an application a few seconds between announcing a session end and killing it, so
 * these two handlers flush rather than shut down: they deliberately do not call
 * `prepareForShutdown`, which awaits network teardown the deadline has no room for. They are
 * registered when the first window is built, long before any service exists, which is why every
 * read below goes through `services?.`.
 */
function attachWindowsSessionEndHandlers(window: BrowserWindow): void {
  if (process.platform !== "win32") return;
  window.on("query-session-end", () => {
    systemSessionEnding = true;
    isQuitting = true;
    if (systemSessionEndFlushStarted) return;
    systemSessionEndFlushStarted = true;
    services?.updater.stop();
    void windows
      .flushMainWindowBounds()
      .catch((error) =>
        logger.error("Unable to save the main window position before Windows session end:", toLogValue(error)),
      );
    void services?.browser
      .flushPersistentStorage()
      .catch((error) => logger.error("Unable to flush browser storage before Windows session end:", toLogValue(error)));
    void services?.providerRuntimes.stop();
  });
  window.on("session-end", () => {
    systemSessionEnding = true;
    isQuitting = true;
    void windows
      .flushMainWindowBounds()
      .catch((error) =>
        logger.error("Unable to save the main window position during Windows session end:", toLogValue(error)),
      );
    void services?.browser
      .flushPersistentStorage()
      .catch((error) => logger.error("Unable to flush browser storage during Windows session end:", toLogValue(error)));
    void services?.providerRuntimes.stop();
  });
}

function registerIpcHandlers({
  service,
  providerRuntimes,
  mailbox,
  browser,
  browserPictureInPicture,
  updater,
  setupFile,
  analyticsPreferenceFile,
  updatePreferenceFile,
  agentInitialization,
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
}: ApplicationServices): void {
  // Every renderer-to-main endpoint is registered by one of these, one file per
  // domain under ./ipc. Nothing is registered inline here: this is the trust
  // boundary, and a reviewer should be able to read a domain's whole surface in
  // one file rather than find it interleaved with window and lifecycle code.
  const getMainWindow = () => windowHolder.current;

  registerAppIpcHandlers({
    service,
    mailbox,
    browser,
    updater,
    setupFile,
    analyticsPreferenceFile,
    initializeAgent: () => agentInitialization.start(),
    appVariant,
    getMainWindow,
    setAnalyticsTrackingEnabled: (enabled) => analytics.setTrackingEnabled(enabled),
  });
  registerDynamicIslandIpcHandlers({ dynamicIsland });
  registerComputerUseIpcHandlers({ computerUseMacSetup });
  registerProviderIpcHandlers({ service, providerRuntimes });
  registerVoiceIpcHandlers({ voice });
  registerAccountIpcHandlers({ centralAuth, host });
  registerSkillIpcHandlers({ skills, getMainWindow });
  registerHostedSiteIpcHandlers({ hostedSites, getMainWindow });
  registerMarketplaceAgentIpcHandlers({ marketplaceAgents });
  registerUpdateIpcHandlers({ updater, updatePreferenceFile });
  registerTeamIpcHandlers({
    host,
    remoteDesktop,
    remoteServers,
    takePendingInvite: () => {
      inviteReceiverReady = true;
      const inviteUrl = pendingInviteUrl;
      pendingInviteUrl = null;
      return inviteUrl;
    },
  });
  registerMemoryIpcHandlers({ service, remoteServers });
  registerRoutineIpcHandlers({ service, remoteServers });
  registerAttachmentIpcHandlers({ service, mailbox, remoteServers, getMainWindow });
  registerAgentIpcHandlers({ service, sidebarLayout, host, remoteServers, skills });
  registerBrowserIpcHandlers({ browserPictureInPicture, browser, remoteServers });
}

function forwardCentralAuth(state: CentralAuthState): void {
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
  remoteAccountSync = remoteAccountSync
    .then(async () => {
      // Sign-outs and sign-ins can queue up behind one slow teardown. Only the account the
      // renderer was last told about may be activated; an earlier one would put a host the
      // user has already left back within reach.
      if (generation !== centralAuthGeneration) return;
      const nextPrincipalId = state.status === "signed_in" ? state.user.id : null;
      if (activeRemotePrincipalId && activeRemotePrincipalId !== nextPrincipalId) {
        // Best-effort, like every other network step here: a bridge disconnect that
        // rejects must not stop the local host from leaving the previous account.
        try {
          await services?.remoteServers.disconnectRemoteSessions();
        } catch (error) {
          logger.error("Unable to disconnect the previous account's remote sessions:", toLogValue(error));
        }
      }
      // Rechecked after the disconnect: another account can be announced while it awaits,
      // and activating this one now would put its host back within the newer account's reach.
      if (generation !== centralAuthGeneration) return;
      activeRemotePrincipalId = nextPrincipalId;
      if (state.status !== "signed_in") {
        if (state.status === "signed_out") {
          // Stopping is best-effort; unbinding the host is not, so a failed teardown
          // must not leave the signed-out account's host bound.
          try {
            await services?.host.stop(false);
          } catch (error) {
            logger.error("Unable to stop the host while signing out:", toLogValue(error));
          }
          await services?.host.applySignedInAccount(null);
        }
        return;
      }
      const host = services?.host ?? null;
      // The local host is rebound before the joined-server list is synchronized, and the
      // network failure is contained: this account must not end up signed in while the
      // previous account's host is still selected and possibly online.
      if (host) {
        await host.applySignedInAccount(state.user);
        if (generation !== centralAuthGeneration) {
          // Another account was announced while this one was being activated. Its own queued
          // callback binds it; until then no host answers for either.
          host.unbindChangedAccount(null);
          return;
        }
        services?.analytics.flushPending();
      }
      try {
        await services?.remoteServers.syncRemoteHosts();
      } catch (error) {
        logger.error("Unable to synchronize the joined servers:", toLogValue(error));
      }
      if (host && shouldAutoStartHost({ ...host.getStatus(), remoteRole: developmentRemoteRole })) await host.start();
    })
    .catch((error) => {
      logger.error("Unable to synchronize the signed-in account:", toLogValue(error));
    });
  const window = windowHolder.current;
  if (!window || window.isDestroyed()) return;
  sendToRenderer(window, IPC_CHANNELS.authEvent, state);
}

function acceptInviteUrl(value: string): void {
  try {
    parseInviteUrl(value, developmentInviteLinkOptions);
  } catch {
    return;
  }
  pendingInviteUrl = value;
  const window = windowHolder.current;
  if (window && !window.isDestroyed() && inviteReceiverReady) {
    showMainWindow(window);
    if (sendToRenderer(window, IPC_CHANNELS.serversInvite, value)) pendingInviteUrl = null;
  }
}

function acceptOpenbotUrl(value: string): void {
  acceptInviteUrl(value);
}

function findInviteUrl(values: string[]): string | null {
  for (const value of values) {
    try {
      parseInviteUrl(value, developmentInviteLinkOptions);
      return value;
    } catch {
      // Most command-line arguments are not invitations.
    }
  }
  return null;
}

app.on("open-url", (event, url) => {
  try {
    parseInviteUrl(url, developmentInviteLinkOptions);
  } catch {
    return;
  }
  event.preventDefault();
  acceptOpenbotUrl(url);
});

app.on("continue-activity", (event, type, _userInfo, details) => {
  if (type !== "NSUserActivityTypeBrowsingWeb" || !details.webpageURL) return;
  try {
    parseInviteUrl(details.webpageURL, developmentInviteLinkOptions);
  } catch {
    return;
  }
  event.preventDefault();
  acceptInviteUrl(details.webpageURL);
});

if (!hasSingleInstanceLock) {
  // No application services exist yet, so the secondary process can exit without shutdown work.
  process.exit(0);
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLink = findInviteUrl(argv);
    if (deepLink) acceptOpenbotUrl(deepLink);
    const window = windowHolder.current;
    if (!window || window.isDestroyed()) return;
    showMainWindow(window);
  });

  void app
    .whenReady()
    .then(async () => {
      await ensureMacApplicationPresence(
        process.platform,
        (policy) => app.setActivationPolicy(policy),
        () => app.dock?.show() ?? Promise.resolve(),
      );
      if (process.platform === "darwin") app.setAsDefaultProtocolClient("openbot");
      if (process.platform === "darwin") app.dock?.setIcon(appIconPath);
      configureContentSecurityPolicy();
      configureRendererPermissions();
      await windows.restoreMainWindowBounds();
      const mainWindow = windows.openMainWindow();

      const built = await createApplicationServices({
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
      });
      services = built;
      const { service, sidebarLayout, host, remoteDesktop, remoteServers, updater, dynamicIsland, teamStore } = built;

      service.on("event", (event) => forwardAgentEvent("local", event));
      sidebarLayout.on("changed", (layout) => forwardAgentEvent("local", { type: "sidebar-layout-changed", layout }));
      host.on("changed", forwardHostStatus);
      host.on("presence", (snapshot) => forwardTeamPresence("local", snapshot));
      host.on("directMessage", (event) => forwardDirectMessage("local", event));
      host.on("directTyping", (event) => forwardDirectTyping("local", event));
      remoteDesktop.on("changed", forwardRemoteDesktopSessions);
      remoteServers.on("changed", forwardServers);
      remoteServers.on("agent", (serverId, event, bufferedLive) => {
        forwardAgentEvent(serverId, event, bufferedLive);
      });
      remoteServers.on("presence", forwardTeamPresence);
      remoteServers.on("directMessage", forwardDirectMessage);
      remoteServers.on("directTyping", forwardDirectTyping);
      updater.on("status", forwardUpdateStatus);
      updater.start();
      // Before the renderer loads: the trust boundary and every protocol it fetches through have to
      // be in place before the first request can arrive.
      registerIpcHandlers(built);
      configureApplicationMenu(service, updater);
      await dynamicIsland
        .initialize()
        .catch((error) => logger.error("Unable to initialize Dynamic Island:", toLogValue(error)));
      await windows.loadRenderer(mainWindow);
      // After the load: `sendToRenderer` drops events aimed at a window that is still loading.
      remoteServers.startEventConnections();
      const reconcileDynamicIsland = () =>
        void dynamicIsland
          .reconcileWindow()
          .catch((error) => logger.error("Unable to reconcile Dynamic Island displays:", toLogValue(error)));
      screen.on("display-added", reconcileDynamicIsland);
      screen.on("display-removed", reconcileDynamicIsland);
      screen.on("display-metrics-changed", reconcileDynamicIsland);
      powerMonitor.on("resume", reconcileDynamicIsland);
      const teamIdentity = teamStore.getIdentity();
      if (
        shouldAutoStartHost({
          configured: Boolean(teamIdentity),
          enabledOnLaunch: teamIdentity?.enabledOnLaunch ?? false,
          remoteRole: developmentRemoteRole,
        })
      ) {
        void built.centralAuthInitialization
          .then(() => host.start())
          .catch((error) => logger.error("Unable to republish this OpenBot:", toLogValue(error)));
      }
      void built.agentInitialization.start().catch((error) => {
        logger.error("Unable to initialize the local agent backend:", toLogValue(error));
      });

      app.on("activate", () => {
        const window = windowHolder.current;
        if (window && !window.isDestroyed()) {
          showMainWindow(window);
          return;
        }
        void windows
          .ensureMainWindow()
          .then(showMainWindow)
          .catch((error) => logger.error("Unable to open the main window:", toLogValue(error)));
      });
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("OpenBot failed to start:", toLogValue(error));
      dialog.showErrorBox(
        "OpenBot couldn’t start",
        `${message}\n\nYour local data was not reset or overwritten. See the troubleshooting guide for recovery steps.`,
      );
      app.quit();
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  isQuitting = true;
  if (systemSessionEnding) {
    services?.updater.stop();
    void services?.providerRuntimes.stop();
    return;
  }
  if (shutdownStarted) return;
  event.preventDefault();
  void prepareForShutdown().finally(() => app.quit());
});

async function prepareForUpdateInstall(): Promise<void> {
  await (services?.browser.flushPersistentStorage() ?? Promise.resolve());
  await prepareForShutdown();
}

/**
 * The four steps ahead of `teardown.runAll()` are pinned here rather than registered: the notch
 * windows and the haptic process have to disappear the moment the user asks to quit, not behind a
 * remote host that can take seconds to stop. The two service calls among them are registered as
 * well, for the case where the quit arrives before those services exist; both are idempotent, so
 * running twice costs nothing.
 */
async function prepareForShutdown(): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  isQuitting = true;
  services?.updater.stop();
  await windows
    .flushMainWindowBounds()
    .catch((error) => logger.error("Unable to save the main window position:", toLogValue(error)));
  services?.dynamicIsland.destroy();
  macHapticFeedback.destroy();
  await teardown.runAll();
}
