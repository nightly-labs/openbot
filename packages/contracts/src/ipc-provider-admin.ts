/**
 * The replies of a host's `providers-v1` routes, as the desktop main process and the browser client
 * both read them. The route codec has already checked their fields; these give them their IPC types
 * and fail closed on anything else. They decode what a host sends, so the preload does not use them.
 */

import type { ProviderApiKeyStatus, ProviderCodeLoginStart } from "./ipc-agent-status";
import type { ProviderRuntimeSnapshot, ProviderRuntimeStatus } from "./ipc-app-auth";
import {
  type CustomProviderResult,
  type CustomProviderSummary,
  isCustomProviderResult,
  isCustomProviderSummary,
} from "./ipc-custom-providers";
import { isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

/** The verification URL becomes a link the admin opens, so it is held to https here as well. */
export function decodeProviderCodeLoginStart(value: unknown): ProviderCodeLoginStart {
  if (!isDynamicRecord(value)) throw new Error("Invalid code login.");
  if (value.kind === "connected") return { kind: "connected" };
  if (!isString(value.userCode) || !isString(value.verificationUrl) || !isNumber(value.expiresAt))
    throw new Error("Invalid code login.");
  if (new URL(value.verificationUrl).protocol !== "https:") throw new Error("Invalid code login.");
  return { kind: "code", userCode: value.userCode, verificationUrl: value.verificationUrl, expiresAt: value.expiresAt };
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
      codex: decodeProviderRuntimeStatus(providers.codex),
      claude: decodeProviderRuntimeStatus(providers.claude),
      grok: decodeProviderRuntimeStatus(providers.grok),
      opencode: decodeProviderRuntimeStatus(providers.opencode),
      // `providers-v1` has no Gemini entry: Gemini stays on the host computer. This client cannot
      // download or run it on the host, so the status is always "not downloaded".
      antigravity: { phase: "not-downloaded", progress: null, message: null, version: null, availableVersion: null },
    },
    toolRuntimes: { bun: decodeProviderRuntimeStatus(toolRuntimes.bun) },
  };
}

// The contract guard asserts that a summary carries no key, and fails closed on the whole list.
export function decodeCustomProviderSummaries(value: unknown): CustomProviderSummary[] {
  if (!Array.isArray(value) || !value.every(isCustomProviderSummary)) throw new Error("Invalid custom providers.");
  return value;
}

export function decodeCustomProviderResult(value: unknown): CustomProviderResult {
  if (!isCustomProviderResult(value)) throw new Error("Invalid custom provider result.");
  return value;
}
