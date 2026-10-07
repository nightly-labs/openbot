import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { basename, extname, join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  BrowserBounds,
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
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Exit, Fiber, Scope, Semaphore } from "effect";
import {
  app,
  type BrowserWindow,
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
import { writeJsonFileAtomically } from "./atomic-json-file";
import {
  BrowserCdpEngine,
  type BrowserScreencastFrame,
  type BrowserUploadAssignment,
  type BrowserViewportInput,
  type SnapshotReadResult,
} from "./browser-cdp";
import { BrowserControlSessions } from "./browser-control-sessions";
import { BrowserDiagnostics } from "./browser-diagnostics";
import { type BrowserOperationError, browserCall, browserFailure, browserSync } from "./browser-effects";
import {
  type BrowserHostTab,
  type BrowserPreviewPage,
  currentTabUrl,
  type KeepQueueBlocked,
  restoreWebContentsFocus,
  toPublicTab,
} from "./browser-host-tab";
import { sessionBrowserUserAgent } from "./browser-identity";
import { describeBrowserTarget, navigateAndWait } from "./browser-navigation";
import {
  browserLoadOptions,
  browserRequestHeaders,
  diagnosticUrl,
  isAllowedBrowserPermission,
  isAllowedMainUrl,
  logUrlHost,
  normalizeBrowserUrl,
  preferredBrowserLanguageCodes,
} from "./browser-policy";
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
  persistentBrowserUrl,
  readBrowserState,
  reownStoredBrowserTab,
  resolveEnvironment,
  type StoredBrowserStateV2,
} from "./browser-state";
import {
  boundEngineOperation,
  enqueueTabOperation,
  isTimeoutError,
  readTabSnapshot,
  remainingTime,
  runTabAction,
  runTabEvaluation,
} from "./browser-tab-operations";
import {
  type BrowserDynamicToolHooks,
  type BrowserInputCall,
  browserInputAction,
  browserToolTimeout,
} from "./browser-tool-actions";
import {
  type BrowserToolArguments,
  type BrowserToolCall,
  parseBrowserToolArguments,
  parseBrowserToolCall,
} from "./browser-tools";
import { runCauseEffect } from "./effect-boundary";
import type { DynamicToolCallParams, DynamicToolResult } from "./protocol";
import { isRecord } from "./protocol";

interface BrowserHostEvents {
  changed: [tabs: BrowserTab[], activeTabId: string | null];
  controlChanged: [state: BrowserControlState];
  documentChanged: [tabId: string, documentIds: ReadonlySet<string>];
  siteVisited: [visit: BrowserSiteVisit];
}

/**
 * A tab reached a page on a new host. Only the hostname leaves the browser: never the path, query,
 * fragment or title. It feeds the local host's product analytics, which reduces it further.
 */
export interface BrowserSiteVisit {
  tabId: string;
  hostname: string;
  /** `agent` while an agent turn is driving this tab with browser tools. */
  actor: "agent" | "user";
  agentId: string | null;
}

const MAX_ENCODED_CAPTURE_PIXELS = 4_194_304;
/**
 * How long enumerating a tab's documents may take before it is unwound. It runs off a navigation
 * rather than a tool call, so no caller is waiting on it and nothing else supplies a deadline -- but
 * it is queued on the tab, so whatever the agent does next waits behind it.
 */
const DOCUMENT_ENUMERATION_TIMEOUT_MS = 10_000;
/**
 * How long a preview request waits for a new frame before it answers with the last one. The card
 * asks again three seconds after each answer, and the capture keeps running, so the next request
 * gets the frame that was late.
 */
const PREVIEW_STALE_AFTER_MS = 1_000;
/**
 * The live view's frames. The quality is what a page of text survives on a slow link, and the size
 * is the client's panel rather than the host's monitor: a frame larger than the panel that draws it
 * is bytes nobody sees.
 */
const VIEW_FRAME_QUALITY = 60;
const VIEW_FRAME_MAX_WIDTH = 1_280;
const VIEW_FRAME_MAX_HEIGHT = 800;
/**
 * An agent's tab that nobody used for this long unloads its page, and loads it again on its next use,
 * so a long run does not keep in memory the page of each tab an agent left open. The tab keeps a
 * blank page, as a restored tab does. When memory is low, the tab unloads after
 * `LOW_MEMORY_TAB_SLEEP_MS`.
 */
const IDLE_TAB_SLEEP_MS = 30 * 60_000;
const LOW_MEMORY_TAB_SLEEP_MS = 5 * 60_000;
const IDLE_TAB_SWEEP_MS = 60_000;

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

export interface PreparedBrowserSecret {
  request: BrowserSecretRequest;
  /**
   * True when an agent ran its own script on a page of this origin during this app session. That
   * script can still listen to the fields, so only the user may decide to fill them.
   */
  agentScriptedOrigin: boolean;
  /**
   * True when the target fields are built for this secret: password fields for a password, one-time
   * code fields for an authenticator code, none in a `method="get"` form. A field that the agent
   * chose for something else, such as a search box, could put the value in a URL the agent reads.
   */
  vaultFillable: boolean;
  submit(secret: string): Effect.Effect<"submitted" | "takeover", BrowserOperationError>;
  cancel(): void;
}

type BrowserAction = BrowserToolArguments<"act">["action"];

type BrowserToolName = BrowserToolCall["tool"];
type BrowserToolCallOf<Name extends BrowserToolName> = Extract<BrowserToolCall, { tool: Name }>;
type BrowserToolHandlers = {
  [Name in BrowserToolName]: (
    call: BrowserToolCallOf<Name>,
    params: DynamicToolCallParams,
    hooks: BrowserDynamicToolHooks,
  ) => Effect.Effect<DynamicToolResult, BrowserOperationError>;
};

// The generic name keeps each handler paired with its own call type.
function runBrowserTool<Name extends BrowserToolName>(
  handlers: BrowserToolHandlers,
  tool: Name,
  call: BrowserToolCallOf<Name>,
  params: DynamicToolCallParams,
  hooks: BrowserDynamicToolHooks,
): Effect.Effect<DynamicToolResult, BrowserOperationError> {
  return handlers[tool](call, params, hooks);
}

function urlOrigin(value: string): string | null {
  return URL.canParse(value) ? new URL(value).origin : null;
}

function rejectTakeoverTool(): Effect.Effect<DynamicToolResult, BrowserOperationError> {
  return Effect.fail(
    browserFailure(new Error("Browser takeover is handled by the agent service, not the browser host.")),
  );
}

export class BrowserHost {
  static readonly CONTROL_IDLE_GRACE_MS = BrowserControlSessions.IDLE_GRACE_MS;
  readonly #window: BrowserWindow;
  readonly #session: Session;
  readonly #downloadsRoot: string;
  readonly #statePath: string;
  readonly #tabs = new Map<string, BrowserHostTab>();
  readonly #closingTabDrains = new Map<string, Fiber.Fiber<void, BrowserOperationError>>();
  readonly #listeners = new Set<(...args: BrowserHostEvents["changed"]) => void>();
  readonly #documentListeners = new Set<(...args: BrowserHostEvents["documentChanged"]) => void>();
  readonly #siteVisitListeners = new Set<(...args: BrowserHostEvents["siteVisited"]) => void>();
  readonly #controls = new BrowserControlSessions();
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
  /**
   * The origins where an agent ran `evaluate`. Kept by origin, not by document: a same-origin popup,
   * opener or service worker carries the script past one document.
   */
  readonly #agentScriptedOrigins = new Set<string>();
  #persistLock = Semaphore.makeUnsafe(1);
  readonly #scope = Scope.makeUnsafe();
  #destroying: Deferred.Deferred<void, BrowserOperationError> | null = null;
  /** Whether the machine is too low on memory for one more tab. Only a hosted server has a reading. */
  readonly #memoryLow: () => boolean;
  readonly #idleTabSweep: NodeJS.Timeout;

  constructor(
    window: BrowserWindow,
    downloadsRoot: string,
    statePath: string,
    options: {
      recordingDurationMs?: number;
      recordingMaxConcurrent?: number;
      recordingMaxAggregateBytes?: number;
      memoryLow?: () => boolean;
    } = {},
  ) {
    this.#window = window;
    this.#memoryLow = options.memoryLow ?? (() => false);
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
    this.#idleTabSweep = setInterval(() => {
      void runCauseEffect(this.#sleepIdleTabs()).catch((error) =>
        logger.warn("Unable to sleep browser tabs", { error: toLogValue(error) }),
      );
    }, IDLE_TAB_SWEEP_MS);
    this.#idleTabSweep.unref();
  }

  readonly restore = Effect.fn("BrowserHost.restore")(function* (
    this: BrowserHost,
    agents: readonly BrowserTabOwner[] = [],
  ): Effect.fn.Return<void, BrowserOperationError> {
    const state = yield* readBrowserState(this.#statePath);
    if (state.tabs.length === 0) return;

    const tabs: BrowserHostTab[] = [];
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

    for (const tab of tabs) tab.pendingRestore = () => loadSavedPage(tab);
    const activeTab = this.#activeTabId ? this.#tabs.get(this.#activeTabId) : undefined;
    if (activeTab) yield* this.#wake(activeTab);
    // A view that never navigated is a debugger target that never answers, which stops a CDP client
    // from attaching to the app. A blank page answers, and costs far less than the saved page.
    for (const tab of tabs) {
      if (tab.pendingRestore)
        yield* Effect.forkIn(browserCall(() => tab.contents.loadURL("about:blank")).pipe(Effect.ignore), tab.scope, {
          startImmediately: true,
        });
    }
  }).bind(this);

  /**
   * Starts the held-back load of a restored or sleeping tab, once, ahead of anything else queued on
   * it.
   */
  readonly #wake = Effect.fn("BrowserHost.wake")(function* (this: BrowserHost, tab: BrowserHostTab) {
    const pending = tab.pendingRestore;
    if (!pending) return;
    tab.pendingRestore = undefined;
    tab.sleeping = undefined;
    yield* Effect.forkIn(enqueueTabOperation(tab, pending, true).pipe(Effect.ignore), tab.scope, {
      startImmediately: true,
    });
  });

  readonly #sleepIdleTabs = Effect.fn("BrowserHost.sleepIdleTabs")(function* (this: BrowserHost) {
    const now = Date.now();
    const idleMs = this.#memoryLow() ? LOW_MEMORY_TAB_SLEEP_MS : IDLE_TAB_SLEEP_MS;
    for (const tab of this.#tabs.values()) {
      if (tab.pendingRestore || !this.#maySleep(tab)) continue;
      if (this.#tabInUse(tab)) tab.lastUsedAt = now;
      else if (now - tab.lastUsedAt >= idleMs) yield* this.#sleep(tab);
    }
  });

  /**
   * Only an agent's own tab sleeps. A popup and its opener keep a live link between their pages, and
   * a reload breaks it, as it does staged uploads.
   */
  #maySleep(tab: BrowserHostTab): boolean {
    return (
      (tab.ownerThreadId !== null || tab.ownerAgentId !== null) &&
      !tab.closing &&
      !tab.contents.isDestroyed() &&
      !tab.popup &&
      !tab.hasSharedBrowsingContext &&
      ![...this.#tabs.values()].some((child) => child.openerTabId === tab.id) &&
      !tab.engine.hasUploadDocuments()
    );
  }

  /** A reload loses what the page holds, so a tab that a person or a task still has open stays loaded. */
  #tabInUse(tab: BrowserHostTab): boolean {
    return (
      this.#activeTabId === tab.id ||
      // A preview capture is not a use. An unload that starts during one waits behind it on the queue.
      tab.pendingOperations > (tab.previewCapture ? 1 : 0) ||
      tab.viewInvalidations.size > 0 ||
      tab.recording ||
      tab.secret !== undefined ||
      tab.secretDocument === true ||
      this.#takeoverTabIds.has(tab.id) ||
      tab.contents.isCurrentlyAudible()
    );
  }

  /**
   * Unloads the page and keeps the tab: its id, owner, URL and settings stay, and the next use loads
   * the page again through `#wake`. The page's own state, such as its history and unsent form
   * input, is lost, as when a browser discards a background tab.
   */
  readonly #sleep = Effect.fn("BrowserHost.sleep")(function* (this: BrowserHost, tab: BrowserHostTab) {
    const saved = savedPreview(tab);
    const capture = saved ? undefined : yield* this.#previewCapture(tab);
    const sleeping: NonNullable<BrowserHostTab["sleeping"]> = { title: tab.contents.getTitle(), preview: null };
    let unloaded = false;
    tab.sleeping = sleeping;
    tab.pendingRestore = () => (unloaded ? loadSavedPage(tab) : Effect.void);
    yield* Effect.forkIn(
      enqueueTabOperation(
        tab,
        () =>
          Effect.gen(function* () {
            sleeping.preview =
              saved ??
              (capture ? yield* Deferred.await(capture.frame).pipe(Effect.catch(() => Effect.succeed(null))) : null);
            if (tab.sleeping !== sleeping || tab.closing || tab.contents.isDestroyed()) return;
            unloaded = true;
            yield* browserCall(() => tab.contents.loadURL("about:blank"));
          }),
        true,
      ).pipe(Effect.ignore),
      tab.scope,
      { startImmediately: true },
    );
    this.#emitChanged();
  });

  onChanged(listener: (...args: BrowserHostEvents["changed"]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onControlChanged(listener: (...args: BrowserHostEvents["controlChanged"]) => void): () => void {
    return this.#controls.onChanged(listener);
  }

  onDocumentChanged(listener: (...args: BrowserHostEvents["documentChanged"]) => void): () => void {
    this.#documentListeners.add(listener);
    return () => this.#documentListeners.delete(listener);
  }

  onSiteVisited(listener: (...args: BrowserHostEvents["siteVisited"]) => void): () => void {
    this.#siteVisitListeners.add(listener);
    return () => this.#siteVisitListeners.delete(listener);
  }

  getControlState(): BrowserControlState {
    return this.#controls.state();
  }

  endControl(threadId: string, turnId: string): void {
    this.#controls.end(threadId, turnId);
  }

  clearControls(): void {
    this.#controls.clear();
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

  readonly open = Effect.fn("BrowserHost.open")(function* (
    this: BrowserHost,
    url: string,
    ownerThreadId: string | null = null,
    ownerAgentId: string | null = null,
    focus = false,
  ): Effect.fn.Return<BrowserTab, BrowserOperationError> {
    if (!this.#hasTabCapacity(ownerThreadId, ownerAgentId)) {
      return yield* browserFailure(
        new Error(sourceText("error.backend.browserTabLimit", { limit: INPUT_LIMITS.browserTabs })),
      );
    }
    // Each tab is its own renderer process.
    if (this.#memoryLow()) return yield* browserFailure(new Error(sourceText("error.backend.browserLowMemory")));
    const normalizedUrl = yield* browserSync(() => normalizeBrowserUrl(url));
    const previouslyFocused = focus ? null : this.#focusedContentsOutsideTabs();
    const tab = this.#createTab(randomUUID(), normalizedUrl, ownerThreadId, ownerAgentId);

    this.#tabs.set(tab.id, tab);
    this.#bindTabEvents(tab);
    this.#activeTabId = tab.id;
    tab.focusOnVisible = focus;
    this.#syncAttachedView();
    if (!focus) restoreWebContentsFocus(previouslyFocused, tab.contents);
    this.#emitChanged();
    yield* this.#persistState();

    yield* Effect.gen({ self: this }, function* () {
      yield* browserCall(() => tab.contents.loadURL(normalizedUrl, browserLoadOptions()));
      if (focus) {
        this.#focusTab(tab);
        setImmediate(() => this.#focusTab(tab));
      } else restoreWebContentsFocus(previouslyFocused, tab.contents);
    }).pipe(
      Effect.catch((operationFailure) =>
        Effect.gen({ self: this }, function* () {
          const error = operationFailure.cause;
          if (this.#tabs.get(tab.id) === tab) {
            this.#unmountView(tab.view);
            this.#tabs.delete(tab.id);
            yield* tab.engine.destroy();
            tab.contents.close();
            if (this.#activeTabId === tab.id) {
              this.#activeTabId = this.#tabs.keys().next().value ?? null;
            }
            this.#syncAttachedView();
          }
          this.#emitChanged();
          yield* this.#persistState();
          return yield* browserFailure(
            new Error(sourceText("error.backend.browserOpenFailed", { url: normalizedUrl, reason: String(error) })),
          );
        }),
      ),
    );

    return toPublicTab(tab);
  }).bind(this);

  #hasTabCapacity(ownerThreadId: string | null, ownerAgentId: string | null): boolean {
    const tabs = [...this.#tabs.values()].filter((tab) => {
      if (tab.ownerAgentId && ownerAgentId) return tab.ownerAgentId === ownerAgentId;
      if (tab.ownerThreadId) return tab.ownerThreadId === ownerThreadId;
      return tab.ownerAgentId === null && ownerAgentId === null && ownerThreadId === null;
    });
    return tabs.length < INPUT_LIMITS.browserTabs;
  }

  readonly activate = Effect.fn("BrowserHost.activate")(function* (
    this: BrowserHost,
    tabId: string,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#requireTab(tabId);
    this.#activeTabId = tabId;
    this.#syncAttachedView();
    this.#emitChanged();
    yield* this.#persistState();
  }).bind(this);

  readonly navigate = Effect.fn("BrowserHost.navigate")(function* (
    this: BrowserHost,
    tabId: string,
    direction: BrowserNavigationDirection,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#enqueue(tabId, (tab) =>
      Effect.gen({ self: this }, function* () {
        yield* navigateAndWait(tab.contents, () => navigateHistory(tab.contents, direction));
      }),
    );
  }).bind(this);

  readonly loadUrl = Effect.fn("BrowserHost.loadUrl")(function* (
    this: BrowserHost,
    tabId: string,
    url: string,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const normalizedUrl = yield* browserSync(() => normalizeBrowserUrl(url));
    yield* this.#enqueue(
      tabId,
      (tab) =>
        Effect.gen({ self: this }, function* () {
          yield* navigateAndWait(tab.contents, () => tab.contents.loadURL(normalizedUrl, browserLoadOptions()));
          this.#focusTab(tab);
        }),
      true,
    );
  }).bind(this);

  readonly reload = Effect.fn("BrowserHost.reload")(function* (
    this: BrowserHost,
    tabId: string,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#enqueue(
      tabId,
      (tab) =>
        Effect.gen({ self: this }, function* () {
          return yield* navigateAndWait(tab.contents, () => {
            tab.contents.reload();
            return true;
          });
        }),
      true,
    );
  }).bind(this);

  readonly close = Effect.fn("BrowserHost.close")(function* (
    this: BrowserHost,
    tabId: string,
  ): Effect.fn.Return<void, BrowserOperationError> {
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
      if (active) {
        active.focusOnVisible = true;
        yield* this.#wake(active);
      }
    }
    this.#syncAttachedView();
    this.#emitChanged();
    tab.closing = true;
    const destroy = yield* Effect.forkIn(
      Effect.gen({ self: this }, function* () {
        yield* Deferred.await(tab.queue);
        yield* Effect.all(childDrains, { concurrency: "unbounded", discard: true });
        const discarded = yield* Effect.exit(this.#recorder.discard(tabId, "tab-closed"));
        yield* tab.engine.destroy();
        yield* Scope.close(tab.scope, Exit.void);
        yield* browserSync(() => {
          if (!tab.contents.isDestroyed()) tab.contents.close();
        });
        if (Exit.isFailure(discarded)) return yield* Effect.failCause(discarded.cause);
      }),
      this.#scope,
      { startImmediately: true, uninterruptible: true },
    );
    this.#closingTabDrains.set(tab.id, destroy);
    const results = yield* Effect.all([Fiber.join(destroy), this.#persistState()].map(Effect.exit), {
      concurrency: "unbounded",
    });
    if (this.#closingTabDrains.get(tab.id) === destroy) this.#closingTabDrains.delete(tab.id);
    const failure = results.find(Exit.isFailure);
    if (failure) return yield* Effect.failCause(failure.cause);
  }, Effect.uninterruptible).bind(this);

  readonly beginTakeover = Effect.fn("BrowserHost.beginTakeover")(function* (
    this: BrowserHost,
    tabId: string,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const tab = this.#tabs.get(tabId);
    if (!tab) return yield* browserFailure(new Error(sourceText("error.backend.browserTabNotFound")));
    tab.engine.invalidateReferences();
    this.#takeoverTabIds.add(tabId);
    this.#syncAttachedView();
    tab.diagnostics.clearDiagnostics();
    this.#emitChanged();
    yield* Effect.gen({ self: this }, function* () {
      yield* this.#enqueue(tabId, () => this.#recorder.discard(tabId, "tab-closed"), true);
    }).pipe(
      Effect.catch((operationFailure) =>
        Effect.gen({ self: this }, function* () {
          const error = operationFailure.cause;
          tab.diagnostics.clearDiagnostics();
          this.#takeoverTabIds.delete(tabId);
          return yield* browserFailure(error);
        }),
      ),
    );
  }).bind(this);

  readonly prepareSecret = Effect.fn("BrowserHost.prepareSecret")(function* (
    this: BrowserHost,
    params: DynamicToolCallParams,
  ): Effect.fn.Return<PreparedBrowserSecret, BrowserOperationError> {
    const call = yield* browserSync(() => parseBrowserToolCall("submit_secret", params.arguments));
    if (call.tool !== "submit_secret")
      return yield* browserFailure(new Error("Invalid secure authentication request."));
    const args = call.args;
    yield* browserSync(() => this.#requireToolTab(params, args.tabId));
    const tab = yield* this.#requireTab(args.tabId);
    if (tab.secret) return yield* browserFailure(new Error(sourceText("error.backend.authActive")));
    const url = yield* browserSync(() => new URL(currentTabUrl(tab)));
    if (url.protocol !== "https:")
      return yield* browserFailure(new Error(sourceText("error.backend.authHttpsRequired")));
    yield* browserSync(() => this.#requireIsolatedFromConnectedTabs(tab, url.origin));
    if (args.method !== "password" && args.digits < 4)
      return yield* browserFailure(new Error(sourceText("error.backend.authDigitsRange")));
    if (
      (args.method === "password" && args.targets.length !== 1) ||
      (args.targets.length !== 1 && args.targets.length !== args.digits) ||
      (args.submission === "click") !== Boolean(args.submitTarget)
    )
      return yield* browserFailure(new Error("Invalid authentication targets."));
    const protection = { origin: url.origin, submitted: false, replaced: false, running: false };
    tab.secret = protection;
    this.#invalidateViews(tab);
    this.#syncAttachedView();
    return yield* Effect.gen({ self: this }, function* () {
      const entry = yield* this.#enqueue(
        args.tabId,
        (_tab, keepQueueBlocked) =>
          Effect.gen({ self: this }, function* () {
            yield* this.#recorder.discard(args.tabId, "requested");
            tab.diagnostics.clearDiagnostics();
            return yield* boundEngineOperation(
              tab,
              tab.engine.prepareSecret(args.targets, url.origin, args.submission, args.submitTarget),
              10_000,
              "Authentication target resolution timed out.",
              keepQueueBlocked,
            );
          }),
        true,
      );
      return {
        // Password cards do not use digits; keep public metadata within its released bounds.
        request: { method: args.method, origin: url.origin, digits: args.method === "password" ? 6 : args.digits },
        agentScriptedOrigin: this.#agentScriptedOrigins.has(url.origin),
        vaultFillable:
          args.method === "password"
            ? entry.fields.password
            : args.method === "authenticator" && entry.fields.oneTimeCode,
        cancel: () => {
          if (tab.secret === protection && !protection.submitted) {
            tab.secret = undefined;
            this.#syncAttachedView();
            this.#emitChanged();
          }
        },
        submit: (secret: string) =>
          Effect.gen({ self: this }, function* (): Effect.fn.Return<"submitted" | "takeover", BrowserOperationError> {
            if (tab.secret !== protection || protection.submitted)
              return yield* browserFailure(new Error(sourceText("error.backend.authExpired")));
            // A connected page can navigate to the secret's site while the card is open.
            yield* browserSync(() => this.#requireIsolatedFromConnectedTabs(tab, url.origin));
            if (args.method !== "password" && !new RegExp(`^[0-9]{${args.digits}}$`, "u").test(secret))
              return yield* browserFailure(new Error(sourceText("error.backend.authDigitsRequired")));
            protection.submitted = true;
            this.#invalidateViews(tab);
            protection.running = true;
            this.#syncAttachedView();
            let kept = false;
            yield* Effect.gen({ self: this }, function* () {
              yield* this.#enqueue(
                args.tabId,
                (_tab, keepQueueBlocked) =>
                  Effect.gen({ self: this }, function* () {
                    yield* boundEngineOperation(
                      tab,
                      entry.enter(secret),
                      10_000,
                      "Authentication submission timed out.",
                      keepQueueBlocked,
                    );
                    if (!protection.replaced) {
                      yield* Effect.callback<void>((resume) => {
                        const contents = tab.contents;
                        const cleanup = () => {
                          clearTimeout(timer);
                          contents.off("did-navigate", finish);
                          contents.off("destroyed", finish);
                        };
                        const finish = () => {
                          cleanup();
                          resume(Effect.void);
                        };
                        const timer = setTimeout(finish, 5_000);
                        contents.once("did-navigate", finish);
                        contents.once("destroyed", finish);
                        return Effect.sync(cleanup);
                      });
                    }
                    if (!protection.replaced) {
                      // A reload would restart a single-page sign-in at its first step. Keep the
                      // document when its fields are empty and nothing a snapshot reads shows the value.
                      const cleared = yield* boundEngineOperation(
                        tab,
                        entry.clear(secret),
                        10_000,
                        "Authentication field cleanup timed out.",
                        keepQueueBlocked,
                      ).pipe(Effect.catch(() => Effect.succeed(false)));
                      if (cleared && !protection.replaced) kept = true;
                    }
                    if (!protection.replaced && !kept) {
                      // Load with GET rather than replaying a possible form POST. Keep capture
                      // blocked until navigation has replaced the document and this operation ends.
                      yield* boundEngineOperation(
                        tab,
                        navigateAndWait(tab.contents, () =>
                          tab.contents.loadURL(currentTabUrl(tab), browserLoadOptions()),
                        ),
                        10_000,
                        "Authentication page reload timed out.",
                        keepQueueBlocked,
                      );
                    }
                  }),
                true,
              );
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  protection.running = false;
                  tab.diagnostics.clearDiagnostics();
                  if (protection.replaced) {
                    tab.contents.navigationHistory.clear();
                    tab.secret = undefined;
                    this.#syncAttachedView();
                  } else if (kept) {
                    tab.secretDocument = true;
                    tab.secret = undefined;
                    this.#syncAttachedView();
                  }
                  this.#emitChanged();
                }),
              ),
            );
            return protection.replaced || kept ? "submitted" : "takeover";
          }),
      };
    }).pipe(
      Effect.catch(() =>
        Effect.gen({ self: this }, function* () {
          tab.secret = undefined;
          this.#syncAttachedView();
          return yield* browserFailure(new Error("Secure authentication is unavailable. Use browser takeover."));
        }),
      ),
    );
  }).bind(this);

  /**
   * Pages in one opener group can keep references to each other's documents, including a document
   * that received a secret and was later replaced. The browser blocks that access between sites, so
   * secure input is allowed in a connected tab only when no frame in another connected tab has the
   * secret's site.
   */
  #requireIsolatedFromConnectedTabs(tab: BrowserHostTab, origin: string): void {
    if (!tab.hasSharedBrowsingContext) return;
    const site = approximateSite(origin);
    for (const connected of this.#connectedTabs(tab)) {
      if (connected === tab || connected.contents.isDestroyed()) continue;
      const origins = connected.contents.mainFrame.framesInSubtree.map((frame) => frame.origin);
      if (origins.some((frameOrigin) => frameOrigin !== "null" && approximateSite(frameOrigin) === site))
        throw new Error(
          "Secure input is unavailable while a connected popup or opener tab shows the same site. Use takeover.",
        );
    }
  }

  #requireNoSecretDocument(tab: BrowserHostTab, action: string): void {
    if ([...this.#connectedTabs(tab)].some((connected) => connected.secretDocument))
      throw new Error(
        `${action} is unavailable while a page that received a secret is open. Use snapshots and actions until it navigates.`,
      );
  }

  #connectedTabs(tab: BrowserHostTab): Set<BrowserHostTab> {
    const connected = new Set([tab]);
    for (const current of connected) {
      for (const candidate of this.#tabs.values()) {
        if (candidate.openerTabId === current.id || candidate.id === current.openerTabId) connected.add(candidate);
      }
    }
    return connected;
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

  readonly setVisible = Effect.fn("BrowserHost.setVisible")(function* (
    this: BrowserHost,
    input: BrowserVisibilityInput,
  ) {
    const active = this.#activeTabId ? this.#tabs.get(this.#activeTabId) : undefined;
    if (active) yield* this.#wake(active);
    yield* browserSync(() => {
      const restoreRendererFocus = !input.visible && this.#attachedView?.webContents.isFocused();
      this.#visible = input.visible;
      if (input.bounds) this.#bounds = validateBounds(input.bounds);
      if (input.target) this.#target = input.target;
      this.#syncAttachedView();
      if (restoreRendererFocus) this.#window.webContents.focus();
    });
  }).bind(this);

  readonly snapshot = Effect.fn("BrowserHost.snapshot")(function* (
    this: BrowserHost,
    tabId: string,
  ): Effect.fn.Return<BrowserSnapshot, BrowserOperationError> {
    return yield* this.#enqueue(tabId, (tab, keepQueueBlocked) =>
      Effect.gen({ self: this }, function* () {
        const revision = tab.revision + 1;
        return (yield* readTabSnapshot(tab, revision, keepQueueBlocked)).snapshot;
      }),
    );
  }).bind(this);

  readonly act = Effect.fn("BrowserHost.act")(function* (
    this: BrowserHost,
    tabId: string,
    revision: number,
    action: BrowserAction,
  ): Effect.fn.Return<BrowserSnapshot, BrowserOperationError> {
    return yield* this.#enqueue(tabId, (tab, keepQueueBlocked) =>
      Effect.gen({ self: this }, function* () {
        if (revision !== tab.revision) {
          return yield* browserFailure(new Error("Stale browser references. Take a fresh snapshot before acting."));
        }
        const target =
          action.type === "click" || action.type === "type"
            ? ({ kind: "ref", ref: action.ref, revision } as const)
            : undefined;
        const deadline = Date.now() + 10_000;
        yield* Effect.gen({ self: this }, function* () {
          const dispatch = () =>
            Effect.gen({ self: this }, function* () {
              switch (action.type) {
                case "click":
                  if (!target) return yield* browserFailure(new Error("Legacy click requires a target."));
                  yield* tab.engine.click(target, {}, deadline);
                  return;
                case "type":
                  if (!target) return yield* browserFailure(new Error("Legacy type requires a target."));
                  yield* tab.engine.type(
                    target,
                    action.text,
                    { mode: "replace", submit: action.submit === true },
                    deadline,
                  );
                  return;
                case "key":
                  yield* tab.engine.press(action.key, undefined, deadline);
                  return;
                case "scroll":
                  yield* tab.engine.scroll(undefined, 0, action.deltaY, deadline);
                  return;
                case "back":
                case "forward":
                  yield* navigateAndWait(tab.contents, () => navigateHistory(tab.contents, action.type));
                  return;
                case "reload":
                  yield* navigateAndWait(tab.contents, () => {
                    tab.contents.reload();
                    return true;
                  });
              }
            });
          // The deadline the engine carries is checked between its commands, which a renderer that
          // answers none of them never reaches -- and re-resolving a ref fingerprints the element in
          // the frame that owns it, so a page wedged after the snapshot hangs the dispatch itself.
          const dispatchTimeout = Math.max(1, deadline - Date.now());
          yield* boundEngineOperation(tab, dispatch(), dispatchTimeout, "Browser action timed out.", keepQueueBlocked);
          const settleTimeout = Math.max(1, deadline - Date.now());
          yield* boundEngineOperation(
            tab,
            tab.engine.settle(settleTimeout),
            settleTimeout,
            "Browser action timed out.",
            keepQueueBlocked,
          );
          tab.diagnostics.action({
            action: action.type,
            target: target ? describeBrowserTarget(target) : undefined,
            outcome: "success",
          });
        }).pipe(
          Effect.catch((operationFailure) =>
            Effect.gen({ self: this }, function* () {
              const error = operationFailure.cause;
              tab.diagnostics.action({
                action: action.type,
                target: target ? describeBrowserTarget(target) : undefined,
                outcome: "error",
                detail: String(error),
              });
              return yield* browserFailure(error);
            }),
          ),
        );
        const nextRevision = tab.revision + 1;
        return (yield* readTabSnapshot(tab, nextRevision, keepQueueBlocked)).snapshot;
      }),
    );
  }).bind(this);

  readonly screenshot = Effect.fn("BrowserHost.screenshot")(function* (
    this: BrowserHost,
    tabId: string,
  ): Effect.fn.Return<string, BrowserOperationError> {
    return yield* this.#enqueue(tabId, (tab, keepQueueBlocked) =>
      Effect.gen({ self: this }, function* () {
        const image = yield* boundEngineOperation(
          tab,
          tab.engine.screenshot(),
          10_000,
          "Browser screenshot timed out.",
          keepQueueBlocked,
        );
        return boundedCaptureDataUrl(image);
      }),
    );
  }).bind(this);

  readonly capturePreview = Effect.fn("BrowserHost.capturePreview")(function* (
    this: BrowserHost,
    tabId: string,
  ): Effect.fn.Return<BrowserPreview, BrowserOperationError> {
    const tab = this.#tabs.get(tabId);
    if (!tab) return yield* browserFailure(new Error(`Unknown browser tab: ${tabId}`));
    // A preview card on screen does not keep a sleeping tab loaded.
    if (tab.sleeping?.preview) return tab.sleeping.preview;
    yield* this.#wake(tab);
    if (tab.secret?.submitted)
      return yield* browserFailure(new Error("Browser inspection is protected during authentication. Use takeover."));
    const cached = savedPreview(tab);
    if (cached && tab.pendingOperations > 0) return cached;
    const started = yield* this.#previewCapture(tab);
    const capture = Effect.gen({ self: this }, function* () {
      const frame = yield* Deferred.await(started.frame);
      if (showsCurrentPage(tab, started)) return frame;
      const retry = yield* this.#previewCapture(tab);
      const retried = yield* Deferred.await(retry.frame);
      if (!showsCurrentPage(tab, retry))
        return yield* browserFailure(new Error(sourceText("error.backend.browserPreviewPageChanged")));
      return retried;
    });
    if (!cached) return yield* capture;
    // A stale frame is usable only if navigation has not changed its page.
    const stale = Effect.sleep(PREVIEW_STALE_AFTER_MS).pipe(
      Effect.andThen(Effect.suspend(() => (savedPreview(tab) === cached ? Effect.succeed(cached) : Effect.never))),
    );
    return yield* Effect.raceFirst(capture, stale);
  }).bind(this);

  readonly #previewCapture = Effect.fn("BrowserHost.previewCapture")(function* (
    this: BrowserHost,
    tab: BrowserHostTab,
  ) {
    if (tab.previewCapture && showsCurrentPage(tab, tab.previewCapture)) return tab.previewCapture;
    const page = currentPreviewPage(tab);
    const frame = Deferred.makeUnsafe<BrowserPreview, BrowserOperationError>();
    const capture = { ...page, frame };
    tab.previewCapture = capture;
    yield* Effect.forkIn(
      Effect.gen({ self: this }, function* () {
        const result = yield* Effect.exit(
          enqueueTabOperation(tab, (_tab, keepQueueBlocked) =>
            Effect.gen({ self: this }, function* () {
              const image = yield* boundEngineOperation(
                tab,
                tab.engine.screenshot(),
                10_000,
                "Browser preview timed out.",
                keepQueueBlocked,
              );
              const size = image.getSize();
              if (size.width <= 0 || size.height <= 0)
                return yield* browserFailure(new Error("Browser preview is empty."));

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
              const frame = { dataUrl, width: 960, height: 600 };
              if (showsCurrentPage(tab, page)) tab.preview = { ...page, frame };
              return frame;
            }),
          ),
        );
        if (tab.previewCapture === capture) tab.previewCapture = undefined;
        yield* Deferred.done(frame, result);
      }),
      tab.scope,
      { startImmediately: true },
    );
    return capture;
  });

  /**
   * A live view of a tab, for a member who is not at this computer.
   *
   * The frames do not go through the tab's operation queue. A queued frame is a frame that arrives
   * after whatever the agent is doing has finished, which is exactly the picture the still-image
   * route already gave; the point of the view is that the page moves while the agent works.
   */
  #invalidateViews(tab: BrowserHostTab): void {
    tab.captureGeneration += 1;
    for (const invalidate of [...tab.viewInvalidations]) invalidate();
  }

  readonly startView = Effect.fn("BrowserHost.startView")(function* (
    this: BrowserHost,
    tabId: string,
    onFrame: (frame: BrowserScreencastFrame) => void,
    onEnded?: (reason: string) => void,
  ): Effect.fn.Return<() => Effect.Effect<void>, BrowserOperationError> {
    const tab = yield* this.#requireTab(tabId);
    if (tab.secret?.submitted)
      return yield* browserFailure(new Error(sourceText("error.backend.browserViewProtected")));
    const generation = tab.captureGeneration;
    let invalidated = false;
    const invalidate = () => {
      invalidated = true;
      tab.viewInvalidations.delete(invalidate);
      onEnded?.("Authentication changed the browser view. Open a new view to continue.");
    };
    tab.viewInvalidations.add(invalidate);
    return yield* Effect.gen({ self: this }, function* () {
      const stop = yield* tab.engine.startScreencast(
        { quality: VIEW_FRAME_QUALITY, maxWidth: VIEW_FRAME_MAX_WIDTH, maxHeight: VIEW_FRAME_MAX_HEIGHT },
        (frame) => {
          if (!tab.secret?.submitted && tab.captureGeneration === generation) onFrame(frame);
        },
        (error) => {
          tab.viewInvalidations.delete(invalidate);
          logger.warn("The live browser view stopped.", { error: toLogValue(error) });
          onEnded?.("The live browser view stopped. Open a new view to continue.");
        },
      );
      let stopped = false;
      const stopOnce = () =>
        Effect.gen({ self: this }, function* () {
          tab.viewInvalidations.delete(invalidate);
          if (stopped) return;
          stopped = true;
          yield* stop();
        });
      if (invalidated) yield* stopOnce();
      return stopOnce;
    }).pipe(
      Effect.catch((operationFailure) =>
        Effect.gen({ self: this }, function* () {
          const error = operationFailure.cause;
          tab.viewInvalidations.delete(invalidate);
          return yield* browserFailure(error);
        }),
      ),
    );
  }).bind(this);

  readonly dispatchViewInput = Effect.fn("BrowserHost.dispatchViewInput")(function* (
    this: BrowserHost,
    tabId: string,
    input: BrowserViewportInput,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const tab = yield* this.#requireTab(tabId);
    if (tab.secret?.submitted)
      return yield* browserFailure(new Error(sourceText("error.backend.browserInputProtected")));
    if (input.type !== "pointer" || input.action !== "move") tab.engine.invalidateReferences();
    yield* tab.engine.dispatchViewportInput(input);
  }).bind(this);

  readonly #toolHandlers: BrowserToolHandlers = {
    open: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        const tab = yield* this.open(args.url, params.threadId, params.ownerAgentId ?? null);
        this.#controls.updateTab(params, tab.id);
        return textResult({ tab });
      }),
    list_tabs: (_call, params) => browserSync(() => textResult(this.#toolTabs(params))),
    status: (_call, params) =>
      Effect.gen({ self: this }, function* () {
        const control = {
          sessions: this.getControlState().sessions.filter((session) => session.threadId === params.threadId),
        };
        return textResult({ ...this.#toolTabs(params), control });
      }),
    snapshot: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        const tabId = args.tabId;
        yield* browserSync(() => this.#requireToolTab(params, tabId));
        const mode = args.image ?? "auto";
        const capture = yield* this.#enqueue(tabId, (tab, keepQueueBlocked) =>
          Effect.gen({ self: this }, function* () {
            const result = yield* readTabSnapshot(tab, tab.revision + 1, keepQueueBlocked);
            const includeImage = mode === "always" || (mode === "auto" && result.recommendImage);
            if (!includeImage) return { result, imageUrl: null };
            const image = yield* boundEngineOperation(
              tab,
              tab.engine.screenshot(),
              10_000,
              "Browser screenshot timed out.",
              keepQueueBlocked,
            );
            return { result, imageUrl: boundedCaptureDataUrl(image) };
          }),
        );
        return this.#snapshotResult(capture.result, mode, capture.imageUrl);
      }),
    navigate: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        const tabId = args.tabId;
        yield* browserSync(() => this.#requireToolTab(params, tabId));
        const url = args.url;
        const direction = args.direction;
        if (!url && !direction) return yield* browserFailure(new Error("navigate requires url or direction."));
        const timeoutMs = browserToolTimeout(args.timeoutMs);
        return textResult(
          yield* this.#runAction(
            tabId,
            "navigate",
            undefined,
            (tab, deadline) =>
              Effect.gen({ self: this }, function* () {
                const operationTimeout = remainingTime(deadline, "Browser navigate timed out.");
                if (url) {
                  const normalizedUrl = yield* browserSync(() => normalizeBrowserUrl(url));
                  tab.requestedUrl = normalizedUrl;
                  yield* navigateAndWait(
                    tab.contents,
                    () => tab.contents.loadURL(normalizedUrl, browserLoadOptions()),
                    operationTimeout,
                  );
                } else if (direction === "reload") {
                  yield* navigateAndWait(
                    tab.contents,
                    () => {
                      tab.contents.reload();
                      return true;
                    },
                    operationTimeout,
                  );
                } else if (direction) {
                  yield* navigateAndWait(
                    tab.contents,
                    () => navigateHistory(tab.contents, direction),
                    operationTimeout,
                  );
                }
              }),
            timeoutMs,
          ),
        );
      }),
    click: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    type: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    press: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    hover: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    scroll: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    select_option: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    set_checked: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    drag: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    upload_files: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    wait_for: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        const tabId = args.tabId;
        yield* browserSync(() => this.#requireToolTab(params, tabId));
        const condition = {
          target: args.target,
          text: args.text,
          url: args.url,
          state: args.state,
        };
        if (!condition.target && !condition.text && !condition.url && !condition.state)
          return yield* browserFailure(new Error("wait_for requires a condition."));
        const timeoutMs = browserToolTimeout(args.timeoutMs);
        return textResult(
          yield* this.#enqueue(tabId, (tab, keepQueueBlocked) =>
            Effect.gen({ self: this }, function* () {
              const timeoutMessage = "Browser wait condition timed out.";
              const deadline = Date.now() + timeoutMs;
              // The engine checks this deadline between commands, which a frame that answers none of
              // them never reaches.
              const waitTimeout = remainingTime(deadline, timeoutMessage);
              yield* boundEngineOperation(
                tab,
                tab.engine.waitFor(condition, waitTimeout),
                waitTimeout,
                timeoutMessage,
                keepQueueBlocked,
              );
              return (yield* readTabSnapshot(
                tab,
                tab.revision + 1,
                keepQueueBlocked,
                remainingTime(deadline, timeoutMessage),
                timeoutMessage,
              )).snapshot;
            }),
          ),
        );
      }),
    evaluate: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        yield* browserSync(() => this.#requireToolTab(params, args.tabId));
        return textResult(
          yield* this.#runEvaluation(
            args.tabId,
            args.expression,
            args.awaitPromise ?? true,
            browserToolTimeout(args.timeoutMs),
          ),
        );
      }),
    set_environment: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        const tabId = args.tabId;
        yield* browserSync(() => this.#requireToolTab(params, tabId));
        return textResult(
          yield* this.#enqueue(tabId, (tab, keepQueueBlocked) =>
            Effect.gen({ self: this }, function* () {
              const environment = yield* browserSync(() =>
                resolveEnvironment(args, tab.environment, tab.view.getBounds()),
              );
              // This also bounds the engine's rollback if applying the environment fails.
              yield* boundEngineOperation(
                tab,
                tab.engine.setEnvironment(environment),
                10_000,
                "Browser environment change timed out.",
                keepQueueBlocked,
              );
              tab.environment = environment;
              yield* this.#persistState();
              this.#emitChanged();
              return (yield* readTabSnapshot(tab, tab.revision + 1, keepQueueBlocked)).snapshot;
            }),
          ),
        );
      }),
    recording_start: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        const tabId = args.tabId;
        yield* browserSync(() => this.#requireToolTab(params, tabId));
        yield* this.#enqueue(tabId, (tab) => {
          this.#requireNoSecretDocument(tab, "Recording");
          return this.#recorder.start(tabId, tab.contents);
        });
        return textResult({ recording: true, tabId, limits: { durationMs: 300_000, bytes: 104_857_600 } });
      }),
    recording_stop: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        const tabId = args.tabId;
        yield* browserSync(() => this.#requireToolTab(params, tabId));
        return textResult({
          artifact: yield* this.#enqueue(tabId, () => this.#recorder.stop(tabId)),
        });
      }),
    act: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        yield* browserSync(() => this.#requireToolTab(params, args.tabId));
        return textResult(yield* this.act(args.tabId, args.revision, args.action));
      }),
    screenshot: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        yield* browserSync(() => this.#requireToolTab(params, args.tabId));
        const imageUrl = yield* this.screenshot(args.tabId);
        return { success: true, contentItems: [{ type: "inputImage", imageUrl }] };
      }),
    close_tab: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        const tabId = args.tabId;
        // Checked only for a tab that exists, so closing an id that is already gone stays a silent
        // success and a repeated close is idempotent.
        const tab = this.#tabs.get(tabId);
        if (tab) {
          yield* browserSync(() => this.#requireToolTab(params, tabId));
          logger.info("Agent closed a browser tab.", {
            tabId,
            host: logUrlHost(tab.requestedUrl),
            agentId: params.ownerAgentId ?? null,
          });
        }
        yield* this.close(tabId);
        return textResult({ closed: true });
      }),
    // Published in BROWSER_TOOL_DEFINITIONS like every other tool, but answered by the agent
    // service, which intercepts the namespace before the call reaches a host. Reaching here
    // means a caller bypassed that, and silently succeeding would tell the model the user had
    // been asked for control when nobody was.
    submit_secret: rejectTakeoverTool,
    request_takeover: rejectTakeoverTool,
    list_logins: rejectTakeoverTool,
  };

  readonly handleDynamicTool = Effect.fn("BrowserHost.handleDynamicTool")(function* (
    this: BrowserHost,
    params: DynamicToolCallParams,
    hooks: BrowserDynamicToolHooks = {},
  ): Effect.fn.Return<DynamicToolResult, BrowserOperationError> {
    return yield* Effect.gen({ self: this }, function* () {
      const call = yield* browserSync(() => parseBrowserToolCall(params.tool, params.arguments));
      yield* browserSync(() => this.#controls.begin(params, call));
      return yield* runBrowserTool(this.#toolHandlers, call.tool, call, params, hooks);
    })
      .pipe(
        Effect.catch((operationFailure) =>
          Effect.sync((): DynamicToolResult => {
            const error = operationFailure.cause;
            return {
              success: false,
              // The single place every browser tool failure reaches a provider. A page exception carries
              // the page's own message -- `throw new Error("password=hunter2")` -- so this gets the same
              // redaction the diagnostics ring applies, and the diagnostic copy stays the redacted one.
              contentItems: [{ type: "inputText", text: redactText(String(error)) }],
            };
          }),
        ),
      )
      .pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.#controls.finish(params);
          }),
        ),
      );
  }).bind(this);

  #toolTabs(params: DynamicToolCallParams): { tabs: BrowserTab[]; activeTabId: string | null } {
    const tabs = this.listTabs().filter((tab) => this.#canUseToolTab(params, tab));
    const activeTabId = tabs.some((tab) => tab.id === this.#activeTabId)
      ? this.#activeTabId
      : (tabs.at(-1)?.id ?? null);
    return { tabs, activeTabId };
  }

  readonly #runInputTool = Effect.fn("BrowserHost.runInputTool")(function* (
    this: BrowserHost,
    call: BrowserInputCall,
    params: DynamicToolCallParams,
    hooks: BrowserDynamicToolHooks,
  ): Effect.fn.Return<DynamicToolResult, BrowserOperationError> {
    yield* browserSync(() => this.#requireToolTab(params, call.args.tabId));
    const action = yield* browserSync(() => browserInputAction(call, hooks));
    return textResult(
      yield* this.#runAction(
        call.args.tabId,
        action.name,
        action.target,
        (tab, deadline, markDispatched) => action.run(tab.engine, deadline, markDispatched),
        browserToolTimeout(call.args.timeoutMs),
        call.tool === "upload_files" ? hooks.onUploadOperationStarted : undefined,
      ),
    );
  });

  readonly resolveUploadTarget = Effect.fn("BrowserHost.resolveUploadTarget")(function* (
    this: BrowserHost,
    params: DynamicToolCallParams,
  ): Effect.fn.Return<BrowserUploadAssignment, BrowserOperationError> {
    const args = yield* browserSync(() => parseBrowserToolArguments("upload_files", params.arguments));
    const tabId = args.tabId;
    yield* browserSync(() => this.#requireToolTab(params, tabId));
    const target = args.target;
    const timeoutMs = browserToolTimeout(args.timeoutMs);
    return yield* this.#enqueue(tabId, (tab, keepQueueBlocked) =>
      // This preflight scans every frame for the input, so an unresponsive one holds it open exactly
      // as it would the upload itself -- and it is queued ahead of that bounded upload, so without a
      // bound of its own the tab never reaches the operation the timeout was meant to protect.
      boundEngineOperation(
        tab,
        tab.engine.resolveUploadTarget(target),
        timeoutMs,
        "Browser upload target resolution timed out.",
        keepQueueBlocked,
      ),
    );
  }).bind(this);

  readonly destroy = Effect.fn("BrowserHost.destroy")(function* (this: BrowserHost) {
    if (this.#destroying) return yield* Deferred.await(this.#destroying);
    const done = Deferred.makeUnsafe<void, BrowserOperationError>();
    this.#destroying = done;
    clearInterval(this.#idleTabSweep);
    const result = yield* Effect.exit(
      Effect.gen({ self: this }, function* () {
        // Capture the persisted tab list before removing native views.
        const persistence = yield* Effect.forkIn(this.#persistState(), this.#scope, { startImmediately: true });
        const drains = [...this.#closingTabDrains.values()].map(Fiber.join);
        this.#session.flushStorageData();
        for (const tab of this.#tabs.values()) {
          tab.closing = true;
          this.#unmountView(tab.view);
          drains.push(
            Effect.gen(function* () {
              yield* Deferred.await(tab.queue);
              yield* tab.engine.destroy();
              yield* Scope.close(tab.scope, Exit.void);
              if (!tab.contents.isDestroyed()) tab.contents.close();
            }),
          );
        }
        this.#tabs.clear();
        this.#listeners.clear();
        this.#controls.dispose();
        this.#documentListeners.clear();
        this.#siteVisitListeners.clear();
        const results = yield* Effect.all(
          [
            browserCall(() => this.#session.cookies.flushStore()),
            Fiber.join(persistence),
            Effect.all(drains.map(Effect.exit), { concurrency: "unbounded" }).pipe(
              Effect.flatMap((results) =>
                this.#recorder.destroy().pipe(
                  Effect.andThen(
                    Effect.suspend(() => {
                      const failure = results.find(Exit.isFailure);
                      return failure ? Effect.failCause(failure.cause) : Effect.void;
                    }),
                  ),
                ),
              ),
            ),
          ].map(Effect.exit),
          { concurrency: "unbounded" },
        );
        this.#closingTabDrains.clear();
        this.#session.flushStorageData();
        yield* this.#persistLock.withPermit(Effect.void);
        yield* Scope.close(this.#scope, Exit.void);
        const failure = results.find(Exit.isFailure);
        if (failure) return yield* Effect.failCause(failure.cause);
      }).pipe(Effect.uninterruptible),
    );
    yield* Deferred.done(done, result);
    return yield* result;
  }, Effect.uninterruptible).bind(this);

  readonly flushPersistentStorage = Effect.fn("BrowserHost.flushPersistentStorage")(function* (
    this: BrowserHost,
  ): Effect.fn.Return<void, BrowserOperationError> {
    this.#session.flushStorageData();
    yield* browserCall(() => this.#session.cookies.flushStore());
    yield* this.#persistState();
  }).bind(this);

  #createTab(
    id: string,
    requestedUrl: string,
    ownerThreadId: string | null,
    ownerAgentId: string | null,
    environment: BrowserEnvironment = defaultBrowserEnvironment(),
    popupOptions?: BrowserWindowConstructorOptions,
  ): BrowserHostTab {
    if (this.#destroying) throw new Error("BrowserHost is shutting down.");
    const view = this.#createView(popupOptions);
    this.#mountView(view);
    const diagnostics = new BrowserDiagnostics();
    const queue = Deferred.makeUnsafe<void>();
    Deferred.doneUnsafe(queue, Exit.void);
    return {
      id,
      view,
      contents: view.webContents,
      popup: popupOptions !== undefined,
      requestedUrl,
      ownerThreadId,
      ownerAgentId,
      revision: 0,
      queue,
      scope: Scope.makeUnsafe(),
      pendingOperations: 0,
      focusOnVisible: false,
      environment,
      engine: new BrowserCdpEngine(view.webContents),
      diagnostics,
      recording: false,
      captureGeneration: 0,
      documents: 0,
      viewInvalidations: new Set(),
      lastUsedAt: Date.now(),
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
    // One identity for pages, frames and workers. It keeps the build token that Google needs
    // and drops the product token that Framer refuses; the languages come from the system.
    // Service workers read the process fallback instead of the session, so it changes too.
    app.userAgentFallback = sessionBrowserUserAgent(app.userAgentFallback);
    this.#session.setUserAgent(sessionBrowserUserAgent(this.#session.getUserAgent()), preferredBrowserLanguageCodes());
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

  #bindTabEvents(tab: BrowserHostTab): void {
    const contents = tab.contents;
    const changed = () => this.#emitChanged();
    contents.on("close", () => {
      tab.closing = true;
    });
    contents.once("destroyed", () => {
      // Finish native destruction before removing the view and draining queued work.
      setImmediate(() => {
        void runCauseEffect(this.close(tab.id)).catch((error) =>
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
      void runCauseEffect(
        this.#enqueue(tab.id, (queuedTab, keepQueueBlocked) =>
          boundEngineOperation(
            queuedTab,
            queuedTab.engine.documentIds(),
            DOCUMENT_ENUMERATION_TIMEOUT_MS,
            "Browser document enumeration timed out.",
            keepQueueBlocked,
          ),
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
      setImmediate(() => void runCauseEffect(this.close(tab.id)).catch(() => undefined));
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
      Effect.runFork(
        this.#syncViewBackground(tab).pipe(Effect.ignore, Effect.forkIn(tab.scope, { startImmediately: true })),
      );
    });
    contents.on("console-message", (...eventArgs) => {
      if (this.#takeoverTabIds.has(tab.id) || tab.secret) return;
      const details = readConsoleMessage(eventArgs);
      if (!details) return;
      tab.diagnostics.add({
        kind: "console",
        level: details.level,
        message: details.message,
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
      tab.documents += 1;
      if (tab.secretDocument) {
        tab.secretDocument = false;
        contents.navigationHistory.clear();
      }
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
      this.#noteSiteVisit(tab, url);
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
      if (this.#destroying || this.#tabs.get(tab.id) !== tab) return { action: "deny" };
      const unsupported = !["foreground-tab", "background-tab", "new-window"].includes(disposition);
      const failure = tab.secret
        ? sourceText("error.backend.popupSecureInput")
        : unsupported
          ? sourceText("error.backend.popupUnsupportedType")
          : !isAllowedMainUrl(url)
            ? sourceText("error.backend.popupUnsupportedAddress")
            : !this.#hasTabCapacity(tab.ownerThreadId, tab.ownerAgentId)
              ? sourceText("error.backend.popupTabLimit")
              : this.#memoryLow()
                ? sourceText("error.backend.browserLowMemory")
                : undefined;
      if (failure) {
        tab.popupFailure = { id: randomUUID(), message: failure };
        this.#emitChanged();
        return { action: "deny" };
      }
      // Electron supplies the opener preferences and navigates the returned contents itself.
      // Reopening the URL loses WindowProxy, POST bodies, and OAuth callback messages.
      let popup: BrowserHostTab | undefined;
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
          if (options.webContents?.opener) {
            popup.openerTabId = tab.id;
            popup.hasSharedBrowsingContext = true;
            tab.hasSharedBrowsingContext = true;
          }
          this.#tabs.set(popup.id, popup);
          this.#bindTabEvents(popup);
          tab.popupFailure = undefined;
          this.#activeTabId = popup.id;
          popup.focusOnVisible = true;
          this.#syncAttachedView();
          this.#emitChanged();
          this.#schedulePersist();
          const created = popup;
          void runCauseEffect(
            enqueueTabOperation(created, () => created.engine.setEnvironment(created.environment), true),
          ).catch((error) => {
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
                  message: sourceText("error.backend.popupLoadFailed"),
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
  #collapseOnEscape(tab: BrowserHostTab): void {
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
  #collapsesOnEscape(tab: BrowserHostTab): boolean {
    return this.#target === "main" && this.#visible && this.#activeTabId === tab.id && this.#attachedView === tab.view;
  }

  readonly #syncViewBackground = Effect.fn("BrowserHost.syncViewBackground")(function* (
    this: BrowserHost,
    tab: BrowserHostTab,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* Effect.gen({ self: this }, function* () {
      const background = yield* browserCall(() =>
        tab.contents.executeJavaScript(
          `(() => {
          const transparent = "rgba(0, 0, 0, 0)";
          const body = document.body ? getComputedStyle(document.body).backgroundColor : transparent;
          if (body !== transparent) return body;
          const root = getComputedStyle(document.documentElement).backgroundColor;
          return root !== transparent ? root : "#0b0b0b";
        })()`,
          true,
        ),
      );
      if (isString(background)) tab.view.setBackgroundColor(background);
    }).pipe(Effect.catch(() => Effect.void));
  });

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

  #focusTab(tab: BrowserHostTab): void {
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

  readonly #requireTab = Effect.fn("BrowserHost.requireTab")(function* (this: BrowserHost, tabId: string) {
    const tab = this.#tabs.get(tabId);
    if (!tab) return yield* browserFailure(new Error(`Unknown browser tab: ${tabId}`));
    yield* this.#wake(tab);
    tab.lastUsedAt = Date.now();
    return tab;
  });

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

  readonly #enqueue = Effect.fn("BrowserHost.enqueue")(function* <T>(
    this: BrowserHost,
    tabId: string,
    operation: (tab: BrowserHostTab, keepQueueBlocked: KeepQueueBlocked) => Effect.Effect<T, BrowserOperationError>,
    allowProtected = false,
  ) {
    const tab = yield* this.#requireTab(tabId);
    return yield* enqueueTabOperation(tab, operation, allowProtected);
  });

  readonly #runAction = Effect.fn("BrowserHost.runAction")(function* (
    this: BrowserHost,
    tabId: string,
    action: string,
    target: BrowserTarget | undefined,
    operation: (
      tab: BrowserHostTab,
      deadline: number,
      markDispatched: () => void,
    ) => Effect.Effect<void, BrowserOperationError>,
    timeoutMs?: number,
    onOperationStarted?: (completion: Fiber.Fiber<void, BrowserOperationError>) => void,
  ): Effect.fn.Return<BrowserSnapshot | { tabId: string; closed: true; openerTabId?: string }, BrowserOperationError> {
    const tab = yield* this.#requireTab(tabId);
    return yield* runTabAction(
      tab,
      () => this.#focusedContentsOutsideTabs(),
      action,
      target,
      operation,
      timeoutMs,
      onOperationStarted,
    );
  });

  readonly #runEvaluation = Effect.fn("BrowserHost.runEvaluation")(function* (
    this: BrowserHost,
    tabId: string,
    expression: string,
    awaitPromise: boolean,
    timeoutMs: number,
  ): Effect.fn.Return<BrowserJsonValue, BrowserOperationError> {
    const tab = yield* this.#requireTab(tabId);
    // The origin is read in the tab's queue, just before the script runs, and again when it ends: a
    // navigation queued before it, or one that commits while it runs, decides where it ran.
    const markScripted = () => {
      const origin = urlOrigin(currentTabUrl(tab));
      if (origin) this.#agentScriptedOrigins.add(origin);
    };
    return yield* runTabEvaluation(
      tab,
      () => {
        this.#requireNoSecretDocument(tab, "Page evaluation");
        markScripted();
      },
      expression,
      awaitPromise,
      timeoutMs,
    ).pipe(Effect.ensuring(Effect.sync(markScripted)));
  });

  /** The app contents that has focus, unless it is one of the browser's own tabs. */
  #focusedContentsOutsideTabs(): WebContents | null {
    const focusedContents = webContents.getFocusedWebContents();
    return focusedContents && ![...this.#tabs.values()].some((candidate) => candidate.contents === focusedContents)
      ? focusedContents
      : null;
  }

  #noteSiteVisit(tab: BrowserHostTab, url: string): void {
    if (this.#siteVisitListeners.size === 0) return;
    let hostname: string;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      hostname = parsed.hostname;
    } catch {
      return;
    }
    if (!hostname || tab.visitedHost === hostname) return;
    tab.visitedHost = hostname;
    const driven = this.#controls
      .state()
      .sessions.some(
        (session) => session.tabId === tab.id || (session.tabId === null && session.threadId === tab.ownerThreadId),
      );
    const visit: BrowserSiteVisit = {
      tabId: tab.id,
      hostname,
      actor: driven ? "agent" : "user",
      agentId: driven ? tab.ownerAgentId : null,
    };
    for (const listener of this.#siteVisitListeners) {
      try {
        listener(visit);
      } catch {
        // Analytics must never stop a navigation.
      }
    }
  }

  #emitChanged(): void {
    const tabs = this.listTabs();
    for (const listener of this.#listeners) listener(tabs, this.#activeTabId);
  }

  #schedulePersist(): void {
    if (this.#destroying) return;
    void runCauseEffect(
      Effect.forkIn(
        this.#persistState().pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              logger.error("Unable to persist browser tabs:", toLogValue(error.cause));
            }),
          ),
        ),
        this.#scope,
        { startImmediately: true, uninterruptible: true },
      ),
    );
  }

  readonly #persistState = Effect.fn("BrowserHost.persistState")(function* (this: BrowserHost) {
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
    yield* this.#persistLock.withPermit(
      writeJsonFileAtomically(this.#statePath, state).pipe(Effect.mapError((error) => browserFailure(error.cause))),
    );
  });
}

function currentPreviewPage(tab: BrowserHostTab): BrowserPreviewPage {
  return { url: currentTabUrl(tab), document: tab.documents, generation: tab.captureGeneration };
}

function showsCurrentPage(tab: BrowserHostTab, page: BrowserPreviewPage): boolean {
  const current = currentPreviewPage(tab);
  return page.url === current.url && page.document === current.document && page.generation === current.generation;
}
const loadSavedPage = Effect.fn("BrowserHost.loadSavedPage")(function* (tab: BrowserHostTab) {
  yield* browserCall(() => tab.contents.loadURL("about:blank"));
  yield* tab.engine.setEnvironment(tab.environment);
  yield* tab.engine.navigate(tab.requestedUrl);
  yield* browserSync(() => tab.contents.navigationHistory.clear());
});

/** The saved preview frame, when it still shows the tab's current page. */
function savedPreview(tab: BrowserHostTab): BrowserPreview | null {
  return tab.preview && showsCurrentPage(tab, tab.preview) ? tab.preview.frame : null;
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

/**
 * Returns the last two host labels, or the whole host for an IP address. Without the public suffix
 * list, this can join two sites (for example under `co.uk`) but never splits one site, so a match
 * can only refuse secure input, not permit it.
 */
function approximateSite(origin: string): string {
  const hostname = new URL(origin).hostname;
  if (isIP(hostname.replace(/^\[|\]$/gu, "")) !== 0) return hostname;
  return hostname.split(".").slice(-2).join(".");
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

function navigateHistory(contents: WebContents, direction: BrowserNavigationDirection): boolean {
  const history = contents.navigationHistory;
  const offset = direction === "back" ? -1 : 1;
  if (!history.canGoToOffset(offset)) return false;
  const entry = history.getEntryAtIndex(history.getActiveIndex() + offset);
  if (!entry?.url) return false;
  history.goToOffset(offset);
  return true;
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
