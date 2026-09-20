import type { ProviderRuntimeSnapshot, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";

export function decodeProviderRuntimeSnapshot(value: unknown): ProviderRuntimeSnapshot {
  if (
    !isDynamicRecord(value) ||
    !isNumber(value.revision) ||
    !isDynamicRecord(value.providers) ||
    !isDynamicRecord(value.toolRuntimes)
  ) {
    throw new Error("Invalid provider runtime response.");
  }
  const providers = value.providers;
  const toolRuntimes = value.toolRuntimes;
  // One line per managed runtime, and the object literals are what enumerate them: an id added to
  // `ManagedProviderId` or `ManagedToolRuntimeId` without a line here is a compile error naming it,
  // so a new runtime can never arrive at the renderer undecoded.
  return {
    revision: value.revision,
    providers: {
      codex: decodeProviderRuntimeStatus(providers.codex),
      claude: decodeProviderRuntimeStatus(providers.claude),
      grok: decodeProviderRuntimeStatus(providers.grok),
      opencode: decodeProviderRuntimeStatus(providers.opencode),
    },
    toolRuntimes: { bun: decodeProviderRuntimeStatus(toolRuntimes.bun) },
  };
}

function decodeProviderRuntimeStatus(status: unknown): ProviderRuntimeStatus {
  if (
    !isDynamicRecord(status) ||
    !isOneOf(["not-downloaded", "downloading", "finishing", "ready", "download-error"] as const, status.phase) ||
    (status.progress !== null && !isNumber(status.progress)) ||
    (status.message !== null && !isString(status.message)) ||
    (status.version !== null && !isString(status.version)) ||
    (status.availableVersion !== undefined && status.availableVersion !== null && !isString(status.availableVersion))
  ) {
    throw new Error("Invalid provider runtime response.");
  }
  return {
    phase: status.phase,
    progress: status.progress,
    message: status.message,
    version: status.version,
    availableVersion: status.availableVersion ?? null,
  };
}
