import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  BrowserBounds,
  BrowserControlAction,
  BrowserControlDetailAction,
  BrowserControlSession,
  BrowserControlState,
  BrowserEnvironment,
  BrowserImageMode,
  BrowserJsonValue,
  BrowserNavigationDirection,
  BrowserPreview,
  BrowserSecretRequest,
  BrowserSnapshot,
  BrowserTab,
  BrowserTarget,
  BrowserViewTarget,
  BrowserVisibilityInput,
} from "@openbot/contracts/ipc";
import { isNumber, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, redactText, toLogValue } from "@openbot/logging";
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  clipboard,
  Menu,
  type NativeImage,
  type Session,
  session,
  type WebContents,
  WebContentsView,
  webContents,
} from "electron";
import {
  BrowserCdpEngine,
  type BrowserScreencastFrame,
  type BrowserUploadAssignment,
  type BrowserViewportInput,
  type SnapshotReadResult,
} from "./browser-cdp";
import { BrowserDiagnostics } from "./browser-diagnostics";
import { applySiteIdentity } from "./browser-identity";
import { BrowserRecorder } from "./browser-recorder";
import {
  browserContextMenuItems,
  EDITABLE_FOCUS_SCRIPT,
  isCloseBrowserTabShortcut,
  isCollapseBrowserShortcut,
  isGlobalSearchShortcut,
  isToggleDevToolsShortcut,
} from "./browser-shortcuts";
import {
  type BrowserTabOwner,
  defaultBrowserEnvironment,
  isPersistableBrowserUrl,
  isSafeViewportSize,
  MAX_PHYSICAL_VIEWPORT_PIXELS,
  persistentBrowserUrl,
  reownStoredBrowserTab,
  type StoredBrowserTab,
  storedBrowserTab,
} from "./browser-state";
import { type BrowserDynamicToolHooks, browserInputAction, browserToolTimeout } from "./browser-tool-actions";
import {
  type BrowserToolArguments,
  type BrowserToolCall,
  parseBrowserToolArguments,
  parseBrowserToolCall,
} from "./browser-tools";
import type { DynamicToolCallParams, DynamicToolResult } from "./protocol";
import { isRecord } from "./protocol";

interface BrowserHostEvents {
  changed: [tabs: BrowserTab[], activeTabId: string | null];
  controlChanged: [state: BrowserControlState];
  documentChanged: [tabId: string, documentIds: ReadonlySet<string>];
}

type KeepQueueBlocked = (promise: Promise<unknown>) => void;

const MAX_ENCODED_CAPTURE_PIXELS = 4_194_304;
const ACTION_POST_DISPATCH_TIMEOUT_MS = 10_000;
/**
 * How long an operation that missed its deadline gets to unwind on its own before the debugger is
 * detached under it, and again to unwind after the detach. Long enough that a renderer which is
 * merely slower than the deadline it was given is never cancelled, short enough that the tab's queue
 * is not held by a renderer that will never answer.
 */
const OPERATION_UNWIND_GRACE_MS = 1_000;
/**
 * How long past its deadline an operation gets before the backstop timer answers for it.
 *
 * An operation carries the same deadline and reports what it managed to do with it: typing states
 * how many characters reached the page, so a caller knows what not to send twice. A backstop that
 * expires at the same millisecond as that check is a race, and the generic message wins it often
 * enough that the caller loses the count. The backstop is there for an operation that does not
 * unwind itself at all, so it starts after the operation's own last chance to answer, and the wait
 * it adds is short beside the ten seconds an action gets by default.
 */
const OPERATION_DEADLINE_BACKSTOP_MS = 250;
/**
 * How long enumerating a tab's documents may take before it is unwound. It runs off a navigation
 * rather than a tool call, so no caller is waiting on it and nothing else supplies a deadline -- but
 * it is queued on the tab, so whatever the agent does next waits behind it.
 */
const DOCUMENT_ENUMERATION_TIMEOUT_MS = 10_000;
/**
 * The live view's frames. The quality is what a page of text survives on a slow link, and the size
 * is the client's panel rather than the host's monitor: a frame larger than the panel that draws it
 * is bytes nobody sees.
 */
const VIEW_FRAME_QUALITY = 60;
const VIEW_FRAME_MAX_WIDTH = 1_280;
const VIEW_FRAME_MAX_HEIGHT = 800;

interface BrowserConsoleMessageDetails {
  level: "info" | "warning" | "error" | "debug";
  message: string;
  sourceId: string;
}

const logger = createOpenBotLogger("browser-host");
const BROWSER_WEB_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  nodeIntegrationInWorker: false,
  webviewTag: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
};

interface InternalTab {
  id: string;
  view: WebContentsView;
  /** WebContentsView clears its property after native destruction. Keep the handle for cleanup. */
  contents: WebContents;
  requestedUrl: string;
  openerTabId?: string;
  popup: boolean;
  popupFailure?: BrowserTab["popupFailure"];
  closing?: boolean;
  ownerThreadId: string | null;
  ownerAgentId: string | null;
  revision: number;
  queue: Promise<unknown>;
  focusOnVisible: boolean;
  environment: BrowserEnvironment;
  engine: BrowserCdpEngine;
  diagnostics: BrowserDiagnostics;
  recording: boolean;
  captureGeneration: number;
  viewInvalidations: Set<() => void>;
  // Pending consent permits human takeover; submission blocks captures until document replacement.
  secret?: { origin: string; submitted: boolean; replaced: boolean; running: boolean };
}

export interface PreparedBrowserSecret {
  request: BrowserSecretRequest;
  submit(secret: string): Promise<"submitted" | "takeover">;
  cancel(): void;
}

/**
 * The file is always rewritten as v2. A v1 file is still read -- `storedBrowserTab` accepts both owner
 * spellings, and a tab that arrives without an environment is given the default rather than dropped.
 */
interface StoredBrowserStateV2 {
  version: 2;
  activeTabId: string | null;
  tabs: Array<StoredBrowserTab & { environment: BrowserEnvironment }>;
}

type BrowserAction = BrowserToolArguments<"act">["action"];

export class BrowserHost {
  static readonly CONTROL_IDLE_GRACE_MS = 1_200;
  readonly #window: BrowserWindow;
  readonly #session: Session;
  readonly #downloadsRoot: string;
  readonly #statePath: string;
  readonly #tabs = new Map<string, InternalTab>();
  readonly #closingTabDrains = new Map<string, Promise<void>>();
  readonly #listeners = new Set<(...args: BrowserHostEvents["changed"]) => void>();
  readonly #controlListeners = new Set<(...args: BrowserHostEvents["controlChanged"]) => void>();
  readonly #documentListeners = new Set<(...args: BrowserHostEvents["documentChanged"]) => void>();
  readonly #controlSessions = new Map<string, BrowserControlSession>();
  readonly #controlTimers = new Map<string, NodeJS.Timeout>();
  readonly #reservedDownloadPaths = new Set<string>();
  readonly #recorder: BrowserRecorder;
  #activeTabId: string | null = null;
  #visible = false;
  #bounds: BrowserBounds | null = null;
  #attachedView: WebContentsView | null = null;
  #pictureInPictureWindow: BrowserWindow | null = null;
  #pictureInPictureOverlayView: WebContentsView | null = null;
  #target: BrowserViewTarget = "main";
  readonly #mountedViews = new Map<WebContentsView, BrowserWindow>();
  readonly #takeoverTabIds = new Set<string>();
  #persistQueue: Promise<void> = Promise.resolve();
  #destroyPromise: Promise<void> | null = null;

  constructor(
    window: BrowserWindow,
    downloadsRoot: string,
    statePath: string,
    options: {
      recordingDurationMs?: number;
      recordingMaxConcurrent?: number;
      recordingMaxAggregateBytes?: number;
    } = {},
  ) {
    this.#window = window;
    this.#downloadsRoot = downloadsRoot;
    this.#statePath = statePath;
    this.#session = session.fromPartition("persist:openbot-browser", { cache: true });
    this.#recorder = new BrowserRecorder(
      downloadsRoot,
      (tabId, recording) => {
        const tab = this.#tabs.get(tabId);
        if (!tab) return;
        tab.recording = recording;
        this.#emitChanged();
      },
      {
        maxRecordingMs: options.recordingDurationMs,
        maxConcurrentRecordings: options.recordingMaxConcurrent,
        maxAggregateBytes: options.recordingMaxAggregateBytes,
      },
    );
    this.#configureSession();
  }

  /**
   * `agents` is the roster as it stands after the migrations have run, and is what points a tab a
   * pre-rename build wrote at the agent that owns it now. Without it the owner and thread ids in the file
   * name an agent that no longer answers to them, and every tool call against the tab is refused.
   */
  async restore(agents: readonly BrowserTabOwner[] = []): Promise<void> {
    const state = await readBrowserState(this.#statePath);
    if (state.tabs.length === 0) return;

    const tabs: InternalTab[] = [];
    for (const saved of state.tabs) {
      const stored = reownStoredBrowserTab(saved, agents);
      const ownerAgentId =
        stored.ownerAgentId ??
        agents.find((agent) => agent.threadId === stored.ownerThreadId && stored.ownerThreadId !== null)?.id ??
        null;
      if (!this.#hasTabCapacity(stored.ownerThreadId, ownerAgentId)) continue;
      const tab = this.#createTab(stored.id, stored.url, stored.ownerThreadId, stored.ownerAgentId, stored.environment);
      this.#tabs.set(tab.id, tab);
      this.#bindTabEvents(tab);
      tabs.push(tab);
    }
    this.#activeTabId = this.#tabs.has(state.activeTabId ?? "") ? state.activeTabId : (tabs[0]?.id ?? null);
    this.#syncAttachedView();
    this.#emitChanged();

    const restoreTab = async (tab: InternalTab) => {
      await tab.contents.loadURL("about:blank");
      await tab.engine.setEnvironment(tab.environment);
      await tab.engine.navigate(tab.requestedUrl);
      tab.contents.navigationHistory.clear();
    };
    const activeTab = this.#activeTabId ? this.#tabs.get(this.#activeTabId) : undefined;
    const activeReady = activeTab ? restoreTab(activeTab).catch(() => undefined) : Promise.resolve();
    if (activeTab) activeTab.queue = activeReady;
    for (const tab of tabs) {
      if (tab === activeTab) continue;
      tab.queue = activeReady.then(() => restoreTab(tab)).catch(() => undefined);
    }
  }

  onChanged(listener: (...args: BrowserHostEvents["changed"]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onControlChanged(listener: (...args: BrowserHostEvents["controlChanged"]) => void): () => void {
    this.#controlListeners.add(listener);
    return () => this.#controlListeners.delete(listener);
  }

  onDocumentChanged(listener: (...args: BrowserHostEvents["documentChanged"]) => void): () => void {
    this.#documentListeners.add(listener);
    return () => this.#documentListeners.delete(listener);
  }

  getControlState(): BrowserControlState {
    return {
      sessions: [...this.#controlSessions.values()]
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
        .map((session) => ({ ...session })),
    };
  }

  endControl(threadId: string, turnId: string): void {
    const id = controlSessionId(threadId, turnId);
    const timer = this.#controlTimers.get(id);
    if (timer) clearTimeout(timer);
    this.#controlTimers.delete(id);
    if (!this.#controlSessions.delete(id)) return;
    this.#emitControlChanged();
  }

  clearControls(): void {
    for (const timer of this.#controlTimers.values()) clearTimeout(timer);
    this.#controlTimers.clear();
    if (this.#controlSessions.size === 0) return;
    this.#controlSessions.clear();
    this.#emitControlChanged();
  }

  listTabs(): BrowserTab[] {
    return [...this.#tabs.values()]
      .filter((tab) => !tab.closing && !tab.contents.isDestroyed())
      .map((tab) => toPublicTab(tab));
  }

  get activeTabId(): string | null {
    return this.#activeTabId;
  }

  get visible(): boolean {
    return this.#visible;
  }

  getDisplayState(): { tabs: BrowserTab[]; activeTabId: string | null } {
    return { tabs: this.listTabs(), activeTabId: this.#activeTabId };
  }

  setPictureInPictureWindow(window: BrowserWindow | null): void {
    this.#pictureInPictureWindow = window;
    if (!window && this.#target === "picture-in-picture") {
      this.#visible = false;
      this.#target = "main";
      if (this.#attachedView) this.#mountView(this.#attachedView, this.#window);
    }
    this.#syncAttachedView();
  }

  setPictureInPictureOverlayView(view: WebContentsView | null): void {
    const previous = this.#pictureInPictureOverlayView;
    const window = this.#pictureInPictureWindow;
    if (previous && window && !window.isDestroyed()) window.contentView.removeChildView(previous);
    this.#pictureInPictureOverlayView = view;
    if (view && window && !window.isDestroyed()) window.contentView.addChildView(view);
  }

  async open(
    url: string,
    ownerThreadId: string | null = null,
    ownerAgentId: string | null = null,
    focus = false,
  ): Promise<BrowserTab> {
    if (!this.#hasTabCapacity(ownerThreadId, ownerAgentId)) {
      throw new Error(`The browser can have up to ${INPUT_LIMITS.browserTabs} open tabs.`);
    }
    const normalizedUrl = normalizeBrowserUrl(url);
    const focusedContents = focus ? null : webContents.getFocusedWebContents();
    const previouslyFocused =
      focusedContents && ![...this.#tabs.values()].some((candidate) => candidate.contents === focusedContents)
        ? focusedContents
        : null;
    const tab = this.#createTab(randomUUID(), normalizedUrl, ownerThreadId, ownerAgentId);

    this.#tabs.set(tab.id, tab);
    this.#bindTabEvents(tab);
    this.#activeTabId = tab.id;
    tab.focusOnVisible = focus;
    this.#syncAttachedView();
    if (!focus) restoreWebContentsFocus(previouslyFocused, tab.contents);
    this.#emitChanged();
    await this.#persistState();

    try {
      await tab.contents.loadURL(normalizedUrl, browserLoadOptions());
      if (focus) {
        this.#focusTab(tab);
        setImmediate(() => this.#focusTab(tab));
      } else restoreWebContentsFocus(previouslyFocused, tab.contents);
    } catch (error) {
      if (this.#tabs.get(tab.id) === tab) {
        this.#unmountView(tab.view);
        this.#tabs.delete(tab.id);
        tab.engine.destroy();
        tab.contents.close();
        if (this.#activeTabId === tab.id) {
          this.#activeTabId = this.#tabs.keys().next().value ?? null;
        }
        this.#syncAttachedView();
      }
      this.#emitChanged();
      await this.#persistState();
      throw new Error(`Unable to open ${normalizedUrl}: ${String(error)}`);
    }

    return toPublicTab(tab);
  }

  #hasTabCapacity(ownerThreadId: string | null, ownerAgentId: string | null): boolean {
    const tabs = [...this.#tabs.values()].filter((tab) => {
      if (tab.ownerAgentId && ownerAgentId) return tab.ownerAgentId === ownerAgentId;
      if (tab.ownerThreadId) return tab.ownerThreadId === ownerThreadId;
      return tab.ownerAgentId === null && ownerAgentId === null && ownerThreadId === null;
    });
    return tabs.length < INPUT_LIMITS.browserTabs;
  }

  async activate(tabId: string): Promise<void> {
    this.#requireTab(tabId);
    this.#activeTabId = tabId;
    this.#syncAttachedView();
    this.#emitChanged();
    await this.#persistState();
  }

  async navigate(tabId: string, direction: BrowserNavigationDirection): Promise<void> {
    await this.#enqueue(tabId, async (tab) => {
      await navigateAndWait(tab.contents, () => navigateHistory(tab.contents, direction));
    });
  }

  async loadUrl(tabId: string, url: string): Promise<void> {
    const normalizedUrl = normalizeBrowserUrl(url);
    await this.#enqueue(
      tabId,
      async (tab) => {
        await navigateAndWait(tab.contents, () => tab.contents.loadURL(normalizedUrl, browserLoadOptions()));
        this.#focusTab(tab);
      },
      true,
    );
  }

  async reload(tabId: string): Promise<void> {
    await this.#enqueue(
      tabId,
      async (tab) =>
        navigateAndWait(tab.contents, () => {
          tab.contents.reload();
          return true;
        }),
      true,
    );
  }

  async close(tabId: string): Promise<void> {
    const tab = this.#tabs.get(tabId);
    if (!tab) return;
    const tabIds = [...this.#tabs.keys()];
    const closedIndex = tabIds.indexOf(tabId);
    this.#unmountView(tab.view);
    this.#tabs.delete(tabId);
    const childDrains = [...this.#tabs.values()]
      .filter((child) => child.openerTabId === tabId)
      .map((child) => this.close(child.id));
    this.#takeoverTabIds.delete(tabId);

    if (this.#activeTabId === tabId) {
      this.#activeTabId =
        (tab.openerTabId && this.#tabs.has(tab.openerTabId) ? tab.openerTabId : null) ??
        tabIds.slice(closedIndex + 1).find((id) => this.#tabs.has(id)) ??
        tabIds
          .slice(0, closedIndex)
          .reverse()
          .find((id) => this.#tabs.has(id)) ??
        null;
      const active = this.#activeTabId ? this.#tabs.get(this.#activeTabId) : undefined;
      if (active) active.focusOnVisible = true;
    }
    this.#syncAttachedView();
    this.#emitChanged();
    const destroy = tab.queue.then(async () => {
      await Promise.all(childDrains);
      try {
        await this.#recorder.discard(tabId, "tab-closed");
      } finally {
        tab.engine.destroy();
        if (!tab.contents.isDestroyed()) tab.contents.close();
      }
    });
    this.#closingTabDrains.set(tab.id, destroy);
    tab.queue = destroy.catch(() => undefined);
    const statePersistence = this.#persistState();
    try {
      await destroy;
      await statePersistence;
    } finally {
      if (this.#closingTabDrains.get(tab.id) === destroy) this.#closingTabDrains.delete(tab.id);
    }
  }

  async beginTakeover(tabId: string): Promise<void> {
    const tab = this.#tabs.get(tabId);
    if (!tab) throw new Error("Browser tab not found.");
    tab.engine.invalidateReferences();
    this.#takeoverTabIds.add(tabId);
    this.#syncAttachedView();
    tab.diagnostics.clearDiagnostics();
    this.#emitChanged();
    try {
      await this.#enqueue(tabId, () => this.#recorder.discard(tabId, "tab-closed"), true);
    } catch (error) {
      tab.diagnostics.clearDiagnostics();
      this.#takeoverTabIds.delete(tabId);
      throw error;
    }
  }

  async prepareSecret(params: DynamicToolCallParams): Promise<PreparedBrowserSecret> {
    const call = parseBrowserToolCall("submit_secret", params.arguments);
    if (call.tool !== "submit_secret") throw new Error("Invalid secure authentication request.");
    const args = call.args;
    this.#requireToolTab(params, args.tabId);
    const tab = this.#requireTab(args.tabId);
    if (tab.secret) throw new Error("Authentication is already active.");
    const url = new URL(currentTabUrl(tab));
    if (url.protocol !== "https:") throw new Error("Secure authentication requires HTTPS.");
    if (args.method !== "password" && args.digits === 0) throw new Error("Authentication codes require 4–12 digits.");
    if (
      (args.method === "password" && args.targets.length !== 1) ||
      (args.targets.length !== 1 && args.targets.length !== args.digits) ||
      (args.submission === "click") !== Boolean(args.submitTarget)
    )
      throw new Error("Invalid authentication targets.");
    const protection = { origin: url.origin, submitted: false, replaced: false, running: false };
    tab.secret = protection;
    this.#invalidateViews(tab);
    this.#syncAttachedView();
    try {
      const enter = await this.#enqueue(
        args.tabId,
        async (_tab, keepQueueBlocked) => {
          await this.#recorder.discard(args.tabId, "requested");
          tab.diagnostics.clearDiagnostics();
          return this.#boundEngineOperation(
            tab,
            tab.engine.prepareSecret(args.targets, url.origin, args.submission, args.submitTarget),
            10_000,
            "Authentication target resolution timed out.",
            keepQueueBlocked,
          );
        },
        true,
      );
      return {
        // Password cards do not use digits; keep public metadata within its released bounds.
        request: { method: args.method, origin: url.origin, digits: args.method === "password" ? 6 : args.digits },
        cancel: () => {
          if (tab.secret === protection && !protection.submitted) {
            tab.secret = undefined;
            this.#syncAttachedView();
            this.#emitChanged();
          }
        },
        submit: async (secret) => {
          if (tab.secret !== protection || protection.submitted) throw new Error("Authentication request expired.");
          if (args.method !== "password" && !new RegExp(`^[0-9]{${args.digits}}$`, "u").test(secret))
            throw new Error("Enter the requested number of digits.");
          protection.submitted = true;
          this.#invalidateViews(tab);
          protection.running = true;
          this.#syncAttachedView();
          try {
            await this.#enqueue(
              args.tabId,
              async (_tab, keepQueueBlocked) => {
                await this.#boundEngineOperation(
                  tab,
                  enter(secret),
                  10_000,
                  "Authentication submission timed out.",
                  keepQueueBlocked,
                );
                if (!protection.replaced) {
                  await new Promise<void>((resolve) => {
                    const contents = tab.contents;
                    const finish = () => {
                      clearTimeout(timer);
                      contents.off("did-navigate", finish);
                      contents.off("destroyed", finish);
                      resolve();
                    };
                    const timer = setTimeout(finish, 5_000);
                    contents.once("did-navigate", finish);
                    contents.once("destroyed", finish);
                  });
                }
                if (!protection.replaced) {
                  // Load with GET rather than replaying a possible form POST. Keep capture
                  // blocked until navigation has replaced the document and this operation ends.
                  await this.#boundEngineOperation(
                    tab,
                    navigateAndWait(tab.contents, () => tab.contents.loadURL(currentTabUrl(tab), browserLoadOptions())),
                    10_000,
                    "Authentication page reload timed out.",
                    keepQueueBlocked,
                  );
                }
              },
              true,
            );
          } finally {
            protection.running = false;
            tab.diagnostics.clearDiagnostics();
            if (protection.replaced) {
              tab.contents.navigationHistory.clear();
              tab.secret = undefined;
              this.#syncAttachedView();
            }
            this.#emitChanged();
          }
          return protection.replaced ? "submitted" : "takeover";
        },
      };
    } catch {
      tab.secret = undefined;
      this.#syncAttachedView();
      throw new Error("Secure authentication is unavailable. Use browser takeover.");
    }
  }

  endTakeover(tabId: string): void {
    const tab = this.#tabs.get(tabId);
    if (tab) {
      tab.engine.invalidateReferences();
      tab.diagnostics.clearDiagnostics();
    }
    this.#takeoverTabIds.delete(tabId);
    this.#syncAttachedView();
    this.#emitChanged();
  }

  async setVisible(input: BrowserVisibilityInput): Promise<void> {
    const restoreRendererFocus = !input.visible && this.#attachedView?.webContents.isFocused();
    this.#visible = input.visible;
    if (input.bounds) this.#bounds = validateBounds(input.bounds);
    if (input.target) this.#target = input.target;
    this.#syncAttachedView();
    if (restoreRendererFocus) this.#window.webContents.focus();
  }

  async snapshot(tabId: string): Promise<BrowserSnapshot> {
    return this.#enqueue(tabId, async (tab, keepQueueBlocked) => {
      const revision = tab.revision + 1;
      return (await this.#readSnapshot(tab, revision, keepQueueBlocked)).snapshot;
    });
  }

  async act(tabId: string, revision: number, action: BrowserAction): Promise<BrowserSnapshot> {
    return this.#enqueue(tabId, async (tab, keepQueueBlocked) => {
      if (revision !== tab.revision) {
        throw new Error("Stale browser references. Take a fresh snapshot before acting.");
      }
      const target =
        action.type === "click" || action.type === "type"
          ? ({ kind: "ref", ref: action.ref, revision } as const)
          : undefined;
      const deadline = Date.now() + 10_000;
      try {
        const dispatch = async (): Promise<void> => {
          switch (action.type) {
            case "click":
              if (!target) throw new Error("Legacy click requires a target.");
              await tab.engine.click(target, {}, deadline);
              return;
            case "type":
              if (!target) throw new Error("Legacy type requires a target.");
              await tab.engine.type(target, action.text, { mode: "replace", submit: action.submit === true }, deadline);
              return;
            case "key":
              await tab.engine.press(action.key, undefined, deadline);
              return;
            case "scroll":
              await tab.engine.scroll(undefined, 0, action.deltaY, deadline);
              return;
            case "back":
            case "forward":
              await navigateAndWait(tab.contents, () => navigateHistory(tab.contents, action.type));
              return;
            case "reload":
              await navigateAndWait(tab.contents, () => {
                tab.contents.reload();
                return true;
              });
          }
        };
        // The deadline the engine carries is checked between its commands, which a renderer that
        // answers none of them never reaches -- and re-resolving a ref fingerprints the element in
        // the frame that owns it, so a page wedged after the snapshot hangs the dispatch itself.
        const dispatchTimeout = Math.max(1, deadline - Date.now());
        await this.#boundEngineOperation(
          tab,
          dispatch(),
          dispatchTimeout,
          "Browser action timed out.",
          keepQueueBlocked,
        );
        const settleTimeout = Math.max(1, deadline - Date.now());
        const settleCompletion = tab.engine.settle(settleTimeout);
        try {
          // Settling bounds its own waiting with timers, but the commands it sends to each frame are
          // not bounded by them, so a frame that answers none of them holds this action -- and the
          // tab's queue behind it -- open for good.
          await withTimeout(settleCompletion, settleTimeout, "Browser action timed out.");
        } catch (error) {
          if (!isTimeoutError(error)) throw error;
          // The action fails from here as it always did, so nothing else is using the session and the
          // unwind can start at once.
          keepQueueBlocked(this.#unwindStalledOperation(tab, settleCompletion));
          throw error;
        }
        tab.diagnostics.action({
          action: action.type,
          target: target ? describeBrowserTarget(target) : undefined,
          outcome: "success",
        });
      } catch (error) {
        tab.diagnostics.action({
          action: action.type,
          target: target ? describeBrowserTarget(target) : undefined,
          outcome: "error",
          detail: String(error),
        });
        throw error;
      }
      const nextRevision = tab.revision + 1;
      return (await this.#readSnapshot(tab, nextRevision, keepQueueBlocked)).snapshot;
    });
  }

  async screenshot(tabId: string): Promise<string> {
    return this.#enqueue(tabId, async (tab, keepQueueBlocked) => {
      const image = await this.#boundEngineOperation(
        tab,
        tab.engine.screenshot(),
        10_000,
        "Browser screenshot timed out.",
        keepQueueBlocked,
      );
      return boundedCaptureDataUrl(image);
    });
  }

  async capturePreview(tabId: string): Promise<BrowserPreview> {
    return this.#enqueue(tabId, async (tab, keepQueueBlocked) => {
      const image = await this.#boundEngineOperation(
        tab,
        tab.engine.screenshot(),
        10_000,
        "Browser preview timed out.",
        keepQueueBlocked,
      );
      const size = image.getSize();
      if (size.width <= 0 || size.height <= 0) throw new Error("Browser preview is empty.");

      const targetAspectRatio = 16 / 10;
      let cropWidth = size.width;
      let cropHeight = Math.round(cropWidth / targetAspectRatio);
      if (cropHeight > size.height) {
        cropHeight = size.height;
        cropWidth = Math.round(cropHeight * targetAspectRatio);
      }
      const cropped = image.crop({
        x: Math.max(0, Math.floor((size.width - cropWidth) / 2)),
        y: 0,
        width: cropWidth,
        height: cropHeight,
      });
      const preview = cropped.resize({ width: 960, height: 600, quality: "good" });
      const dataUrl = `data:image/jpeg;base64,${preview.toJPEG(72).toString("base64")}`;
      return { dataUrl, width: 960, height: 600 };
    });
  }

  /**
   * A live view of a tab, for a member who is not at this computer.
   *
   * The frames do not go through the tab's operation queue. A queued frame is a frame that arrives
   * after whatever the agent is doing has finished, which is exactly the picture the still-image
   * route already gave; the point of the view is that the page moves while the agent works.
   */
  #invalidateViews(tab: InternalTab): void {
    tab.captureGeneration += 1;
    for (const invalidate of [...tab.viewInvalidations]) invalidate();
  }

  async startView(
    tabId: string,
    onFrame: (frame: BrowserScreencastFrame) => void,
    onInvalidated?: () => void,
  ): Promise<() => Promise<void>> {
    const tab = this.#requireTab(tabId);
    if (tab.secret?.submitted) throw new Error("Browser view is protected during authentication.");
    const generation = tab.captureGeneration;
    let invalidated = false;
    const invalidate = () => {
      invalidated = true;
      tab.viewInvalidations.delete(invalidate);
      onInvalidated?.();
    };
    tab.viewInvalidations.add(invalidate);
    try {
      const stop = await tab.engine.startScreencast(
        { quality: VIEW_FRAME_QUALITY, maxWidth: VIEW_FRAME_MAX_WIDTH, maxHeight: VIEW_FRAME_MAX_HEIGHT },
        (frame) => {
          if (!tab.secret?.submitted && tab.captureGeneration === generation) onFrame(frame);
        },
      );
      let stopped = false;
      const stopOnce = async () => {
        tab.viewInvalidations.delete(invalidate);
        if (stopped) return;
        stopped = true;
        await stop();
      };
      if (invalidated) await stopOnce();
      return stopOnce;
    } catch (error) {
      tab.viewInvalidations.delete(invalidate);
      throw error;
    }
  }

  /**
   * Input from the person watching that view. It is not queued either, for the same reason a local
   * click on the visible tab is not: a pointer that answers when the agent's turn ends is not a
   * pointer. Anything that can change the page clears the references the agent's last snapshot
   * handed out, the way taking the tab over does, so the agent takes a fresh one rather than acting
   * on an element the person moved.
   */
  async dispatchViewInput(tabId: string, input: BrowserViewportInput): Promise<void> {
    const tab = this.#requireTab(tabId);
    if (tab.secret?.submitted) throw new Error("Browser input is protected during authentication.");
    if (input.type !== "pointer" || input.action !== "move") tab.engine.invalidateReferences();
    await tab.engine.dispatchViewportInput(input);
  }

  async handleDynamicTool(
    params: DynamicToolCallParams,
    hooks: BrowserDynamicToolHooks = {},
  ): Promise<DynamicToolResult> {
    try {
      const call = parseBrowserToolCall(params.tool, params.arguments);
      this.#beginControl(params, call);
      switch (call.tool) {
        case "open": {
          const { args } = call;
          const url = args.url;
          const tab = await this.open(url, params.threadId, params.ownerAgentId ?? null);
          this.#updateControlTab(params, tab.id);
          return textResult({ tab });
        }
        case "list_tabs": {
          const tabs = this.listTabs().filter((tab) => this.#canUseToolTab(params, tab));
          const activeTabId = tabs.some((tab) => tab.id === this.#activeTabId)
            ? this.#activeTabId
            : (tabs.at(-1)?.id ?? null);
          return textResult({ tabs, activeTabId });
        }
        case "status": {
          const tabs = this.listTabs().filter((tab) => this.#canUseToolTab(params, tab));
          const activeTabId = tabs.some((tab) => tab.id === this.#activeTabId)
            ? this.#activeTabId
            : (tabs.at(-1)?.id ?? null);
          const control = {
            sessions: this.getControlState().sessions.filter((session) => session.threadId === params.threadId),
          };
          return textResult({ tabs, activeTabId, control });
        }
        case "snapshot": {
          const { args } = call;
          const tabId = args.tabId;
          this.#requireToolTab(params, tabId);
          const mode = args.image ?? "auto";
          const capture = await this.#enqueue(tabId, async (tab, keepQueueBlocked) => {
            const result = await this.#readSnapshot(tab, tab.revision + 1, keepQueueBlocked);
            const includeImage = mode === "always" || (mode === "auto" && result.recommendImage);
            if (!includeImage) return { result, imageUrl: null };
            const image = await this.#boundEngineOperation(
              tab,
              tab.engine.screenshot(),
              10_000,
              "Browser screenshot timed out.",
              keepQueueBlocked,
            );
            return { result, imageUrl: boundedCaptureDataUrl(image) };
          });
          return this.#snapshotResult(capture.result, mode, capture.imageUrl);
        }
        case "navigate": {
          const { args } = call;
          const tabId = args.tabId;
          this.#requireToolTab(params, tabId);
          const url = args.url;
          const direction = args.direction;
          if (!url && !direction) throw new Error("navigate requires url or direction.");
          const timeoutMs = browserToolTimeout(args.timeoutMs);
          return textResult(
            await this.#runAction(
              tabId,
              "navigate",
              undefined,
              async (tab, deadline) => {
                const operationTimeout = remainingTime(deadline, "Browser navigate timed out.");
                if (url) {
                  const normalizedUrl = normalizeBrowserUrl(url);
                  tab.requestedUrl = normalizedUrl;
                  await navigateAndWait(
                    tab.contents,
                    () => tab.contents.loadURL(normalizedUrl, browserLoadOptions()),
                    operationTimeout,
                  );
                } else if (direction === "reload") {
                  await navigateAndWait(
                    tab.contents,
                    () => {
                      tab.contents.reload();
                      return true;
                    },
                    operationTimeout,
                  );
                } else if (direction) {
                  await navigateAndWait(tab.contents, () => navigateHistory(tab.contents, direction), operationTimeout);
                }
              },
              timeoutMs,
            ),
          );
        }
        case "click":
        case "type":
        case "press":
        case "hover":
        case "scroll":
        case "select_option":
        case "set_checked":
        case "drag":
        case "upload_files": {
          this.#requireToolTab(params, call.args.tabId);
          const action = browserInputAction(call, hooks);
          return textResult(
            await this.#runAction(
              call.args.tabId,
              action.name,
              action.target,
              (tab, deadline, markDispatched) => action.run(tab.engine, deadline, markDispatched),
              browserToolTimeout(call.args.timeoutMs),
              call.tool === "upload_files" ? hooks.onUploadOperationStarted : undefined,
            ),
          );
        }
        case "wait_for": {
          const { args } = call;
          const tabId = args.tabId;
          this.#requireToolTab(params, tabId);
          const target = args.target;
          const condition = {
            target,
            text: args.text,
            url: args.url,
            state: args.state,
          };
          if (!condition.target && !condition.text && !condition.url && !condition.state)
            throw new Error("wait_for requires a condition.");
          const timeoutMs = browserToolTimeout(args.timeoutMs);
          return textResult(
            await this.#enqueue(tabId, async (tab, keepQueueBlocked) => {
              const timeoutMessage = "Browser wait condition timed out.";
              const deadline = Date.now() + timeoutMs;
              // The engine checks this deadline between commands, which a frame that answers none of
              // them never reaches.
              const waitTimeout = remainingTime(deadline, timeoutMessage);
              await this.#boundEngineOperation(
                tab,
                tab.engine.waitFor(condition, waitTimeout),
                waitTimeout,
                timeoutMessage,
                keepQueueBlocked,
              );
              return (
                await this.#readSnapshot(
                  tab,
                  tab.revision + 1,
                  keepQueueBlocked,
                  remainingTime(deadline, timeoutMessage),
                  timeoutMessage,
                )
              ).snapshot;
            }),
          );
        }
        case "evaluate": {
          const { args } = call;
          const tabId = args.tabId;
          this.#requireToolTab(params, tabId);
          const expression = args.expression;
          const awaitPromise = args.awaitPromise ?? true;
          return textResult(
            await this.#runEvaluation(tabId, expression, awaitPromise, browserToolTimeout(args.timeoutMs)),
          );
        }
        case "set_environment": {
          const { args } = call;
          const tabId = args.tabId;
          this.#requireToolTab(params, tabId);
          return textResult(
            await this.#enqueue(tabId, async (tab, keepQueueBlocked) => {
              const environment = resolveEnvironment(args, tab.environment, tab.view.getBounds());
              // This also bounds the engine's rollback if applying the environment fails.
              await this.#boundEngineOperation(
                tab,
                tab.engine.setEnvironment(environment),
                10_000,
                "Browser environment change timed out.",
                keepQueueBlocked,
              );
              tab.environment = environment;
              await this.#persistState();
              this.#emitChanged();
              return (await this.#readSnapshot(tab, tab.revision + 1, keepQueueBlocked)).snapshot;
            }),
          );
        }
        case "recording_start": {
          const { args } = call;
          const tabId = args.tabId;
          this.#requireToolTab(params, tabId);
          await this.#enqueue(tabId, (tab) => this.#recorder.start(tabId, tab.contents));
          return textResult({ recording: true, tabId, limits: { durationMs: 300_000, bytes: 104_857_600 } });
        }
        case "recording_stop": {
          const { args } = call;
          const tabId = args.tabId;
          this.#requireToolTab(params, tabId);
          return textResult({ artifact: await this.#enqueue(tabId, () => this.#recorder.stop(tabId)) });
        }
        case "act": {
          const { args } = call;
          const tabId = args.tabId;
          this.#requireToolTab(params, tabId);
          const revision = args.revision;
          const action = args.action;
          return textResult(await this.act(tabId, revision, action));
        }
        case "screenshot": {
          const { args } = call;
          const tabId = args.tabId;
          this.#requireToolTab(params, tabId);
          const imageUrl = await this.screenshot(tabId);
          return { success: true, contentItems: [{ type: "inputImage", imageUrl }] };
        }
        case "close_tab": {
          const { args } = call;
          const tabId = args.tabId;
          // Checked only for a tab that exists, so closing an id that is already gone stays a silent
          // success and a repeated close is idempotent.
          const tab = this.#tabs.get(tabId);
          if (tab) {
            this.#requireToolTab(params, tabId);
            logger.info("Agent closed a browser tab.", {
              tabId,
              host: logUrlHost(tab.requestedUrl),
              agentId: params.ownerAgentId ?? null,
            });
          }
          await this.close(tabId);
          return textResult({ closed: true });
        }
        case "submit_secret":
        case "request_takeover":
          // Published in BROWSER_TOOL_DEFINITIONS like every other tool, but answered by the agent
          // service, which intercepts the namespace before the call reaches a host. Reaching here
          // means a caller bypassed that, and silently succeeding would tell the model the user had
          // been asked for control when nobody was.
          throw new Error("Browser takeover is handled by the agent service, not the browser host.");
        default:
          return call satisfies never;
      }
    } catch (error) {
      return {
        success: false,
        // The single place every browser tool failure reaches a provider. A page exception carries
        // the page's own message -- `throw new Error("password=hunter2")` -- so this gets the same
        // redaction the diagnostics ring applies, and the diagnostic copy stays the redacted one.
        contentItems: [{ type: "inputText", text: redactText(String(error)) }],
      };
    } finally {
      this.#finishControl(params);
    }
  }

  async resolveUploadTarget(params: DynamicToolCallParams): Promise<BrowserUploadAssignment> {
    const args = parseBrowserToolArguments("upload_files", params.arguments);
    const tabId = args.tabId;
    this.#requireToolTab(params, tabId);
    const target = args.target;
    const timeoutMs = browserToolTimeout(args.timeoutMs);
    return this.#enqueue(tabId, (tab, keepQueueBlocked) =>
      // This preflight scans every frame for the input, so an unresponsive one holds it open exactly
      // as it would the upload itself -- and it is queued ahead of that bounded upload, so without a
      // bound of its own the tab never reaches the operation the timeout was meant to protect.
      this.#boundEngineOperation(
        tab,
        tab.engine.resolveUploadTarget(target),
        timeoutMs,
        "Browser upload target resolution timed out.",
        keepQueueBlocked,
      ),
    );
  }

  destroy(): Promise<void> {
    this.#destroyPromise ??= this.#destroyPersistentStorageAndViews();
    return this.#destroyPromise;
  }

  async #destroyPersistentStorageAndViews(): Promise<void> {
    const statePersistence = this.#persistState();
    const closingTabDrains = [...this.#closingTabDrains.values()];
    const activeTabDrains: Promise<void>[] = [];
    this.#session.flushStorageData();
    for (const tab of this.#tabs.values()) {
      this.#unmountView(tab.view);
      const drain = tab.queue.then(() => {
        tab.engine.destroy();
        if (!tab.contents.isDestroyed()) tab.contents.close();
      });
      activeTabDrains.push(drain);
      tab.queue = drain.catch(() => undefined);
    }
    const tabDrains = [...closingTabDrains, ...activeTabDrains];
    const recorderDestruction = Promise.allSettled(tabDrains).then(() => this.#recorder.destroy());
    this.#tabs.clear();
    this.#listeners.clear();
    this.clearControls();
    this.#controlListeners.clear();
    this.#documentListeners.clear();
    const results = await Promise.allSettled([
      this.#session.cookies.flushStore(),
      statePersistence,
      recorderDestruction,
      ...tabDrains,
    ]);
    this.#closingTabDrains.clear();
    this.#session.flushStorageData();
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }

  async flushPersistentStorage(): Promise<void> {
    this.#session.flushStorageData();
    await this.#session.cookies.flushStore();
    await this.#persistState();
  }

  #createTab(
    id: string,
    requestedUrl: string,
    ownerThreadId: string | null,
    ownerAgentId: string | null,
    environment: BrowserEnvironment = defaultBrowserEnvironment(),
    popupOptions?: BrowserWindowConstructorOptions,
  ): InternalTab {
    if (this.#destroyPromise) throw new Error("BrowserHost is shutting down.");
    const view = this.#createView(popupOptions);
    this.#mountView(view);
    const diagnostics = new BrowserDiagnostics();
    return {
      id,
      view,
      contents: view.webContents,
      popup: popupOptions !== undefined,
      requestedUrl,
      ownerThreadId,
      ownerAgentId,
      revision: 0,
      queue: Promise.resolve(),
      focusOnVisible: false,
      environment,
      engine: new BrowserCdpEngine(view.webContents),
      diagnostics,
      recording: false,
      captureGeneration: 0,
      viewInvalidations: new Set(),
    };
  }

  #createView(popupOptions?: BrowserWindowConstructorOptions): WebContentsView {
    const view = new WebContentsView({
      ...(popupOptions?.webContents ? { webContents: popupOptions.webContents } : {}),
      webPreferences: {
        ...popupOptions?.webPreferences,

        session: this.#session,
        ...BROWSER_WEB_PREFERENCES,
      },
    });
    view.webContents.setAudioMuted(true);
    view.setBackgroundColor("#0b0b0b");
    return view;
  }

  #configureSession(): void {
    // The embedded browser keeps its native identity everywhere: scrubbing the build and
    // product tokens made Google read it as an unknown client and refuse sign-in, while
    // workers leaked the tokens anyway. Only the languages are rewritten, from the system.
    this.#session.setUserAgent(this.#session.getUserAgent(), preferredBrowserLanguageCodes());
    this.#session.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({
        requestHeaders: browserRequestHeaders(details.url, details.requestHeaders),
      });
    });
    this.#session.webRequest.onCompleted((details) => {
      const tab = [...this.#tabs.values()].find((candidate) => candidate.contents.id === details.webContentsId);
      if (!tab || tab.secret) return;
      tab.diagnostics.add({
        kind: "network",
        level: details.statusCode >= 400 ? "error" : "info",
        message: `${details.method} ${details.statusCode}`,
        url: diagnosticUrl(details.url),
        method: details.method,
        status: details.statusCode,
      });
      if (details.statusCode >= 400) this.#emitChanged();
    });
    this.#session.webRequest.onErrorOccurred((details) => {
      const tab = [...this.#tabs.values()].find((candidate) => candidate.contents.id === details.webContentsId);
      if (!tab || tab.secret) return;
      tab.diagnostics.add({
        kind: "network",
        level: "error",
        message: `${details.method} ${details.error}`,
        url: diagnosticUrl(details.url),
        method: details.method,
      });
      this.#emitChanged();
    });
    this.#session.setPermissionRequestHandler((_webContents, permission, callback) =>
      callback(isAllowedBrowserPermission(permission)),
    );
    this.#session.setPermissionCheckHandler((_webContents, permission) => isAllowedBrowserPermission(permission));
    this.#session.on("will-download", (event, item, contents) => {
      if ([...this.#tabs.values()].some((tab) => tab.secret && tab.contents === contents)) {
        event.preventDefault();
        return;
      }
      const safeName = basename(item.getFilename()).replace(/[^a-zA-Z0-9._ -]/g, "_");
      const downloadPath = uniqueDownloadPath(
        this.#downloadsRoot,
        safeName || `download-${Date.now()}`,
        this.#reservedDownloadPaths,
      );
      this.#reservedDownloadPaths.add(downloadPath);
      item.setSavePath(downloadPath);
      item.once("done", () => this.#reservedDownloadPaths.delete(downloadPath));
    });
  }

  #bindTabEvents(tab: InternalTab): void {
    const contents = tab.contents;
    const changed = () => this.#emitChanged();
    contents.on("close", () => {
      tab.closing = true;
    });
    contents.once("destroyed", () => {
      // Finish native destruction before removing the view and draining queued work.
      setImmediate(() => {
        void this.close(tab.id).catch((error) =>
          logger.warn("Unable to clean up browser tab", { error: toLogValue(error) }),
        );
      });
    });
    let documentGeneration = 0;
    contents.on("did-frame-navigate", (_event, _url, _code, _status, isMainFrame) => {
      const generation = ++documentGeneration;
      if (!tab.engine.hasUploadDocuments()) {
        if (this.#tabs.get(tab.id) !== tab) return;
        for (const listener of this.#documentListeners) listener(tab.id, new Set());
        return;
      }
      if (this.#tabs.get(tab.id) !== tab) return;
      // Enumeration walks every frame the tab has, and it is queued on the tab, so an unresponsive
      // one stops the tab for good -- and this runs off a navigation, where no caller's deadline
      // covers it.
      void this.#enqueue(tab.id, (queuedTab, keepQueueBlocked) =>
        this.#boundEngineOperation(
          queuedTab,
          queuedTab.engine.documentIds(),
          DOCUMENT_ENUMERATION_TIMEOUT_MS,
          "Browser document enumeration timed out.",
          keepQueueBlocked,
        ),
      )
        .then((documentIds) => {
          if (generation !== documentGeneration || this.#tabs.get(tab.id) !== tab) return;
          for (const listener of this.#documentListeners) listener(tab.id, documentIds);
        })
        .catch((error) => {
          // The empty set below tells the upload staging that the documents holding its files are
          // gone, and it deletes them. A timeout does not say that: it says the frames were never
          // asked, so completeness could not be established and the files have to stand.
          if (isTimeoutError(error)) return;
          if (!isMainFrame || generation !== documentGeneration || this.#tabs.get(tab.id) !== tab) return;
          for (const listener of this.#documentListeners) listener(tab.id, new Set());
        });
    });
    contents.on("before-input-event", (event, input) => {
      if (isToggleDevToolsShortcut(input)) {
        event.preventDefault();
        this.#window.webContents.toggleDevTools();
        return;
      }
      if (isGlobalSearchShortcut(input)) {
        event.preventDefault();
        this.#window.webContents.focus();
        const modifiers: Array<"meta" | "control"> = [input.meta ? "meta" : "control"];
        this.#window.webContents.sendInputEvent({ type: "keyDown", keyCode: "K", modifiers });
        this.#window.webContents.sendInputEvent({ type: "keyUp", keyCode: "K", modifiers });
        return;
      }
      if (isCollapseBrowserShortcut(input)) {
        // Deliberately no `preventDefault()`: `before-input-event` is synchronous and says nothing
        // about what has focus, so the page keeps the key and the decision is made after asking it.
        // A page that closes its own dialog on Escape does that as well as collapsing the panel.
        this.#collapseOnEscape(tab);
        return;
      }
      if (!isCloseBrowserTabShortcut(input)) return;
      event.preventDefault();
      setImmediate(() => void this.close(tab.id).catch(() => undefined));
    });
    contents.on("context-menu", (event, params) => {
      const items = browserContextMenuItems({
        selectionText: params.selectionText,
        isEditable: params.isEditable,
        linkURL: params.linkURL,
        srcURL: params.srcURL,
        mediaType: params.mediaType,
      });
      if (items.length === 0) return;
      event.preventDefault();
      const window = this.#mountedViews.get(tab.view);
      if (!window || window.isDestroyed()) return;
      // The edit entries name the page explicitly rather than taking an Electron role: a role acts
      // on whichever contents hold focus when the item is picked, and the right-click that opened
      // the menu may have landed on a page the user had not focused.
      const onPage = (act: (target: WebContents) => void) => () => {
        if (!contents.isDestroyed()) act(contents);
      };
      Menu.buildFromTemplate(
        items.map((item) => {
          if (item === "separator") return { type: "separator" } as const;
          if (item === "copy-link") return { label: "Copy Link", click: () => clipboard.writeText(params.linkURL) };
          if (item === "copy-image-address")
            return { label: "Copy Image Address", click: () => clipboard.writeText(params.srcURL) };
          if (item === "cut") return { label: "Cut", click: onPage((target) => target.cut()) };
          if (item === "copy") return { label: "Copy", click: onPage((target) => target.copy()) };
          if (item === "paste") return { label: "Paste", click: onPage((target) => target.paste()) };
          return { label: "Select All", click: onPage((target) => target.selectAll()) };
        }),
      ).popup({ window });
    });
    contents.on("did-start-loading", changed);
    contents.on("dom-ready", () => {
      // Keep page content at the same width when the viewport scrollbar appears or disappears.
      // Navigation replaces the document, so each new document needs the stylesheet.
      void contents.insertCSS(":where(html) { scrollbar-gutter: stable; }").catch(() => undefined);
    });
    contents.on("did-stop-loading", () => {
      if (tab.closing || contents.isDestroyed()) return;
      changed();
      void this.#syncViewBackground(tab);
    });
    contents.on("console-message", (...eventArgs) => {
      if (this.#takeoverTabIds.has(tab.id) || tab.secret) return;
      const details = readConsoleMessage(eventArgs);
      if (!details) return;
      tab.diagnostics.add({
        kind: "console",
        level: details.level,
        message: details.message.slice(0, 2_000),
        url: diagnosticUrl(details.sourceId),
      });
      if (details.level === "error") this.#emitChanged();
    });
    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || tab.secret) return;
      tab.diagnostics.add({
        kind: "load",
        level: "error",
        message: `${code}: ${description}`,
        url: diagnosticUrl(url),
      });
      this.#emitChanged();
    });
    contents.on("page-title-updated", changed);
    contents.on("did-navigate", (_event, url) => {
      if (tab.secret?.submitted) {
        tab.secret.replaced = true;
        if (!tab.secret.running) {
          contents.navigationHistory.clear();
          tab.secret = undefined;
          this.#syncAttachedView();
          tab.diagnostics.clearDiagnostics();
        }
      }
      if (this.#tabs.get(tab.id) !== tab) return;
      if (isPersistableBrowserUrl(url)) tab.requestedUrl = persistentBrowserUrl(url);
      tab.revision += 1;
      changed();
      this.#schedulePersist();
    });
    contents.on("did-navigate-in-page", (_event, url) => {
      if (this.#tabs.get(tab.id) !== tab) return;
      if (isPersistableBrowserUrl(url)) tab.requestedUrl = persistentBrowserUrl(url);
      tab.revision += 1;
      changed();
      this.#schedulePersist();
    });
    contents.on("will-navigate", (event, url) => {
      if (!isAllowedMainUrl(url)) event.preventDefault();
    });
    contents.on("will-redirect", (event) => {
      if (!event.isMainFrame) return;
      if (!isAllowedMainUrl(event.url)) event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url, referrer, postBody, disposition }) => {
      if (this.#destroyPromise || this.#tabs.get(tab.id) !== tab) return { action: "deny" };
      const unsupported = !["foreground-tab", "background-tab", "new-window"].includes(disposition);
      const failure = tab.secret
        ? "Popups are blocked during secure input. Finish or cancel secure input, then retry from the page."
        : unsupported
          ? "This popup type is not supported. Use a normal link or sign-in button on the page."
          : !isAllowedMainUrl(url)
            ? "This popup uses an unsupported address. Use an HTTP or HTTPS sign-in option on the page."
            : !this.#hasTabCapacity(tab.ownerThreadId, tab.ownerAgentId)
              ? "The browser tab limit was reached. Close a tab, then retry from the page."
              : undefined;
      if (failure) {
        tab.popupFailure = { id: randomUUID(), message: failure };
        this.#emitChanged();
        return { action: "deny" };
      }
      // Electron supplies the opener preferences and navigates the returned contents itself.
      // Reopening the URL loses WindowProxy, POST bodies, and OAuth callback messages.
      let popup: InternalTab | undefined;
      return {
        action: "allow",
        // The host owns cleanup. Electron otherwise destroys children on opener reload too.
        outlivesOpener: true,
        overrideBrowserWindowOptions: {
          webPreferences: { ...BROWSER_WEB_PREFERENCES, session: this.#session },
        },
        createWindow: (options) => {
          if (popup) return popup.contents;
          popup = this.#createTab(
            randomUUID(),
            url,
            tab.ownerThreadId,
            tab.ownerAgentId,
            structuredClone(tab.environment),
            options,
          );
          // Chromium exposes no opener for noopener/noreferrer requests.
          if (options.webContents?.opener) popup.openerTabId = tab.id;
          this.#tabs.set(popup.id, popup);
          this.#bindTabEvents(popup);
          tab.popupFailure = undefined;
          this.#activeTabId = popup.id;
          popup.focusOnVisible = true;
          this.#syncAttachedView();
          this.#emitChanged();
          this.#schedulePersist();
          const created = popup;
          created.queue = created.engine.setEnvironment(created.environment).catch((error) => {
            logger.warn("Unable to apply popup environment", { error: toLogValue(error) });
          });
          // Links without a native guest need an explicit load; native guests already own
          // their navigation, including POST data and the opener WindowProxy.
          if (!options.webContents) {
            void created.contents
              .loadURL(url, {
                httpReferrer: referrer,
                ...(postBody
                  ? {
                      postData: postBody.data,
                      extraHeaders: `content-type: ${postBody.contentType}${postBody.boundary ? `; boundary=${postBody.boundary}` : ""}`,
                    }
                  : {}),
              })
              .catch(() => {
                if (this.#tabs.get(tab.id) !== tab) return;
                tab.popupFailure = {
                  id: randomUUID(),
                  message: "The popup could not load. Retry sign-in from the original page.",
                };
                this.#emitChanged();
              });
          }
          return created.contents;
        },
      };
    });
  }

  /**
   * Forward Escape from an embedded page to the renderer, which collapses the expanded browser back
   * to the preview sidebar. Only the visible page in the main window does this: in Picture in
   * Picture the page has a window of its own, and forwarding would focus the main window behind it
   * and run the renderer's Escape handler, which cancels a queued message edit and discards what
   * that edit added.
   *
   * A text field in the page keeps the key instead, so Escape still clears a combo box or cancels an
   * inline edit. `EDITABLE_FOCUS_SCRIPT` decides that, and it goes to the focused frame rather than
   * to the top document, where `document.activeElement` is the iframe element and not the editor
   * inside it. Anything but a definite "not editable" - a frame that went away, a page that refuses
   * to answer - leaves the key with the page, which is the harmless half of the choice. The focused
   * element is read with `executeJavaScript`, which gives the page no capability it does not already
   * have; a preload or a permanent debugger attach would answer synchronously but weaken the
   * sandboxed view or fight the automation recorder.
   */
  #collapseOnEscape(tab: InternalTab): void {
    if (!this.#collapsesOnEscape(tab)) return;
    const frame = tab.contents.focusedFrame ?? tab.contents.mainFrame;
    if (!frame || frame.isDestroyed()) return;
    void frame
      .executeJavaScript(EDITABLE_FOCUS_SCRIPT, true)
      .then((editable) => {
        // The page answers a frame later, by which time the panel can have collapsed, changed tab,
        // or moved to Picture in Picture.
        if (editable !== false) return;
        if (!this.#collapsesOnEscape(tab) || this.#window.isDestroyed()) return;
        this.#window.webContents.focus();
        this.#window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
        this.#window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      })
      .catch(() => undefined);
  }

  /** Whether this tab is the page the expanded browser shows in the main window. */
  #collapsesOnEscape(tab: InternalTab): boolean {
    return this.#target === "main" && this.#visible && this.#activeTabId === tab.id && this.#attachedView === tab.view;
  }

  async #syncViewBackground(tab: InternalTab): Promise<void> {
    try {
      const background = await tab.contents.executeJavaScript(
        `(() => {
          const transparent = "rgba(0, 0, 0, 0)";
          const body = document.body ? getComputedStyle(document.body).backgroundColor : transparent;
          if (body !== transparent) return body;
          const root = getComputedStyle(document.documentElement).backgroundColor;
          return root !== transparent ? root : "#0b0b0b";
        })()`,
        true,
      );
      if (isString(background)) tab.view.setBackgroundColor(background);
    } catch {
      // Navigation can replace the document before its background is read.
    }
  }

  async #readSnapshot(
    tab: InternalTab,
    revision: number,
    keepQueueBlocked: KeepQueueBlocked,
    timeoutMs = 10_000,
    timeoutMessage = "Browser snapshot timed out.",
  ): Promise<SnapshotReadResult> {
    const history = tab.diagnostics.snapshot();
    const completion = tab.engine.snapshot({
      tabId: tab.id,
      revision,
      environment: tab.environment,
      diagnostics: history.diagnostics,
      actions: history.actions,
    });
    // A snapshot walks every frame, so it is one of the engine operations a single unresponsive
    // renderer can hold open forever.
    const result = await this.#boundEngineOperation(tab, completion, timeoutMs, timeoutMessage, keepQueueBlocked);
    tab.revision = revision;
    return result;
  }

  /**
   * Bounds an engine operation in wall-clock time and unwinds what it left behind. Electron's
   * `sendCommand` carries no timeout of its own and the engine's own deadlines are checked between
   * commands, so a frame whose renderer never answers leaves the operation pending forever however
   * short a deadline it was given. Returning a timeout to the caller is not enough on its own: the
   * queue waits on every promise given to `keepQueueBlocked`, so a command left outstanding means
   * nothing on this tab ever runs again -- navigation, takeover, close and host shutdown all queue
   * behind that drain.
   */
  #boundEngineOperation<T>(
    tab: InternalTab,
    completion: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
    keepQueueBlocked: KeepQueueBlocked,
  ): Promise<T> {
    let unwound: Promise<void> | undefined;
    const bounded = withTimeout(completion, timeoutMs, timeoutMessage).catch((error) => {
      if (isTimeoutError(error)) unwound = this.#unwindStalledOperation(tab, completion);
      throw error;
    });
    keepQueueBlocked(Promise.allSettled([bounded]).then(() => unwound));
    return bounded;
  }

  /**
   * Gives an operation that missed its deadline a moment to unwind, and detaches the debugger if it
   * will not. Detaching is the only cancellation primitive there is, and it is a blunt one: it takes
   * the whole session down, so a command still in flight when the next one attaches over the top of it
   * fails with `target closed while handling command` -- one operation away from the timeout that
   * caused it. Most timeouts do not need it at all, because a deadline shorter than the page is the
   * ordinary case and a live renderer answers what is outstanding in a few milliseconds. So the wait
   * comes first, the detach only if the wait expires, and a second wait after it, so the queue
   * advances into an attached debugger rather than one being torn down. When the recorder holds the
   * debugger there is nothing to detach and the wait stands, because the command really is still
   * outstanding.
   */
  async #unwindStalledOperation(tab: InternalTab, completion: Promise<unknown>): Promise<void> {
    const settled = Promise.allSettled([completion]);
    if (await finishesWithin(settled, OPERATION_UNWIND_GRACE_MS)) return;
    if (!tab.engine.cancelPendingCommands()) {
      await settled;
      return;
    }
    await finishesWithin(settled, OPERATION_UNWIND_GRACE_MS);
  }

  async #runAction(
    tabId: string,
    action: string,
    target: BrowserTarget | undefined,
    operation: (tab: InternalTab, deadline: number, markDispatched: () => void) => Promise<void>,
    timeoutMs = 10_000,
    onOperationStarted?: (completion: Promise<void>) => void,
  ): Promise<BrowserSnapshot | { tabId: string; closed: true; openerTabId?: string }> {
    const tab = this.#requireTab(tabId);
    const started = tab.queue.then(() => {
      if (tab.secret) throw new Error("Browser inspection is protected during authentication. Use takeover.");
      const focusedContents = webContents.getFocusedWebContents();
      const previouslyFocused =
        focusedContents && ![...this.#tabs.values()].some((candidate) => candidate.contents === focusedContents)
          ? focusedContents
          : null;
      const deadline = Date.now() + timeoutMs;
      const timeoutMessage = `Browser ${action} timed out.`;
      const snapshotDrains: Promise<unknown>[] = [];
      let stalledSettle: Promise<void> | undefined;
      let actionRecorded = false;
      let dispatched = false;
      let cancellationConfirmed = false;
      const operationCompletion = (async () => {
        let highlighted = false;
        try {
          tab.contents.focus();
          if (target && target.kind !== "point") {
            highlighted = await tab.engine.highlight(target).then(
              () => true,
              () => false,
            );
          }
          remainingTime(deadline, timeoutMessage);
          await operation(tab, deadline, () => {
            dispatched = true;
          });
        } finally {
          if (highlighted && !cancellationConfirmed) await tab.engine.hideHighlight().catch(() => undefined);
        }
      })();
      onOperationStarted?.(operationCompletion);
      const boundedOperation = withTimeout(
        operationCompletion,
        Math.max(0, deadline - Date.now()) + OPERATION_DEADLINE_BACKSTOP_MS,
        timeoutMessage,
      ).catch(async (error) => {
        if (!isTimeoutError(error)) throw error;
        cancellationConfirmed = tab.engine.cancelPendingCommands();
        if (dispatched && !cancellationConfirmed) await operationCompletion;
        throw error;
      });
      const response = boundedOperation
        .then(async () => {
          const settleTimeout = Math.max(1, deadline - Date.now());
          const settleCompletion = tab.engine.settle(settleTimeout);
          try {
            // Settling bounds its own waiting with timers, but the commands it sends to each frame are
            // not bounded by them, so an unresponsive frame holds the action's response open and the
            // queue with it.
            await withTimeout(settleCompletion, settleTimeout, timeoutMessage);
          } catch (error) {
            if (!isTimeoutError(error)) throw error;
            // The settle may still be waiting on a frame that never answers, and unwinding it can go
            // as far as detaching the debugger -- which the post-dispatch snapshot below is about to
            // use. So the unwind is left to the drain, once the rest of the action has finished with
            // the session.
            stalledSettle = settleCompletion;
            if (tab.contents.isLoading()) await tab.engine.stopLoading().catch(() => undefined);
          }
          tab.diagnostics.action({
            action,
            target: target ? describeBrowserTarget(target) : undefined,
            outcome: "success",
            ...(Date.now() >= deadline
              ? { detail: "Action completed; page settling exceeded the requested timeout." }
              : {}),
          });
          actionRecorded = true;
          const snapshot = (
            await this.#readSnapshot(
              tab,
              tab.revision + 1,
              (promise) => snapshotDrains.push(promise),
              ACTION_POST_DISPATCH_TIMEOUT_MS,
              timeoutMessage,
            )
          ).snapshot;
          return snapshot;
        })
        .catch((error) => {
          if (dispatched && (tab.closing || tab.contents.isDestroyed())) {
            return {
              tabId: tab.id,
              closed: true as const,
              ...(tab.openerTabId ? { openerTabId: tab.openerTabId } : {}),
            };
          }
          if (!actionRecorded) {
            tab.diagnostics.action({
              action,
              target: target ? describeBrowserTarget(target) : undefined,
              outcome: "error",
              detail: String(error).slice(0, 2_000),
            });
          }
          throw error;
        })
        .finally(() => {
          if (!tab.closing) restoreWebContentsFocus(previouslyFocused, tab.contents);
        });
      snapshotDrains.push(
        Promise.allSettled([response]).then(() =>
          stalledSettle ? this.#unwindStalledOperation(tab, stalledSettle) : undefined,
        ),
      );
      const drained = Promise.allSettled([response])
        .then(() =>
          cancellationConfirmed ? undefined : Promise.allSettled([operationCompletion]).then(() => undefined),
        )
        .then(() =>
          !tab.closing && !tab.contents.isDestroyed() && tab.contents.isLoading()
            ? tab.engine.stopLoading().catch(() => undefined)
            : undefined,
        )
        .then(() => Promise.allSettled(snapshotDrains))
        .then(() => undefined);
      return { drained, response };
    });
    const result = started.then(({ response }) => response);
    tab.queue = started.then(
      ({ drained }) => drained,
      () => undefined,
    );
    return result;
  }

  async #runEvaluation(
    tabId: string,
    expression: string,
    awaitPromise: boolean,
    timeoutMs: number,
  ): Promise<BrowserJsonValue> {
    const tab = this.#requireTab(tabId);
    const started = tab.queue.then(() => {
      if (tab.secret) throw new Error("Browser inspection is protected during authentication. Use takeover.");
      const deadline = Date.now() + timeoutMs;
      const timeoutMessage = "Browser evaluate timed out.";
      let unwound: Promise<void> | undefined;
      const operationCompletion = tab.engine.evaluate(
        expression,
        awaitPromise,
        remainingTime(deadline, timeoutMessage),
      );
      // `awaitPromise` is what CDP's own execution timeout does not bound: an expression evaluating
      // to a promise the page never settles leaves the command pending forever, and `drained` waits
      // on that promise, so the tab's queue never advances -- which would also block takeover, close
      // and shutdown.
      const boundedOperation = withTimeout(
        operationCompletion,
        remainingTime(deadline, timeoutMessage),
        timeoutMessage,
      ).catch((error) => {
        if (isTimeoutError(error)) unwound = this.#unwindStalledOperation(tab, operationCompletion);
        throw error;
      });
      const response = boundedOperation
        .then(async (value) => {
          const settleTimeout = remainingTime(deadline, timeoutMessage);
          // Same unbounded commands as the action path settles through; the evaluation itself has
          // already returned here, so unwinding this one only releases the drain sooner.
          const settleCompletion = tab.engine.settle(settleTimeout);
          await withTimeout(settleCompletion, settleTimeout, timeoutMessage).catch((error) => {
            if (isTimeoutError(error)) unwound = this.#unwindStalledOperation(tab, settleCompletion);
            throw error;
          });
          tab.diagnostics.action({ action: "evaluate", outcome: "success" });
          return value;
        })
        .catch((error) => {
          tab.diagnostics.action({
            action: "evaluate",
            outcome: "error",
            detail: String(error).slice(0, 2_000),
          });
          throw error;
        });
      const drained = Promise.allSettled([response])
        .then(() => unwound ?? Promise.allSettled([operationCompletion]).then(() => undefined))
        .then(() => undefined);
      return { drained, response };
    });
    const result = started.then(({ response }) => response);
    tab.queue = started.then(
      ({ drained }) => drained,
      () => undefined,
    );
    return result;
  }

  #snapshotResult(result: SnapshotReadResult, mode: BrowserImageMode, imageUrl: string | null): DynamicToolResult {
    if (!imageUrl) return textResult(result.snapshot);
    result.snapshot.image = {
      included: true,
      reason: mode === "always" ? "requested" : result.imageReason,
      width: result.snapshot.viewport.width,
      height: result.snapshot.viewport.height,
    };
    return {
      success: true,
      contentItems: [
        { type: "inputText", text: JSON.stringify(result.snapshot) },
        { type: "inputImage", imageUrl },
      ],
    };
  }

  #syncAttachedView(): void {
    const tab = this.#activeTabId ? this.#tabs.get(this.#activeTabId) : null;
    const targetWindow = this.#target === "picture-in-picture" ? this.#pictureInPictureWindow : this.#window;
    if (
      !this.#visible ||
      !this.#bounds ||
      !tab ||
      tab.closing ||
      tab.contents.isDestroyed() ||
      (tab.secret?.submitted && !this.#takeoverTabIds.has(tab.id)) ||
      !targetWindow ||
      targetWindow.isDestroyed()
    ) {
      this.#attachedView?.setVisible(false);
      return;
    }

    if (this.#attachedView !== tab.view) {
      this.#attachedView?.setVisible(false);
      this.#mountView(tab.view, targetWindow);
      this.#attachedView = tab.view;
    } else {
      this.#mountView(tab.view, targetWindow);
    }
    // Native views are not clipped by the renderer, so the radius has to be set here. Every
    // surface the page can occupy is square: the expanded panel is full bleed against the window
    // edges, and Picture in Picture has always been square.
    tab.view.setBorderRadius(0);
    // Renderer bounds are CSS pixels; native child views use device-independent window pixels.
    const zoomFactor = targetWindow.webContents.getZoomFactor();
    tab.view.setBounds(
      validateBounds({
        x: this.#bounds.x * zoomFactor,
        y: this.#bounds.y * zoomFactor,
        width: this.#bounds.width * zoomFactor,
        height: this.#bounds.height * zoomFactor,
      }),
    );
    tab.view.setVisible(true);
    tab.contents.invalidate();
    this.#raisePictureInPictureOverlay();
    if (tab.focusOnVisible) {
      tab.focusOnVisible = false;
      tab.contents.focus();
    }
  }

  #raisePictureInPictureOverlay(): void {
    const overlay = this.#pictureInPictureOverlayView;
    const window = this.#pictureInPictureWindow;
    if (this.#target !== "picture-in-picture" || !overlay || !window || window.isDestroyed()) return;
    window.contentView.removeChildView(overlay);
    window.contentView.addChildView(overlay);
  }

  #focusTab(tab: InternalTab): void {
    if (
      this.#tabs.get(tab.id) !== tab ||
      this.#activeTabId !== tab.id ||
      !tab.view.getVisible() ||
      tab.contents.isDestroyed()
    ) {
      return;
    }
    tab.contents.focus();
  }

  #mountView(view: WebContentsView, window = this.#window): void {
    const currentWindow = this.#mountedViews.get(view);
    if (currentWindow === window) {
      window.contentView.addChildView(view);
      return;
    }
    if (currentWindow && !currentWindow.isDestroyed()) currentWindow.contentView.removeChildView(view);
    window.contentView.addChildView(view);
    // Initialize the native viewport before hiding a tab that has never been shown.
    view.setVisible(true);
    view.setBounds({ x: 0, y: 0, width: 1200, height: 800 });
    view.setVisible(false);
    this.#mountedViews.set(view, window);
  }

  #unmountView(view: WebContentsView): void {
    view.setVisible(false);
    const window = this.#mountedViews.get(view);
    if (window && !window.isDestroyed()) window.contentView.removeChildView(view);
    this.#mountedViews.delete(view);
    if (this.#attachedView === view) this.#attachedView = null;
  }

  #requireTab(tabId: string): InternalTab {
    const tab = this.#tabs.get(tabId);
    if (!tab) throw new Error(`Unknown browser tab: ${tabId}`);
    return tab;
  }

  #requireToolTab(params: DynamicToolCallParams, tabId: string): void {
    const tab = this.listTabs().find((candidate) => candidate.id === tabId);
    if (!tab || !this.#canUseToolTab(params, tab)) throw new Error(`Unknown browser tab: ${tabId}`);
    // The user holds this tab. `AgentService` already refuses an agent's browser tools while its own
    // takeover is outstanding, but that check is agent-wide and only covers callers that go through
    // the agent service; this one is per tab and holds for every caller of a tabId-bearing tool.
    // A distinct message matters: telling the model the tab vanished, while the user is part-way
    // through a login on it, invites an `open` and a second tab onto the same flow.
    if (this.#tabs.get(tabId)?.secret)
      throw new Error("Browser inspection is protected during authentication. Use takeover.");
    if (this.#takeoverTabIds.has(tabId)) throw new Error(`Browser tab is under user takeover: ${tabId}`);
  }

  #canUseToolTab(params: DynamicToolCallParams, tab: BrowserTab): boolean {
    return (
      tab.ownerThreadId === params.threadId &&
      (tab.ownerAgentId === null || tab.ownerAgentId === (params.ownerAgentId ?? null))
    );
  }

  #enqueue<T>(
    tabId: string,
    operation: (tab: InternalTab, keepQueueBlocked: KeepQueueBlocked) => Promise<T>,
    allowProtected = false,
  ): Promise<T> {
    const tab = this.#requireTab(tabId);
    const started = tab.queue.then(() => {
      if (tab.secret?.submitted && !allowProtected)
        throw new Error("Browser inspection is protected during authentication. Use takeover.");
      const drains: Promise<unknown>[] = [];
      const result = operation(tab, (promise) => drains.push(promise));
      const drained = result
        .catch(() => undefined)
        .then(() => Promise.allSettled(drains))
        .then(() => undefined);
      return { drained, result };
    });
    const result = started.then(({ result }) => result);
    tab.queue = started.then(
      ({ drained }) => drained,
      () => undefined,
    );
    return result;
  }

  #emitChanged(): void {
    const tabs = this.listTabs();
    for (const listener of this.#listeners) listener(tabs, this.#activeTabId);
  }

  #beginControl(params: DynamicToolCallParams, call: BrowserToolCall): void {
    const id = controlSessionId(params.threadId, params.turnId);
    const timer = this.#controlTimers.get(id);
    if (timer) clearTimeout(timer);
    this.#controlTimers.delete(id);
    const previous = this.#controlSessions.get(id);
    this.#controlSessions.set(id, {
      id,
      threadId: params.threadId,
      turnId: params.turnId,
      callId: params.callId,
      tabId: "tabId" in call.args ? call.args.tabId : null,
      action: browserControlAction(call),
      detailAction: browserControlDetailAction(params.tool),
      phase: "acting",
      startedAt: previous?.startedAt ?? new Date().toISOString(),
    });
    this.#emitControlChanged();
  }

  #finishControl(params: DynamicToolCallParams): void {
    const id = controlSessionId(params.threadId, params.turnId);
    const current = this.#controlSessions.get(id);
    if (!current || current.callId !== params.callId) return;
    this.#controlSessions.set(id, { ...current, phase: "waiting" });
    this.#emitControlChanged();
    const timer = setTimeout(() => {
      this.#controlTimers.delete(id);
      const latest = this.#controlSessions.get(id);
      if (!latest || latest.callId !== params.callId || latest.phase !== "waiting") return;
      this.#controlSessions.delete(id);
      this.#emitControlChanged();
    }, BrowserHost.CONTROL_IDLE_GRACE_MS);
    timer.unref();
    this.#controlTimers.set(id, timer);
  }

  #updateControlTab(params: DynamicToolCallParams, tabId: string): void {
    const id = controlSessionId(params.threadId, params.turnId);
    const current = this.#controlSessions.get(id);
    if (!current || current.callId !== params.callId) return;
    this.#controlSessions.set(id, { ...current, tabId });
    this.#emitControlChanged();
  }

  #emitControlChanged(): void {
    const state = this.getControlState();
    for (const listener of this.#controlListeners) listener(state);
  }

  #schedulePersist(): void {
    void this.#persistState().catch((error) => {
      logger.error("Unable to persist browser tabs:", toLogValue(error));
    });
  }

  #persistState(): Promise<void> {
    const state: StoredBrowserStateV2 = {
      version: 2,
      activeTabId: this.#activeTabId,
      tabs: [...this.#tabs.values()]
        .filter((tab) => !tab.closing && !tab.contents.isDestroyed())
        .map((tab) => ({
          id: tab.id,
          url: tab.secret?.origin ?? persistentBrowserUrl(currentTabUrl(tab), { popup: tab.popup }),
          ownerThreadId: tab.ownerThreadId,
          ownerAgentId: tab.ownerAgentId,
          environment: tab.environment,
        })),
    };
    this.#persistQueue = this.#persistQueue
      .catch(() => undefined)
      .then(async () => {
        const temporaryPath = `${this.#statePath}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, {
            encoding: "utf8",
            mode: 0o600,
          });
          await rename(temporaryPath, this.#statePath);
        } finally {
          await rm(temporaryPath, { force: true }).catch(() => undefined);
        }
      });
    return this.#persistQueue;
  }
}

function controlSessionId(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`;
}

function restoreWebContentsFocus(previous: WebContents | null, controlled: WebContents): void {
  const current = webContents.getFocusedWebContents();
  if (current && current !== controlled) return;
  if (previous && !previous.isDestroyed()) {
    const window = BrowserWindow.fromWebContents(previous);
    if (window && !window.isDestroyed()) window.focus();
    previous.focus();
  }
}

function browserControlAction(call: BrowserToolCall): BrowserControlAction {
  switch (call.tool) {
    case "open":
      return "open";
    case "list_tabs":
      return "list-tabs";
    case "snapshot":
      return "snapshot";
    case "screenshot":
      return "screenshot";
    case "close_tab":
      return "close-tab";
    case "status":
      return "list-tabs";
    case "navigate":
      if (call.args.direction === "back") return "back";
      if (call.args.direction === "forward") return "forward";
      if (call.args.direction === "reload") return "reload";
      return "open";
    case "click":
      return "click";
    case "type":
      return "type";
    case "press":
      return "key";
    case "hover":
      return "click";
    case "scroll":
      return "scroll";
    case "select_option":
      return "click";
    case "set_checked":
      return "click";
    case "drag":
      return "click";
    case "upload_files":
      return "type";
    case "wait_for":
      return "snapshot";
    case "evaluate":
      return "snapshot";
    case "set_environment":
      return "snapshot";
    case "recording_start":
      return "screenshot";
    case "recording_stop":
      return "screenshot";
    case "act":
      return call.args.action.type;
    default:
      return "snapshot";
  }
}

function browserControlDetailAction(tool: string): BrowserControlDetailAction | undefined {
  switch (tool) {
    case "status":
    case "navigate":
    case "press":
    case "hover":
    case "drag":
      return tool;
    case "select_option":
      return "select-option";
    case "set_checked":
      return "set-checked";
    case "upload_files":
      return "upload-files";
    case "wait_for":
      return "wait-for";
    case "evaluate":
      return "evaluate";
    case "set_environment":
      return "set-environment";
    case "recording_start":
      return "recording-start";
    case "recording_stop":
      return "recording-stop";
    default:
      return undefined;
  }
}

function normalizeBrowserUrl(input: string): string {
  const value = input.trim();
  if (!value) throw new Error("A browser URL is required.");
  if (value.length > INPUT_LIMITS.browserUrl) throw new Error("The browser URL is too long.");
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP(S) browser URLs are allowed.");
  }
  return url.toString();
}

function browserLoadOptions(): { extraHeaders: string } {
  return { extraHeaders: "Cache-Control: no-cache\nPragma: no-cache" };
}

function browserRequestHeaders(url: string, requestHeaders: Record<string, string>): Record<string, string> {
  const headers = applySiteIdentity(url, requestHeaders);
  setRequestHeader(headers, "Accept-Language", preferredBrowserLanguages());
  return headers;
}

function preferredBrowserLanguages(): string {
  return preferredBrowserLanguageCodes()
    .split(",")
    .map((language, index) => (index === 0 ? language : `${language};q=${Math.max(1 - index * 0.1, 0.1).toFixed(1)}`))
    .join(",");
}

function preferredBrowserLanguageCodes(): string {
  const languages = app.getPreferredSystemLanguages();
  return (languages.length > 0 ? languages : [app.getLocale()]).join(",");
}

function setRequestHeader(headers: Record<string, string>, name: string, value: string): void {
  const existingName = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  if (existingName && existingName !== name) delete headers[existingName];
  headers[name] = value;
}

async function readBrowserState(path: string): Promise<StoredBrowserStateV2> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed) || (parsed.version !== 1 && parsed.version !== 2)) {
      return { version: 2, activeTabId: null, tabs: [] };
    }
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs
          .map(storedBrowserTab)
          .filter((tab) => tab !== null)
          .map((tab) => ({
            ...tab,
            url: persistentBrowserUrl(tab.url),
            // A v1 file never wrote an environment, so anything sitting under that key in one is not
            // ours to trust -- the tab starts from the default instead.
            environment: (parsed.version === 2 ? tab.environment : undefined) ?? defaultBrowserEnvironment(),
          }))
      : [];
    return {
      version: 2,
      activeTabId: isString(parsed.activeTabId) ? parsed.activeTabId : null,
      tabs: tabs.filter((tab, index) => tabs.findIndex((candidate) => candidate.id === tab.id) === index),
    };
  } catch (error) {
    if (isMissingFile(error) || error instanceof SyntaxError) {
      return { version: 2, activeTabId: null, tabs: [] };
    }
    throw error;
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAllowedMainUrl(value: string): boolean {
  return value === "about:blank" || isPersistableBrowserUrl(value);
}

/**
 * The embedded browser grants exactly one page permission: writing plain, sanitized content to the
 * clipboard. Chromium only asks for it behind a user gesture, which is what a page's own "copy
 * link" button is, and refusing it left such a button silently doing nothing. Reading the clipboard
 * stays refused -- a page must never see what the user copied elsewhere -- and so does everything
 * else, so camera, microphone, location and notifications are unchanged.
 */
function isAllowedBrowserPermission(permission: string): boolean {
  return permission === "clipboard-sanitized-write";
}

/**
 * The host of a tab's URL, for a log line. `diagnosticUrl` below keeps the path, which is right for a
 * diagnostic the user reads back in the app but wrong for a log: a path carries tokens often enough
 * (`/reset/<secret>`, `/invite/<secret>`) that writing one to disk breaks the redaction rule. The host
 * is enough to tell which tab an agent closed.
 */
function logUrlHost(value: string): string | undefined {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function diagnosticUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, INPUT_LIMITS.browserUrl);
  } catch {
    return undefined;
  }
}

function validateBounds(bounds: BrowserBounds): BrowserBounds {
  if (!Object.values(bounds).every(Number.isFinite)) throw new Error("Invalid browser bounds.");
  return {
    x: Math.max(0, Math.min(INPUT_LIMITS.browserCoordinate, Math.floor(bounds.x))),
    y: Math.max(0, Math.min(INPUT_LIMITS.browserCoordinate, Math.floor(bounds.y))),
    width: Math.max(1, Math.min(INPUT_LIMITS.browserDimension, Math.ceil(bounds.width))),
    height: Math.max(1, Math.min(INPUT_LIMITS.browserDimension, Math.ceil(bounds.height))),
  };
}

function toPublicTab(tab: InternalTab): BrowserTab {
  const environment =
    tab.environment.viewport.mode === "fill"
      ? {
          ...tab.environment,
          viewport: {
            ...tab.environment.viewport,
            width: tab.view.getBounds().width,
            height: tab.view.getBounds().height,
          },
        }
      : tab.environment;
  return {
    id: tab.id,
    title: tab.secret ? "Secure authentication" : tab.contents.getTitle() || "New tab",
    url: tab.secret?.origin ?? currentTabUrl(tab),
    loading: tab.contents.isLoading(),
    ownerThreadId: tab.ownerThreadId,
    ownerAgentId: tab.ownerAgentId,
    environment,
    recording: tab.recording,
    diagnosticErrorCount: tab.diagnostics.errorCount,
    ...(tab.openerTabId ? { openerTabId: tab.openerTabId } : {}),
    ...(tab.popupFailure ? { popupFailure: tab.popupFailure } : {}),
  };
}

function currentTabUrl(tab: InternalTab): string {
  const currentUrl = tab.contents.getURL();
  return isPersistableBrowserUrl(currentUrl) ? currentUrl : tab.requestedUrl;
}

function readConsoleMessage(args: unknown[]): BrowserConsoleMessageDetails | null {
  const modern = args[1];
  if (
    isRecord(modern) &&
    (modern.level === "info" || modern.level === "warning" || modern.level === "error" || modern.level === "debug") &&
    isString(modern.message) &&
    isString(modern.sourceId)
  ) {
    return { level: modern.level, message: modern.message, sourceId: modern.sourceId };
  }
  const level = args[1];
  const message = args[2];
  const sourceId = args[4];
  if (!isNumber(level) || !isString(message)) return null;
  return {
    level: level >= 3 ? "error" : level === 2 ? "warning" : level === 0 ? "debug" : "info",
    message,
    sourceId: isString(sourceId) ? sourceId : "",
  };
}

function resolveEnvironment(
  value: BrowserToolArguments<"set_environment">,
  current: BrowserEnvironment,
  bounds: BrowserBounds,
): BrowserEnvironment {
  const preset = value.preset;
  const presetSize = presetDimensions(preset);
  const explicitScale = value.deviceScaleFactor !== undefined;
  const scaleConvertsFill =
    explicitScale && (preset === "fill" || (preset === undefined && current.viewport.mode === "fill"));
  const requestedWidth =
    value.width ??
    presetSize?.width ??
    (preset === "fill" || scaleConvertsFill ? bounds.width : current.viewport.width);
  const requestedHeight =
    value.height ??
    presetSize?.height ??
    (preset === "fill" || scaleConvertsFill ? bounds.height : current.viewport.height);
  const width = Math.round(requestedWidth);
  const height = Math.round(requestedHeight);
  const mode =
    preset === "fill" && !explicitScale
      ? "fill"
      : preset || value.width !== undefined || value.height !== undefined || explicitScale
        ? "custom"
        : current.viewport.mode;
  const minimumWidth = mode === "fill" ? 1 : 320;
  const minimumHeight = mode === "fill" ? 1 : 240;
  if (
    width < minimumWidth ||
    width > INPUT_LIMITS.browserDimension ||
    height < minimumHeight ||
    height > INPUT_LIMITS.browserDimension
  ) {
    throw new Error("Viewport dimensions are outside the supported range.");
  }
  // Fill clears the device metrics override, so it cannot inherit a custom emulation scale.
  const scale =
    mode === "fill" ? 1 : (value.deviceScaleFactor ?? presetSize?.scale ?? current.viewport.deviceScaleFactor);
  if (scale < 0.5 || scale > 4) throw new Error("deviceScaleFactor must be between 0.5 and 4.");
  if (!isSafeViewportSize(width, height, scale)) {
    throw new Error(`The physical viewport must not exceed ${MAX_PHYSICAL_VIEWPORT_PIXELS.toLocaleString()} pixels.`);
  }
  const resolvedPreset =
    preset === "desktop" || preset === "tablet" || preset === "mobile"
      ? preset
      : preset === "custom" || preset === "fill"
        ? null
        : current.viewport.preset;
  return {
    viewport: {
      mode,
      width,
      height,
      deviceScaleFactor: scale,
      preset: resolvedPreset,
    },
    colorScheme: value.colorScheme ?? current.colorScheme,
    reducedMotion: value.reducedMotion ?? current.reducedMotion,
  };
}

function boundedCaptureDataUrl(image: NativeImage): string {
  const size = image.getSize();
  if (size.width <= 0 || size.height <= 0) throw new Error("Browser screenshot is empty.");
  const area = size.width * size.height;
  if (area <= MAX_ENCODED_CAPTURE_PIXELS) return image.toDataURL();
  const scale = Math.sqrt(MAX_ENCODED_CAPTURE_PIXELS / area);
  return image
    .resize({
      width: Math.max(1, Math.floor(size.width * scale)),
      height: Math.max(1, Math.floor(size.height * scale)),
      quality: "good",
    })
    .toDataURL();
}

function describeBrowserTarget(target: BrowserTarget): string {
  switch (target.kind) {
    case "ref":
      return `ref ${target.ref}@${target.revision}`;
    case "role":
      return `${target.role}${target.name ? ` “${target.name}”` : ""}`;
    case "text":
      return `text “${target.text}”`;
    case "css":
      return `css ${target.selector}`;
    case "point":
      return `point ${target.x},${target.y}`;
  }
}

function presetDimensions(preset: "fill" | "desktop" | "tablet" | "mobile" | "custom" | undefined) {
  switch (preset) {
    case "desktop":
      return { width: 1440, height: 900, scale: 1 };
    case "tablet":
      return { width: 820, height: 1180, scale: 2 };
    case "mobile":
      return { width: 390, height: 844, scale: 3 };
    default:
      return null;
  }
}

function navigateHistory(contents: WebContents, direction: BrowserNavigationDirection): boolean {
  const history = contents.navigationHistory;
  const offset = direction === "back" ? -1 : 1;
  if (!history.canGoToOffset(offset)) return false;
  const entry = history.getEntryAtIndex(history.getActiveIndex() + offset);
  if (!entry?.url) return false;
  history.goToOffset(offset);
  return true;
}

async function navigateAndWait(
  contents: WebContents,
  initiate: () => boolean | Promise<unknown>,
  timeoutMs = 10_000,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let started = false;
    let inPlace = false;
    let settled = false;
    let timedOut = false;
    let initiationPending = false;
    let timer: NodeJS.Timeout;
    const cleanup = () => {
      clearTimeout(timer);
      contents.off("did-start-navigation", didStartNavigation);
      contents.off("did-stop-loading", didStopLoading);
      contents.off("did-navigate-in-page", didNavigateInPage);
      contents.off("did-fail-load", didFailLoad);
      contents.off("destroyed", destroyed);
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const complete = () => {
      finish(timedOut ? new Error("Navigation timed out.") : undefined);
    };
    const didStartNavigation = (_event: unknown, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
      if (!isMainFrame) return;
      started = true;
      inPlace = isInPlace;
    };
    const didStopLoading = () => {
      if (started && !inPlace) complete();
    };
    const didNavigateInPage = (_event: unknown, _url: string, isMainFrame: boolean) => {
      if (started && inPlace && isMainFrame) complete();
    };
    const didFailLoad = (_event: unknown, code: number, description: string, _url: string, isMainFrame: boolean) => {
      if (!started || !isMainFrame) return;
      finish(timedOut ? new Error("Navigation timed out.") : new Error(`Navigation failed (${code}): ${description}`));
    };
    const destroyed = () => {
      finish(new Error("Browser tab was closed during navigation."));
    };
    contents.on("did-start-navigation", didStartNavigation);
    contents.on("did-stop-loading", didStopLoading);
    contents.on("did-navigate-in-page", didNavigateInPage);
    contents.on("did-fail-load", didFailLoad);
    contents.once("destroyed", destroyed);
    timer = setTimeout(() => {
      timedOut = true;
      try {
        const navigationWasActive = started || contents.isLoading();
        contents.stop();
        if (!navigationWasActive && !initiationPending) complete();
      } catch (error) {
        finish(error);
      }
    }, timeoutMs);
    timer.unref();
    try {
      const initiation = initiate();
      if (initiation === false) {
        complete();
      } else if (initiation !== true) {
        initiationPending = true;
        void initiation.then(
          () => {
            initiationPending = false;
            if (!contents.isLoading()) complete();
          },
          (error) => {
            initiationPending = false;
            finish(timedOut ? new Error("Navigation timed out.") : error);
          },
        );
      }
    } catch (error) {
      finish(error);
    }
  });
}

function textResult(value: unknown): DynamicToolResult {
  return {
    success: true,
    contentItems: [{ type: "inputText", text: JSON.stringify(value) }],
  };
}

function uniqueDownloadPath(root: string, name: string, reserved: Set<string>): string {
  const extension = extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  for (let suffix = 1; ; suffix += 1) {
    const candidate = join(root, suffix === 1 ? name : `${stem} (${suffix})${extension}`);
    if (!reserved.has(candidate) && !existsSync(candidate)) return candidate;
  }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Resolves to whether the work settled before the bound, rather than throwing when it did not. */
async function finishesWithin(work: Promise<unknown>, milliseconds: number): Promise<boolean> {
  return await withTimeout(work, milliseconds, "Browser operation unwind timed out.").then(
    () => true,
    () => false,
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timed out/i.test(error.message);
}

function remainingTime(deadline: number, message: string): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(message);
  return remaining;
}
