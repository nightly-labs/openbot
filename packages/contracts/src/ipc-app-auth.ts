import type { InstallerProviderId, ManagedProviderId, ManagedToolRuntimeId } from "./agent-providers";
import type { AgentModelId, AvatarColor } from "./ipc-agent-identity";
import type { AgentProviderId } from "./ipc-agent-status";
import { integerInRange, isFiniteNumber, isIdentifier } from "./ipc-bounded-values";
import { decodeRecord, nullableNumber, requiredBoolean, requiredNumber, requiredString } from "./ipc-decoding";
import { isDynamicRecord, isString } from "./runtime-values";

export type DesktopPlatform = "darwin" | "win32" | "linux";
export type AppVariant = "production" | "dev" | "preview";
/** A 12-hour clock with AM and PM, or a 24-hour clock. */
export type HourCycle = "h12" | "h23";

export interface AppInfo {
  name: string;
  version: string;
  platform: DesktopPlatform;
  variant: AppVariant;
  /** Set only in an unpackaged build that a local analytics capture server reads. */
  analyticsCaptureUrl?: string;
  /** The random analytics ID of this install, for events that do not go with the account. */
  analyticsInstallId?: string;
  /**
   * True when Chromium draws the windows on the CPU: hardware acceleration is off, or the GPU is
   * blocked or missing, as on a server, a remote desktop or a computer whose GPU failed.
   */
  softwareRendering?: boolean;
  /**
   * The clock that the macOS "24-hour time" setting selects. Chromium does not read it, so times
   * follow it only through this value. Not set when the language's own clock applies.
   */
  hourCycle?: HourCycle;
}

/** The phase list is the source of truth: `UpdatePhase` is derived from it. */
export const UPDATE_PHASES = [
  "idle",
  "checking",
  "available",
  "downloading",
  "ready",
  "installing",
  "up-to-date",
  "error",
  "unsupported",
] as const;

export type UpdatePhase = (typeof UPDATE_PHASES)[number];

/**
 * Phases where the user is waiting on work already under way. Every one of these must be bounded by
 * a timeout in the main-process updater, otherwise the UI renders a spinner that can never resolve.
 */
export const UPDATE_BUSY_PHASES = ["checking", "downloading", "installing"] as const satisfies readonly UpdatePhase[];

export type UpdateBusyPhase = (typeof UPDATE_BUSY_PHASES)[number];

/** Phases where an update is in play, which is what makes the update UI visible. */
export const UPDATE_ACTIVE_PHASES = [
  "available",
  "downloading",
  "ready",
  "installing",
] as const satisfies readonly UpdatePhase[];

const BUSY_PHASES = new Set<UpdatePhase>(UPDATE_BUSY_PHASES);
const ACTIVE_PHASES = new Set<UpdatePhase>(UPDATE_ACTIVE_PHASES);

export function isUpdateBusyPhase(phase: UpdatePhase): phase is UpdateBusyPhase {
  return BUSY_PHASES.has(phase);
}

export function isUpdateActivePhase(phase: UpdatePhase): boolean {
  return ACTIVE_PHASES.has(phase);
}

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  progress: number | null;
  checkedAt: string | null;
  message: string | null;
  errorCode: UpdateFailureCode | null;
  /**
   * True on a Mac whose host manages updates for every tenant. The tenant UI hides its own
   * install, download and check actions but keeps showing the status; absent means unmanaged.
   */
  managedByHost?: boolean;
  /** A restart that an admin of a joined server asked for. Absent when none waits. */
  scheduledRestart?: ScheduledUpdateRestart;
  /** A restart that the user of this computer asked for. Absent when none waits. */
  idleRestart?: IdleRestart;
}

/** `relaunch` starts OpenBot again; `update` installs the downloaded update. */
export const IDLE_RESTART_TARGETS = ["relaunch", "update"] as const;
export type IdleRestartTarget = (typeof IDLE_RESTART_TARGETS)[number];

/**
 * A restart that waits until no work runs. New routine runs wait for it, so a busy schedule does not
 * stop it; they run after the restart, or after a cancel.
 */
export interface IdleRestart {
  target: IdleRestartTarget;
  /** The restart blockers that still run, such as `agent-turn`. Empty when none. */
  waitingFor: string[];
  /** Why the restart did not start. Nothing waits then, and the routines run again. */
  error?: string;
}

export const UPDATE_FAILURE_CODES = ["check_failed", "download_failed", "install_failed"] as const;
export type UpdateFailureCode = (typeof UPDATE_FAILURE_CODES)[number];

export interface UpdatePreference {
  autoDownload: boolean;
  /** Owners and admins of a joined server can start an update of this computer. */
  allowRemoteUpdates: boolean;
  /** Restart into a downloaded update when no work runs, without a request. */
  autoInstall: boolean;
}

/** The fields to change. An absent field keeps its stored value. */
export type UpdatePreferenceChange = Partial<UpdatePreference>;

/** `now` restarts as soon as the update is ready; `when-idle` waits until no work runs. */
export const UPDATE_RESTART_MODES = ["when-idle", "now"] as const;
export type UpdateRestartMode = (typeof UPDATE_RESTART_MODES)[number];

export interface ScheduledUpdateRestart {
  /** The name of the member who asked, or null when this computer installs updates automatically. */
  requestedBy: string | null;
  mode: UpdateRestartMode;
  /** The restart blockers that still run, such as `agent-turn`. Empty when none. */
  waitingFor: string[];
}

/** `managed`: a Host Manager controls the updates of this host. */
export const REMOTE_UPDATES_STATES = ["allowed", "disabled", "managed"] as const;
export type RemoteUpdatesState = (typeof REMOTE_UPDATES_STATES)[number];

/** The app update of a joined server's host, as `host-update-v1` reports it. */
export interface HostUpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  /** An integer from 0 to 100, or null. */
  progress: number | null;
  errorCode: UpdateFailureCode | null;
  remoteUpdates: RemoteUpdatesState;
  autoDownload: boolean;
  autoInstall: boolean;
  restart: ScheduledUpdateRestart | null;
}

/** The host's update switches that an admin sets. An absent field keeps its stored value. */
export type HostUpdateSettingsChange = Partial<Pick<UpdatePreference, "autoDownload" | "autoInstall">>;

export type ProviderRuntimePhase = "not-downloaded" | "downloading" | "finishing" | "ready" | "download-error";

export interface ProviderRuntimeStatus {
  /**
   * The newer version an update installs, when an older install exists: the latest upstream release
   * the last check found, or the version this OpenBot release carries, whichever is newer.
   */
  availableVersion?: string | null;
  phase: ProviderRuntimePhase;
  progress: number | null;
  message: string | null;
  version: string | null;
}

export interface ProviderRuntimeSnapshot {
  revision: number;
  /**
   * Only the providers whose CLI OpenBot downloads and pins itself. A provider that ships without a
   * managed runtime is absent from `ManagedProviderId`, so it needs no fake entry here, and every
   * provider that is in the tuple has a real status.
   */
  providers: Record<ManagedProviderId, ProviderRuntimeStatus> & InstallerRuntimeStatuses;
  /**
   * The tool runtimes, in a field of their own rather than mixed in above.
   *
   * These are downloaded for the MCP servers, not for an agent: nothing signs in to one, nothing
   * picks a model on one, and the provider cards must not grow an entry for one. Required, so a
   * reader that needs the status of a managed tool cannot silently read `undefined` instead.
   */
  toolRuntimes: Record<ManagedToolRuntimeId, ProviderRuntimeStatus>;
}

/**
 * The status of a provider that OpenBot installs with the provider's own installer: `ready` where
 * its CLI is found, so that a server's row offers Connect. Absent where the CLI is missing and this
 * computer cannot run the installer, and on a host before the installer: the row then shows the
 * install guide, not Download.
 */
export type InstallerRuntimeStatuses = { [Provider in InstallerProviderId]?: ProviderRuntimeStatus };

export interface ExportResult {
  saved: boolean;
}

export interface AppSetupState {
  completed: boolean;
  preferredProvider: AgentProviderId | null;
  /**
   * The model setup chose beside the provider, and `null` when the user took the provider's own
   * default. A new agent starts on it while that provider still lists it, which is how a custom
   * endpoint becomes the default: the provider is the CLI that runs it, and only the model names it.
   */
  preferredModel: AgentModelId | null;
}

export interface SaveSetupInput {
  preferredProvider: AgentProviderId;
  preferredModel: AgentModelId | null;
}

/**
 * The default provider of a joined server's host (`provider-default-v1`). A provider that this build
 * does not know reads as none.
 */
export type HostDefaultProvider = Pick<AppSetupState, "preferredProvider" | "preferredModel">;

export interface AnalyticsPreference {
  enabled: boolean;
}

/**
 * Renderer timing for host analytics: counts and milliseconds only. The renderer sends it at most
 * once a minute, and once when the main window's workspace finished its first load.
 */
/** The bounds of one renderer timing report. The renderer keeps to them and main rejects a report outside them. */
export const RENDERER_TIMING_LIMITS = {
  longTasks: 10_000,
  inputs: 100_000,
  /** Timed inputs in one report. Inputs past this count are left out of `inputs` too. */
  inputDelays: 64,
  inputDelayMs: 600_000,
} as const;

export interface RendererTimingReport {
  /** The main window's workspace finished its first load. Main times it on its own clock. */
  workspaceReady?: true;
  /** Renderer tasks of more than 200 ms since the last report. */
  longTasks: number;
  /** Key presses and pointer presses since the last report. */
  inputs: number;
  /** The input delay of each of those inputs that the browser timed (16 ms or more of handling), in ms. */
  inputDelaysMs: number[];
}

export interface SetAnalyticsPreferenceInput {
  enabled: boolean;
  /** True when the user chose this value. Only a choice is sent to the account; a default is not. */
  chosen?: boolean;
}

export interface CentralAuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  /**
   * The latest product analytics answer of the account, from any device. Null or missing: the user
   * never answered, or the account service is older.
   */
  analyticsEnabled?: boolean | null;
  /**
   * The tint of the user's own chat bubbles, which members of each server of the user see. Null or
   * missing: no chat color, or the account service is older.
   */
  chatColor?: AvatarColor | null;
}

export interface CentralAuthIssue {
  code: string;
  message: string;
  retryAfterSeconds?: number;
  /** A short code a user can copy into a report, such as `auth/timeout`. */
  reference?: string;
}

export type CentralAuthSignedOutReason = "keyring_changed";

export type CentralAuthState =
  | { status: "loading" }
  /**
   * `keyring_changed`: the Linux keyring did not open the saved sign-in, so OpenBot now keeps its
   * secrets in its own key file and the user signs in one more time.
   */
  | { status: "signed_out"; reason?: CentralAuthSignedOutReason }
  | { status: "signing_in" }
  | {
      status: "code_sent";
      challengeId: string;
      email: string;
      expiresAt: number;
      resendAvailableAt: number;
      developmentCode?: string;
      issue?: CentralAuthIssue | undefined;
    }
  /** The email signs in with the company's provider. The browser has the sign-in page. */
  | { status: "company_sign_in"; email: string; issue?: CentralAuthIssue | undefined }
  | { status: "signed_in"; user: CentralAuthUser }
  | { status: "error"; issue: CentralAuthIssue };

/** The company provider (OpenID Connect) that a server owner connected. */
export interface CompanySignInConnection {
  issuer: string;
  clientId: string;
  domains: string[];
  /** True: email codes are refused for the domains, and people sign in with the provider. */
  enabled: boolean;
  testedAt: number;
  /** When the SCIM token was made, or null when the server has none. */
  scimTokenCreatedAt: number | null;
}

export interface CompanySignInSettings {
  /** The address to add to the app at the provider. */
  redirectUri: string;
  /** The SCIM base address for user sync. */
  scimUrl: string;
  /** The DNS TXT record that proves a domain: `<name>.<domain>` holds `value`. */
  domainRecord: { name: string; value: string };
  /** False on a development account service, which does not read DNS. */
  domainCheck: boolean;
  connection: CompanySignInConnection | null;
}

/** The values of the setup dialog. An empty client secret keeps the saved one. */
export interface TestCompanySignInInput {
  serverId: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  domains: string[];
}

/** A test that passed saved the values. `email` is the account that signed in at the provider. */
export interface TestCompanySignInResult {
  email: string;
}

export interface SetCompanySignInEnabledInput {
  serverId: string;
  enabled: boolean;
}

/** Shown once. The account service keeps only its hash. */
export interface CompanySignInScimToken {
  token: string;
  createdAt: number;
}

/** Decodes the settings that the account service answers, and that main sends the renderer. */
export function decodeCompanySignInSettings(value: unknown): CompanySignInSettings {
  const settings = decodeRecord(value, "company sign-in settings");
  const record = decodeRecord(settings.domainRecord, "company sign-in domain record");
  return {
    redirectUri: requiredString(settings, "redirectUri"),
    scimUrl: requiredString(settings, "scimUrl"),
    domainRecord: { name: requiredString(record, "name"), value: requiredString(record, "value") },
    domainCheck: requiredBoolean(settings, "domainCheck"),
    connection: settings.connection === null ? null : decodeCompanySignInConnection(settings.connection),
  };
}

function decodeCompanySignInConnection(value: unknown): CompanySignInConnection {
  const connection = decodeRecord(value, "company sign-in connection");
  const { domains } = connection;
  if (!Array.isArray(domains) || !domains.every(isString)) throw new Error("Invalid company sign-in domains.");
  return {
    issuer: requiredString(connection, "issuer"),
    clientId: requiredString(connection, "clientId"),
    domains,
    enabled: requiredBoolean(connection, "enabled"),
    testedAt: requiredNumber(connection, "testedAt"),
    scimTokenCreatedAt: nullableNumber(connection, "scimTokenCreatedAt"),
  };
}

export function decodeCompanySignInScimToken(value: unknown): CompanySignInScimToken {
  const token = decodeRecord(value, "SCIM token");
  return { token: requiredString(token, "token"), createdAt: requiredNumber(token, "createdAt") };
}

export function decodeTestCompanySignInResult(value: unknown): TestCompanySignInResult {
  return { email: requiredString(decodeRecord(value, "company sign-in test"), "email") };
}

/** The sign-in code the user typed, with the challenge `requestEmailCode` answered. */
export interface VerifyEmailCodeInput {
  challengeId: string;
  code: string;
}

export type MacPermissionId = "screen-recording" | "accessibility";

/**
 * The Apple apps an MCP server may drive through AppleScript. macOS asks once for each, under
 * Privacy & Security › Automation, and keeps the answer for OpenBot.
 */
export const MAC_AUTOMATION_TARGETS = [
  "calendar",
  "contacts",
  "mail",
  "notes",
  "reminders",
  "messages",
  "safari",
] as const;

export type MacAutomationTarget = (typeof MAC_AUTOMATION_TARGETS)[number];

export const MAC_AUTOMATION_STATUSES = ["granted", "denied", "failed"] as const;

/**
 * The answer for one app. `denied` is the user's refusal, now or earlier: macOS does not ask again,
 * and only System Settings can change it. `failed` is anything else, such as an app that is not there.
 */
export interface MacAutomationResult {
  target: MacAutomationTarget;
  status: (typeof MAC_AUTOMATION_STATUSES)[number];
}

/**
 * A program that an agent started and left running after its tool call, such as a dev server that
 * `nohup ... &` started. The system adopted it, so no provider process of OpenBot holds it now.
 */
export interface BackgroundProcess {
  /** The pid and the start time: a pid is reused. Stop takes it. */
  id: string;
  pid: number;
  /** The command line with secrets redacted. */
  command: string;
  /** Milliseconds since the epoch. */
  startedAt: number;
  /** The TCP ports that the process or its children listen on. */
  ports: number[];
  /** The agent whose workspace holds the working folder of the process, or null when none does. */
  agentId: string | null;
}

export function isBackgroundProcess(value: unknown): value is BackgroundProcess {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    integerInRange(value.pid, 1, Number.MAX_SAFE_INTEGER) &&
    isString(value.command) &&
    isFiniteNumber(value.startedAt) &&
    Array.isArray(value.ports) &&
    value.ports.every((port) => integerInRange(port, 1, 65_535)) &&
    (value.agentId === null || isIdentifier(value.agentId))
  );
}

/**
 * How far Computer Use is from working, as one value the panel switches on.
 *
 * `permissions-required` is the only one the user can act on, by opening System Settings.
 * `driver-missing` says the build carries no driver, which every release does, and `error` says the
 * driver is there and answered with something else. Both are faults rather than steps, and they
 * stay apart because a report that only said "not ready" would hide which one happened.
 */
export const COMPUTER_USE_STATUSES = [
  "unsupported",
  "driver-missing",
  "permissions-required",
  "ready",
  "error",
] as const;

export type ComputerUseStatus = (typeof COMPUTER_USE_STATUSES)[number];

export interface ComputerUsePermission {
  id: MacPermissionId;
  granted: boolean;
}

/**
 * What the Computer Use panel draws.
 *
 * The permissions are a list rather than two fields so the panel can render them in one loop, and
 * so a driver that gains a third grant needs no new shape here.
 */
export interface ComputerUseState {
  status: ComputerUseStatus;
  permissions: readonly ComputerUsePermission[];
  message: string | null;
}

/**
 * The application the user drags into a System Settings list, as the help window draws it.
 *
 * macOS grants a permission to an application bundle, and the list in System Settings does not
 * always offer the one that asked. Dragging the bundle in is the way past that, so the window has
 * to show the user the same name and icon the list will show - which in a development build is
 * Electron, not OpenBot. `null` where there is no bundle to drag: every system that is not macOS,
 * and a build that runs from a directory rather than an application.
 */
export interface ComputerUsePermissionApp {
  name: string;
  iconDataUrl: string | null;
}

/**
 * Where the rim is drawn inside the overlay window, and what it is drawn around.
 *
 * The overlay covers the whole desktop and never moves, so the rectangle here - in the overlay's
 * own pixels, from its top-left corner - is the only thing that follows the window an agent works
 * in. Sending it costs a repaint, where moving the overlay would cost a window move on every
 * frame the user drags the target.
 */
export interface ComputerUseHighlightPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The corner radius of the window under the rim, so the rim follows that window's shape. */
  cornerRadius: number;
  /** Which application window the agent works in, for the screen reader. Never logged. */
  windowTitle: string;
  /**
   * Where OpenBot draws the agent cursor, or `null` when it draws none.
   *
   * The driver draws a cursor of its own, and two cursors for one agent say two places. So this
   * carries a point only while the driver draws nothing, and only while the agent's last action is
   * recent enough to still say where it works.
   */
  cursor: ComputerUseCursorPoint | null;
  /**
   * The parts of the rim that a window in front of the marked one covers, which are cut out of it.
   *
   * The overlay floats over every window, because macOS keeps no window of one application between
   * two windows of another. Drawn as it is, the rim would lie over whatever covers the window it
   * marks and read as a rim around that other window instead. These rectangles say where the rim
   * has to give way, and they never overlap each other, so cutting them out takes one rule.
   */
  covered: readonly ComputerUseCoveredArea[];
}

/** A rectangle of the rim another window covers, in the overlay's own pixels. */
export interface ComputerUseCoveredArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A point in the overlay's own pixels, from its top-left corner, like the rim above. */
export interface ComputerUseCursorPoint {
  x: number;
  y: number;
}

/**
 * One chat that is open in its own window as well as in the main window (#2964). The main window
 * keeps the chat; closing the extra window closes only the window.
 */
export interface ChatWindowTarget {
  serverId: string;
  agentId: string;
}

/**
 * The messages that the user sent to agents on this computer, from the database. The social toast
 * reads it, so a user who used OpenBot before the toast shipped gets it on time.
 */
export interface SentMessageStats {
  /** When the first message was written, as ISO 8601 text, or null before the first message. */
  firstSentAt: string | null;
  sentCount: number;
}

export type ExternalDestination =
  | "opencode-install"
  | "opencode-auth"
  | "agent-setup"
  | "claude-install"
  | "hermes-install"
  | "feedback"
  // The GitHub bug report form, from the Help menu, with the version and the system filled in.
  | "report-problem"
  | "message"
  // The release notes, the guides and the Discord community of OpenBot, from the Help menu of the window rail.
  // The community card of the sidebar also opens Discord.
  | "changelog"
  | "guides"
  | "discord"
  // The OpenBot repository, from the toast that asks for a GitHub star.
  | "github"
  // The OpenBot account on X, from the community card of the sidebar and the social toast.
  | "x"
  // The OpenBot profiles and community that the social toast asks the user to follow or join.
  | "threads"
  | "instagram"
  | "tiktok"
  | "facebook"
  | "linkedin"
  | "reddit"
  // The pages that start a post about OpenBot, from the social toast. Main writes the first post
  // in the app language.
  | "x-post"
  | "threads-post"
  | "linkedin-post"
  | "reddit-post"
  | "facebook-post"
  | "instagram-post"
  | "tiktok-post"
  // The x.ai marketplace listing of the Grok Bot agent that exports agents for OpenBot.
  | "grok-bot-export"
  // The email for a hosted server plan that the add server dialog does not have, such as a Mac.
  | "hosted-server-contact"
  // Not a page: the macOS pane that grants OpenBot screen recording. It is here rather than behind
  // its own endpoint because the destination is still a fixed address the renderer only names.
  | "mac-screen-recording";
