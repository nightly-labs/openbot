// Protocol 9: the protocol 8 wire, with capability lists of up to 256 names. Protocols 7 and 8 read at
// most 128 capabilities, and the current list has more. A host sends more than 128 only to a peer that
// says it reads them: a request with protocol 9, or a WebRTC request with
// `TEAM_LONG_CAPABILITY_LISTS_CAPABILITY`. A capability that only protocol 9 peers get is in
// `TEAM_PROTOCOL_V9_ONLY_CAPABILITIES` (`current.ts`), so the lists of older peers stay as they were.
// Routes, bodies and events are the protocol 8 ones; protocol 8 and older do not change.
import { decodeTeamProtocolSupportProviderAware, type TeamProtocolSupportProviderAware } from "./provider-aware-codec";
import { TEAM_PROTOCOL_V8_CAPABILITIES } from "./v8";

export const TEAM_PROTOCOL_V9 = 9 as const;
/** The most capabilities that a protocol 9 peer reads in one list. */
export const TEAM_PROTOCOL_V9_CAPABILITY_LIMIT = 256;
/**
 * A peer that reads capability lists of up to 256 names. It marks a protocol 9 peer where no protocol
 * header is sent, as on WebRTC. The bootstrap list has it, so the first compatibility read of a
 * protocol 9 host already gives the full list.
 */
export const TEAM_LONG_CAPABILITY_LISTS_CAPABILITY = "long-capability-lists-v1";
export const TEAM_PROTOCOL_V9_CAPABILITIES = [
  ...TEAM_PROTOCOL_V8_CAPABILITIES,
  TEAM_LONG_CAPABILITY_LISTS_CAPABILITY,
] as const;
export type TeamProtocolV9Capability = (typeof TEAM_PROTOCOL_V9_CAPABILITIES)[number];
export type TeamProtocolSupportV9 = TeamProtocolSupportProviderAware;

/** A compatibility response from any host, read as a protocol 9 peer: up to 256 capabilities. */
export function decodeTeamProtocolSupportV9(value: unknown): TeamProtocolSupportV9 {
  return decodeTeamProtocolSupportProviderAware(value, TEAM_PROTOCOL_V9_CAPABILITY_LIMIT);
}
