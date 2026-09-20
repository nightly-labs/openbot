import type { ManagedProviderId, ManagedToolRuntimeId } from "./agent-providers";
import type { AgentModelId } from "./ipc-agent-identity";
import type { AgentProviderId } from "./ipc-agent-status";
import type { AvatarImageInput } from "./ipc-agents";
import type { AccountSession, MobileConnectedDevice, MobileConnectTicket } from "./mobile-connect";

export type DesktopPlatform = "darwin" | "win32" | "linux";
export type AppVariant = "production" | "dev" | "preview";

export interface AppInfo {
  name: string;
  version: string;
  platform: DesktopPlatform;
  variant: AppVariant;
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
}

export type UpdateFailureCode = "check_failed" | "download_failed" | "install_failed";

export interface UpdatePreference {
  autoDownload: boolean;
}

export type ProviderRuntimePhase = "not-downloaded" | "downloading" | "finishing" | "ready" | "download-error";

export interface ProviderRuntimeStatus {
  /** Newer managed version pinned by this OpenBot release, when an older install exists. */
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
  providers: Record<ManagedProviderId, ProviderRuntimeStatus>;
  /**
   * The tool runtimes, in a field of their own rather than mixed in above.
   *
   * These are downloaded for the MCP servers, not for an agent: nothing signs in to one, nothing
   * picks a model on one, and the provider cards must not grow an entry for one. Required, so a
   * reader that needs the status of a managed tool cannot silently read `undefined` instead.
   */
  toolRuntimes: Record<ManagedToolRuntimeId, ProviderRuntimeStatus>;
}

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

export interface AnalyticsPreference {
  enabled: boolean;
}

export interface SetAnalyticsPreferenceInput {
  enabled: boolean;
}

export interface CentralAuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface CentralAuthIssue {
  code: string;
  message: string;
  retryAfterSeconds?: number;
}

export type CentralAuthState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signing_in" }
  | {
      status: "code_sent";
      challengeId: string;
      email: string;
      expiresAt: number;
      resendAvailableAt: number;
      developmentCode?: string;
      issue?: CentralAuthIssue;
    }
  | { status: "signed_in"; user: CentralAuthUser }
  | { status: "error"; issue: CentralAuthIssue };

export interface CentralAuthDesktopApi {
  getState: () => Promise<CentralAuthState>;
  retry: () => Promise<CentralAuthState>;
  requestEmailCode: (email: string) => Promise<CentralAuthState>;
  verifyEmailCode: (challengeId: string, code: string) => Promise<CentralAuthState>;
  updateName: (name: string) => Promise<CentralAuthState>;
  updateAvatar: (image: AvatarImageInput | null) => Promise<CentralAuthState>;
  createMobileConnect: () => Promise<MobileConnectTicket>;
  listMobileConnectedDevices: () => Promise<MobileConnectedDevice[]>;
  listAccountSessions: () => Promise<AccountSession[]>;
  revokeAccountSession: (sessionId: string) => Promise<void>;
  revokeMobileConnectedDevice: (sessionId: string) => Promise<void>;
  logout: () => Promise<CentralAuthState>;
  onEvent: (listener: (state: CentralAuthState) => void) => () => void;
}

export type MacPermissionId = "screen-recording" | "accessibility";

/**
 * How far Computer Use is from working, as one value the panel switches on.
 *
 * `driver-missing` and `permissions-required` are both "not yet", and they are separate because the
 * user's next action differs: one installs a program, the other opens System Settings. `error` is
 * what the panel shows when the driver is there and answered with something else, which a status
 * that only said "not ready" would hide.
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

export type ExternalDestination =
  | "opencode-install"
  | "opencode-auth"
  | "agent-setup"
  | "claude-install"
  | "feedback"
  | "message"
  // Not a page: the macOS pane that grants OpenBot screen recording. It is here rather than behind
  // its own endpoint because the destination is still a fixed address the renderer only names.
  | "mac-screen-recording";
