// What main answers for the app shell, the account, the updater, notifications, voice, exports,
// hosted sites, hosted servers, custom providers and remote desktop.
//
// Each decoder checks every field the contract type requires and keeps each optional field it
// carries, so a value the renderer reads always has the shape its type says.

import { isAgentTemplateId } from "@openbot/contracts/agent-template-links";
import { type BillingState, parseBillingState } from "@openbot/contracts/billing";
import {
  type HostedServerCatalog,
  type HostedServerList,
  type HostedServerSummary,
  parseHostedServerCatalog,
  parseHostedServerList,
  parseHostedServerSummary,
} from "@openbot/contracts/hosted-servers";
import { parseHostedSiteList, parseHostedSiteSummary } from "@openbot/contracts/hosted-sites";
import {
  type AccountSession,
  type AgentMemoryLimitPreference,
  type AnalyticsPreference,
  type AppInfo,
  type AppLanguagePreference,
  type AppLogoColorPreference,
  type ApprovalAutomationPreference,
  type AppSetupState,
  type BitwardenConnectorStatus,
  type BusyMessageModePreference,
  type CentralAuthIssue,
  type CentralAuthState,
  type CentralAuthUser,
  type CustomAgentCheckResult,
  type CustomAgentResult,
  type CustomAgentSummary,
  type CustomProviderResult,
  type CustomProviderSummary,
  type DetectedAcpAgent,
  type DetectedModelServer,
  type DiscoverModelsResult,
  decodeScheduledUpdateRestart,
  type ExportResult,
  type GitHubConnectorRepositories,
  type GitHubConnectorStatus,
  type HostedSiteList,
  type HostedSiteSummary,
  IDLE_RESTART_TARGETS,
  type IdleRestart,
  isAgentMemoryLimit,
  isAgentModel,
  isAgentProvider,
  isAppLanguage,
  isAppLogoColor,
  isApprovalAutomationPreference,
  isBusyMessageMode,
  isCustomAgentCheckResult,
  isCustomAgentResult,
  isCustomAgentSummary,
  isCustomProviderResult,
  isCustomProviderSummary,
  isDetectedAcpAgent,
  isDetectedModelServer,
  isDiscoverModelsResult,
  isProviderDetectionSettings,
  isRemoteDesktopSetupStatus,
  isRemoteDesktopTestStatus,
  type MobileConnectedDevice,
  type MobileConnectTicket,
  type NotificationOpenedEvent,
  type NotificationPreference,
  type OnePasswordConnectorStatus,
  type ProviderDetectionSettings,
  parseGitHubConnectorRepositories,
  parseGitHubConnectorStatus,
  parseOnePasswordConnectorStatus,
  type RemoteDesktopSetupStatus,
  type RemoteDesktopTestStatus,
  type RemoteSessionReusePreference,
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

export function decodeBusyMessageModePreference(value: unknown): BusyMessageModePreference {
  const preference = decodeRecord(value, "busy message mode preference");
  if (!isBusyMessageMode(preference.mode)) throw new Error("Invalid busy message mode.");
  return { mode: preference.mode };
}

export function decodeAgentMemoryLimitPreference(value: unknown): AgentMemoryLimitPreference {
  const preference = decodeRecord(value, "agent memory limit preference");
  if (!isAgentMemoryLimit(preference.limit)) throw new Error("Invalid agent memory limit.");
  return { limit: preference.limit };
}

export function decodeAppLanguagePreference(value: unknown): AppLanguagePreference {
  const preference = decodeRecord(value, "language preference");
  if (!isAppLanguage(preference.language)) throw new Error("Invalid language.");
  return { language: preference.language };
}

export function decodeAppLogoColorPreference(value: unknown): AppLogoColorPreference {
  const preference = decodeRecord(value, "logo color preference");
  if (!isAppLogoColor(preference.color)) throw new Error("Invalid logo color.");
  return { color: preference.color };
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
  const { phase, errorCode, managedByHost, scheduledRestart, idleRestart } = status;
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
    ...(scheduledRestart === undefined ? {} : { scheduledRestart: decodeScheduledUpdateRestart(scheduledRestart) }),
    ...(idleRestart === undefined ? {} : { idleRestart: decodeIdleRestart(idleRestart) }),
  };
}

function decodeIdleRestart(value: unknown): IdleRestart {
  const restart = decodeRecord(value, "idle restart");
  const { target, waitingFor, error } = restart;
  if (!isOneOf(IDLE_RESTART_TARGETS, target)) throw new Error("Invalid target.");
  if (!Array.isArray(waitingFor) || !waitingFor.every(isString)) throw new Error("Invalid waitingFor.");
  if (error !== undefined && !isString(error)) throw new Error("Invalid error.");
  return { target, waitingFor: [...waitingFor], ...(error === undefined ? {} : { error }) };
}

export function decodeUpdatePreference(value: unknown): UpdatePreference {
  const preference = decodeRecord(value, "update preference");
  return {
    autoDownload: requiredBoolean(preference, "autoDownload"),
    allowRemoteUpdates: requiredBoolean(preference, "allowRemoteUpdates"),
    autoInstall: requiredBoolean(preference, "autoInstall"),
  };
}

export function decodeRemoteSessionReusePreference(value: unknown): RemoteSessionReusePreference {
  return {
    keepBetweenRuns: requiredBoolean(decodeRecord(value, "remote session preference"), "keepBetweenRuns"),
  };
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

// The same check for an agent link: the id began in a URL a web page chose.
export function decodePendingAgentTemplate(value: unknown): string | null {
  return typeof value === "string" && isAgentTemplateId(value) ? value : null;
}

/** The export skill's text, shown for the user to copy. It is Markdown, never markup. */
export function decodeAgentImportSkill(value: unknown): string {
  if (!isString(value) || !value) throw new Error("Invalid export skill response.");
  return value;
}

export const decodeVoid = emptyDecoder("IPC returned unexpected data.");

export function decodeHostedSite(value: unknown): HostedSiteSummary {
  const site = parseHostedSiteSummary(value);
  if (!site) throw new Error("Invalid hosted site response.");
  return site;
}

export function decodeHostedSiteList(value: unknown): HostedSiteList {
  const list = parseHostedSiteList(value);
  if (!list) throw new Error("Invalid hosted site list response.");
  return list;
}

export function decodeGitHubConnectorStatus(value: unknown): GitHubConnectorStatus {
  const status = parseGitHubConnectorStatus(value);
  if (!status) throw new Error("Invalid GitHub connector response.");
  return status;
}

export function decodeGitHubConnectorRepositories(value: unknown): GitHubConnectorRepositories {
  const repositories = parseGitHubConnectorRepositories(value);
  if (!repositories) throw new Error("Invalid GitHub repository list response.");
  return repositories;
}

export function decodeOnePasswordConnectorStatus(value: unknown): OnePasswordConnectorStatus {
  const status = parseOnePasswordConnectorStatus(value);
  if (!status) throw new Error("Invalid 1Password connector response.");
  return status;
}

export function decodeBillingState(value: unknown): BillingState {
  const state = parseBillingState(value);
  if (!state) throw new Error("Invalid billing state response.");
  return state;
}

export function decodeHostedServer(value: unknown): HostedServerSummary {
  const server = parseHostedServerSummary(value);
  if (!server) throw new Error("Invalid hosted server response.");
  return server;
}

export function decodeHostedServerCatalog(value: unknown): HostedServerCatalog {
  const catalog = parseHostedServerCatalog(value);
  if (!catalog) throw new Error("Invalid hosted server plans response.");
  return catalog;
}

export function decodeHostedServerList(value: unknown): HostedServerList {
  const list = parseHostedServerList(value);
  if (!list) throw new Error("Invalid hosted server list response.");
  return list;
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

/** Fails closed on the whole list, like `decodeCustomProviders`: a scan row never carries a key. */
export function decodeDetectedModelServers(value: unknown): DetectedModelServer[] {
  if (!Array.isArray(value) || !value.every(isDetectedModelServer)) {
    throw new Error("Invalid model server list response.");
  }
  return value;
}

/** Fails closed on the whole list: a scan row never carries an environment value. */
export function decodeDetectedAcpAgents(value: unknown): DetectedAcpAgent[] {
  if (!Array.isArray(value) || !value.every(isDetectedAcpAgent)) {
    throw new Error("Invalid agent list response.");
  }
  return value;
}

/**
 * The guard, as for the endpoints: it is the assertion that a summary carries no environment value,
 * and it fails closed on the whole list.
 */
export function decodeCustomAgents(value: unknown): CustomAgentSummary[] {
  if (!Array.isArray(value) || !value.every(isCustomAgentSummary)) {
    throw new Error("Invalid custom agent list response.");
  }
  return value;
}

export function decodeCustomAgentResult(value: unknown): CustomAgentResult {
  if (!isCustomAgentResult(value)) throw new Error("Invalid custom agent response.");
  return value;
}

export function decodeCustomAgentCheckResult(value: unknown): CustomAgentCheckResult {
  if (!isCustomAgentCheckResult(value)) throw new Error("Invalid agent check response.");
  return value;
}

export function decodeDiscoverModelsResult(value: unknown): DiscoverModelsResult {
  if (!isDiscoverModelsResult(value)) throw new Error("Invalid model list response.");
  return value;
}

export function decodeProviderDetectionSettings(value: unknown): ProviderDetectionSettings {
  if (!isProviderDetectionSettings(value)) throw new Error("Invalid detection settings response.");
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

export function decodeBitwardenConnectorStatus(value: unknown): BitwardenConnectorStatus {
  if (!value || typeof value !== "object" || !("connected" in value) || typeof value.connected !== "boolean")
    throw new Error("Invalid Bitwarden connector response.");
  return { connected: value.connected };
}
