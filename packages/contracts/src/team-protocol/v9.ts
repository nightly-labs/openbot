import { TEAM_PROTOCOL_CAPABILITY_LIMITS } from "./capability-limits";
import { decodeTeamProtocolSupportProviderAware, type TeamProtocolSupportProviderAware } from "./provider-aware-codec";
import { TEAM_PROTOCOL_V8_CAPABILITIES } from "./v8";

export const TEAM_PROTOCOL_V9 = 9 as const;
export const TEAM_PROTOCOL_V9_CAPABILITY_LIMIT = TEAM_PROTOCOL_CAPABILITY_LIMITS[TEAM_PROTOCOL_V9];
export const TEAM_LONG_CAPABILITY_LISTS_CAPABILITY = "long-capability-lists-v1";
export const TEAM_PROTOCOL_V9_CAPABILITIES = [
  ...TEAM_PROTOCOL_V8_CAPABILITIES,
  TEAM_LONG_CAPABILITY_LISTS_CAPABILITY,
] as const;
export type TeamProtocolV9Capability = (typeof TEAM_PROTOCOL_V9_CAPABILITIES)[number];
export type TeamProtocolSupportV9 = TeamProtocolSupportProviderAware;

export function decodeTeamProtocolSupportV9(value: unknown): TeamProtocolSupportV9 {
  return decodeTeamProtocolSupportProviderAware(value, TEAM_PROTOCOL_V9_CAPABILITY_LIMIT);
}
