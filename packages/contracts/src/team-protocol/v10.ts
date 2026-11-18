// Protocol 10: the protocol 9 wire, with capability lists that do not repeat the protocol 9 names.
// The protocol 9 list is full (256 names). Protocol 10 freezes it as the baseline
// (`TEAM_PROTOCOL_V10_BASELINE_CAPABILITIES` in `current.ts`, `fixtures/v10/baseline-capabilities.json`).
// A protocol 10 peer sends two lists:
// - `capabilities`: the capabilities after protocol 9 that it serves, with the protocol 10 marker;
// - `absent`: the baseline capabilities that it does not serve.
// The receiver reads `(baseline - absent) + capabilities`, and ignores a name that it does not know.
// A host also leaves out baseline capabilities, such as `mac-apps-limit` on a Mac, so `absent` is
// necessary in both directions.
//
// On HTTP the two lists are the `OpenBot-Capabilities` and `OpenBot-Absent-Capabilities` headers with
// `OpenBot-Protocol-Version: 10`. On WebRTC they are the `capabilities` and `absent` keys of a request,
// and the marker tells the host the protocol. The `capabilities` list also keeps the protocol 9
// marker: a host of protocol 9 ignores `absent` and reads the request as protocol 9, not as protocol 1.
// The compatibility response of a protocol 10 request has `absent` too. Routes, bodies and events are
// the protocol 9 ones; protocol 9 and older do not change.
import { isDynamicRecord, isString } from "../runtime-values";
import { TEAM_PROTOCOL_CAPABILITY_LIMITS } from "./capability-limits";
import { decodeTeamProtocolSupportProviderAware } from "./provider-aware-codec";
import { TEAM_PROTOCOL_V9_CAPABILITY_LIMIT, type TeamProtocolSupportV9 } from "./v9";

export const TEAM_PROTOCOL_V10 = 10 as const;
/** The most names that a protocol 10 peer reads in `capabilities`. */
export const TEAM_PROTOCOL_V10_CAPABILITY_LIMIT = TEAM_PROTOCOL_CAPABILITY_LIMITS[TEAM_PROTOCOL_V10];
/** The most names in `absent`. The baseline is the protocol 9 list, which has at most this many names. */
export const TEAM_PROTOCOL_V10_ABSENT_LIMIT = TEAM_PROTOCOL_V9_CAPABILITY_LIMIT;
/** A peer that sends protocol 10 lists. It marks a protocol 10 peer where no protocol header is sent. */
export const TEAM_CAPABILITY_BASELINE_CAPABILITY = "capability-baseline-v1";
/** The HTTP header with the `absent` list of a protocol 10 request. */
export const TEAM_ABSENT_CAPABILITIES_HEADER = "OpenBot-Absent-Capabilities";

/** The two lists of a protocol 10 peer. */
export interface TeamCapabilitiesV10 {
  capabilities: string[];
  absent: string[];
}

/** A protocol 10 compatibility response, as the host sends it. */
export interface TeamProtocolSupportV10 extends TeamProtocolSupportV9 {
  absent: string[];
}

/** The two lists of a protocol 10 request. A malformed list fails closed. */
export function decodeTeamCapabilitiesV10(capabilities: unknown, absent: unknown): TeamCapabilitiesV10 {
  const lists = readTeamCapabilitiesV10(capabilities, absent);
  if (!lists) throw new Error("Invalid Team API capability lists.");
  return lists;
}

/** The two lists of a protocol 10 request, or null when one is malformed. */
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

/** A compatibility response to a protocol 10 request. It must have `absent`. */
export function decodeTeamProtocolSupportV10(value: unknown): TeamProtocolSupportV10 {
  const support = decodeTeamProtocolSupportProviderAware(value, TEAM_PROTOCOL_V10_CAPABILITY_LIMIT);
  if (!isDynamicRecord(value)) throw new Error("Invalid Team API compatibility response.");
  return { ...support, ...decodeTeamCapabilitiesV10(support.capabilities, value.absent) };
}

/** Whether a compatibility response has the protocol 10 lists. Only a protocol 10 request gets them. */
export function hasTeamProtocolV10Lists(value: unknown): boolean {
  return isDynamicRecord(value) && Object.hasOwn(value, "absent");
}

function isCapability(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= 64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value);
}
