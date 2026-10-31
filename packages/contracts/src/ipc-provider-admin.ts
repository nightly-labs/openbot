/**
 * The replies of a host's `providers-v1` to `providers-v4` and `provider-host-sign-in-v1` routes, as the
 * desktop main process and the browser client both read them. The route codec has already checked
 * their fields; these give them their IPC types and fail closed on anything else.
 */

import { isAgentProvider } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import {
  type AccountUsage,
  type HostProviderAccounts,
  isAccountUsage,
  isProviderAccountId,
  isProviderAccountStatus,
  MAX_PROVIDER_ACCOUNTS,
  PROVIDER_USAGE_RESET_OUTCOMES,
  type ProviderApiKeyStatus,
  type ProviderCodeLoginStart,
  type ProviderHostSignInStatus,
  type ProviderRelaySignInStatus,
  type ProviderUsageResetOutcome,
  type ProviderUsageResets,
} from "./ipc-agent-status";
import type { ProviderRuntimeSnapshot, ProviderRuntimeStatus } from "./ipc-app-auth";
import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import {
  CUSTOM_AGENT_LIMITS,
  type CustomAgentResult,
  type CustomAgentSummary,
  isCustomAgentResult,
  isCustomAgentSummary,
} from "./ipc-custom-agents";
import {
  type CustomProviderResult,
  type CustomProviderSummary,
  isCustomProviderResult,
  isCustomProviderSummary,
} from "./ipc-custom-providers";
import { decodeMcpSignInRelayPage } from "./ipc-mcp-servers";
import { isDynamicRecord, isHttpsUrl, isNumber, isOneOf, isString } from "./runtime-values";
import { PROVIDER_HOST_SIGN_IN_ERROR_LIMIT } from "./team-protocol/provider-host-sign-in-v1";

/** Each URL becomes a link the admin opens, so it is held to https here as well. */
export function decodeProviderCodeLoginStart(value: unknown): ProviderCodeLoginStart {
  if (!isDynamicRecord(value)) throw new Error("Invalid code login.");
  if (value.kind === "connected") return { kind: "connected" };
  if (!isHttpsUrl(value.verificationUrl) || !isNumber(value.expiresAt)) throw new Error("Invalid code login.");
  if (value.kind === "paste" || value.kind === "link")
    return { kind: value.kind, verificationUrl: value.verificationUrl, expiresAt: value.expiresAt };
  if (
    value.kind !== "code" ||
    !isString(value.userCode) ||
    (value.verificationUrlComplete !== undefined && !isHttpsUrl(value.verificationUrlComplete))
  )
    throw new Error("Invalid code login.");
  return {
    kind: "code",
    userCode: value.userCode,
    verificationUrl: value.verificationUrl,
    ...(value.verificationUrlComplete === undefined ? {} : { verificationUrlComplete: value.verificationUrlComplete }),
    expiresAt: value.expiresAt,
  };
}

export function decodeProviderHostSignInStatus(value: unknown): ProviderHostSignInStatus {
  const invalid = () => new Error("Invalid sign-in response.");
  if (!isDynamicRecord(value) || (value.tabId !== null && !isBoundedString(value.tabId, INPUT_LIMITS.identifier)))
    throw invalid();
  if (value.result === null) return { tabId: value.tabId, result: null };
  if (!isDynamicRecord(value.result) || !isNullableBoundedString(value.result.error, PROVIDER_HOST_SIGN_IN_ERROR_LIMIT))
    throw invalid();
  return { tabId: value.tabId, result: { error: value.result.error } };
}

/** A provider this client does not know is left out, as the host's status leaves it out. */
export function decodeHostProviderAccounts(value: unknown): HostProviderAccounts {
  const invalid = () => new Error("Invalid provider accounts.");
  if (!isDynamicRecord(value) || !Array.isArray(value.providers) || !Array.isArray(value.agents)) throw invalid();
  const providers = value.providers.flatMap((row: unknown) => {
    if (
      !isDynamicRecord(row) ||
      !Array.isArray(row.accounts) ||
      row.accounts.length > MAX_PROVIDER_ACCOUNTS ||
      !row.accounts.every(isProviderAccountStatus)
    )
      throw invalid();
    return isAgentProvider(row.provider) ? [{ provider: row.provider, accounts: row.accounts }] : [];
  });
  const agents = value.agents.map((row: unknown) => {
    if (!isDynamicRecord(row) || !isIdentifier(row.agentId) || !isProviderAccountId(row.accountId)) throw invalid();
    return { agentId: row.agentId, accountId: row.accountId };
  });
  return { providers, agents };
}

/** Each reading names its account: the released usage routes give the provider's own sign-in. */
export function decodeHostProviderAccountUsage(value: unknown): AccountUsage {
  if (!isAccountUsage(value) || value.limits.some((limit) => limit.accountId === undefined))
    throw new Error("Invalid provider account usage.");
  return value;
}

/**
 * The `accounts` of a `provider-usage-reset-v1` list, and the IPC answer. A provider this client
 * does not know is left out, as the host's status leaves it out.
 */
export function decodeProviderUsageResets(value: unknown): ProviderUsageResets[] {
  const invalid = () => new Error("Invalid provider usage resets.");
  if (!Array.isArray(value)) throw invalid();
  return value.flatMap((row: unknown) => {
    if (
      !isDynamicRecord(row) ||
      !isProviderAccountId(row.accountId) ||
      !isNumber(row.available) ||
      !Number.isInteger(row.available) ||
      row.available < 0
    )
      throw invalid();
    return isAgentProvider(row.provider)
      ? [{ provider: row.provider, accountId: row.accountId, available: row.available }]
      : [];
  });
}

/** The `outcome` of a `provider-usage-reset-v1` consume, and the IPC answer. */
export function decodeProviderUsageResetOutcome(value: unknown): ProviderUsageResetOutcome {
  if (!isOneOf(PROVIDER_USAGE_RESET_OUTCOMES, value)) throw new Error("Invalid provider usage reset.");
  return value;
}

export function decodeProviderRelaySignInStatus(value: unknown): ProviderRelaySignInStatus {
  const invalid = () => new Error("Invalid sign-in response.");
  if (!isDynamicRecord(value)) throw invalid();
  const page = decodeMcpSignInRelayPage(value.page ?? null);
  if (value.result === null) return { page, result: null };
  if (!isDynamicRecord(value.result) || !isNullableBoundedString(value.result.error, PROVIDER_HOST_SIGN_IN_ERROR_LIMIT))
    throw invalid();
  return { page, result: { error: value.result.error } };
}

export function decodeProviderApiKeyStatus(value: unknown): ProviderApiKeyStatus {
  if (!isDynamicRecord(value) || !isOneOf(["missing", "saved", "unreadable"] as const, value.status))
    throw new Error("Invalid provider key state.");
  return value.status;
}

function decodeProviderRuntimeStatus(value: unknown): ProviderRuntimeStatus {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(["not-downloaded", "downloading", "finishing", "ready", "download-error"] as const, value.phase) ||
    (value.progress !== null && !isNumber(value.progress)) ||
    (value.message !== null && !isString(value.message)) ||
    (value.version !== null && !isString(value.version)) ||
    (value.availableVersion !== undefined && value.availableVersion !== null && !isString(value.availableVersion))
  ) {
    throw new Error("Invalid provider runtime.");
  }
  return {
    phase: value.phase,
    progress: value.progress,
    message: value.message,
    version: value.version,
    availableVersion: value.availableVersion ?? null,
  };
}

export function decodeProviderRuntimeSnapshot(value: unknown): ProviderRuntimeSnapshot {
  if (
    !isDynamicRecord(value) ||
    !isNumber(value.revision) ||
    !isDynamicRecord(value.providers) ||
    !isDynamicRecord(value.toolRuntimes)
  ) {
    throw new Error("Invalid provider runtimes.");
  }
  const { providers, toolRuntimes } = value;
  return {
    revision: value.revision,
    providers: {
      pi:
        providers.pi === undefined
          ? { phase: "not-downloaded", progress: null, message: null, version: null, availableVersion: null }
          : decodeProviderRuntimeStatus(providers.pi),
      muse:
        providers.muse === undefined
          ? { phase: "not-downloaded", progress: null, message: null, version: null, availableVersion: null }
          : decodeProviderRuntimeStatus(providers.muse),
      codex: decodeProviderRuntimeStatus(providers.codex),
      claude: decodeProviderRuntimeStatus(providers.claude),
      grok: decodeProviderRuntimeStatus(providers.grok),
      opencode: decodeProviderRuntimeStatus(providers.opencode),
      // `providers-v1` has no Gemini entry, and this client cannot download Gemini on that host, so
      // the status is "not downloaded". `providers-v2` has one.
      antigravity:
        providers.antigravity === undefined
          ? { phase: "not-downloaded", progress: null, message: null, version: null, availableVersion: null }
          : decodeProviderRuntimeStatus(providers.antigravity),
      // Only `providers-v4` carries Cursor and Cline; on an older host this client cannot download them.
      cursor:
        providers.cursor === undefined
          ? { phase: "not-downloaded", progress: null, message: null, version: null, availableVersion: null }
          : decodeProviderRuntimeStatus(providers.cursor),
      cline:
        providers.cline === undefined
          ? { phase: "not-downloaded", progress: null, message: null, version: null, availableVersion: null }
          : decodeProviderRuntimeStatus(providers.cline),
    },
    toolRuntimes: { bun: decodeProviderRuntimeStatus(toolRuntimes.bun) },
  };
}

/**
 * The `providers-v8` snapshot, in which each runtime is a row keyed by `id`. The rows become the
 * record that the IPC snapshot has, and `decodeProviderRuntimeSnapshot` checks them. The IPC record
 * is closed, so a row for a provider that this build does not know is not kept: this client cannot
 * download it. The host status still names that provider.
 */
export function decodeProviderRuntimeSnapshotV8(value: unknown): ProviderRuntimeSnapshot {
  if (!isDynamicRecord(value) || !Array.isArray(value.providers) || !Array.isArray(value.toolRuntimes))
    throw new Error("Invalid provider runtimes.");
  return decodeProviderRuntimeSnapshot({
    revision: value.revision,
    providers: Object.fromEntries(runtimeRows(value.providers)),
    toolRuntimes: Object.fromEntries(runtimeRows(value.toolRuntimes)),
  });
}

function runtimeRows(rows: readonly unknown[]): Map<string, unknown> {
  const byId = new Map<string, unknown>();
  for (const row of rows) {
    if (!isDynamicRecord(row) || !isString(row.id) || byId.has(row.id)) throw new Error("Invalid provider runtimes.");
    byId.set(row.id, row);
  }
  return byId;
}

// The contract guard asserts that a summary carries no key, and fails closed on the whole list.
export function decodeCustomProviderSummaries(value: unknown): CustomProviderSummary[] {
  if (!Array.isArray(value) || !value.every(isCustomProviderSummary)) throw new Error("Invalid custom providers.");
  return value;
}

/** `custom-agents-v1`: the list fails closed, as the local list does. */
export function decodeCustomAgentSummaries(value: unknown): CustomAgentSummary[] {
  if (!Array.isArray(value) || value.length > CUSTOM_AGENT_LIMITS.agents || !value.every(isCustomAgentSummary))
    throw new Error("Invalid custom agents.");
  return value;
}

export function decodeCustomAgentResult(value: unknown): CustomAgentResult {
  if (!isCustomAgentResult(value)) throw new Error("Invalid custom agent result.");
  return value;
}

export function decodeCustomProviderResult(value: unknown): CustomProviderResult {
  if (!isCustomProviderResult(value)) throw new Error("Invalid custom provider result.");
  return value;
}
