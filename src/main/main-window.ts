import { join } from "node:path";
import {
  type AgentSummary,
  type AppVariant,
  type CentralAuthState,
  type ChatWindowTarget,
  type ComputerUseHighlightPlacement,
  type HostStatus,
  IPC_ENDPOINTS,
  LOCAL_SERVER_ID,
  type MacPermissionId,
  type QuitGuard,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate, LayoutDirection } from "@openbot/i18n";
import { Effect } from "effect";
import {
  app,
  BrowserWindow,
  clipboard,
  type Display,
  dialog,
  type Event as ElectronEvent,
  type Input,
  Menu,
  type MenuItemConstructorOptions,
  type Point,
  type Rectangle,
  type RenderProcessGoneDetails,
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
import { allowPinchZoom } from "../backend/pinch-zoom";
import type { HighlightDisplay } from "./computer-use-highlight-window";
import { shouldShowDevelopmentWindow } from "./development-profile";
import { dynamicIslandNotchSizeForDisplay } from "./dynamic-island-window";
import { type InterfaceSizeService, type InterfaceSizeStep, interfaceSizeShortcut } from "./interface-size-service";
import { withLocalHostSummary } from "./ipc/team-handlers";
import { usesX11Windows } from "./linux-wayland-output";
import { hidePanelFromWindowSwitchers, keepPanelThroughAppHide, preventPanelActivation } from "./mac-panel-activation";
import {
  createMainWindowBoundsRecorder,
  presentMainWindow,
  readMainWindowBounds,
  resolveMainWindowBounds,
  writeMainWindowBounds,
} from "./main-window-state";
import { createQuitShortcut, isQuitGuarded, type QuitShortcut } from "./quit-shortcut";
import type { RemoteServerManager } from "./remote-server-manager";
import type { RemoteWorkflowError } from "./remote-service-effects";
import { sendToRenderer } from "./renderer-ipc";
import { isTrustedRendererUrl } from "./trusted-renderer";
import type { UpdateService } from "./update-service";
import { followAppearance, followWindowGlass, glassWindowOptions, windowBackgroundColor } from "./window-appearance";
import { followWindowButtonSide, WINDOW_BUTTON_INSET } from "./window-buttons";

const MAIN_WINDOW_DARK_BACKGROUND = "#0b0d0e";

const RENDERER_RELOAD_MAX = 3;
const RENDERER_RELOAD_WINDOW_MS = 60_000;
const RELOADABLE_RENDERER_EXITS: ReadonlySet<RenderProcessGoneDetails["reason"]> = new Set([
  "crashed",
  "oom",
  "killed",
  "abnormal-exit",
]);

interface MainWindowApplicationServices {
  browser: BrowserHost;
  centralAuth: { getState(): CentralAuthState };
  host: { getStatus(): HostStatus };
  remoteServers: RemoteServerManager;
  interfaceSize: InterfaceSizeService;
}

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
  isQuitting: () => boolean;
  keepRunningInBackground: () => boolean;
  getServices: () => MainWindowApplicationServices | null;
  getTranslate: () => AppTranslate;
  getLayoutDirection: () => LayoutDirection;
  onRendererLoadStarted: () => void;
  onRendererGone: () => void;
  onMainWindowCreated: (window: BrowserWindow) => void;
  reportError: (message: string, error: unknown) => void;
  quitFromShortcut: () => void;
  workingAgents: () => AgentSummary[];
  quitGuard: () => QuitGuard;
  onHiddenWhileWorking: (hidden: boolean) => void;
}

export interface MainWindowController {
  getMainWindow: () => BrowserWindow | null;
  getChatWindows: () => BrowserWindow[];
  chatWindowTargets: () => ChatWindowTarget[];
  openChatWindow: (target: ChatWindowTarget) => void;
  openMainWindow: () => BrowserWindow;
  ensureMainWindow: () => Promise<BrowserWindow>;
  loadRenderer: (window: BrowserWindow) => Promise<void>;
  restoreMainWindowBounds: () => Effect.Effect<void>;
  flushMainWindowBounds: () => Effect.Effect<void, RemoteWorkflowError>;
  handleQuitShortcut: (window: BrowserWindow, input: Input) => boolean;
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
  getLayoutDirection,
  onRendererLoadStarted,
  onRendererGone,
  onMainWindowCreated,
  reportError,
  quitFromShortcut,
  workingAgents,
  quitGuard,
  onHiddenWhileWorking,
}: MainWindowContext): MainWindowController {
  const quitShortcut =
    process.platform === "darwin"
      ? createQuitShortcut({
          quit: quitFromShortcut,
          isQuitting,
          workingAgents,
          guard: quitGuard,
          showHint: (window, agents) => sendToRenderer(window, IPC_ENDPOINTS.app.quitShortcutHint, agents),
        })
      : null;
  const { restoreMainWindowBounds, currentMainWindowBounds, rememberMainWindowBounds, flushMainWindowBounds } =
    createMainWindowBoundsRecorder({
      getMainWindow: () => holder.current,
      readBounds: () => readMainWindowBounds(statePath),
      writeBounds: (bounds) => writeMainWindowBounds(statePath, bounds),
      reportError,
    });
  let rendererReloadTimes: number[] = [];
  let closeConfirmationOpen = false;
  let closeConfirmed = false;

  function confirmCloseWhileWorking(window: BrowserWindow): void {
    const translate = getTranslate();
    closeConfirmationOpen = true;
    void dialog
      .showMessageBox(window, {
        type: "question",
        message: translate("menu.closeWorkingTitle", { count: workingAgents().length }),
        detail: translate("menu.closeWorkingBody"),
        buttons: [translate("menu.closeKeepRunning"), translate("menu.quitConfirm"), translate("common.cancel")],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      .then(({ response }) => {
        if (window.isDestroyed()) return;
        if (response === 0) {
          rememberMainWindowBounds(window.getNormalBounds());
          getServices()?.browser.releaseUserControlHeldBy({ kind: "local" });
          onHiddenWhileWorking(true);
          window.hide();
        } else if (response === 1) {
          closeConfirmed = true;
          window.close();
        }
      })
      .catch((error: unknown) => reportError("Unable to ask before the main window closes:", error))
      .finally(() => {
        closeConfirmationOpen = false;
      });
  }

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
      ...glassWindowOptions(MAIN_WINDOW_DARK_BACKGROUND),
      title:
        developmentProfile === "test-client"
          ? getTranslate()("window.localClientTitle")
          : getTranslate()("window.localHostTitle"),
      icon: appIconPath,
      ...(process.platform === "darwin"
        ? { titleBarStyle: "hidden" as const, trafficLightPosition: WINDOW_BUTTON_INSET }
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
        !windowsKeptHidden &&
        shouldShowDevelopmentWindow({
          remoteRole: developmentRemoteRole,
          testClientEnabled: developmentTestClientEnabled,
        })
      ) {
        window.show();
      }
    });
    window.on("close", (event) => {
      if (
        process.platform !== "darwin" &&
        !keepRunningInBackground() &&
        !isQuitting() &&
        !closeConfirmed &&
        workingAgents().length > 0
      ) {
        event.preventDefault();
        if (!closeConfirmationOpen) confirmCloseWhileWorking(window);
        return;
      }
      rememberMainWindowBounds(window.getNormalBounds());
      getServices()?.browser.releaseUserControlHeldBy({ kind: "local" });
      if ((process.platform === "darwin" || keepRunningInBackground()) && !isQuitting()) {
        event.preventDefault();
        window.hide();
      }
    });
    window.on("show", () => onHiddenWhileWorking(false));
    onMainWindowCreated(window);
    window.on("closed", () => {
      if (holder.current === window) holder.current = null;
      for (const chat of chatWindows.values()) chat.window.close();
    });
    window.on("move", () => rememberMainWindowBounds(window.getNormalBounds()));
    window.on("resize", () => rememberMainWindowBounds(window.getNormalBounds()));

    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("did-navigate", onRendererLoadStarted);
    window.webContents.on("did-navigate", () => {
      const interfaceSize = getServices()?.interfaceSize;
      if (interfaceSize) window.webContents.setZoomFactor(interfaceSize.zoomFactor);
    });
    window.webContents.on("render-process-gone", onRendererGone);
    window.webContents.once("destroyed", onRendererGone);
    window.webContents.on("render-process-gone", (_event, details) => {
      const now = Date.now();
      rendererReloadTimes = rendererReloadTimes.filter((time) => now - time < RENDERER_RELOAD_WINDOW_MS);
      if (
        isQuitting() ||
        window.isDestroyed() ||
        !RELOADABLE_RENDERER_EXITS.has(details.reason) ||
        rendererReloadTimes.length >= RENDERER_RELOAD_MAX
      ) {
        return;
      }
      rendererReloadTimes.push(now);
      setImmediate(() => {
        if (window.isDestroyed()) return;
        loadRenderer(window).catch((error: unknown) =>
          reportError("Could not reload the main window after its renderer stopped", error),
        );
      });
    });
    attachAppInput(window, getServices, getTranslate, { closesBrowserTabs: true, quitShortcut });
    allowPinchZoom(window.webContents);
    followWindowButtonSide(window, getLayoutDirection);
    window.webContents.on("will-navigate", (event, targetUrl) => {
      if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
    });
    window.webContents.on("did-finish-load", () => {
      const services = getServices();
      if (services) {
        Effect.runFork(services.remoteServers.refreshRuntimeSnapshots());
      }
    });
    window.webContents.on("did-stop-loading", () => {
      const services = getServices();
      if (!services) return;
      sendToRenderer(window, IPC_ENDPOINTS.auth.event, services.centralAuth.getState());
      sendToRenderer(
        window,
        IPC_ENDPOINTS.servers.event,
        withLocalHostSummary(services.remoteServers.list(), services.host.getStatus()),
      );
    });

    return window;
  }

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
      ...glassWindowOptions(MAIN_WINDOW_DARK_BACKGROUND),
      title: getTranslate()("window.localHostTitle"),
      icon: appIconPath,
      ...(process.platform === "darwin"
        ? { titleBarStyle: "hidden" as const, trafficLightPosition: WINDOW_BUTTON_INSET }
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
    attachAppInput(window, getServices, getTranslate, { closesBrowserTabs: false, quitShortcut });
    allowPinchZoom(window.webContents);
    followWindowButtonSide(window, getLayoutDirection);
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
    return window.loadURL(appRendererUrl(process.env.ELECTRON_RENDERER_URL).toString()).catch((error: unknown) => {
      if (!isReplacedLoad(error) || window.isDestroyed() || !window.webContents.isLoading()) throw error;
      return replacementLoad(window.webContents, error);
    });
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
    handleQuitShortcut: (window, input) => quitShortcut?.handleInput(window, input) ?? false,
  };
}

function attachAppInput(
  window: BrowserWindow,
  getServices: () => MainWindowApplicationServices | null,
  getTranslate: () => AppTranslate,
  { closesBrowserTabs, quitShortcut }: { closesBrowserTabs: boolean; quitShortcut: QuitShortcut | null },
): void {
  let inspectElementModifierPressed = false;
  if (quitShortcut) window.on("blur", () => quitShortcut.handleBlur(window));
  window.webContents.on("before-input-event", (event, input) => {
    if (quitShortcut?.handleInput(window, input)) {
      event.preventDefault();
      return;
    }
    if (input.key.toLowerCase() === "shift") {
      inspectElementModifierPressed = input.type === "keyDown";
    }
    if (isToggleDevToolsShortcut(input)) {
      event.preventDefault();
      window.webContents.toggleDevTools();
      return;
    }
    const frameFocused = Boolean(window.webContents.focusedFrame?.parent);
    const sizeStep = interfaceSizeShortcut(input, process.platform === "darwin");
    const interfaceSize = getServices()?.interfaceSize;
    const sizeKeyInMenu = !input.shift && input.key !== "+";
    if (!(frameFocused && sizeKeyInMenu) && sizeStep && interfaceSize) {
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
    const items = chatContextMenuItems({
      selectionText: params.selectionText,
      isEditable: params.isEditable,
      linkURL: params.linkURL,
      mediaType: params.mediaType,
      hasImageContents: params.hasImageContents,
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
        if (item.kind === "copy-image")
          return {
            label: t("menu.copyImage"),
            click: () => {
              if (!window.isDestroyed()) window.webContents.copyImageAt(params.x, params.y);
            },
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
  const x11 = process.platform === "linux";
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: x11,
    hiddenInMissionControl: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    enableLargerThanScreen: true,
    hasShadow: false,
    skipTaskbar: true,
    type: process.platform === "darwin" ? "panel" : x11 ? "dock" : "toolbar",
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
  preventPanelActivation(window);
  hidePanelFromWindowSwitchers(window);
  window.webContents.setZoomMode("isolated");
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
  });
  return window;
}

export function createAgentDockWindow(bounds: Rectangle): BrowserWindow {
  const x11 = process.platform === "linux";
  const x11Type = process.env.HYPRLAND_INSTANCE_SIGNATURE ? "splash" : "dock";
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: x11,
    hiddenInMissionControl: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    type: process.platform === "darwin" ? "panel" : x11 ? x11Type : "toolbar",
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
  preventPanelActivation(window);
  hidePanelFromWindowSwitchers(window);
  keepPanelThroughAppHide(window);
  window.webContents.setZoomMode("isolated");
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
  });
  return window;
}

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
  window.setAlwaysOnTop(true, process.platform === "darwin" ? "floating" : "normal");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  window.setIgnoreMouseEvents(true, { forward: true });
  window.webContents.setZoomMode("isolated");
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
  });
  return window;
}

export function createComputerUsePermissionHelpWindow(
  translate: AppTranslate,
  getLayoutDirection: () => LayoutDirection,
): BrowserWindow {
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = 340;
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
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: WINDOW_BUTTON_INSET }
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
  followAppearance(window, MAIN_WINDOW_DARK_BACKGROUND);
  followWindowButtonSide(window, getLayoutDirection);
  window.webContents.setZoomMode("isolated");
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
  });
  return window;
}

function appRendererUrl(developmentUrl: string | undefined): URL {
  return developmentUrl ? new URL(developmentUrl) : new URL("openbot-app://app/index.html");
}

function chatWindowKey(target: ChatWindowTarget): string {
  return JSON.stringify([target.serverId, target.agentId]);
}

const REPLACED_LOAD_ERROR = -3;

function isReplacedLoad(error: unknown): error is Error {
  return error instanceof Error && "errno" in error && error.errno === REPLACED_LOAD_ERROR;
}

function replacementLoad(contents: WebContents, replaced: Error): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (error: Error | null) => {
      contents.off("did-finish-load", onFinish);
      contents.off("did-fail-load", onFail);
      contents.off("did-stop-loading", onStop);
      contents.off("destroyed", onStop);
      if (error) reject(error);
      else resolve();
    };
    const onFinish = () => settle(null);
    const onFail = (_event: ElectronEvent, code: number, description: string, url: string, isMainFrame: boolean) => {
      if (!isMainFrame || code === REPLACED_LOAD_ERROR) return;
      settle(
        Object.assign(new Error(`${description} (${code}) loading '${url}'`), { errno: code, code: description, url }),
      );
    };
    const onStop = () => settle(replaced);
    contents.on("did-finish-load", onFinish);
    contents.on("did-fail-load", onFail);
    contents.on("did-stop-loading", onStop);
    contents.on("destroyed", onStop);
  });
}

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

export function computerUseDisplays(): HighlightDisplay[] {
  return screen.getAllDisplays().map((display) => ({ id: display.id, bounds: display.bounds }));
}

export function computerUseDesktopRect(rect: Rectangle): Rectangle {
  return process.platform === "win32" ? screen.screenToDipRect(null, rect) : rect;
}

export function computerUseCoveringWindowIds(): Set<number> {
  const ids = new Set<number>();
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || !window.isVisible() || window.isMinimized() || !window.isFocusable()) continue;
    const id = Number(window.getMediaSourceId().split(":")[1]);
    if (Number.isSafeInteger(id)) ids.add(id);
  }
  return ids;
}

export function computerUseDesktopPoint(point: Point): Point {
  return process.platform === "win32" ? screen.screenToDipPoint(point) : point;
}

export function sendComputerUseHighlightPlacement(
  window: BrowserWindow,
  placement: ComputerUseHighlightPlacement,
): void {
  sendToRenderer(window, IPC_ENDPOINTS.computerUse.highlightPlacement, placement);
}

let windowsKeptHidden = false;

export function keepWindowsHidden(): void {
  windowsKeptHidden = true;
}

export function hideWindowsForQuit(): void {
  windowsKeptHidden = true;
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.hide();
}

export function showMainWindow(window: BrowserWindow): void {
  if (windowsKeptHidden) return;
  presentMainWindow(window, process.platform, () => app.show(), process.platform === "linux" && !usesX11Windows());
}

export function loadAgentDockRenderer(window: BrowserWindow): Promise<void> {
  const url = helperRendererUrl(process.env.ELECTRON_RENDERER_URL);
  url.searchParams.set("surface", "agent-dock");
  return window.loadURL(url.toString());
}

export function loadDynamicIslandRenderer(window: BrowserWindow, display: Display, variant: AppVariant): Promise<void> {
  const notchDisplay = process.platform !== "linux";
  const displayMode = notchDisplay && display.internal ? "notch" : "island";
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const url = helperRendererUrl(developmentUrl);
  url.searchParams.set("surface", "dynamic-island");
  url.searchParams.set("display", displayMode);
  url.searchParams.set("variant", variant);
  const notch = dynamicIslandNotchSizeForDisplay(display, process.platform);
  if (notch) {
    url.searchParams.set("notch-width", String(notch.width));
    url.searchParams.set("notch-height", String(notch.height));
  }
  return window.loadURL(url.toString());
}

function zoomFocusedContents(interfaceSize: InterfaceSizeService, step: InterfaceSizeStep): void {
  const focused = webContents.getFocusedWebContents();
  if (!focused || focused.session === session.defaultSession) {
    Effect.runFork(interfaceSize.step(step));
    return;
  }
  focused.setZoomLevel(step === "default" ? 0 : focused.getZoomLevel() + (step === "larger" ? 0.5 : -0.5));
}

function hideMenuBar(window: BrowserWindow): void {
  if (process.platform !== "darwin") window.setMenuBarVisibility(false);
}

export type MenuQuitSource = "menu" | "shortcut";

let quitConfirmationOpen = false;

function macQuitItem(
  translate: AppTranslate,
  guarded: () => boolean,
  quit: (source: MenuQuitSource) => void,
): MenuItemConstructorOptions {
  return {
    label: translate("menu.quit"),
    accelerator: "Command+Q",
    click: (_item, _window, event) => {
      if (!event.triggeredByAccelerator) return quit("menu");
      if (!guarded()) return quit("shortcut");
      if (quitConfirmationOpen || windowsKeptHidden) return;
      quitConfirmationOpen = true;
      void dialog
        .showMessageBox({
          type: "question",
          message: translate("menu.quitConfirmTitle"),
          detail: translate("menu.quitConfirmBody"),
          buttons: [translate("menu.quitConfirm"), translate("common.cancel")],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) quit("shortcut");
        })
        .finally(() => {
          quitConfirmationOpen = false;
        });
    },
  };
}

export function configureApplicationMenu(
  service: AgentService,
  updater: UpdateService,
  interfaceSize: InterfaceSizeService,
  translate: AppTranslate,
  getMainWindow: () => BrowserWindow | null,
  workingAgents: () => AgentSummary[],
  quitGuard: () => QuitGuard,
  quit: (source: MenuQuitSource) => void,
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
          process.platform === "darwin"
            ? macQuitItem(
                translate,
                () => {
                  const choice = quitGuard();
                  return isQuitGuarded(choice, choice === "working" ? workingAgents() : []);
                },
                quit,
              )
            : { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
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
      process.platform === "darwin"
        ? { role: "windowMenu" }
        : { role: "windowMenu", submenu: [{ role: "minimize" }, { role: "close", accelerator: "Alt+F4" }] },
    ]),
  );
}
