import type { ProviderRuntimeSnapshot } from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";

export function decodeProviderRuntimeSnapshot(value: unknown): ProviderRuntimeSnapshot {
  if (!isDynamicRecord(value) || !isNumber(value.revision) || !isDynamicRecord(value.providers)) {
    throw new Error("Invalid provider runtime response.");
  }
  const decoded: Partial<ProviderRuntimeSnapshot["providers"]> = {};
  for (const provider of ["codex", "claude", "grok"] as const) {
    const status = value.providers[provider];
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
    decoded[provider] = {
      phase: status.phase,
      progress: status.progress,
      message: status.message,
      version: status.version,
      availableVersion: status.availableVersion ?? null,
    };
  }
  const { codex, claude, grok } = decoded;
  if (!codex || !claude || !grok) throw new Error("Invalid provider runtime response.");
  return { revision: value.revision, providers: { codex, claude, grok } };
}
