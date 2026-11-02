import { Effect } from "effect";
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
  type AppVariant,
  type ChatWindowTarget,
  type ComputerUseHighlightPlacement,
  IPC_ENDPOINTS,
  LOCAL_SERVER_ID,
  type MacPermissionId,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  app,
  BrowserWindow,
  clipboard,
  type Display,
  Menu,
  type Point,
  type Rectangle,
  screen,
  session,
  type WebContents,
  webContents,
} from "electron";
import type { AgentService } from "../backend/agent-service";
import type { BrowserHost } from "../backend/browser-host";
import {
  type ChatEditAction,
  chatContextMenuItems,
  isCloseBrowserTabShortcut,
  isSelectAllShortcut,
  isToggleDevToolsShortcut,
} from "../backend/browser-shortcuts";
import type { HighlightDisplay } from "./computer-use-highlight-window";
import { shouldShowDevelopmentWindow } from "./development-profile";
import { dynamicIslandNotchSizeForDisplay } from "./dynamic-island-window";
import { type InterfaceSizeService, type InterfaceSizeStep, interfaceSizeShortcut } from "./interface-size-service";
import {
  createMainWindowBoundsRecorder,
  presentMainWindow,
  readMainWindowBounds,
  resolveMainWindowBounds,
  writeMainWindowBounds,
} from "./main-window-state";
import type { RemoteServerManager } from "./remote-server-manager";
import type { RemoteWorkflowError } from "./remote-service-effects";
import { sendToRenderer } from "./renderer-ipc";
import { isTrustedRendererUrl } from "./trusted-renderer";
import type { UpdateService } from "./update-service";
import { followAppearance, followWindowGlass, windowBackgroundColor } from "./window-appearance";

/** The dark background of the main and setup windows, under the page's own canvas. */
const MAIN_WINDOW_DARK_BACKGROUND = "#0b0d0e";

/**
 * What the window surface reads off the running application. Deliberately narrower than
 * `ApplicationServices`: keeping it structural is what lets the composition root import this
 * module without this module importing it back.
 */
interface MainWindowApplicationServices {
  browser: BrowserHost;
  remoteServers: RemoteServerManager;
  interfaceSize: InterfaceSizeService;
}

/**
 * The chat menu's edit entries. They are not Electron roles: a role's label does not follow the
 * app's own language setting, and a role acts on whichever window has focus. Each entry runs on its
 * own window's contents instead, and its accelerator is only the shortcut hint shown beside the label.
 */
const CHAT_EDIT_ACTIONS = {
  undo: { label: "menu.undo", accelerator: "CommandOrControl+Z", run: (contents) => contents.undo() },
  redo: {
    label: "menu.redo",
    accelerator: process.platform === "win32" ? "Control+Y" : "Shift+CommandOrControl+Z",
    run: (contents) => contents.redo(),
  },
  cut: { label: "menu.cut", accelerator: "CommandOrControl+X", run: (contents) => contents.cut() },
  copy: { label: "menu.copy", accelerator: "CommandOrControl+C", run: (contents) => contents.copy() },
  paste: { label: "menu.paste", accelerator: "CommandOrControl+V", run: (contents) => contents.paste() },
  pasteAndMatchStyle: {
    label: "menu.pasteAndMatchStyle",
    accelerator: "Command+Option+Shift+V",
    run: (contents) => contents.pasteAndMatchStyle(),
  },
  delete: { label: "menu.delete", accelerator: undefined, run: (contents) => contents.delete() },
  selectAll: { label: "menu.selectAll", accelerator: "CommandOrControl+A", run: (contents) => contents.selectAll() },
} as const satisfies Record<
  ChatEditAction,
  { label: AppTextKey; accelerator: string | undefined; run: (contents: WebContents) => void }
>;

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
  /** A function, not a value: the user can change the choice while the window is open. */
  keepRunningInBackground: () => boolean;
  /** A function, not a value: nothing exists yet when the first window is created. */
  getServices: () => MainWindowApplicationServices | null;
  /** A function, not a value: the saved language is read after the first window opens. */
  getTranslate: () => AppTranslate;
  /** A renderer load or committed document navigation resets delivery of queued links. */
  onRendererLoadStarted: () => void;
  /** Main must release resources when a renderer can no longer run its own cleanup. */
  onRendererGone: () => void;
  /** Where the entry point attaches the Windows session-end handlers, which read its own flags. */
  onMainWindowCreated: (window: BrowserWindow) => void;
  reportError: (message: string, error: unknown) => void;
}

export interface MainWindowController {
  getMainWindow: () => BrowserWindow | null;
  /** The windows that each show one chat. They get the same live events as the main window. */
  getChatWindows: () => BrowserWindow[];
  /** The chats that have a window, for the marks in the main window's sidebar. */
  chatWindowTargets: () => ChatWindowTarget[];
  openChatWindow: (target: ChatWindowTarget) => void;
  openMainWindow: () => BrowserWindow;
  ensureMainWindow: () => Promise<BrowserWindow>;
  loadRenderer: (window: BrowserWindow) => Promise<void>;
  restoreMainWindowBounds: () => Effect.Effect<void>;
  flushMainWindowBounds: () => Effect.Effect<void, RemoteWorkflowError>;
}

export function createMainWindowController({
  holder,
  statePath,
  appIconPath,
  developmentProfile,
  developmentRemoteRole,
  developmentTestClientEnabled,
  isQuitting,
  keepRunningInBackground,
  getServices,
  getTranslate,
  onRendererLoadStarted,
  onRendererGone,
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
      backgroundColor: windowBackgroundColor(MAIN_WINDOW_DARK_BACKGROUND),
      title:
        developmentProfile === "test-client"
          ? getTranslate()("window.localClientTitle")
          : getTranslate()("window.localHostTitle"),
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
    hideMenuBar(window);
    followWindowGlass(window, MAIN_WINDOW_DARK_BACKGROUND);

    window.once("ready-to-show", () => {
      performance.mark("openbot:window-ready");
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
      // Nobody can use a tab without the window, so the agents waiting on it continue.
      getServices()?.browser.releaseUserControlHeldBy({ kind: "local" });
      // The hidden renderer owns the cross-host Dynamic Island coordinator and must outlive its visible
      // window. On Windows and Linux the user chooses it, and the tray icon is the way back.
      if ((process.platform === "darwin" || keepRunningInBackground()) && !isQuitting()) {
        event.preventDefault();
        window.hide();
      }
    });
    onMainWindowCreated(window);
    window.on("closed", () => {
      if (holder.current === window) holder.current = null;
      // A chat window is a second view of a chat in the main window, so it does not outlive it.
      for (const chat of chatWindows.values()) chat.window.close();
    });
    window.on("move", () => rememberMainWindowBounds(window.getNormalBounds()));
    window.on("resize", () => rememberMainWindowBounds(window.getNormalBounds()));

    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    // A started navigation can still be cancelled without replacing the live renderer.
    window.webContents.on("did-navigate", onRendererLoadStarted);
    // Chromium keeps a zoom level for each origin, and the first load sets the origin, so the saved
    // size is applied on each navigation rather than once when the window is made.
    window.webContents.on("did-navigate", () => {
      const interfaceSize = getServices()?.interfaceSize;
      if (interfaceSize) window.webContents.setZoomFactor(interfaceSize.zoomFactor);
    });
    window.webContents.on("render-process-gone", onRendererGone);
    window.webContents.once("destroyed", onRendererGone);
    attachAppInput(window, getServices, getTranslate, { closesBrowserTabs: true });
    window.webContents.on("will-navigate", (event, targetUrl) => {
      if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
    });
    window.webContents.on("did-finish-load", () => {
      const services = getServices();
      if (services) {
        Effect.runFork(services.remoteServers.refreshRuntimeSnapshots());
      }
    });

    return window;
  }

  /** Keyed by `chatWindowKey`. A chat has one window at most. */
  const chatWindows = new Map<string, { target: ChatWindowTarget; window: BrowserWindow }>();

  function chatWindowTargets(): ChatWindowTarget[] {
    return [...chatWindows.values()].map(({ target }) => target);
  }

  function announceChatWindows(): void {
    const targets = chatWindowTargets();
    sendToRenderer(holder.current, IPC_ENDPOINTS.app.chatWindows, targets);
    getServices()?.remoteServers.setChatWindowServers(new Set(targets.map((target) => target.serverId)));
  }

  function openChatWindow(target: ChatWindowTarget): void {
    const key = chatWindowKey(target);
    const existing = chatWindows.get(key)?.window;
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }
    const window = new BrowserWindow({
      width: 560,
      height: 760,
      minWidth: 380,
      minHeight: 480,
      show: false,
      backgroundColor: windowBackgroundColor(MAIN_WINDOW_DARK_BACKGROUND),
      // The page sets the chat name as its title when it loads.
      title: getTranslate()("window.localHostTitle"),
      icon: appIconPath,
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
    hideMenuBar(window);
    followWindowGlass(window, MAIN_WINDOW_DARK_BACKGROUND);
    chatWindows.set(key, { target: { serverId: target.serverId, agentId: target.agentId }, window });
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
      if (chatWindows.get(key)?.window === window) chatWindows.delete(key);
      announceChatWindows();
    });
    // Focus cannot bring back a crashed page. The main window still shows the chat.
    window.webContents.on("render-process-gone", () => {
      if (!window.isDestroyed()) window.destroy();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, targetUrl) => {
      if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
    });
    window.webContents.on("did-navigate", () => {
      const interfaceSize = getServices()?.interfaceSize;
      if (interfaceSize) window.webContents.setZoomFactor(interfaceSize.zoomFactor);
    });
    attachAppInput(window, getServices, getTranslate, { closesBrowserTabs: false });
    announceChatWindows();
    const url = appRendererUrl(process.env.ELECTRON_RENDERER_URL);
    url.searchParams.set("window", "chat");
    url.searchParams.set("server", target.serverId);
    url.searchParams.set("agent", target.agentId);
    window.loadURL(url.toString()).catch((error: unknown) => {
      reportError("Could not load the chat window", error);
      if (!window.isDestroyed()) window.destroy();
    });
  }

  function openMainWindow(): BrowserWindow {
    const window = createWindow();
    holder.current = window;
    return window;
  }

  function loadRenderer(window: BrowserWindow): Promise<void> {
    onRendererLoadStarted();
    return window.loadURL(appRendererUrl(process.env.ELECTRON_RENDERER_URL).toString());
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
    getChatWindows: () =>
      [...chatWindows.values()].map((chat) => chat.window).filter((window) => !window.isDestroyed()),
    chatWindowTargets,
    openChatWindow,
    openMainWindow,
    ensureMainWindow,
    loadRenderer,
    restoreMainWindowBounds,
    flushMainWindowBounds,
  };
}

/**
 * The keys and the right-click menu of a window that loads the app. Only the main window has the
 * browser, so only it closes a browser tab on the close shortcut.
 */
function attachAppInput(
  window: BrowserWindow,
  getServices: () => MainWindowApplicationServices | null,
  getTranslate: () => AppTranslate,
  { closesBrowserTabs }: { closesBrowserTabs: boolean },
): void {
  let inspectElementModifierPressed = false;
  window.webContents.on("before-input-event", (event, input) => {
    if (input.key.toLowerCase() === "shift") {
      inspectElementModifierPressed = input.type === "keyDown";
    }
    if (isToggleDevToolsShortcut(input)) {
      event.preventDefault();
      window.webContents.toggleDevTools();
      return;
    }
    // A focused frame, such as the remote desktop viewer, gets the select-all key and the size keys
    // that the View menu also has. The viewer sends them to the remote computer and stops the menu
    // items with the same keys (#3921). No menu item has Shift+= or "+", so these stay here.
    const frameFocused = Boolean(window.webContents.focusedFrame?.parent);
    const sizeStep = interfaceSizeShortcut(input, process.platform === "darwin");
    const interfaceSize = getServices()?.interfaceSize;
    const sizeKeyInMenu = !input.shift && input.key !== "+";
    if (!(frameFocused && sizeKeyInMenu) && sizeStep && interfaceSize) {
      // This also stops the View menu item with the same key, which would step the size again.
      event.preventDefault();
      Effect.runFork(interfaceSize.step(sizeStep));
      return;
    }
    if (!frameFocused && isSelectAllShortcut(input)) {
      event.preventDefault();
      void window.webContents.executeJavaScript(
        `(() => {
          const active = document.activeElement;
          if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
            active.select();
            return;
          }
          // A focused canvas is a remote browser page, which selects its own text when it gets the key.
          // Only the key down is held here; the real key up still reaches it.
          if (active instanceof HTMLCanvasElement) {
            const key = { key: "a", code: "KeyA", ctrlKey: ${input.control}, metaKey: ${input.meta}, bubbles: true };
            active.dispatchEvent(new KeyboardEvent("keydown", key));
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
      !closesBrowserTabs ||
      !services ||
      !tabId ||
      services.remoteServers.activeServerId !== LOCAL_SERVER_ID ||
      !services.browser.visible ||
      !isCloseBrowserTabShortcut(input)
    ) {
      return;
    }
    event.preventDefault();
    setImmediate(() => void Effect.runPromise(services.browser.close(tabId)).catch(() => undefined));
  });
  window.webContents.on("context-menu", (event, params) => {
    if (inspectElementModifierPressed) {
      event.preventDefault();
      window.webContents.inspectElement(params.x, params.y);
      return;
    }
    // A chat message opens its own menu, but leaves selected text and links to this one
    // (`keepNativeMenu` in `ChatMessageRow`). The native edit menu covers editing, spelling and
    // link copying; anything else keeps no menu.
    const items = chatContextMenuItems({
      selectionText: params.selectionText,
      isEditable: params.isEditable,
      linkURL: params.linkURL,
      misspelledWord: params.misspelledWord,
      dictionarySuggestions: params.dictionarySuggestions,
      editFlags: params.editFlags,
      pasteAndMatchStyle: process.platform === "darwin",
    });
    if (items.length === 0) return;
    event.preventDefault();
    const t = getTranslate();
    Menu.buildFromTemplate(
      items.map((item) => {
        if (item.kind === "separator") return { type: "separator" } as const;
        if (item.kind === "copy-link")
          return {
            label: t("menu.copyLink"),
            click: () => clipboard.writeText(params.linkURL),
          };
        if (item.kind === "spelling")
          return {
            label: item.suggestion,
            click: () => {
              if (!window.isDestroyed()) window.webContents.replaceMisspelling(item.suggestion);
            },
          };
        const action = CHAT_EDIT_ACTIONS[item.action];
        return {
          label: t(action.label),
          ...(action.accelerator ? { accelerator: action.accelerator, registerAccelerator: false } : {}),
          enabled: item.enabled,
          click: () => {
            if (!window.isDestroyed()) action.run(window.webContents);
          },
        };
      }),
    ).popup({ window });
  });
  window.on("blur", () => {
    inspectElementModifierPressed = false;
  });
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
  // Chromium shares zoom per origin. The main window zoom would shrink this fixed-size window's
  // viewport and move the shared avatar out of the expanded panel.
  window.webContents.setZoomMode("isolated");
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
  // without a second window and without pulling the user out of the Space they are on. The
  // overlays are built again after each idle period, and without `skipTransformProcessType` each
  // build would hide the Dock icon and every OpenBot window for a moment.
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  // Nothing on this surface may be pressed, and it covers another application's whole window, so
  // every event is handed straight on to the window below it.
  window.setIgnoreMouseEvents(true, { forward: true });
  // The rim uses window bounds in DIP as CSS pixels, so it must not follow the main window zoom.
  window.webContents.setZoomMode("isolated");
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
export function createComputerUsePermissionHelpWindow(translate: AppTranslate): BrowserWindow {
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
    backgroundColor: windowBackgroundColor(MAIN_WINDOW_DARK_BACKGROUND),
    title: translate("window.computerUsePermissionTitle"),
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
  followAppearance(window, MAIN_WINDOW_DARK_BACKGROUND);
  // The fixed height fits the contents only at 100%; the main window zoom would clip the steps.
  window.webContents.setZoomMode("isolated");
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
  });
  return window;
}

/** The entry that loads `App`: the main window, and a chat window with its query. */
function appRendererUrl(developmentUrl: string | undefined): URL {
  return developmentUrl ? new URL(developmentUrl) : new URL("openbot-app://app/index.html");
}

function chatWindowKey(target: ChatWindowTarget): string {
  return JSON.stringify([target.serverId, target.agentId]);
}

/** The entry for the helper windows. It does not load `App`, so each window uses less memory. */
function helperRendererUrl(developmentUrl: string | undefined): URL {
  return developmentUrl ? new URL("helper.html", `${developmentUrl}/`) : new URL("openbot-app://app/helper.html");
}

export function loadComputerUsePermissionHelpRenderer(
  window: BrowserWindow,
  permission: MacPermissionId,
  sunshine = false,
): Promise<void> {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const url = helperRendererUrl(developmentUrl);
  url.searchParams.set("surface", "computer-use-permission-help");
  url.searchParams.set("permission", permission);
  if (sunshine) url.searchParams.set("application", "sunshine");
  return window.loadURL(url.toString());
}

/** The dock over the page of the browser full view. It is a view in the main window, not a window. */
export function loadBrowserDockRenderer(contents: WebContents): Promise<void> {
  const url = helperRendererUrl(process.env.ELECTRON_RENDERER_URL);
  url.searchParams.set("surface", "browser-dock");
  return contents.loadURL(url.toString());
}

export function loadComputerUseHighlightRenderer(window: BrowserWindow): Promise<void> {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const url = helperRendererUrl(developmentUrl);
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

/**
 * One rectangle the driver reports, in the units the displays above are measured in.
 *
 * On Windows the driver is Per-Monitor V2 DPI aware and reports physical pixels, while Electron
 * places every window in DIP. At 125% scaling a maximized window would otherwise be drawn a
 * quarter larger than the display, with its right and bottom edges past the overlay. macOS reports
 * points, which are what Electron uses there. Electron has `screenToDipRect` on Windows only.
 */
export function computerUseDesktopRect(rect: Rectangle): Rectangle {
  return process.platform === "win32" ? screen.screenToDipRect(null, rect) : rect;
}

/**
 * The driver ids of OpenBot's windows that cover the rim, such as the conversation.
 *
 * The overlays - the rim's own and the dynamic island - can never take focus, and every window the
 * user reads can. The id in a media source id is the one the driver lists a window by: the
 * `CGWindowID` on macOS and the `HWND` on Windows.
 */
export function computerUseCoveringWindowIds(): Set<number> {
  const ids = new Set<number>();
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || !window.isVisible() || window.isMinimized() || !window.isFocusable()) continue;
    const id = Number(window.getMediaSourceId().split(":")[1]);
    if (Number.isSafeInteger(id)) ids.add(id);
  }
  return ids;
}

/** One point the driver was asked for, in the same units as `computerUseDesktopRect`. */
export function computerUseDesktopPoint(point: Point): Point {
  return process.platform === "win32" ? screen.screenToDipPoint(point) : point;
}

/** Where the overlay draws the rim. Sent on every placement, and read by that surface only. */
export function sendComputerUseHighlightPlacement(
  window: BrowserWindow,
  placement: ComputerUseHighlightPlacement,
): void {
  sendToRenderer(window, IPC_ENDPOINTS.computerUse.highlightPlacement, placement);
}

/** Set by `hideWindowsForQuit` and never cleared: the process ends after it. */
let windowsHiddenForQuit = false;

/**
 * The renderer keeps reading while the services stop, and a read that the closing services fail
 * must not show its error to the user (#3166). The Dock, the tray, a deep link or a notification
 * then does not show the window again.
 */
export function hideWindowsForQuit(): void {
  windowsHiddenForQuit = true;
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.hide();
}

export function showMainWindow(window: BrowserWindow): void {
  if (windowsHiddenForQuit) return;
  presentMainWindow(window, process.platform, () => app.show());
}

export function loadDynamicIslandRenderer(window: BrowserWindow, display: Display, variant: AppVariant): Promise<void> {
  const displayMode = display.internal ? "notch" : "island";
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const url = helperRendererUrl(developmentUrl);
  url.searchParams.set("surface", "dynamic-island");
  url.searchParams.set("display", displayMode);
  url.searchParams.set("variant", variant);
  const notch = dynamicIslandNotchSizeForDisplay(display);
  if (notch) {
    url.searchParams.set("notch-width", String(notch.width));
    url.searchParams.set("notch-height", String(notch.height));
  }
  return window.loadURL(url.toString());
}

/**
 * A browser tab has its own session and keeps the page zoom that the default zoom roles gave it.
 * Any other focused contents is the app, so the step changes the saved interface size.
 */
function zoomFocusedContents(interfaceSize: InterfaceSizeService, step: InterfaceSizeStep): void {
  const focused = webContents.getFocusedWebContents();
  if (!focused || focused.session === session.defaultSession) {
    Effect.runFork(interfaceSize.step(step));
    return;
  }
  focused.setZoomLevel(step === "default" ? 0 : focused.getZoomLevel() + (step === "larger" ? 0.5 : -0.5));
}

/**
 * Windows and Linux draw the application menu as a bar under the title bar. The menu stays set, so
 * its shortcuts work, but the bar is never shown. With `autoHideMenuBar`, a single Alt release
 * showed the bar above the page and gave it focus, so the composer moved and lost its caret. A
 * keyboard layout switch with Alt+Shift did the same. Electron attaches the menu in the window
 * constructor, so the bar exists here, and a later `Menu.setApplicationMenu` does not show it again.
 */
function hideMenuBar(window: BrowserWindow): void {
  if (process.platform !== "darwin") window.setMenuBarVisibility(false);
}

/**
 * The native application menu.
 *
 * Electron gives no way to relabel a built-in role, so the roles below stay in the system language
 * macOS and Windows draw them in, and only the custom items follow the app language. The caller
 * builds the menu again on a language change, because a `MenuItem` label cannot be changed in place.
 *
 * The custom `appMenu` replaces the default one, so the standard Preferences item with `Cmd + ,`
 * must be declared here: without it macOS has no Settings shortcut. The View menu is the default
 * `viewMenu`, but its zoom items change the saved interface size, so Settings and the next start
 * keep the size the user chose. A website in the browser keeps the zoom of the default roles.
 */
export function configureApplicationMenu(
  service: AgentService,
  updater: UpdateService,
  interfaceSize: InterfaceSizeService,
  translate: AppTranslate,
  getMainWindow: () => BrowserWindow | null,
): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        role: "appMenu",
        submenu: [
          {
            label: translate("menu.stopAllAgents"),
            accelerator: "CommandOrControl+.",
            click: () => {
              Effect.runFork(service.interruptAll());
            },
          },
          { type: "separator" },
          {
            label: translate("menu.checkForUpdates"),
            click: (_item, focusedWindow) => {
              // On macOS a closed main window only hides and the menu stays, so show it again: the
              // check and its result are visible only in Settings.
              const focused = focusedWindow ?? BrowserWindow.getFocusedWindow();
              const target = focused instanceof BrowserWindow ? focused : getMainWindow();
              if (target && !target.isDestroyed()) {
                if (target !== focused) showMainWindow(target);
                sendToRenderer(target, IPC_ENDPOINTS.app.openUpdateSettings);
              }
              Effect.runFork(updater.checkForUpdates());
            },
          },
          { type: "separator" },
          {
            label: translate("menu.preferences"),
            accelerator: "CommandOrControl+,",
            click: (_item, focusedWindow) => {
              const candidate = focusedWindow ?? BrowserWindow.getFocusedWindow();
              if (!(candidate instanceof BrowserWindow)) return;
              sendToRenderer(candidate, IPC_ENDPOINTS.app.openSettings);
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
      {
        // The role keeps the system "View" title. The submenu replaces its default items.
        role: "viewMenu",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          {
            label: translate("menu.actualSize"),
            accelerator: "CommandOrControl+0",
            click: () => zoomFocusedContents(interfaceSize, "default"),
          },
          {
            label: translate("menu.zoomIn"),
            accelerator: "CommandOrControl+=",
            click: () => zoomFocusedContents(interfaceSize, "larger"),
          },
          {
            label: translate("menu.zoomOut"),
            accelerator: "CommandOrControl+-",
            click: () => zoomFocusedContents(interfaceSize, "smaller"),
          },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      // Windows and Linux: the default Close item takes Ctrl+W. With "Keep OpenBot running in the
      // background" off, closing the main window quits OpenBot, so a Ctrl+W that no browser tab took
      // ended the app with no question (#2675). The item keeps the key the system closes with.
      process.platform === "darwin"
        ? { role: "windowMenu" }
        : { role: "windowMenu", submenu: [{ role: "minimize" }, { role: "close", accelerator: "Alt+F4" }] },
    ]),
  );
}
