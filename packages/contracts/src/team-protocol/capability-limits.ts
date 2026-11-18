// The most capabilities that a peer of each Team protocol reads in one list. A host of protocol 6 or
// older refuses a longer WebRTC request (`unsupported_operation`) and reads a longer HTTP header as no
// capabilities. Each list that a client can send to a peer must fit the limit of that peer's protocol;
// a list for an unknown protocol must fit the smallest limit. These values are released wire limits:
// do not change one.
export const TEAM_PROTOCOL_CAPABILITY_LIMITS = {
  1: 64,
  2: 64,
  3: 64,
  4: 64,
  5: 64,
  6: 64,
  7: 128,
  8: 128,
  9: 256,
  // Protocol 10 lists only the capabilities after protocol 9 and the names of absent baseline
  // capabilities (`v10.ts`). Each list can have 256 names, so many releases fit before a new limit.
  10: 256,
} as const;

/**
 * The limit of `protocol`. An unknown protocol gets the limit of protocol 1, which every released
 * peer reads. A protocol newer than the table gets the newest limit.
 */
export function teamProtocolCapabilityLimit(protocol: number | null | undefined): number {
  let limit: number = TEAM_PROTOCOL_CAPABILITY_LIMITS[1];
  if (protocol === null || protocol === undefined) return limit;
  // Integer keys come in ascending order.
  for (const [version, value] of Object.entries(TEAM_PROTOCOL_CAPABILITY_LIMITS))
    if (protocol >= Number(version)) limit = value;
  return limit;
}
