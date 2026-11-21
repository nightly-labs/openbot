import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { basename, extname, join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentBrowserProfile,
  BrowserBounds,
  BrowserControlState,
  BrowserElement,
  BrowserEnvironment,
  BrowserImageMode,
  BrowserJsonValue,
  BrowserNavigationDirection,
  BrowserPreview,
  BrowserProxyFailure,
  BrowserSecretRequest,
  BrowserSiteMemory,
  BrowserSnapshot,
  BrowserTab,
  BrowserTarget,
  BrowserTeachStep,
  BrowserViewTarget,
  BrowserVisibilityInput,
} from "@openbot/contracts/ipc";
import { isNumber, isString } from "@openbot/contracts/runtime-values";
import type { BrowserSignInStorage } from "@openbot/contracts/team-protocol/browser-sign-in-storage-v1";
import {
  type BrowserSignInCookie,
  browserSignInCookieFitsHost,
} from "@openbot/contracts/team-protocol/browser-sign-in-v1";
import {
  BROWSER_VIEW_CONTEXT_MENU_URL_MAX_LENGTH,
  type BrowserViewContextMenu,
  type BrowserViewCursor,
  type BrowserViewViewport,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Exit, Fiber, Option, Result, Scope, Semaphore } from "effect";
import {
  app,
  BaseWindow,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  clipboard,
  type Event as ElectronEvent,
  screen as electronScreen,
  type Input,
  Menu,
  type NativeImage,
  nativeImage,
  type Rectangle,
  type Session,
  session,
  type WebContents,
  WebContentsView,
  type WebContentsWillFrameNavigateEventParams,
  webContents,
} from "electron";
import { writeJsonFileAtomically } from "./atomic-json-file";
import type { BrowserCardFillResult } from "./browser-card-fill";
import {
  BrowserCdpEngine,
  type BrowserScreencastFrame,
  type BrowserUploadAssignment,
  type BrowserViewportInput,
  SNAPSHOT_NAVIGATED_MESSAGE,
  type SnapshotReadResult,
} from "./browser-cdp";
import { refuseCookieBanners, stopCookieBanners } from "./browser-consent";
import { BrowserControlSessions } from "./browser-control-sessions";
import { browserViewCursor } from "./browser-cursor";
import { BrowserDiagnostics } from "./browser-diagnostics";
import { type BrowserOperationError, browserCall, browserFailure, browserSync } from "./browser-effects";
import {
  type BrowserHostTab,
  type BrowserPreviewPage,
  currentTabUrl,
  hasHistoryEntry,
  type KeepQueueBlocked,
  restoreWebContentsFocus,
  toPublicTab,
} from "./browser-host-tab";
import { BrowserHintRequests, sessionBrowserUserAgent } from "./browser-identity";
import { describeBrowserTarget, navigateAndWait, waitForLoading } from "./browser-navigation";
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
import {
  type BrowserProxyRelay,
  openBrowserProxyRelay,
  type RelayExit,
  type RelayExitFailure,
  socksExit,
} from "./browser-profiles/browser-proxy-relay";
import type { BrowserProxyConnection } from "./browser-profiles/browser-proxy-store";
import { BrowserRecorder, recordingFrameSize } from "./browser-recorder";
import {
  BROWSER_PAGE_CRASH_KEPT,
  BROWSER_PAGE_CRASH_RELOADED,
  BROWSER_SCRIPT_USER_CONTROL_ERROR,
  type BrowserScriptResult,
  type BrowserStepOutcome,
  runBrowserScript,
} from "./browser-script";
import {
  type BrowserContextMenuItem,
  browserContextMenuItems,
  EDITABLE_FOCUS_SCRIPT,
  isBrowserViewShortcut,
  isCloseBrowserTabShortcut,
  isCollapseBrowserShortcut,
  isGlobalSearchShortcut,
  isToggleDevToolsShortcut,
} from "./browser-shortcuts";
import {
  agentBrowserSessionKey,
  type BrowserTabOwner,
  type BrowserTabSession,
  browserTabPartition,
  defaultBrowserEnvironment,
  isPersistableBrowserUrl,
  persistentBrowserUrl,
  readBrowserState,
  reownStoredBrowserTab,
  resolveEnvironment,
  type StoredBrowserStateV2,
  storedSessionFields,
  storedTabSession,
} from "./browser-state";
import {
  type ActionResultReader,
  BrowserDialogTurn,
  type BrowserFillFieldsResult,
  BrowserSiteMemories,
  BrowserToolHold,
  BrowserToolQueueWait,
  BrowserUserControlHeld,
  boundEngineOperation,
  type DialogTabResult,
  dialogTabResult,
  enqueueTabOperation,
  hasCurrentImage,
  isTimeoutError,
  markImageTaken,
  passImageOn,
  readActionSnapshot,
  readActionStatus,
  readTabSnapshot,
  remainingTime,
  runTabAction,
  runTabEvaluation,
  runTabFillFields,
  skipActionResult,
} from "./browser-tab-operations";
import {
  type BrowserCardVault,
  type BrowserDynamicToolHooks,
  type BrowserInputCall,
  browserInputAction,
  browserToolTimeout,
} from "./browser-tool-actions";
import { repairBrowserToolInput } from "./browser-tool-input";
import {
  BROWSER_SCRIPT_DEFAULT_TIMEOUT_MS,
  BROWSER_SCRIPT_EVALUATE_MAX_BYTES,
  BROWSER_SCRIPT_MAX_STEPS,
  type BrowserStep,
  type BrowserToolArguments,
  type BrowserToolCall,
  parseBrowserToolArguments,
  parseBrowserToolCall,
} from "./browser-tools";
import { runCauseEffect } from "./effect-boundary";
import {
  BROWSER_STRING_MORE,
  BROWSER_VALUE_MORE,
  BROWSER_VALUE_TEXT_LIMIT,
  cutModelText,
  jsonStringFit,
  type ModelTextCut,
} from "./model-text-limit";
import { isWebProtocol, websiteMatchesOrigin } from "./password-vault";
import { allowPinchZoom, blockPinchZoom } from "./pinch-zoom";
import type { DynamicToolCallParams, DynamicToolResult } from "./protocol";
import { isRecord } from "./protocol";
import { stepPlace, stepText, type UserBrowsingStep } from "./user-browsing-log";
import type { VaultCardSecret } from "./vault-items";

interface BrowserHostEvents {
  changed: [tabs: BrowserTab[], activeTabId: string | null];
  controlChanged: [state: BrowserControlState];
  documentChanged: [tabId: string, documentIds: ReadonlySet<string>];
  siteVisited: [visit: BrowserSiteVisit];
}

export interface BrowserSiteVisit {
  tabId: string;
  hostname: string;
  actor: "agent" | "user";
  agentId: string | null;
}

const MAX_ENCODED_CAPTURE_PIXELS = 4_194_304;
const MIN_CAPTURE_SIDE = 64;
const DOCUMENT_ENUMERATION_TIMEOUT_MS = 10_000;
const PREVIEW_STALE_AFTER_MS = 1_000;
const VIEW_FRAME_QUALITY = 60;
const VIEW_FRAME_MAX_WIDTH = 1_280;
const VIEW_FRAME_MAX_HEIGHT = 800;
const TAB_SET_TOOLS: ReadonlySet<string> = new Set(["open", "list_tabs", "status"]);
const VIEW_CONTEXT_MENU_MS = 1_500;
const DIALOG_ACTION_WAIT_MS = 10_000;
const OPEN_REDIRECT_WAIT_MS = 5_000;
const SIGN_IN_STORAGE_WRITE_TIMEOUT_MS = 5_000;
const SERVICE_WORKER_CLEAR_WAIT_MS = 10_000;
const OPEN_REDIRECT_READS = 2;
const TOOL_QUEUE_WAIT_MS = 120_000;
const CLOSE_QUEUE_WAIT_MS = 10_000;
const CLOSED_PAGE_DRAIN_MS = 2_000;
const FORWARDED_KEY_CODES: Partial<Record<string, string>> = { ArrowLeft: "Left", ArrowRight: "Right" };
const MAX_ACTIVE_DOWNLOADS = 4;
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const DOWNLOAD_TOO_LARGE =
  "Download stopped: the file is larger than 2 GiB, the download limit of this browser. No file was saved. The user can download it in their own web browser.";

export interface BrowserViewOptions {
  onCursor?: (cursor: BrowserViewCursor) => void;
  viewport?: BrowserViewViewport;
  onPageCopy?: (text: string) => void;
}

function menuAddress(value: string): string | undefined {
  if (!value || value.length > BROWSER_VIEW_CONTEXT_MENU_URL_MAX_LENGTH) return undefined;
  return /^https?:\/\//iu.test(value) ? value : undefined;
}

function viewContextMenu(
  items: readonly BrowserContextMenuItem[],
  linkUrl: string,
  srcUrl: string,
): BrowserViewContextMenu {
  const link = menuAddress(linkUrl);
  const image = menuAddress(srcUrl);
  return {
    items: items.filter(
      (item): item is BrowserViewContextMenu["items"][number] =>
        item !== "separator" &&
        (item !== "copy-link" || link !== undefined) &&
        (item !== "copy-image-address" || image !== undefined),
    ),
    ...(link === undefined ? {} : { link }),
    ...(image === undefined ? {} : { image }),
  };
}
const IDLE_TAB_SLEEP_MS = 15 * 60_000;
const LOW_MEMORY_TAB_SLEEP_MS = 5 * 60_000;
const IDLE_TAB_SWEEP_MS = 60_000;
const MAX_IDLE_AWAKE_TABS = 3;
const AWAKE_TAB_GRACE_MS = 2 * 60_000;
const IDLE_TAB_FREEZE_MS = 2 * 60_000;
const IDLE_UNLOAD_NOTE =
  "Note: this tab was not used for some time, so its page was unloaded to free memory and loaded again from its address. Scripts that you injected, page variables, form input and the tab history from before are gone. Set them up again if you need them. An idle tab unloads sooner when several other tabs are open: close the tabs that you no longer need.";
const PAGE_CLOSED_TAB_ERROR = (tabId: string) =>
  `Browser tab ${tabId} is closed: the page in it closed its own tab (a script of the site called window.close()). The browser did not fail. Open the address again if you need the page. A site that closes its tab each time does not let an automated browser use it.`;
const PAGE_CLOSED_TAB_LIMIT = 32;
const PROXY_ERROR_LIST: readonly (readonly [name: string, code: number, failure: BrowserProxyFailure])[] = [
  ["net::ERR_PROXY_CONNECTION_FAILED", -130, "unreachable"],
  ["net::ERR_SOCKS_CONNECTION_FAILED", -120, "unreachable"],
  ["net::ERR_TUNNEL_CONNECTION_FAILED", -111, "unreachable"],
  ["net::ERR_PROXY_AUTH_UNSUPPORTED", -115, "signIn"],
  ["net::ERR_PROXY_AUTH_REQUESTED", -127, "signIn"],
  ["net::ERR_PROXY_AUTH_REQUESTED_WITH_NO_CONNECTION", -134, "signIn"],
  ["net::ERR_PROXY_CERTIFICATE_INVALID", -136, "unreachable"],
  ["net::ERR_MANDATORY_PROXY_CONFIGURATION_FAILED", -131, "unreachable"],
];
const PROXY_ERRORS = new Map(PROXY_ERROR_LIST.map(([name, , failure]) => [name, failure]));
const PROXY_ERROR_CODES = new Map(PROXY_ERROR_LIST.map(([, code, failure]) => [code, failure]));

function chromiumErrorCode(text: string): number | undefined {
  const code = /\((-\d+)\)/u.exec(text)?.[1];
  return code === undefined ? undefined : Number(code);
}

function proxyErrorInText(text: string): BrowserProxyFailure | undefined {
  const name = /\bERR_[A-Z_]+/u.exec(text)?.[0];
  if (name !== undefined) return PROXY_ERRORS.get(`net::${name}`);
  const code = chromiumErrorCode(text);
  return code === undefined ? undefined : PROXY_ERROR_CODES.get(code);
}

function certificateLoadFailure(failure: BrowserOperationError): BrowserOperationError {
  const code = chromiumErrorCode(String(failure.cause));
  return code !== undefined && code <= -200 && code > -300
    ? browserFailure(new Error(sourceText("error.backend.browserCertificateUntrusted")))
    : failure;
}

const PROXY_SIGN_IN_ANSWERS = 8;

function proxyRules(proxy: Extract<BrowserProxyConnection, { kind: "address" }>): string {
  return `${proxy.scheme}://${proxy.host}:${proxy.port}`;
}

interface AppliedProxy {
  key: string;
  proxy: BrowserProxyConnection | null;
  signIn: { host: string; port: number; username: string; password: string } | null;
  relay: BrowserProxyRelay | null;
}

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
  backgroundThrottling: false,
};

const USES_BACKGROUND_WINDOW =
  process.platform === "darwin" || process.platform === "win32" || process.platform === "linux";

const SHOWS_VIEWS_IN_BACKGROUND = process.platform === "linux";

function createBackgroundWindow(): BaseWindow {
  const window = new BaseWindow({
    show: false,
    ...(process.platform === "win32" ? { type: "toolbar" } : {}),
    frame: false,
    transparent: true,
    hasShadow: false,
    focusable: false,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
  });
  window.setIgnoreMouseEvents(true);
  window.setOpacity(0);
  if (process.platform === "darwin") window.excludedFromShownWindowsMenu = true;
  return window;
}

const MIN_HIDDEN_VIEWPORT = { width: 800, height: 600 };
const CHROME_TOOLBAR_HEIGHT = 85;

function browserWebPreferences(preload: string | undefined) {
  return preload === undefined
    ? BROWSER_WEB_PREFERENCES
    : { ...BROWSER_WEB_PREFERENCES, preload, nodeIntegrationInSubFrames: true };
}

export interface PreparedBrowserSecret {
  request: BrowserSecretRequest;
  agentScriptedOrigin: boolean;
  vaultFillable: boolean;
  withCode: boolean;
  submit(secret: string, vault: boolean, code?: string): Effect.Effect<"submitted" | "takeover", BrowserOperationError>;
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

function runBrowserTool<Name extends BrowserToolName>(
  handlers: BrowserToolHandlers,
  tool: Name,
  call: BrowserToolCallOf<Name>,
  params: DynamicToolCallParams,
  hooks: BrowserDynamicToolHooks,
): Effect.Effect<DynamicToolResult, BrowserOperationError> {
  return handlers[tool](call, params, hooks);
}

const AGENT_CODE_CARD_FILL =
  "Card fill is unavailable while a script from evaluate can still run in this page or in another open page of this site. First close or navigate each other tab of this site, also a popup or opener tab where you did not run evaluate. A tab of another chat or agent can also block the fill, and list_tabs does not show it: when no other tab of this site is in list_tabs, ask the user to close the other tabs of this site. Then reload this page with navigate direction=reload, not with evaluate or by opening its address again, take a fresh snapshot, and call fill_card again, or use request_takeover.";

function frameOrigins(contents: WebContents): string[] {
  if (contents.isDestroyed() || contents.mainFrame.isDestroyed()) return [];
  return contents.mainFrame.framesInSubtree.flatMap((frame) => (frame.isDestroyed() ? [] : [frame.origin]));
}

function markScriptedOrigin(tab: BrowserHostTab, origin: string): void {
  const origins = tab.scriptedOrigins ?? new Set<string>();
  origins.add(origin);
  tab.scriptedOrigins = origins;
}

function markWorkerExposedOrigin(tab: BrowserHostTab, origin: string): void {
  const origins = tab.workerExposedOrigins ?? new Set<string>();
  origins.add(origin);
  tab.workerExposedOrigins = origins;
}

function urlOrigin(value: string): string | null {
  return URL.canParse(value) ? new URL(value).origin : null;
}

function urlCarriesSecret(url: string, secret: string): boolean {
  if (url.includes(secret)) return true;
  try {
    if (decodeURIComponent(url.replaceAll("+", " ")).includes(secret)) return true;
  } catch {}
  try {
    return [...new URL(url).searchParams.values()].some((value) => value.includes(secret));
  } catch {
    return false;
  }
}

function rejectTakeoverTool(): Effect.Effect<DynamicToolResult, BrowserOperationError> {
  return Effect.fail(
    browserFailure(new Error("Browser takeover is handled by the agent service, not the browser host.")),
  );
}

export interface BrowserUserBrowsing {
  enabled(): boolean;
  record(agentId: string, step: Omit<UserBrowsingStep, "at">): void;
}

export type BrowserUserControlHolder = { kind: "local" } | { kind: "member"; memberId: string; sessionId: string };
export type { BrowserTeachStep };

const TEACH_MAX_STEPS = 200;
const TEACH_MAX_DURATION_MS = 10 * 60 * 1000;
interface BrowserTeachRecording {
  holder: BrowserUserControlHolder;
  startedAt: number;
  steps: BrowserTeachStep[];
}
function sameUserControlHolder(left: BrowserUserControlHolder, right: BrowserUserControlHolder): boolean {
  if (left.kind === "local" || right.kind === "local") return left.kind === right.kind;
  return left.sessionId === right.sessionId && left.memberId === right.memberId;
}
export type BrowserUserControlOwner =
  | { kind: "local" }
  | { kind: "session"; sessionId: string }
  | { kind: "member"; memberId: string };

export interface BrowserMainPage {
  tabId: string;
  bounds: Rectangle;
  zoomFactor: number;
}

function drivenByAgent(state: BrowserControlState, tab: BrowserHostTab): boolean {
  return state.sessions.some(
    (session) => session.tabId === tab.id || (session.tabId === null && session.threadId === tab.ownerThreadId),
  );
}

const THIS_CHAT = "this chat";
const NO_CHAT = "none";
const OTHER_CHAT_TABS_NOTE =
  'A tab whose chat is not "this chat" belongs to another chat of this agent, and this chat can use it. When otherChatWorking is true, another chat used the tab in the last 2 minutes and can still work in it: do not navigate, type in, or close it. Open a new tab instead, or wait.';
const OTHER_CHAT_WORKING_MS = 120_000;

type ToolTab = BrowserTab & { chat: string; otherChatWorking?: true };

export interface BrowserAgentChat {
  agentId: string;
  sideThread: { taskId: string; title: string } | null;
}

export class BrowserHost {
  static readonly CONTROL_IDLE_GRACE_MS = BrowserControlSessions.IDLE_GRACE_MS;
  readonly #window: BrowserWindow;
  readonly #session: Session;
  readonly #tabSessions = new Map<string, Session>();
  readonly #browserProfile: (agentId: string) => AgentBrowserProfile;
  readonly #profileExists: (profileId: string) => boolean;
  readonly #agentChat: (threadId: string) => BrowserAgentChat | null;
  readonly #profileProxy: (profileId: string) => BrowserProxyConnection | null;
  readonly #onProxyStatusChanged: () => void;
  readonly #computerExit: (memberId: string) => RelayExit;
  readonly #appliedProxies = new Map<string, AppliedProxy>();
  readonly #proxyLock = Semaphore.makeUnsafe(1);
  readonly #proxyFailures = new Map<string, { failure: BrowserProxyFailure; memberId: string | null }>();
  readonly #proxySignInRefused = new WeakSet<BrowserHostTab>();
  readonly #quitShortcut: (input: Input) => boolean;
  readonly #siteMemories: (agentId: string, hostname: string) => BrowserSiteMemory[];
  readonly #userBrowsing: BrowserUserBrowsing | null;
  readonly #hideFromWindowSwitchers: (window: BaseWindow) => void;
  readonly #downloadsRoot: string;
  readonly #statePath: string;
  #stateWritePath: string;
  readonly #tabs = new Map<string, BrowserHostTab>();
  readonly #closingTabDrains = new Map<string, Fiber.Fiber<void, BrowserOperationError>>();
  readonly #listeners = new Set<(...args: BrowserHostEvents["changed"]) => void>();
  readonly #documentListeners = new Set<(...args: BrowserHostEvents["documentChanged"]) => void>();
  readonly #siteVisitListeners = new Set<(...args: BrowserHostEvents["siteVisited"]) => void>();
  readonly #controls = new BrowserControlSessions();
  readonly #reservedDownloadPaths = new Set<string>();
  #activeDownloads = 0;
  readonly #recorder: BrowserRecorder;
  #activeTabId: string | null = null;
  #visible = false;
  #bounds: BrowserBounds | null = null;
  #attachedView: WebContentsView | null = null;
  #pictureInPictureWindow: BrowserWindow | null = null;
  #pictureInPictureShortcuts = false;
  #pictureInPictureOverlayView: WebContentsView | null = null;
  #mainPageListener: ((page: BrowserMainPage | null) => void) | null = null;
  #target: BrowserViewTarget = "main";
  readonly #mountedViews = new Map<WebContentsView, BrowserWindow>();
  #backgroundWindow: BaseWindow | null = null;
  #mainViewsInBackground = false;
  #attachedViewShown = false;
  readonly #takeoverTabIds = new Set<string>();
  readonly #takeoverSignInTabIds = new Set<string>();
  readonly #userControlTabIds = new Map<string, BrowserUserControlHolder>();
  readonly #teachRecordings = new Map<string, BrowserTeachRecording>();
  readonly #userControlWaiters = new Map<string, Set<Deferred.Deferred<void>>>();
  readonly #cacheTaintedOrigins = new WeakMap<Session, Set<string>>();
  readonly #originPurges = new WeakMap<Session, Map<string, Promise<boolean>>>();
  #persistLock = Semaphore.makeUnsafe(1);
  readonly #scope = Scope.makeUnsafe();
  #destroying: Deferred.Deferred<void, BrowserOperationError> | null = null;
  readonly #pageClosedTabs = new Map<
    string,
    { ownerThreadId: string | null; ownerAgentId: string | null; sharedThreadIds: ReadonlySet<string> }
  >();
  readonly #memoryLow: () => boolean;
  readonly #tabLimit: () => number;
  readonly #idleTabSweep: NodeJS.Timeout;
  readonly #awakeTabGraceMs: number;
  readonly #idleTabFreezeMs: number;
  readonly #webPreferences: ReturnType<typeof browserWebPreferences>;

  constructor(
    window: BrowserWindow,
    downloadsRoot: string,
    statePath: string,
    options: {
      recordingDurationMs?: number;
      recordingMaxConcurrent?: number;
      recordingMaxAggregateBytes?: number;
      memoryLow?: () => boolean;
      tabLimit?: () => number;
      browserProfile?: (agentId: string) => AgentBrowserProfile;
      profileExists?: (profileId: string) => boolean;
      agentChat?: (threadId: string) => BrowserAgentChat | null;
      profileProxy?: (profileId: string) => BrowserProxyConnection | null;
      onProxyStatusChanged?: () => void;
      computerExit?: (memberId: string) => RelayExit;
      quitShortcut?: (input: Input) => boolean;
      pagePreload?: string;
      tabSleep?: { sweepMs: number; awakeGraceMs: number; freezeMs?: number };
      siteMemories?: (agentId: string, hostname: string) => BrowserSiteMemory[];
      userBrowsing?: BrowserUserBrowsing;
      hideFromWindowSwitchers?: (window: BaseWindow) => void;
    } = {},
  ) {
    this.#window = window;
    if (USES_BACKGROUND_WINDOW) {
      const syncBackgroundWindow = () => {
        if (this.#syncBackgroundWindow()) this.#syncAttachedView();
      };
      window.on("hide", syncBackgroundWindow);
      window.on("show", syncBackgroundWindow);
      window.on("minimize", syncBackgroundWindow);
      window.on("restore", syncBackgroundWindow);
      window.once("closed", () => this.#closeBackgroundWindow());
    }
    this.#memoryLow = options.memoryLow ?? (() => false);
    this.#tabLimit = options.tabLimit ?? (() => INPUT_LIMITS.browserTabs);
    this.#awakeTabGraceMs = options.tabSleep?.awakeGraceMs ?? AWAKE_TAB_GRACE_MS;
    this.#idleTabFreezeMs = options.tabSleep?.freezeMs ?? IDLE_TAB_FREEZE_MS;
    this.#browserProfile = options.browserProfile ?? (() => ({ kind: "shared" }));
    this.#profileExists = options.profileExists ?? (() => false);
    this.#agentChat = options.agentChat ?? (() => null);
    this.#profileProxy = options.profileProxy ?? (() => null);
    this.#onProxyStatusChanged = options.onProxyStatusChanged ?? (() => {});
    this.#computerExit = options.computerExit ?? (() => () => Promise.reject(new Error("No computer exit")));
    this.#quitShortcut = options.quitShortcut ?? (() => false);
    this.#siteMemories = options.siteMemories ?? (() => []);
    this.#userBrowsing = options.userBrowsing ?? null;
    this.#hideFromWindowSwitchers = options.hideFromWindowSwitchers ?? (() => {});
    this.#webPreferences = browserWebPreferences(options.pagePreload);
    this.#downloadsRoot = downloadsRoot;
    this.#statePath = statePath;
    this.#stateWritePath = statePath;
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
        ...(options.recordingDurationMs === undefined ? {} : { maxRecordingMs: options.recordingDurationMs }),
        ...(options.recordingMaxConcurrent === undefined
          ? {}
          : { maxConcurrentRecordings: options.recordingMaxConcurrent }),
        ...(options.recordingMaxAggregateBytes === undefined
          ? {}
          : { maxAggregateBytes: options.recordingMaxAggregateBytes }),
      },
    );
    app.userAgentFallback = sessionBrowserUserAgent(app.userAgentFallback);
    this.#configureSession(this.#session);
    this.#controls.onChanged((state) => this.#syncAgentPinchZoom(state));
    this.#idleTabSweep = setInterval(() => {
      void runCauseEffect(this.#sleepIdleTabs()).catch((error) =>
        logger.warn("Unable to sleep browser tabs", { error: toLogValue(error) }),
      );
    }, options.tabSleep?.sweepMs ?? IDLE_TAB_SWEEP_MS);
    this.#idleTabSweep.unref();
  }

  readonly restore = Effect.fn("BrowserHost.restore")(function* (
    this: BrowserHost,
    agents: readonly BrowserTabOwner[] = [],
  ): Effect.fn.Return<void, BrowserOperationError> {
    const { state, writePath } = yield* readBrowserState(this.#statePath);
    this.#stateWritePath = writePath;
    if (state.tabs.length === 0) return;

    const tabs: BrowserHostTab[] = [];
    for (const saved of state.tabs) {
      const stored = reownStoredBrowserTab(saved, agents);
      const tabSession = storedTabSession(stored);
      if (tabSession?.kind === "profile" && !this.#profileExists(tabSession.profileId)) continue;
      if (Exit.isFailure(yield* Effect.exit(this.#applyProfileProxy(tabSession)))) {
        logger.warn("Unable to apply the proxy of a restored browser tab");
        continue;
      }
      const tab = this.#createTab(
        stored.id,
        stored.url,
        stored.ownerThreadId,
        stored.ownerAgentId,
        stored.environment,
        undefined,
        undefined,
        tabSession,
      );
      if (stored.sharedThreadIds) tab.sharedThreadIds = new Set(stored.sharedThreadIds);
      this.#tabs.set(tab.id, tab);
      this.#bindTabEvents(tab);
      tabs.push(tab);
    }
    this.#activeTabId = this.#tabs.has(state.activeTabId ?? "") ? state.activeTabId : (tabs[0]?.id ?? null);
    this.#syncAttachedView();
    this.#emitChanged();

    for (const tab of tabs) tab.pendingRestore = () => loadSavedPage(tab);
    const activeTab = this.#activeTabId ? this.#tabs.get(this.#activeTabId) : undefined;
    if (activeTab && this.#visible) yield* this.#wake(activeTab);
  }).bind(this);

  readonly #wake = Effect.fn("BrowserHost.wake")(function* (this: BrowserHost, tab: BrowserHostTab) {
    const pending = tab.pendingRestore;
    if (!pending) return;
    tab.pendingRestore = undefined;
    tab.sleeping = undefined;
    yield* Effect.forkIn(
      enqueueTabOperation(tab, pending, true).pipe(
        Effect.ignore,
        Effect.provideService(BrowserToolHold, () => false),
        Effect.provideService(BrowserToolQueueWait, undefined),
      ),
      tab.scope,
      { startImmediately: true },
    );
  });

  readonly #sleepIdleTabs = Effect.fn("BrowserHost.sleepIdleTabs")(function* (this: BrowserHost) {
    const now = Date.now();
    this.#throttleHiddenTabs(now);
    const idleMs = this.#memoryLow() ? LOW_MEMORY_TAB_SLEEP_MS : IDLE_TAB_SLEEP_MS;
    const awake: BrowserHostTab[] = [];
    for (const tab of this.#tabs.values()) {
      if (tab.pendingRestore || !this.#maySleep(tab)) continue;
      if (this.#tabInUse(tab)) tab.lastUsedAt = now;
      else if (now - tab.lastUsedAt >= idleMs) yield* this.#sleep(tab);
      else awake.push(tab);
    }
    awake.sort((left, right) => right.lastUsedAt - left.lastUsedAt);
    for (const tab of awake.slice(MAX_IDLE_AWAKE_TABS)) {
      if (now - tab.lastUsedAt >= this.#awakeTabGraceMs) yield* this.#sleep(tab);
    }
  });

  #throttleHiddenTabs(now: number): void {
    for (const tab of this.#tabs.values()) {
      if (tab.closing || tab.contents.isDestroyed() || this.#viewShown(tab.view) || this.#tabBusy(tab)) continue;
      if (!tab.contents.getBackgroundThrottling()) {
        tab.contents.setBackgroundThrottling(true);
        this.#setIdleFocus(tab, false);
      }
      if (this.#mayFreeze(tab) && now - tab.lastUsedAt >= this.#idleTabFreezeMs) this.#setFrozen(tab, true);
    }
  }

  #unthrottle(tab: BrowserHostTab): void {
    if (tab.contents.isDestroyed()) return;
    this.#thaw(tab);
    if (!tab.contents.getBackgroundThrottling()) return;
    tab.contents.setBackgroundThrottling(false);
    this.#setIdleFocus(tab, true);
  }

  #mayFreeze(tab: BrowserHostTab): boolean {
    return !tab.pendingRestore && !tab.engine.dialog && this.#maySleep(tab);
  }

  #thaw(tab: BrowserHostTab): void {
    if (!tab.engine.frozen) return;
    this.#setFrozen(tab, false);
    if (!tab.view.getVisible()) return;
    tab.view.setVisible(false);
    tab.view.setVisible(true);
  }

  #setFrozen(tab: BrowserHostTab, frozen: boolean): void {
    if (tab.closing) return;
    Effect.runFork(
      tab.engine.setFrozen(frozen).pipe(
        Effect.tapError((error) =>
          Effect.sync(() =>
            logger.warn("Unable to change the lifecycle state of a browser tab", { error: toLogValue(error) }),
          ),
        ),
        Effect.ignore,
        Effect.forkIn(tab.scope, { startImmediately: true }),
      ),
    );
  }

  #setIdleFocus(tab: BrowserHostTab, enabled: boolean): void {
    if (tab.closing) return;
    Effect.runFork(
      tab.engine.setIdleFocus(enabled).pipe(Effect.ignore, Effect.forkIn(tab.scope, { startImmediately: true })),
    );
  }

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

  #tabInUse(tab: BrowserHostTab): boolean {
    return (this.#activeTabId === tab.id && this.#viewShown(tab.view)) || this.#tabBusy(tab);
  }

  #tabBusy(tab: BrowserHostTab): boolean {
    return (
      tab.pendingOperations > (tab.previewCapture ? 1 : 0) ||
      tab.opening === true ||
      tab.viewInvalidations.size > 0 ||
      tab.recording ||
      tab.secret !== undefined ||
      tab.secretDocument === true ||
      tab.filledCard === true ||
      this.#takeoverTabIds.has(tab.id) ||
      this.#userControlTabIds.has(tab.id)
    );
  }

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
          Effect.gen({ self: this }, function* () {
            sleeping.preview =
              saved ??
              (capture ? yield* Deferred.await(capture.frame).pipe(Effect.catch(() => Effect.succeed(null))) : null);
            if (tab.sleeping !== sleeping || tab.closing || tab.contents.isDestroyed()) return;
            unloaded = true;
            tab.idleUnloadNoted = new Set();
            yield* this.#closeRenderer(tab);
          }),
        true,
      ).pipe(Effect.ignore, Effect.provideService(BrowserToolQueueWait, undefined)),
      tab.scope,
      { startImmediately: true },
    );
    this.#emitChanged();
  });

  readonly #closeRenderer = Effect.fn("BrowserHost.closeRenderer")(function* (this: BrowserHost, tab: BrowserHostTab) {
    const { view, contents, engine } = tab;
    engine.releaseDialogs();
    yield* engine.destroy();
    yield* browserSync(() => {
      if (tab.closing || this.#destroying || this.#tabs.get(tab.id) !== tab) return;
      const next = this.#createView(undefined, this.#tabSession(tab));
      this.#mountView(next);
      next.setBounds(view.getBounds());
      tab.view = next;
      tab.contents = next.webContents;
      tab.engine = engine.forContents(next.webContents);
      this.#bindTabEvents(tab);
      this.#unmountView(view);
      if (!contents.isDestroyed()) contents.close();
      this.#releaseScriptedDocument(tab);
      this.#syncAttachedView();
    });
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
    for (const tab of this.#tabs.values()) tab.engine.handOffDialogs(threadId, turnId);
  }

  clearControls(): void {
    this.#controls.clear();
    for (const tab of this.#tabs.values()) tab.engine.handOffDialogs();
  }

  isPrivate(tabId: string): boolean {
    return Boolean(this.#tabs.get(tabId)?.privateSession);
  }

  privateTab(tabId: string): string | null {
    const privateSession = this.#tabs.get(tabId)?.privateSession;
    if (!privateSession) return null;
    return (
      [...this.#tabs.values()].findLast((tab) => tab.privateSession === privateSession && !tab.closing)?.id ?? null
    );
  }

  listTabs(): BrowserTab[] {
    return [...this.#tabs.values()]
      .filter((tab) => !tab.closing && !tab.contents.isDestroyed())
      .map((tab) => {
        const publicTab = toPublicTab(tab);
        return this.#userControlTabIds.has(tab.id) ? { ...publicTab, userControl: true as const } : publicTab;
      });
  }

  tabProcessIds(): number[] {
    return [...this.#tabs.values()]
      .filter((tab) => !tab.closing && !tab.contents.isDestroyed())
      .map((tab) => tab.contents.getOSProcessId())
      .filter((pid) => pid > 0);
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

  setPictureInPictureWindow(window: BrowserWindow | null, options: { shortcuts?: boolean } = {}): void {
    this.#pictureInPictureWindow = window;
    this.#pictureInPictureShortcuts = window !== null && options.shortcuts === true;
    if (!window && this.#target === "picture-in-picture") {
      this.#visible = false;
      this.#target = "main";
      if (this.#attachedView) this.#mountView(this.#attachedView, this.#window);
    }
    this.#syncAttachedView();
  }

  setMainPageListener(listener: ((page: BrowserMainPage | null) => void) | null): void {
    this.#mainPageListener = listener;
    this.#syncAttachedView();
  }

  forwardDockShortcut(input: Input): boolean {
    if (this.#window.isDestroyed()) return false;
    if (isToggleDevToolsShortcut(input)) {
      this.#window.webContents.toggleDevTools();
      return true;
    }
    if (!isGlobalSearchShortcut(input) && !isBrowserViewShortcut(input, process.platform === "darwin")) return false;
    this.#forwardKeyToWindow(input);
    return true;
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
    return yield* this.#open(url, ownerThreadId, ownerAgentId, focus, false);
  }).bind(this);

  readonly openPrivate = Effect.fn("BrowserHost.openPrivate")(function* (
    this: BrowserHost,
    url: string,
  ): Effect.fn.Return<BrowserTab, BrowserOperationError> {
    const privateSession = session.fromPartition(`openbot-private-${randomUUID()}`, { cache: false });
    this.#configureSession(privateSession);
    return yield* this.#open(url, null, null, false, true, privateSession);
  }).bind(this);

  readonly #open = Effect.fn("BrowserHost.openTab")(function* (
    this: BrowserHost,
    url: string,
    ownerThreadId: string | null,
    ownerAgentId: string | null,
    focus: boolean,
    closeOnFailure: boolean,
    privateSession?: Session,
  ): Effect.fn.Return<BrowserTab, BrowserOperationError> {
    if (!this.#hasTabCapacity(ownerThreadId, ownerAgentId)) {
      return yield* browserFailure(new Error(sourceText("error.backend.browserTabLimit", { limit: this.#tabLimit() })));
    }
    if (this.#memoryLow()) return yield* browserFailure(new Error(sourceText("error.backend.browserLowMemory")));
    const normalizedUrl = yield* browserSync(() => normalizeBrowserUrl(url));
    const previouslyFocused = focus ? null : this.#focusedContentsOutsideTabs();
    const tabSession = privateSession || !ownerAgentId ? undefined : yield* this.#agentTabSession(ownerAgentId);
    yield* this.#applyProfileProxy(tabSession);
    const tab = this.#createTab(
      randomUUID(),
      normalizedUrl,
      ownerThreadId,
      ownerAgentId,
      defaultBrowserEnvironment(),
      undefined,
      privateSession,
      tabSession,
    );

    this.#tabs.set(tab.id, tab);
    this.#bindTabEvents(tab);
    this.#activeTabId = tab.id;
    tab.focusOnVisible = focus;
    tab.focusOnCommit = focus;
    this.#syncAttachedView();
    if (!focus) restoreWebContentsFocus(previouslyFocused, tab.contents);
    this.#emitChanged();
    return yield* Effect.gen({ self: this }, function* () {
      yield* this.#persistState();

      const loadGeneration = tab.loadGeneration;
      yield* Effect.gen({ self: this }, function* () {
        tab.opening = true;
        yield* navigateAndWait(
          tab.contents,
          () => tab.contents.loadURL(normalizedUrl, browserLoadOptions()),
          null,
        ).pipe(Effect.ensuring(Effect.sync(() => (tab.opening = false))));
        if (focus) {
          this.#focusTab(tab);
          setImmediate(() => this.#focusTab(tab));
        } else restoreWebContentsFocus(previouslyFocused, tab.contents);
      }).pipe(
        Effect.catch((operationFailure) =>
          Effect.gen({ self: this }, function* () {
            const error = operationFailure.cause;
            if (this.#tabs.get(tab.id) === tab && tab.loadGeneration !== loadGeneration) return;
            if (this.#tabs.get(tab.id) === tab && (closeOnFailure || tab.contents.isDestroyed())) {
              this.#unmountView(tab.view);
              this.#tabs.delete(tab.id);
              this.#userControlTabIds.delete(tab.id);
              this.#teachRecordings.delete(tab.id);
              this.#completeUserControlWaiters(tab.id);
              yield* tab.engine.destroy();
              tab.contents.close();
              if (this.#activeTabId === tab.id) {
                this.#activeTabId = this.#tabs.keys().next().value ?? null;
              }
              this.#syncAttachedView();
            }
            this.#emitChanged();
            yield* this.#persistState();
            const proxyFailure = this.#proxyLoadFailure(tab, operationFailure);
            if (proxyFailure !== operationFailure) return yield* proxyFailure;
            const certificateFailure = closeOnFailure ? operationFailure : certificateLoadFailure(operationFailure);
            if (certificateFailure !== operationFailure) return yield* certificateFailure;
            return yield* browserFailure(
              new Error(sourceText("error.backend.browserOpenFailed", { url: normalizedUrl, reason: String(error) })),
            );
          }),
        ),
      );

      return toPublicTab(tab);
    }).pipe(Effect.onInterrupt(() => this.close(tab.id).pipe(Effect.ignore)));
  }).bind(this);

  #hasTabCapacity(ownerThreadId: string | null, ownerAgentId: string | null): boolean {
    const tabs = [...this.#tabs.values()].filter(
      (tab) =>
        !tab.closing &&
        !tab.contents.isDestroyed() &&
        tab.ownerThreadId === ownerThreadId &&
        (tab.ownerAgentId === null || tab.ownerAgentId === ownerAgentId),
    );
    return tabs.length < this.#tabLimit();
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
    yield* this.#leaveSilentPage(tabId, direction);
    yield* this.#enqueue(tabId, (tab) =>
      Effect.gen({ self: this }, function* () {
        yield* untilStopped(
          tab,
          navigateAndWait(tab.contents, () => navigateHistory(tab.contents, direction)),
        );
      }),
    );
  }).bind(this);

  readonly loadUrl = Effect.fn("BrowserHost.loadUrl")(function* (
    this: BrowserHost,
    tabId: string,
    url: string,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const normalizedUrl = yield* browserSync(() => normalizeBrowserUrl(url));
    yield* this.#leaveSilentPage(tabId);
    yield* this.#enqueue(
      tabId,
      (tab) =>
        Effect.gen({ self: this }, function* () {
          tab.loadGeneration += 1;
          tab.focusOnCommit = true;
          yield* untilStopped(
            tab,
            navigateAndWait(tab.contents, () => tab.contents.loadURL(normalizedUrl, browserLoadOptions())),
          ).pipe(
            Effect.mapError((failure) => certificateLoadFailure(this.#proxyLoadFailure(tab, failure))),
            Effect.ensuring(
              Effect.sync(() => {
                tab.focusOnCommit = false;
              }),
            ),
          );
          this.#focusTab(tab);
        }),
      true,
    );
  }).bind(this);

  readonly reload = Effect.fn("BrowserHost.reload")(function* (
    this: BrowserHost,
    tabId: string,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#leaveSilentPage(tabId);
    yield* this.#enqueue(
      tabId,
      (tab) =>
        Effect.gen({ self: this }, function* () {
          return yield* untilStopped(
            tab,
            navigateAndWait(tab.contents, () => {
              tab.contents.reloadIgnoringCache();
              return true;
            }),
          );
        }),
      true,
    );
  }).bind(this);

  readonly importSignIn = Effect.fn("BrowserHost.importSignIn")(function* (
    this: BrowserHost,
    tabId: string,
    cookies: readonly BrowserSignInCookie[],
    storage: BrowserSignInStorage | null = null,
  ): Effect.fn.Return<{ cookies: number; storage: number }, BrowserOperationError> {
    const tab = yield* this.#requireTab(tabId);
    const page = URL.canParse(tab.contents.getURL()) ? new URL(tab.contents.getURL()) : null;
    if (!page || (page.protocol !== "https:" && page.protocol !== "http:")) return { cookies: 0, storage: 0 };
    const target = this.#tabSession(tab);
    const results = yield* Effect.forEach(
      cookies.filter((cookie) => browserSignInCookieFitsHost(cookie.domain, page.hostname)),
      (cookie) =>
        browserCall(() =>
          target.cookies.set({
            url: `${cookie.secure ? "https" : "http"}://${cookie.domain.replace(/^\./u, "")}${cookie.path}`,
            name: cookie.name,
            value: cookie.value,
            ...(cookie.domain.startsWith(".") ? { domain: cookie.domain } : {}),
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
            ...(cookie.expirationDate === null ? {} : { expirationDate: cookie.expirationDate }),
          }),
        ).pipe(Effect.match({ onSuccess: () => 1, onFailure: () => 0 })),
    );
    const count = results.reduce((total, set) => total + set, 0);
    if (count > 0) yield* browserCall(() => target.cookies.flushStore());
    const stored =
      storage && storage.entries.length > 0 && storage.origin === page.origin
        ? yield* browserCall(() =>
            tab.contents.executeJavaScript(
              `((origin, entries) => { if (location.origin !== origin) return 0; let set = 0; for (const [name, value] of entries) { try { localStorage.setItem(name, value); set += 1; } catch {} } return set; })(${JSON.stringify(storage.origin)}, ${JSON.stringify(storage.entries.map((entry) => [entry.name, entry.value]))})`,
              true,
            ),
          ).pipe(
            Effect.timeoutOption(SIGN_IN_STORAGE_WRITE_TIMEOUT_MS),
            Effect.map((set) => (Option.isSome(set) && isNumber(set.value) ? set.value : 0)),
            Effect.catch(() => Effect.succeed(0)),
          )
        : 0;
    if (count === 0 && stored === 0) return { cookies: 0, storage: 0 };
    if (this.#takeoverTabIds.has(tabId)) this.#takeoverSignInTabIds.add(tabId);
    yield* this.reload(tabId).pipe(Effect.ignore);
    return { cookies: count, storage: stored };
  }).bind(this);

  readonly stop = Effect.fn("BrowserHost.stop")(function* (
    this: BrowserHost,
    tabId: string,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const tab = yield* this.#requireTab(tabId);
    if (!tab.contents.isLoading()) return;
    tab.loadGeneration += 1;
    yield* browserSync(() => tab.contents.stop());
  }).bind(this);

  readonly close = Effect.fn("BrowserHost.close")(function* (
    this: BrowserHost,
    tabId: string,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const tab = this.#tabs.get(tabId);
    if (!tab) return;
    const tabIds = [...this.#tabs.keys()];
    const closedIndex = tabIds.indexOf(tabId);
    const browserHadFocus = tab.focusedAtPageClose === true || this.#tabHasFocus();
    this.#unmountView(tab.view);
    this.#releaseScriptedDocument(tab);
    this.#tabs.delete(tabId);
    const signInSession = tab.popup ? undefined : tab.privateSession;
    const childDrains = [...this.#tabs.values()]
      .filter((child) => child.openerTabId === tabId || (signInSession && child.privateSession === signInSession))
      .map((child) => this.close(child.id));
    this.#takeoverTabIds.delete(tabId);
    this.#takeoverSignInTabIds.delete(tabId);
    this.#userControlTabIds.delete(tabId);
    this.#teachRecordings.delete(tabId);
    this.#completeUserControlWaiters(tabId);

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
        active.focusOnVisible = browserHadFocus;
        yield* this.#wake(active);
      }
    }
    this.#syncAttachedView();
    this.#emitChanged();
    tab.closing = true;
    tab.engine.releaseDialogs();
    const destroy = yield* Effect.forkIn(
      Effect.gen({ self: this }, function* () {
        const queueDrains = (milliseconds: number) =>
          Deferred.await(tab.queue).pipe(Effect.timeoutOption(milliseconds), Effect.map(Option.isSome));
        let drained = yield* queueDrains(CLOSE_QUEUE_WAIT_MS);
        if (!drained) {
          logger.warn("A browser tab closed before an earlier operation on it finished.", {
            tabId,
            host: logUrlHost(tab.requestedUrl),
            pendingOperations: tab.pendingOperations,
          });
          yield* browserSync(() => {
            if (!tab.contents.isDestroyed()) tab.contents.close();
          });
          drained = yield* queueDrains(CLOSED_PAGE_DRAIN_MS);
        }
        yield* Effect.all(childDrains, { concurrency: "unbounded", discard: true });
        const discarded = yield* Effect.exit(this.#recorder.discard(tabId, "tab-closed"));
        yield* tab.engine.destroy();
        if (drained) yield* Scope.close(tab.scope, Exit.void);
        else yield* Effect.forkDetach(Scope.close(tab.scope, Exit.void), { startImmediately: true });
        yield* browserSync(() => {
          if (!tab.contents.isDestroyed()) tab.contents.close();
        });
        const privateSession = tab.privateSession;
        if (privateSession && ![...this.#tabs.values()].some((other) => other.privateSession === privateSession))
          yield* browserCall(() => privateSession.clearStorageData()).pipe(Effect.ignore);
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
    this.#takeoverSignInTabIds.delete(tabId);
    stopCookieBanners(tab.contents);
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

  readonly takeUserControl = Effect.fn("BrowserHost.takeUserControl")(function* (
    this: BrowserHost,
    tabId: string,
    holder: BrowserUserControlHolder,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const tab = this.#tabs.get(tabId);
    if (!tab || tab.closing) return yield* browserFailure(new Error(sourceText("error.backend.browserTabNotFound")));
    if (tab.secret) return yield* browserFailure(new Error(sourceText("error.backend.browserUserControlBusy")));
    if (this.#userControlTabIds.has(tabId)) return;
    tab.engine.invalidateReferences();
    this.#userControlTabIds.set(tabId, holder);
    stopCookieBanners(tab.contents);
    tab.diagnostics.clearDiagnostics();
    this.#emitChanged();
    yield* this.#enqueue(tabId, () => this.#recorder.discard(tabId, "tab-closed"), true).pipe(
      Effect.catch((operationFailure) =>
        Effect.gen({ self: this }, function* () {
          if (this.#userControlTabIds.get(tabId) === holder) this.#endUserControl(tabId);
          return yield* browserFailure(operationFailure.cause);
        }),
      ),
    );
  }).bind(this);

  releaseUserControl(tabId: string): void {
    if (!this.#userControlTabIds.has(tabId)) return;
    const tab = this.#tabs.get(tabId);
    if (tab) {
      tab.engine.invalidateReferences();
      tab.diagnostics.clearDiagnostics();
    }
    this.#endUserControl(tabId);
  }

  readonly startTeach = Effect.fn("BrowserHost.startTeach")(function* (
    this: BrowserHost,
    tabId: string,
    holder: BrowserUserControlHolder,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const tab = this.#tabs.get(tabId);
    if (!tab || tab.closing) return yield* browserFailure(new Error(sourceText("error.backend.browserTabNotFound")));
    if (tab.ownerAgentId === null || tab.privateSession)
      return yield* browserFailure(new Error(sourceText("error.backend.browserTeachUnavailable")));
    const held = this.#userControlTabIds.get(tabId);
    if (held && !sameUserControlHolder(held, holder))
      return yield* browserFailure(new Error(sourceText("error.backend.browserTeachBusy")));
    yield* this.takeUserControl(tabId, holder);
    const current = this.#userControlTabIds.get(tabId);
    if (this.#tabs.get(tabId) !== tab || !current || !sameUserControlHolder(current, holder))
      return yield* browserFailure(new Error(sourceText("error.backend.browserTabNotFound")));
    this.#teachRecordings.set(tabId, { holder: current, startedAt: Date.now(), steps: [] });
    const place = stepPlace(tab.engine.scrubText(tab.contents.getURL()));
    const title = stepText(tab.engine.scrubText(tab.contents.getTitle()));
    if (place) this.#recordTeachStep(tab, { kind: "page", ...place, ...(title ? { title } : {}) });
  }).bind(this);

  stopTeach(tabId: string, holder: BrowserUserControlHolder, save: boolean): BrowserTeachStep[] {
    const recording = this.#teachRecordings.get(tabId);
    if (!recording || !sameUserControlHolder(recording.holder, holder)) return [];
    this.#teachRecordings.delete(tabId);
    this.releaseUserControl(tabId);
    return save ? recording.steps : [];
  }

  #recordTeachStep(tab: BrowserHostTab, step: BrowserTeachStep): boolean {
    const recording = this.#teachRecordings.get(tab.id);
    if (!recording) return false;
    if (tab.secret || tab.privateSession || tab.contents.isDestroyed()) return true;
    if (recording.steps.length >= TEACH_MAX_STEPS || Date.now() - recording.startedAt > TEACH_MAX_DURATION_MS)
      return true;
    const last = recording.steps.at(-1);
    if (step.kind === "page" && last?.kind === "page" && last.host === step.host && last.path === step.path) {
      if (step.title !== undefined) recording.steps[recording.steps.length - 1] = step;
    } else recording.steps.push(step);
    return true;
  }

  releaseUserControlHeldBy(owner: BrowserUserControlOwner): void {
    for (const [tabId, holder] of [...this.#userControlTabIds]) {
      if (
        (owner.kind === "local" && holder.kind === "local") ||
        (owner.kind === "session" && holder.kind === "member" && holder.sessionId === owner.sessionId) ||
        (owner.kind === "member" && holder.kind === "member" && holder.memberId === owner.memberId)
      )
        this.releaseUserControl(tabId);
    }
  }

  releaseUserControlRefused(refused: (tabId: string, holder: BrowserUserControlHolder) => boolean): void {
    for (const [tabId, holder] of [...this.#userControlTabIds])
      if (refused(tabId, holder)) this.releaseUserControl(tabId);
  }

  userControlTabFor(params: DynamicToolCallParams): string | null {
    if (TAB_SET_TOOLS.has(params.tool))
      return (
        this.listTabs().find((tab) => this.#userControlTabIds.has(tab.id) && this.#canUseToolTab(params, tab))?.id ??
        null
      );
    const args = repairBrowserToolInput(params.tool, params.arguments).value;
    const tabId = isRecord(args) ? args.tabId : undefined;
    if (!isString(tabId) || !this.#userControlTabIds.has(tabId)) return null;
    const tab = this.listTabs().find((candidate) => candidate.id === tabId);
    return tab && this.#canUseToolTab(params, tab) ? tabId : null;
  }

  awaitUserControlRelease(tabId: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (!this.#userControlTabIds.has(tabId)) return Effect.void;
      const released = Deferred.makeUnsafe<void>();
      const waiters = this.#userControlWaiters.get(tabId) ?? new Set<Deferred.Deferred<void>>();
      this.#userControlWaiters.set(tabId, waiters);
      waiters.add(released);
      return Deferred.await(released).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            waiters.delete(released);
            if (waiters.size === 0 && this.#userControlWaiters.get(tabId) === waiters)
              this.#userControlWaiters.delete(tabId);
          }),
        ),
      );
    });
  }

  #heldByUser(tabId: string): boolean {
    return this.#userControlTabIds.has(tabId);
  }

  #endUserControl(tabId: string): void {
    this.#userControlTabIds.delete(tabId);
    this.#teachRecordings.delete(tabId);
    this.#completeUserControlWaiters(tabId);
    this.#emitChanged();
  }

  #completeUserControlWaiters(tabId: string): void {
    const waiters = this.#userControlWaiters.get(tabId);
    this.#userControlWaiters.delete(tabId);
    for (const released of waiters ?? []) Deferred.doneUnsafe(released, Exit.void);
  }

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
    if (!isWebProtocol(url)) return yield* browserFailure(new Error(sourceText("error.backend.authWebPageRequired")));
    yield* browserSync(() => this.#requireIsolatedFromConnectedTabs(tab, url.origin));
    const digitFields = args.method === "password" && args.targets.length > 2;
    if ((args.method !== "password" || digitFields) && args.digits < 4)
      return yield* browserFailure(new Error(sourceText("error.backend.authDigitsRange")));
    if (
      (args.method === "password"
        ? digitFields && (!args.loginId || args.targets.length !== args.digits + 1)
        : args.targets.length !== 1 && args.targets.length !== args.digits) ||
      (args.submission === "click") !== Boolean(args.submitTarget)
    )
      return yield* browserFailure(
        new Error(
          args.submission === "click" && !args.submitTarget
            ? "Invalid authentication targets: submission=click needs submitTarget."
            : args.submission !== "click" && args.submitTarget
              ? "Invalid authentication targets: submitTarget is only for submission=click."
              : args.method === "password"
                ? `Invalid authentication targets: method=password needs one field target, a password and its confirmation field, or, with loginId, the password field and then one code field or ${args.digits} digit field targets.`
                : `Invalid authentication targets: use one field target for the whole code, or ${args.digits} digit field targets.`,
        ),
      );
    const protection = { origin: url.origin, submitted: false, replaced: false, running: false };
    tab.secret = protection;
    stopCookieBanners(tab.contents);
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
              tab.engine.prepareSecret(
                args.targets,
                args.submission,
                args.submitTarget,
                args.method === "password" && args.targets.length === 1,
              ),
              10_000,
              "Authentication target resolution timed out.",
              keepQueueBlocked,
            );
          }),
        true,
      );
      const fieldOrigin = entry.origin;
      if (
        fieldOrigin !== url.origin &&
        (url.protocol === "http:" || !websiteMatchesOrigin({ url: url.origin, autofill: "anywhere" }, fieldOrigin))
      )
        return yield* browserFailure(
          new Error("The field target is in a frame of another site. Use browser takeover for this form."),
        );
      const requireIsolated = () => {
        this.#requireIsolatedFromConnectedTabs(tab, url.origin);
        if (fieldOrigin !== url.origin) this.#requireIsolatedFromConnectedTabs(tab, fieldOrigin);
      };
      yield* browserSync(requireIsolated);
      const confirmation = args.method === "password" && args.targets.length === 2 && entry.kinds[1]?.password === true;
      const withCode = args.method === "password" && args.targets.length > 1 && !confirmation;
      if (confirmation && !entry.kinds[0]?.password)
        return yield* browserFailure(new Error("A password and its confirmation must both be password fields."));
      if (withCode && !args.loginId)
        return yield* browserFailure(
          new Error(
            "A password and its confirmation must both be password fields. A form that also asks for the authenticator code needs loginId.",
          ),
        );
      const codeFields = args.method === "password" ? args.targets.length - 1 : args.targets.length;
      return {
        request: { method: args.method, origin: fieldOrigin, digits: args.method === "password" ? 6 : args.digits },
        agentScriptedOrigin:
          this.#agentCodeReaches(tab, [url.origin]) ||
          (yield* this.#agentCodeCanRead(tab, [fieldOrigin], entry.servedByWorker)),
        vaultFillable:
          entry.hiddenPasswordFill ||
          entry.kinds.every((kind, index) =>
            args.method === "password" && (index === 0 || confirmation)
              ? kind.password
              : (args.method === "authenticator" || withCode) && kind.oneTimeCode,
          ),
        withCode,
        cancel: () => {
          if (tab.secret === protection && !protection.submitted) {
            tab.secret = undefined;
            this.#syncAttachedView();
            this.#emitChanged();
          }
        },
        submit: (secret: string, vault: boolean, code?: string) =>
          Effect.gen({ self: this }, function* (): Effect.fn.Return<"submitted" | "takeover", BrowserOperationError> {
            if (tab.secret !== protection || protection.submitted)
              return yield* browserFailure(new Error(sourceText("error.backend.authExpired")));
            yield* browserSync(requireIsolated);
            const length = vault && codeFields === 1 ? "4,12" : args.digits;
            const digits = new RegExp(`^[0-9]{${length}}$`, "u");
            if (
              (args.method !== "password" && !digits.test(secret)) ||
              (withCode && (!vault || code === undefined || !digits.test(code)))
            )
              return yield* browserFailure(new Error(sourceText("error.backend.authDigitsRequired")));
            const spread = (value: string, fields: number) => (fields === 1 ? [value] : [...value]);
            const filledCode = withCode ? code : undefined;
            const values =
              args.method !== "password"
                ? spread(secret, codeFields)
                : confirmation
                  ? [secret, secret]
                  : [secret, ...(filledCode === undefined ? [] : spread(filledCode, codeFields))];
            const secrets = filledCode === undefined ? [secret] : [secret, filledCode];
            protection.submitted = true;
            this.#invalidateViews(tab);
            protection.running = true;
            this.#syncAttachedView();
            let kept = false;
            let shown = false;
            let leaked = false;
            let stopWaiting = () => {};
            const contents = tab.contents;
            const blockLeak = (event: ElectronEvent<WebContentsWillFrameNavigateEventParams>) => {
              if (!secrets.some((value) => urlCarriesSecret(event.url, value))) return;
              leaked = true;
              event.preventDefault();
              stopWaiting();
            };
            if (vault) contents.on("will-frame-navigate", blockLeak);
            yield* Effect.gen({ self: this }, function* () {
              yield* this.#enqueue(
                args.tabId,
                (_tab, keepQueueBlocked) =>
                  Effect.gen({ self: this }, function* () {
                    yield* boundEngineOperation(
                      tab,
                      entry.enter(values, vault),
                      10_000,
                      "Authentication submission timed out.",
                      keepQueueBlocked,
                    );
                    if (!protection.replaced && !leaked) {
                      yield* Effect.callback<void>((resume) => {
                        const contents = tab.contents;
                        const cleanup = () => {
                          clearTimeout(timer);
                          stopWaiting = () => {};
                          contents.off("did-navigate", finish);
                          contents.off("destroyed", finish);
                        };
                        const finish = () => {
                          cleanup();
                          resume(Effect.void);
                        };
                        const timer = setTimeout(finish, 5_000);
                        stopWaiting = finish;
                        contents.once("did-navigate", finish);
                        contents.once("destroyed", finish);
                        return Effect.sync(cleanup);
                      });
                    }
                    if (!protection.replaced) {
                      const cleared = yield* boundEngineOperation(
                        tab,
                        entry.clear(secrets),
                        10_000,
                        "Authentication field cleanup timed out.",
                        keepQueueBlocked,
                      ).pipe(Effect.catch(() => Effect.succeed(false)));
                      if (!protection.replaced && (cleared || !leaked)) {
                        for (const value of secrets) entry.hide(value, !cleared);
                        kept = true;
                        shown = !cleared;
                      }
                    }
                    if (!protection.replaced && !kept) {
                      yield* boundEngineOperation(
                        tab,
                        reloadWithGet(tab),
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
                  contents.off("will-frame-navigate", blockLeak);
                  protection.running = false;
                  tab.diagnostics.clearDiagnostics();
                  if (protection.replaced) {
                    tab.contents.navigationHistory.clear();
                    tab.secret = undefined;
                    this.#syncAttachedView();
                  } else if (kept) {
                    tab.secretDocument = true;
                    if (shown) tab.secretShown = true;
                    tab.secret = undefined;
                    this.#syncAttachedView();
                  }
                  this.#emitChanged();
                }),
              ),
            );
            return !leaked && (protection.replaced || kept) ? "submitted" : "takeover";
          }),
      };
    }).pipe(
      Effect.catch((error) =>
        Effect.gen({ self: this }, function* () {
          tab.secret = undefined;
          this.#syncAttachedView();
          const reason = error.cause instanceof Error ? ` ${error.cause.message.replace(/\.?\s*$/u, ".")}` : "";
          return yield* browserFailure(
            new Error(`Secure authentication is unavailable.${reason} Correct the request, or use browser takeover.`),
          );
        }),
      ),
    );
  }).bind(this);

  #requireIsolatedFromConnectedTabs(tab: BrowserHostTab, origin: string): void {
    if (!tab.hasSharedBrowsingContext) return;
    const site = approximateSite(origin);
    for (const connected of this.#connectedTabs(tab)) {
      if (connected === tab) continue;
      if (
        frameOrigins(connected.contents).some(
          (frameOrigin) => frameOrigin !== "null" && approximateSite(frameOrigin) === site,
        )
      )
        throw new Error(
          "Secure input is unavailable while a connected popup or opener tab shows the same site. Use takeover.",
        );
    }
  }

  #requireNoSecretDocument(tab: BrowserHostTab, action: string): void {
    if ([...this.#connectedTabs(tab)].some((connected) => connected.secretDocument || connected.filledCard))
      throw new Error(
        `${action} is unavailable while a page that received a secret is open. Use snapshots and actions until it navigates.`,
      );
  }

  #requireNoFilledCard(tab: BrowserHostTab, action: string): void {
    if (tab.filledCard)
      throw new Error(`${action} is unavailable while the page shows a filled card. Use snapshots until it navigates.`);
    if (tab.secretShown)
      throw new Error(
        `${action} is unavailable while the page can show a password or code that OpenBot typed. Use snapshots until it navigates.`,
      );
  }

  #cacheTainted(target: Session): Set<string> {
    const origins = this.#cacheTaintedOrigins.get(target) ?? new Set<string>();
    this.#cacheTaintedOrigins.set(target, origins);
    return origins;
  }

  #releaseScriptedDocument(tab: BrowserHostTab): void {
    const scripted = tab.scriptedOrigins;
    const exposed = tab.workerExposedOrigins;
    if (!scripted && !exposed) return;
    delete tab.scriptedOrigins;
    delete tab.workerExposedOrigins;
    const target = this.#tabSession(tab);
    for (const origin of new Set([...(scripted ?? []), ...(exposed ?? [])])) {
      if (!this.#cacheTaintedOrigins.get(target)?.has(origin)) continue;
      void this.#purgeOrigin(target, origin, ["cachestorage"]);
      void this.#originStoppedLoading(target, origin).then(() =>
        target.clearStorageData({ origin, storages: ["serviceworkers"] }).catch((error: unknown) => {
          logger.warn("Unable to clear a site's service workers", { origin, error: toLogValue(error) });
        }),
      );
    }
    if (!scripted) return;
    const connected = this.#connectedTabs(tab);
    for (const other of this.#sessionTabs(target)) {
      if (other === tab) continue;
      const otherOrigins = new Set(frameOrigins(other.contents));
      for (const origin of scripted) {
        if (!otherOrigins.has(origin)) continue;
        if (connected.has(other)) markScriptedOrigin(other, origin);
        else markWorkerExposedOrigin(other, origin);
      }
    }
  }

  #sessionTabs(target: Session): BrowserHostTab[] {
    return [...this.#tabs.values()].filter((other) => this.#tabSession(other) === target);
  }

  #agentCodeReaches(tab: BrowserHostTab, origins: string[]): boolean {
    const others = this.#sessionTabs(this.#tabSession(tab));
    return origins.some(
      (origin) =>
        tab.workerExposedOrigins?.has(origin) || others.some((candidate) => candidate.scriptedOrigins?.has(origin)),
    );
  }

  readonly #agentCodeCanRead = Effect.fn("BrowserHost.agentCodeCanRead")(function* (
    this: BrowserHost,
    tab: BrowserHostTab,
    origins: string[],
    servedByWorker: boolean,
  ): Effect.fn.Return<boolean> {
    if (this.#agentCodeReaches(tab, origins)) return true;
    const target = this.#tabSession(tab);
    const tainted = this.#cacheTaintedOrigins.get(target);
    const dirty = origins.filter((origin) => tainted?.has(origin));
    if (!tainted || dirty.length === 0) return false;
    const clean = servedByWorker ? [] : dirty.filter((origin) => !this.#originOpenElsewhere(target, origin, tab));
    const purges = dirty.map((origin) =>
      servedByWorker || clean.includes(origin)
        ? this.#purgeOrigin(target, origin)
        : (this.#originPurges.get(target)?.get(origin) ?? Promise.resolve(true)),
    );
    if (!(yield* Effect.promise(() => Promise.all(purges))).every(Boolean)) return true;
    if (this.#agentCodeReaches(tab, origins)) return true;
    if (!servedByWorker) {
      for (const origin of clean) if (!this.#originOpenElsewhere(target, origin, tab)) tainted.delete(origin);
      return false;
    }
    for (const origin of dirty) markWorkerExposedOrigin(tab, origin);
    return true;
  });

  #purgeOrigin(
    target: Session,
    origin: string,
    storages: ("cachestorage" | "serviceworkers")[] = ["cachestorage", "serviceworkers"],
  ): Promise<boolean> {
    const purges = this.#originPurges.get(target) ?? new Map<string, Promise<boolean>>();
    this.#originPurges.set(target, purges);
    const purge = (purges.get(origin) ?? Promise.resolve(true)).then(() =>
      target.clearStorageData({ origin, storages }).then(
        () => true,
        (error: unknown) => {
          logger.warn("Unable to clear a site's caches", { origin, error: toLogValue(error) });
          return false;
        },
      ),
    );
    purges.set(origin, purge);
    return purge;
  }

  #originStoppedLoading(target: Session, origin: string): Promise<void> {
    return new Promise((resolve) => {
      const watched = new Set<WebContents>();
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const contents of watched) {
          contents.off("did-stop-loading", check);
          contents.off("destroyed", check);
        }
        resolve();
      };
      const check = () => {
        if (settled) return;
        const loading = this.#sessionTabs(target)
          .map((tab) => tab.contents)
          .filter(
            (contents) => !contents.isDestroyed() && contents.isLoading() && frameOrigins(contents).includes(origin),
          );
        if (loading.length === 0) {
          finish();
          return;
        }
        for (const contents of loading) {
          if (watched.has(contents)) continue;
          watched.add(contents);
          contents.on("did-stop-loading", check);
          contents.once("destroyed", check);
        }
      };
      timer = setTimeout(finish, SERVICE_WORKER_CLEAR_WAIT_MS);
      timer.unref();
      check();
    });
  }

  #originOpenElsewhere(target: Session, origin: string, tab: BrowserHostTab): boolean {
    return [...this.#tabs.values()].some(
      (other) => other !== tab && this.#tabSession(other) === target && frameOrigins(other.contents).includes(origin),
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

  takeoverSignInArrived(tabId: string): boolean {
    return this.#takeoverSignInTabIds.has(tabId);
  }

  endTakeover(tabId: string, completed = false): void {
    const tab = this.#tabs.get(tabId);
    if (tab) {
      tab.engine.invalidateReferences();
      tab.diagnostics.clearDiagnostics();
      if (completed && tab.checkOrigin) tab.checkAfterTakeover = tab.checkOrigin;
    }
    this.#takeoverTabIds.delete(tabId);
    this.#takeoverSignInTabIds.delete(tabId);
    this.#syncAttachedView();
    this.#emitChanged();
    const protection = tab?.secret;
    if (tab && protection?.submitted)
      Effect.runFork(
        this.#reloadProtected(tab, protection).pipe(
          Effect.tapError((error) =>
            Effect.sync(() =>
              logger.warn("Unable to reload a protected browser tab after a takeover", { error: toLogValue(error) }),
            ),
          ),
          Effect.ignore,
          Effect.andThen(
            this.#enqueue(
              tab.id,
              (current) =>
                current.secret === protection
                  ? navigateAndWait(current.contents, () => current.contents.loadURL("about:blank"))
                  : Effect.void,
              true,
            ),
          ),
          Effect.ignore,
          Effect.forkIn(tab.scope, { startImmediately: true }),
        ),
      );
  }

  #reloadProtected(tab: BrowserHostTab, protection: NonNullable<BrowserHostTab["secret"]>) {
    return this.#enqueue(
      tab.id,
      (current) =>
        Effect.gen(function* () {
          if (current.contents.isLoadingMainFrame())
            yield* waitForLoading(current.contents, 10_000).pipe(Effect.ignore);
          if (current.secret !== protection) return;
          yield* untilStopped(current, reloadWithGet(current));
        }),
      true,
    );
  }

  #reloadShownSecret(tab: BrowserHostTab) {
    return this.#enqueue(
      tab.id,
      (current) => (current.secretShown ? untilStopped(current, reloadWithGet(current)) : Effect.void),
      true,
    );
  }

  readonly setVisible = Effect.fn("BrowserHost.setVisible")(function* (
    this: BrowserHost,
    input: BrowserVisibilityInput,
  ) {
    const active = this.#activeTabId ? this.#tabs.get(this.#activeTabId) : undefined;
    if (active && input.visible) yield* this.#wake(active);
    yield* browserSync(() => {
      if (!input.visible && input.target !== undefined && input.target !== this.#target) return;
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
                    tab.contents.reloadIgnoringCache();
                    return true;
                  });
              }
            });
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
            ...(target ? { target: describeBrowserTarget(target) } : {}),
            outcome: "success",
          });
        }).pipe(
          Effect.catch((operationFailure) =>
            Effect.gen({ self: this }, function* () {
              const error = operationFailure.cause;
              tab.diagnostics.action({
                action: action.type,
                ...(target ? { target: describeBrowserTarget(target) } : {}),
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
    target?: BrowserTarget,
  ): Effect.fn.Return<string, BrowserOperationError> {
    return yield* this.#enqueue(tabId, (tab, keepQueueBlocked) =>
      Effect.gen({ self: this }, function* () {
        yield* browserSync(() => this.#requireNoFilledCard(tab, "Browser screenshot"));
        const image = yield* boundEngineOperation(
          tab,
          tab.engine.screenshot(target, Date.now() + 10_000, true),
          10_000,
          "Browser screenshot timed out.",
          keepQueueBlocked,
        );
        const imageUrl = yield* browserSync(() => boundedCaptureDataUrl(image));
        if (!target) markImageTaken(tab);
        return imageUrl;
      }),
    );
  }).bind(this);

  readonly capturePreview = Effect.fn("BrowserHost.capturePreview")(function* (
    this: BrowserHost,
    tabId: string,
  ): Effect.fn.Return<BrowserPreview, BrowserOperationError> {
    const tab = this.#tabs.get(tabId);
    if (!tab) return yield* browserFailure(new Error(`Unknown browser tab: ${tabId}`));
    if (tab.sleeping) {
      if (tab.sleeping.preview) return tab.sleeping.preview;
      return yield* browserFailure(new Error("Browser preview is not saved for a sleeping tab."));
    }
    yield* this.#wake(tab);
    if (tab.secret?.submitted)
      return yield* browserFailure(new Error("Browser inspection is protected during authentication. Use takeover."));
    yield* browserSync(() => this.#requireNoFilledCard(tab, "Browser preview"));
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
    this.#thaw(tab);
    const page = currentPreviewPage(tab);
    const frame = Deferred.makeUnsafe<BrowserPreview, BrowserOperationError>();
    const capture = { ...page, frame };
    tab.previewCapture = capture;
    yield* Effect.forkIn(
      Effect.gen({ self: this }, function* () {
        const result = yield* Effect.exit(
          enqueueTabOperation(tab, (_tab, keepQueueBlocked) =>
            Effect.gen({ self: this }, function* () {
              yield* browserSync(() => this.#requireNoFilledCard(tab, "Browser preview"));
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
          ).pipe(Effect.provideService(BrowserToolQueueWait, undefined)),
        );
        if (tab.previewCapture === capture) tab.previewCapture = undefined;
        yield* Deferred.done(frame, result);
      }),
      tab.scope,
      { startImmediately: true },
    );
    return capture;
  });

  #invalidateViews(tab: BrowserHostTab): void {
    tab.captureGeneration += 1;
    for (const invalidate of [...tab.viewInvalidations]) invalidate();
  }

  readonly startView = Effect.fn("BrowserHost.startView")(function* (
    this: BrowserHost,
    tabId: string,
    onFrame: (frame: BrowserScreencastFrame) => void,
    onEnded?: (reason: string) => void,
    options: BrowserViewOptions = {},
  ): Effect.fn.Return<() => Effect.Effect<void>, BrowserOperationError> {
    const { onCursor, viewport, onPageCopy } = options;
    const tab = yield* this.#requireTab(tabId);
    const protection = tab.secret;
    if (protection?.submitted && !protection.running && this.#takeoverTabIds.has(tabId))
      yield* this.#reloadProtected(tab, protection).pipe(Effect.ignore);
    else if (tab.secretShown && (this.#takeoverTabIds.has(tabId) || this.#userControlTabIds.has(tabId)))
      yield* this.#reloadShownSecret(tab).pipe(Effect.ignore);
    if (tab.secret?.submitted)
      return yield* browserFailure(new Error(sourceText("error.backend.browserViewProtected")));
    yield* browserSync(() => this.#requireNoFilledCard(tab, "Browser view"));
    const generation = tab.captureGeneration;
    let invalidated = false;
    let lastCursor: BrowserViewCursor | null = null;
    const cursorChanged = (_event: unknown, type: string) => {
      if (tab.secret?.submitted || tab.captureGeneration !== generation) return;
      const cursor = browserViewCursor(type);
      if (cursor === lastCursor) return;
      lastCursor = cursor;
      onCursor?.(cursor);
    };
    const stopCursor = () => {
      if (onCursor && !tab.contents.isDestroyed()) tab.contents.off("cursor-changed", cursorChanged);
    };
    const invalidate = () => {
      invalidated = true;
      tab.viewInvalidations.delete(invalidate);
      stopCursor();
      onEnded?.("Authentication changed the browser view. Open a new view to continue.");
    };
    tab.viewInvalidations.add(invalidate);
    if (onCursor) tab.contents.on("cursor-changed", cursorChanged);
    return yield* Effect.gen({ self: this }, function* () {
      const stop = yield* tab.engine.startScreencast(
        {
          quality: VIEW_FRAME_QUALITY,
          maxWidth: VIEW_FRAME_MAX_WIDTH,
          maxHeight: VIEW_FRAME_MAX_HEIGHT,
          ...(viewport ? { viewport } : {}),
          ...(onPageCopy
            ? {
                onPageCopy: (text: string) => {
                  if (
                    !tab.secret?.submitted &&
                    !tab.filledCard &&
                    !tab.secretShown &&
                    tab.captureGeneration === generation
                  )
                    onPageCopy(text);
                },
              }
            : {}),
        },
        (frame) => {
          if (!tab.secret?.submitted && !tab.filledCard && !tab.secretShown && tab.captureGeneration === generation)
            onFrame(frame);
        },
        (error) => {
          tab.viewInvalidations.delete(invalidate);
          stopCursor();
          logger.warn("The live browser view stopped.", { error: toLogValue(error) });
          onEnded?.("The live browser view stopped. Open a new view to continue.");
        },
      );
      let stopped = false;
      const stopOnce = () =>
        Effect.gen({ self: this }, function* () {
          tab.viewInvalidations.delete(invalidate);
          stopCursor();
          if (stopped) return;
          stopped = true;
          tab.engine.releaseViewButton();
          yield* stop();
        });
      if (invalidated) yield* stopOnce();
      return stopOnce;
    }).pipe(
      Effect.catch((operationFailure) =>
        Effect.gen({ self: this }, function* () {
          const error = operationFailure.cause;
          tab.viewInvalidations.delete(invalidate);
          stopCursor();
          return yield* browserFailure(error);
        }),
      ),
    );
  }).bind(this);

  readonly dispatchViewInput = Effect.fn("BrowserHost.dispatchViewInput")(function* (
    this: BrowserHost,
    tabId: string,
    input: BrowserViewportInput,
    onContextMenu?: (menu: BrowserViewContextMenu) => void,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const tab = yield* this.#requireTab(tabId);
    if (tab.secret?.submitted)
      return yield* browserFailure(new Error(sourceText("error.backend.browserInputProtected")));
    if (input.type !== "pointer" || input.action !== "move") tab.engine.invalidateReferences();
    if (input.type === "pointer" && input.action === "down") {
      tab.viewContextMenu =
        input.button === "right" && onContextMenu
          ? { deliver: onContextMenu, until: Date.now() + VIEW_CONTEXT_MENU_MS }
          : null;
    }
    yield* tab.engine.dispatchViewportInput(input);
  }).bind(this);

  readonly copyViewSelection = Effect.fn("BrowserHost.copyViewSelection")(function* (
    this: BrowserHost,
    tabId: string,
    max: number,
  ): Effect.fn.Return<string | null, BrowserOperationError> {
    const tab = yield* this.#requireTab(tabId);
    if (tab.secret?.submitted)
      return yield* browserFailure(new Error(sourceText("error.backend.browserInputProtected")));
    return yield* tab.engine.viewportSelectionText(max);
  }).bind(this);

  readonly #toolHandlers: BrowserToolHandlers = {
    open: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        const tab = yield* this.#open(args.url, params.threadId, params.ownerAgentId ?? null, false, true);
        this.#controls.updateTab(params, tab.id);
        let read = yield* Effect.result(this.#finalStepsSnapshot(params, tab.id));
        for (
          let again = 0;
          again < OPEN_REDIRECT_READS &&
          Result.isFailure(read) &&
          read.failure.cause instanceof Error &&
          read.failure.cause.message === SNAPSHOT_NAVIGATED_MESSAGE;
          again += 1
        ) {
          const contents = this.#tabs.get(tab.id)?.contents;
          if (contents?.isLoadingMainFrame())
            yield* waitForLoading(contents, OPEN_REDIRECT_WAIT_MS).pipe(Effect.ignore);
          read = yield* Effect.result(this.#finalStepsSnapshot(params, tab.id));
        }
        if (Result.isSuccess(read)) return snapshotTextResult(read.success);
        const error = read.failure.cause;
        return textResult({
          tab,
          snapshotError: redactText(error instanceof Error ? error.message : String(error)),
        });
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
            if (mode === "always") yield* browserSync(() => this.#requireNoFilledCard(tab, "A snapshot image"));
            let imageUrl: string | null = null;
            const result = yield* readTabSnapshot(
              tab,
              tab.revision + 1,
              keepQueueBlocked,
              undefined,
              undefined,
              (read) =>
                Effect.gen(function* () {
                  const recommended = mode === "auto" && read.recommendImage && !tab.filledCard && !tab.secretShown;
                  const imageCurrent = hasCurrentImage(tab);
                  if (mode !== "always" && (!recommended || imageCurrent)) {
                    if (imageCurrent) passImageOn(tab);
                    if (recommended) {
                      read.snapshot.image = {
                        included: false,
                        reason:
                          "The last image is of this page, and no tool action ran since. Pass image: always if the page can have changed.",
                        width: read.snapshot.viewport.width,
                        height: read.snapshot.viewport.height,
                      };
                    }
                    return;
                  }
                  const image = yield* boundEngineOperation(
                    tab,
                    tab.engine.screenshot(undefined, undefined, true),
                    10_000,
                    "Browser screenshot timed out.",
                    keepQueueBlocked,
                  );
                  imageUrl = yield* browserSync(() => boundedCaptureDataUrl(image));
                  markImageTaken(tab);
                }),
            );
            return { result, imageUrl };
          }),
        );
        return this.#snapshotResult(capture.result, mode, capture.imageUrl);
      }),
    navigate: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        const tabId = args.tabId;
        yield* browserSync(() => this.#requireToolTab(params, tabId));
        return snapshotTextResult(yield* this.#navigate(tabId, args, readActionSnapshot));
      }),
    click: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    type: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    fill_fields: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        yield* browserSync(() => this.#requireToolTab(params, args.tabId));
        const tab = yield* this.#requireTab(args.tabId);
        const result = yield* runTabFillFields(tab, args.revision, args.fields, args.timeoutMs ?? 10_000, () =>
          this.#requireToolTab(params, args.tabId),
        );
        return {
          ...snapshotTextResult(result),
          success: result.status === "completed",
        };
      }),
    press: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    hover: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    scroll: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    select_option: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    set_checked: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    drag: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    upload_files: (call, params, hooks) => this.#runInputTool(call, params, hooks),
    fill_card: ({ args }, params, hooks) =>
      Effect.gen({ self: this }, function* () {
        yield* browserSync(() => this.#requireToolTab(params, args.tabId));
        const vault = hooks.cardVault;
        const card = vault?.secret(args.cardId) ?? null;
        if (!vault || !card)
          return yield* browserFailure(new Error("No saved card has this id. Call list_vault_items."));
        const first = yield* this.#fillCard(args, card, vault);
        if (first.status === "filled") return first.result;
        if (!(yield* vault.approve(args.cardId, first.page, first.frames)))
          return yield* browserFailure(
            new Error("The owner did not approve this card fill. Ask the user, or use request_takeover."),
          );
        const second = yield* this.#fillCard(args, card, vault);
        if (second.status === "filled") return second.result;
        return yield* browserFailure(new Error("The card page changed during the approval. Take a fresh snapshot."));
      }),
    wait_for: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        const tabId = args.tabId;
        yield* browserSync(() => this.#requireToolTab(params, tabId));
        return snapshotTextResult(
          yield* this.#waitFor(tabId, args, (tab, keepQueueBlocked, timeoutMs, timeoutMessage) =>
            readTabSnapshot(tab, tab.revision + 1, keepQueueBlocked, timeoutMs, timeoutMessage).pipe(
              Effect.map((read) => read.snapshot),
            ),
          ),
        );
      }),
    evaluate: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        yield* browserSync(() => this.#requireToolTab(params, args.tabId));
        return valueTextResult(
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
        return snapshotTextResult(
          yield* this.#enqueue(tabId, (tab, keepQueueBlocked) =>
            Effect.gen({ self: this }, function* () {
              const environment = yield* browserSync(() =>
                resolveEnvironment(args, tab.environment, tab.view.getBounds()),
              );
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
        yield* this.#enqueue(tabId, (tab, keepQueueBlocked) => {
          this.#requireNoSecretDocument(tab, "Recording");
          return Effect.gen({ self: this }, function* () {
            const frameSize = recordingFrameSize(tab.environment);
            yield* this.#recorder.start(tabId, tab.contents, frameSize);
            if (!frameSize) return;
            yield* boundEngineOperation(
              tab,
              tab.engine.setEnvironment(tab.environment),
              10_000,
              "Browser environment change timed out.",
              keepQueueBlocked,
            ).pipe(Effect.ignore);
          });
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
        return snapshotTextResult(yield* this.act(args.tabId, args.revision, args.action));
      }),
    screenshot: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        yield* browserSync(() => this.#requireToolTab(params, args.tabId));
        const target: BrowserTarget | undefined = args.ref
          ? { kind: "ref", ref: args.ref, revision: Number(args.ref.split(":", 1)[0]) }
          : undefined;
        const imageUrl = yield* this.screenshot(args.tabId, target);
        return { success: true, contentItems: [{ type: "inputImage", imageUrl }] };
      }),
    run_script: ({ args }, params, hooks) =>
      Effect.gen({ self: this }, function* () {
        const tabId = args.tabId;
        yield* browserSync(() => this.#requireToolTab(params, tabId));
        const crashesAtStart = this.#tabs.get(tabId)?.crashes ?? 0;
        const crashed = () => (this.#tabs.get(tabId)?.crashes ?? 0) !== crashesAtStart;
        const run: BrowserScriptResult = yield* runBrowserScript({
          script: args.script,
          timeoutMs: args.timeoutMs ?? BROWSER_SCRIPT_DEFAULT_TIMEOUT_MS,
          maxSteps: BROWSER_SCRIPT_MAX_STEPS,
          runStep: (step) =>
            crashed()
              ? Effect.succeed<BrowserStepOutcome>({ status: "page_crashed" })
              : Effect.raceFirst(
                  this.#runStep(params, tabId, step, hooks).pipe(
                    Effect.map((outcome): BrowserStepOutcome => (crashed() ? { status: "page_crashed" } : outcome)),
                  ),
                  this.#rendererGone(tabId),
                ),
          currentUrl: () => {
            const tab = this.#tabs.get(tabId);
            return tab ? tab.engine.scrubText(currentTabUrl(tab)) : undefined;
          },
        });
        const crashKept = run.status === "page_crashed" && this.#tabs.get(tabId)?.pendingRestore === undefined;
        let result: BrowserScriptResult = crashKept ? { ...run, error: BROWSER_PAGE_CRASH_KEPT } : run;
        let snapshot: BrowserSnapshot | undefined;
        let snapshotError: string | undefined;
        if (
          args.finalSnapshot !== false &&
          !crashKept &&
          run.status !== "user_control" &&
          run.status !== "tab_closed" &&
          run.status !== "dialog"
        ) {
          const read = yield* Effect.result(this.#finalStepsSnapshot(params, tabId));
          if (Result.isSuccess(read)) snapshot = read.success;
          else {
            const error = read.failure.cause;
            if (error instanceof BrowserUserControlHeld)
              result = { ...run, status: "user_control", error: BROWSER_SCRIPT_USER_CONTROL_ERROR };
            else snapshotError = redactText(error instanceof Error ? error.message : String(error));
          }
        }
        const tab = snapshot || (result.status === "completed" && !snapshotError) ? undefined : this.#tabs.get(tabId);
        return {
          ...snapshotTextResult({
            tabId,
            ...result,
            ...boundedScriptValue(result.value),
            ...(result.error === undefined ? {} : { error: redactText(result.error) }),
            ...(snapshotError === undefined ? {} : { snapshotError }),
            ...(tab ? { url: tab.engine.scrubText(currentTabUrl(tab)) } : {}),
            ...(snapshot ? { snapshot } : {}),
          }),
          success: result.status === "completed",
        };
      }),
    handle_dialog: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        yield* browserSync(() => this.#requireToolTab(params, args.tabId, true));
        const tab = yield* this.#requireTab(args.tabId);
        yield* tab.engine.answerDialog(args.dialogId, args.accept, {
          threadId: params.threadId,
          turnId: params.turnId,
        });
        const answered = args.accept ? "accepted" : "dismissed";
        const next = Option.getOrUndefined(
          yield* tab.engine.nextDialog().pipe(Effect.timeoutOption(DIALOG_ACTION_WAIT_MS)),
        );
        if (next) return textResult({ answered, ...dialogTabResult(args.tabId, next) });
        const status = yield* this.#runAction(
          args.tabId,
          "handle_dialog",
          undefined,
          () => Effect.void,
          readActionStatus,
        );
        return textResult({ answered, ...status });
      }),
    close_tab: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        const tabId = args.tabId;
        const tab = this.#tabs.get(tabId);
        if (tab) {
          yield* browserSync(() => this.#requireToolTab(params, tabId, true, true));
          logger.info("Agent closed a browser tab.", {
            tabId,
            host: logUrlHost(tab.requestedUrl),
            agentId: params.ownerAgentId ?? null,
          });
        }
        yield* this.close(tabId);
        return textResult({ closed: true });
      }),
    submit_secret: rejectTakeoverTool,
    request_takeover: rejectTakeoverTool,
    list_logins: rejectTakeoverTool,
    list_vault_items: rejectTakeoverTool,
    save_vault_item: rejectTakeoverTool,
    request_vault_item: rejectTakeoverTool,
    delete_vault_item: rejectTakeoverTool,
    request_link_payment: rejectTakeoverTool,
  };

  #siteRecall(params: DynamicToolCallParams) {
    const agentId = params.ownerAgentId;
    if (!agentId) return undefined;
    return { turnId: params.turnId, recall: (hostname: string) => this.#siteMemories(agentId, hostname) };
  }

  readonly handleDynamicTool = Effect.fn("BrowserHost.handleDynamicTool")(function* (
    this: BrowserHost,
    params: DynamicToolCallParams,
    hooks: BrowserDynamicToolHooks = {},
  ): Effect.fn.Return<DynamicToolResult, BrowserOperationError> {
    let calledTabId: string | undefined;
    const outcome = yield* Effect.gen({ self: this }, function* () {
      const call = yield* browserSync(() => parseBrowserToolCall(params.tool, params.arguments));
      if ("tabId" in call.args) calledTabId = call.args.tabId;
      yield* browserSync(() => this.#controls.begin(params, call));
      return { result: yield* runBrowserTool(this.#toolHandlers, call.tool, call, params, hooks) };
    })
      .pipe(
        Effect.provideService(BrowserToolHold, (tabId: string) => this.#heldByUser(tabId)),
        Effect.provideService(BrowserToolQueueWait, TOOL_QUEUE_WAIT_MS),
        Effect.provideService(BrowserDialogTurn, { threadId: params.threadId, turnId: params.turnId }),
        Effect.provideService(BrowserSiteMemories, this.#siteRecall(params)),
        Effect.catch((operationFailure) =>
          Effect.sync((): { result: DynamicToolResult } | { heldTabId: string } => {
            const error = operationFailure.cause;
            if (error instanceof BrowserUserControlHeld) return { heldTabId: error.tabId };
            return {
              result: {
                success: false,
                contentItems: [{ type: "inputText", text: redactText(String(error)) }],
              },
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
    if ("result" in outcome) return this.#withIdleUnloadNote(params, calledTabId, outcome.result);
    if (hooks.onUserControl) return yield* hooks.onUserControl(outcome.heldTabId);
    return {
      success: false,
      contentItems: [{ type: "inputText", text: new BrowserUserControlHeld(outcome.heldTabId).message }],
    };
  }).bind(this);

  #withIdleUnloadNote(
    params: DynamicToolCallParams,
    tabId: string | undefined,
    result: DynamicToolResult,
  ): DynamicToolResult {
    const tab = tabId === undefined ? undefined : this.#tabs.get(tabId);
    const noted = tab?.idleUnloadNoted;
    if (!tab || !noted || tab.pendingRestore || noted.has(params.threadId)) return result;
    const listed = this.listTabs().find((candidate) => candidate.id === tab.id);
    if (!listed || !this.#canUseToolTab(params, listed)) return result;
    noted.add(params.threadId);
    return { ...result, contentItems: [...result.contentItems, { type: "inputText", text: IDLE_UNLOAD_NOTE }] };
  }

  #toolTabs(params: DynamicToolCallParams): {
    tabs: ToolTab[];
    activeTabId: string | null;
    otherChatTabs?: number;
    note?: string;
  } {
    const chatOf = this.#cachedAgentChat();
    const otherChatTabIds = new Set(
      this.getControlState()
        .sessions.filter((session) => session.threadId !== params.threadId)
        .map((session) => session.tabId),
    );
    const now = Date.now();
    const allTabs = this.listTabs();
    const tabs = allTabs
      .filter((tab) => this.#canUseToolTab(params, tab, chatOf))
      .map((tab): ToolTab => {
        const hostTab = this.#tabs.get(tab.id);
        const engine = hostTab?.engine;
        const scrubbed = engine ? { ...tab, title: engine.scrubText(tab.title), url: engine.scrubText(tab.url) } : tab;
        const lastChat = hostTab?.lastToolChat;
        const working =
          otherChatTabIds.has(tab.id) ||
          (lastChat !== undefined &&
            lastChat.threadId !== params.threadId &&
            now - lastChat.at < OTHER_CHAT_WORKING_MS);
        return {
          ...scrubbed,
          chat: this.#tabChat(params, tab, chatOf),
          ...(working ? { otherChatWorking: true as const } : {}),
        };
      });
    const activeTabId = tabs.some((tab) => tab.id === this.#activeTabId)
      ? this.#activeTabId
      : (tabs.at(-1)?.id ?? null);
    const ownerAgentId = params.ownerAgentId ?? null;
    const otherChatTabs =
      ownerAgentId === null
        ? 0
        : allTabs.filter((tab) => tab.ownerAgentId === ownerAgentId && !this.#canUseToolTab(params, tab, chatOf))
            .length;
    const notes = [
      ...(tabs.some((tab) => tab.chat !== THIS_CHAT && tab.chat !== NO_CHAT) ? [OTHER_CHAT_TABS_NOTE] : []),
      ...(otherChatTabs === 0
        ? []
        : [
            `${otherChatTabs} more ${otherChatTabs === 1 ? "tab of this agent is" : "tabs of this agent are"} open in its other chats, and this chat cannot use ${otherChatTabs === 1 ? "it" : "them"}. To give a tab to this chat, ask the user to type @ in the message box of this chat, select the tab under "Browser tabs", and send the message.`,
          ]),
    ];
    return {
      tabs,
      activeTabId,
      ...(otherChatTabs === 0 ? {} : { otherChatTabs }),
      ...(notes.length === 0 ? {} : { note: notes.join(" ") }),
    };
  }

  #cachedAgentChat(): (threadId: string) => BrowserAgentChat | null {
    const known = new Map<string, BrowserAgentChat | null>();
    return (threadId) => {
      const cached = known.get(threadId);
      if (cached !== undefined) return cached;
      const chat = this.#agentChat(threadId);
      known.set(threadId, chat);
      return chat;
    };
  }

  #tabChat(
    params: DynamicToolCallParams,
    tab: BrowserTab,
    chatOf: (threadId: string) => BrowserAgentChat | null,
  ): string {
    if (tab.ownerThreadId === params.threadId) return THIS_CHAT;
    if (tab.ownerThreadId === null) return NO_CHAT;
    const owner = chatOf(tab.ownerThreadId);
    if (owner === null || owner.agentId !== tab.ownerAgentId) return "another conversation";
    if (owner.sideThread === null) return "main chat";
    return `side thread ${JSON.stringify(owner.sideThread.title)} (taskId ${owner.sideThread.taskId})`;
  }

  readonly #fillCard = Effect.fn("BrowserHost.fillCard")(function* (
    this: BrowserHost,
    args: BrowserToolArguments<"fill_card">,
    card: VaultCardSecret,
    vault: BrowserCardVault,
  ) {
    const tab = yield* this.#requireTab(args.tabId);
    if (tab.secret) return yield* browserFailure(new Error(sourceText("error.backend.authActive")));
    let result: BrowserCardFillResult = { filled: [], unconfirmed: [] };
    const outcome: { approval: { page: string; frames: string[] } | null } = { approval: null };
    const snapshot = yield* this.#runAction(
      args.tabId,
      "fill_card",
      args.targets.number,
      (current, deadline, markDispatched) =>
        Effect.gen({ self: this }, function* () {
          const topOrigin = urlOrigin(currentTabUrl(current));
          if (!topOrigin?.startsWith("https://"))
            return yield* browserFailure(new Error("Card fill needs an HTTPS page. Use request_takeover."));
          const frames = new Set<string>();
          let servedByWorker = false;
          result = yield* current.engine.fillCard(
            args.targets,
            card,
            {
              checkOrigin: (origin, frameServedByWorker) => {
                if (this.#agentCodeReaches(current, [origin, topOrigin])) throw new Error(AGENT_CODE_CARD_FILL);
                this.#requireIsolatedFromConnectedTabs(current, topOrigin);
                if (origin !== topOrigin) this.#requireIsolatedFromConnectedTabs(current, origin);
                frames.add(origin);
                servedByWorker ||= frameServedByWorker;
              },
              allowFill: () =>
                Effect.gen({ self: this }, function* () {
                  if (yield* this.#agentCodeCanRead(current, [...frames], servedByWorker))
                    return yield* browserFailure(new Error(AGENT_CODE_CARD_FILL));
                  if (!vault.approved(args.cardId, topOrigin, [...frames])) {
                    outcome.approval = { page: topOrigin, frames: [...frames] };
                    return false;
                  }
                  yield* this.#recorder.discard(args.tabId, "requested");
                  return true;
                }),
              onFill: () => {
                markDispatched();
                current.filledCard = true;
                this.#invalidateViews(current);
              },
            },
            deadline,
          );
          if (outcome.approval)
            return yield* browserFailure(new Error("The card fill waits for the owner's approval."));
        }),
      readActionSnapshot,
      browserToolTimeout(args.timeoutMs),
    ).pipe(Effect.catch((error) => (outcome.approval ? Effect.succeed(null) : Effect.fail(error))));
    if (outcome.approval) return { status: "approval" as const, ...outcome.approval };
    return {
      status: "filled" as const,
      result: snapshotTextResult({
        filled: result.filled,
        ...(result.unconfirmed.length > 0 ? { unconfirmed: result.unconfirmed } : {}),
        snapshot,
      }),
    };
  });

  readonly #runInputTool = Effect.fn("BrowserHost.runInputTool")(function* (
    this: BrowserHost,
    call: BrowserInputCall,
    params: DynamicToolCallParams,
    hooks: BrowserDynamicToolHooks,
  ): Effect.fn.Return<DynamicToolResult, BrowserOperationError> {
    yield* browserSync(() => this.#requireToolTab(params, call.args.tabId));
    const action = yield* browserSync(() => browserInputAction(call, hooks));
    const run = <A>(readResult: ActionResultReader<A>) =>
      this.#runAction(
        call.args.tabId,
        action.name,
        action.target,
        (tab, deadline, markDispatched) => action.run(tab.engine, deadline, markDispatched),
        readResult,
        browserToolTimeout(call.args.timeoutMs),
        call.tool === "upload_files" ? hooks.onUploadOperationStarted : undefined,
      );
    return call.args.snapshot
      ? snapshotTextResult(yield* run(readActionSnapshot))
      : textResult(yield* run(readActionStatus));
  });

  readonly #navigate = Effect.fn("BrowserHost.navigate")(function* <A>(
    this: BrowserHost,
    tabId: string,
    args: Pick<BrowserToolArguments<"navigate">, "url" | "direction" | "timeoutMs">,
    readResult: ActionResultReader<A>,
  ) {
    const { url, direction } = args;
    if (!url && !direction) return yield* browserFailure(new Error("navigate requires url or direction."));
    if (url) yield* browserSync(() => normalizeBrowserUrl(url));
    if (!this.#takeoverTabIds.has(tabId) && !this.#userControlTabIds.has(tabId))
      yield* this.#leaveSilentPage(tabId, url ? undefined : direction);
    return yield* this.#runAction(
      tabId,
      "navigate",
      undefined,
      (tab, deadline) =>
        Effect.gen({ self: this }, function* () {
          const operationTimeout = yield* browserSync(() => remainingTime(deadline, "Browser navigate timed out."));
          if (url) {
            const normalizedUrl = yield* browserSync(() => normalizeBrowserUrl(url));
            tab.requestedUrl = normalizedUrl;
            yield* navigateAndWait(
              tab.contents,
              () => tab.contents.loadURL(normalizedUrl, browserLoadOptions()),
              operationTimeout,
            ).pipe(Effect.mapError((failure) => this.#proxyLoadFailure(tab, failure)));
          } else if (direction === "reload") {
            yield* navigateAndWait(
              tab.contents,
              () => {
                tab.contents.reloadIgnoringCache();
                return true;
              },
              operationTimeout,
            );
          } else if (direction) {
            yield* navigateAndWait(tab.contents, () => navigateHistory(tab.contents, direction), operationTimeout);
          }
        }),
      readResult,
      browserToolTimeout(args.timeoutMs),
    );
  });

  readonly #waitFor = Effect.fn("BrowserHost.waitFor")(function* <A>(
    this: BrowserHost,
    tabId: string,
    args: Omit<BrowserToolArguments<"wait_for">, "tabId">,
    readResult: (
      tab: BrowserHostTab,
      keepQueueBlocked: KeepQueueBlocked,
      timeoutMs: number,
      timeoutMessage: string,
    ) => Effect.Effect<A, BrowserOperationError>,
  ) {
    const condition = {
      ...(args.target === undefined ? {} : { target: args.target }),
      ...(args.text === undefined ? {} : { text: args.text }),
      ...(args.url === undefined ? {} : { url: args.url }),
      ...(args.state === undefined ? {} : { state: args.state }),
    };
    if (!condition.target && !condition.text && !condition.url && !condition.state)
      return yield* browserFailure(new Error("wait_for requires a condition."));
    const timeoutMs = browserToolTimeout(args.timeoutMs);
    return yield* this.#enqueue(tabId, (tab, keepQueueBlocked) =>
      Effect.gen(function* () {
        const timeoutMessage = "Browser wait condition timed out.";
        const deadline = Date.now() + timeoutMs;
        const waitTimeout = yield* browserSync(() => remainingTime(deadline, timeoutMessage));
        yield* boundEngineOperation(
          tab,
          tab.engine.waitFor(condition, waitTimeout),
          waitTimeout,
          timeoutMessage,
          keepQueueBlocked,
        );
        const readTimeout = yield* browserSync(() => remainingTime(deadline, timeoutMessage));
        return yield* readResult(tab, keepQueueBlocked, readTimeout, timeoutMessage);
      }),
    );
  });

  readonly #runStep = Effect.fn("BrowserHost.runStep")(function* (
    this: BrowserHost,
    params: DynamicToolCallParams,
    tabId: string,
    step: BrowserStep,
    hooks: BrowserDynamicToolHooks,
  ): Effect.fn.Return<BrowserStepOutcome> {
    const run = Effect.gen({ self: this }, function* (): Effect.fn.Return<BrowserStepOutcome, BrowserOperationError> {
      yield* browserSync(() => this.#requireToolTab(params, tabId));
      const actionResult = (result: ClosedTabResult | DialogTabResult | null): BrowserStepOutcome => {
        if (result === null) return { status: "ok" };
        return "closed" in result ? { status: "tab_closed" } : { status: "dialog", dialog: result };
      };
      switch (step.action) {
        case "navigate":
          return actionResult(yield* this.#navigate(tabId, step, skipActionResult));
        case "wait_for": {
          const { action: _action, ...args } = step;
          yield* this.#waitFor(tabId, args, () => Effect.void);
          return { status: "ok" };
        }
        case "evaluate":
          return {
            status: "ok",
            value: yield* this.#runEvaluation(
              tabId,
              step.expression,
              step.awaitPromise ?? true,
              browserToolTimeout(step.timeoutMs),
              true,
              BROWSER_SCRIPT_EVALUATE_MAX_BYTES,
            ),
          };
        case "sleep":
          yield* Effect.sleep(step.ms);
          return { status: "ok" };
        case "snapshot":
          return {
            status: "ok",
            value: yield* this.#enqueue(tabId, (tab, keepQueueBlocked) =>
              readTabSnapshot(tab, tab.revision + 1, keepQueueBlocked).pipe(Effect.map((read) => read.snapshot)),
            ),
          };
        case "click": {
          const { action, ...args } = step;
          return actionResult(yield* this.#runInputStep({ tool: action, args: { ...args, tabId } }, hooks));
        }
        case "type": {
          const { action, ...args } = step;
          return actionResult(yield* this.#runInputStep({ tool: action, args: { ...args, tabId } }, hooks));
        }
        case "press": {
          const { action, ...args } = step;
          return actionResult(yield* this.#runInputStep({ tool: action, args: { ...args, tabId } }, hooks));
        }
        case "hover": {
          const { action, ...args } = step;
          return actionResult(yield* this.#runInputStep({ tool: action, args: { ...args, tabId } }, hooks));
        }
        case "scroll": {
          const { action, ...args } = step;
          return actionResult(yield* this.#runInputStep({ tool: action, args: { ...args, tabId } }, hooks));
        }
        case "select_option": {
          const { action, ...args } = step;
          return actionResult(yield* this.#runInputStep({ tool: action, args: { ...args, tabId } }, hooks));
        }
        case "set_checked": {
          const { action, ...args } = step;
          return actionResult(yield* this.#runInputStep({ tool: action, args: { ...args, tabId } }, hooks));
        }
      }
    });
    const outcome = (cause: unknown): BrowserStepOutcome =>
      cause instanceof BrowserUserControlHeld
        ? { status: "user_control" }
        : {
            status: "error",
            error: redactText(cause instanceof Error ? cause.message : String(cause)),
          };
    return yield* run.pipe(
      Effect.catch((failure) => Effect.succeed(outcome(failure.cause))),
      Effect.catchDefect((defect) =>
        Effect.sync(() => {
          logger.warn("A browser script step failed unexpectedly.", { action: step.action, error: toLogValue(defect) });
          return outcome(defect);
        }),
      ),
    );
  });

  readonly #runInputStep = Effect.fn("BrowserHost.runInputStep")(function* (
    this: BrowserHost,
    call: BrowserInputCall,
    hooks: BrowserDynamicToolHooks,
  ) {
    const action = yield* browserSync(() => browserInputAction(call, hooks));
    return yield* this.#runAction(
      call.args.tabId,
      action.name,
      action.target,
      (tab, deadline, markDispatched) => action.run(tab.engine, deadline, markDispatched),
      skipActionResult,
      browserToolTimeout(call.args.timeoutMs),
    );
  });

  readonly #finalStepsSnapshot = Effect.fn("BrowserHost.finalStepsSnapshot")(function* (
    this: BrowserHost,
    params: DynamicToolCallParams,
    tabId: string,
  ) {
    yield* browserSync(() => this.#requireToolTab(params, tabId));
    return yield* this.#enqueue(tabId, (tab, keepQueueBlocked) =>
      readTabSnapshot(tab, tab.revision + 1, keepQueueBlocked).pipe(Effect.map((read) => read.snapshot)),
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
      boundEngineOperation(
        tab,
        tab.engine.resolveUploadTarget(target),
        timeoutMs,
        "Browser upload target resolution timed out.",
        keepQueueBlocked,
      ),
    ).pipe(
      Effect.provideService(BrowserToolHold, (heldTabId: string) => this.#heldByUser(heldTabId)),
      Effect.provideService(BrowserToolQueueWait, TOOL_QUEUE_WAIT_MS),
    );
  }).bind(this);

  readonly destroy = Effect.fn("BrowserHost.destroy")(function* (this: BrowserHost) {
    if (this.#destroying) return yield* Deferred.await(this.#destroying);
    const done = Deferred.makeUnsafe<void, BrowserOperationError>();
    this.#destroying = done;
    clearInterval(this.#idleTabSweep);
    this.#closeBackgroundWindow();
    const result = yield* Effect.exit(
      Effect.gen({ self: this }, function* () {
        const persistence = yield* Effect.forkIn(this.#persistState(), this.#scope, { startImmediately: true });
        const drains = [...this.#closingTabDrains.values()].map(Fiber.join);
        for (const target of this.#persistentSessions()) target.flushStorageData();
        for (const tab of this.#tabs.values()) {
          tab.closing = true;
          tab.engine.releaseDialogs();
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
        this.#userControlTabIds.clear();
        for (const tabId of [...this.#userControlWaiters.keys()]) this.#completeUserControlWaiters(tabId);
        this.#listeners.clear();
        this.#controls.dispose();
        this.#documentListeners.clear();
        this.#siteVisitListeners.clear();
        const results = yield* Effect.all(
          [
            browserCall(() => Promise.all(this.#persistentSessions().map((target) => target.cookies.flushStore()))),
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
        for (const target of this.#persistentSessions()) target.flushStorageData();
        yield* this.#persistLock.withPermit(Effect.void);
        yield* Effect.forEach([...this.#appliedProxies.keys()], this.#dropAppliedProxy, { discard: true });
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
    const sessions = this.#persistentSessions();
    for (const target of sessions) target.flushStorageData();
    yield* browserCall(() => Promise.all(sessions.map((target) => target.cookies.flushStore())));
    yield* this.#persistState();
  }).bind(this);

  readonly clearAgentSession = Effect.fn("BrowserHost.clearAgentSession")(function* (
    this: BrowserHost,
    agentId: string,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.clearTabSession({ kind: "agent", key: agentBrowserSessionKey(agentId) });
  }).bind(this);

  readonly clearTabSession = Effect.fn("BrowserHost.clearTabSession")(function* (
    this: BrowserHost,
    tabSession: BrowserTabSession,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const partition = browserTabPartition(tabSession);
    if (this.tabIdsInSession(tabSession).length > 0)
      return yield* browserFailure(new Error(sourceText("error.backend.browserSessionInUse")));
    if (!this.#tabSessions.has(partition) && !existsSync(join(app.getPath("sessionData"), "Partitions", partition)))
      return;
    const target = this.#tabSessions.get(partition) ?? session.fromPartition(`persist:${partition}`, { cache: true });
    this.#tabSessions.delete(partition);
    yield* this.#dropAppliedProxy(partition);
    yield* browserCall(() => target.clearStorageData());
    yield* browserCall(() => target.clearCache());
  }).bind(this);

  tabIdsInSession(tabSession: BrowserTabSession): string[] {
    const partition = browserTabPartition(tabSession);
    return [...this.#tabs.values()]
      .filter((tab) => tab.tabSession && browserTabPartition(tab.tabSession) === partition)
      .map((tab) => tab.id);
  }

  listTabSessions(): { tabId: string; tabSession: BrowserTabSession }[] {
    return [...this.#tabs.values()].flatMap((tab) =>
      tab.tabSession && !tab.closing ? [{ tabId: tab.id, tabSession: tab.tabSession }] : [],
    );
  }

  readonly #agentTabSession = Effect.fn("BrowserHost.agentTabSession")(function* (
    this: BrowserHost,
    agentId: string,
  ): Effect.fn.Return<BrowserTabSession | undefined, BrowserOperationError> {
    const profile = this.#browserProfile(agentId);
    if (profile.kind === "shared") return undefined;
    if (profile.kind === "agent") return { kind: "agent", key: agentBrowserSessionKey(agentId) };
    if (!this.#profileExists(profile.profileId))
      return yield* browserFailure(new Error(sourceText("error.backend.browserProfileMissing")));
    return { kind: "profile", profileId: profile.profileId };
  }).bind(this);

  readonly #applyProfileProxy = Effect.fn("BrowserHost.applyProfileProxy")(function* (
    this: BrowserHost,
    tabSession: BrowserTabSession | undefined,
  ): Effect.fn.Return<void, BrowserOperationError> {
    if (tabSession?.kind !== "profile") return;
    yield* this.#proxyLock.withPermit(this.#setSessionProxy(tabSession));
  }).bind(this);

  readonly #setSessionProxy = Effect.fn("BrowserHost.setSessionProxy")(function* (
    this: BrowserHost,
    tabSession: Extract<BrowserTabSession, { kind: "profile" }>,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const proxy = yield* browserSync(() => this.#profileProxy(tabSession.profileId));
    const partition = browserTabPartition(tabSession);
    const key = JSON.stringify(proxy);
    const previous = this.#appliedProxies.get(partition);
    if (previous?.key === key) return;
    const target = this.#persistentTabSession(tabSession);
    this.#appliedProxies.delete(partition);
    const computerExit = this.#computerExit;
    const applied = yield* Effect.gen(function* () {
      const exit =
        proxy?.kind === "computer"
          ? computerExit(proxy.memberId)
          : proxy?.scheme === "socks5" && proxy.username !== null
            ? socksExit({
                host: proxy.host,
                port: proxy.port,
                username: proxy.username,
                password: proxy.password ?? "",
              })
            : null;
      const relay = exit === null ? null : yield* openBrowserProxyRelay(exit);
      const rules =
        relay !== null ? `http://${relay.host}:${relay.port}` : proxy?.kind === "address" ? proxyRules(proxy) : null;
      yield* Effect.gen(function* () {
        yield* browserCall(() =>
          target.setProxy(rules === null ? { mode: "system" } : { mode: "fixed_servers", proxyRules: rules }),
        );
        yield* browserCall(() => target.closeAllConnections());
        yield* browserCall(() => target.clearAuthCache());
      }).pipe(Effect.onError(() => relay?.close ?? Effect.void));
      const signIn =
        relay ??
        (proxy?.kind !== "address" || proxy.username === null
          ? null
          : { host: proxy.host, port: proxy.port, username: proxy.username, password: proxy.password ?? "" });
      return { key, proxy, signIn, relay } satisfies AppliedProxy;
    }).pipe(Effect.ensuring(previous?.relay?.close ?? Effect.void));
    this.#appliedProxies.set(partition, applied);
  }).bind(this);

  readonly #dropAppliedProxy = Effect.fn("BrowserHost.dropAppliedProxy")(function* (
    this: BrowserHost,
    partition: string,
  ) {
    yield* this.#proxyLock.withPermit(
      Effect.suspend(() => {
        const applied = this.#appliedProxies.get(partition);
        this.#appliedProxies.delete(partition);
        return applied?.relay?.close ?? Effect.void;
      }),
    );
  }).bind(this);

  readonly releaseProfileProxy = Effect.fn("BrowserHost.releaseProfileProxy")(function* (
    this: BrowserHost,
    profileId: string,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const tabSession: BrowserTabSession = { kind: "profile", profileId };
    const partition = browserTabPartition(tabSession);
    yield* this.#proxyLock.withPermit(
      Effect.gen({ self: this }, function* () {
        const applied = this.#appliedProxies.get(partition);
        if (applied === undefined || this.tabIdsInSession(tabSession).length > 0) return;
        const proxy = yield* browserSync(() => this.#profileProxy(profileId));
        if (applied.key === JSON.stringify(proxy)) return;
        this.#appliedProxies.delete(partition);
        if (applied.relay) yield* applied.relay.close;
      }),
    );
  }).bind(this);

  #tabProxySignIn(tab: Pick<BrowserHostTab, "tabSession">): AppliedProxy["signIn"] {
    if (tab.tabSession?.kind !== "profile") return null;
    return this.#appliedProxies.get(browserTabPartition(tab.tabSession))?.signIn ?? null;
  }

  #tabProxy(tab: Pick<BrowserHostTab, "tabSession">): BrowserProxyConnection | null {
    if (tab.tabSession?.kind !== "profile") return null;
    return this.#appliedProxies.get(browserTabPartition(tab.tabSession))?.proxy ?? null;
  }

  #tabRelay(tab: Pick<BrowserHostTab, "tabSession">): BrowserProxyRelay | null {
    if (tab.tabSession?.kind !== "profile") return null;
    return this.#appliedProxies.get(browserTabPartition(tab.tabSession))?.relay ?? null;
  }

  #tabProxyFailure(tab: BrowserHostTab, error: BrowserProxyFailure): RelayExitFailure {
    if (this.#proxySignInRefused.has(tab)) return "signIn";
    return this.#tabRelay(tab)?.exitFailure() ?? error;
  }

  #noteProxyLoad(tab: BrowserHostTab, failure: BrowserProxyFailure | null): void {
    const proxy = this.#tabProxy(tab);
    if (proxy === null || (this.#proxyFailures.get(proxy.proxyId)?.failure ?? null) === failure) return;
    if (failure === null) this.#proxyFailures.delete(proxy.proxyId);
    else
      this.#proxyFailures.set(proxy.proxyId, {
        failure,
        memberId: proxy.kind === "computer" ? proxy.memberId : null,
      });
    this.#onProxyStatusChanged();
  }

  #proxyLoadFailure(tab: BrowserHostTab, failure: BrowserOperationError): BrowserOperationError {
    const proxy = this.#tabProxy(tab);
    const proxyError = proxyErrorInText(String(failure.cause));
    if (proxyError === undefined) return failure;
    if (proxy === null) {
      const computerProxy =
        tab.tabSession?.kind !== "profile" || this.#appliedProxies.has(browserTabPartition(tab.tabSession));
      return computerProxy ? browserFailure(new Error(sourceText("error.backend.browserSystemProxyFailed"))) : failure;
    }
    if (proxy.kind === "computer")
      return browserFailure(
        new Error(
          sourceText(
            this.#tabRelay(tab)?.exitFailure() === "address"
              ? "error.backend.browserProxyComputerLocalAddress"
              : "error.backend.browserProxyComputerUnreachable",
          ),
        ),
      );
    const reason = this.#proxyFailures.get(proxy.proxyId)?.failure ?? this.#tabProxyFailure(tab, proxyError);
    return browserFailure(
      new Error(
        reason === "signIn"
          ? sourceText("error.backend.browserProxySignInRefused", { name: proxy.host })
          : sourceText("error.backend.browserProxyUnreachable", { name: proxy.host }),
      ),
    );
  }

  proxyFailure(proxyId: string): BrowserProxyFailure | null {
    return this.#proxyFailures.get(proxyId)?.failure ?? null;
  }

  forgetProxyFailure(proxyId: string): void {
    this.#proxyFailures.delete(proxyId);
  }

  forgetComputerFailures(memberId: string): void {
    for (const [proxyId, failure] of this.#proxyFailures)
      if (failure.memberId === memberId) this.#proxyFailures.delete(proxyId);
  }

  #persistentSessions(): Session[] {
    return [this.#session, ...this.#tabSessions.values()];
  }

  #tabSession(tab: Pick<BrowserHostTab, "privateSession" | "tabSession">): Session {
    return tab.privateSession ?? (tab.tabSession ? this.#persistentTabSession(tab.tabSession) : this.#session);
  }

  #persistentTabSession(tabSession: BrowserTabSession): Session {
    const partition = browserTabPartition(tabSession);
    const existing = this.#tabSessions.get(partition);
    if (existing) return existing;
    const target = session.fromPartition(`persist:${partition}`, { cache: true });
    this.#configureSession(target);
    this.#tabSessions.set(partition, target);
    return target;
  }

  #createTab(
    id: string,
    requestedUrl: string,
    ownerThreadId: string | null,
    ownerAgentId: string | null,
    environment: BrowserEnvironment = defaultBrowserEnvironment(),
    popupOptions?: BrowserWindowConstructorOptions,
    privateSession?: Session,
    tabSession?: BrowserTabSession,
  ): BrowserHostTab {
    if (this.#destroying) throw new Error("BrowserHost is shutting down.");
    const view = this.#createView(
      popupOptions,
      this.#tabSession({
        ...(privateSession ? { privateSession } : {}),
        ...(tabSession ? { tabSession } : {}),
      }),
    );
    this.#mountView(view);
    const diagnostics = new BrowserDiagnostics();
    const queue = Deferred.makeUnsafe<void>();
    Deferred.doneUnsafe(queue, Exit.void);
    return {
      id,
      view,
      contents: view.webContents,
      popup: popupOptions !== undefined,
      ...(privateSession ? { privateSession } : {}),
      ...(tabSession ? { tabSession } : {}),
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
      loadGeneration: 0,
      documents: 0,
      viewInvalidations: new Set(),
      viewContextMenu: null,
      lastUsedAt: Date.now(),
    };
  }

  #createView(popupOptions: BrowserWindowConstructorOptions | undefined, tabSession: Session): WebContentsView {
    const view = new WebContentsView({
      ...(popupOptions?.webContents ? { webContents: popupOptions.webContents } : {}),
      webPreferences: {
        ...popupOptions?.webPreferences,

        session: tabSession,
        ...this.#webPreferences,
      },
    });
    view.webContents.setAudioMuted(true);
    view.setBackgroundColor("#0b0b0b");
    allowPinchZoom(view.webContents);
    return view;
  }

  #configureSession(target: Session): void {
    app.userAgentFallback = sessionBrowserUserAgent(app.userAgentFallback);
    target.setUserAgent(sessionBrowserUserAgent(target.getUserAgent()), preferredBrowserLanguageCodes());
    const hintRequests = new BrowserHintRequests();
    target.webRequest.onBeforeSendHeaders((details, callback) => {
      const contents = details.webContents;
      const pageUrl =
        details.resourceType === "mainFrame"
          ? details.url
          : contents && !contents.isDestroyed()
            ? contents.getURL()
            : "";
      callback({
        requestHeaders: browserRequestHeaders(
          details.url,
          details.requestHeaders,
          hintRequests.requested(details.url, pageUrl),
        ),
      });
    });
    target.webRequest.onHeadersReceived((details, callback) => {
      if (details.resourceType === "mainFrame") hintRequests.note(details.url, details.responseHeaders);
      callback({});
    });
    target.webRequest.onCompleted((details) => {
      const tab = [...this.#tabs.values()].find((candidate) => candidate.contents.id === details.webContentsId);
      if (tab && details.resourceType === "mainFrame")
        this.#noteProxyLoad(tab, details.statusCode === 407 ? "signIn" : null);
      if (!tab || tab.secret) return;
      tab.diagnostics.add({
        kind: "network",
        level: details.statusCode >= 400 ? "error" : "info",
        message: `${details.method} ${details.statusCode}`,
        ...diagnosticUrlField(details.url),
        method: details.method,
        status: details.statusCode,
      });
      if (details.statusCode >= 400) this.#emitChanged();
    });
    target.webRequest.onErrorOccurred((details) => {
      const tab = [...this.#tabs.values()].find((candidate) => candidate.contents.id === details.webContentsId);
      const proxyError = PROXY_ERRORS.get(details.error);
      if (tab && details.resourceType === "mainFrame" && proxyError !== undefined) {
        const failure = this.#tabProxyFailure(tab, proxyError);
        this.#noteProxyLoad(tab, failure === "address" ? null : failure);
      }
      if (!tab || tab.secret) return;
      const cancelled = details.error === "net::ERR_ABORTED" && details.resourceType !== "mainFrame";
      tab.diagnostics.add({
        kind: "network",
        level: cancelled ? "info" : "error",
        message: `${details.method} ${details.error}`,
        ...diagnosticUrlField(details.url),
        method: details.method,
      });
      if (!cancelled) this.#emitChanged();
    });
    target.setPermissionRequestHandler((webContents, permission, callback, details) =>
      callback(
        isAllowedBrowserPermission(permission) || this.#recorder.allowsTabCapture(webContents, permission, details),
      ),
    );
    target.setPermissionCheckHandler((_webContents, permission) => isAllowedBrowserPermission(permission));
    target.on("will-download", (event, item, contents) => {
      const tab = [...this.#tabs.values()].find((candidate) => candidate.contents === contents);
      if (tab?.secret) {
        event.preventDefault();
        return;
      }
      const stopped = (message: string) => {
        if (!tab || tab.secret) return;
        tab.diagnostics.add({ kind: "network", level: "error", message, ...diagnosticUrlField(item.getURL()) });
        this.#emitChanged();
      };
      if (this.#activeDownloads >= MAX_ACTIVE_DOWNLOADS) {
        event.preventDefault();
        stopped(
          `Download refused: ${MAX_ACTIVE_DOWNLOADS} downloads are already in progress. No file was saved. Try again when one is done.`,
        );
        return;
      }
      if (item.getTotalBytes() > MAX_DOWNLOAD_BYTES) {
        event.preventDefault();
        stopped(DOWNLOAD_TOO_LARGE);
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
      this.#activeDownloads += 1;
      item.on("updated", () => {
        if (item.getState() !== "progressing" || item.getReceivedBytes() <= MAX_DOWNLOAD_BYTES) return;
        logger.warn("Browser download stopped at the size limit", { limitBytes: MAX_DOWNLOAD_BYTES });
        item.cancel();
        stopped(DOWNLOAD_TOO_LARGE);
      });
      item.once("done", (_doneEvent, state) => {
        this.#activeDownloads -= 1;
        this.#reservedDownloadPaths.delete(downloadPath);
        if (state === "interrupted") stopped("Download failed before the file was complete. Try again.");
        if (state !== "completed") return;
        if (!tab || tab.secret) return;
        tab.diagnostics.add({
          kind: "load",
          level: "info",
          message: `Download complete: saved at ${downloadPath} (${item.getReceivedBytes()} bytes)`,
          ...diagnosticUrlField(item.getURL()),
        });
      });
    });
  }

  #bindTabEvents(tab: BrowserHostTab): void {
    const contents = tab.contents;
    const changed = () => this.#emitChanged();
    if (this.#tabProxy(tab)) contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
    let proxySignIns = 0;
    contents.on("login", (event, _details, authInfo, callback) => {
      if (!authInfo.isProxy) return;
      event.preventDefault();
      const signIn = this.#tabProxySignIn(tab);
      if (
        signIn === null ||
        proxySignIns >= PROXY_SIGN_IN_ANSWERS ||
        authInfo.host.replace(/^\[|\]$/gu, "") !== signIn.host.replace(/^\[|\]$/gu, "") ||
        authInfo.port !== signIn.port
      ) {
        this.#proxySignInRefused.add(tab);
        callback();
        return;
      }
      proxySignIns += 1;
      callback(signIn.username, signIn.password);
    });
    contents.on("did-navigate", () => {
      proxySignIns = 0;
      this.#proxySignInRefused.delete(tab);
    });
    contents.on("close", () => {
      if (tab.contents !== contents) return;
      if (!tab.closing && !this.#destroying && this.#tabs.get(tab.id) === tab) this.#notePageClosedTab(tab);
      tab.closing = true;
      tab.focusedAtPageClose = contents.isFocused();
    });
    contents.once("destroyed", () => {
      if (tab.contents !== contents) return;
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
          if (isTimeoutError(error)) return;
          if (!isMainFrame || generation !== documentGeneration || this.#tabs.get(tab.id) !== tab) return;
          for (const listener of this.#documentListeners) listener(tab.id, new Set());
        });
    });
    contents.on("before-input-event", (event, input) => {
      if (this.#mountedViews.get(tab.view) === this.#window && this.#quitShortcut(input)) {
        event.preventDefault();
        return;
      }
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
        this.#collapseOnEscape(tab);
        return;
      }
      const shortcutWindow = this.#shortcutWindow(tab.view);
      if (isBrowserViewShortcut(input, process.platform === "darwin") && shortcutWindow) {
        event.preventDefault();
        this.#forwardKeyToWindow(input, shortcutWindow);
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
      const viewMenu = tab.viewContextMenu;
      tab.viewContextMenu = null;
      if (viewMenu && Date.now() <= viewMenu.until) {
        event.preventDefault();
        if (!tab.secret) viewMenu.deliver(viewContextMenu(items, params.linkURL, params.srcURL));
        return;
      }
      if (items.length === 0) return;
      event.preventDefault();
      const window = this.#mountedViews.get(tab.view);
      if (!window || window.isDestroyed()) return;
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
    this.#bindUserBrowsing(tab);
    contents.on("did-start-loading", changed);
    contents.on("dom-ready", () => {
      void contents.insertCSS(":where(html) { scrollbar-gutter: stable; }").catch(() => undefined);
      if (
        (tab.ownerThreadId !== null || tab.ownerAgentId !== null) &&
        !tab.secret &&
        !this.#takeoverTabIds.has(tab.id) &&
        !this.#userControlTabIds.has(tab.id)
      )
        refuseCookieBanners(contents);
    });
    contents.on("did-stop-loading", () => {
      if (tab.closing || tab.contents !== contents || contents.isDestroyed()) return;
      changed();
      Effect.runFork(
        this.#syncViewBackground(tab).pipe(Effect.ignore, Effect.forkIn(tab.scope, { startImmediately: true })),
      );
    });
    contents.on("console-message", (...eventArgs) => {
      if (this.#takeoverTabIds.has(tab.id) || this.#userControlTabIds.has(tab.id) || tab.secret) return;
      const details = readConsoleMessage(eventArgs);
      if (!details) return;
      tab.diagnostics.add({
        kind: "console",
        level: details.level,
        message: details.message,
        ...diagnosticUrlField(details.sourceId),
      });
      if (details.level === "error") this.#emitChanged();
    });
    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || tab.secret) return;
      tab.diagnostics.add({
        kind: "load",
        level: "error",
        message: `${code}: ${description}`,
        ...diagnosticUrlField(url),
      });
      this.#emitChanged();
    });
    contents.on("page-title-updated", changed);
    contents.on("render-process-gone", (_event, details) => {
      if (tab.closing || tab.contents !== contents || contents.isDestroyed() || details.reason === "clean-exit") return;
      if (tab.endingSilentPage) return;
      tab.crashes = (tab.crashes ?? 0) + 1;
      if (tab.secret) return;
      const reload =
        (tab.ownerThreadId !== null || tab.ownerAgentId !== null) &&
        !tab.filledCard &&
        !tab.pendingRestore &&
        !this.#takeoverTabIds.has(tab.id) &&
        !this.#userControlTabIds.has(tab.id);
      tab.diagnostics.add({
        kind: "load",
        level: "error",
        message: reload ? BROWSER_PAGE_CRASH_RELOADED : BROWSER_PAGE_CRASH_KEPT,
      });
      if (reload) tab.pendingRestore = () => reloadCrashedPage(tab);
      this.#emitChanged();
    });
    let focusedBeforeCommit: WebContents | null = null;
    const restoreFocusAfterCommit = () => {
      const previous = focusedBeforeCommit;
      focusedBeforeCommit = null;
      if (previous && contents.isFocused() && BrowserWindow.getFocusedWindow())
        restoreWebContentsFocus(previous, contents);
    };
    contents.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      focusedBeforeCommit = tab.focusOnCommit ? null : this.#focusedContentsOutsideTabs();
      tab.focusOnCommit = false;
    });
    contents.on("did-navigate", restoreFocusAfterCommit);
    contents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame && contents.isFocused()) restoreFocusAfterCommit();
    });
    contents.on("did-navigate", (_event, url) => {
      tab.documents += 1;
      this.#releaseScriptedDocument(tab);
      if (tab.secretDocument) {
        tab.secretDocument = false;
        tab.secretShown = false;
        contents.navigationHistory.clear();
      }
      if (tab.filledCard) {
        tab.filledCard = false;
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
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (this.#tabs.get(tab.id) !== tab) return;
      if (isMainFrame && isPersistableBrowserUrl(url)) tab.requestedUrl = persistentBrowserUrl(url);
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
      let popup: BrowserHostTab | undefined;
      return {
        action: "allow",
        outlivesOpener: true,
        overrideBrowserWindowOptions: {
          webPreferences: { ...this.#webPreferences, session: this.#tabSession(tab) },
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
            tab.privateSession,
            tab.tabSession,
          );
          if (tab.sharedThreadIds?.size) popup.sharedThreadIds = new Set(tab.sharedThreadIds);
          if (options.webContents?.opener) {
            popup.openerTabId = tab.id;
            popup.hasSharedBrowsingContext = true;
            tab.hasSharedBrowsingContext = true;
          }
          this.#tabs.set(popup.id, popup);
          this.#bindTabEvents(popup);
          tab.popupFailure = undefined;
          this.#activeTabId = popup.id;
          popup.focusOnVisible = this.#tabHasFocus();
          this.#syncAttachedView();
          this.#emitChanged();
          this.#schedulePersist();
          const created = popup;
          void runCauseEffect(
            enqueueTabOperation(created, () => created.engine.setEnvironment(created.environment), true),
          ).catch((error) => {
            logger.warn("Unable to apply popup environment", { error: toLogValue(error) });
          });
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

  #shortcutWindow(view: WebContentsView): BrowserWindow | null {
    const mounted = this.#mountedViews.get(view);
    if (mounted === this.#window) return mounted;
    return this.#pictureInPictureShortcuts && mounted === this.#pictureInPictureWindow ? mounted : null;
  }

  #forwardKeyToWindow(input: Input, window: BrowserWindow = this.#window): void {
    if (window.isDestroyed()) return;
    const keyCode = FORWARDED_KEY_CODES[input.key] ?? (input.key.length === 1 ? input.key.toUpperCase() : input.key);
    const modifiers: Array<"shift" | "control" | "alt" | "meta"> = [];
    if (input.shift) modifiers.push("shift");
    if (input.control) modifiers.push("control");
    if (input.alt) modifiers.push("alt");
    if (input.meta) modifiers.push("meta");
    window.webContents.focus();
    window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  }

  #collapseOnEscape(tab: BrowserHostTab): void {
    if (!this.#collapsesOnEscape(tab)) return;
    const frame = tab.contents.focusedFrame ?? tab.contents.mainFrame;
    if (!frame || frame.isDestroyed()) return;
    void frame
      .executeJavaScript(EDITABLE_FOCUS_SCRIPT, true)
      .then((editable) => {
        if (editable !== false) return;
        if (!this.#collapsesOnEscape(tab) || this.#window.isDestroyed()) return;
        this.#window.webContents.focus();
        this.#window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
        this.#window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      })
      .catch(() => undefined);
  }

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
          if (root !== transparent) return root;
          return location.href === "about:blank" ? "#0b0b0b" : "#ffffff";
        })()`,
          true,
        ),
      );
      if (isString(background)) tab.view.setBackgroundColor(background);
    }).pipe(Effect.catch(() => Effect.void));
  });

  #snapshotResult(result: SnapshotReadResult, mode: BrowserImageMode, imageUrl: string | null): DynamicToolResult {
    if (!imageUrl) return snapshotTextResult(result.snapshot);
    result.snapshot.image = {
      included: true,
      reason: mode === "always" ? "requested" : result.imageReason,
      width: result.snapshot.viewport.width,
      height: result.snapshot.viewport.height,
    };
    return {
      success: true,
      contentItems: [
        { type: "inputText", text: snapshotJson(result.snapshot) },
        { type: "inputImage", imageUrl },
      ],
    };
  }

  #blockMainPinchZoom(blocked: boolean): void {
    if (!this.#window.isDestroyed()) blockPinchZoom(this.#window.webContents, blocked);
  }

  #syncAgentPinchZoom(state: BrowserControlState): void {
    for (const tab of this.#tabs.values()) {
      if (!tab.contents.isDestroyed()) blockPinchZoom(tab.contents, drivenByAgent(state, tab));
    }
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
      this.#hideAttachedView();
      this.#mainPageListener?.(null);
      this.#blockMainPinchZoom(false);
      return;
    }

    if (this.#attachedView !== tab.view) {
      this.#hideAttachedView();
      this.#mountView(tab.view, targetWindow);
      this.#attachedView = tab.view;
    } else {
      this.#mountView(tab.view, targetWindow);
    }
    tab.view.setBorderRadius(0);
    const zoomFactor = targetWindow.webContents.getZoomFactor();
    const bounds = validateBounds({
      x: this.#bounds.x * zoomFactor,
      y: this.#bounds.y * zoomFactor,
      width: this.#bounds.width * zoomFactor,
      height: this.#bounds.height * zoomFactor,
    });
    tab.view.setBounds(bounds);
    this.#unthrottle(tab);
    tab.view.setVisible(true);
    this.#attachedViewShown = true;
    tab.contents.invalidate();
    this.#raisePictureInPictureOverlay();
    this.#mainPageListener?.(this.#target === "main" ? { tabId: tab.id, bounds, zoomFactor } : null);
    this.#blockMainPinchZoom(this.#target === "main");
    if (tab.focusOnVisible && !this.#inBackgroundWindow(tab.view)) {
      tab.focusOnVisible = false;
      tab.contents.focus();
    }
  }

  #hideAttachedView(): void {
    this.#attachedViewShown = false;
    if (this.#attachedView) this.#hideView(this.#attachedView);
  }

  #hideView(view: WebContentsView): void {
    view.setVisible(SHOWS_VIEWS_IN_BACKGROUND && this.#inBackgroundWindow(view));
  }

  #viewShown(view: WebContentsView): boolean {
    return SHOWS_VIEWS_IN_BACKGROUND ? view === this.#attachedView && this.#attachedViewShown : view.getVisible();
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
      !this.#viewShown(tab.view) ||
      tab.contents.isDestroyed()
    ) {
      return;
    }
    if (this.#inBackgroundWindow(tab.view)) {
      tab.focusOnVisible = true;
      return;
    }
    tab.contents.focus();
  }

  #mountView(view: WebContentsView, window = this.#window): void {
    if (window === this.#window) this.#syncBackgroundWindow();
    const parent = this.#nativeParent(window);
    const currentWindow = this.#mountedViews.get(view);
    if (currentWindow === window) {
      parent.contentView.addChildView(view);
      return;
    }
    const currentParent = currentWindow && this.#nativeParent(currentWindow);
    if (currentParent && !currentParent.isDestroyed()) currentParent.contentView.removeChildView(view);
    parent.contentView.addChildView(view);
    this.#mountedViews.set(view, window);
    view.setVisible(true);
    view.setBounds(this.#hiddenViewBounds(window));
    this.#hideView(view);
  }

  #hiddenViewBounds(window: BrowserWindow): Rectangle {
    if (this.#bounds && window === this.#window) {
      const zoomFactor = window.webContents.getZoomFactor();
      const { width, height } = validateBounds({
        x: 0,
        y: 0,
        width: this.#bounds.width * zoomFactor,
        height: this.#bounds.height * zoomFactor,
      });
      if (width >= MIN_HIDDEN_VIEWPORT.width && height >= MIN_HIDDEN_VIEWPORT.height)
        return { x: 0, y: 0, width, height };
    }
    const { width, height } = electronScreen.getPrimaryDisplay().workAreaSize;
    return {
      x: 0,
      y: 0,
      width: Math.max(MIN_HIDDEN_VIEWPORT.width, width),
      height: Math.max(MIN_HIDDEN_VIEWPORT.height, height - CHROME_TOOLBAR_HEIGHT),
    };
  }

  #nativeParent(window: BrowserWindow): BaseWindow {
    return window === this.#window && this.#mainViewsInBackground && this.#backgroundWindow
      ? this.#backgroundWindow
      : window;
  }

  #inBackgroundWindow(view: WebContentsView): boolean {
    const window = this.#mountedViews.get(view);
    return window !== undefined && this.#nativeParent(window) !== window;
  }

  #syncBackgroundWindow(): boolean {
    const window = this.#window;
    if (
      !USES_BACKGROUND_WINDOW ||
      window.isDestroyed() ||
      this.#destroying ||
      (process.platform === "darwin" && app.isHidden())
    )
      return false;
    const background = !window.isVisible() || window.isMinimized();
    if (background === this.#mainViewsInBackground) return false;
    const from = this.#nativeParent(window);
    if (background) {
      this.#backgroundWindow ??= this.#openBackgroundWindow();
      this.#backgroundWindow.setBounds(this.#backgroundBounds(window));
      this.#backgroundWindow.showInactive();
    }
    this.#mainViewsInBackground = background;
    this.#moveMainViews(from, this.#nativeParent(window), background);
    if (!background) this.#backgroundWindow?.hide();
    return true;
  }

  #openBackgroundWindow(): BaseWindow {
    const background = createBackgroundWindow();
    this.#hideFromWindowSwitchers(background);
    background.once("closed", () => {
      if (this.#backgroundWindow !== background) return;
      this.#backgroundWindow = null;
      if (!this.#mainViewsInBackground) return;
      this.#mainViewsInBackground = false;
      if (!this.#window.isDestroyed()) this.#moveMainViews(background, this.#window, false);
    });
    return background;
  }

  #moveMainViews(from: BaseWindow, to: BaseWindow, background: boolean): void {
    for (const [view, owner] of this.#mountedViews) {
      if (owner !== this.#window) continue;
      if (!from.isDestroyed()) from.contentView.removeChildView(view);
      to.contentView.addChildView(view);
      if (SHOWS_VIEWS_IN_BACKGROUND)
        view.setVisible(background || (view === this.#attachedView && this.#attachedViewShown));
    }
  }

  #backgroundBounds(window: BrowserWindow): Rectangle {
    if (SHOWS_VIEWS_IN_BACKGROUND) {
      const { x, y } = window.getContentBounds();
      return { x, y, width: 1, height: 1 };
    }
    if (process.platform !== "win32" || !window.isMinimized()) return window.getContentBounds();
    const { x, y, width, height } = window.getNormalBounds();
    let right = width;
    let bottom = height;
    for (const [view, owner] of this.#mountedViews) {
      if (owner !== window) continue;
      const bounds = view.getBounds();
      right = Math.max(right, bounds.x + bounds.width);
      bottom = Math.max(bottom, bounds.y + bounds.height);
    }
    return { x, y, width: right, height: bottom };
  }

  #closeBackgroundWindow(): void {
    const background = this.#backgroundWindow;
    this.#backgroundWindow = null;
    this.#mainViewsInBackground = false;
    if (!background || background.isDestroyed()) return;
    for (const view of [...background.contentView.children]) background.contentView.removeChildView(view);
    background.destroy();
  }

  #unmountView(view: WebContentsView): void {
    view.setVisible(false);
    const window = this.#mountedViews.get(view);
    const parent = window && this.#nativeParent(window);
    if (parent && !parent.isDestroyed()) parent.contentView.removeChildView(view);
    this.#mountedViews.delete(view);
    if (this.#attachedView === view) {
      this.#attachedView = null;
      this.#attachedViewShown = false;
    }
  }

  #rendererGone(tabId: string): Effect.Effect<BrowserStepOutcome> {
    return Effect.callback<BrowserStepOutcome>((resume) => {
      const contents = this.#tabs.get(tabId)?.contents;
      if (!contents || contents.isDestroyed()) return;
      const gone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
        if (details.reason !== "clean-exit" && !this.#tabs.get(tabId)?.endingSilentPage)
          resume(Effect.succeed({ status: "page_crashed" }));
      };
      contents.on("render-process-gone", gone);
      return Effect.sync(() => contents.off("render-process-gone", gone));
    });
  }

  readonly #requireTab = Effect.fn("BrowserHost.requireTab")(function* (this: BrowserHost, tabId: string) {
    const tab = this.#tabs.get(tabId);
    if (!tab) return yield* browserFailure(new Error(`Unknown browser tab: ${tabId}`));
    yield* this.#wake(tab);
    tab.lastUsedAt = Date.now();
    this.#unthrottle(tab);
    return tab;
  });

  #requireToolTab(params: DynamicToolCallParams, tabId: string, dialogTool = false, closing = false): void {
    const tab = this.listTabs().find((candidate) => candidate.id === tabId);
    if (!tab) {
      const closed = this.#pageClosedTabs.get(tabId);
      if (closed && this.#canUseToolTab(params, { ...closed, id: tabId }))
        throw new Error(PAGE_CLOSED_TAB_ERROR(tabId));
    }
    if (!tab || !this.#canUseToolTab(params, tab)) throw new Error(`Unknown browser tab: ${tabId}`);
    const secret = this.#tabs.get(tabId)?.secret;
    if (secret && !(closing && secret.submitted && !secret.running))
      throw new Error("Browser inspection is protected during authentication. Use takeover.");
    if (this.#takeoverTabIds.has(tabId)) throw new Error(`Browser tab is under user takeover: ${tabId}`);
    if (this.#heldByUser(tabId)) throw new BrowserUserControlHeld(tabId);
    const hostTab = this.#tabs.get(tabId);
    if (hostTab) hostTab.lastToolChat = { threadId: params.threadId, at: Date.now() };
    const engine = hostTab?.engine;
    const dialog = engine?.dialog;
    if (!dialog || dialogTool) return;
    if (engine?.dialogOwnedBy({ threadId: params.threadId, turnId: params.turnId }))
      throw new Error(
        `A ${dialog.type} dialog is open in this tab: ${JSON.stringify(dialog.message)}. Answer it first with handle_dialog, dialogId ${dialog.id}.`,
      );
    throw new Error(
      "A dialog is open in this tab, and only a person can answer it. Ask the user to answer it, then try again.",
    );
  }

  #canUseToolTab(
    params: DynamicToolCallParams,
    tab: Pick<BrowserTab, "id" | "ownerThreadId" | "ownerAgentId"> & { sharedThreadIds?: ReadonlySet<string> },
    chatOf: (threadId: string) => BrowserAgentChat | null = this.#agentChat,
  ): boolean {
    const ownerAgentId = params.ownerAgentId ?? null;
    if (tab.ownerThreadId === params.threadId) return tab.ownerAgentId === null || tab.ownerAgentId === ownerAgentId;
    if (tab.ownerAgentId === null || tab.ownerAgentId !== ownerAgentId) return false;
    if ((tab.sharedThreadIds ?? this.#tabs.get(tab.id)?.sharedThreadIds)?.has(params.threadId)) return true;
    if (chatOf(params.threadId)?.agentId !== ownerAgentId) return false;
    return tab.ownerThreadId === null || chatOf(tab.ownerThreadId)?.agentId === ownerAgentId;
  }

  #notePageClosedTab(tab: BrowserHostTab): void {
    if (tab.ownerThreadId === null && tab.ownerAgentId === null) return;
    logger.info("A page closed its own browser tab.", { tabId: tab.id, host: logUrlHost(tab.requestedUrl) });
    this.#pageClosedTabs.set(tab.id, {
      ownerThreadId: tab.ownerThreadId,
      ownerAgentId: tab.ownerAgentId,
      sharedThreadIds: new Set(tab.sharedThreadIds),
    });
    const oldest = this.#pageClosedTabs.keys().next().value;
    if (this.#pageClosedTabs.size > PAGE_CLOSED_TAB_LIMIT && oldest !== undefined) this.#pageClosedTabs.delete(oldest);
  }

  toolCanUseTab(params: DynamicToolCallParams, tabId: string): boolean {
    const tab = this.listTabs().find((candidate) => candidate.id === tabId);
    return tab !== undefined && this.#canUseToolTab(params, tab);
  }

  shareTab(tabId: string, target: { agentId: string; threadId: string }): void {
    const tab = this.#tabs.get(tabId);
    if (!tab || tab.closing || tab.privateSession || tab.ownerAgentId === null) return;
    if (tab.ownerAgentId !== target.agentId || tab.ownerThreadId === target.threadId) return;
    if (tab.sharedThreadIds?.has(target.threadId)) return;
    tab.sharedThreadIds = (tab.sharedThreadIds ?? new Set()).add(target.threadId);
    this.#schedulePersist();
  }

  unshareThread(threadId: string): void {
    let changed = false;
    for (const tab of this.#tabs.values()) changed = tab.sharedThreadIds?.delete(threadId) === true || changed;
    if (changed) this.#schedulePersist();
  }

  agentTab(tabId: string, agentId: string): { title: string; url: string } | null {
    const tab = this.#tabs.get(tabId);
    if (!tab || tab.closing || tab.contents.isDestroyed() || tab.ownerAgentId !== agentId) return null;
    const { title, url } = toPublicTab(tab);
    return { title: tab.engine.scrubText(title), url: tab.engine.scrubText(url) };
  }

  readonly #leaveSilentPage = Effect.fn("BrowserHost.leaveSilentPage")(function* (
    this: BrowserHost,
    tabId: string,
    direction?: BrowserNavigationDirection | "reload",
  ) {
    const tab = this.#tabs.get(tabId);
    if (!tab || tab.closing || tab.secret || tab.pendingRestore || tab.contents.isDestroyed()) return;
    if (direction === "back" && !hasHistoryEntry(tab.contents, -1)) return;
    if (direction === "forward" && !hasHistoryEntry(tab.contents, 1)) return;
    if (yield* tab.engine.pageAnswers().pipe(Effect.orElseSucceed(() => true))) return;
    logger.warn("Ending the renderer of a browser tab whose page does not answer before it navigates");
    const contents = tab.contents;
    yield* Effect.callback<void>((resume) => {
      const gone = () => resume(Effect.void);
      contents.once("render-process-gone", gone);
      tab.endingSilentPage = true;
      contents.forcefullyCrashRenderer();
      return Effect.sync(() => {
        if (!contents.isDestroyed()) contents.off("render-process-gone", gone);
      });
    }).pipe(
      Effect.timeoutOption(SILENT_PAGE_EXIT_WAIT_MS),
      Effect.ensuring(
        Effect.sync(() => {
          tab.endingSilentPage = false;
        }),
      ),
    );
  });

  readonly #enqueue = Effect.fn("BrowserHost.enqueue")(function* <T>(
    this: BrowserHost,
    tabId: string,
    operation: (tab: BrowserHostTab, keepQueueBlocked: KeepQueueBlocked) => Effect.Effect<T, BrowserOperationError>,
    allowProtected = false,
  ) {
    const tab = yield* this.#requireTab(tabId);
    return yield* enqueueTabOperation(tab, operation, allowProtected);
  });

  readonly #runAction = Effect.fn("BrowserHost.runAction")(function* <A>(
    this: BrowserHost,
    tabId: string,
    action: string,
    target: BrowserTarget | undefined,
    operation: (
      tab: BrowserHostTab,
      deadline: number,
      markDispatched: () => void,
    ) => Effect.Effect<void, BrowserOperationError>,
    readResult: ActionResultReader<A>,
    timeoutMs?: number,
    onOperationStarted?: (completion: Fiber.Fiber<void, BrowserOperationError>) => void,
  ): Effect.fn.Return<A | ClosedTabResult | DialogTabResult, BrowserOperationError> {
    const tab = yield* this.#requireTab(tabId);
    return yield* runTabAction(tab, action, target, operation, readResult, timeoutMs, onOperationStarted);
  });

  readonly #runEvaluation = Effect.fn("BrowserHost.runEvaluation")(function* (
    this: BrowserHost,
    tabId: string,
    expression: string,
    awaitPromise: boolean,
    timeoutMs: number,
    undefinedAsNull = false,
    maxBytes?: number,
  ): Effect.fn.Return<BrowserJsonValue, BrowserOperationError> {
    const tab = yield* this.#requireTab(tabId);
    const markScripted = () => {
      const origin = urlOrigin(currentTabUrl(tab));
      if (!origin) return;
      markScriptedOrigin(tab, origin);
      this.#cacheTainted(this.#tabSession(tab)).add(origin);
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
      undefinedAsNull,
      maxBytes,
    ).pipe(Effect.ensuring(Effect.sync(markScripted)));
  });

  #tabHasFocus(): boolean {
    const focusedContents = webContents.getFocusedWebContents();
    return focusedContents !== null && [...this.#tabs.values()].some((tab) => tab.contents === focusedContents);
  }

  #focusedContentsOutsideTabs(): WebContents | null {
    const focusedContents = webContents.getFocusedWebContents();
    return focusedContents && ![...this.#tabs.values()].some((candidate) => candidate.contents === focusedContents)
      ? focusedContents
      : null;
  }

  #userBrowsingAgent(tab: BrowserHostTab): string | null {
    const agentId = tab.ownerAgentId;
    if (agentId === null || tab.secret || tab.privateSession || tab.contents.isDestroyed()) return null;
    if (!this.#takeoverTabIds.has(tab.id) && !this.#userControlTabIds.has(tab.id)) return null;
    return this.#userBrowsing?.enabled() ? agentId : null;
  }

  #recordUserStep(tab: BrowserHostTab, step: BrowserTeachStep): void {
    if (this.#recordTeachStep(tab, step)) return;
    const agentId = this.#userBrowsingAgent(tab);
    if (agentId !== null) this.#userBrowsing?.record(agentId, step);
  }

  #bindUserBrowsing(tab: BrowserHostTab): void {
    const contents = tab.contents;
    const records = () => this.#teachRecordings.has(tab.id) || this.#userBrowsingAgent(tab) !== null;
    const recordPage = () => {
      const place = records() ? stepPlace(tab.engine.scrubText(contents.getURL())) : null;
      if (!place) return;
      const title = stepText(tab.engine.scrubText(contents.getTitle()));
      this.#recordUserStep(tab, { kind: "page", ...place, ...(title ? { title } : {}) });
    };
    contents.on("did-finish-load", recordPage);
    contents.on("page-title-updated", recordPage);
    contents.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
      if (isMainFrame) recordPage();
    });
    let press: { x: number; y: number; inPage: boolean } | null = null;
    contents.on("before-mouse-event", (_event, input) => {
      if (input.type !== "mouseDown" || !records()) return;
      const place = stepPlace(tab.engine.scrubText(contents.getURL()));
      if (!place) return;
      const zoom = contents.getZoomFactor() || 1;
      const viewed = tab.engine.viewPress();
      const current = viewed ? { ...viewed, inPage: true } : { x: input.x / zoom, y: input.y / zoom, inPage: false };
      press = current;
      setImmediate(() => {
        if (press === current) press = null;
        this.#recordClick(tab, place, current);
      });
    });
    contents.on("input-event", (_event, input) => {
      if (input.type === "mouseDown" && press) press.inPage = true;
    });
  }

  #recordClick(
    tab: BrowserHostTab,
    place: { host: string; path: string },
    press: { x: number; y: number; inPage: boolean },
  ): void {
    if (tab.closing || tab.contents.isDestroyed()) return;
    const record = Effect.map(tab.engine.clickTargetAt(press.x, press.y, press.inPage), (target) => {
      if (target)
        this.#recordUserStep(tab, {
          kind: "click",
          ...place,
          ...target,
          ...(target.name === undefined ? {} : { name: tab.engine.scrubText(target.name) }),
        });
    });
    Effect.runFork(record.pipe(Effect.forkIn(tab.scope, { startImmediately: true })));
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
    const driven = drivenByAgent(this.#controls.state(), tab);
    const visit: BrowserSiteVisit = {
      tabId: tab.id,
      hostname,
      actor: driven ? "agent" : "user",
      agentId: driven ? tab.ownerAgentId : null,
    };
    for (const listener of this.#siteVisitListeners) {
      try {
        listener(visit);
      } catch {}
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
    const saved = [...this.#tabs.values()].filter(
      (tab) => !tab.closing && !tab.contents.isDestroyed() && !tab.privateSession,
    );
    const state: StoredBrowserStateV2 = {
      version: 2,
      activeTabId: saved.some((tab) => tab.id === this.#activeTabId) ? this.#activeTabId : (saved[0]?.id ?? null),
      tabs: saved.map((tab) => ({
        id: tab.id,
        url: tab.secret?.origin ?? persistentBrowserUrl(currentTabUrl(tab), { popup: tab.popup }),
        ownerThreadId: tab.ownerThreadId,
        ownerAgentId: tab.ownerAgentId,
        environment: tab.environment,
        ...storedSessionFields(tab.tabSession),
        ...(tab.sharedThreadIds?.size ? { sharedThreadIds: [...tab.sharedThreadIds] } : {}),
      })),
    };
    yield* this.#persistLock.withPermit(
      writeJsonFileAtomically(this.#stateWritePath, state).pipe(
        Effect.mapError((error) => browserFailure(error.cause)),
      ),
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
const CRASH_RELOAD_TIMEOUT_MS = 30_000;

const SILENT_PAGE_EXIT_WAIT_MS = 5_000;

const reloadCrashedPage = Effect.fn("BrowserHost.reloadCrashedPage")(function* (tab: BrowserHostTab) {
  const url = currentTabUrl(tab);
  yield* browserCall(() => tab.contents.loadURL(url && url !== "about:blank" ? url : tab.requestedUrl)).pipe(
    Effect.timeoutOption(CRASH_RELOAD_TIMEOUT_MS),
    Effect.ignore,
  );
  yield* tab.engine.setEnvironment(tab.environment);
});

const loadSavedPage = Effect.fn("BrowserHost.loadSavedPage")(function* (tab: BrowserHostTab) {
  yield* browserCall(() => tab.contents.loadURL("about:blank"));
  yield* tab.engine.setEnvironment(tab.environment);
  yield* tab.engine.navigate(tab.requestedUrl);
  yield* browserSync(() => tab.contents.navigationHistory.clear());
});

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

function approximateSite(origin: string): string {
  const hostname = new URL(origin).hostname;
  if (isIP(hostname.replace(/^\[|\]$/gu, "")) !== 0) return hostname;
  return hostname.split(".").slice(-2).join(".");
}

function diagnosticUrlField(value: string): { url?: string } {
  const url = diagnosticUrl(value);
  return url === undefined ? {} : { url };
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
  if (size.width <= 0 || size.height <= 0)
    throw new Error(
      "Browser screenshot is empty: the page drew no image. This can happen while the OpenBot window is minimized or hidden. If it is, ask the person to open the OpenBot window, then try again.",
    );
  const area = size.width * size.height;
  const scale = Math.sqrt(MAX_ENCODED_CAPTURE_PIXELS / area);
  const fitted =
    area <= MAX_ENCODED_CAPTURE_PIXELS
      ? image
      : image.resize({
          width: Math.max(1, Math.floor(size.width * scale)),
          height: Math.max(1, Math.floor(size.height * scale)),
          quality: "good",
        });
  const fittedSize = fitted.getSize();
  if (fittedSize.width < MIN_CAPTURE_SIDE || fittedSize.height < MIN_CAPTURE_SIDE) return paddedCaptureDataUrl(fitted);
  return fitted.toDataURL();
}

function paddedCaptureDataUrl(image: NativeImage): string {
  const encoded = image.toDataURL();
  const source = nativeImage.createFromDataURL(encoded);
  const size = source.getSize();
  const width = Math.max(MIN_CAPTURE_SIDE, size.width);
  const height = Math.max(MIN_CAPTURE_SIDE, size.height);
  if (width === size.width && height === size.height) return encoded;
  const pixels = source.toBitmap();
  const padded = Buffer.alloc(width * height * 4);
  padded.fill(pixels.subarray(0, 4));
  for (let row = 0; row < size.height; row++)
    pixels.copy(padded, row * width * 4, row * size.width * 4, (row + 1) * size.width * 4);
  return nativeImage.createFromBitmap(padded, { width, height }).toDataURL();
}

function reloadWithGet(tab: BrowserHostTab): Effect.Effect<void, BrowserOperationError> {
  return navigateAndWait(tab.contents, () => tab.contents.loadURL(currentTabUrl(tab), browserLoadOptions()));
}

function untilStopped(
  tab: BrowserHostTab,
  load: Effect.Effect<void, BrowserOperationError>,
): Effect.Effect<void, BrowserOperationError> {
  const generation = tab.loadGeneration;
  return load.pipe(Effect.catch((failure) => (tab.loadGeneration === generation ? Effect.fail(failure) : Effect.void)));
}

function navigateHistory(contents: WebContents, direction: BrowserNavigationDirection): boolean {
  const offset = direction === "back" ? -1 : 1;
  if (!hasHistoryEntry(contents, offset)) return false;
  contents.navigationHistory.goToOffset(offset);
  return true;
}

function textResult(value: unknown): DynamicToolResult {
  return {
    success: true,
    contentItems: [{ type: "inputText", text: JSON.stringify(value) }],
  };
}

function valueTextResult(value: BrowserJsonValue): DynamicToolResult {
  const text = JSON.stringify(value);
  let shown = text;
  if (isString(value)) {
    const cut = cutStringValue(value);
    if (cut) shown = `${JSON.stringify(cut.text)}\n${cut.note}`;
  } else {
    const cut = cutModelText(text, BROWSER_VALUE_TEXT_LIMIT, BROWSER_VALUE_MORE);
    if (cut) shown = `${cut.text}\n${cut.note}`;
  }
  return { success: true, contentItems: [{ type: "inputText", text: shown }] };
}

function cutStringValue(value: string): ModelTextCut | null {
  if (JSON.stringify(value).length <= BROWSER_VALUE_TEXT_LIMIT) return null;
  return cutModelText(value, jsonStringFit(value, BROWSER_VALUE_TEXT_LIMIT), BROWSER_STRING_MORE);
}

function boundedScriptValue(value: BrowserJsonValue | undefined): { value?: string; valueCut?: string } {
  if (value === undefined) return {};
  if (isString(value)) {
    const cut = cutStringValue(value);
    return cut ? { value: cut.text, valueCut: cut.note } : {};
  }
  const json = JSON.stringify(value);
  if (json.length <= BROWSER_VALUE_TEXT_LIMIT) return {};
  const cut = cutModelText(json, jsonStringFit(json, BROWSER_VALUE_TEXT_LIMIT), BROWSER_VALUE_MORE);
  return cut ? { value: cut.text, valueCut: cut.note } : {};
}

type ClosedTabResult = { tabId: string; closed: true; openerTabId?: string };

type SnapshotToolPayload =
  | BrowserSnapshot
  | ClosedTabResult
  | DialogTabResult
  | BrowserFillFieldsResult
  | (Pick<BrowserCardFillResult, "filled"> &
      Partial<Pick<BrowserCardFillResult, "unconfirmed">> & {
        snapshot: BrowserSnapshot | ClosedTabResult | DialogTabResult | null;
      })
  | (BrowserScriptResult & {
      tabId: string;
      valueCut?: string;
      snapshotError?: string;
      url?: string;
      snapshot?: BrowserSnapshot;
    });

function snapshotTextResult(value: SnapshotToolPayload): DynamicToolResult {
  return {
    success: true,
    contentItems: [{ type: "inputText", text: snapshotJson(value) }],
  };
}

function snapshotJson(value: SnapshotToolPayload): string {
  if ("elements" in value) return JSON.stringify(withElementLines(value));
  if ("snapshot" in value) return JSON.stringify({ ...value, snapshot: withElementLines(value.snapshot) });
  return JSON.stringify(value);
}

function withElementLines(snapshot: BrowserSnapshot | ClosedTabResult | DialogTabResult | null | undefined) {
  return snapshot && "elements" in snapshot ? { ...snapshot, elements: snapshot.elements.map(elementLine) } : snapshot;
}

const ROLE_TAGS: Readonly<Record<string, readonly string[]>> = {
  button: ["button"],
  link: ["a"],
  textbox: ["input", "textarea"],
  searchbox: ["input"],
  combobox: ["input"],
  checkbox: ["input"],
  radio: ["input"],
  slider: ["input"],
  spinbutton: ["input"],
  option: ["option"],
  img: ["img"],
};

function elementLine(element: BrowserElement): string {
  const tokens = [element.ref];
  if (element.role) tokens.push(element.role);
  tokens.push(JSON.stringify(element.name));
  if (!element.role || !ROLE_TAGS[element.role]?.includes(element.tag)) tokens.push(`<${element.tag}>`);
  if (element.value !== null) tokens.push(`value=${JSON.stringify(element.value)}`);
  if (element.description) tokens.push(`description=${JSON.stringify(element.description)}`);
  tokens.push(...element.states);
  const { bounds, frame } = element;
  if (bounds) tokens.push(`bounds=${bounds.x},${bounds.y},${bounds.width},${bounds.height}`);
  if (frame) tokens.push(`frame=${frame.id}`, `frameUrl=${JSON.stringify(frame.url)}`);
  return tokens.join(" ");
}

function uniqueDownloadPath(root: string, name: string, reserved: Set<string>): string {
  const extension = extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  for (let suffix = 1; ; suffix += 1) {
    const candidate = join(root, suffix === 1 ? name : `${stem} (${suffix})${extension}`);
    if (!reserved.has(candidate) && !existsSync(candidate)) return candidate;
  }
}
