/**
 * Zones for a runtime without `Intl.supportedValuesOf`. The host checks every zone again and refuses
 * one that it cannot resolve.
 */
const COMMON_TIME_ZONES = [
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "America/Anchorage",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Chicago",
  "America/Denver",
  "America/Halifax",
  "America/Lima",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Phoenix",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/St_Johns",
  "America/Toronto",
  "America/Vancouver",
  "Asia/Bangkok",
  "Asia/Dhaka",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Jerusalem",
  "Asia/Karachi",
  "Asia/Kathmandu",
  "Asia/Kolkata",
  "Asia/Manila",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Taipei",
  "Asia/Tehran",
  "Asia/Tokyo",
  "Atlantic/Azores",
  "Atlantic/Reykjavik",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Athens",
  "Europe/Berlin",
  "Europe/Brussels",
  "Europe/Bucharest",
  "Europe/Dublin",
  "Europe/Helsinki",
  "Europe/Istanbul",
  "Europe/Kyiv",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Paris",
  "Europe/Prague",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Vienna",
  "Europe/Warsaw",
  "Europe/Zurich",
  "Pacific/Auckland",
  "Pacific/Honolulu",
];

/** The IANA zones that the user can choose. "UTC" comes first: V8 does not list it as canonical. */
export function knownTimeZones(): string[] {
  const listed = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const zones = listed.length > 0 ? listed : COMMON_TIME_ZONES;
  return ["UTC", ...zones.filter((zone) => zone !== "UTC")];
}

/** "America/Argentina/Buenos_Aires" as "America/Argentina/Buenos Aires". */
export function timeZoneLabel(zone: string): string {
  return zone.replaceAll("_", " ");
}

/** Zones whose name contains every word of the query, in the order of `zones`. */
export function matchTimeZones(zones: readonly string[], query: string, limit: number): string[] {
  const words = query.toLowerCase().replaceAll("_", " ").split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];
  const matches: string[] = [];
  for (const zone of zones) {
    const name = timeZoneLabel(zone).toLowerCase();
    if (words.every((word) => name.includes(word))) matches.push(zone);
    if (matches.length === limit) break;
  }
  return matches;
}
