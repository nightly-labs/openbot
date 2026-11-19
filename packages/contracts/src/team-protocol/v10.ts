import { isDynamicRecord, isString } from "../runtime-values";
import { TEAM_PROTOCOL_CAPABILITY_LIMITS } from "./capability-limits";
import { decodeTeamProtocolSupportProviderAware } from "./provider-aware-codec";
import { TEAM_PROTOCOL_V9_CAPABILITY_LIMIT, type TeamProtocolSupportV9 } from "./v9";

export const TEAM_PROTOCOL_V10 = 10 as const;
export const TEAM_PROTOCOL_V10_CAPABILITY_LIMIT = TEAM_PROTOCOL_CAPABILITY_LIMITS[TEAM_PROTOCOL_V10];
export const TEAM_PROTOCOL_V10_ABSENT_LIMIT = TEAM_PROTOCOL_V9_CAPABILITY_LIMIT;
export const TEAM_CAPABILITY_BASELINE_CAPABILITY = "capability-baseline-v1";
export const TEAM_ABSENT_CAPABILITIES_HEADER = "OpenBot-Absent-Capabilities";

export interface TeamCapabilitiesV10 {
  capabilities: string[];
  absent: string[];
}

export interface TeamProtocolSupportV10 extends TeamProtocolSupportV9 {
  absent: string[];
}

export function decodeTeamCapabilitiesV10(capabilities: unknown, absent: unknown): TeamCapabilitiesV10 {
  const lists = readTeamCapabilitiesV10(capabilities, absent);
  if (!lists) throw new Error("Invalid Team API capability lists.");
  return lists;
}

export function readTeamCapabilitiesV10(capabilities: unknown, absent: unknown): TeamCapabilitiesV10 | null {
  if (
    !Array.isArray(capabilities) ||
    capabilities.length > TEAM_PROTOCOL_V10_CAPABILITY_LIMIT ||
    !capabilities.every(isCapability) ||
    !Array.isArray(absent) ||
    absent.length > TEAM_PROTOCOL_V10_ABSENT_LIMIT ||
    !absent.every(isCapability)
  ) {
    return null;
  }
  return { capabilities: [...new Set(capabilities)], absent: [...new Set(absent)] };
}

export function decodeTeamProtocolSupportV10(value: unknown): TeamProtocolSupportV10 {
  const support = decodeTeamProtocolSupportProviderAware(value, TEAM_PROTOCOL_V10_CAPABILITY_LIMIT);
  if (!isDynamicRecord(value)) throw new Error("Invalid Team API compatibility response.");
  return { ...support, ...decodeTeamCapabilitiesV10(support.capabilities, value.absent) };
}

export function hasTeamProtocolV10Lists(value: unknown): boolean {
  return isDynamicRecord(value) && Object.hasOwn(value, "absent");
}

function isCapability(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= 64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value);
}
