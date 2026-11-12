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
  socksExit,
} from "./browser-profiles/browser-proxy-relay";
import type { BrowserProxyConnection } from "./browser-profiles/browser-proxy-store";
import { BrowserRecorder } from "./browser-recorder";
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
import { readClickTarget } from "./browser-user-click";
import { runCauseEffect } from "./effect-boundary";
import {
  BROWSER_STRING_MORE,
  BROWSER_VALUE_MORE,
  BROWSER_VALUE_TEXT_LIMIT,
  cutModelText,
  jsonStringFit,
  type ModelTextCut,
} from "./model-text-limit";
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
 * The shortest side of an image for the model. Some model endpoints refuse an image with a shorter
 * side, and the image stays in the session, so each later turn fails too (#6188).
 */
const MIN_CAPTURE_SIDE = 64;
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
/** The agent browser tools that read or change the agent's tab set, and not one tab. */
const TAB_SET_TOOLS: ReadonlySet<string> = new Set(["open", "list_tabs", "status"]);
/** How long after a live view's right-click the page's menu still belongs to that view. */
const VIEW_CONTEXT_MENU_MS = 1_500;
/**
 * How long `handle_dialog` waits for the action that opened the dialog. After it, the status read waits
 * in the tab queue for the action, under the action's own deadline.
 */
const DIALOG_ACTION_WAIT_MS = 10_000;
/** How long `open` waits for the load of a redirect before its second read. */
const OPEN_REDIRECT_WAIT_MS = 5_000;
/** A site can redirect more than one time before its page stays. */
const OPEN_REDIRECT_READS = 2;
/**
 * How long an agent tool waits for the earlier operations of its tab. One operation takes at most about
 * a minute: a 30 s action, its read, and the bot check waits. A longer wait means that an operation
 * cannot finish, such as a command that a page dialog holds.
 */
const TOOL_QUEUE_WAIT_MS = 120_000;
/** The `keyCode` of `sendInputEvent` for a key whose `Input.key` name is different. */
const FORWARDED_KEY_CODES: Partial<Record<string, string>> = { ArrowLeft: "Left", ArrowRight: "Right" };
/**
 * The download limits of one browser session, so that a page cannot fill the disk. A session
 * starts no new download while `MAX_ACTIVE_DOWNLOADS` are in progress, and a download larger
 * than `MAX_DOWNLOAD_BYTES` stops.
 */
const MAX_ACTIVE_DOWNLOADS = 4;
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;

export interface BrowserViewOptions {
  /** Hears the page's mouse cursor when it changes. Not called while a secret is on the page. */
  onCursor?: (cursor: BrowserViewCursor) => void;
  /** The page size, in CSS pixels, that the page keeps while the view is open. */
  viewport?: BrowserViewViewport;
}

/** A web address a member may copy from a menu. Other schemes and long addresses are left out. */
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
/**
 * An agent's tab that nobody used for this long unloads its page, and loads it again on its next use,
 * so a long run does not keep in memory the page of each tab an agent left open. The tab keeps a
 * blank page, as a restored tab does. When memory is low, the tab unloads after
 * `LOW_MEMORY_TAB_SLEEP_MS`.
 */
const IDLE_TAB_SLEEP_MS = 15 * 60_000;
const LOW_MEMORY_TAB_SLEEP_MS = 5 * 60_000;
const IDLE_TAB_SWEEP_MS = 60_000;
/**
 * Each loaded tab is its own renderer process, about 300 MB on a typical page. Of the tabs that can
 * sleep and are not in use, only this many most recently used stay loaded; an older one sleeps after
 * `AWAKE_TAB_GRACE_MS`, so an agent that moves between a few tabs in one task does not reload them.
 */
const MAX_IDLE_AWAKE_TABS = 3;
const AWAKE_TAB_GRACE_MS = 2 * 60_000;
/**
 * The page load errors that say the proxy of the tab did not answer or refused it, and why, with
 * their Chromium codes. A failed load can give only the code, with no name.
 */
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

/** The Chromium error code in the text of a failed page load, written as `(<code>)`. */
function chromiumErrorCode(text: string): number | undefined {
  const code = /\((-\d+)\)/u.exec(text)?.[1];
  return code === undefined ? undefined : Number(code);
}

/** The proxy failure in the text of a failed page load: a Chromium error name, or `(<code>)`. */
function proxyErrorInText(text: string): BrowserProxyFailure | undefined {
  const name = /\bERR_[A-Z_]+/u.exec(text)?.[0];
  if (name !== undefined) return PROXY_ERRORS.get(`net::${name}`);
  const code = chromiumErrorCode(text);
  return code === undefined ? undefined : PROXY_ERROR_CODES.get(code);
}

/**
 * A page load that Chromium stopped for the certificate of the site gets a message in plain words.
 * Chromium gives certificate errors the codes -200 to -299. Other failures stay as they are.
 */
function certificateLoadFailure(failure: BrowserOperationError): BrowserOperationError {
  const code = chromiumErrorCode(String(failure.cause));
  return code !== undefined && code <= -200 && code > -300
    ? browserFailure(new Error(sourceText("error.backend.browserCertificateUntrusted")))
    : failure;
}

/** How many times one document answers the sign-in of its proxy. More means the sign-in is wrong. */
const PROXY_SIGN_IN_ANSWERS = 8;

/** The Chromium proxy rule of a saved proxy. The host has no characters that the rule format splits on. */
function proxyRules(proxy: Extract<BrowserProxyConnection, { kind: "address" }>): string {
  return `${proxy.scheme}://${proxy.host}:${proxy.port}`;
}

/** The proxy that Chromium connects to, and the sign-in that it gives when that proxy asks. */
interface AppliedProxy {
  key: string;
  proxy: BrowserProxyConnection | null;
  signIn: { host: string; port: number; username: string; password: string } | null;
  /**
   * A local relay. Chromium cannot sign in to SOCKS5, so a SOCKS5 proxy with a sign-in goes through
   * it; the computer of a member is not a proxy server, so its traffic goes through it too.
   */
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
  // An agent works in tabs that the panel does not show. A throttled tab waits up to a few seconds
  // for each pointer move, because Chromium sends the move with the next frame, and it tells the
  // page that it is hidden. The cost is that a hidden page keeps its full timer and frame rate
  // until the idle sweep puts the tab to sleep (`IDLE_TAB_SLEEP_MS`, sooner past `MAX_IDLE_AWAKE_TABS`
  // idle tabs or when memory is low).
  backgroundThrottling: false,
};

/**
 * macOS, Windows and Linux draw no page of a minimized or hidden window, so they use `#backgroundWindow`.
 * On Linux this includes the main window of a local server, which is never shown (#6524).
 */
const USES_BACKGROUND_WINDOW =
  process.platform === "darwin" || process.platform === "win32" || process.platform === "linux";

/**
 * Linux also draws no page of a hidden view, also in a shown window, and it does not apply `setOpacity`.
 * There the background window is one pixel, and its views stay shown: the window clips them, and they still draw.
 */
const SHOWS_VIEWS_IN_BACKGROUND = process.platform === "linux";

/** The window of `BrowserHost.#backgroundWindow`. It has no page of its own. */
function createBackgroundWindow(): BaseWindow {
  const window = new BaseWindow({
    show: false,
    // A Windows tool window is not in Alt+Tab or the taskbar.
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

/** A smaller panel size is not used for a hidden tab: a page lays out for a phone below it. */
const MIN_HIDDEN_VIEWPORT = { width: 800, height: 600 };
/** The height of the tab strip and toolbar of a Chrome window with no bookmarks bar. */
const CHROME_TOOLBAR_HEIGHT = 85;

/**
 * The tab preload also runs in frames, because a bot check reads `window.chrome` in a new frame.
 * The sandbox keeps Node out of each frame; the preload has no IPC.
 */
function browserWebPreferences(preload: string | undefined) {
  return preload === undefined
    ? BROWSER_WEB_PREFERENCES
    : { ...BROWSER_WEB_PREFERENCES, preload, nodeIntegrationInSubFrames: true };
}

export interface PreparedBrowserSecret {
  request: BrowserSecretRequest;
  /**
   * True when agent code from `evaluate` can still run in the page or in a page of its origin in
   * the same session, or a service worker served the page after such a script. That code can
   * listen to the fields, so only the user may decide to fill them.
   */
  agentScriptedOrigin: boolean;
  /**
   * True when the target fields are built for this secret: password fields for a password, one-time
   * code fields for an authenticator code. A field that the agent chose for something else, such as a
   * search box, could put the value in a URL the agent reads.
   */
  vaultFillable: boolean;
  /**
   * `vault` is true for a value that no user typed. A navigation that would carry it in its URL, such as
   * a GET form submission, is then blocked, and the user finishes in the tab.
   */
  submit(secret: string, vault: boolean): Effect.Effect<"submitted" | "takeover", BrowserOperationError>;
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

const AGENT_CODE_CARD_FILL =
  "Card fill is unavailable while a script from evaluate can still run in this page or in another open page of this site. Reload this page, close or navigate each other tab where you ran evaluate on this site, take a fresh snapshot, and call fill_card again, or use request_takeover.";

/**
 * The origins of the documents in the page. A frame whose renderer is gone, for example after a crash,
 * has no document. `isDestroyed()` of its `WebContents` stays false, but Electron throws when code
 * reads the frame, and in an Electron event listener that throw stops the main process.
 */
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

/** Whether `url` carries `secret` as typed, percent-encoded, or form-encoded. */
function urlCarriesSecret(url: string, secret: string): boolean {
  if (url.includes(secret)) return true;
  try {
    if (decodeURIComponent(url.replaceAll("+", " ")).includes(secret)) return true;
  } catch {
    // A malformed escape elsewhere in the URL; the query values below still decode.
  }
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

/** Where the browser records what a person does in an agent tab that they hold. */
export interface BrowserUserBrowsing {
  /** The setting, read at each step. */
  enabled(): boolean;
  record(agentId: string, step: Omit<UserBrowsingStep, "at">): void;
}

/** Who controls a tab: the person at this computer, or one session of a team member. */
export type BrowserUserControlHolder = { kind: "local" } | { kind: "member"; memberId: string; sessionId: string };
/** One step of a task that a person shows: a page that loaded or a click on a control. No typed text. */
export type { BrowserTeachStep };

/** The most steps of one teach recording, as `browser-teach-v1` says. */
const TEACH_MAX_STEPS = 200;
/** A teach recording takes no step after this time. */
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
/** The holds to release when a window, a session or a member ends. */
export type BrowserUserControlOwner =
  | { kind: "local" }
  | { kind: "session"; sessionId: string }
  | { kind: "member"; memberId: string };

/** The page that the main window shows, in window pixels, and the zoom of the window. */
export interface BrowserMainPage {
  tabId: string;
  bounds: Rectangle;
  zoomFactor: number;
}

export class BrowserHost {
  static readonly CONTROL_IDLE_GRACE_MS = BrowserControlSessions.IDLE_GRACE_MS;
  readonly #window: BrowserWindow;
  readonly #session: Session;
  /** The persistent sessions other than the shared one, by partition directory name. */
  readonly #tabSessions = new Map<string, Session>();
  readonly #browserProfile: (agentId: string) => AgentBrowserProfile;
  readonly #profileExists: (profileId: string) => boolean;
  readonly #profileProxy: (profileId: string) => BrowserProxyConnection | null;
  readonly #onProxyStatusChanged: () => void;
  readonly #computerExit: (memberId: string) => RelayExit;
  /**
   * The proxy that each named profile session uses now, by partition. The key holds the whole
   * connection, so a change of the password also applies again. Never logged.
   */
  readonly #appliedProxies = new Map<string, AppliedProxy>();
  /**
   * One proxy change at a time. Two tabs that open together in one profile must not both open a
   * relay: the second would replace the first in `#appliedProxies`, and the first would stay open.
   */
  readonly #proxyLock = Semaphore.makeUnsafe(1);
  /** The proxies whose last page load could not connect to them. */
  readonly #proxyFailures = new Map<string, BrowserProxyFailure>();
  /**
   * The tabs whose proxy asked for a sign-in that the tab did not give again, until a page loads.
   * Chromium then reports a failed tunnel, which alone means that the proxy did not answer.
   */
  readonly #proxySignInRefused = new WeakSet<BrowserHostTab>();
  readonly #quitShortcut: (input: Input) => boolean;
  readonly #siteMemories: (agentId: string, hostname: string) => BrowserSiteMemory[];
  readonly #userBrowsing: BrowserUserBrowsing | null;
  readonly #downloadsRoot: string;
  readonly #statePath: string;
  readonly #tabs = new Map<string, BrowserHostTab>();
  readonly #closingTabDrains = new Map<string, Fiber.Fiber<void, BrowserOperationError>>();
  readonly #listeners = new Set<(...args: BrowserHostEvents["changed"]) => void>();
  readonly #documentListeners = new Set<(...args: BrowserHostEvents["documentChanged"]) => void>();
  readonly #siteVisitListeners = new Set<(...args: BrowserHostEvents["siteVisited"]) => void>();
  readonly #controls = new BrowserControlSessions();
  readonly #reservedDownloadPaths = new Set<string>();
  /** Downloads in progress in all sessions, so an agent's own session does not add to the limit. */
  #activeDownloads = 0;
  readonly #recorder: BrowserRecorder;
  #activeTabId: string | null = null;
  #visible = false;
  #bounds: BrowserBounds | null = null;
  #attachedView: WebContentsView | null = null;
  #pictureInPictureWindow: BrowserWindow | null = null;
  #pictureInPictureOverlayView: WebContentsView | null = null;
  #mainPageListener: ((page: BrowserMainPage | null) => void) | null = null;
  #target: BrowserViewTarget = "main";
  readonly #mountedViews = new Map<WebContentsView, BrowserWindow>();
  /**
   * macOS, Windows and Linux draw no page of a hidden or minimized window. A page that loads there
   * gives no image, so a snapshot or screenshot waits until its deadline or is empty (#5580, #5991),
   * and a live view gets no frame (#6524). While the main window is hidden or minimized, the views of
   * its tabs are in this window: shown, but transparent (one pixel on Linux), click-through and never
   * focused. `#mountedViews` still names the main window for them.
   */
  #backgroundWindow: BaseWindow | null = null;
  #mainViewsInBackground = false;
  /** True while `#syncAttachedView` shows `#attachedView`. On Linux the views in the background window are all shown. */
  #attachedViewShown = false;
  readonly #takeoverTabIds = new Set<string>();
  /** The tabs that a person controls, with who took each one, so a closed session releases its own. */
  readonly #userControlTabIds = new Map<string, BrowserUserControlHolder>();
  /**
   * The tasks that people show now (`browser-teach-v1`), by tab. A recording lives in memory only and
   * ends with the person's control of the tab.
   */
  readonly #teachRecordings = new Map<string, BrowserTeachRecording>();
  /** The agent tool calls that wait for the release of a tab. */
  readonly #userControlWaiters = new Map<string, Set<Deferred.Deferred<void>>>();
  /**
   * The origins, per session, whose Cache Storage an agent script could write since the last purge.
   * A service worker can serve those entries to a later document as page code. Each tab's
   * `scriptedOrigins` follows the agent code that runs in its document.
   */
  readonly #cacheTaintedOrigins = new WeakMap<Session, Set<string>>();
  /** The last purge of each tainted origin, per session. False when it failed. A fill waits for it. */
  readonly #originPurges = new WeakMap<Session, Map<string, Promise<boolean>>>();
  #persistLock = Semaphore.makeUnsafe(1);
  readonly #scope = Scope.makeUnsafe();
  #destroying: Deferred.Deferred<void, BrowserOperationError> | null = null;
  /** Whether the machine is too low on memory for one more tab. Only a server has a reading. */
  readonly #memoryLow: () => boolean;
  readonly #idleTabSweep: NodeJS.Timeout;
  readonly #awakeTabGraceMs: number;
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
      /** The session that the new tabs of this agent open in. */
      browserProfile?: (agentId: string) => AgentBrowserProfile;
      /** Whether a named profile still exists. A tab never opens in a deleted profile. */
      profileExists?: (profileId: string) => boolean;
      /**
       * The proxy of a named profile, with its password, or null for the proxy settings of the
       * computer. It throws when the password cannot be read: the tab then does not open.
       */
      profileProxy?: (profileId: string) => BrowserProxyConnection | null;
      /** Runs when a proxy starts or stops failing. */
      onProxyStatusChanged?: () => void;
      /**
       * Opens connections through the computer of a member. Without it, each connection of a profile
       * with a computer proxy fails: there is no direct fallback.
       */
      computerExit?: (memberId: string) => RelayExit;
      /** True when the key is part of the Mac quit shortcut, which a focused tab must not give to the menu. */
      quitShortcut?: (input: Input) => boolean;
      /** The tab preload, which makes the page values that bot checks read agree with Chrome. */
      pagePreload?: string;
      /** Shorter sleep timing for `scripts/browser-steps-e2e.ts`. */
      tabSleep?: { sweepMs: number; awakeGraceMs: number };
      /** The memories of an agent about the site of a page host, which its snapshots show. */
      siteMemories?: (agentId: string, hostname: string) => BrowserSiteMemory[];
      /**
       * Records what a person does in an agent tab that they hold, while "Learn from my browsing" is
       * on. Omitted, nothing is recorded.
       */
      userBrowsing?: BrowserUserBrowsing;
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
    this.#awakeTabGraceMs = options.tabSleep?.awakeGraceMs ?? AWAKE_TAB_GRACE_MS;
    this.#browserProfile = options.browserProfile ?? (() => ({ kind: "shared" }));
    this.#profileExists = options.profileExists ?? (() => false);
    this.#profileProxy = options.profileProxy ?? (() => null);
    this.#onProxyStatusChanged = options.onProxyStatusChanged ?? (() => {});
    this.#computerExit = options.computerExit ?? (() => () => Promise.reject(new Error("No computer exit")));
    this.#quitShortcut = options.quitShortcut ?? (() => false);
    this.#siteMemories = options.siteMemories ?? (() => []);
    this.#userBrowsing = options.userBrowsing ?? null;
    this.#webPreferences = browserWebPreferences(options.pagePreload);
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
        ...(options.recordingDurationMs === undefined ? {} : { maxRecordingMs: options.recordingDurationMs }),
        ...(options.recordingMaxConcurrent === undefined
          ? {}
          : { maxConcurrentRecordings: options.recordingMaxConcurrent }),
        ...(options.recordingMaxAggregateBytes === undefined
          ? {}
          : { maxAggregateBytes: options.recordingMaxAggregateBytes }),
      },
    );
    // Service workers read the process fallback instead of the session, so it changes too.
    app.userAgentFallback = sessionBrowserUserAgent(app.userAgentFallback);
    this.#configureSession(this.#session);
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
    const state = yield* readBrowserState(this.#statePath);
    if (state.tabs.length === 0) return;

    const tabs: BrowserHostTab[] = [];
    for (const saved of state.tabs) {
      // Each saved tab passed the tab limit when it opened, so a restart does not drop one. The reown can
      // put the tabs of several chats in the agent's main chat, which then lists and closes all of them.
      const stored = reownStoredBrowserTab(saved, agents);
      // A tab comes back in the session it opened in, whatever the agent's setting is now. A tab of
      // a deleted profile does not come back: no other session may load its page.
      const tabSession = storedTabSession(stored);
      if (tabSession?.kind === "profile" && !this.#profileExists(tabSession.profileId)) continue;
      // A tab whose proxy cannot apply does not come back: it would load its page without the proxy.
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
    if (activeTab) yield* this.#wake(activeTab);
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
    // An agent tool can wake a tab that a person holds. The restore is the host's work, so the hold does
    // not stop it, and it waits for its turn with no tool limit.
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
      tab.filledCard === true ||
      this.#takeoverTabIds.has(tab.id) ||
      this.#userControlTabIds.has(tab.id) ||
      tab.contents.isCurrentlyAudible()
    );
  }

  /**
   * Unloads the page and ends its renderer process, and keeps the tab: its id, owner, URL and settings
   * stay, and the next use loads the page again through `#wake`. The page's own state, such as its
   * history and unsent form input, is lost, as when a browser discards a background tab.
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
          Effect.gen({ self: this }, function* () {
            sleeping.preview =
              saved ??
              (capture ? yield* Deferred.await(capture.frame).pipe(Effect.catch(() => Effect.succeed(null))) : null);
            if (tab.sleeping !== sleeping || tab.closing || tab.contents.isDestroyed()) return;
            unloaded = true;
            yield* this.#closeRenderer(tab);
          }),
        true,
      ).pipe(Effect.ignore, Effect.provideService(BrowserToolQueueWait, undefined)),
      tab.scope,
      { startImmediately: true },
    );
    this.#emitChanged();
  });

  /**
   * Gives the tab a new view that has loaded no page, and closes the old one. A blank page keeps its
   * renderer process and that memory; a view with no page has no process until `#wake` loads one.
   */
  readonly #closeRenderer = Effect.fn("BrowserHost.closeRenderer")(function* (this: BrowserHost, tab: BrowserHostTab) {
    const { view, contents, engine } = tab;
    engine.releaseDialogs();
    yield* engine.destroy();
    yield* browserSync(() => {
      // The tab can close, or the host stop, while the engine stops. Their own cleanup closes the old view.
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
      // A person can open the tab while the engine stops, which shows the old view.
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
    // A dialog that the turn did not answer stays open in Electron's box for a person.
    for (const tab of this.#tabs.values()) tab.engine.handOffDialogs(threadId, turnId);
  }

  clearControls(): void {
    this.#controls.clear();
    for (const tab of this.#tabs.values()) tab.engine.handOffDialogs();
  }

  /** Whether `openPrivate` opened this tab, or a popup of one: it holds a sign-in that is not for every member. */
  isPrivate(tabId: string): boolean {
    return Boolean(this.#tabs.get(tabId)?.privateSession);
  }

  /** The newest open tab of the private session that `openPrivate` opened as `tabId`: a sign-in popup while it is open. */
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

  /** The renderer process of each open tab, so the resource monitor can count tabs apart from windows. */
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

  setPictureInPictureWindow(window: BrowserWindow | null): void {
    this.#pictureInPictureWindow = window;
    if (!window && this.#target === "picture-in-picture") {
      this.#visible = false;
      this.#target = "main";
      if (this.#attachedView) this.#mountView(this.#attachedView, this.#window);
    }
    this.#syncAttachedView();
  }

  /**
   * Calls `listener` each time the page of the main window moves, and with null when the main window
   * shows no page. It runs after the page view is raised, so the listener can raise its own views above it.
   */
  setMainPageListener(listener: ((page: BrowserMainPage | null) => void) | null): void {
    this.#mainPageListener = listener;
    this.#syncAttachedView();
  }

  /**
   * The keys of the window that work while the dock over the page has the focus: DevTools, search, and
   * the keys of the full view. True when the window takes the key.
   */
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

  /**
   * Opens a sign-in page that a member watches in a live view, in a session of its own. The page
   * gets no cookie of the shared browser and leaves none there, the tab is not saved, and no agent
   * owns it, so no agent tool can reach it.
   */
  readonly openPrivate = Effect.fn("BrowserHost.openPrivate")(function* (
    this: BrowserHost,
    url: string,
  ): Effect.fn.Return<BrowserTab, BrowserOperationError> {
    const privateSession = session.fromPartition(`openbot-private-${randomUUID()}`, { cache: false });
    this.#configureSession(privateSession);
    return yield* this.#open(url, null, null, false, true, privateSession);
  }).bind(this);

  /**
   * With `closeOnFailure` false, a tab whose first page does not load stays open on that address, as
   * a tab does when a later page does not load, so the person sees where it failed and can try again.
   * The open tool of an agent closes its tab, so that failed attempts do not fill the tab limit, and
   * a private sign-in page closes its tab, as its callers expect.
   */
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
      return yield* browserFailure(
        new Error(sourceText("error.backend.browserTabLimit", { limit: INPUT_LIMITS.browserTabs })),
      );
    }
    // Each tab is its own renderer process.
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
    // A view without a document cannot hold focus, so the first commit gives it.
    tab.focusOnCommit = focus;
    this.#syncAttachedView();
    if (!focus) restoreWebContentsFocus(previouslyFocused, tab.contents);
    this.#emitChanged();
    return yield* Effect.gen({ self: this }, function* () {
      yield* this.#persistState();

      const loadGeneration = tab.loadGeneration;
      yield* Effect.gen({ self: this }, function* () {
        // The first load of a new tab has no deadline, as with `loadURL` alone.
        yield* navigateAndWait(tab.contents, () => tab.contents.loadURL(normalizedUrl, browserLoadOptions()), null);
        if (focus) {
          this.#focusTab(tab);
          setImmediate(() => this.#focusTab(tab));
        } else restoreWebContentsFocus(previouslyFocused, tab.contents);
      }).pipe(
        Effect.catch((operationFailure) =>
          Effect.gen({ self: this }, function* () {
            const error = operationFailure.cause;
            // The user entered an address before the first page loaded: that load is the tab's page now.
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
            // An agent keeps the Chromium reason, which tells it which certificate check failed.
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

  /**
   * The limit counts the open tabs of the owner thread: the tabs that `list_tabs` of that thread shows
   * and that it can close. Tabs of the agent's other threads do not count, as the thread cannot see them.
   */
  #hasTabCapacity(ownerThreadId: string | null, ownerAgentId: string | null): boolean {
    const tabs = [...this.#tabs.values()].filter(
      (tab) =>
        !tab.closing &&
        !tab.contents.isDestroyed() &&
        tab.ownerThreadId === ownerThreadId &&
        (tab.ownerAgentId === null || tab.ownerAgentId === ownerAgentId),
    );
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
    yield* this.#enqueue(
      tabId,
      (tab) =>
        Effect.gen({ self: this }, function* () {
          tab.loadGeneration += 1;
          // The person entered this address, so the page keeps the focus that its document takes when it
          // commits. The view can be hidden under the address suggestions, and then `#focusTab` does nothing.
          tab.focusOnCommit = true;
          yield* untilStopped(
            tab,
            navigateAndWait(tab.contents, () => tab.contents.loadURL(normalizedUrl, browserLoadOptions())),
          ).pipe(
            Effect.mapError((failure) => certificateLoadFailure(this.#proxyLoadFailure(tab, failure))),
            // A same-document load or a load that does not start leaves the flag for the next navigation.
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
    yield* this.#enqueue(
      tabId,
      (tab) =>
        Effect.gen({ self: this }, function* () {
          return yield* untilStopped(
            tab,
            navigateAndWait(tab.contents, () => {
              tab.contents.reload();
              return true;
            }),
          );
        }),
      true,
    );
  }).bind(this);

  /**
   * Sets the cookies of a sign-in that a member made on their own device, then loads the page again.
   * Only the cookies of the site that the tab shows go in: its host, its parent domains, and its
   * subdomains. Chromium refuses a public suffix domain. The answer is the count that Chromium set.
   */
  readonly importSignIn = Effect.fn("BrowserHost.importSignIn")(function* (
    this: BrowserHost,
    tabId: string,
    cookies: readonly BrowserSignInCookie[],
  ): Effect.fn.Return<number, BrowserOperationError> {
    const tab = yield* this.#requireTab(tabId);
    const page = URL.canParse(tab.contents.getURL()) ? new URL(tab.contents.getURL()) : null;
    if (!page || (page.protocol !== "https:" && page.protocol !== "http:")) return 0;
    const target = this.#tabSession(tab);
    const results = yield* Effect.forEach(
      cookies.filter((cookie) => browserSignInCookieFitsHost(cookie.domain, page.hostname)),
      (cookie) =>
        browserCall(() =>
          target.cookies.set({
            url: `${cookie.secure ? "https" : "http"}://${cookie.domain.replace(/^\./u, "")}${cookie.path}`,
            name: cookie.name,
            value: cookie.value,
            // A cookie with no leading dot is for one host only, so it has no domain attribute.
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
    if (count === 0) return 0;
    yield* browserCall(() => target.cookies.flushStore());
    // The cookies are set. A page that does not load again shows its own error in the tab.
    yield* this.reload(tabId).pipe(Effect.ignore);
    return count;
  }).bind(this);

  /**
   * Stops the load of the tab now, not after the queued tab operations: a person stops a page that
   * does not finish. The load that it ends counts as done, not as failed.
   */
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
    // A popup that a private page opened without an opener is not its child, but it holds the same sign-in.
    const signInSession = tab.popup ? undefined : tab.privateSession;
    const childDrains = [...this.#tabs.values()]
      .filter((child) => child.openerTabId === tabId || (signInSession && child.privateSession === signInSession))
      .map((child) => this.close(child.id));
    this.#takeoverTabIds.delete(tabId);
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
        // An agent or a page can close the tab while the person types in the app.
        active.focusOnVisible = browserHadFocus;
        yield* this.#wake(active);
      }
    }
    this.#syncAttachedView();
    this.#emitChanged();
    tab.closing = true;
    // An open dialog holds the tab queue until it closes.
    tab.engine.releaseDialogs();
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

  /**
   * A person takes the tab. The agent tool calls on it wait for the release. An operation that already
   * runs ends first, because the take waits for its place in the tab queue.
   */
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

  /** Any caller that can see the tab gives it back. A tab that nobody holds stays as it is. */
  releaseUserControl(tabId: string): void {
    if (!this.#userControlTabIds.has(tabId)) return;
    const tab = this.#tabs.get(tabId);
    if (tab) {
      tab.engine.invalidateReferences();
      tab.diagnostics.clearDiagnostics();
    }
    this.#endUserControl(tabId);
  }

  /**
   * A person starts to show a task in an agent's tab (`browser-teach-v1`). The person takes the tab,
   * and each page that loads and each control that they click becomes a step until `stopTeach` or the
   * end of their control. A tab that another person holds is refused.
   */
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
    // The tab can close or change hands while the take waits for its place in the tab queue.
    const current = this.#userControlTabIds.get(tabId);
    if (this.#tabs.get(tabId) !== tab || !current || !sameUserControlHolder(current, holder))
      return yield* browserFailure(new Error(sourceText("error.backend.browserTabNotFound")));
    this.#teachRecordings.set(tabId, { holder: current, startedAt: Date.now(), steps: [] });
    const place = stepPlace(tab.contents.getURL());
    const title = stepText(tab.contents.getTitle());
    if (place) this.#recordTeachStep(tab, { kind: "page", ...place, ...(title ? { title } : {}) });
  }).bind(this);

  /**
   * Ends the recording of a tab and gives the tab back. Only the holder that started the recording
   * can end it, and gets its steps only with `save`. A call from another holder changes nothing.
   */
  stopTeach(tabId: string, holder: BrowserUserControlHolder, save: boolean): BrowserTeachStep[] {
    const recording = this.#teachRecordings.get(tabId);
    if (!recording || !sameUserControlHolder(recording.holder, holder)) return [];
    this.#teachRecordings.delete(tabId);
    this.releaseUserControl(tabId);
    return save ? recording.steps : [];
  }

  /** Adds a step to the recording of the tab. False when the tab has no recording. */
  #recordTeachStep(tab: BrowserHostTab, step: BrowserTeachStep): boolean {
    const recording = this.#teachRecordings.get(tab.id);
    if (!recording) return false;
    if (tab.secret || tab.privateSession || tab.contents.isDestroyed()) return true;
    if (recording.steps.length >= TEACH_MAX_STEPS || Date.now() - recording.startedAt > TEACH_MAX_DURATION_MS)
      return true;
    const last = recording.steps.at(-1);
    // A page that is the same as the step before it is not added again; a later title replaces the first.
    if (step.kind === "page" && last?.kind === "page" && last.host === step.host && last.path === step.path) {
      if (step.title !== undefined) recording.steps[recording.steps.length - 1] = step;
    } else recording.steps.push(step);
    return true;
  }

  /** Releases the tabs of a closed window, session or member. */
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

  /**
   * The tab of this agent tool call while a person controls it, or null. A call for the agent's tab
   * set, such as `list_tabs`, waits while the person controls any tab that the agent can use.
   */
  userControlTabFor(params: DynamicToolCallParams): string | null {
    if (TAB_SET_TOOLS.has(params.tool))
      return (
        this.listTabs().find((tab) => this.#userControlTabIds.has(tab.id) && this.#canUseToolTab(params, tab))?.id ??
        null
      );
    // The tool reads the repaired arguments, so this check does too: a call with tab_id names the tab.
    const args = repairBrowserToolInput(params.tool, params.arguments).value;
    const tabId = isRecord(args) ? args.tabId : undefined;
    if (!isString(tabId) || !this.#userControlTabIds.has(tabId)) return null;
    const tab = this.listTabs().find((candidate) => candidate.id === tabId);
    return tab && this.#canUseToolTab(params, tab) ? tabId : null;
  }

  /** Waits until nobody controls the tab: a release, a tab close or the host shutdown. */
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
    if (url.protocol !== "https:")
      return yield* browserFailure(new Error(sourceText("error.backend.authHttpsRequired")));
    yield* browserSync(() => this.#requireIsolatedFromConnectedTabs(tab, url.origin));
    if (args.method !== "password" && args.digits < 4)
      return yield* browserFailure(new Error(sourceText("error.backend.authDigitsRange")));
    if (
      (args.method === "password"
        ? args.targets.length > 2
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
                ? "Invalid authentication targets: method=password needs one field target, or a password and its confirmation field."
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
                url.origin,
                args.method === "password",
                args.submission,
                args.submitTarget,
              ),
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
        agentScriptedOrigin: yield* this.#agentCodeCanRead(tab, [url.origin], entry.servedByWorker),
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
        submit: (secret: string, vault: boolean) =>
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
            let leaked = false;
            // A blocked navigation ends the wait for one, so the user gets the tab at once.
            let stopWaiting = () => {};
            const contents = tab.contents;
            const blockLeak = (event: ElectronEvent<WebContentsWillFrameNavigateEventParams>) => {
              if (!urlCarriesSecret(event.url, secret)) return;
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
                      entry.enter(secret),
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
      // Keep the reason, such as which target is wrong, so the agent can correct the request.
      Effect.catch((error) =>
        Effect.gen({ self: this }, function* () {
          tab.secret = undefined;
          this.#syncAttachedView();
          // A reason can end in a selector, so end it with a period before the next sentence.
          const reason = error.cause instanceof Error ? ` ${error.cause.message.replace(/\.?\s*$/u, ".")}` : "";
          return yield* browserFailure(
            new Error(`Secure authentication is unavailable.${reason} Correct the request, or use browser takeover.`),
          );
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

  /** A filled card shows on the page, so no image of the tab leaves the host until it navigates. */
  #requireNoFilledCard(tab: BrowserHostTab, action: string): void {
    if (tab.filledCard)
      throw new Error(`${action} is unavailable while the page shows a filled card. Use snapshots until it navigates.`);
  }

  #cacheTainted(target: Session): Set<string> {
    const origins = this.#cacheTaintedOrigins.get(target) ?? new Set<string>();
    this.#cacheTaintedOrigins.set(target, origins);
    return origins;
  }

  /**
   * The tab's document is going away, and agent code in it stops. Until now, that code could put code
   * in a same-origin page of a connected tab, so such a page keeps the mark until it navigates. It
   * could also write Cache Storage that a service worker serves to any page of the origin in the
   * session, also after the page loaded. So each other open page of the origin must navigate before
   * a fill, and a tainted origin is cleared again.
   */
  #releaseScriptedDocument(tab: BrowserHostTab): void {
    const scripted = tab.scriptedOrigins;
    const exposed = tab.workerExposedOrigins;
    if (!scripted && !exposed) return;
    delete tab.scriptedOrigins;
    delete tab.workerExposedOrigins;
    // A tab that closed itself has no `contents.session`.
    const target = this.#tabSession(tab);
    // The next fill on the origin reads the result from `#originPurges`.
    for (const origin of new Set([...(scripted ?? []), ...(exposed ?? [])]))
      if (this.#cacheTaintedOrigins.get(target)?.has(origin)) void this.#purgeOrigin(target, origin);
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

  /** The tabs of one browser session. Popups use the session of their opener. */
  #sessionTabs(target: Session): BrowserHostTab[] {
    return [...this.#tabs.values()].filter((other) => this.#tabSession(other) === target);
  }

  /**
   * Whether agent code can run in the tab's page of one of these origins: a script runs in a page of
   * the origin in the tab's session, or the tab's page was open while one ran. A connected page can
   * reach the tab, and any page can write the Cache Storage that a service worker serves to the tab.
   */
  #agentCodeReaches(tab: BrowserHostTab, origins: string[]): boolean {
    const others = this.#sessionTabs(this.#tabSession(tab));
    return origins.some(
      (origin) =>
        tab.workerExposedOrigins?.has(origin) || others.some((candidate) => candidate.scriptedOrigins?.has(origin)),
    );
  }

  /**
   * Whether agent code can read what OpenBot fills into the tab's fields of these origins. A page that
   * a service worker served could run code that a script put in Cache Storage, so that page must
   * reload after OpenBot clears the origin's Cache Storage and service workers. When no other page of
   * the origin is open in the session, nothing can write that cache again and the origin is clean.
   */
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
    // A purge that fails leaves the cache as it was, so the user decides.
    if (!(yield* Effect.promise(() => Promise.all(purges))).every(Boolean)) return true;
    // A page of the origin can open, and run a script, while the purge runs.
    if (this.#agentCodeReaches(tab, origins)) return true;
    if (!servedByWorker) {
      for (const origin of clean) if (!this.#originOpenElsewhere(target, origin, tab)) tainted.delete(origin);
      return false;
    }
    for (const origin of dirty) markWorkerExposedOrigin(tab, origin);
    return true;
  });

  /**
   * Clears the origin's Cache Storage and service workers after the purge that already runs for it.
   * A later purge that succeeds clears what an earlier one that failed left.
   */
  #purgeOrigin(target: Session, origin: string): Promise<boolean> {
    const purges = this.#originPurges.get(target) ?? new Map<string, Promise<boolean>>();
    this.#originPurges.set(target, purges);
    const purge = (purges.get(origin) ?? Promise.resolve(true)).then(() =>
      target.clearStorageData({ origin, storages: ["cachestorage", "serviceworkers"] }).then(
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

  /** Whether a page of the origin other than the tab's own is open in the session. */
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

  /** `completed`: the person selected Done, so a bot check that was on the page is one they could not pass. */
  endTakeover(tabId: string, completed = false): void {
    const tab = this.#tabs.get(tabId);
    if (tab) {
      tab.engine.invalidateReferences();
      tab.diagnostics.clearDiagnostics();
      if (completed && tab.checkOrigin) tab.checkAfterTakeover = tab.checkOrigin;
    }
    this.#takeoverTabIds.delete(tabId);
    this.#syncAttachedView();
    this.#emitChanged();
    // A failed submission can leave the secret in a page that never loads a new document, such as a
    // single-page sign-in. Load the page again with GET, as `submit` does, so that the commit ends
    // the protection. Without it the tab stays hidden and every tool, close included, is refused.
    const protection = tab?.secret;
    if (tab && protection?.submitted && !protection.running)
      Effect.runFork(
        this.#reloadProtected(tab, protection).pipe(
          Effect.tapError((error) =>
            Effect.sync(() =>
              logger.warn("Unable to reload a protected browser tab after a takeover", { error: toLogValue(error) }),
            ),
          ),
          Effect.ignore,
          Effect.forkIn(tab.scope, { startImmediately: true }),
        ),
      );
  }

  /** Loads a tab that still holds a submitted secret again with GET. The commit ends the protection. */
  #reloadProtected(tab: BrowserHostTab, protection: NonNullable<BrowserHostTab["secret"]>) {
    return this.#enqueue(
      tab.id,
      (current) =>
        Effect.gen(function* () {
          // A sign-in that the person started in the takeover can still commit a new document,
          // which ends the protection. Do not cancel that load with the reload.
          if (current.contents.isLoadingMainFrame())
            yield* waitForLoading(current.contents, 10_000).pipe(Effect.ignore);
          if (current.secret !== protection) return;
          yield* untilStopped(current, reloadWithGet(current));
        }),
      true,
    );
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
        // An element image can scroll the page to the element, so it does not pass an earlier one on.
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
    // A preview card on screen does not keep a sleeping tab loaded, also when the tab has no saved
    // frame: the card asks again every few seconds, and each wake would load the page again.
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
    options: BrowserViewOptions = {},
  ): Effect.fn.Return<() => Effect.Effect<void>, BrowserOperationError> {
    const { onCursor, viewport } = options;
    const tab = yield* this.#requireTab(tabId);
    // The local window shows a protected tab during a takeover. A live view goes to another computer,
    // so the page loads again first: the secret leaves it, and the person signs in by hand. Without
    // this the person that the agent waits for cannot see the tab.
    const protection = tab.secret;
    if (protection?.submitted && !protection.running && this.#takeoverTabIds.has(tabId))
      yield* this.#reloadProtected(tab, protection).pipe(Effect.ignore);
    if (tab.secret?.submitted)
      return yield* browserFailure(new Error(sourceText("error.backend.browserViewProtected")));
    yield* browserSync(() => this.#requireNoFilledCard(tab, "Browser view"));
    const generation = tab.captureGeneration;
    let invalidated = false;
    // Chromium reports the cursor of the input it dispatches, the live view's pointer included.
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
        },
        (frame) => {
          if (!tab.secret?.submitted && !tab.filledCard && tab.captureGeneration === generation) onFrame(frame);
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
    /** Hears the menu of this right-click, which then does not open on this screen. */
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

  /** A live view's copy. A protected tab refuses it as it refuses input: its fields hold a secret. */
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
        // The agent reads a page that it opens, so the first snapshot comes with the tab and saves a call.
        let read = yield* Effect.result(this.#finalStepsSnapshot(params, tab.id));
        // A page that redirects at once navigates during the first read. The next read waits for
        // the page that the redirect loads, and saves the agent a call.
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
            // The image comes before delivery: when it fails, the next snapshot still carries the entries.
            const result = yield* readTabSnapshot(
              tab,
              tab.revision + 1,
              keepQueueBlocked,
              undefined,
              undefined,
              (read) =>
                Effect.gen(function* () {
                  const recommended = mode === "auto" && read.recommendImage && !tab.filledCard;
                  // A screenshot or snapshot image just before this one shows the same page.
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
        // The first fill on a page, or into a frame of a new origin, waits for the owner's approval.
        // The approval comes outside the tab queue, and the second pass checks every field again.
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
        return snapshotTextResult(yield* this.act(args.tabId, args.revision, args.action));
      }),
    screenshot: ({ args }, params) =>
      Effect.gen({ self: this }, function* () {
        yield* browserSync(() => this.#requireToolTab(params, args.tabId));
        // A ref starts with the snapshot revision that made it.
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
        // A step after a renderer crash would act on a reloaded page with refs from the old one.
        const crashesAtStart = this.#tabs.get(tabId)?.crashes ?? 0;
        const crashed = () => (this.#tabs.get(tabId)?.crashes ?? 0) !== crashesAtStart;
        const run: BrowserScriptResult = yield* runBrowserScript({
          script: args.script,
          timeoutMs: args.timeoutMs ?? BROWSER_SCRIPT_DEFAULT_TIMEOUT_MS,
          maxSteps: BROWSER_SCRIPT_MAX_STEPS,
          // A step that waits for the crashed page gets no answer until its timeout.
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
            // A page can put a typed card value in its address, as in the result URL below.
            return tab ? tab.engine.scrubText(currentTabUrl(tab)) : undefined;
          },
        });
        // A secret, a typed card, or a person's control keeps the crashed page, and a snapshot of it
        // gets no answer.
        const crashKept = run.status === "page_crashed" && this.#tabs.get(tabId)?.pendingRestore === undefined;
        let result: BrowserScriptResult = crashKept ? { ...run, error: BROWSER_PAGE_CRASH_KEPT } : run;
        let snapshot: BrowserSnapshot | undefined;
        let snapshotError: string | undefined;
        // The page waits for its dialog, so a snapshot would wait too.
        if (
          args.finalSnapshot !== false &&
          !crashKept &&
          run.status !== "user_control" &&
          run.status !== "tab_closed" &&
          run.status !== "dialog"
        ) {
          // The steps are done when the final snapshot fails, so the result keeps their value and log.
          // Otherwise the agent sees only an error and can run the same clicks or submits again.
          const read = yield* Effect.result(this.#finalStepsSnapshot(params, tabId));
          if (Result.isSuccess(read)) snapshot = read.success;
          else {
            const error = read.failure.cause;
            if (error instanceof BrowserUserControlHeld)
              result = { ...run, status: "user_control", error: BROWSER_SCRIPT_USER_CONTROL_ERROR };
            else snapshotError = redactText(error instanceof Error ? error.message : String(error));
          }
        }
        // The steps before a failure stay done. Without a snapshot, the URL shows the agent where the
        // script left the tab, so that it does not start again from the wrong page.
        const tab = snapshot || (result.status === "completed" && !snapshotError) ? undefined : this.#tabs.get(tabId);
        return {
          ...snapshotTextResult({
            tabId,
            ...result,
            ...boundedScriptValue(result.value),
            ...(result.error === undefined ? {} : { error: redactText(result.error) }),
            ...(snapshotError === undefined ? {} : { snapshotError }),
            // A page can put a typed card value in its address, as in the tab list.
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
        // The action that opened the dialog goes on, and can open the next one.
        const next = Option.getOrUndefined(
          yield* tab.engine.nextDialog().pipe(Effect.timeoutOption(DIALOG_ACTION_WAIT_MS)),
        );
        if (next) return textResult({ answered, ...dialogTabResult(args.tabId, next) });
        // Waits in the tab queue for the action, then for the page to settle. A dialog can open meanwhile.
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
        // Checked only for a tab that exists, so closing an id that is already gone stays a silent
        // success and a repeated close is idempotent.
        const tab = this.#tabs.get(tabId);
        if (tab) {
          yield* browserSync(() => this.#requireToolTab(params, tabId, true));
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
    const outcome = yield* Effect.gen({ self: this }, function* () {
      const call = yield* browserSync(() => parseBrowserToolCall(params.tool, params.arguments));
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
                // The single place every browser tool failure reaches a provider. A page exception carries
                // the page's own message -- `throw new Error("password=hunter2")` -- so this gets the same
                // redaction the diagnostics ring applies, and the diagnostic copy stays the redacted one.
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
    if ("result" in outcome) return outcome.result;
    // The agent's control of the tab ended above, so the wait does not show the agent at work.
    if (hooks.onUserControl) return yield* hooks.onUserControl(outcome.heldTabId);
    return {
      success: false,
      contentItems: [{ type: "inputText", text: new BrowserUserControlHeld(outcome.heldTabId).message }],
    };
  }).bind(this);

  #toolTabs(params: DynamicToolCallParams): { tabs: BrowserTab[]; activeTabId: string | null } {
    // A page can put a typed card value in its title or address, so they go through the tab's scrub.
    const tabs = this.listTabs()
      .filter((tab) => this.#canUseToolTab(params, tab))
      .map((tab) => {
        const engine = this.#tabs.get(tab.id)?.engine;
        return engine ? { ...tab, title: engine.scrubText(tab.title), url: engine.scrubText(tab.url) } : tab;
      });
    const activeTabId = tabs.some((tab) => tab.id === this.#activeTabId)
      ? this.#activeTabId
      : (tabs.at(-1)?.id ?? null);
    return { tabs, activeTabId };
  }

  /**
   * One pass of `fill_card`. It types the card only when the owner approved the page and the origin of
   * each field's frame. Otherwise it types nothing and names the page and the frame origins to approve.
   * That pass ends with a failure in the tab queue, so it takes no snapshot and the refs stay current.
   */
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
                // A script the agent ran on the page or the payment frame's site can read the fields.
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
                  // A recording would keep the frames that show the card. A fill that waits keeps it.
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
                tab.contents.reload();
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
        // The engine checks this deadline between commands, which a frame that answers none of
        // them never reaches.
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

  /**
   * One `run_script` step, with the checks of the tool that the step names. Each step takes its own
   * queue slot and checks the tab policy again first, so a person can take the tab between steps.
   * A failed step is an outcome; only an interruption ends the effect.
   */
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
            // A step often evaluates a statement, such as a click, that returns nothing. As an error, the
            // agent would run the statement again.
            value: yield* this.#runEvaluation(
              tabId,
              step.expression,
              step.awaitPromise ?? true,
              browserToolTimeout(step.timeoutMs),
              true,
              // The value goes to the script, not to the model; the script result keeps the 64 KB limit.
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
            // run_script raises the message as a script Error, which adds its own "Error: " prefix.
            error: redactText(cause instanceof Error ? cause.message : String(cause)),
          };
    return yield* run.pipe(
      Effect.catch((failure) => Effect.succeed(outcome(failure.cause))),
      // A plain throw in a step is a defect. As a failed tool request, Codex showed only "dynamic tool request
      // failed", and the agent lost the steps that had run and could repeat them (#6712).
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

  /** The one snapshot at the end of `run_script`, after the tab policy is checked again. */
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
        // Capture the persisted tab list before removing native views.
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

  /**
   * Deletes the cookies, storage and cache of an agent's own session, for a deleted agent. Its tabs
   * must be closed first: a tab still open in the session keeps it.
   */
  readonly clearAgentSession = Effect.fn("BrowserHost.clearAgentSession")(function* (
    this: BrowserHost,
    agentId: string,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.clearTabSession({ kind: "agent", key: agentBrowserSessionKey(agentId) });
  }).bind(this);

  /**
   * Deletes the cookies, storage and cache of a session other than the shared one. Its tabs must be
   * closed first: a tab still open in the session keeps it.
   */
  readonly clearTabSession = Effect.fn("BrowserHost.clearTabSession")(function* (
    this: BrowserHost,
    tabSession: BrowserTabSession,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const partition = browserTabPartition(tabSession);
    if (this.tabIdsInSession(tabSession).length > 0)
      return yield* browserFailure(new Error(sourceText("error.backend.browserSessionInUse")));
    // A session that never opened has nothing to clear, and opening one would create it.
    if (!this.#tabSessions.has(partition) && !existsSync(join(app.getPath("sessionData"), "Partitions", partition)))
      return;
    const target = this.#tabSessions.get(partition) ?? session.fromPartition(`persist:${partition}`, { cache: true });
    this.#tabSessions.delete(partition);
    yield* this.#dropAppliedProxy(partition);
    yield* browserCall(() => target.clearStorageData());
    yield* browserCall(() => target.clearCache());
  }).bind(this);

  /** The open tabs in a session other than the shared one, popups included. */
  tabIdsInSession(tabSession: BrowserTabSession): string[] {
    const partition = browserTabPartition(tabSession);
    return [...this.#tabs.values()]
      .filter((tab) => tab.tabSession && browserTabPartition(tab.tabSession) === partition)
      .map((tab) => tab.id);
  }

  /** The session of each open tab that is not in the shared session or a private one. */
  listTabSessions(): { tabId: string; tabSession: BrowserTabSession }[] {
    return [...this.#tabs.values()].flatMap((tab) =>
      tab.tabSession && !tab.closing ? [{ tabId: tab.id, tabSession: tab.tabSession }] : [],
    );
  }

  /** The session for a new tab of this agent. A profile that does not exist fails: no fallback. */
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

  /**
   * Gives a named profile session its proxy before a tab opens in it. A change closes the open
   * connections and the saved proxy sign-in, so no request goes out the old way. With a proxy there
   * is no direct fallback: a proxy that does not answer fails the page load.
   */
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
    // Until the new proxy applies, the session has none that a new tab may use.
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
    }).pipe(
      // The old relay stops also when the new proxy fails: a session without its proxy must not connect.
      Effect.ensuring(previous?.relay?.close ?? Effect.void),
    );
    this.#appliedProxies.set(partition, applied);
  }).bind(this);

  /** Forgets the proxy of a session and stops its relay. */
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

  /**
   * Stops the relay of a profile after its proxy changed and its tabs closed. A session that a new
   * tab gave the new proxy keeps it. The session keeps the rules of the stopped relay, so it cannot
   * connect until the next tab applies the new proxy.
   */
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

  /** The sign-in that a tab gives when its proxy asks. */
  #tabProxySignIn(tab: Pick<BrowserHostTab, "tabSession">): AppliedProxy["signIn"] {
    if (tab.tabSession?.kind !== "profile") return null;
    return this.#appliedProxies.get(browserTabPartition(tab.tabSession))?.signIn ?? null;
  }

  /** The proxy that a tab's page loads go through, or null. */
  #tabProxy(tab: Pick<BrowserHostTab, "tabSession">): BrowserProxyConnection | null {
    if (tab.tabSession?.kind !== "profile") return null;
    return this.#appliedProxies.get(browserTabPartition(tab.tabSession))?.proxy ?? null;
  }

  /** The relay of a tab's session, or null when its proxy has none. */
  #tabRelay(tab: Pick<BrowserHostTab, "tabSession">): BrowserProxyRelay | null {
    if (tab.tabSession?.kind !== "profile") return null;
    return this.#appliedProxies.get(browserTabPartition(tab.tabSession))?.relay ?? null;
  }

  /** Why a page load through the proxy of a tab failed, from the error that Chromium gives. */
  #tabProxyFailure(tab: BrowserHostTab, error: BrowserProxyFailure): BrowserProxyFailure {
    if (this.#proxySignInRefused.has(tab)) return "signIn";
    // Through a relay, Chromium sees only a failed tunnel. The relay knows whether the proxy refused the sign-in.
    return this.#tabRelay(tab)?.exitFailure() ?? error;
  }

  /** Records whether a page load could reach the proxy of its tab, and why not. */
  #noteProxyLoad(tab: BrowserHostTab, failure: BrowserProxyFailure | null): void {
    const proxyId = this.#tabProxy(tab)?.proxyId;
    if (proxyId === undefined || (this.#proxyFailures.get(proxyId) ?? null) === failure) return;
    if (failure === null) this.#proxyFailures.delete(proxyId);
    else this.#proxyFailures.set(proxyId, failure);
    this.#onProxyStatusChanged();
  }

  /**
   * The failure of a page load that the proxy of its tab stopped, with a message that names the proxy.
   * Other failures stay as they are.
   */
  #proxyLoadFailure(tab: BrowserHostTab, failure: BrowserOperationError): BrowserOperationError {
    const proxy = this.#tabProxy(tab);
    const proxyError = proxyErrorInText(String(failure.cause));
    if (proxy === null || proxyError === undefined) return failure;
    if (proxy.kind === "computer")
      return browserFailure(new Error(sourceText("error.backend.browserProxyComputerUnreachable")));
    // The network error of this load came first and recorded why. Chromium commits its error page
    // before the load fails here, and that commit clears the sign-in mark of the tab.
    const reason = this.#proxyFailures.get(proxy.proxyId) ?? this.#tabProxyFailure(tab, proxyError);
    return browserFailure(
      new Error(
        reason === "signIn"
          ? sourceText("error.backend.browserProxySignInRefused", { name: proxy.host })
          : sourceText("error.backend.browserProxyUnreachable", { name: proxy.host }),
      ),
    );
  }

  /** Why the last page load through a proxy failed, or null when it did not fail. */
  proxyFailure(proxyId: string): BrowserProxyFailure | null {
    return this.#proxyFailures.get(proxyId) ?? null;
  }

  /** Forgets the failure of a proxy that changed or went away. The next page load reports again. */
  forgetProxyFailure(proxyId: string): void {
    this.#proxyFailures.delete(proxyId);
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
    return view;
  }

  #configureSession(target: Session): void {
    // Use the installed Chromium identity for pages, frames and workers.
    // The request policy keeps the Google account compatibility exception.
    // Service workers read the process fallback instead of the session, so it changes too.
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
      if (tab && details.resourceType === "mainFrame" && proxyError !== undefined)
        this.#noteProxyLoad(tab, this.#tabProxyFailure(tab, proxyError));
      if (!tab || tab.secret) return;
      // The page or a navigation cancelled a subresource request: it did not fail. Live pages cancel
      // many. A cancelled page load can be a blocked navigation, so it stays an error.
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
    target.setPermissionRequestHandler((_webContents, permission, callback) =>
      callback(isAllowedBrowserPermission(permission)),
    );
    target.setPermissionCheckHandler((_webContents, permission) => isAllowedBrowserPermission(permission));
    target.on("will-download", (event, item, contents) => {
      if ([...this.#tabs.values()].some((tab) => tab.secret && tab.contents === contents)) {
        event.preventDefault();
        return;
      }
      if (this.#activeDownloads >= MAX_ACTIVE_DOWNLOADS || item.getTotalBytes() > MAX_DOWNLOAD_BYTES) {
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
      this.#activeDownloads += 1;
      // A server can send no size, or a wrong one, so the received bytes are checked as they arrive.
      item.on("updated", () => {
        if (item.getState() !== "progressing" || item.getReceivedBytes() <= MAX_DOWNLOAD_BYTES) return;
        logger.warn("Browser download stopped at the size limit", { limitBytes: MAX_DOWNLOAD_BYTES });
        item.cancel();
      });
      item.once("done", () => {
        this.#activeDownloads -= 1;
        this.#reservedDownloadPaths.delete(downloadPath);
      });
    });
  }

  #bindTabEvents(tab: BrowserHostTab): void {
    const contents = tab.contents;
    const changed = () => this.#emitChanged();
    // WebRTC must not send UDP around the proxy: the page would see the real address.
    if (this.#tabProxy(tab)) contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
    // The proxy asks for its sign-in. A wrong one asks again, so each document gets a few answers only.
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
      // `#closeRenderer` closes the old contents of a tab that stays open.
      if (tab.contents !== contents) return;
      tab.closing = true;
      tab.focusedAtPageClose = contents.isFocused();
    });
    contents.once("destroyed", () => {
      if (tab.contents !== contents) return;
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
      // Only a tab in the main window: a Picture in Picture tab leaves Cmd+Q to the menu item, which asks
      // first, because the hint shows in the main window and that window can be hidden.
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
        // Deliberately no `preventDefault()`: `before-input-event` is synchronous and says nothing
        // about what has focus, so the page keeps the key and the decision is made after asking it.
        // A page that closes its own dialog on Escape does that as well as collapsing the panel.
        this.#collapseOnEscape(tab);
        return;
      }
      if (
        isBrowserViewShortcut(input, process.platform === "darwin") &&
        this.#mountedViews.get(tab.view) === this.#window
      ) {
        // The full view owns the tab keys: it keeps the order and the closed tabs that the keys use.
        event.preventDefault();
        this.#forwardKeyToWindow(input);
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
        // A member's right-click from a live view: their screen shows the menu, and this one does not.
        event.preventDefault();
        if (!tab.secret) viewMenu.deliver(viewContextMenu(items, params.linkURL, params.srcURL));
        return;
      }
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
    this.#bindUserBrowsing(tab);
    contents.on("did-start-loading", changed);
    contents.on("dom-ready", () => {
      // Keep page content at the same width when the viewport scrollbar appears or disappears.
      // Navigation replaces the document, so each new document needs the stylesheet.
      void contents.insertCSS(":where(html) { scrollbar-gutter: stable; }").catch(() => undefined);
      // An agent tab refuses cookie banners, so the agent does not spend turns on them. A tab that a
      // person controls keeps the banner for that person.
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
    // An agent tab whose renderer crashed loads its page again on the next browser call, so the
    // agent does not fail on a dead tab. A secret, a typed card, or a person's control keeps the
    // crashed page: a reload could send a form again or lose what the person did.
    contents.on("render-process-gone", (_event, details) => {
      if (tab.closing || tab.contents !== contents || contents.isDestroyed() || details.reason === "clean-exit") return;
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
    // Chromium gives a visible page the focus when a new document commits. A navigation that an
    // agent or the page starts must not take the keys from a person who types in the app.
    let focusedBeforeCommit: WebContents | null = null;
    const restoreFocusAfterCommit = () => {
      const previous = focusedBeforeCommit;
      focusedBeforeCommit = null;
      // With no focused window the app is in the background, and a restore would raise it.
      if (previous && contents.isFocused() && BrowserWindow.getFocusedWindow())
        restoreWebContentsFocus(previous, contents);
    };
    contents.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      focusedBeforeCommit = tab.focusOnCommit ? null : this.#focusedContentsOutsideTabs();
      tab.focusOnCommit = false;
    });
    contents.on("did-navigate", restoreFocusAfterCommit);
    // An error page also commits, but Electron reports it as a failed load. A load that a newer
    // navigation cancels has no commit, so the tab has no focus and the newer start stays recorded.
    contents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame && contents.isFocused()) restoreFocusAfterCommit();
    });
    contents.on("did-navigate", (_event, url) => {
      tab.documents += 1;
      this.#releaseScriptedDocument(tab);
      if (tab.secretDocument) {
        tab.secretDocument = false;
        contents.navigationHistory.clear();
      }
      // The next document has no card in its fields. History would bring the filled page back.
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
          // A thread that drives a shared tab also drives its popups, for example a sign-in window.
          if (tab.sharedThreadIds?.size) popup.sharedThreadIds = new Set(tab.sharedThreadIds);
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
          // An agent click also opens popups. Focus follows only a person who uses the page.
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

  /** Sends a key press of the page to the window, with its modifiers, and gives the window the focus. */
  #forwardKeyToWindow(input: Input): void {
    if (this.#window.isDestroyed()) return;
    const keyCode = FORWARDED_KEY_CODES[input.key] ?? (input.key.length === 1 ? input.key.toUpperCase() : input.key);
    const modifiers: Array<"shift" | "control" | "alt" | "meta"> = [];
    if (input.shift) modifiers.push("shift");
    if (input.control) modifiers.push("control");
    if (input.alt) modifiers.push("alt");
    if (input.meta) modifiers.push("meta");
    this.#window.webContents.focus();
    this.#window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    this.#window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
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
      return;
    }

    if (this.#attachedView !== tab.view) {
      this.#hideAttachedView();
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
    const bounds = validateBounds({
      x: this.#bounds.x * zoomFactor,
      y: this.#bounds.y * zoomFactor,
      width: this.#bounds.width * zoomFactor,
      height: this.#bounds.height * zoomFactor,
    });
    tab.view.setBounds(bounds);
    tab.view.setVisible(true);
    this.#attachedViewShown = true;
    tab.contents.invalidate();
    this.#raisePictureInPictureOverlay();
    this.#mainPageListener?.(this.#target === "main" ? { tabId: tab.id, bounds, zoomFactor } : null);
    if (tab.focusOnVisible && !this.#inBackgroundWindow(tab.view)) {
      tab.focusOnVisible = false;
      tab.contents.focus();
    }
  }

  #hideAttachedView(): void {
    this.#attachedViewShown = false;
    if (this.#attachedView) this.#hideView(this.#attachedView);
  }

  /** Hides a view that the panel does not show. On Linux a view in the background window stays shown, or it would not draw. */
  #hideView(view: WebContentsView): void {
    view.setVisible(SHOWS_VIEWS_IN_BACKGROUND && this.#inBackgroundWindow(view));
  }

  /** True when the panel shows the view. On Linux a view in the background window is shown only to draw. */
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
    // The page takes the focus when the main window shows again.
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
    // Initialize the native viewport before hiding a tab that has never been shown.
    view.setVisible(true);
    view.setBounds(this.#hiddenViewBounds(window));
    this.#hideView(view);
  }

  /**
   * The viewport of a tab that the panel does not show. It is the panel's size, so the page does not
   * lay out again when the tab is shown. Before the panel has a size, it is the viewport of a
   * maximized Chrome window on the main display: a fixed size such as 1200x800 is a bot signal.
   */
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

  /** The window that holds the views that `#mountedViews` gives to `window`. */
  #nativeParent(window: BrowserWindow): BaseWindow {
    return window === this.#window && this.#mainViewsInBackground && this.#backgroundWindow
      ? this.#backgroundWindow
      : window;
  }

  /** On macOS, focusing a page also focuses its window, which would bring OpenBot to the front. */
  #inBackgroundWindow(view: WebContentsView): boolean {
    const window = this.#mountedViews.get(view);
    return window !== undefined && this.#nativeParent(window) !== window;
  }

  /** Moves the main window's views to the background window or back. True when they moved. */
  #syncBackgroundWindow(): boolean {
    const window = this.#window;
    // Hide OpenBot (⌘H) also hides the background window. Showing it then would show OpenBot again.
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
      this.#backgroundWindow ??= createBackgroundWindow();
      this.#backgroundWindow.setBounds(this.#backgroundBounds(window));
      this.#backgroundWindow.showInactive();
    }
    this.#mainViewsInBackground = background;
    const to = this.#nativeParent(window);
    for (const [view, owner] of this.#mountedViews) {
      if (owner !== window) continue;
      if (!from.isDestroyed()) from.contentView.removeChildView(view);
      to.contentView.addChildView(view);
      if (SHOWS_VIEWS_IN_BACKGROUND)
        view.setVisible(background || (view === this.#attachedView && this.#attachedViewShown));
    }
    if (!background) this.#backgroundWindow?.hide();
    return true;
  }

  /**
   * The views keep their bounds, so the background window has the size of the main window's content.
   * A minimized Windows window reports a tiny content size off screen, so there the background window
   * takes the restored place and covers each view. On Linux it is one pixel, which clips the shown views.
   */
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

  /** Succeeds when the renderer of the tab's page crashes. */
  #rendererGone(tabId: string): Effect.Effect<BrowserStepOutcome> {
    return Effect.callback<BrowserStepOutcome>((resume) => {
      const contents = this.#tabs.get(tabId)?.contents;
      if (!contents || contents.isDestroyed()) return;
      const gone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
        if (details.reason !== "clean-exit") resume(Effect.succeed({ status: "page_crashed" }));
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
    return tab;
  });

  /** `dialogTool` is true for a tool that works while a page dialog is open: `handle_dialog` and `close_tab`. */
  #requireToolTab(params: DynamicToolCallParams, tabId: string, dialogTool = false): void {
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
    if (this.#heldByUser(tabId)) throw new BrowserUserControlHeld(tabId);
    const engine = this.#tabs.get(tabId)?.engine;
    const dialog = engine?.dialog;
    // The page waits for its dialog, so every other tool would wait until its timeout.
    if (!dialog || dialogTool) return;
    if (engine?.dialogOwnedBy({ threadId: params.threadId, turnId: params.turnId }))
      throw new Error(
        `A ${dialog.type} dialog is open in this tab: ${JSON.stringify(dialog.message)}. Answer it first with handle_dialog, dialogId ${dialog.id}.`,
      );
    throw new Error(
      "A dialog is open in this tab, and only a person can answer it. Ask the user to answer it, then try again.",
    );
  }

  /**
   * The owner thread can use its tab. Another thread of the same agent can use it after a person shared
   * it with that thread. A tab with no owner agent is never shared.
   */
  #canUseToolTab(params: DynamicToolCallParams, tab: BrowserTab): boolean {
    const ownerAgentId = params.ownerAgentId ?? null;
    if (tab.ownerThreadId === params.threadId) return tab.ownerAgentId === null || tab.ownerAgentId === ownerAgentId;
    if (tab.ownerAgentId === null || tab.ownerAgentId !== ownerAgentId) return false;
    return this.#tabs.get(tab.id)?.sharedThreadIds?.has(params.threadId) ?? false;
  }

  /**
   * Lets one more thread of the tab's owner agent use the tab: a person tagged the tab in a message to
   * that thread. A tab of another agent, or of no agent, does not change, so a false tag shares nothing.
   */
  shareTab(tabId: string, target: { agentId: string; threadId: string }): void {
    const tab = this.#tabs.get(tabId);
    if (!tab || tab.closing || tab.privateSession || tab.ownerAgentId === null) return;
    if (tab.ownerAgentId !== target.agentId || tab.ownerThreadId === target.threadId) return;
    if (tab.sharedThreadIds?.has(target.threadId)) return;
    tab.sharedThreadIds = (tab.sharedThreadIds ?? new Set()).add(target.threadId);
    this.#schedulePersist();
  }

  /** A deleted thread can use no tab. */
  unshareThread(threadId: string): void {
    let changed = false;
    for (const tab of this.#tabs.values()) changed = tab.sharedThreadIds?.delete(threadId) === true || changed;
    if (changed) this.#schedulePersist();
  }

  /**
   * The title and address of a tab of this agent, as its message references show them to the provider,
   * or null when the agent does not own the tab. A page can put a typed card value in either one, so
   * both go through the tab's scrub, as the tab list of the browser tool does.
   */
  agentTab(tabId: string, agentId: string): { title: string; url: string } | null {
    const tab = this.#tabs.get(tabId);
    if (!tab || tab.closing || tab.contents.isDestroyed() || tab.ownerAgentId !== agentId) return null;
    const { title, url } = toPublicTab(tab);
    return { title: tab.engine.scrubText(title), url: tab.engine.scrubText(url) };
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
    // The origin is read in the tab's queue, just before the script runs, and again when it ends: a
    // navigation queued before it, or one that commits while it runs, decides where it ran.
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

  /** Whether one of the browser's own tabs has focus. */
  #tabHasFocus(): boolean {
    const focusedContents = webContents.getFocusedWebContents();
    return focusedContents !== null && [...this.#tabs.values()].some((tab) => tab.contents === focusedContents);
  }

  /** The app contents that has focus, unless it is one of the browser's own tabs. */
  #focusedContentsOutsideTabs(): WebContents | null {
    const focusedContents = webContents.getFocusedWebContents();
    return focusedContents && ![...this.#tabs.values()].some((candidate) => candidate.contents === focusedContents)
      ? focusedContents
      : null;
  }

  /**
   * The agent whose memory review may read what a person does in this tab now, or null. Only while a
   * person holds the tab (takeover or Take control), so no step is the agent's. Never a tab with a
   * secret entry or a private sign-in.
   */
  #userBrowsingAgent(tab: BrowserHostTab): string | null {
    const agentId = tab.ownerAgentId;
    if (agentId === null || tab.secret || tab.privateSession || tab.contents.isDestroyed()) return null;
    if (!this.#takeoverTabIds.has(tab.id) && !this.#userControlTabIds.has(tab.id)) return null;
    return this.#userBrowsing?.enabled() ? agentId : null;
  }

  /**
   * Keeps one step of what a person did. A teach recording of the tab takes it; without one it goes to
   * the browsing steps of the agent, as `#userBrowsingAgent` permits.
   */
  #recordUserStep(tab: BrowserHostTab, step: BrowserTeachStep): void {
    if (this.#recordTeachStep(tab, step)) return;
    const agentId = this.#userBrowsingAgent(tab);
    if (agentId !== null) this.#userBrowsing?.record(agentId, step);
  }

  /** Records the pages that load and the controls that a person clicks, for `#recordUserStep`. */
  #bindUserBrowsing(tab: BrowserHostTab): void {
    const contents = tab.contents;
    const records = () => this.#teachRecordings.has(tab.id) || this.#userBrowsingAgent(tab) !== null;
    const recordPage = () => {
      const place = records() ? stepPlace(contents.getURL()) : null;
      if (!place) return;
      const title = stepText(contents.getTitle());
      this.#recordUserStep(tab, { kind: "page", ...place, ...(title ? { title } : {}) });
    };
    contents.on("did-finish-load", recordPage);
    contents.on("page-title-updated", recordPage);
    contents.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
      if (isMainFrame) recordPage();
    });
    contents.on("input-event", (_event, input) => {
      if (input.type !== "mouseDown" || !("x" in input) || !("y" in input)) return;
      const { x, y } = input;
      if (typeof x !== "number" || typeof y !== "number" || !records()) return;
      const place = stepPlace(contents.getURL());
      if (!place) return;
      void readClickTarget(contents, x, y).then((target) => {
        // The tab can change hands while the page answers.
        if (target) this.#recordUserStep(tab, { kind: "click", ...place, ...target });
      });
    });
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
const CRASH_RELOAD_TIMEOUT_MS = 30_000;

/** Loads the address of the crashed page in a new renderer. */
const reloadCrashedPage = Effect.fn("BrowserHost.reloadCrashedPage")(function* (tab: BrowserHostTab) {
  const url = currentTabUrl(tab);
  // A CDP command to the crashed page gets no answer, so the page loads first. A failed load shows
  // its error page, which the next snapshot reports.
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

/** The `url` of a diagnostic entry without credentials, query, or fragment; no key when the URL does not parse. */
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
  // A typed failure in `browserSync`, so the agent reads the reason, not a failed tool request (#5991).
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

/**
 * Extends a small capture to `MIN_CAPTURE_SIDE` on the right and the bottom with its top-left pixel,
 * the page around an element. The content keeps its scale and position, so a point in the image is
 * still the same pixel.
 */
function paddedCaptureDataUrl(image: NativeImage): string {
  const encoded = image.toDataURL();
  // One representation in the encoded pixels: `getSize` gives a 2x capture in half of them.
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

/** Loads the current page with GET, so that a form POST is not sent again. */
function reloadWithGet(tab: BrowserHostTab): Effect.Effect<void, BrowserOperationError> {
  return navigateAndWait(tab.contents, () => tab.contents.loadURL(currentTabUrl(tab), browserLoadOptions()));
}

/** A load that `BrowserHost.stop` ended succeeds: the person chose to keep the page as it is. */
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

/**
 * An evaluated value as JSON text. Text past the model limit is cut, with a note that says how to read
 * more. A string is cut in its own characters, so that the note counts what the model returned.
 */
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

/** The start of a string whose JSON form is past the model limit, and a note in characters of the string. */
function cutStringValue(value: string): ModelTextCut | null {
  if (JSON.stringify(value).length <= BROWSER_VALUE_TEXT_LIMIT) return null;
  return cutModelText(value, jsonStringFit(value, BROWSER_VALUE_TEXT_LIMIT), BROWSER_STRING_MORE);
}

/**
 * A script value whose JSON is past the model limit becomes a string, and `valueCut` says so. The model
 * reads that string with its escapes, so the cut is the longest start whose escaped form fits. A string
 * value is cut in its own characters; another value is cut in characters of its JSON.
 */
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

/** An action that closed its tab returns this in place of a snapshot. */
type ClosedTabResult = { tabId: string; closed: true; openerTabId?: string };

/** A tool result that is a snapshot, or a fill result that carries one. */
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

/**
 * The model reads many snapshots in a task, so the model text is compact. Each element is one line,
 * which leaves out the JSON keys and the empty defaults. The history leaves out what the model already
 * knows: network requests that succeeded, and its own actions that succeeded with no detail. The
 * snapshot tool description says so. Only the snapshot's own elements become lines: a value that a
 * script returns keeps its `elements` key as it is.
 */
function snapshotJson(value: SnapshotToolPayload): string {
  if ("elements" in value) return JSON.stringify(withElementLines(value));
  if ("snapshot" in value) return JSON.stringify({ ...value, snapshot: withElementLines(value.snapshot) });
  return JSON.stringify(value);
}

function withElementLines(snapshot: BrowserSnapshot | ClosedTabResult | DialogTabResult | null | undefined) {
  return snapshot && "elements" in snapshot ? { ...snapshot, elements: snapshot.elements.map(elementLine) } : snapshot;
}

/** Tags that the role already implies. The line names a tag only when it adds to the role. */
const ROLE_TAGS: Readonly<Record<string, readonly string[]>> = {
  button: ["button"],
  link: ["a"],
  textbox: ["input", "textarea"],
  searchbox: ["input"],
  // A native select keeps its tag: only it takes select_option.
  combobox: ["input"],
  checkbox: ["input"],
  radio: ["input"],
  slider: ["input"],
  spinbutton: ["input"],
  option: ["option"],
  img: ["img"],
};

/**
 * `ref [role] "name" [<tag>] [value="…"] [description="…"] [state:value…] [bounds=x,y,w,h]
 * [frame=id frameUrl="…"]`. Text values are JSON strings; the other tokens have no spaces.
 */
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
