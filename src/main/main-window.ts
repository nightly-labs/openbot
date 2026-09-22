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
import {
  type AgentEvent,
  type ComputerUseHighlightPlacement,
  IPC_CHANNELS,
  LOCAL_SERVER_ID,
  type MacPermissionId,
} from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { app, BrowserWindow, clipboard, type Display, Menu, type Rectangle, screen } from "electron";
import type { AgentService } from "../backend/agent-service";
import type { BrowserHost } from "../backend/browser-host";
import {
  chatContextMenuItems,
  isCloseBrowserTabShortcut,
  isSelectAllShortcut,
  isToggleDevToolsShortcut,
} from "../backend/browser-shortcuts";
import type { HighlightDisplay } from "./computer-use-highlight-window";
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
import { sendToRenderer } from "./renderer-ipc";
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
      // The dots are drawn over the renderer, so this position is a layout value, not a chrome
      // detail. macOS spaces the three 13px dots 23px apart, so the group is 59px wide: x 12 leaves
      // it 11px clear of the 82px where the top row's first control starts, in the app frame and in
      // the full-bleed browser header alike, and y 13 puts its centre line within half a pixel of
      // both of those rows. The setup window below uses the same offsets.
      ...(process.platform === "darwin"
        ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 12, y: 13 } }
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
      if (inspectElementModifierPressed) {
        event.preventDefault();
        window.webContents.inspectElement(params.x, params.y);
        return;
      }
      // The chat has no custom menu, so selected text would have no way to reach the clipboard.
      // The native edit menu covers copy, select-all and link copying; anything else keeps no menu.
      const items = chatContextMenuItems({
        selectionText: params.selectionText,
        isEditable: params.isEditable,
        linkURL: params.linkURL,
      });
      if (items.length === 0) return;
      event.preventDefault();
      Menu.buildFromTemplate(
        items.map((item) => {
          if (item === "separator") return { type: "separator" } as const;
          if (item === "copy-link")
            return {
              label: "Copy Link",
              click: () => clipboard.writeText(params.linkURL),
            };
          if (item === "copy") return { role: "copy" } as const;
          return { role: "selectAll" } as const;
        }),
      ).popup({ window });
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

/**
 * The overlay that carries the Computer Use rim over the window an agent works in.
 *
 * It covers the whole desktop and then stays still: the rim moves inside it, so a window the user
 * drags is followed by a repaint rather than by a window move on every frame.
 *
 * It is a panel that is never focusable and never in Mission Control, so it does not enter the
 * user's window order. It floats over the desktop, because macOS gives no way to hold one
 * application's window between two of another's, and a rim the user cannot see says nothing about
 * where the agent works. It is created hidden and click-through.
 */
export function createComputerUseHighlightWindow(bounds: Rectangle): BrowserWindow {
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    transparent: true,
    frame: false,
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
    acceptFirstMouse: false,
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
  // A floating level, which is the only thing that holds this window in front on macOS: both
  // `moveAbove` and `moveTop` return without an error and leave a transparent panel where it was.
  // The level stays below the menu bar, and the rim is a thin edge around one window, so being in
  // front costs the user almost none of what is behind it.
  window.setAlwaysOnTop(true, "floating");
  // The agent works wherever the user left the window, which can be another Space or another
  // application's full screen. One overlay on every Space is what lets the rim follow it there
  // without a second window and without pulling the user out of the Space they are on.
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Nothing on this surface may be pressed, and it covers another application's whole window, so
  // every event is handed straight on to the window below it.
  window.setIgnoreMouseEvents(true, { forward: true });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
  });
  return window;
}

/**
 * The small window that stands beside the System Settings pane a permission is granted in.
 *
 * System Settings opens in front of everything and covers OpenBot, so the panel that asked for the
 * grant is no longer on screen at the moment the user has to act. This window carries the steps
 * there: it floats, it is small enough to leave the pane readable, and it reports the grant landing
 * so the user knows they are done without going back to look.
 *
 * It holds no secret and asks for nothing. Every hardening the other surfaces carry is kept:
 * sandboxed, context-isolated, no window may be opened from it, and no navigation away from the
 * renderer's own origin.
 */
export function createComputerUsePermissionHelpWindow(): BrowserWindow {
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = 340;
  // The card the user drags out of it, the two steps, and nothing else: a window taller than its
  // own contents would put empty space over the pane it stands beside.
  const height = 322;
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
    title: "Turn on Computer Use",
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
  // Over System Settings, which opens in front of everything: a window the pane covers would carry
  // the steps to nobody.
  window.setAlwaysOnTop(true, "floating");
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
  });
  return window;
}

export function loadComputerUsePermissionHelpRenderer(
  window: BrowserWindow,
  permission: MacPermissionId,
  sunshine = false,
): Promise<void> {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const url = new URL(developmentUrl ?? "openbot-app://app/index.html");
  url.searchParams.set("surface", "computer-use-permission-help");
  url.searchParams.set("permission", permission);
  if (sunshine) url.searchParams.set("application", "sunshine");
  return window.loadURL(url.toString());
}

export function loadComputerUseHighlightRenderer(window: BrowserWindow): Promise<void> {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const url = new URL(developmentUrl ?? "openbot-app://app/index.html");
  url.searchParams.set("surface", "computer-use-highlight");
  return window.loadURL(url.toString());
}

/**
 * Every display the Computer Use overlay is built over, one overlay for each.
 *
 * Not one window over all of them: macOS gives every display its own Space, so a window the size of
 * the desktop is drawn on one display and clipped away on all the others. An agent working on the
 * second display would then be marked by a rim nobody can see.
 */
export function computerUseDisplays(): HighlightDisplay[] {
  return screen.getAllDisplays().map((display) => ({ id: display.id, bounds: display.bounds }));
}

/** Where the overlay draws the rim. Sent on every placement, and read by that surface only. */
export function sendComputerUseHighlightPlacement(
  window: BrowserWindow,
  placement: ComputerUseHighlightPlacement,
): void {
  sendToRenderer(window, IPC_CHANNELS.computerUseHighlightPlacement, placement);
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

/**
 * The native application menu.
 *
 * Electron gives no way to relabel a built-in role, so the roles below stay in the system language
 * macOS and Windows draw them in, and only the custom items follow the app language. The caller
 * builds the menu again on a language change, because a `MenuItem` label cannot be changed in place.
 *
 * The custom `appMenu` replaces the default one, so the standard Preferences item with `Cmd + ,`
 * must be declared here: without it macOS has no Settings shortcut.
 */
export function configureApplicationMenu(service: AgentService, updater: UpdateService, translate: AppTranslate): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        role: "appMenu",
        submenu: [
          {
            label: translate("menu.stopAllAgents"),
            accelerator: "CommandOrControl+.",
            click: () => void service.interruptAll(),
          },
          { type: "separator" },
          {
            label: translate("menu.checkForUpdates"),
            click: () => void updater.checkForUpdates(),
          },
          { type: "separator" },
          {
            label: translate("menu.preferences"),
            accelerator: "CommandOrControl+,",
            click: (_item, focusedWindow) => {
              const candidate = focusedWindow ?? BrowserWindow.getFocusedWindow();
              if (!(candidate instanceof BrowserWindow)) return;
              sendToRenderer(candidate, IPC_CHANNELS.openSettings);
            },
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
