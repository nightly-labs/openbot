/**
 * Every `BrowserWindow` the desktop app opens, the renderer URLs they load, and the application
 * menu. It is the one surface that legitimately keeps a mutable window handle: macOS destroys the
 * main window when the user closes it and rebuilds it on `activate`, so `holder.current` is null
 * for real stretches of a running app rather than only during startup.
 *
 * `getServices` is the single lazy accessor left on this surface, and it is lazy for the same
 * honest reason: `createWindow` runs at the top of `app.whenReady()`, before
 * `createApplicationServices` has built anything. Every other dependency arrives as a value.
 */

import { join } from "node:path";
import { type AgentEvent, LOCAL_SERVER_ID, type MacPermissionId } from "@openbot/contracts/ipc";
import { app, BrowserWindow, type Display, Menu, type Rectangle, screen } from "electron";
import type { AgentService } from "../backend/agent-service";
import type { BrowserHost } from "../backend/browser-host";
import { isCloseBrowserTabShortcut, isSelectAllShortcut, isToggleDevToolsShortcut } from "../backend/browser-shortcuts";
import type { ComputerUseMacSetupWindowController } from "./computer-use-mac-setup-window";
import { shouldShowDevelopmentWindow } from "./development-profile";
import { dynamicIslandNotchSizeForDisplay } from "./dynamic-island-window";
import {
  createMainWindowBoundsRecorder,
  presentMainWindow,
  readMainWindowBounds,
  resolveMainWindowBounds,
  writeMainWindowBounds,
} from "./main-window-state";
import type { RemoteServerManager } from "./remote-server-manager";
import { isTrustedRendererUrl } from "./trusted-renderer";
import type { UpdateService } from "./update-service";

/**
 * What the window surface reads off the running application. Deliberately narrower than
 * `ApplicationServices`: keeping it structural is what lets the composition root import this
 * module without this module importing it back.
 */
export interface MainWindowApplicationServices {
  service: AgentService;
  browser: BrowserHost;
  remoteServers: RemoteServerManager;
  computerUseMacSetup: ComputerUseMacSetupWindowController;
}

/** The two handles that outlive any one window, so `activate` can rebuild into the same slot. */
export interface MainWindowHolder {
  current: BrowserWindow | null;
  load: Promise<BrowserWindow> | null;
}

export function createMainWindowHolder(): MainWindowHolder {
  return { current: null, load: null };
}

export interface MainWindowContext {
  holder: MainWindowHolder;
  statePath: string;
  appIconPath: string;
  developmentProfile: string | null;
  developmentRemoteRole: "host" | "client" | null;
  developmentTestClientEnabled: boolean;
  /** A function, not a flag: the window is built long before the first quit is requested. */
  isQuitting: () => boolean;
  /** A function, not a value: nothing exists yet when the first window is created. */
  getServices: () => MainWindowApplicationServices | null;
  forwardAgentEvent: (serverId: string, event: AgentEvent) => void;
  /** The renderer is about to be replaced, so a queued invitation has nobody to receive it. */
  onRendererLoadStarted: () => void;
  /** Where the entry point attaches the Windows session-end handlers, which read its own flags. */
  onMainWindowCreated: (window: BrowserWindow) => void;
  reportError: (message: string, error: unknown) => void;
}

export interface MainWindowController {
  getMainWindow: () => BrowserWindow | null;
  openMainWindow: () => BrowserWindow;
  ensureMainWindow: () => Promise<BrowserWindow>;
  loadRenderer: (window: BrowserWindow) => Promise<void>;
  createComputerUseMacSetupWindow: () => BrowserWindow;
  restoreMainWindowBounds: () => Promise<void>;
  flushMainWindowBounds: () => Promise<void>;
}

export function createMainWindowController({
  holder,
  statePath,
  appIconPath,
  developmentProfile,
  developmentRemoteRole,
  developmentTestClientEnabled,
  isQuitting,
  getServices,
  forwardAgentEvent,
  onRendererLoadStarted,
  onMainWindowCreated,
  reportError,
}: MainWindowContext): MainWindowController {
  const { restoreMainWindowBounds, currentMainWindowBounds, rememberMainWindowBounds, flushMainWindowBounds } =
    createMainWindowBoundsRecorder({
      getMainWindow: () => holder.current,
      readBounds: () => readMainWindowBounds(statePath),
      writeBounds: (bounds) => writeMainWindowBounds(statePath, bounds),
      reportError,
    });

  function createWindow(): BrowserWindow {
    let inspectElementModifierPressed = false;
    const cursor = screen.getCursorScreenPoint();
    const bounds = resolveMainWindowBounds(
      currentMainWindowBounds(),
      screen.getAllDisplays().map((display) => display.workArea),
      screen.getDisplayNearestPoint(cursor).workArea,
      { width: 1200, height: 820 },
      { width: 960, height: 640 },
    );
    const window = new BrowserWindow({
      ...bounds,
      minWidth: 960,
      minHeight: 640,
      show: false,
      backgroundColor: "#0b0d0e",
      title: developmentProfile === "test-client" ? "OpenBot Local Client" : "OpenBot Local Host",
      icon: appIconPath,
      ...(process.platform === "darwin"
        ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 8, y: 14 } }
        : {}),
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        devTools: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });

    window.once("ready-to-show", () => {
      if (
        shouldShowDevelopmentWindow({
          remoteRole: developmentRemoteRole,
          testClientEnabled: developmentTestClientEnabled,
        })
      ) {
        window.show();
      }
    });
    window.on("close", (event) => {
      rememberMainWindowBounds(window.getNormalBounds());
      if (process.platform === "darwin" && !isQuitting()) {
        // The hidden renderer owns the cross-host Dynamic Island coordinator and must outlive its visible window.
        event.preventDefault();
        window.hide();
      }
    });
    onMainWindowCreated(window);
    window.on("closed", () => {
      if (holder.current === window) holder.current = null;
    });
    window.on("move", () => rememberMainWindowBounds(window.getNormalBounds()));
    window.on("resize", () => rememberMainWindowBounds(window.getNormalBounds()));
    window.on("hide", () => getServices()?.computerUseMacSetup.close());

    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("before-input-event", (event, input) => {
      if (input.key.toLowerCase() === "shift") {
        inspectElementModifierPressed = input.type === "keyDown";
      }
      if (isToggleDevToolsShortcut(input)) {
        event.preventDefault();
        window.webContents.toggleDevTools();
        return;
      }
      if (isSelectAllShortcut(input)) {
        event.preventDefault();
        void window.webContents.executeJavaScript(
          `(() => {
            const active = document.activeElement;
            if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
              active.select();
              return;
            }
            if (!(active instanceof HTMLElement) || !active.isContentEditable) return;
            const range = document.createRange();
            range.selectNodeContents(active);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
          })()`,
          true,
        );
        return;
      }
      const services = getServices();
      const tabId = services?.browser.activeTabId;
      if (
        !services ||
        !tabId ||
        services.remoteServers.activeServerId !== LOCAL_SERVER_ID ||
        !services.browser.visible ||
        !isCloseBrowserTabShortcut(input)
      ) {
        return;
      }
      event.preventDefault();
      setImmediate(() => void services.browser.close(tabId).catch(() => undefined));
    });
    window.webContents.on("context-menu", (event, params) => {
      if (!inspectElementModifierPressed) return;
      event.preventDefault();
      window.webContents.inspectElement(params.x, params.y);
    });
    window.on("blur", () => {
      inspectElementModifierPressed = false;
    });
    window.webContents.on("will-navigate", (event, targetUrl) => {
      if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
    });
    window.webContents.on("did-finish-load", () => {
      const services = getServices();
      if (services) {
        forwardAgentEvent("local", { type: "runtime-snapshot", snapshot: services.service.getRuntimeSnapshot() });
        services.remoteServers.refreshRuntimeSnapshots();
      }
    });

    return window;
  }

  function createComputerUseMacSetupWindow(): BrowserWindow {
    const anchor = holder.current;
    const workArea =
      anchor && !anchor.isDestroyed()
        ? screen.getDisplayMatching(anchor.getBounds()).workArea
        : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = 360;
    const height = 300;
    const window = new BrowserWindow({
      width,
      height,
      x: workArea.x + workArea.width - width - 16,
      y: workArea.y + 52,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: "#0b0d0e",
      title: "Set up Computer Use",
      icon: appIconPath,
      ...(process.platform === "darwin"
        ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 12, y: 13 } }
        : {}),
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        devTools: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    window.setAlwaysOnTop(true, "floating");
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, targetUrl) => {
      if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
    });
    return window;
  }

  function openMainWindow(): BrowserWindow {
    const window = createWindow();
    holder.current = window;
    return window;
  }

  function loadRenderer(window: BrowserWindow): Promise<void> {
    onRendererLoadStarted();
    const developmentUrl = process.env.ELECTRON_RENDERER_URL;
    return developmentUrl ? window.loadURL(developmentUrl) : window.loadURL("openbot-app://app/index.html");
  }

  async function ensureMainWindow(): Promise<BrowserWindow> {
    const existing = holder.current;
    if (existing && !existing.isDestroyed()) return existing;
    if (holder.load) return holder.load;
    const window = openMainWindow();
    holder.load = loadRenderer(window)
      .then(() => window)
      .catch((error) => {
        if (!window.isDestroyed()) window.destroy();
        if (holder.current === window) holder.current = null;
        throw error;
      })
      .finally(() => {
        holder.load = null;
      });
    return holder.load;
  }

  return {
    getMainWindow: () => holder.current,
    openMainWindow,
    ensureMainWindow,
    loadRenderer,
    createComputerUseMacSetupWindow,
    restoreMainWindowBounds,
    flushMainWindowBounds,
  };
}

export function createDynamicIslandWindow(bounds: Rectangle, _display: Display): BrowserWindow {
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    hiddenInMissionControl: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    enableLargerThanScreen: true,
    hasShadow: false,
    skipTaskbar: true,
    type: "panel",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      devTools: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
  });
  return window;
}

export function showMainWindow(window: BrowserWindow): void {
  presentMainWindow(window, process.platform, () => app.show());
}

export function loadDynamicIslandRenderer(window: BrowserWindow, display: Display): Promise<void> {
  const displayMode = display.internal ? "notch" : "island";
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const url = new URL(developmentUrl ?? "openbot-app://app/index.html");
  url.searchParams.set("surface", "dynamic-island");
  url.searchParams.set("display", displayMode);
  const notch = dynamicIslandNotchSizeForDisplay(display);
  if (notch) {
    url.searchParams.set("notch-width", String(notch.width));
    url.searchParams.set("notch-height", String(notch.height));
  }
  return window.loadURL(url.toString());
}

export function loadComputerUseMacSetupRenderer(window: BrowserWindow, permission: MacPermissionId): Promise<void> {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const url = new URL(developmentUrl ?? "openbot-app://app/index.html");
  url.searchParams.set("surface", "computer-use-setup");
  url.searchParams.set("permission", permission);
  return window.loadURL(url.toString());
}

export function configureApplicationMenu(service: AgentService, updater: UpdateService): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        role: "appMenu",
        submenu: [
          {
            label: "Stop all agents",
            accelerator: "CommandOrControl+.",
            click: () => void service.interruptAll(),
          },
          { type: "separator" },
          {
            label: "Check for Updates…",
            click: () => void updater.checkForUpdates(),
          },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}
