import type { InstallerProviderId, ManagedProviderId, ManagedToolRuntimeId } from "./agent-providers";
import type { AboveAppsSupport } from "./ipc-agent-dock";
import type { AgentModelId, AvatarColor } from "./ipc-agent-identity";
import type { AgentProviderId } from "./ipc-agent-status";
import { integerInRange, isFiniteNumber, isIdentifier } from "./ipc-bounded-values";
import { decodeRecord, nullableNumber, requiredBoolean, requiredNumber, requiredString } from "./ipc-decoding";
import { isDynamicRecord, isString } from "./runtime-values";

export type DesktopPlatform = "darwin" | "win32" | "linux";
export type AppVariant = "production" | "dev" | "preview";
export type HourCycle = "h12" | "h23";

export interface AppInfo {
  name: string;
  version: string;
  platform: DesktopPlatform;
  variant: AppVariant;
  analyticsCaptureUrl?: string;
  analyticsInstallId?: string;
  softwareRendering?: boolean;
  hourCycle?: HourCycle;
  aboveAppsSupport?: AboveAppsSupport;
  dynamicIslandUnavailable?: boolean;
}

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

export const UPDATE_BUSY_PHASES = ["checking", "downloading", "installing"] as const satisfies readonly UpdatePhase[];

export type UpdateBusyPhase = (typeof UPDATE_BUSY_PHASES)[number];

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
  managedByHost?: boolean;
  scheduledRestart?: ScheduledUpdateRestart;
  idleRestart?: IdleRestart;
  stagedVersion?: string;
  requiredVersion?: string;
}

export const IDLE_RESTART_TARGETS = ["relaunch", "update"] as const;
export type IdleRestartTarget = (typeof IDLE_RESTART_TARGETS)[number];

export interface IdleRestart {
  target: IdleRestartTarget;
  waitingFor: string[];
  error?: string;
}

export const UPDATE_FAILURE_CODES = ["check_failed", "download_failed", "install_failed"] as const;
export type UpdateFailureCode = (typeof UPDATE_FAILURE_CODES)[number];

export interface UpdatePreference {
  autoDownload: boolean;
  allowRemoteUpdates: boolean;
  autoInstall: boolean;
}

export type UpdatePreferenceChange = Partial<UpdatePreference>;

export const UPDATE_RESTART_MODES = ["when-idle", "now"] as const;
export type UpdateRestartMode = (typeof UPDATE_RESTART_MODES)[number];

export interface ScheduledUpdateRestart {
  requestedBy: string | null;
  mode: UpdateRestartMode;
  waitingFor: string[];
}

export const REMOTE_UPDATES_STATES = ["allowed", "disabled", "managed"] as const;
export type RemoteUpdatesState = (typeof REMOTE_UPDATES_STATES)[number];

export interface HostUpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  progress: number | null;
  errorCode: UpdateFailureCode | null;
  remoteUpdates: RemoteUpdatesState;
  autoDownload: boolean;
  autoInstall: boolean;
  restart: ScheduledUpdateRestart | null;
}

export type HostUpdateSettingsChange = Partial<Pick<UpdatePreference, "autoDownload" | "autoInstall">>;

export type ProviderRuntimePhase = "not-downloaded" | "downloading" | "finishing" | "ready" | "download-error";

export interface ProviderRuntimeStatus {
  availableVersion?: string | null;
  phase: ProviderRuntimePhase;
  progress: number | null;
  message: string | null;
  version: string | null;
}

export interface ProviderRuntimeSnapshot {
  revision: number;
  providers: Record<ManagedProviderId, ProviderRuntimeStatus> & InstallerRuntimeStatuses;
  toolRuntimes: Record<ManagedToolRuntimeId, ProviderRuntimeStatus>;
}

export type InstallerRuntimeStatuses = { [Provider in InstallerProviderId]?: ProviderRuntimeStatus };

export interface ExportResult {
  saved: boolean;
}

export interface AppSetupState {
  completed: boolean;
  preferredProvider: AgentProviderId | null;
  preferredModel: AgentModelId | null;
}

export interface SaveSetupInput {
  preferredProvider: AgentProviderId;
  preferredModel: AgentModelId | null;
}

export type HostDefaultProvider = Pick<AppSetupState, "preferredProvider" | "preferredModel">;

export interface AnalyticsPreference {
  enabled: boolean;
}

export const RENDERER_TIMING_LIMITS = {
  longTasks: 10_000,
  inputs: 100_000,
  inputDelays: 64,
  inputDelayMs: 600_000,
} as const;

export interface RendererTimingReport {
  workspaceReady?: true;
  longTasks: number;
  inputs: number;
  inputDelaysMs: number[];
}

export interface SetAnalyticsPreferenceInput {
  enabled: boolean;
  chosen?: boolean;
}

export interface CentralAuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  analyticsEnabled?: boolean | null;
  chatColor?: AvatarColor | null;
}

export interface CentralAuthIssue {
  code: string;
  message: string;
  retryAfterSeconds?: number;
  reference?: string;
}

export type CentralAuthSignedOutReason = "keyring_changed";

export type CentralAuthState =
  | { status: "loading" }
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
  | { status: "company_sign_in"; email: string; issue?: CentralAuthIssue | undefined }
  | { status: "signed_in"; user: CentralAuthUser }
  | { status: "error"; issue: CentralAuthIssue };

export interface CompanySignInConnection {
  issuer: string;
  clientId: string;
  domains: string[];
  enabled: boolean;
  testedAt: number;
  scimTokenCreatedAt: number | null;
}

export interface CompanySignInSettings {
  redirectUri: string;
  scimUrl: string;
  domainRecord: { name: string; value: string };
  domainCheck: boolean;
  connection: CompanySignInConnection | null;
}

export interface TestCompanySignInInput {
  serverId: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  domains: string[];
}

export interface TestCompanySignInResult {
  email: string;
}

export interface SetCompanySignInEnabledInput {
  serverId: string;
  enabled: boolean;
}

export interface CompanySignInScimToken {
  token: string;
  createdAt: number;
}

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

export interface VerifyEmailCodeInput {
  challengeId: string;
  code: string;
  referralCode?: string;
}

export type MacPermissionId = "screen-recording" | "accessibility";

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

export interface MacAutomationResult {
  target: MacAutomationTarget;
  status: (typeof MAC_AUTOMATION_STATUSES)[number];
}

export interface BackgroundProcess {
  id: string;
  pid: number;
  command: string;
  startedAt: number;
  ports: number[];
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

export const COMPUTER_USE_STATUSES = [
  "unsupported",
  "driver-missing",
  "permissions-required",
  "restart-required",
  "ready",
  "error",
] as const;

export type ComputerUseStatus = (typeof COMPUTER_USE_STATUSES)[number];

export interface ComputerUsePermission {
  id: MacPermissionId;
  granted: boolean;
}

export interface ComputerUseState {
  status: ComputerUseStatus;
  permissions: readonly ComputerUsePermission[];
  message: string | null;
}

export interface ComputerUsePermissionApp {
  name: string;
  iconDataUrl: string | null;
}

export interface ComputerUseHighlightPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius: number;
  windowTitle: string;
  cursor: ComputerUseCursorPoint | null;
  covered: readonly ComputerUseCoveredArea[];
}

export interface ComputerUseCoveredArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputerUseCursorPoint {
  x: number;
  y: number;
}

export interface ChatWindowTarget {
  serverId: string;
  agentId: string;
}

export interface WindowFrameState {
  buttons: boolean;
  maximized: boolean;
}

export interface SentMessageStats {
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
  | "report-problem"
  | "message"
  | "changelog"
  | "guides"
  | "discord"
  | "github"
  | "x"
  | "threads"
  | "instagram"
  | "tiktok"
  | "facebook"
  | "linkedin"
  | "reddit"
  | "x-post"
  | "threads-post"
  | "linkedin-post"
  | "reddit-post"
  | "facebook-post"
  | "instagram-post"
  | "tiktok-post"
  | "grok-bot-export"
  | "hosted-server-contact"
  | "download"
  | "chrome-extension"
  | "mac-screen-recording";
