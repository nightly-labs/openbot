import { isCustomAgentId } from "./agent-providers";
import { isBoundedString, isNullableBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export const ACP_REGISTRY_DISTRIBUTIONS = ["binary", "npx", "uvx"] as const;
export type AcpRegistryDistribution = (typeof ACP_REGISTRY_DISTRIBUTIONS)[number];
export interface AcpRegistryEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  website: string | null;
  license: string | null;
  distributions: AcpRegistryDistribution[];
  installedVersion: string | null;
  customAgentId: string | null;
}
export interface AcpRegistryInstallInput {
  registryId: string;
  customAgentId: string;
  name?: string;
  distribution?: AcpRegistryDistribution;
}
export interface AcpRegistryInstallation {
  registryId: string;
  customAgentId: string;
  version: string;
  distribution: AcpRegistryDistribution;
}
export interface AcpRegistryOperation {
  registryId: string;
  state: "installing" | "failed";
  message: string | null;
}
export function isAcpRegistryEntry(value: unknown): value is AcpRegistryEntry {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.id, 128) &&
    isBoundedString(value.name, 160) &&
    isBoundedString(value.version, 128) &&
    isBoundedString(value.description, 4096) &&
    isNullableBoundedString(value.website, 2048) &&
    isNullableBoundedString(value.license, 128) &&
    Array.isArray(value.distributions) &&
    value.distributions.every((item) => isOneOf(ACP_REGISTRY_DISTRIBUTIONS, item)) &&
    isNullableBoundedString(value.installedVersion, 128) &&
    (value.customAgentId === null || (typeof value.customAgentId === "string" && isCustomAgentId(value.customAgentId)))
  );
}
export function isAcpRegistryInstallation(value: unknown): value is AcpRegistryInstallation {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.registryId, 128) &&
    typeof value.customAgentId === "string" &&
    isCustomAgentId(value.customAgentId) &&
    isBoundedString(value.version, 128) &&
    isOneOf(ACP_REGISTRY_DISTRIBUTIONS, value.distribution)
  );
}
export function isAcpRegistryOperation(value: unknown): value is AcpRegistryOperation {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.registryId, 128) &&
    (value.state === "installing" || value.state === "failed") &&
    isNullableBoundedString(value.message, 2048)
  );
}
