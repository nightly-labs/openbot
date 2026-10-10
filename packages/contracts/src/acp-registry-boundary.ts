import { isCustomAgentId } from "./agent-providers";
import {
  ACP_REGISTRY_DISTRIBUTIONS,
  type AcpRegistryInstallInput,
  isAcpRegistryEntry,
  isAcpRegistryInstallation,
  isAcpRegistryOperation,
} from "./ipc-acp-registry";
import { isCustomAgentResult } from "./ipc-custom-agents";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export function parseRegistryId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value))
    throw new Error("Invalid registry agent ID.");
  return value;
}
export function parseRegistryQuery(value: unknown): string {
  if (typeof value !== "string" || value.length > 256) throw new Error("Invalid registry search.");
  return value;
}
export function parseRegistryInstall(value: unknown): AcpRegistryInstallInput {
  if (
    !isDynamicRecord(value) ||
    typeof value.customAgentId !== "string" ||
    !isCustomAgentId(value.customAgentId) ||
    (value.name !== undefined && (typeof value.name !== "string" || !value.name.trim() || value.name.length > 80)) ||
    (value.distribution !== undefined && !isOneOf(ACP_REGISTRY_DISTRIBUTIONS, value.distribution))
  )
    throw new Error("Invalid registry installation request.");
  return {
    registryId: parseRegistryId(value.registryId),
    customAgentId: value.customAgentId,
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.distribution === undefined ? {} : { distribution: value.distribution }),
  };
}
export function decodeRegistryEntries(value: unknown) {
  if (!Array.isArray(value) || value.length > 4096 || !value.every(isAcpRegistryEntry))
    throw new Error("Invalid registry response.");
  return value;
}
export function decodeRegistryInstallations(value: unknown) {
  if (!Array.isArray(value) || value.length > 4096 || !value.every(isAcpRegistryInstallation))
    throw new Error("Invalid registry installations.");
  return value;
}
export function decodeRegistryOperations(value: unknown) {
  if (!Array.isArray(value) || value.length > 4096 || !value.every(isAcpRegistryOperation))
    throw new Error("Invalid registry operations.");
  return value;
}
export function decodeRegistryInstallResult(value: unknown) {
  if (!isCustomAgentResult(value)) throw new Error("Invalid registry installation response.");
  return value;
}
