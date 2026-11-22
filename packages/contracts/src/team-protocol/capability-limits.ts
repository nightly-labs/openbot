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
  10: 256,
} as const;

export function teamProtocolCapabilityLimit(protocol: number | null | undefined): number {
  let limit: number = TEAM_PROTOCOL_CAPABILITY_LIMITS[1];
  if (protocol === null || protocol === undefined) return limit;
  for (const [version, value] of Object.entries(TEAM_PROTOCOL_CAPABILITY_LIMITS))
    if (protocol >= Number(version)) limit = value;
  return limit;
}
