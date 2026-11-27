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
  return {
    revision: value.revision,
    providers: {
      codex: decodeProviderRuntimeStatus(providers.codex),
      claude: decodeProviderRuntimeStatus(providers.claude),
      grok: decodeProviderRuntimeStatus(providers.grok),
      opencode: decodeProviderRuntimeStatus(providers.opencode),
      antigravity: decodeProviderRuntimeStatus(providers.antigravity),
      cursor: decodeProviderRuntimeStatus(providers.cursor),
      cline: decodeProviderRuntimeStatus(providers.cline),
      kimi: decodeProviderRuntimeStatus(providers.kimi),
      pi: decodeProviderRuntimeStatus(providers.pi),
      muse: decodeProviderRuntimeStatus(providers.muse),
      devin: decodeProviderRuntimeStatus(providers.devin),
      copilot: decodeProviderRuntimeStatus(providers.copilot),
      mistral: decodeProviderRuntimeStatus(providers.mistral),
      ...(providers.hermes === undefined ? {} : { hermes: decodeProviderRuntimeStatus(providers.hermes) }),
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
