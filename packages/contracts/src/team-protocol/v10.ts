// Protocol 10: the protocol 9 wire, with capability lists of up to 512 names. Protocol 9 reads at most
// 256 capabilities, and the current list has more. A host sends more than 256 only to a peer that says
// it reads them: a request with protocol 10, or a WebRTC request with
// `TEAM_LONGER_CAPABILITY_LISTS_CAPABILITY`. A capability that only protocol 10 peers get is in
// `TEAM_PROTOCOL_V10_ONLY_CAPABILITIES` (`current.ts`), so the lists of older peers stay as they were.
// Routes, bodies and events are the protocol 9 ones; protocol 9 and older do not change.
import { TEAM_PROTOCOL_CAPABILITY_LIMITS } from "./capability-limits";
import { decodeTeamProtocolSupportProviderAware, type TeamProtocolSupportProviderAware } from "./provider-aware-codec";
import { TEAM_PROTOCOL_V9_CAPABILITIES } from "./v9";

export const TEAM_PROTOCOL_V10 = 10 as const;
/** The most capabilities that a protocol 10 peer reads in one list. */
export const TEAM_PROTOCOL_V10_CAPABILITY_LIMIT = TEAM_PROTOCOL_CAPABILITY_LIMITS[TEAM_PROTOCOL_V10];
/**
 * A peer that reads capability lists of up to 512 names. It marks a protocol 10 peer where no protocol
 * header is sent, as on WebRTC. The bootstrap list has it, so the first compatibility read of a
 * protocol 10 host already gives the full list.
 */
export const TEAM_LONGER_CAPABILITY_LISTS_CAPABILITY = "capability-lists-512-v1";
export const TEAM_PROTOCOL_V10_CAPABILITIES = [
  ...TEAM_PROTOCOL_V9_CAPABILITIES,
  TEAM_LONGER_CAPABILITY_LISTS_CAPABILITY,
] as const;
export type TeamProtocolV10Capability = (typeof TEAM_PROTOCOL_V10_CAPABILITIES)[number];
export type TeamProtocolSupportV10 = TeamProtocolSupportProviderAware;

/** A compatibility response from any host, read as a protocol 10 peer: up to 512 capabilities. */
export function decodeTeamProtocolSupportV10(value: unknown): TeamProtocolSupportV10 {
  return decodeTeamProtocolSupportProviderAware(value, TEAM_PROTOCOL_V10_CAPABILITY_LIMIT);
}
