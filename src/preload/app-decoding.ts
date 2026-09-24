// What main answers for the app shell, the account, the updater, notifications, voice, exports,
// hosted sites, custom providers and remote desktop.
//
// Each decoder checks every field the contract type requires and keeps each optional field it
// carries, so a value the renderer reads always has the shape its type says.

import {
  type AccountSession,
  type AnalyticsPreference,
  type AppInfo,
  type AppLanguagePreference,
  type ApprovalAutomationPreference,
  type AppSetupState,
  type CentralAuthIssue,
  type CentralAuthState,
  type CentralAuthUser,
  type CustomProviderResult,
  type CustomProviderSummary,
  type ExportResult,
  type HostedSiteSummary,
  isAgentModel,
  isAgentProvider,
  isAppLanguage,
  isApprovalAutomationPreference,
  isCustomProviderResult,
  isCustomProviderSummary,
  isRemoteDesktopSetupStatus,
  isRemoteDesktopTestStatus,
  type MobileConnectedDevice,
  type MobileConnectTicket,
  type NotificationOpenedEvent,
  type NotificationPreference,
  type RemoteDesktopSetupStatus,
  type RemoteDesktopTestStatus,
  UPDATE_PHASES,
  type UpdatePreference,
  type UpdateStatus,
  type VoiceModelStatus,
  type VoiceTranscriptionResult,
} from "@openbot/contracts/ipc";
import {
  decodeList,
  decodeRecord,
  emptyDecoder,
  guardedDecoder,
  nullableNumber,
  nullableString,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from "@openbot/contracts/ipc-decoding";
import { isPluginSlug } from "@openbot/contracts/plugin-links";
import { isBoolean, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";

export function decodeAppInfo(value: unknown): AppInfo {
  const info = decodeRecord(value, "app info");
  const { platform, variant } = info;
  if (!isOneOf(["darwin", "win32", "linux"] as const, platform)) throw new Error("Invalid platform.");
  if (!isOneOf(["production", "dev", "preview"] as const, variant)) throw new Error("Invalid variant.");
  return { name: requiredString(info, "name"), version: requiredString(info, "version"), platform, variant };
}

export function decodeAppSetupState(value: unknown): AppSetupState {
  const state = decodeRecord(value, "setup state");
  const { preferredProvider, preferredModel } = state;
  if (preferredProvider !== null && !isAgentProvider(preferredProvider)) throw new Error("Invalid preferredProvider.");
  if (preferredModel !== null && !isAgentModel(preferredModel)) throw new Error("Invalid preferredModel.");
  return { completed: requiredBoolean(state, "completed"), preferredProvider, preferredModel };
}

export function decodeAnalyticsPreference(value: unknown): AnalyticsPreference {
  return { enabled: requiredBoolean(decodeRecord(value, "analytics preference"), "enabled") };
}

export const decodeApprovalAutomationPreference: (value: unknown) => ApprovalAutomationPreference = guardedDecoder(
  isApprovalAutomationPreference,
  "approval automation preference",
);

export function decodeAppLanguagePreference(value: unknown): AppLanguagePreference {
  const preference = decodeRecord(value, "language preference");
  if (!isAppLanguage(preference.language)) throw new Error("Invalid language.");
  return { language: preference.language };
}

export function decodeCentralAuthState(value: unknown): CentralAuthState {
  const state = decodeRecord(value, "account state");
  switch (state.status) {
    case "loading":
    case "signed_out":
    case "signing_in":
      return { status: state.status };
    case "code_sent": {
      const { developmentCode, issue } = state;
      if (developmentCode !== undefined && !isString(developmentCode)) throw new Error("Invalid developmentCode.");
      return {
        status: "code_sent",
        challengeId: requiredString(state, "challengeId"),
        email: requiredString(state, "email"),
        expiresAt: requiredNumber(state, "expiresAt"),
        resendAvailableAt: requiredNumber(state, "resendAvailableAt"),
        ...(developmentCode === undefined ? {} : { developmentCode }),
        ...(issue === undefined ? {} : { issue: decodeCentralAuthIssue(issue) }),
      };
    }
    case "signed_in":
      return { status: "signed_in", user: decodeCentralAuthUser(state.user) };
    case "error":
      return { status: "error", issue: decodeCentralAuthIssue(state.issue) };
    default:
      throw new Error("Invalid account status.");
  }
}

function decodeCentralAuthUser(value: unknown): CentralAuthUser {
  const user = decodeRecord(value, "account user");
  return {
    id: requiredString(user, "id"),
    email: requiredString(user, "email"),
    name: nullableString(user, "name"),
    avatarUrl: nullableString(user, "avatarUrl"),
  };
}

function decodeCentralAuthIssue(value: unknown): CentralAuthIssue {
  const issue = decodeRecord(value, "account issue");
  const { retryAfterSeconds } = issue;
  if (retryAfterSeconds !== undefined && !isNumber(retryAfterSeconds)) throw new Error("Invalid retryAfterSeconds.");
  return {
    code: requiredString(issue, "code"),
    message: requiredString(issue, "message"),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

export function decodeMobileConnectTicket(value: unknown): MobileConnectTicket {
  const ticket = decodeRecord(value, "Mobile Connect ticket");
  return { qrData: requiredString(ticket, "qrData"), expiresAt: requiredNumber(ticket, "expiresAt") };
}

export function decodeMobileConnectedDevices(value: unknown): MobileConnectedDevice[] {
  return decodeList(value, "connected device list", (device) => {
    const { platform } = device;
    if (!isOneOf(["ios", "android", "unknown"] as const, platform)) throw new Error("Invalid platform.");
    return {
      sessionId: requiredString(device, "sessionId"),
      name: requiredString(device, "name"),
      platform,
      connectedAt: requiredNumber(device, "connectedAt"),
      lastActiveAt: requiredNumber(device, "lastActiveAt"),
    };
  });
}

export function decodeAccountSessions(value: unknown): AccountSession[] {
  return decodeList(value, "account session list", (session) => {
    const { kind } = session;
    if (!isOneOf(["desktop", "mobile"] as const, kind)) throw new Error("Invalid kind.");
    return {
      sessionId: requiredString(session, "sessionId"),
      name: requiredString(session, "name"),
      kind,
      current: requiredBoolean(session, "current"),
      connectedAt: requiredNumber(session, "connectedAt"),
      lastActiveAt: requiredNumber(session, "lastActiveAt"),
    };
  });
}

export function decodeUpdateStatus(value: unknown): UpdateStatus {
  const status = decodeRecord(value, "update status");
  const { phase, errorCode, managedByHost } = status;
  if (!isOneOf(UPDATE_PHASES, phase)) throw new Error("Invalid phase.");
  if (errorCode !== null && !isOneOf(["check_failed", "download_failed", "install_failed"] as const, errorCode)) {
    throw new Error("Invalid errorCode.");
  }
  if (managedByHost !== undefined && !isBoolean(managedByHost)) throw new Error("Invalid managedByHost.");
  return {
    phase,
    currentVersion: requiredString(status, "currentVersion"),
    availableVersion: nullableString(status, "availableVersion"),
    progress: nullableNumber(status, "progress"),
    checkedAt: nullableString(status, "checkedAt"),
    message: nullableString(status, "message"),
    errorCode,
    ...(managedByHost === undefined ? {} : { managedByHost }),
  };
}

export function decodeUpdatePreference(value: unknown): UpdatePreference {
  return { autoDownload: requiredBoolean(decodeRecord(value, "update preference"), "autoDownload") };
}

export function decodeNotificationPreference(value: unknown): NotificationPreference {
  return {
    desktopNotifications: requiredBoolean(decodeRecord(value, "notification preference"), "desktopNotifications"),
  };
}

export function decodeNotificationOpenedEvent(value: unknown): NotificationOpenedEvent {
  const opened = decodeRecord(value, "opened notification");
  return {
    serverId: requiredString(opened, "serverId"),
    agentId: requiredString(opened, "agentId"),
    threadId: nullableString(opened, "threadId"),
  };
}

const VOICE_MODEL_PHASES: readonly VoiceModelStatus["phase"][] = ["missing", "downloading", "ready", "error"];

export function decodeVoiceModelStatus(value: unknown): VoiceModelStatus {
  const status = decodeRecord(value, "voice model status");
  const { phase, progress } = status;
  if (!isOneOf(VOICE_MODEL_PHASES, phase) || (progress !== null && !isNumber(progress))) {
    throw new Error("Invalid voice model status.");
  }
  return { phase, progress, message: nullableString(status, "message") };
}

export function decodeVoiceTranscriptionResult(value: unknown): VoiceTranscriptionResult {
  return { text: requiredString(decodeRecord(value, "voice transcription"), "text") };
}

export function decodeExportResult(value: unknown): ExportResult {
  return { saved: requiredBoolean(decodeRecord(value, "export result"), "saved") };
}

// The slug is checked again on arrival rather than trusted because it came from main. It began life
// in a URL a web page chose, and this is the last point before the renderer looks it up.
export function decodePendingListing(value: unknown): string | null {
  return typeof value === "string" && isPluginSlug(value) ? value : null;
}

/** The export skill's text, shown for the user to copy. It is Markdown, never markup. */
export function decodeAgentImportSkill(value: unknown): string {
  if (!isString(value) || !value) throw new Error("Invalid export skill response.");
  return value;
}

export const decodeVoid = emptyDecoder("IPC returned unexpected data.");

export function decodeHostedSite(value: unknown): HostedSiteSummary {
  const site = decodeRecord(value, "hosted site");
  if (
    !isString(site.id) ||
    !isString(site.hostname) ||
    !isString(site.url) ||
    !isString(site.title) ||
    !isString(site.description) ||
    (site.framework !== "vanilla" && site.framework !== "astro") ||
    (site.status !== "active" && site.status !== "deleted" && site.status !== "expired" && site.status !== "blocked") ||
    !isNumber(site.fileCount) ||
    !isNumber(site.size) ||
    (site.expiresAt !== null && !isString(site.expiresAt)) ||
    !isString(site.updatedAt)
  ) {
    throw new Error("Invalid hosted site response.");
  }
  return {
    id: site.id,
    hostname: site.hostname,
    url: site.url,
    title: site.title,
    description: site.description,
    framework: site.framework,
    status: decodeHostedSiteStatus(site.status),
    fileCount: site.fileCount,
    size: site.size,
    expiresAt: site.expiresAt,
    updatedAt: site.updatedAt,
  };
}

function decodeHostedSiteStatus(value: unknown): HostedSiteSummary["status"] {
  if (value === "active" || value === "deleted" || value === "expired" || value === "blocked") return value;
  throw new Error("Invalid hosted site status.");
}

export function decodeHostedSites(value: unknown): HostedSiteSummary[] {
  if (!Array.isArray(value)) throw new Error("Invalid hosted site list response.");
  return value.map(decodeHostedSite);
}

/**
 * The guard, not a decoder of its own: it is the assertion that a summary carries no `apiKey`, and a
 * second implementation here could disagree with it. It fails closed on the whole list, so a main
 * process that ever put a key in a row empties the picker rather than leaking one.
 */
export function decodeCustomProviders(value: unknown): CustomProviderSummary[] {
  if (!Array.isArray(value) || !value.every(isCustomProviderSummary)) {
    throw new Error("Invalid custom provider list response.");
  }
  return value;
}

export function decodeCustomProviderResult(value: unknown): CustomProviderResult {
  if (!isCustomProviderResult(value)) throw new Error("Invalid custom provider response.");
  return value;
}

export function decodeNullablePath(value: unknown): string | null {
  if (value !== null && !isString(value)) throw new Error("Invalid directory response.");
  return value;
}

export function decodeRemoteDesktopSetupFromMain(value: unknown): RemoteDesktopSetupStatus {
  if (!isRemoteDesktopSetupStatus(value)) throw new Error("Invalid remote desktop setup response.");
  return { ...value };
}
export function decodeRemoteDesktopTestFromMain(value: unknown): RemoteDesktopTestStatus {
  if (!isRemoteDesktopTestStatus(value)) throw new Error("Invalid remote desktop test response.");
  return { ...value };
}
